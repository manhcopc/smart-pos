import { z } from "zod";
import { paginationQuerySchema } from "./common";

const CUSTOMER_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

export const createCustomerSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        CUSTOMER_CODE_REGEX,
        "Customer code must be 2-32 uppercase alphanumeric, underscore, or hyphen characters",
      )
      .optional(),
    name: z.string().trim().min(2).max(160),
    phone: z.string().trim().min(8).max(20).optional().nullable(),
    email: z.string().trim().toLowerCase().email().max(254).optional().nullable(),
  })
  .strict();

export const updateCustomerSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    phone: z.string().trim().min(8).max(20).optional().nullable(),
    email: z.string().trim().toLowerCase().email().max(254).optional().nullable(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });

export const adjustCustomerLoyaltySchema = z
  .object({
    pointsDelta: z
      .number()
      .int()
      .refine((v) => v !== 0, "Points delta must not be zero"),
    reason: z.string().trim().min(2).max(300),
  })
  .strict();

export const customerQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type AdjustCustomerLoyaltyInput = z.infer<typeof adjustCustomerLoyaltySchema>;
export type CustomerQuery = z.infer<typeof customerQuerySchema>;

export interface CustomerItem {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  loyaltyPoints: number;
  totalSpent: string;
  debtBalance: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerInvoiceSummary {
  id: string;
  code: string;
  branchName: string;
  status: string;
  totalAmount: string;
  createdAt: string;
}

export interface CustomerDetailResponse extends CustomerItem {
  recentInvoices: CustomerInvoiceSummary[];
}
