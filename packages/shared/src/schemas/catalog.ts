import { z } from "zod";
import { nonNegativeMoneySchema, uuidSchema } from "./common";

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

export const productVariantInputSchema = z
  .object({
    sku: z.string().trim().min(1).max(64),
    barcode: z.string().trim().min(1).max(64).optional().nullable(),
    name: z.string().trim().min(1).max(160),
    unit: z.string().trim().min(1).max(32).default("Cái"),
    costPrice: nonNegativeMoneySchema,
    salePrice: nonNegativeMoneySchema,
    taxRate: nonNegativeMoneySchema.default("0.00"),
    minStockAlert: z.coerce.number().int().min(0).default(0),
  })
  .strict();

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
  .strict();

export type ProductVariantInput = z.infer<typeof productVariantInputSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
