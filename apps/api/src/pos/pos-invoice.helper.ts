import type { Prisma } from "@prisma/client";
import type { InvoiceReceiptResponse } from "@smart-pos/shared";

export const INVOICE_RECEIPT_SELECT = {
  id: true,
  code: true,
  idempotencyKey: true,
  branchId: true,
  shiftId: true,
  customerId: true,
  cashierMemberId: true,
  status: true,
  subtotal: true,
  discountAmount: true,
  taxAmount: true,
  totalAmount: true,
  paidAmount: true,
  createdAt: true,
  branch: { select: { code: true, name: true } },
  customer: { select: { name: true } },
  cashierMember: { select: { user: { select: { fullName: true } } } },
  items: {
    select: {
      id: true,
      variantId: true,
      productNameSnapshot: true,
      skuSnapshot: true,
      quantity: true,
      returnedQty: true,
      unitPrice: true,
      discountAmount: true,
      taxAmount: true,
      lineTotal: true,
    },
    orderBy: { id: "asc" },
  },
  payments: {
    select: {
      id: true,
      method: true,
      amount: true,
      referenceNo: true,
      paidAt: true,
    },
    orderBy: { paidAt: "asc" },
  },
} satisfies Prisma.InvoiceSelect;

export type InvoiceReceiptRow = Prisma.InvoiceGetPayload<{
  select: typeof INVOICE_RECEIPT_SELECT;
}>;

export function getVietnamBusinessDate(): Date {
  // Store calendar date in Asia/Ho_Chi_Minh (UTC+7) so daily reports align with local shifts.
  const nowVietnam = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const yyyyMmDd = nowVietnam.toISOString().slice(0, 10);
  return new Date(`${yyyyMmDd}T00:00:00.000Z`);
}

export function serializeInvoiceReceipt(
  row: InvoiceReceiptRow,
  changeGiven: string,
  earnedPoints?: number,
): InvoiceReceiptResponse {
  return {
    id: row.id,
    code: row.code,
    idempotencyKey: row.idempotencyKey,
    branchId: row.branchId,
    branchCode: row.branch.code,
    branchName: row.branch.name,
    shiftId: row.shiftId,
    cashierMemberId: row.cashierMemberId,
    cashierName: row.cashierMember.user.fullName,
    customerId: row.customerId ?? null,
    customerName: row.customer?.name ?? null,
    ...(earnedPoints !== undefined ? { earnedPoints } : {}),
    status: row.status,
    subtotal: row.subtotal.toFixed(2),
    discountAmount: row.discountAmount.toFixed(2),
    taxAmount: row.taxAmount.toFixed(2),
    totalAmount: row.totalAmount.toFixed(2),
    paidAmount: row.paidAmount.toFixed(2),
    changeGiven,
    createdAt: row.createdAt.toISOString(),
    items: row.items.map((item) => ({
      id: item.id,
      variantId: item.variantId,
      productName: item.productNameSnapshot,
      sku: item.skuSnapshot,
      quantity: item.quantity.toFixed(3),
      returnedQty: item.returnedQty ? item.returnedQty.toFixed(3) : "0.000",
      unitPrice: item.unitPrice.toFixed(2),
      discountAmount: item.discountAmount.toFixed(2),
      taxAmount: item.taxAmount.toFixed(2),
      lineTotal: item.lineTotal.toFixed(2),
    })),
    payments: row.payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      amount: payment.amount.toFixed(2),
      referenceNo: payment.referenceNo,
      paidAt: payment.paidAt.toISOString(),
    })),
  };
}
