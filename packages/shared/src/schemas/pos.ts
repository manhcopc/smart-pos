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
    items: z.array(createInvoiceItemSchema).min(1).max(200),
    payments: z.array(createInvoicePaymentSchema).min(1).max(10),
  })
  .strict();

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
