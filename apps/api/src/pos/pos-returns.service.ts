import crypto from "node:crypto";
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
  calculateLoyaltyPointsEarned,
  calculateSalesReturnTotals,
  type CashDrawerOpenInput,
  type CreateSalesReturnInput,
  ERROR_CODES,
  formatMoney,
  formatQuantity,
  type InvoiceDetailResponse,
  type InvoiceReceiptResponse,
  LOYALTY_POINT_VALUE_MINOR,
  parseMoney,
  parseQuantity,
  type Permission,
  PERMISSIONS,
  PosMathError,
  type SalesReturnListQuery,
  type SalesReturnResponse,
  type VoidInvoiceInput,
} from "@smart-pos/shared";
import type { AuthenticatedContext, RequestMeta } from "../auth/auth.types";
import { assertBranchAccessibleInTx } from "../common/tenant/tenant-quota.helper";
import { lockBranchInventoryRow } from "../inventory/inventory-lock.helper";
import { runWithSerializableRetry } from "../prisma/prisma-retry.helper";
import { PrismaService } from "../prisma/prisma.service";
import { PosEventsService } from "./pos-events.service";
import {
  getVietnamBusinessDate,
  INVOICE_RECEIPT_SELECT,
  serializeInvoiceReceipt,
} from "./pos-invoice.helper";
import { PosSupervisorService } from "./pos-supervisor.service";

const SALES_RETURN_SELECT = {
  id: true,
  code: true,
  branchId: true,
  invoiceId: true,
  shiftId: true,
  status: true,
  totalRefundAmount: true,
  refundMethod: true,
  reason: true,
  createdAt: true,
  branch: { select: { name: true } },
  invoice: { select: { code: true, status: true } },
  processedBy: { select: { user: { select: { fullName: true } } } },
  items: {
    select: {
      id: true,
      invoiceItemId: true,
      variantId: true,
      quantity: true,
      refundAmount: true,
      variant: {
        select: {
          sku: true,
          name: true,
          product: { select: { name: true } },
        },
      },
    },
    orderBy: { id: "asc" },
  },
} satisfies Prisma.SalesReturnSelect;

type SalesReturnRow = Prisma.SalesReturnGetPayload<{
  select: typeof SALES_RETURN_SELECT;
}>;

interface StockDeltaPublished {
  variantId: string;
  onHand: string;
  available: string;
}

function generateReturnCode(): string {
  const datePart = new Date(Date.now() + 7 * 60 * 60 * 1000)
    .toISOString()
    .slice(2, 10)
    .replaceAll("-", "");
  const randPart = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `TH-${datePart}-${randPart}`;
}

@Injectable()
export class PosReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posEvents: PosEventsService,
    @Optional() private readonly posSupervisor?: PosSupervisorService,
  ) {}

  async getInvoiceDetail(
    auth: AuthenticatedContext,
    invoiceId: string,
  ): Promise<InvoiceDetailResponse> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId },
        select: INVOICE_RECEIPT_SELECT,
      });
      if (!invoice) {
        throw new NotFoundException({
          code: ERROR_CODES.INVOICE_NOT_FOUND,
          message: "Không tìm thấy hóa đơn",
        });
      }

      await assertBranchAccessibleInTx(tx, auth, invoice.branchId);

      const returns = await tx.salesReturn.findMany({
        where: { invoiceId },
        select: SALES_RETURN_SELECT,
        orderBy: { createdAt: "desc" },
      });

      return {
        ...serializeInvoiceReceipt(invoice, "0.00"),
        salesReturns: returns.map((row) => this.serializeReturn(row)),
      };
    });
  }

  async listReturns(
    auth: AuthenticatedContext,
    query: SalesReturnListQuery,
  ): Promise<{
    items: SalesReturnResponse[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
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
      const where: Prisma.SalesReturnWhereInput = {
        ...(branchFilter !== undefined ? { branchId: branchFilter } : {}),
        ...(query.invoiceId ? { invoiceId: query.invoiceId } : {}),
        ...(searchTerm
          ? {
              OR: [
                { code: { contains: searchTerm, mode: "insensitive" } },
                { invoice: { code: { contains: searchTerm, mode: "insensitive" } } },
              ],
            }
          : {}),
      };

      const skip = (query.page - 1) * query.limit;
      const [total, rows] = await Promise.all([
        tx.salesReturn.count({ where }),
        tx.salesReturn.findMany({
          where,
          select: SALES_RETURN_SELECT,
          orderBy: { createdAt: "desc" },
          skip,
          take: query.limit,
        }),
      ]);

      return {
        items: rows.map((row) => this.serializeReturn(row)),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.limit)),
        },
      };
    });
  }

  async createReturn(
    auth: AuthenticatedContext,
    invoiceId: string,
    input: CreateSalesReturnInput,
    meta: RequestMeta,
  ): Promise<SalesReturnResponse> {
    const outcome = await runWithSerializableRetry(() =>
      this.prisma.withTenantTransaction(
        auth.tenantId,
        async (tx) => {
          const lockedInvoices = await tx.$queryRaw<
            Array<{
              id: string;
              branch_id: string;
              customer_id: string | null;
              code: string;
              status: string;
              total_amount: string;
            }>
          >`
            SELECT
              id,
              branch_id,
              customer_id,
              code,
              status::text AS status,
              total_amount::numeric(15, 2)::text AS total_amount
            FROM invoices
            WHERE id = ${invoiceId}::uuid
              AND tenant_id = ${auth.tenantId}::uuid
            FOR UPDATE
          `;

          const inv = lockedInvoices[0];
          if (!inv) {
            throw new NotFoundException({
              code: ERROR_CODES.INVOICE_NOT_FOUND,
              message: "Không tìm thấy hóa đơn để hoàn trả",
            });
          }

          await assertBranchAccessibleInTx(tx, auth, inv.branch_id);

          const approverMemberId = this.checkPermissionOrApproval(
            auth,
            PERMISSIONS.POS_REFUND,
            inv.branch_id,
            input.supervisorApprovalToken,
            "Bạn không có quyền xử lý trả hàng / hoàn tiền",
          );

          if (inv.status === "VOIDED") {
            throw new ConflictException({
              code: ERROR_CODES.INVOICE_ALREADY_VOIDED,
              message: "Hóa đơn đã bị hủy, không thể tạo phiếu trả hàng",
            });
          }

          const [invoiceItems, priorReturnsAgg, invoicePayments] =
            await Promise.all([
              tx.invoiceItem.findMany({
                where: { invoiceId },
                select: {
                  id: true,
                  variantId: true,
                  quantity: true,
                  returnedQty: true,
                  taxAmount: true,
                  lineTotal: true,
                  unitCostSnapshot: true,
                },
              }),
              tx.salesReturn.aggregate({
                where: { invoiceId, status: "COMPLETED" },
                _sum: { totalRefundAmount: true },
              }),
              tx.invoicePayment.findMany({
                where: { invoiceId },
                select: { method: true, amount: true },
              }),
            ]);

          const itemMap = new Map(invoiceItems.map((it) => [it.id, it]));
          let subtotalAfterLineDiscountAndTaxMinor = 0n;
          for (const it of invoiceItems) {
            subtotalAfterLineDiscountAndTaxMinor += parseMoney(
              it.lineTotal.toString(),
            );
          }

          const priorRefundedMinor = priorReturnsAgg._sum.totalRefundAmount
            ? parseMoney(priorReturnsAgg._sum.totalRefundAmount.toString())
            : 0n;

          let returnTotals;
          try {
            returnTotals = calculateSalesReturnTotals({
              invoiceSubtotalAfterLineDiscountAndTaxMinor:
                subtotalAfterLineDiscountAndTaxMinor,
              invoiceTotalMinor: parseMoney(inv.total_amount),
              priorRefundedTotalMinor: priorRefundedMinor,
              lines: input.items.map((reqItem) => {
                const orig = itemMap.get(reqItem.invoiceItemId);
                if (!orig) {
                  throw new NotFoundException({
                    code: ERROR_CODES.RESOURCE_NOT_FOUND,
                    message: "Dòng hàng cần trả không thuộc hóa đơn này",
                  });
                }
                return {
                  invoiceItemId: reqItem.invoiceItemId,
                  originalQuantity: orig.quantity.toFixed(3),
                  previouslyReturnedQuantity: orig.returnedQty.toFixed(3),
                  returnQuantity: reqItem.quantity,
                  lineTotal: orig.lineTotal.toFixed(2),
                  lineTaxAmount: orig.taxAmount.toFixed(2),
                  unitCostSnapshot: orig.unitCostSnapshot.toFixed(2),
                };
              }),
            });
          } catch (err) {
            if (err instanceof PosMathError) {
              throw new ConflictException({
                code: ERROR_CODES.RETURN_QTY_EXCEEDED,
                message: err.message,
              });
            }
            throw err;
          }

          // Atomic cumulative return guard in ascending invoiceItemId order.
          const computedByItemId = new Map(
            returnTotals.lines.map((l) => [l.invoiceItemId, l]),
          );
          const sortedItemIds = Array.from(computedByItemId.keys()).sort();

          const restockByVariant = new Map<
            string,
            { qtyMilli: bigint; unitCostMinor: bigint }
          >();

          for (const itemId of sortedItemIds) {
            const lineCalc = computedByItemId.get(itemId)!;
            const origItem = itemMap.get(itemId)!;
            const qtyStr = formatQuantity(lineCalc.returnQtyMilli);

            const updatedRows = await tx.$queryRaw<Array<{ id: string }>>`
              UPDATE invoice_items
              SET returned_qty = returned_qty + ${qtyStr}::decimal(15, 3)
              WHERE tenant_id = ${auth.tenantId}::uuid
                AND id = ${itemId}::uuid
                AND invoice_id = ${invoiceId}::uuid
                AND (quantity - returned_qty) >= ${qtyStr}::decimal(15, 3)
              RETURNING id
            `;

            if (updatedRows.length === 0) {
              throw new ConflictException({
                code: ERROR_CODES.RETURN_QTY_EXCEEDED,
                message:
                  "Số lượng hoàn trả vượt quá số lượng còn lại có thể trả trên hóa đơn",
              });
            }

            const existingVariantAgg = restockByVariant.get(origItem.variantId);
            const itemCostMinor = parseMoney(origItem.unitCostSnapshot.toFixed(2));
            if (existingVariantAgg) {
              existingVariantAgg.qtyMilli += lineCalc.returnQtyMilli;
            } else {
              restockByVariant.set(origItem.variantId, {
                qtyMilli: lineCalc.returnQtyMilli,
                unitCostMinor: itemCostMinor,
              });
            }
          }

          // Resolve register shift deduction for cash refunds (keep shiftId optional if already closed).
          let appliedShiftId: string | null = null;
          if (input.refundMethod === "CASH") {
            if (input.shiftId) {
              const lockedShifts = await tx.$queryRaw<
                Array<{ id: string; branch_id: string; status: string }>
              >`
                SELECT id, branch_id, status::text AS status
                FROM register_shifts
                WHERE id = ${input.shiftId}::uuid
                  AND tenant_id = ${auth.tenantId}::uuid
                FOR UPDATE
              `;
              const shift = lockedShifts[0];
              if (!shift || shift.branch_id !== inv.branch_id) {
                throw new NotFoundException({
                  code: ERROR_CODES.SHIFT_NOT_FOUND,
                  message: "Không tìm thấy ca thu ngân tại chi nhánh này",
                });
              }
              if (shift.status !== "OPEN") {
                throw new BadRequestException({
                  code: ERROR_CODES.SHIFT_NOT_OPEN,
                  message: "Ca thu ngân đã đóng, không thể trừ tiền hoàn từ két ca này",
                });
              }
              appliedShiftId = shift.id;
            } else {
              const openShifts = await tx.$queryRaw<Array<{ id: string }>>`
                SELECT id
                FROM register_shifts
                WHERE tenant_id = ${auth.tenantId}::uuid
                  AND branch_id = ${inv.branch_id}::uuid
                  AND status = 'OPEN'
                ORDER BY opened_at DESC
                LIMIT 1
                FOR UPDATE
              `;
              appliedShiftId = openShifts[0]?.id ?? null;
            }
          }

          const returnCode = generateReturnCode();
          const totalRefundStr = formatMoney(returnTotals.totalRefundMinor);

          const createdReturn = await tx.salesReturn.create({
            data: {
              tenantId: auth.tenantId,
              branchId: inv.branch_id,
              invoiceId,
              shiftId: appliedShiftId,
              processedById: auth.memberId,
              code: returnCode,
              status: "COMPLETED",
              totalRefundAmount: totalRefundStr,
              refundMethod: input.refundMethod,
              reason: input.reason,
              items: {
                create: sortedItemIds.map((itemId) => {
                  const orig = itemMap.get(itemId)!;
                  const calc = computedByItemId.get(itemId)!;
                  return {
                    tenantId: auth.tenantId,
                    invoiceItemId: itemId,
                    variantId: orig.variantId,
                    quantity: formatQuantity(calc.returnQtyMilli),
                    refundAmount: formatMoney(calc.refundAmountMinor),
                  };
                }),
              },
            },
            select: SALES_RETURN_SELECT,
          });

          if (appliedShiftId && returnTotals.totalRefundMinor > 0n) {
            await tx.$executeRaw`
              UPDATE register_shifts
              SET expected_cash = expected_cash - ${totalRefundStr}::decimal(15, 2)
              WHERE id = ${appliedShiftId}::uuid
                AND tenant_id = ${auth.tenantId}::uuid
            `;
          }

          // Restock branch_inventories in ascending variantId order and write immutable ledger rows.
          const publishedStock: StockDeltaPublished[] = [];
          const sortedVariantIds = Array.from(restockByVariant.keys()).sort();

          for (const variantId of sortedVariantIds) {
            const agg = restockByVariant.get(variantId)!;
            const lockedInv = await lockBranchInventoryRow(
              tx,
              auth.tenantId,
              inv.branch_id,
              variantId,
            );
            const afterMilli = lockedInv.onHandMilli + agg.qtyMilli;
            const afterStr = formatQuantity(afterMilli);
            const availableStr = formatQuantity(
              afterMilli - lockedInv.reservedMilli,
            );

            await tx.$executeRaw`
              UPDATE branch_inventories
              SET
                on_hand = ${afterStr}::decimal(15, 3),
                updated_at = now()
              WHERE tenant_id = ${auth.tenantId}::uuid
                AND branch_id = ${inv.branch_id}::uuid
                AND variant_id = ${variantId}::uuid
            `;

            await tx.inventoryLedger.create({
              data: {
                tenantId: auth.tenantId,
                branchId: inv.branch_id,
                variantId,
                movementType: "SALE_RETURN",
                qtyDelta: formatQuantity(agg.qtyMilli),
                qtyBefore: formatQuantity(lockedInv.onHandMilli),
                qtyAfter: afterStr,
                unitCost: formatMoney(agg.unitCostMinor),
                referenceType: "sales_return",
                referenceId: createdReturn.id,
                actorMemberId: auth.memberId,
                note: `Khách trả hàng phiếu ${returnCode} (HĐ ${inv.code})`,
              },
            });

            publishedStock.push({
              variantId,
              onHand: afterStr,
              available: availableStr,
            });
          }

          // Update parent invoice status to RETURNED or PARTIAL_RETURNED.
          const remainingRows = await tx.invoiceItem.findMany({
            where: { invoiceId },
            select: { quantity: true, returnedQty: true },
          });
          const allReturned = remainingRows.every(
            (r) =>
              parseQuantity(r.returnedQty.toFixed(3)) >=
              parseQuantity(r.quantity.toFixed(3)),
          );
          const nextInvoiceStatus = allReturned ? "RETURNED" : "PARTIAL_RETURNED";

          await tx.invoice.update({
            where: { id: invoiceId },
            data: { status: nextInvoiceStatus },
          });

          await this.updateDailySummaryOnReversalInTx(tx, {
            tenantId: auth.tenantId,
            branchId: inv.branch_id,
            refundMinor: returnTotals.totalRefundMinor,
            netRevenueReversalMinor: returnTotals.totalNetRevenueReversalMinor,
            cogsReversalMinor: returnTotals.totalCogsReversalMinor,
          });

          if (inv.customer_id && returnTotals.totalRefundMinor > 0n) {
            const totalInvMinor = parseMoney(inv.total_amount);
            let loyaltyPaymentMinor = 0n;
            for (const p of invoicePayments) {
              if (p.method === "LOYALTY_POINTS") {
                loyaltyPaymentMinor += parseMoney(p.amount.toFixed(2));
              }
            }
            const eligiblePaidMinor =
              totalInvMinor > loyaltyPaymentMinor
                ? totalInvMinor - loyaltyPaymentMinor
                : 0n;
            const proportionalCashRatioNum =
              totalInvMinor > 0n
                ? (returnTotals.totalRefundMinor * eligiblePaidMinor) /
                  totalInvMinor
                : 0n;
            const pointsToReverse = calculateLoyaltyPointsEarned(
              proportionalCashRatioNum,
            );

            await tx.$executeRaw`
              UPDATE customers
              SET
                total_spent = GREATEST(0, total_spent - ${totalRefundStr}::decimal(15, 2)),
                loyalty_points = GREATEST(0, loyalty_points - ${pointsToReverse}::int),
                updated_at = now()
              WHERE tenant_id = ${auth.tenantId}::uuid
                AND id = ${inv.customer_id}::uuid
            `;
          }

          await tx.auditLog.create({
            data: {
              tenantId: auth.tenantId,
              branchId: inv.branch_id,
              actorMemberId: auth.memberId,
              action: "REFUND",
              entityType: "sales_return",
              entityId: createdReturn.id,
              ipAddress: meta.ipAddress ?? null,
              metadata: {
                returnCode,
                invoiceId,
                invoiceCode: inv.code,
                totalRefundAmount: totalRefundStr,
                refundMethod: input.refundMethod,
                reason: input.reason,
                ...(approverMemberId ? { approvedByMemberId: approverMemberId } : {}),
              },
            },
          });

          return {
            response: {
              ...this.serializeReturn(createdReturn),
              invoiceStatus: nextInvoiceStatus,
            },
            branchId: inv.branch_id,
            publishedStock,
          };
        },
        { isolationLevel: "RepeatableRead" },
      ),
    );

    if (outcome.publishedStock.length > 0) {
      await this.posEvents.publishStockUpdate(
        auth.tenantId,
        outcome.branchId,
        outcome.publishedStock,
      );
    }

    return outcome.response;
  }

  async voidInvoice(
    auth: AuthenticatedContext,
    invoiceId: string,
    input: VoidInvoiceInput,
    meta: RequestMeta,
  ): Promise<InvoiceReceiptResponse> {
    const outcome = await runWithSerializableRetry(() =>
      this.prisma.withTenantTransaction(
        auth.tenantId,
        async (tx) => {
          const lockedInvoices = await tx.$queryRaw<
            Array<{
              id: string;
              branch_id: string;
              shift_id: string | null;
              customer_id: string | null;
              code: string;
              status: string;
              total_amount: string;
              tax_amount: string;
              cogs_amount: string;
            }>
          >`
            SELECT
              id,
              branch_id,
              shift_id,
              customer_id,
              code,
              status::text AS status,
              total_amount::numeric(15, 2)::text AS total_amount,
              tax_amount::numeric(15, 2)::text AS tax_amount,
              cogs_amount::numeric(15, 2)::text AS cogs_amount
            FROM invoices
            WHERE id = ${invoiceId}::uuid
              AND tenant_id = ${auth.tenantId}::uuid
            FOR UPDATE
          `;

          const inv = lockedInvoices[0];
          if (!inv) {
            throw new NotFoundException({
              code: ERROR_CODES.INVOICE_NOT_FOUND,
              message: "Không tìm thấy hóa đơn cần hủy",
            });
          }

          await assertBranchAccessibleInTx(tx, auth, inv.branch_id);

          const approverMemberId = this.checkPermissionOrApproval(
            auth,
            PERMISSIONS.POS_REFUND,
            inv.branch_id,
            input.supervisorApprovalToken,
            "Bạn không có quyền hủy hóa đơn đã thanh toán",
          );

          if (inv.status === "VOIDED") {
            throw new ConflictException({
              code: ERROR_CODES.INVOICE_ALREADY_VOIDED,
              message: "Hóa đơn này đã bị hủy trước đó",
            });
          }

          if (
            inv.status === "PARTIAL_RETURNED" ||
            inv.status === "RETURNED"
          ) {
            throw new ConflictException({
              code: ERROR_CODES.INVOICE_HAS_RETURNS,
              message:
                "Hóa đơn đã phát sinh phiếu trả hàng, không thể hủy toàn bộ",
            });
          }

          const existingReturnCount = await tx.salesReturn.count({
            where: { invoiceId, status: "COMPLETED" },
          });
          if (existingReturnCount > 0) {
            throw new ConflictException({
              code: ERROR_CODES.INVOICE_HAS_RETURNS,
              message:
                "Hóa đơn đã phát sinh phiếu trả hàng, không thể hủy toàn bộ",
            });
          }

          const [invoiceItems, invoicePayments] = await Promise.all([
            tx.invoiceItem.findMany({
              where: { invoiceId },
              select: {
                variantId: true,
                quantity: true,
                unitCostSnapshot: true,
              },
            }),
            tx.invoicePayment.findMany({
              where: { invoiceId },
              select: { method: true, amount: true },
            }),
          ]);

          const restockByVariant = new Map<
            string,
            { qtyMilli: bigint; unitCostMinor: bigint }
          >();
          for (const item of invoiceItems) {
            const qtyMilli = parseQuantity(item.quantity.toFixed(3));
            const costMinor = parseMoney(item.unitCostSnapshot.toFixed(2));
            const curr = restockByVariant.get(item.variantId);
            if (curr) {
              curr.qtyMilli += qtyMilli;
            } else {
              restockByVariant.set(item.variantId, {
                qtyMilli,
                unitCostMinor: costMinor,
              });
            }
          }

          const publishedStock: StockDeltaPublished[] = [];
          const sortedVariantIds = Array.from(restockByVariant.keys()).sort();

          for (const variantId of sortedVariantIds) {
            const agg = restockByVariant.get(variantId)!;
            const lockedInv = await lockBranchInventoryRow(
              tx,
              auth.tenantId,
              inv.branch_id,
              variantId,
            );
            const afterMilli = lockedInv.onHandMilli + agg.qtyMilli;
            const afterStr = formatQuantity(afterMilli);
            const availableStr = formatQuantity(
              afterMilli - lockedInv.reservedMilli,
            );

            await tx.$executeRaw`
              UPDATE branch_inventories
              SET
                on_hand = ${afterStr}::decimal(15, 3),
                updated_at = now()
              WHERE tenant_id = ${auth.tenantId}::uuid
                AND branch_id = ${inv.branch_id}::uuid
                AND variant_id = ${variantId}::uuid
            `;

            await tx.inventoryLedger.create({
              data: {
                tenantId: auth.tenantId,
                branchId: inv.branch_id,
                variantId,
                movementType: "SALE_RETURN",
                qtyDelta: formatQuantity(agg.qtyMilli),
                qtyBefore: formatQuantity(lockedInv.onHandMilli),
                qtyAfter: afterStr,
                unitCost: formatMoney(agg.unitCostMinor),
                referenceType: "invoice",
                referenceId: invoiceId,
                actorMemberId: auth.memberId,
                note: `Hủy hóa đơn ${inv.code}: ${input.reason}`,
              },
            });

            publishedStock.push({
              variantId,
              onHand: afterStr,
              available: availableStr,
            });
          }

          const voidedRow = await tx.invoice.update({
            where: { id: invoiceId },
            data: { status: "VOIDED" },
            select: INVOICE_RECEIPT_SELECT,
          });

          let cashPaidMinor = 0n;
          let loyaltyPaidMinor = 0n;
          for (const p of invoicePayments) {
            const amtMinor = parseMoney(p.amount.toFixed(2));
            if (p.method === "CASH") cashPaidMinor += amtMinor;
            if (p.method === "LOYALTY_POINTS") loyaltyPaidMinor += amtMinor;
          }

          if (cashPaidMinor > 0n && inv.shift_id) {
            const lockedShifts = await tx.$queryRaw<
              Array<{ id: string; status: string }>
            >`
              SELECT id, status::text AS status
              FROM register_shifts
              WHERE id = ${inv.shift_id}::uuid
                AND tenant_id = ${auth.tenantId}::uuid
              FOR UPDATE
            `;
            if (lockedShifts[0]?.status === "OPEN") {
              await tx.$executeRaw`
                UPDATE register_shifts
                SET expected_cash = expected_cash - ${formatMoney(cashPaidMinor)}::decimal(15, 2)
                WHERE id = ${inv.shift_id}::uuid
                  AND tenant_id = ${auth.tenantId}::uuid
              `;
            }
          }

          const totalInvMinor = parseMoney(inv.total_amount);
          const taxInvMinor = parseMoney(inv.tax_amount);
          const cogsInvMinor = parseMoney(inv.cogs_amount);
          const netInvMinor = totalInvMinor - taxInvMinor;

          await this.updateDailySummaryOnReversalInTx(tx, {
            tenantId: auth.tenantId,
            branchId: inv.branch_id,
            refundMinor: totalInvMinor,
            netRevenueReversalMinor: netInvMinor,
            cogsReversalMinor: cogsInvMinor,
          });

          if (inv.customer_id) {
            const redeemedPoints = Number(
              loyaltyPaidMinor / LOYALTY_POINT_VALUE_MINOR,
            );
            const eligiblePaidMinor =
              totalInvMinor > loyaltyPaidMinor
                ? totalInvMinor - loyaltyPaidMinor
                : 0n;
            const earnedPoints = calculateLoyaltyPointsEarned(eligiblePaidMinor);
            const netPointsDelta = redeemedPoints - earnedPoints;

            await tx.$executeRaw`
              UPDATE customers
              SET
                loyalty_points = GREATEST(0, loyalty_points + ${netPointsDelta}::int),
                total_spent = GREATEST(0, total_spent - ${inv.total_amount}::decimal(15, 2)),
                updated_at = now()
              WHERE tenant_id = ${auth.tenantId}::uuid
                AND id = ${inv.customer_id}::uuid
            `;
          }

          await tx.auditLog.create({
            data: {
              tenantId: auth.tenantId,
              branchId: inv.branch_id,
              actorMemberId: auth.memberId,
              action: "INVOICE_VOID",
              entityType: "invoice",
              entityId: invoiceId,
              ipAddress: meta.ipAddress ?? null,
              metadata: {
                invoiceCode: inv.code,
                totalAmount: inv.total_amount,
                reason: input.reason,
                ...(approverMemberId ? { approvedByMemberId: approverMemberId } : {}),
              },
            },
          });

          return {
            receipt: serializeInvoiceReceipt(voidedRow, "0.00"),
            branchId: inv.branch_id,
            publishedStock,
          };
        },
        { isolationLevel: "RepeatableRead" },
      ),
    );

    if (outcome.publishedStock.length > 0) {
      await this.posEvents.publishStockUpdate(
        auth.tenantId,
        outcome.branchId,
        outcome.publishedStock,
      );
    }

    return outcome.receipt;
  }

  async openCashDrawer(
    auth: AuthenticatedContext,
    input: CashDrawerOpenInput,
    meta: RequestMeta,
  ): Promise<{ ok: true }> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      await assertBranchAccessibleInTx(tx, auth, input.branchId);
      const approverMemberId = this.checkPermissionOrApproval(
        auth,
        PERMISSIONS.POS_SHIFT_MANAGE,
        input.branchId,
        input.supervisorApprovalToken,
        "Bạn không có quyền mở két tiền thủ công",
      );

      await tx.auditLog.create({
        data: {
          tenantId: auth.tenantId,
          branchId: input.branchId,
          actorMemberId: auth.memberId,
          action: "CASH_DRAWER_OPEN",
          entityType: "branch",
          entityId: input.branchId,
          ipAddress: meta.ipAddress ?? null,
          metadata: {
            reason: input.reason,
            ...(approverMemberId ? { approvedByMemberId: approverMemberId } : {}),
          },
        },
      });

      return { ok: true };
    });
  }

  private async updateDailySummaryOnReversalInTx(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      branchId: string;
      refundMinor: bigint;
      netRevenueReversalMinor: bigint;
      cogsReversalMinor: bigint;
    },
  ): Promise<void> {
    const businessDate = getVietnamBusinessDate();
    const refundStr = formatMoney(params.refundMinor);
    const negNetStr = formatMoney(-params.netRevenueReversalMinor);
    const negCogsStr = formatMoney(-params.cogsReversalMinor);
    const negProfitStr = formatMoney(
      -(params.netRevenueReversalMinor - params.cogsReversalMinor),
    );

    await tx.$executeRaw`
      INSERT INTO daily_branch_summaries (
        id, tenant_id, branch_id, summary_date,
        invoice_count, gross_revenue, discount_total, net_revenue,
        cogs_total, gross_profit, refund_total,
        cash_total, transfer_total, card_total, updated_at
      ) VALUES (
        ${crypto.randomUUID()}::uuid,
        ${params.tenantId}::uuid,
        ${params.branchId}::uuid,
        ${businessDate}::date,
        0,
        0.00,
        0.00,
        ${negNetStr}::decimal(15, 2),
        ${negCogsStr}::decimal(15, 2),
        ${negProfitStr}::decimal(15, 2),
        ${refundStr}::decimal(15, 2),
        0.00,
        0.00,
        0.00,
        now()
      )
      ON CONFLICT (tenant_id, branch_id, summary_date)
      DO UPDATE SET
        refund_total = daily_branch_summaries.refund_total + EXCLUDED.refund_total,
        net_revenue = daily_branch_summaries.net_revenue + EXCLUDED.net_revenue,
        cogs_total = daily_branch_summaries.cogs_total + EXCLUDED.cogs_total,
        gross_profit = daily_branch_summaries.gross_profit + EXCLUDED.gross_profit,
        updated_at = now()
    `;
  }

  private checkPermissionOrApproval(
    auth: AuthenticatedContext,
    permission: Permission,
    branchId: string,
    supervisorApprovalToken: string | undefined,
    forbiddenMessage: string,
  ): string | null {
    if (this.posSupervisor) {
      return this.posSupervisor.resolvePermissionOrApproval(
        auth,
        permission,
        branchId,
        supervisorApprovalToken,
        forbiddenMessage,
      ).approvedByMemberId;
    }

    if (!auth.effectivePermissions.has(permission)) {
      throw new ForbiddenException({
        code: ERROR_CODES.AUTH_FORBIDDEN,
        message: forbiddenMessage,
      });
    }
    return null;
  }

  private serializeReturn(row: SalesReturnRow): SalesReturnResponse {
    return {
      id: row.id,
      code: row.code,
      branchId: row.branchId,
      branchName: row.branch.name,
      invoiceId: row.invoiceId,
      invoiceCode: row.invoice.code,
      invoiceStatus: row.invoice.status,
      shiftId: row.shiftId,
      processedByName: row.processedBy.user.fullName,
      status: row.status,
      totalRefundAmount: row.totalRefundAmount.toFixed(2),
      refundMethod: row.refundMethod,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
      items: row.items.map((item) => ({
        id: item.id,
        invoiceItemId: item.invoiceItemId,
        variantId: item.variantId,
        sku: item.variant.sku,
        productName: `${item.variant.product.name} - ${item.variant.name}`,
        quantity: item.quantity.toFixed(3),
        refundAmount: item.refundAmount.toFixed(2),
      })),
    };
  }
}
