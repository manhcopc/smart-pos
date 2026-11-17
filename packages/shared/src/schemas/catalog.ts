import { z } from "zod";
import {
  nonNegativeMoneySchema,
  paginationQuerySchema,
  uuidSchema,
} from "./common";

export const INVENTORY_MOVEMENT_TYPES = [
  "SALE",
  "SALE_RETURN",
  "PURCHASE_IN",
  "PURCHASE_RETURN",
  "STOCK_COUNT",
  "TRANSFER_OUT",
  "TRANSFER_IN",
] as const;

export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

export const createCategorySchema = z
  .object({
    parentId: uuidSchema.optional().nullable(),
    name: z.string().trim().min(1).max(120),
    sortOrder: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict();

export const updateCategorySchema = z
  .object({
    parentId: uuidSchema.optional().nullable(),
    name: z.string().trim().min(1).max(120).optional(),
    sortOrder: z.coerce.number().int().min(0).max(100000).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });

export const productVariantInputSchema = z
  .object({
    sku: z
      .string()
      .trim()
      .toUpperCase()
      .min(1)
      .max(64),
    barcode: z.string().trim().min(1).max(64).optional().nullable(),
    name: z.string().trim().min(1).max(160),
    unit: z.string().trim().min(1).max(32).default("Cái"),
    costPrice: nonNegativeMoneySchema,
    salePrice: nonNegativeMoneySchema,
    taxRate: nonNegativeMoneySchema.default("0.00"),
    minStockAlert: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const updateVariantSchema = z
  .object({
    barcode: z.string().trim().min(1).max(64).optional().nullable(),
    name: z.string().trim().min(1).max(160).optional(),
    unit: z.string().trim().min(1).max(32).optional(),
    costPrice: nonNegativeMoneySchema.optional(),
    salePrice: nonNegativeMoneySchema.optional(),
    taxRate: nonNegativeMoneySchema.optional(),
    minStockAlert: z.coerce.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });

export const createProductSchema = z
  .object({
    categoryId: uuidSchema.optional().nullable(),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).optional().nullable(),
    brand: z.string().trim().max(100).optional().nullable(),
    hasVariants: z.boolean().default(false),
    imageUrl: z.string().trim().url().max(500).optional().nullable(),
    variants: z.array(productVariantInputSchema).min(1).max(100),
  })
  .strict()
  .superRefine((data, ctx) => {
    const seenSkus = new Set<string>();
    const seenBarcodes = new Set<string>();
    data.variants.forEach((variant, index) => {
      if (seenSkus.has(variant.sku)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["variants", index, "sku"],
          message: `Duplicate SKU "${variant.sku}" within product`,
        });
      }
      seenSkus.add(variant.sku);

      if (variant.barcode) {
        if (seenBarcodes.has(variant.barcode)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["variants", index, "barcode"],
            message: `Duplicate barcode "${variant.barcode}" within product`,
          });
        }
        seenBarcodes.add(variant.barcode);
      }
    });
  });

export const updateProductSchema = z
  .object({
    categoryId: uuidSchema.optional().nullable(),
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(2000).optional().nullable(),
    brand: z.string().trim().max(100).optional().nullable(),
    hasVariants: z.boolean().optional(),
    imageUrl: z.string().trim().url().max(500).optional().nullable(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });

export const catalogListQuerySchema = paginationQuerySchema.extend({
  categoryId: uuidSchema.optional(),
  branchId: uuidSchema.optional(),
  lowStockOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

export const presignProductImageSchema = z
  .object({
    fileName: z.string().trim().min(1).max(180),
    contentType: z.enum(["image/webp", "image/jpeg", "image/png"]),
    fileSizeBytes: z.coerce.number().int().min(1).max(5_242_880),
  })
  .strict();

export const exportFormatQuerySchema = z.object({
  format: z.enum(["csv", "xlsx"]).default("xlsx"),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type ProductVariantInput = z.infer<typeof productVariantInputSchema>;
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type CatalogListQuery = z.infer<typeof catalogListQuerySchema>;
export type PresignProductImageInput = z.infer<typeof presignProductImageSchema>;
export type ExportFormatQuery = z.infer<typeof exportFormatQuerySchema>;

export interface CategoryItem {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductVariantItem {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  costPrice: string;
  salePrice: string;
  taxRate: string;
  minStockAlert: number;
  isActive: boolean;
  branchStock?: {
    branchId: string;
    onHand: string;
    reserved: string;
    available: string;
    avgCost: string;
    isLowStock: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductItem {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  description: string | null;
  brand: string | null;
  hasVariants: boolean;
  imageUrl: string | null;
  isActive: boolean;
  variants: ProductVariantItem[];
  createdAt: string;
  updatedAt: string;
}

export interface CatalogListResponse {
  items: ProductItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  quota: {
    activeSkus: number;
    maxSkus: number;
  };
}

export interface PresignedUploadResponse {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresInSeconds: number;
}

export interface CatalogImportRowError {
  rowNumber: number;
  sku: string;
  message: string;
}

export interface CatalogImportResponse {
  createdProducts: number;
  createdVariants: number;
  skippedRows: number;
  errors: CatalogImportRowError[];
}
