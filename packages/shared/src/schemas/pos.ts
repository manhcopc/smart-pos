import { z } from "zod";
import {
  nonNegativeMoneySchema,
  paginationQuerySchema,
  positiveQuantitySchema,
  uuidSchema,
} from "./common";

export const PAYMENT_METHODS = [
  "CASH",
  "BANK_TRANSFER_QR",
  "CARD",
  "LOYALTY_POINTS",
  "STORE_CREDIT",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const SHIFT_STATUSES = ["OPEN", "CLOSED"] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

export const openShiftSchema = z
  .object({
    branchId: uuidSchema,
    openingCash: nonNegativeMoneySchema,
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const closeShiftSchema = z
  .object({
    actualCash: nonNegativeMoneySchema,
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const shiftQuerySchema = paginationQuerySchema.extend({
  branchId: uuidSchema.optional(),
  status: z.enum(SHIFT_STATUSES).optional(),
});

export const createInvoiceItemSchema = z
  .object({
    variantId: uuidSchema,
    quantity: positiveQuantitySchema,
    discountAmount: nonNegativeMoneySchema.default("0.00"),
    overrideUnitPrice: nonNegativeMoneySchema.optional(),
  })
  .strict();

export const createInvoicePaymentSchema = z
  .object({
    method: z.enum(PAYMENT_METHODS),
    amount: nonNegativeMoneySchema,
    referenceNo: z.string().trim().max(100).optional(),
  })
  .strict();

export const createInvoiceSchema = z
  .object({
    idempotencyKey: uuidSchema,
    branchId: uuidSchema,
    shiftId: uuidSchema,
    customerId: uuidSchema.optional().nullable(),
    discountAmount: nonNegativeMoneySchema.default("0.00"),
    syncSource: z.enum(["ONLINE", "OFFLINE_SYNC"]).default("ONLINE"),
    supervisorApprovalToken: z.string().min(16).max(2048).optional(),
    items: z.array(createInvoiceItemSchema).min(1).max(200),
    payments: z.array(createInvoicePaymentSchema).min(1).max(10),
  })
  .strict();

export const SUPERVISOR_APPROVAL_PERMISSIONS = [
  "pos:price_override",
  "pos:discount_override",
  "pos:refund",
  "pos:shift_manage",
] as const;

export const supervisorPinVerifySchema = z
  .object({
    branchId: uuidSchema,
    permission: z.enum(SUPERVISOR_APPROVAL_PERMISSIONS),
    managerEmployeeCode: z.string().trim().toUpperCase().max(32).optional(),
    pin: z
      .string()
      .trim()
      .regex(/^\d{4,8}$/, "Mã PIN Quản lý gồm 4 đến 8 chữ số"),
  })
  .strict();

export const salesReturnItemInputSchema = z
  .object({
    invoiceItemId: uuidSchema,
    quantity: positiveQuantitySchema,
  })
  .strict();

export const REFUND_PAYMENT_METHODS = [
  "CASH",
  "BANK_TRANSFER_QR",
  "CARD",
  "STORE_CREDIT",
] as const;

export const createSalesReturnSchema = z
  .object({
    shiftId: uuidSchema.optional().nullable(),
    refundMethod: z.enum(REFUND_PAYMENT_METHODS).default("CASH"),
    reason: z.string().trim().min(2).max(500),
    supervisorApprovalToken: z.string().min(16).max(2048).optional(),
    items: z
      .array(salesReturnItemInputSchema)
      .min(1)
      .max(200)
      .superRefine((items, ctx) => {
        const seen = new Set<string>();
        items.forEach((item, idx) => {
          if (seen.has(item.invoiceItemId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [idx, "invoiceItemId"],
              message: "Duplicate invoiceItemId in return items",
            });
          }
          seen.add(item.invoiceItemId);
        });
      }),
  })
  .strict();

export const voidInvoiceSchema = z
  .object({
    reason: z.string().trim().min(2).max(500),
    supervisorApprovalToken: z.string().min(16).max(2048).optional(),
  })
  .strict();

export const cashDrawerOpenSchema = z
  .object({
    branchId: uuidSchema,
    reason: z.string().trim().min(2).max(300),
    supervisorApprovalToken: z.string().min(16).max(2048).optional(),
  })
  .strict();

export const salesReturnListQuerySchema = paginationQuerySchema.extend({
  branchId: uuidSchema.optional(),
  invoiceId: uuidSchema.optional(),
});

export const posCatalogSyncQuerySchema = z.object({
  branchId: uuidSchema,
  since: z.string().datetime({ offset: true }).optional(),
});

export const invoiceListQuerySchema = paginationQuerySchema.extend({
  branchId: uuidSchema.optional(),
  shiftId: uuidSchema.optional(),
});

export type OpenShiftInput = z.infer<typeof openShiftSchema>;
export type CloseShiftInput = z.infer<typeof closeShiftSchema>;
export type ShiftQuery = z.infer<typeof shiftQuerySchema>;
export type CreateInvoiceItemInput = z.infer<typeof createInvoiceItemSchema>;
export type CreateInvoicePaymentInput = z.infer<typeof createInvoicePaymentSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type PosCatalogSyncQuery = z.infer<typeof posCatalogSyncQuerySchema>;
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;
export type SupervisorPinVerifyInput = z.infer<typeof supervisorPinVerifySchema>;
export type CreateSalesReturnInput = z.infer<typeof createSalesReturnSchema>;
export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;
export type CashDrawerOpenInput = z.infer<typeof cashDrawerOpenSchema>;
export type SalesReturnListQuery = z.infer<typeof salesReturnListQuerySchema>;

export interface PosCatalogItem {
  variantId: string;
  productId: string;
  categoryId: string | null;
  categoryName: string | null;
  productName: string;
  variantName: string;
  sku: string;
  barcode: string | null;
  unit: string;
  salePrice: string;
  taxRate: string;
  minStockAlert: number;
  imageUrl: string | null;
  isActive: boolean;
  onHand: string;
  reserved: string;
  available: string;
  updatedAt: string;
}

export interface PosCatalogCategorySummary {
  id: string;
  name: string;
  sortOrder: number;
}

export interface PosCatalogSyncResponse {
  branchId: string;
  serverTimestamp: string;
  fullSync: boolean;
  categories: PosCatalogCategorySummary[];
  items: PosCatalogItem[];
}

export interface RegisterShiftItem {
  id: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  openedByMemberId: string;
  openedByName: string;
  closedByMemberId: string | null;
  closedByName: string | null;
  status: ShiftStatus;
  openingCash: string;
  expectedCash: string;
  actualCash: string | null;
  cashVariance: string | null;
  openedAt: string;
  closedAt: string | null;
  note: string | null;
}

export interface ShiftZReportResponse {
  shift: RegisterShiftItem;
  summary: {
    invoiceCount: number;
    grossSales: string;
    discountTotal: string;
    taxTotal: string;
    netSales: string;
    cogsTotal: string;
    grossProfit: string;
    paymentTotals: Record<PaymentMethod, string>;
  };
}

export interface InvoiceLineResponse {
  id: string;
  variantId: string;
  productName: string;
  sku: string;
  quantity: string;
  returnedQty?: string;
  unitPrice: string;
  discountAmount: string;
  taxAmount: string;
  lineTotal: string;
}

export interface InvoicePaymentResponse {
  id: string;
  method: PaymentMethod;
  amount: string;
  referenceNo: string | null;
  paidAt: string;
}

export interface InvoiceReceiptResponse {
  id: string;
  code: string;
  idempotencyKey: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  shiftId: string;
  cashierMemberId: string;
  cashierName: string;
  customerId?: string | null;
  customerName?: string | null;
  earnedPoints?: number;
  status: string;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  paidAmount: string;
  changeGiven: string;
  createdAt: string;
  items: InvoiceLineResponse[];
  payments: InvoicePaymentResponse[];
}

export interface SupervisorApprovalResponse {
  approvalToken: string;
  approverMemberId: string;
  approverName: string;
  approverEmployeeCode: string;
  permission: (typeof SUPERVISOR_APPROVAL_PERMISSIONS)[number];
  expiresAt: string;
}

export interface SalesReturnLineResponse {
  id: string;
  invoiceItemId: string;
  variantId: string;
  sku: string;
  productName: string;
  quantity: string;
  refundAmount: string;
}

export interface SalesReturnResponse {
  id: string;
  code: string;
  branchId: string;
  branchName: string;
  invoiceId: string;
  invoiceCode: string;
  invoiceStatus: string;
  shiftId: string | null;
  processedByName: string;
  status: string;
  totalRefundAmount: string;
  refundMethod: PaymentMethod;
  reason: string | null;
  createdAt: string;
  items: SalesReturnLineResponse[];
}

export interface InvoiceDetailResponse extends InvoiceReceiptResponse {
  salesReturns: SalesReturnResponse[];
}

export interface PosStockStreamEvent {
  type: "STOCK_UPDATED" | "HEARTBEAT";
  branchId?: string;
  timestamp: string;
  items?: Array<{
    variantId: string;
    onHand: string;
    available: string;
  }>;
}
