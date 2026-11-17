import { z } from "zod";
import {
  nonNegativeMoneySchema,
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

export type OpenShiftInput = z.infer<typeof openShiftSchema>;
export type CloseShiftInput = z.infer<typeof closeShiftSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
