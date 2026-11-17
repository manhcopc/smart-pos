import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  calculateEffectiveIncomingUnitCost,
  calculateLineSubtotal,
  calculateWeightedAverageCost,
  type CompletePurchaseOrderInput,
  type CreatePurchaseOrderInput,
  ERROR_CODES,
  formatMoney,
  formatQuantity,
  parseMoney,
  parseQuantity,
  type PurchaseOrderItemResponse,
  type PurchaseOrderListQuery,
  type PurchaseOrderListResponse,
} from "@smart-pos/shared";
import type { AuthenticatedContext } from "../auth/auth.types";
import { assertBranchAccessibleInTx } from "../common/tenant/tenant-quota.helper";
import { PosEventsService } from "../pos/pos-events.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  generateDocumentCode,
  lockBranchInventoryRow,
} from "./inventory-lock.helper";

const PO_SELECT = {
  id: true,
  code: true,
  branchId: true,
  supplierId: true,
  status: true,
  totalAmount: true,
  paidAmount: true,
  completedAt: true,
  createdAt: true,
  branch: { select: { code: true, name: true } },
  supplier: { select: { name: true } },
  createdBy: { select: { user: { select: { fullName: true } } } },
  items: {
    select: {
      id: true,
      variantId: true,
      orderedQty: true,
      receivedQty: true,
      unitCost: true,
      discount: true,
      variant: { select: { sku: true, name: true, unit: true } },
    },
    orderBy: { variantId: "asc" },
  },
} satisfies Prisma.PurchaseOrderSelect;

type PoRow = Prisma.PurchaseOrderGetPayload<{ select: typeof PO_SELECT }>;

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly posEvents?: PosEventsService,
  ) {}

  async list(
    auth: AuthenticatedContext,
    query: PurchaseOrderListQuery,
  ): Promise<PurchaseOrderListResponse> {
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
      const where: Prisma.PurchaseOrderWhereInput = {
        ...(branchFilter !== undefined ? { branchId: branchFilter } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(searchTerm
          ? {
              OR: [
                { code: { contains: searchTerm, mode: "insensitive" } },
                {
                  supplier: {
                    name: { contains: searchTerm, mode: "insensitive" },
                  },
                },
              ],
            }
          : {}),
      };

      const skip = (query.page - 1) * query.limit;
      const [total, rows] = await Promise.all([
        tx.purchaseOrder.count({ where }),
        tx.purchaseOrder.findMany({
          where,
          select: PO_SELECT,
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

  async getOne(
    auth: AuthenticatedContext,
    poId: string,
  ): Promise<PurchaseOrderItemResponse> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id: poId },
        select: PO_SELECT,
      });

      if (!po) {
        throw new NotFoundException({
          code: ERROR_CODES.PURCHASE_ORDER_NOT_FOUND,
          message: "Không tìm thấy phiếu nhập hàng",
        });
      }

      await assertBranchAccessibleInTx(tx, auth, po.branchId);
      return this.serialize(po);
    });
  }

  async create(
    auth: AuthenticatedContext,
    input: CreatePurchaseOrderInput,
  ): Promise<PurchaseOrderItemResponse> {
    let totalAmountMinor = 0n;
    for (const item of input.items) {
      const qtyMilli = parseQuantity(item.orderedQty);
      const unitCostMinor = parseMoney(item.unitCost);
      const discountMinor = parseMoney(item.discount);
      const lineGrossMinor = calculateLineSubtotal(qtyMilli, unitCostMinor);
      if (discountMinor > lineGrossMinor) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: "Chiết khấu dòng hàng không được vượt quá thành tiền dòng",
        });
      }
      totalAmountMinor += lineGrossMinor - discountMinor;
    }

    const paidAmountMinor = parseMoney(input.paidAmount);
    if (paidAmountMinor > totalAmountMinor) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Số tiền đã thanh toán không được vượt quá tổng phiếu nhập",
      });
    }

    const outcome = await this.prisma.withTenantTransaction<{
      response: PurchaseOrderItemResponse;
      stockUpdates: Array<{ variantId: string; onHand: string; available: string }>;
    }>(
      auth.tenantId,
      async (tx) => {
        await assertBranchAccessibleInTx(tx, auth, input.branchId);

        if (input.supplierId) {
          const supplier = await tx.supplier.findFirst({
            where: { id: input.supplierId },
            select: { id: true },
          });
          if (!supplier) {
            throw new NotFoundException({
              code: ERROR_CODES.SUPPLIER_NOT_FOUND,
              message: "Không tìm thấy nhà cung cấp",
            });
          }
        }

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

        const code = input.code ?? generateDocumentCode("PO");
        const existingCode = await tx.purchaseOrder.findFirst({
          where: { code },
          select: { id: true },
        });
        if (existingCode) {
          throw new ConflictException({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: `Mã phiếu nhập "${code}" đã tồn tại`,
          });
        }

        const created = await tx.purchaseOrder.create({
          data: {
            tenantId: auth.tenantId,
            branchId: input.branchId,
            supplierId: input.supplierId ?? null,
            code,
            status: "DRAFT",
            totalAmount: formatMoney(totalAmountMinor),
            paidAmount: formatMoney(paidAmountMinor),
            createdByMemberId: auth.memberId,
            items: {
              create: input.items.map((item) => ({
                tenantId: auth.tenantId,
                variantId: item.variantId,
                orderedQty: formatQuantity(parseQuantity(item.orderedQty)),
                receivedQty: "0.000",
                unitCost: formatMoney(parseMoney(item.unitCost)),
                discount: formatMoney(parseMoney(item.discount)),
              })),
            },
          },
          select: PO_SELECT,
        });

        if (input.completeImmediately) {
          return this.executeCompletionInTx(tx, auth, created.id, {
            paidAmount: input.paidAmount,
          });
        }

        return { response: this.serialize(created), stockUpdates: [] };
      },
      { isolationLevel: "RepeatableRead" },
    );

    if (outcome.stockUpdates.length > 0) {
      await this.posEvents?.publishStockUpdate(
        auth.tenantId,
        input.branchId,
        outcome.stockUpdates,
      );
    }

    return outcome.response;
  }

  async complete(
    auth: AuthenticatedContext,
    poId: string,
    input: CompletePurchaseOrderInput,
  ): Promise<PurchaseOrderItemResponse> {
    const outcome = await this.prisma.withTenantTransaction(
      auth.tenantId,
      (tx) => this.executeCompletionInTx(tx, auth, poId, input),
      { isolationLevel: "RepeatableRead" },
    );

    if (outcome.stockUpdates.length > 0) {
      await this.posEvents?.publishStockUpdate(
        auth.tenantId,
        outcome.response.branchId,
        outcome.stockUpdates,
      );
    }

    return outcome.response;
  }

  async cancel(
    auth: AuthenticatedContext,
    poId: string,
  ): Promise<PurchaseOrderItemResponse> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const existing = await tx.purchaseOrder.findFirst({
        where: { id: poId },
        select: { id: true, branchId: true, status: true },
      });

      if (!existing) {
        throw new NotFoundException({
          code: ERROR_CODES.PURCHASE_ORDER_NOT_FOUND,
          message: "Không tìm thấy phiếu nhập hàng",
        });
      }

      await assertBranchAccessibleInTx(tx, auth, existing.branchId);

      if (existing.status !== "DRAFT") {
        throw new ConflictException({
          code: ERROR_CODES.PURCHASE_ORDER_INVALID_STATUS,
          message: "Chỉ có thể hủy phiếu nhập đang ở trạng thái Nháp (DRAFT)",
        });
      }

      const updated = await tx.purchaseOrder.update({
        where: { id: poId },
        data: { status: "CANCELLED" },
        select: PO_SELECT,
      });

      return this.serialize(updated);
    });
  }

  private async executeCompletionInTx(
    tx: Prisma.TransactionClient,
    auth: AuthenticatedContext,
    poId: string,
    input: CompletePurchaseOrderInput,
  ): Promise<{
    response: PurchaseOrderItemResponse;
    stockUpdates: Array<{ variantId: string; onHand: string; available: string }>;
  }> {
    const existing = await tx.purchaseOrder.findFirst({
      where: { id: poId },
      select: PO_SELECT,
    });

    if (!existing) {
      throw new NotFoundException({
        code: ERROR_CODES.PURCHASE_ORDER_NOT_FOUND,
        message: "Không tìm thấy phiếu nhập hàng",
      });
    }

    await assertBranchAccessibleInTx(tx, auth, existing.branchId);

    const totalMinor = parseMoney(existing.totalAmount.toString());
    const nextPaidStr =
      input.paidAmount !== undefined
        ? formatMoney(parseMoney(input.paidAmount))
        : existing.paidAmount.toFixed(2);
    const nextPaidMinor = parseMoney(nextPaidStr);

    if (nextPaidMinor > totalMinor) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Số tiền thanh toán không được vượt quá tổng tiền phiếu nhập",
      });
    }

    // Atomic state transition prevents double-receiving stock on concurrent submits.
    const claimed = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE purchase_orders
      SET
        status = 'COMPLETED'::"PurchaseOrderStatus",
        paid_amount = ${nextPaidStr}::decimal(15, 2),
        completed_at = now(),
        updated_at = now()
      WHERE id = ${poId}::uuid
        AND tenant_id = ${auth.tenantId}::uuid
        AND status = 'DRAFT'::"PurchaseOrderStatus"
      RETURNING id
    `;

    if (claimed.length === 0) {
      throw new ConflictException({
        code: ERROR_CODES.PURCHASE_ORDER_INVALID_STATUS,
        message: "Phiếu nhập này đã được hoàn tất hoặc đã hủy trước đó",
      });
    }

    // Lock SKUs in ascending variantId order to eliminate cross-transaction deadlocks.
    const sortedItems = [...existing.items].sort((a, b) =>
      a.variantId.localeCompare(b.variantId),
    );
    const stockUpdates: Array<{
      variantId: string;
      onHand: string;
      available: string;
    }> = [];

    for (const item of sortedItems) {
      const locked = await lockBranchInventoryRow(
        tx,
        auth.tenantId,
        existing.branchId,
        item.variantId,
      );

      const incomingQtyMilli = parseQuantity(item.orderedQty.toString());
      const unitCostMinor = parseMoney(item.unitCost.toString());
      const discountMinor = parseMoney(item.discount.toString());

      const effectiveUnitCostMinor = calculateEffectiveIncomingUnitCost(
        incomingQtyMilli,
        unitCostMinor,
        discountMinor,
      );

      const nextAvgCostMinor = calculateWeightedAverageCost(
        locked.onHandMilli,
        locked.avgCostMinor,
        incomingQtyMilli,
        effectiveUnitCostMinor,
      );

      const qtyAfterMilli = locked.onHandMilli + incomingQtyMilli;
      const qtyAfterStr = formatQuantity(qtyAfterMilli);
      const nextAvgCostStr = formatMoney(nextAvgCostMinor);

      await tx.$executeRaw`
        UPDATE branch_inventories
        SET
          on_hand = ${qtyAfterStr}::decimal(15, 3),
          avg_cost = ${nextAvgCostStr}::decimal(15, 2),
          updated_at = now()
        WHERE tenant_id = ${auth.tenantId}::uuid
          AND branch_id = ${existing.branchId}::uuid
          AND variant_id = ${item.variantId}::uuid
      `;

      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { costPrice: nextAvgCostStr },
      });

      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: { receivedQty: formatQuantity(incomingQtyMilli) },
      });

      await tx.inventoryLedger.create({
        data: {
          tenantId: auth.tenantId,
          branchId: existing.branchId,
          variantId: item.variantId,
          movementType: "PURCHASE_IN",
          qtyDelta: formatQuantity(incomingQtyMilli),
          qtyBefore: formatQuantity(locked.onHandMilli),
          qtyAfter: qtyAfterStr,
          unitCost: formatMoney(effectiveUnitCostMinor),
          referenceType: "purchase_order",
          referenceId: existing.id,
          actorMemberId: auth.memberId,
          note:
            input.note ??
            `Nhập hàng phiếu ${existing.code} (AVCO: ${nextAvgCostStr})`,
        },
      });

      stockUpdates.push({
        variantId: item.variantId,
        onHand: qtyAfterStr,
        available: formatQuantity(qtyAfterMilli - locked.reservedMilli),
      });
    }

    const unpaidMinor = totalMinor - nextPaidMinor;
    if (existing.supplierId && unpaidMinor > 0n) {
      const unpaidStr = formatMoney(unpaidMinor);
      await tx.$executeRaw`
        UPDATE suppliers
        SET
          debt_balance = debt_balance + ${unpaidStr}::decimal(15, 2),
          updated_at = now()
        WHERE id = ${existing.supplierId}::uuid
          AND tenant_id = ${auth.tenantId}::uuid
      `;
    }

    const completed = await tx.purchaseOrder.findFirstOrThrow({
      where: { id: poId },
      select: PO_SELECT,
    });

    return {
      response: this.serialize(completed),
      stockUpdates,
    };
  }

  private serialize(row: PoRow): PurchaseOrderItemResponse {
    return {
      id: row.id,
      code: row.code,
      branchId: row.branchId,
      branchCode: row.branch.code,
      branchName: row.branch.name,
      supplierId: row.supplierId,
      supplierName: row.supplier?.name ?? null,
      status: row.status,
      totalAmount: row.totalAmount.toFixed(2),
      paidAmount: row.paidAmount.toFixed(2),
      createdByName: row.createdBy.user.fullName,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      items: row.items.map((item) => {
        const lineNet =
          calculateLineSubtotal(
            parseQuantity(item.orderedQty.toString()),
            parseMoney(item.unitCost.toString()),
          ) - parseMoney(item.discount.toString());

        return {
          id: item.id,
          variantId: item.variantId,
          sku: item.variant.sku,
          variantName: item.variant.name,
          unit: item.variant.unit,
          orderedQty: item.orderedQty.toFixed(3),
          receivedQty: item.receivedQty.toFixed(3),
          unitCost: item.unitCost.toFixed(2),
          discount: item.discount.toFixed(2),
          lineTotal: formatMoney(lineNet),
        };
      }),
    };
  }
}
