import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  calculateWeightedAverageCost,
  type CreateStockTransferInput,
  ERROR_CODES,
  formatMoney,
  formatQuantity,
  parseMoney,
  parseQuantity,
  type ReceiveStockTransferInput,
  type StockTransferItemView,
  type StockTransferQuery,
} from "@smart-pos/shared";
import type { AuthenticatedContext, RequestMeta } from "../auth/auth.types";
import { assertBranchAccessibleInTx } from "../common/tenant/tenant-quota.helper";
import { BullMqJobsService } from "../jobs/bullmq-jobs.service";
import { PosEventsService } from "../pos/pos-events.service";
import { runWithSerializableRetry } from "../prisma/prisma-retry.helper";
import { PrismaService } from "../prisma/prisma.service";
import {
  generateDocumentCode,
  lockBranchInventoryRow,
} from "./inventory-lock.helper";

const TRANSFER_SELECT = {
  id: true,
  code: true,
  status: true,
  fromBranchId: true,
  toBranchId: true,
  note: true,
  dispatchedAt: true,
  receivedAt: true,
  fromBranch: { select: { name: true } },
  toBranch: { select: { name: true } },
  createdByMember: { select: { user: { select: { fullName: true } } } },
  receivedByMember: { select: { user: { select: { fullName: true } } } },
  items: {
    select: {
      id: true,
      variantId: true,
      quantity: true,
      unitCost: true,
      variant: {
        select: {
          sku: true,
          name: true,
          unit: true,
          product: { select: { name: true } },
        },
      },
    },
    orderBy: { variantId: "asc" },
  },
} satisfies Prisma.StockTransferSelect;

type TransferRow = Prisma.StockTransferGetPayload<{
  select: typeof TRANSFER_SELECT;
}>;

interface StockDeltaPublished {
  variantId: string;
  onHand: string;
  available: string;
}

@Injectable()
export class StockTransfersService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly posEvents?: PosEventsService,
    @Optional() private readonly bullMqJobs?: BullMqJobsService,
  ) {}

  async listTransfers(
    auth: AuthenticatedContext,
    query: StockTransferQuery,
  ): Promise<{
    items: StockTransferItemView[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      if (query.branchId) {
        await assertBranchAccessibleInTx(tx, auth, query.branchId);
      }

      const branchClause: Prisma.StockTransferWhereInput = query.branchId
        ? {
            OR: [
              { fromBranchId: query.branchId },
              { toBranchId: query.branchId },
            ],
          }
        : auth.allowedBranchIds.length > 0
          ? {
              OR: [
                { fromBranchId: { in: auth.allowedBranchIds } },
                { toBranchId: { in: auth.allowedBranchIds } },
              ],
            }
          : {};

      const searchTerm = query.search?.trim();
      const where: Prisma.StockTransferWhereInput = {
        ...branchClause,
        ...(query.status ? { status: query.status } : {}),
        ...(searchTerm
          ? { code: { contains: searchTerm, mode: "insensitive" } }
          : {}),
      };

      const skip = (query.page - 1) * query.limit;
      const [total, rows] = await Promise.all([
        tx.stockTransfer.count({ where }),
        tx.stockTransfer.findMany({
          where,
          select: TRANSFER_SELECT,
          orderBy: { dispatchedAt: "desc" },
          skip,
          take: query.limit,
        }),
      ]);

      return {
        items: rows.map((row) => this.serializeTransfer(row)),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.limit)),
        },
      };
    });
  }

  async getTransferDetail(
    auth: AuthenticatedContext,
    transferId: string,
  ): Promise<StockTransferItemView> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const row = await tx.stockTransfer.findFirst({
        where: { id: transferId },
        select: TRANSFER_SELECT,
      });
      if (!row) {
        throw new NotFoundException({
          code: ERROR_CODES.STOCK_TRANSFER_NOT_FOUND,
          message: "Không tìm thấy phiếu điều chuyển kho",
        });
      }

      if (
        auth.allowedBranchIds.length > 0 &&
        !auth.allowedBranchIds.includes(row.fromBranchId) &&
        !auth.allowedBranchIds.includes(row.toBranchId)
      ) {
        throw new ForbiddenException({
          code: ERROR_CODES.BRANCH_ACCESS_DENIED,
          message: "Bạn không có quyền xem phiếu điều chuyển này",
        });
      }

      return this.serializeTransfer(row);
    });
  }

  async dispatchTransfer(
    auth: AuthenticatedContext,
    input: CreateStockTransferInput,
    meta: RequestMeta,
  ): Promise<StockTransferItemView> {
    if (input.fromBranchId === input.toBranchId) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Chi nhánh nhận phải khác chi nhánh xuất kho",
      });
    }

    const outcome = await runWithSerializableRetry(() =>
      this.prisma.withTenantTransaction(
        auth.tenantId,
        async (tx) => {
          await assertBranchAccessibleInTx(tx, auth, input.fromBranchId);

          const toBranch = await tx.branch.findFirst({
            where: { id: input.toBranchId },
            select: { id: true, isActive: true, name: true },
          });
          if (!toBranch) {
            throw new NotFoundException({
              code: ERROR_CODES.BRANCH_NOT_FOUND,
              message: "Không tìm thấy chi nhánh nhận hàng",
            });
          }
          if (!toBranch.isActive) {
            throw new BadRequestException({
              code: ERROR_CODES.BRANCH_INACTIVE,
              message: "Chi nhánh nhận hàng đang tạm ngưng hoạt động",
            });
          }

          const sortedItems = [...input.items].sort((a, b) =>
            a.variantId.localeCompare(b.variantId),
          );
          const variantIds = sortedItems.map((it) => it.variantId);
          const variants = await tx.productVariant.findMany({
            where: { id: { in: variantIds }, isActive: true },
            select: { id: true, sku: true, costPrice: true },
          });
          const variantMap = new Map(variants.map((v) => [v.id, v]));
          if (variantMap.size !== variantIds.length) {
            throw new BadRequestException({
              code: ERROR_CODES.PRODUCT_NOT_FOUND,
              message: "Một hoặc nhiều SKU không tồn tại hoặc đã ngưng bán",
            });
          }

          const transferCode = generateDocumentCode("CK");
          const itemRecords: Array<{
            tenantId: string;
            variantId: string;
            quantity: string;
            unitCost: string;
          }> = [];
          const ledgerData: Array<{
            variantId: string;
            qtyDelta: string;
            qtyBefore: string;
            qtyAfter: string;
            unitCost: string;
          }> = [];
          const publishedStock: StockDeltaPublished[] = [];

          for (const item of sortedItems) {
            const qtyMilli = parseQuantity(item.quantity);
            const qtyStr = formatQuantity(qtyMilli);
            const variant = variantMap.get(item.variantId)!;

            const deducted = await tx.$queryRaw<
              Array<{ on_hand: string; reserved: string; avg_cost: string }>
            >`
              UPDATE branch_inventories
              SET
                on_hand = on_hand - ${qtyStr}::decimal(15, 3),
                updated_at = now()
              WHERE tenant_id = ${auth.tenantId}::uuid
                AND branch_id = ${input.fromBranchId}::uuid
                AND variant_id = ${item.variantId}::uuid
                AND (on_hand - reserved) >= ${qtyStr}::decimal(15, 3)
              RETURNING
                on_hand::numeric(15, 3)::text AS on_hand,
                reserved::numeric(15, 3)::text AS reserved,
                avg_cost::numeric(15, 2)::text AS avg_cost
            `;

            const updated = deducted[0];
            if (!updated) {
              throw new ConflictException({
                code: ERROR_CODES.INSUFFICIENT_STOCK,
                message: `SKU "${variant.sku}" không đủ tồn khả dụng tại chi nhánh xuất`,
              });
            }

            const onHandAfterMilli = parseQuantity(updated.on_hand);
            const reservedMilli = parseQuantity(updated.reserved);
            const onHandBeforeMilli = onHandAfterMilli + qtyMilli;
            const avgCostMinor = parseMoney(updated.avg_cost);
            const fallbackCostMinor = parseMoney(variant.costPrice.toFixed(2));
            const transferCostMinor =
              avgCostMinor > 0n ? avgCostMinor : fallbackCostMinor;
            const transferCostStr = formatMoney(transferCostMinor);

            itemRecords.push({
              tenantId: auth.tenantId,
              variantId: item.variantId,
              quantity: qtyStr,
              unitCost: transferCostStr,
            });

            ledgerData.push({
              variantId: item.variantId,
              qtyDelta: formatQuantity(-qtyMilli),
              qtyBefore: formatQuantity(onHandBeforeMilli),
              qtyAfter: updated.on_hand,
              unitCost: transferCostStr,
            });

            publishedStock.push({
              variantId: item.variantId,
              onHand: updated.on_hand,
              available: formatQuantity(onHandAfterMilli - reservedMilli),
            });
          }

          const created = await tx.stockTransfer.create({
            data: {
              tenantId: auth.tenantId,
              fromBranchId: input.fromBranchId,
              toBranchId: input.toBranchId,
              code: transferCode,
              status: "IN_TRANSIT",
              createdByMemberId: auth.memberId,
              note: input.note ?? null,
              items: { create: itemRecords },
            },
            select: TRANSFER_SELECT,
          });

          for (const ledger of ledgerData) {
            await tx.inventoryLedger.create({
              data: {
                tenantId: auth.tenantId,
                branchId: input.fromBranchId,
                variantId: ledger.variantId,
                movementType: "TRANSFER_OUT",
                qtyDelta: ledger.qtyDelta,
                qtyBefore: ledger.qtyBefore,
                qtyAfter: ledger.qtyAfter,
                unitCost: ledger.unitCost,
                referenceType: "stock_transfer",
                referenceId: created.id,
                actorMemberId: auth.memberId,
                note: `Xuất chuyển kho ${transferCode} -> ${toBranch.name}`,
              },
            });
          }

          await tx.auditLog.create({
            data: {
              tenantId: auth.tenantId,
              branchId: input.fromBranchId,
              actorMemberId: auth.memberId,
              action: "TRANSFER_DISPATCHED",
              entityType: "stock_transfer",
              entityId: created.id,
              ipAddress: meta.ipAddress ?? null,
              metadata: {
                transferCode,
                fromBranchId: input.fromBranchId,
                toBranchId: input.toBranchId,
                itemCount: itemRecords.length,
              },
            },
          });

          return {
            transfer: this.serializeTransfer(created),
            publishedStock,
          };
        },
        { isolationLevel: "RepeatableRead" },
      ),
    );

    if (this.posEvents && outcome.publishedStock.length > 0) {
      await this.posEvents.publishStockUpdate(
        auth.tenantId,
        input.fromBranchId,
        outcome.publishedStock,
      );
    }

    if (this.bullMqJobs) {
      await this.bullMqJobs.enqueueTransferEvent({
        tenantId: auth.tenantId,
        transferId: outcome.transfer.id,
        event: "DISPATCHED",
      });
    }

    return outcome.transfer;
  }

  async receiveTransfer(
    auth: AuthenticatedContext,
    transferId: string,
    input: ReceiveStockTransferInput,
    meta: RequestMeta,
  ): Promise<StockTransferItemView> {
    const outcome = await runWithSerializableRetry(() =>
      this.prisma.withTenantTransaction(
        auth.tenantId,
        async (tx) => {
          const lockedRows = await tx.$queryRaw<
            Array<{
              id: string;
              code: string;
              from_branch_id: string;
              to_branch_id: string;
              status: string;
              note: string | null;
            }>
          >`
            SELECT
              id,
              code,
              from_branch_id,
              to_branch_id,
              status::text AS status,
              note
            FROM stock_transfers
            WHERE id = ${transferId}::uuid
              AND tenant_id = ${auth.tenantId}::uuid
            FOR UPDATE
          `;

          const row = lockedRows[0];
          if (!row) {
            throw new NotFoundException({
              code: ERROR_CODES.STOCK_TRANSFER_NOT_FOUND,
              message: "Không tìm thấy phiếu điều chuyển kho",
            });
          }

          await assertBranchAccessibleInTx(tx, auth, row.to_branch_id);

          if (row.status !== "IN_TRANSIT") {
            throw new ConflictException({
              code: ERROR_CODES.STOCK_TRANSFER_INVALID_STATUS,
              message:
                "Chỉ có thể nhận hàng đối với phiếu chuyển kho đang ở trạng thái IN_TRANSIT",
            });
          }

          const items = await tx.stockTransferItem.findMany({
            where: { transferId },
            select: { variantId: true, quantity: true, unitCost: true },
            orderBy: { variantId: "asc" },
          });

          const publishedStock: StockDeltaPublished[] = [];

          for (const item of items) {
            const incomingQtyMilli = parseQuantity(item.quantity.toFixed(3));
            const incomingCostMinor = parseMoney(item.unitCost.toFixed(2));
            const lockedDest = await lockBranchInventoryRow(
              tx,
              auth.tenantId,
              row.to_branch_id,
              item.variantId,
            );

            const nextAvgCostMinor = calculateWeightedAverageCost(
              lockedDest.onHandMilli,
              lockedDest.avgCostMinor,
              incomingQtyMilli,
              incomingCostMinor,
            );

            const afterMilli = lockedDest.onHandMilli + incomingQtyMilli;
            const afterStr = formatQuantity(afterMilli);
            const availableStr = formatQuantity(
              afterMilli - lockedDest.reservedMilli,
            );

            await tx.$executeRaw`
              UPDATE branch_inventories
              SET
                on_hand = ${afterStr}::decimal(15, 3),
                avg_cost = ${formatMoney(nextAvgCostMinor)}::decimal(15, 2),
                updated_at = now()
              WHERE tenant_id = ${auth.tenantId}::uuid
                AND branch_id = ${row.to_branch_id}::uuid
                AND variant_id = ${item.variantId}::uuid
            `;

            await tx.inventoryLedger.create({
              data: {
                tenantId: auth.tenantId,
                branchId: row.to_branch_id,
                variantId: item.variantId,
                movementType: "TRANSFER_IN",
                qtyDelta: formatQuantity(incomingQtyMilli),
                qtyBefore: formatQuantity(lockedDest.onHandMilli),
                qtyAfter: afterStr,
                unitCost: formatMoney(incomingCostMinor),
                referenceType: "stock_transfer",
                referenceId: transferId,
                actorMemberId: auth.memberId,
                note: `Nhận chuyển kho ${row.code}`,
              },
            });

            publishedStock.push({
              variantId: item.variantId,
              onHand: afterStr,
              available: availableStr,
            });
          }

          const updated = await tx.stockTransfer.update({
            where: { id: transferId },
            data: {
              status: "RECEIVED",
              receivedByMemberId: auth.memberId,
              receivedAt: new Date(),
              ...(input.note !== undefined ? { note: input.note } : {}),
            },
            select: TRANSFER_SELECT,
          });

          await tx.auditLog.create({
            data: {
              tenantId: auth.tenantId,
              branchId: row.to_branch_id,
              actorMemberId: auth.memberId,
              action: "TRANSFER_RECEIVED",
              entityType: "stock_transfer",
              entityId: transferId,
              ipAddress: meta.ipAddress ?? null,
              metadata: {
                transferCode: row.code,
                fromBranchId: row.from_branch_id,
                toBranchId: row.to_branch_id,
              },
            },
          });

          return {
            transfer: this.serializeTransfer(updated),
            toBranchId: row.to_branch_id,
            publishedStock,
          };
        },
        { isolationLevel: "RepeatableRead" },
      ),
    );

    if (this.posEvents && outcome.publishedStock.length > 0) {
      await this.posEvents.publishStockUpdate(
        auth.tenantId,
        outcome.toBranchId,
        outcome.publishedStock,
      );
    }

    if (this.bullMqJobs) {
      await this.bullMqJobs.enqueueTransferEvent({
        tenantId: auth.tenantId,
        transferId: outcome.transfer.id,
        event: "RECEIVED",
      });
    }

    return outcome.transfer;
  }

  async cancelTransfer(
    auth: AuthenticatedContext,
    transferId: string,
  ): Promise<StockTransferItemView> {
    const outcome = await runWithSerializableRetry(() =>
      this.prisma.withTenantTransaction(
        auth.tenantId,
        async (tx) => {
          const lockedRows = await tx.$queryRaw<
            Array<{
              id: string;
              code: string;
              from_branch_id: string;
              status: string;
            }>
          >`
            SELECT
              id,
              code,
              from_branch_id,
              status::text AS status
            FROM stock_transfers
            WHERE id = ${transferId}::uuid
              AND tenant_id = ${auth.tenantId}::uuid
            FOR UPDATE
          `;

          const row = lockedRows[0];
          if (!row) {
            throw new NotFoundException({
              code: ERROR_CODES.STOCK_TRANSFER_NOT_FOUND,
              message: "Không tìm thấy phiếu điều chuyển kho",
            });
          }

          await assertBranchAccessibleInTx(tx, auth, row.from_branch_id);

          if (row.status !== "IN_TRANSIT") {
            throw new ConflictException({
              code: ERROR_CODES.STOCK_TRANSFER_INVALID_STATUS,
              message:
                "Chỉ có thể hủy phiếu chuyển kho đang ở trạng thái IN_TRANSIT",
            });
          }

          const items = await tx.stockTransferItem.findMany({
            where: { transferId },
            select: { variantId: true, quantity: true, unitCost: true },
            orderBy: { variantId: "asc" },
          });

          const publishedStock: StockDeltaPublished[] = [];

          for (const item of items) {
            const qtyMilli = parseQuantity(item.quantity.toFixed(3));
            const lockedOrigin = await lockBranchInventoryRow(
              tx,
              auth.tenantId,
              row.from_branch_id,
              item.variantId,
            );
            const afterMilli = lockedOrigin.onHandMilli + qtyMilli;
            const afterStr = formatQuantity(afterMilli);
            const availableStr = formatQuantity(
              afterMilli - lockedOrigin.reservedMilli,
            );

            await tx.$executeRaw`
              UPDATE branch_inventories
              SET
                on_hand = ${afterStr}::decimal(15, 3),
                updated_at = now()
              WHERE tenant_id = ${auth.tenantId}::uuid
                AND branch_id = ${row.from_branch_id}::uuid
                AND variant_id = ${item.variantId}::uuid
            `;

            await tx.inventoryLedger.create({
              data: {
                tenantId: auth.tenantId,
                branchId: row.from_branch_id,
                variantId: item.variantId,
                movementType: "TRANSFER_IN",
                qtyDelta: formatQuantity(qtyMilli),
                qtyBefore: formatQuantity(lockedOrigin.onHandMilli),
                qtyAfter: afterStr,
                unitCost: item.unitCost.toFixed(2),
                referenceType: "stock_transfer",
                referenceId: transferId,
                actorMemberId: auth.memberId,
                note: `Hoàn tồn hủy chuyển kho ${row.code}`,
              },
            });

            publishedStock.push({
              variantId: item.variantId,
              onHand: afterStr,
              available: availableStr,
            });
          }

          const updated = await tx.stockTransfer.update({
            where: { id: transferId },
            data: { status: "CANCELLED" },
            select: TRANSFER_SELECT,
          });

          return {
            transfer: this.serializeTransfer(updated),
            fromBranchId: row.from_branch_id,
            publishedStock,
          };
        },
        { isolationLevel: "RepeatableRead" },
      ),
    );

    if (this.posEvents && outcome.publishedStock.length > 0) {
      await this.posEvents.publishStockUpdate(
        auth.tenantId,
        outcome.fromBranchId,
        outcome.publishedStock,
      );
    }

    if (this.bullMqJobs) {
      await this.bullMqJobs.enqueueTransferEvent({
        tenantId: auth.tenantId,
        transferId: outcome.transfer.id,
        event: "CANCELLED",
      });
    }

    return outcome.transfer;
  }

  private serializeTransfer(row: TransferRow): StockTransferItemView {
    return {
      id: row.id,
      code: row.code,
      status: row.status,
      fromBranchId: row.fromBranchId,
      fromBranchName: row.fromBranch.name,
      toBranchId: row.toBranchId,
      toBranchName: row.toBranch.name,
      createdByName: row.createdByMember.user.fullName,
      receivedByName: row.receivedByMember?.user.fullName ?? null,
      note: row.note,
      dispatchedAt: row.dispatchedAt.toISOString(),
      receivedAt: row.receivedAt ? row.receivedAt.toISOString() : null,
      items: row.items.map((item) => ({
        id: item.id,
        variantId: item.variantId,
        sku: item.variant.sku,
        productName: item.variant.product.name,
        variantName: item.variant.name,
        unit: item.variant.unit,
        quantity: item.quantity.toFixed(3),
        unitCost: item.unitCost.toFixed(2),
      })),
    };
  }
}
