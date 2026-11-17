export const ROLES = ["OWNER", "MANAGER", "CASHIER", "WAREHOUSE"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  POS_SELL: "pos:sell",
  POS_DISCOUNT_OVERRIDE: "pos:discount_override",
  POS_PRICE_OVERRIDE: "pos:price_override",
  POS_REFUND: "pos:refund",
  POS_SHIFT_MANAGE: "pos:shift_manage",
  INVENTORY_VIEW: "inventory:view",
  INVENTORY_RECEIVE: "inventory:receive",
  INVENTORY_COUNT: "inventory:count",
  INVENTORY_TRANSFER: "inventory:transfer",
  CATALOG_MANAGE: "catalog:manage",
  REPORT_FINANCIAL: "report:financial",
  STAFF_MANAGE: "staff:manage",
  BRANCH_MANAGE: "branch:manage",
  AUDIT_VIEW: "audit:view",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
