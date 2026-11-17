import { z } from "zod";

const MONEY_DECIMAL_REGEX = /^\d+(?:\.\d{1,2})?$/;
const QTY_DECIMAL_REGEX = /^\d+(?:\.\d{1,3})?$/;
const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/;

export const uuidSchema = z.string().uuid();

export const tenantSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    SLUG_REGEX,
    "Slug must be 3-50 lowercase alphanumeric characters or hyphens",
  );

/**
 * Monetary amount serialized as canonical decimal string (max 2 decimal places)
 * to avoid floating-point rounding drift across JSON boundaries.
 */
export const nonNegativeMoneySchema = z
  .union([z.string().trim(), z.number().finite()])
  .transform((val) => (typeof val === "number" ? val.toFixed(2) : val))
  .refine(
    (val) => MONEY_DECIMAL_REGEX.test(val),
    "Money must be a non-negative decimal with at most 2 decimal places",
  );

export const positiveQuantitySchema = z
  .union([z.string().trim(), z.number().finite()])
  .transform((val) => (typeof val === "number" ? val.toString() : val))
  .refine(
    (val) => QTY_DECIMAL_REGEX.test(val) && Number(val) > 0,
    "Quantity must be greater than 0 with at most 3 decimal places",
  );

export const nonNegativeQuantitySchema = z
  .union([z.string().trim(), z.number().finite()])
  .transform((val) => (typeof val === "number" ? val.toString() : val))
  .refine(
    (val) => QTY_DECIMAL_REGEX.test(val),
    "Quantity must be non-negative with at most 3 decimal places",
  );

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
