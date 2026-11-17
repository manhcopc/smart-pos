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
  calculateLineSubtotal,
  calculateLoyaltyPointsEarned,
  calculateLoyaltyPointsRequired,
  calculatePosInvoiceTotals,
  type CreateInvoiceInput,
  ERROR_CODES,
  formatMoney,
  formatQuantity,
  type InvoiceListQuery,
  type InvoiceReceiptResponse,
  parseMoney,
  parseQuantity,
  PAYMENT_METHODS,
  type Permission,
  PERMISSIONS,
  PosMathError,
} from "@smart-pos/shared";
import type { AuthenticatedContext, RequestMeta } from "../auth/auth.types";
import { assertBranchAccessibleInTx } from "../common/tenant/tenant-quota.helper";
import { runWithSerializableRetry } from "../prisma/prisma-retry.helper";
import { PrismaService } from "../prisma/prisma.service";
import { PosEventsService } from "./pos-events.service";
import {
  getVietnamBusinessDate,
  INVOICE_RECEIPT_SELECT,
  serializeInvoiceReceipt,
} from "./pos-invoice.helper";
import { PosSupervisorService } from "./pos-supervisor.service";

interface StockDeltaPublished {
  variantId: string;
  onHand: string;
  available: string;
}

function generateInvoiceCode(): string {
  const datePart = new Date(Date.now() + 7 * 60 * 60 * 1000)
    .toISOString()
    .slice(2, 10)
    .replaceAll("-", "");
  const randPart = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `HD-${datePart}-${randPart}`;
}

@Injectable()
export class PosCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posEvents: PosEventsService,
    @Optional() private readonly posSupervisor?: PosSupervisorService,
  ) {}

  async listInvoices(
    auth: AuthenticatedContext,
    query: InvoiceListQuery,
  ): Promise<{
    items: InvoiceReceiptResponse[];
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
      const where: Prisma.InvoiceWhereInput = {
        ...(branchFilter !== undefined ? { branchId: branchFilter } : {}),
        ...(query.shiftId ? { shiftId: query.shiftId } : {}),
        ...(searchTerm
          ? { code: { contains: searchTerm, mode: "insensitive" } }
          : {}),
      };

      const skip = (query.page - 1) * query.limit;
      const [total, rows] = await Promise.all([
        tx.invoice.count({ where }),
        tx.invoice.findMany({
          where,
          select: INVOICE_RECEIPT_SELECT,
          orderBy: { createdAt: "desc" },
          skip,
          take: query.limit,
        }),
      ]);

      return {
        items: rows.map((row) => serializeInvoiceReceipt(row, "0.00")),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.limit)),
        },
      };
    });
  }

  async checkout(
    auth: AuthenticatedContext,
    input: CreateInvoiceInput,
    meta: RequestMeta,
  ): Promise<InvoiceReceiptResponse> {
    type CheckoutTxOutcome = {
      receipt: InvoiceReceiptResponse;
      publishedStock: StockDeltaPublished[];
      isIdempotentReplay: boolean;
    };

    let outcome: CheckoutTxOutcome;
    try {
      outcome = await runWithSerializableRetry(() =>
        this.prisma.withTenantTransaction<CheckoutTxOutcome>(
          auth.tenantId,
          async (tx) => {
          const existing = await tx.invoice.findFirst({
            where: { idempotencyKey: input.idempotencyKey },
            select: INVOICE_RECEIPT_SELECT,
          });

          if (existing) {
            return {
              receipt: serializeInvoiceReceipt(existing, "0.00"),
              publishedStock: [],
              isIdempotentReplay: true,
            };
          }

          await assertBranchAccessibleInTx(tx, auth, input.branchId);

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
          if (!shift || shift.branch_id !== input.branchId) {
            throw new NotFoundException({
              code: ERROR_CODES.SHIFT_NOT_FOUND,
              message: "Không tìm thấy ca thu ngân tại chi nhánh này",
            });
          }

          if (shift.status !== "OPEN") {
            throw new BadRequestException({
              code: ERROR_CODES.SHIFT_NOT_OPEN,
              message: "Ca thu ngân đã đóng, vui lòng mở ca mới để bán hàng",
            });
          }

          if (input.customerId) {
            const customer = await tx.customer.findFirst({
              where: { id: input.customerId },
              select: { id: true },
            });
            if (!customer) {
              throw new NotFoundException({
                code: ERROR_CODES.RESOURCE_NOT_FOUND,
                message: "Không tìm thấy hồ sơ khách hàng",
              });
            }
          }

          const uniqueVariantIds = Array.from(
            new Set(input.items.map((item) => item.variantId)),
          );
          const variants = await tx.productVariant.findMany({
            where: {
              id: { in: uniqueVariantIds },
              isActive: true,
              product: { isActive: true },
            },
            select: {
              id: true,
              sku: true,
              name: true,
              costPrice: true,
              salePrice: true,
              taxRate: true,
              product: { select: { name: true } },
            },
          });

          const variantMap = new Map(variants.map((v) => [v.id, v]));
          if (variantMap.size !== uniqueVariantIds.length) {
            throw new BadRequestException({
              code: ERROR_CODES.PRODUCT_NOT_FOUND,
              message: "Một hoặc nhiều sản phẩm đã ngưng bán hoặc không tồn tại",
            });
          }

          let usedPriceOverride = false;
          let usedDiscountOverride = parseMoney(input.discountAmount) > 0n;

          const resolvedLineInputs = input.items.map((item) => {
            const variant = variantMap.get(item.variantId)!;
            const catalogPriceMinor = parseMoney(variant.salePrice.toString());
            const effectiveUnitPriceStr =
              item.overrideUnitPrice ?? variant.salePrice.toFixed(2);
            if (parseMoney(effectiveUnitPriceStr) !== catalogPriceMinor) {
              usedPriceOverride = true;
            }
            if (parseMoney(item.discountAmount) > 0n) {
              usedDiscountOverride = true;
            }
            return {
              item,
              variant,
              effectiveUnitPriceStr,
              taxRateStr: variant.taxRate.toFixed(2),
            };
          });

          let priceOverrideApproverId: string | null = null;
          if (usedPriceOverride) {
            priceOverrideApproverId = this.checkPermissionOrApproval(
              auth,
              PERMISSIONS.POS_PRICE_OVERRIDE,
              input.branchId,
              input.supervisorApprovalToken,
              "Bạn không có quyền sửa giá bán tại quầy",
            );
          }

          let discountOverrideApproverId: string | null = null;
          if (usedDiscountOverride) {
            discountOverrideApproverId = this.checkPermissionOrApproval(
              auth,
              PERMISSIONS.POS_DISCOUNT_OVERRIDE,
              input.branchId,
              input.supervisorApprovalToken,
              "Bạn không có quyền áp dụng chiết khấu tại quầy",
            );
          }

          let totals;
          let redeemedPoints = 0;
          let earnedPoints = 0;
          try {
            totals = calculatePosInvoiceTotals({
              lines: resolvedLineInputs.map((entry) => ({
                quantity: entry.item.quantity,
                unitPrice: entry.effectiveUnitPriceStr,
                discountAmount: entry.item.discountAmount,
                taxRate: entry.taxRateStr,
              })),
              invoiceDiscountAmount: input.discountAmount,
              payments: input.payments.map((p) => ({
                method: p.method,
                amount: p.amount,
              })),
            });

            const loyaltyPaidMinor = totals.settledByMethodMinor.LOYALTY_POINTS;
            if (loyaltyPaidMinor > 0n) {
              if (!input.customerId) {
                throw new BadRequestException({
                  code: ERROR_CODES.VALIDATION_ERROR,
                  message:
                    "Vui lòng chọn hồ sơ khách hàng khi thanh toán bằng điểm thưởng",
                });
              }
              redeemedPoints = calculateLoyaltyPointsRequired(loyaltyPaidMinor);
            }
          } catch (err) {
            if (err instanceof PosMathError) {
              const code =
                err.code === "PAYMENT_UNDERPAID" ||
                err.code === "NON_CASH_OVERPAYMENT"
                  ? ERROR_CODES.PAYMENT_MISMATCH
                  : ERROR_CODES.VALIDATION_ERROR;
              throw new BadRequestException({ code, message: err.message });
            }
            throw err;
          }

          if (input.customerId && redeemedPoints > 0) {
            const deductedCustomer = await tx.$queryRaw<
              Array<{ loyalty_points: number }>
            >`
              UPDATE customers
              SET
                loyalty_points = loyalty_points - ${redeemedPoints}::int,
                updated_at = now()
              WHERE tenant_id = ${auth.tenantId}::uuid
                AND id = ${input.customerId}::uuid
                AND loyalty_points >= ${redeemedPoints}::int
              RETURNING loyalty_points
            `;
            if (deductedCustomer.length === 0) {
              throw new ConflictException({
                code: ERROR_CODES.INSUFFICIENT_LOYALTY_POINTS,
                message: "Điểm thưởng của khách hàng không đủ để thanh toán",
              });
            }
          }

          if (input.customerId) {
            const eligiblePaidMinor =
              totals.totalAmountMinor -
              totals.settledByMethodMinor.LOYALTY_POINTS;
            earnedPoints = calculateLoyaltyPointsEarned(eligiblePaidMinor);
          }

          // Aggregate stock quantities per SKU and lock/deduct in ascending variantId order.
          const totalQtyByVariant = new Map<string, bigint>();
          for (const entry of resolvedLineInputs) {
            const qtyMilli = parseQuantity(entry.item.quantity);
            totalQtyByVariant.set(
              entry.variant.id,
              (totalQtyByVariant.get(entry.variant.id) ?? 0n) + qtyMilli,
            );
          }

          const sortedVariantIds = Array.from(totalQtyByVariant.keys()).sort();
          const unitCostByVariant = new Map<string, bigint>();
          const stockSnapshotAfter = new Map<
            string,
            { qtyBeforeStr: string; qtyAfterStr: string; availableStr: string }
          >();

          for (const variantId of sortedVariantIds) {
            const neededMilli = totalQtyByVariant.get(variantId)!;
            const neededStr = formatQuantity(neededMilli);

            const deducted = await tx.$queryRaw<
              Array<{ on_hand: string; reserved: string; avg_cost: string }>
            >`
              UPDATE branch_inventories
              SET
                on_hand = on_hand - ${neededStr}::decimal(15, 3),
                updated_at = now()
              WHERE tenant_id = ${auth.tenantId}::uuid
                AND branch_id = ${input.branchId}::uuid
                AND variant_id = ${variantId}::uuid
                AND (on_hand - reserved) >= ${neededStr}::decimal(15, 3)
              RETURNING
                on_hand::numeric(15, 3)::text AS on_hand,
                reserved::numeric(15, 3)::text AS reserved,
                avg_cost::numeric(15, 2)::text AS avg_cost
            `;

            const updated = deducted[0];
            const variant = variantMap.get(variantId)!;

            if (!updated) {
              throw new ConflictException({
                code: ERROR_CODES.INSUFFICIENT_STOCK,
                message: `SKU "${variant.sku}" không đủ tồn kho khả dụng tại chi nhánh`,
              });
            }

            const onHandAfterMilli = parseQuantity(updated.on_hand);
            const reservedMilli = parseQuantity(updated.reserved);
            const onHandBeforeMilli = onHandAfterMilli + neededMilli;

            const avgCostMinor = parseMoney(updated.avg_cost);
            const catalogCostMinor = parseMoney(variant.costPrice.toString());
            const unitCostMinor =
              avgCostMinor > 0n ? avgCostMinor : catalogCostMinor;

            unitCostByVariant.set(variantId, unitCostMinor);
            stockSnapshotAfter.set(variantId, {
              qtyBeforeStr: formatQuantity(onHandBeforeMilli),
              qtyAfterStr: updated.on_hand,
              availableStr: formatQuantity(onHandAfterMilli - reservedMilli),
            });
          }

          let totalCogsMinor = 0n;
          const invoiceItemsData = resolvedLineInputs.map((entry, idx) => {
            const calcLine = totals.lines[idx]!;
            const unitCostMinor = unitCostByVariant.get(entry.variant.id)!;
            const lineCogsMinor = calculateLineSubtotal(
              calcLine.quantityMilli,
              unitCostMinor,
            );
            totalCogsMinor += lineCogsMinor;

            return {
              tenantId: auth.tenantId,
              variantId: entry.variant.id,
              productNameSnapshot: `${entry.variant.product.name} - ${entry.variant.name}`,
              skuSnapshot: entry.variant.sku,
              quantity: formatQuantity(calcLine.quantityMilli),
              unitPrice: formatMoney(calcLine.unitPriceMinor),
              discountAmount: formatMoney(calcLine.discountMinor),
              taxAmount: formatMoney(calcLine.taxMinor),
              lineTotal: formatMoney(calcLine.lineTotalMinor),
              unitCostSnapshot: formatMoney(unitCostMinor),
              returnedQty: "0.000",
            };
          });

          // Persist settled payment legs so SUM(payments.amount) === invoice.totalAmount.
          const paymentLegsData: Array<{
            tenantId: string;
            method: (typeof PAYMENT_METHODS)[number];
            amount: string;
            referenceNo: string | null;
          }> = [];

          let remainingCashToRecord = totals.netCashReceivedMinor;
          for (const leg of input.payments) {
            if (leg.method === "CASH") {
              if (remainingCashToRecord <= 0n) continue;
              const legMinor = parseMoney(leg.amount);
              const recordedMinor =
                legMinor < remainingCashToRecord
                  ? legMinor
                  : remainingCashToRecord;
              remainingCashToRecord -= recordedMinor;
              if (recordedMinor > 0n || totals.totalAmountMinor === 0n) {
                paymentLegsData.push({
                  tenantId: auth.tenantId,
                  method: "CASH",
                  amount: formatMoney(recordedMinor),
                  referenceNo: leg.referenceNo ?? null,
                });
                if (totals.totalAmountMinor === 0n) break;
              }
            } else {
              const legMinor = parseMoney(leg.amount);
              if (legMinor > 0n) {
                paymentLegsData.push({
                  tenantId: auth.tenantId,
                  method: leg.method,
                  amount: formatMoney(legMinor),
                  referenceNo: leg.referenceNo ?? null,
                });
              }
            }
          }

          if (paymentLegsData.length === 0) {
            paymentLegsData.push({
              tenantId: auth.tenantId,
              method: "CASH",
              amount: "0.00",
              referenceNo: null,
            });
          }

          const invoiceCode = generateInvoiceCode();
          const createdInvoice = await tx.invoice.create({
            data: {
              tenantId: auth.tenantId,
              branchId: input.branchId,
              shiftId: input.shiftId,
              customerId: input.customerId ?? null,
              cashierMemberId: auth.memberId,
              code: invoiceCode,
              idempotencyKey: input.idempotencyKey,
              status: "COMPLETED",
              subtotal: totals.formatted.subtotal,
              discountAmount: totals.formatted.discountAmount,
              taxAmount: totals.formatted.taxAmount,
              totalAmount: totals.formatted.totalAmount,
              paidAmount: totals.formatted.totalAmount,
              cogsAmount: formatMoney(totalCogsMinor),
              syncSource: input.syncSource,
              items: { create: invoiceItemsData },
              payments: { create: paymentLegsData },
            },
            select: INVOICE_RECEIPT_SELECT,
          });

          const publishedStock: StockDeltaPublished[] = [];
          for (const variantId of sortedVariantIds) {
            const neededMilli = totalQtyByVariant.get(variantId)!;
            const snapshot = stockSnapshotAfter.get(variantId)!;
            const unitCostMinor = unitCostByVariant.get(variantId)!;

            await tx.inventoryLedger.create({
              data: {
                tenantId: auth.tenantId,
                branchId: input.branchId,
                variantId,
                movementType: "SALE",
                qtyDelta: formatQuantity(-neededMilli),
                qtyBefore: snapshot.qtyBeforeStr,
                qtyAfter: snapshot.qtyAfterStr,
                unitCost: formatMoney(unitCostMinor),
                referenceType: "invoice",
                referenceId: createdInvoice.id,
                actorMemberId: auth.memberId,
                note: `Bán hàng hóa đơn ${invoiceCode}`,
              },
            });

            publishedStock.push({
              variantId,
              onHand: snapshot.qtyAfterStr,
              available: snapshot.availableStr,
            });
          }

          if (totals.netCashReceivedMinor > 0n) {
            const cashDeltaStr = totals.formatted.netCashReceived;
            await tx.$executeRaw`
              UPDATE register_shifts
              SET expected_cash = expected_cash + ${cashDeltaStr}::decimal(15, 2)
              WHERE id = ${input.shiftId}::uuid
                AND tenant_id = ${auth.tenantId}::uuid
            `;
          }

          const netRevenueMinor =
            totals.totalAmountMinor - totals.taxTotalMinor;
          const grossProfitMinor = netRevenueMinor - totalCogsMinor;
          const businessDate = getVietnamBusinessDate();

          await tx.$executeRaw`
            INSERT INTO daily_branch_summaries (
              id, tenant_id, branch_id, summary_date,
              invoice_count, gross_revenue, discount_total, net_revenue,
              cogs_total, gross_profit, refund_total,
              cash_total, transfer_total, card_total, updated_at
            ) VALUES (
              ${crypto.randomUUID()}::uuid,
              ${auth.tenantId}::uuid,
              ${input.branchId}::uuid,
              ${businessDate}::date,
              1,
              ${totals.formatted.subtotal}::decimal(15, 2),
              ${totals.formatted.discountAmount}::decimal(15, 2),
              ${formatMoney(netRevenueMinor)}::decimal(15, 2),
              ${formatMoney(totalCogsMinor)}::decimal(15, 2),
              ${formatMoney(grossProfitMinor)}::decimal(15, 2),
              0.00,
              ${formatMoney(totals.settledByMethodMinor.CASH)}::decimal(15, 2),
              ${formatMoney(totals.settledByMethodMinor.BANK_TRANSFER_QR)}::decimal(15, 2),
              ${formatMoney(totals.settledByMethodMinor.CARD)}::decimal(15, 2),
              now()
            )
            ON CONFLICT (tenant_id, branch_id, summary_date)
            DO UPDATE SET
              invoice_count = daily_branch_summaries.invoice_count + 1,
              gross_revenue = daily_branch_summaries.gross_revenue + EXCLUDED.gross_revenue,
              discount_total = daily_branch_summaries.discount_total + EXCLUDED.discount_total,
              net_revenue = daily_branch_summaries.net_revenue + EXCLUDED.net_revenue,
              cogs_total = daily_branch_summaries.cogs_total + EXCLUDED.cogs_total,
              gross_profit = daily_branch_summaries.gross_profit + EXCLUDED.gross_profit,
              cash_total = daily_branch_summaries.cash_total + EXCLUDED.cash_total,
              transfer_total = daily_branch_summaries.transfer_total + EXCLUDED.transfer_total,
              card_total = daily_branch_summaries.card_total + EXCLUDED.card_total,
              updated_at = now()
          `;

          if (input.customerId) {
            await tx.$executeRaw`
              UPDATE customers
              SET
                loyalty_points = loyalty_points + ${earnedPoints}::int,
                total_spent = total_spent + ${totals.formatted.totalAmount}::decimal(15, 2),
                updated_at = now()
              WHERE tenant_id = ${auth.tenantId}::uuid
                AND id = ${input.customerId}::uuid
            `;
          }

          if (usedPriceOverride) {
            await tx.auditLog.create({
              data: {
                tenantId: auth.tenantId,
                branchId: input.branchId,
                actorMemberId: auth.memberId,
                action: "PRICE_OVERRIDE",
                entityType: "invoice",
                entityId: createdInvoice.id,
                ipAddress: meta.ipAddress ?? null,
                metadata: {
                  invoiceCode,
                  totalAmount: totals.formatted.totalAmount,
                  ...(priceOverrideApproverId
                    ? { approvedByMemberId: priceOverrideApproverId }
                    : {}),
                },
              },
            });
          }

          if (usedDiscountOverride) {
            await tx.auditLog.create({
              data: {
                tenantId: auth.tenantId,
                branchId: input.branchId,
                actorMemberId: auth.memberId,
                action: "DISCOUNT_OVERRIDE",
                entityType: "invoice",
                entityId: createdInvoice.id,
                ipAddress: meta.ipAddress ?? null,
                metadata: {
                  invoiceCode,
                  discountAmount: totals.formatted.discountAmount,
                  ...(discountOverrideApproverId
                    ? { approvedByMemberId: discountOverrideApproverId }
                    : {}),
                },
              },
            });
          }

          return {
            receipt: serializeInvoiceReceipt(
              createdInvoice,
              totals.formatted.changeDue,
              earnedPoints,
            ),
            publishedStock,
            isIdempotentReplay: false,
          };
          },
          { isolationLevel: "RepeatableRead" },
        ),
      );
    } catch (error) {
      if (this.isIdempotencyKeyConflict(error)) {
        const replay = await this.prisma.withTenantTransaction(
          auth.tenantId,
          (tx) =>
            tx.invoice.findFirst({
              where: { idempotencyKey: input.idempotencyKey },
              select: INVOICE_RECEIPT_SELECT,
            }),
        );
        if (replay) {
          return serializeInvoiceReceipt(replay, "0.00");
        }
      }
      throw error;
    }

    if (!outcome.isIdempotentReplay && outcome.publishedStock.length > 0) {
      // Broadcast stock changes over Redis Pub/Sub -> SSE strictly AFTER DB commit.
      await this.posEvents.publishStockUpdate(
        auth.tenantId,
        input.branchId,
        outcome.publishedStock,
      );
    }

    return outcome.receipt;
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

  private isIdempotencyKeyConflict(error: unknown): boolean {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      (error as { code?: unknown }).code !== "P2002"
    ) {
      return false;
    }
    const meta = (error as { meta?: { target?: unknown } }).meta;
    const target = Array.isArray(meta?.target)
      ? meta.target.join(",")
      : String(meta?.target ?? "");
    return target.toLowerCase().includes("idempotency");
  }
}
