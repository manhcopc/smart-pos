import { z } from "zod";
import { tenantSlugSchema } from "./common";

export const BUSINESS_TYPES = [
  "RETAIL",
  "FASHION",
  "GROCERY",
  "PHARMACY",
  "ELECTRONICS",
  "OTHER",
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const registerTenantSchema = z
  .object({
    shopName: z.string().trim().min(2).max(120),
    tenantSlug: tenantSlugSchema,
    businessType: z.enum(BUSINESS_TYPES).default("RETAIL"),
    ownerName: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(8).max(128),
    phone: z.string().trim().min(8).max(20),
    branchName: z.string().trim().min(2).max(100).default("Chi nhánh trung tâm"),
  })
  .strict();

export const ownerLoginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(1).max(128),
  })
  .strict();

export const cashierPinLoginSchema = z
  .object({
    tenantSlug: tenantSlugSchema,
    employeeCode: z.string().trim().min(2).max(32),
    pin: z
      .string()
      .trim()
      .regex(/^\d{4,8}$/, "PIN must be 4 to 8 digits"),
  })
  .strict();

export type RegisterTenantInput = z.infer<typeof registerTenantSchema>;
export type OwnerLoginInput = z.infer<typeof ownerLoginSchema>;
export type CashierPinLoginInput = z.infer<typeof cashierPinLoginSchema>;
