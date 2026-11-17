import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  type BalanceStockCountInput,
  type CreateStockCountInput,
  ERROR_CODES,
  formatMoney,
  formatQuantity,
  parseMoney,
  parseQuantity,
  type StockCountItemResponse,
  type StockCountListQuery,
  type StockCountListResponse,
} from "@smart-pos/shared";
import type { AuthenticatedContext, RequestMeta } from "../auth/auth.types";
import { assertBranchAccessibleInTx } from "../common/tenant/tenant-quota.helper";
import { PrismaService } from "../prisma/prisma.service";
import {
  generateDocumentCode,
  lockBranchInventoryRow,
} from "./inventory-lock.helper";

const STOCK_COUNT_SELECT = {
  id: true,
  code: true,
  branchId: true,
  status: true,
  balancedAt: true,
  createdAt: true,
  branch: { select: { code: true, name: true } },
  createdBy: { select: { user: { select: { fullName: true } } } },
  balancedBy: { select: { user: { select: { fullName: true } } } },
  items: {
    select: {
      id: true,
      variantId: true,
      systemQty: true,
      actualQty: true,
      varianceQty: true,
      reason: true,
      variant: { select: { sku: true, name: true, unit: true, costPrice: true } },
    },
    orderBy: { variantId: "asc" },
  },
} satisfies Prisma.StockCountSelect;

type StockCountRow = Prisma.StockCountGetPayload<{
  select: typeof STOCK_COUNT_SELECT;
}>;

@Injectable()
export class StockCountsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    auth: AuthenticatedContext,
    query: StockCountListQuery,
  ): Promise<StockCountListResponse> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      if (query.branchId) {
        await assertBranchAccessibleInTx(tx, auth, query.branchId);
      }

      const branchFilter = query.branchId
        ? query.branchId
        : auth.allowedBranchIds.length > 0
          ? { in: auth.allowedBranchIds }
          : undefined;

      const searchTerm = query.search?.trim();
      const where: Prisma.StockCountWhereInput = {
        ...(branchFilter !== undefined ? { branchId: branchFilter } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(searchTerm
          ? { code: { contains: searchTerm, mode: "insensitive" } }
          : {}),
      };

      const skip = (query.page - 1) * query.limit;
      const [total, rows] = await Promise.all([
        tx.stockCount.count({ where }),
        tx.stockCount.findMany({
          where,
          select: STOCK_COUNT_SELECT,
          orderBy: [{ createdAt: "desc" }],
          skip,
          take: query.limit,
        }),
      ]);

      return {
        items: rows.map((row) => this.serialize(row)),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.limit)),
        },
      };
    });
  }

  async create(
    auth: AuthenticatedContext,
    input: CreateStockCountInput,
    meta: RequestMeta,
  ): Promise<StockCountItemResponse> {
    return this.prisma.withTenantTransaction(
      auth.tenantId,
      async (tx) => {
        await assertBranchAccessibleInTx(tx, auth, input.branchId);

        const variantIds = input.items.map((item) => item.variantId);
        const foundVariants = await tx.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: { id: true },
        });
        if (foundVariants.length !== variantIds.length) {
          throw new BadRequestException({
            code: ERROR_CODES.PRODUCT_NOT_FOUND,
            message: "Một hoặc nhiều SKU không tồn tại trong cửa hàng",
          });
        }

        const code = input.code ?? generateDocumentCode("KK");
        const existingCode = await tx.stockCount.findFirst({
          where: { code },
          select: { id: true },
        });
        if (existingCode) {
          throw new ConflictException({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: `Mã phiếu kiểm kho "${code}" đã tồn tại`,
          });
        }

        const inventories = await tx.branchInventory.findMany({
          where: {
            branchId: input.branchId,
            variantId: { in: variantIds },
          },
          select: { variantId: true, onHand: true },
        });
        const onHandMap = new Map(
          inventories.map((inv) => [
            inv.variantId,
            parseQuantity(inv.onHand.toString()),
          ]),
        );

        const created = await tx.stockCount.create({
          data: {
            tenantId: auth.tenantId,
            branchId: input.branchId,
            code,
            status: "DRAFT",
            createdByMemberId: auth.memberId,
            items: {
              create: input.items.map((item) => {
                const systemMilli = onHandMap.get(item.variantId) ?? 0n;
                const actualMilli = parseQuantity(item.actualQty);
                const varianceMilli = actualMilli - systemMilli;

                return {
                  tenantId: auth.tenantId,
                  variantId: item.variantId,
                  systemQty: formatQuantity(systemMilli),
                  actualQty: formatQuantity(actualMilli),
                  varianceQty: formatQuantity(varianceMilli),
                  reason: item.reason?.trim() || null,
                };
              }),
            },
          },
          select: STOCK_COUNT_SELECT,
        });

        if (input.balanceImmediately) {
          return this.executeBalanceInTx(tx, auth, created.id, {}, meta);
        }

        return this.serialize(created);
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  async balance(
    auth: AuthenticatedContext,
    stockCountId: string,
    input: BalanceStockCountInput,
    meta: RequestMeta,
  ): Promise<StockCountItemResponse> {
    return this.prisma.withTenantTransaction(
      auth.tenantId,
      (tx) => this.executeBalanceInTx(tx, auth, stockCountId, input, meta),
      { isolationLevel: "RepeatableRead" },
    );
  }

  async cancel(
    auth: AuthenticatedContext,
    stockCountId: string,
  ): Promise<StockCountItemResponse> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const existing = await tx.stockCount.findFirst({
        where: { id: stockCountId },
        select: { id: true, branchId: true, status: true },
      });

      if (!existing) {
        throw new NotFoundException({
          code: ERROR_CODES.STOCK_COUNT_NOT_FOUND,
          message: "Không tìm thấy phiếu kiểm kho",
        });
      }

      await assertBranchAccessibleInTx(tx, auth, existing.branchId);

      if (existing.status !== "DRAFT") {
        throw new ConflictException({
          code: ERROR_CODES.STOCK_COUNT_INVALID_STATUS,
          message: "Chỉ có thể hủy phiếu kiểm kho đang ở trạng thái Nháp (DRAFT)",
        });
      }

      const updated = await tx.stockCount.update({
        where: { id: stockCountId },
        data: { status: "CANCELLED" },
        select: STOCK_COUNT_SELECT,
      });

      return this.serialize(updated);
    });
  }

  private async executeBalanceInTx(
    tx: Prisma.TransactionClient,
    auth: AuthenticatedContext,
    stockCountId: string,
    input: BalanceStockCountInput,
    meta: RequestMeta,
  ): Promise<StockCountItemResponse> {
    const existing = await tx.stockCount.findFirst({
      where: { id: stockCountId },
      select: STOCK_COUNT_SELECT,
    });

    if (!existing) {
      throw new NotFoundException({
        code: ERROR_CODES.STOCK_COUNT_NOT_FOUND,
        message: "Không tìm thấy phiếu kiểm kho",
      });
    }

    await assertBranchAccessibleInTx(tx, auth, existing.branchId);

    // Atomic state transition prevents double-balancing concurrency issues.
    const claimed = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE stock_counts
      SET
        status = 'BALANCED'::"StockCountStatus",
        balanced_by = ${auth.memberId}::uuid,
        balanced_at = now(),
        updated_at = now()
      WHERE id = ${stockCountId}::uuid
        AND tenant_id = ${auth.tenantId}::uuid
        AND status = 'DRAFT'::"StockCountStatus"
      RETURNING id
    `;

    if (claimed.length === 0) {
      throw new ConflictException({
        code: ERROR_CODES.STOCK_COUNT_INVALID_STATUS,
        message: "Phiếu kiểm kho này đã được cân bằng hoặc đã hủy trước đó",
      });
    }

    const sortedItems = [...existing.items].sort((a, b) =>
      a.variantId.localeCompare(b.variantId),
    );
    const adjustedSummary: Array<{
      variantId: string;
      sku: string;
      varianceQty: string;
      reason: string;
    }> = [];

    for (const item of sortedItems) {
      const locked = await lockBranchInventoryRow(
        tx,
        auth.tenantId,
        existing.branchId,
        item.variantId,
      );

      const actualQtyMilli = parseQuantity(item.actualQty.toString());
      if (actualQtyMilli < locked.reservedMilli) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `SKU "${item.variant.sku}" đang giữ chỗ ${formatQuantity(locked.reservedMilli)}, tồn thực tế không thể nhỏ hơn`,
        });
      }

      const varianceMilli = actualQtyMilli - locked.onHandMilli;
      const overrideReason = input.itemReasons?.[item.variantId]?.trim();
      const effectiveReason = overrideReason || item.reason?.trim() || null;

      // Enforce reconciliation rule: any non-zero variance must record a verified reason.
      if (varianceMilli !== 0n && !effectiveReason) {
        throw new BadRequestException({
          code: ERROR_CODES.VARIANCE_REASON_REQUIRED,
          message: `SKU "${item.variant.sku}" có chênh lệch (${formatQuantity(varianceMilli)}) nhưng chưa có lý do điều chỉnh`,
        });
      }

      const systemQtyStr = formatQuantity(locked.onHandMilli);
      const actualQtyStr = formatQuantity(actualQtyMilli);
      const varianceQtyStr = formatQuantity(varianceMilli);

      await tx.stockCountItem.update({
        where: { id: item.id },
        data: {
          systemQty: systemQtyStr,
          varianceQty: varianceQtyStr,
          reason: effectiveReason,
        },
      });

      if (varianceMilli !== 0n) {
        const effectiveCostMinor =
          locked.avgCostMinor > 0n
            ? locked.avgCostMinor
            : parseMoney(item.variant.costPrice.toString());

        await tx.$executeRaw`
          UPDATE branch_inventories
          SET
            on_hand = ${actualQtyStr}::decimal(15, 3),
            updated_at = now()
          WHERE tenant_id = ${auth.tenantId}::uuid
            AND branch_id = ${existing.branchId}::uuid
            AND variant_id = ${item.variantId}::uuid
        `;

        await tx.inventoryLedger.create({
          data: {
            tenantId: auth.tenantId,
            branchId: existing.branchId,
            variantId: item.variantId,
            movementType: "STOCK_COUNT",
            qtyDelta: varianceQtyStr,
            qtyBefore: systemQtyStr,
            qtyAfter: actualQtyStr,
            unitCost: formatMoney(effectiveCostMinor),
            referenceType: "stock_count",
            referenceId: existing.id,
            actorMemberId: auth.memberId,
            note: input.note
              ? `${effectiveReason} (${input.note})`
              : effectiveReason,
          },
        });

        adjustedSummary.push({
          variantId: item.variantId,
          sku: item.variant.sku,
          varianceQty: varianceQtyStr,
          reason: effectiveReason!,
        });
      }
    }

    await tx.auditLog.create({
      data: {
        tenantId: auth.tenantId,
        branchId: existing.branchId,
        actorMemberId: auth.memberId,
        action: "STOCK_ADJUST",
        entityType: "stock_count",
        entityId: existing.id,
        ipAddress: meta.ipAddress ?? null,
        metadata: {
          code: existing.code,
          totalItems: sortedItems.length,
          adjustedCount: adjustedSummary.length,
          adjustedItems: adjustedSummary,
          note: input.note ?? null,
        },
      },
    });

    const balanced = await tx.stockCount.findFirstOrThrow({
      where: { id: stockCountId },
      select: STOCK_COUNT_SELECT,
    });

    return this.serialize(balanced);
  }

  private serialize(row: StockCountRow): StockCountItemResponse {
    return {
      id: row.id,
      code: row.code,
      branchId: row.branchId,
      branchCode: row.branch.code,
      branchName: row.branch.name,
      status: row.status,
      createdByName: row.createdBy.user.fullName,
      balancedByName: row.balancedBy?.user.fullName ?? null,
      balancedAt: row.balancedAt ? row.balancedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      items: row.items.map((item) => ({
        id: item.id,
        variantId: item.variantId,
        sku: item.variant.sku,
        variantName: item.variant.name,
        unit: item.variant.unit,
        systemQty: item.systemQty.toFixed(3),
        actualQty: item.actualQty.toFixed(3),
        varianceQty: item.varianceQty.toFixed(3),
        reason: item.reason,
      })),
    };
  }
}
