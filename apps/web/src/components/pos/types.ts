import type {
  PaymentMethod,
  SUPERVISOR_APPROVAL_PERMISSIONS,
} from "@smart-pos/shared";

export interface CartLineState {
  variantId: string;
  sku: string;
  name: string;
  unit: string;
  catalogPrice: string;
  taxRate: string;
  quantity: string;
  discountAmount: string;
  overrideUnitPrice?: string;
}

export interface PaymentLegState {
  method: PaymentMethod;
  amount: string;
  referenceNo: string;
}

export interface PendingInvoiceTab {
  id: string;
  label: string;
  idempotencyKey: string;
  customerId: string | null;
  customerName: string | null;
  customerPoints: number;
  supervisorApprovalToken?: string;
  supervisorPermission?: (typeof SUPERVISOR_APPROVAL_PERMISSIONS)[number];
  supervisorApproverName?: string;
  items: CartLineState[];
  invoiceDiscountAmount: string;
  payments: PaymentLegState[];
}

export function makeUuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function createEmptyTab(index: number): PendingInvoiceTab {
  return {
    id: `tab-${index}-${Date.now()}`,
    label: `Hóa đơn ${index}`,
    idempotencyKey: makeUuid(),
    customerId: null,
    customerName: null,
    customerPoints: 0,
    items: [],
    invoiceDiscountAmount: "0",
    payments: [{ method: "CASH", amount: "0", referenceNo: "" }],
  };
}

export const QUICK_CASH_NOTES = [
  { label: "50k", amount: "50000" },
  { label: "100k", amount: "100000" },
  { label: "200k", amount: "200000" },
  { label: "500k", amount: "500000" },
] as const;

export function formatMoneyForInput(raw: string): string {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return "0";
  return Number.isInteger(num) ? String(num) : num.toFixed(2);
}
