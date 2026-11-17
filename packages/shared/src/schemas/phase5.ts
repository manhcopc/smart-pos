import { z } from "zod";
import { paginationQuerySchema, positiveQuantitySchema } from "./common";

export const PAID_SUBSCRIPTION_PLANS = ["LITE", "PRO"] as const;
export const ALL_SUBSCRIPTION_PLANS = ["FREE_TRIAL", "LITE", "PRO"] as const;
export type PaidSubscriptionPlanCode = (typeof PAID_SUBSCRIPTION_PLANS)[number];
export type SubscriptionPlanCodeType = (typeof ALL_SUBSCRIPTION_PLANS)[number];

export const subscribePlanSchema = z
  .object({
    planCode: z.enum(ALL_SUBSCRIPTION_PLANS),
    billingMonths: z.number().int().min(1).max(24).default(1),
    provider: z
      .enum(["INTERNAL_QR", "VNPAY", "MOMO", "TRIAL_EXTEND"])
      .default("INTERNAL_QR"),
    confirmImmediately: z.boolean().default(true),
  })
  .strict();

export const billingPaymentWebhookSchema = z
  .object({
    billingId: z.string().uuid(),
    tenantId: z.string().uuid(),
    status: z.enum(["PAID", "FAILED"]),
    referenceNo: z.string().trim().min(2).max(120),
    signature: z.string().trim().min(16).max(256),
  })
  .strict();

export const API_KEY_SCOPES = [
  "inventory:read",
  "inventory:write",
  "orders:write",
  "accounting:read",
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const createApiKeySchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).max(10),
  })
  .strict();

export const WEBHOOK_EVENTS = [
  "STOCK_UPDATED",
  "INVOICE_CREATED",
  "EXTERNAL_ORDER_SYNCED",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export const createWebhookSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    targetUrl: z.string().trim().url().max(500),
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(10),
  })
  .strict();

export const updateWebhookSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    targetUrl: z.string().trim().url().max(500).optional(),
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(10).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for webhook update",
  });

export const externalInventoryQuerySchema = z.object({
  branchCode: z.string().trim().max(32).optional(),
  sku: z.string().trim().max(64).optional(),
  since: z.string().datetime({ offset: true }).optional(),
});

export const externalOrderSyncSchema = z
  .object({
    externalOrderId: z.string().trim().min(2).max(100),
    channel: z.string().trim().min(2).max(40).default("WEBSITE"),
    branchCode: z.string().trim().min(2).max(32).optional(),
    customerName: z.string().trim().max(120).optional(),
    customerPhone: z.string().trim().max(20).optional(),
    items: z
      .array(
        z
          .object({
            sku: z.string().trim().min(1).max(64),
            quantity: positiveQuantitySchema,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export const accountingExportQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const webhookDeliveriesQuerySchema = paginationQuerySchema;

export type SubscribePlanInput = z.infer<typeof subscribePlanSchema>;
export type BillingPaymentWebhookInput = z.infer<typeof billingPaymentWebhookSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;
export type ExternalInventoryQuery = z.infer<typeof externalInventoryQuerySchema>;
export type ExternalOrderSyncInput = z.infer<typeof externalOrderSyncSchema>;
export type AccountingExportQuery = z.infer<typeof accountingExportQuerySchema>;

export interface SubscriptionPlanInfo {
  id: string;
  code: SubscriptionPlanCodeType;
  name: string;
  priceMonthly: string;
  maxBranches: number;
  maxUsers: number;
  maxSkus: number;
  storageQuotaMb: number;
  features: {
    posOffline?: boolean;
    splitPayments?: boolean;
    multiBranchTransfer?: boolean;
    omnichannelApi?: boolean;
  };
}

export interface SubscriptionBillingItem {
  id: string;
  planCode: SubscriptionPlanCodeType;
  billingMonths: number;
  amount: string;
  status: "PENDING" | "PAID" | "FAILED";
  provider: string;
  referenceNo: string | null;
  periodStart: string;
  periodEnd: string;
  paidAt: string | null;
  createdAt: string;
}

export interface SubscriptionOverviewResponse {
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: string;
    trialEndsAt: string | null;
    daysRemaining: number | null;
    isTrialExpired: boolean;
  };
  currentPlan: SubscriptionPlanInfo;
  usage: {
    activeBranches: number;
    activeUsers: number;
    activeSkus: number;
  };
  availablePlans: SubscriptionPlanInfo[];
  billingHistory: SubscriptionBillingItem[];
}

export interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface CreateApiKeyResponse {
  apiKey: ApiKeyItem;
  plainTextKey: string;
}

export interface WebhookEndpointItem {
  id: string;
  name: string;
  targetUrl: string;
  signingSecret: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryItem {
  id: string;
  endpointId: string;
  endpointName: string;
  eventType: string;
  status: "PENDING" | "DELIVERED" | "FAILED";
  httpStatus: number | null;
  responseSnippet: string | null;
  attemptCount: number;
  deliveredAt: string | null;
  createdAt: string;
}
