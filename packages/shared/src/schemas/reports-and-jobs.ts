import { z } from "zod";
import {
  paginationQuerySchema,
  positiveQuantitySchema,
  uuidSchema,
} from "./common";

export const AUDIT_ACTIONS = [
  "INVOICE_VOID",
  "PRICE_OVERRIDE",
  "DISCOUNT_OVERRIDE",
  "STOCK_ADJUST",
  "SHIFT_DIFF",
  "REFUND",
  "CASH_DRAWER_OPEN",
  "BRANCH_CREATED",
  "BRANCH_UPDATED",
  "MEMBER_CREATED",
  "MEMBER_UPDATED",
  "TRANSFER_DISPATCHED",
  "TRANSFER_RECEIVED",
  "CUSTOMER_LOYALTY_ADJUST",
  "PLAN_UPGRADED",
  "API_KEY_CREATED",
  "API_KEY_REVOKED",
  "WEBHOOK_CREATED",
  "WEBHOOK_REVOKED",
  "EXTERNAL_ORDER_SYNCED",
] as const;

export type AuditActionType = (typeof AUDIT_ACTIONS)[number];

export const STOCK_TRANSFER_STATUSES = [
  "IN_TRANSIT",
  "RECEIVED",
  "CANCELLED",
] as const;
export type StockTransferStatus = (typeof STOCK_TRANSFER_STATUSES)[number];

export const REPORT_EXPORT_TYPES = [
  "SALES_DETAIL",
  "INVENTORY_LEDGER",
  "DAILY_SUMMARY",
  "ACCOUNTING_LEDGER",
] as const;
export type ReportExportType = (typeof REPORT_EXPORT_TYPES)[number];

export const EXPORT_JOB_STATUSES = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
] as const;
export type ExportJobStatus = (typeof EXPORT_JOB_STATUSES)[number];

const DATE_YYYY_MM_DD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const auditLogQuerySchema = paginationQuerySchema.extend({
  branchId: uuidSchema.optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  entityType: z.string().trim().max(64).optional(),
  from: z.string().regex(DATE_YYYY_MM_DD_REGEX).optional(),
  to: z.string().regex(DATE_YYYY_MM_DD_REGEX).optional(),
});

export const reportOverviewQuerySchema = z.object({
  branchId: uuidSchema.optional(),
  from: z.string().regex(DATE_YYYY_MM_DD_REGEX).optional(),
  to: z.string().regex(DATE_YYYY_MM_DD_REGEX).optional(),
});

export const createReportExportSchema = z
  .object({
    reportType: z.enum(REPORT_EXPORT_TYPES),
    branchId: uuidSchema.optional().nullable(),
    from: z.string().regex(DATE_YYYY_MM_DD_REGEX).optional(),
    to: z.string().regex(DATE_YYYY_MM_DD_REGEX).optional(),
  })
  .strict();

export const reportExportListQuerySchema = paginationQuerySchema;

export const stockTransferItemInputSchema = z
  .object({
    variantId: uuidSchema,
    quantity: positiveQuantitySchema,
  })
  .strict();

export const createStockTransferSchema = z
  .object({
    fromBranchId: uuidSchema,
    toBranchId: uuidSchema,
    note: z.string().trim().max(300).optional().nullable(),
    items: z
      .array(stockTransferItemInputSchema)
      .min(1)
      .max(200)
      .superRefine((items, ctx) => {
        const seen = new Set<string>();
        items.forEach((item, index) => {
          if (seen.has(item.variantId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [index, "variantId"],
              message: "Duplicate variantId in stock transfer items",
            });
          }
          seen.add(item.variantId);
        });
      }),
  })
  .strict()
  .refine((data) => data.fromBranchId !== data.toBranchId, {
    path: ["toBranchId"],
    message: "Destination branch must differ from origin branch",
  });

export const receiveStockTransferSchema = z
  .object({
    note: z.string().trim().max(300).optional().nullable(),
  })
  .strict();

export const stockTransferQuerySchema = paginationQuerySchema.extend({
  branchId: uuidSchema.optional(),
  status: z.enum(STOCK_TRANSFER_STATUSES).optional(),
});

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
export type ReportOverviewQuery = z.infer<typeof reportOverviewQuerySchema>;
export type CreateReportExportInput = z.infer<typeof createReportExportSchema>;
export type ReportExportListQuery = z.infer<typeof reportExportListQuerySchema>;
export type CreateStockTransferInput = z.infer<typeof createStockTransferSchema>;
export type ReceiveStockTransferInput = z.infer<typeof receiveStockTransferSchema>;
export type StockTransferQuery = z.infer<typeof stockTransferQuerySchema>;

export interface AuditLogItem {
  id: string;
  branchId: string | null;
  branchName: string | null;
  actorMemberId: string;
  actorName: string;
  actorEmployeeCode: string;
  action: AuditActionType;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

export interface DailySeriesPoint {
  date: string;
  invoiceCount: number;
  grossRevenue: string;
  discountTotal: string;
  refundTotal: string;
  netRevenue: string;
  cogsTotal: string;
  grossProfit: string;
}

export interface TopSellingVariantItem {
  variantId: string;
  sku: string;
  productName: string;
  variantName: string;
  quantitySold: string;
  revenue: string;
}

export interface LowStockAlertItem {
  branchId: string;
  branchName: string;
  variantId: string;
  sku: string;
  productName: string;
  variantName: string;
  onHand: string;
  minStockAlert: number;
}

export interface ReportOverviewResponse {
  from: string;
  to: string;
  branchId: string | null;
  kpis: {
    invoiceCount: number;
    grossRevenue: string;
    discountTotal: string;
    refundTotal: string;
    netRevenue: string;
    cogsTotal: string;
    grossProfit: string;
    averageOrderValue: string;
    cashTotal: string;
    transferTotal: string;
    cardTotal: string;
  };
  dailySeries: DailySeriesPoint[];
  topProducts: TopSellingVariantItem[];
  lowStockAlerts: LowStockAlertItem[];
}

export interface ReportExportJobItem {
  id: string;
  reportType: ReportExportType;
  status: ExportJobStatus;
  fileName: string;
  rowCount: number;
  errorMessage: string | null;
  requestedByName: string;
  createdAt: string;
  completedAt: string | null;
}

export interface StockTransferLineView {
  id: string;
  variantId: string;
  sku: string;
  productName: string;
  variantName: string;
  unit: string;
  quantity: string;
  unitCost: string;
}

export interface StockTransferItemView {
  id: string;
  code: string;
  status: StockTransferStatus;
  fromBranchId: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchName: string;
  createdByName: string;
  receivedByName: string | null;
  note: string | null;
  dispatchedAt: string;
  receivedAt: string | null;
  items: StockTransferLineView[];
}
