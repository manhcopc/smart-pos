import { z } from "zod";
import { INVENTORY_MOVEMENT_TYPES } from "./catalog";
import {
  nonNegativeMoneySchema,
  nonNegativeQuantitySchema,
  paginationQuerySchema,
  positiveQuantitySchema,
  uuidSchema,
} from "./common";

const DOCUMENT_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

export const PURCHASE_ORDER_STATUSES = [
  "DRAFT",
  "COMPLETED",
  "CANCELLED",
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const STOCK_COUNT_STATUSES = ["DRAFT", "BALANCED", "CANCELLED"] as const;
export type StockCountStatus = (typeof STOCK_COUNT_STATUSES)[number];

// -----------------------------------------------------------------------------
// Suppliers
// -----------------------------------------------------------------------------

export const createSupplierSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        DOCUMENT_CODE_REGEX,
        "Supplier code must be 2-32 uppercase alphanumeric, underscore, or hyphen characters",
      ),
    name: z.string().trim().min(2).max(160),
    phone: z.string().trim().min(8).max(20).optional().nullable(),
    email: z.string().trim().toLowerCase().email().max(254).optional().nullable(),
    address: z.string().trim().max(300).optional().nullable(),
  })
  .strict();

export const updateSupplierSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    phone: z.string().trim().min(8).max(20).optional().nullable(),
    email: z.string().trim().toLowerCase().email().max(254).optional().nullable(),
    address: z.string().trim().max(300).optional().nullable(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });

// -----------------------------------------------------------------------------
// Inventory & Ledger Queries
// -----------------------------------------------------------------------------

export const inventoryQuerySchema = paginationQuerySchema.extend({
  branchId: uuidSchema.optional(),
  categoryId: uuidSchema.optional(),
  lowStockOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export const ledgerQuerySchema = paginationQuerySchema.extend({
  branchId: uuidSchema.optional(),
  variantId: uuidSchema.optional(),
  movementType: z.enum(INVENTORY_MOVEMENT_TYPES).optional(),
});

// -----------------------------------------------------------------------------
// Purchase Orders (Nhập hàng NCC & AVCO)
// -----------------------------------------------------------------------------

export const purchaseOrderItemInputSchema = z
  .object({
    variantId: uuidSchema,
    orderedQty: positiveQuantitySchema,
    unitCost: nonNegativeMoneySchema,
    discount: nonNegativeMoneySchema.default("0.00"),
  })
  .strict();

export const createPurchaseOrderSchema = z
  .object({
    branchId: uuidSchema,
    supplierId: uuidSchema.optional().nullable(),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        DOCUMENT_CODE_REGEX,
        "PO code must be 2-32 uppercase alphanumeric, underscore, or hyphen characters",
      )
      .optional(),
    paidAmount: nonNegativeMoneySchema.default("0.00"),
    items: z.array(purchaseOrderItemInputSchema).min(1).max(200),
    completeImmediately: z.boolean().default(false),
  })
  .strict()
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    data.items.forEach((item, index) => {
      if (seen.has(item.variantId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "variantId"],
          message: "Duplicate variantId in purchase order items",
        });
      }
      seen.add(item.variantId);
    });
  });

export const completePurchaseOrderSchema = z
  .object({
    paidAmount: nonNegativeMoneySchema.optional(),
    note: z.string().trim().max(300).optional().nullable(),
  })
  .strict();

export const purchaseOrderListQuerySchema = paginationQuerySchema.extend({
  branchId: uuidSchema.optional(),
  status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
});

// -----------------------------------------------------------------------------
// Stock Counts (Kiểm kho & Cân bằng tồn)
// -----------------------------------------------------------------------------

export const stockCountItemInputSchema = z
  .object({
    variantId: uuidSchema,
    actualQty: nonNegativeQuantitySchema,
    reason: z.string().trim().max(300).optional().nullable(),
  })
  .strict();

export const createStockCountSchema = z
  .object({
    branchId: uuidSchema,
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        DOCUMENT_CODE_REGEX,
        "Stock count code must be 2-32 uppercase alphanumeric, underscore, or hyphen characters",
      )
      .optional(),
    items: z.array(stockCountItemInputSchema).min(1).max(300),
    balanceImmediately: z.boolean().default(false),
  })
  .strict()
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    data.items.forEach((item, index) => {
      if (seen.has(item.variantId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "variantId"],
          message: "Duplicate variantId in stock count items",
        });
      }
      seen.add(item.variantId);
    });
  });

export const balanceStockCountSchema = z
  .object({
    itemReasons: z
      .record(uuidSchema, z.string().trim().min(1).max(300))
      .optional(),
    note: z.string().trim().max(300).optional().nullable(),
  })
  .strict();

export const stockCountListQuerySchema = paginationQuerySchema.extend({
  branchId: uuidSchema.optional(),
  status: z.enum(STOCK_COUNT_STATUSES).optional(),
});

// -----------------------------------------------------------------------------
// Inferred Types & API Responses
// -----------------------------------------------------------------------------

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type InventoryQuery = z.infer<typeof inventoryQuerySchema>;
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;
export type PurchaseOrderItemInput = z.infer<typeof purchaseOrderItemInputSchema>;
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type CompletePurchaseOrderInput = z.infer<typeof completePurchaseOrderSchema>;
export type PurchaseOrderListQuery = z.infer<typeof purchaseOrderListQuerySchema>;
export type StockCountItemInput = z.infer<typeof stockCountItemInputSchema>;
export type CreateStockCountInput = z.infer<typeof createStockCountSchema>;
export type BalanceStockCountInput = z.infer<typeof balanceStockCountSchema>;
export type StockCountListQuery = z.infer<typeof stockCountListQuerySchema>;

export interface SupplierItem {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  debtBalance: string;
  createdAt: string;
  updatedAt: string;
}

export interface BranchInventoryItem {
  branchId: string;
  branchCode: string;
  branchName: string;
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string;
  barcode: string | null;
  unit: string;
  minStockAlert: number;
  onHand: string;
  reserved: string;
  available: string;
  avgCost: string;
  salePrice: string;
  stockValue: string;
  isLowStock: boolean;
  updatedAt: string | null;
}

export interface InventoryListResponse {
  items: BranchInventoryItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  summary: {
    totalStockValue: string;
    lowStockCount: number;
  };
}

export interface InventoryLedgerItem {
  id: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  variantId: string;
  sku: string;
  variantName: string;
  movementType: (typeof INVENTORY_MOVEMENT_TYPES)[number];
  qtyDelta: string;
  qtyBefore: string;
  qtyAfter: string;
  unitCost: string;
  referenceType: string;
  referenceId: string;
  actorName: string;
  actorEmployeeCode: string;
  note: string | null;
  createdAt: string;
}

export interface InventoryLedgerListResponse {
  items: InventoryLedgerItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PurchaseOrderLineItem {
  id: string;
  variantId: string;
  sku: string;
  variantName: string;
  unit: string;
  orderedQty: string;
  receivedQty: string;
  unitCost: string;
  discount: string;
  lineTotal: string;
}

export interface PurchaseOrderItemResponse {
  id: string;
  code: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  supplierId: string | null;
  supplierName: string | null;
  status: PurchaseOrderStatus;
  totalAmount: string;
  paidAmount: string;
  createdByName: string;
  completedAt: string | null;
  createdAt: string;
  items: PurchaseOrderLineItem[];
}

export interface PurchaseOrderListResponse {
  items: PurchaseOrderItemResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface StockCountLineItem {
  id: string;
  variantId: string;
  sku: string;
  variantName: string;
  unit: string;
  systemQty: string;
  actualQty: string;
  varianceQty: string;
  reason: string | null;
}

export interface StockCountItemResponse {
  id: string;
  code: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  status: StockCountStatus;
  createdByName: string;
  balancedByName: string | null;
  balancedAt: string | null;
  createdAt: string;
  items: StockCountLineItem[];
}

export interface StockCountListResponse {
  items: StockCountItemResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
