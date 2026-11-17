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
  CUSTOMER_VIEW: "customer:view",
  CUSTOMER_MANAGE: "customer:manage",
  REPORT_FINANCIAL: "report:financial",
  STAFF_MANAGE: "staff:manage",
  BRANCH_MANAGE: "branch:manage",
  AUDIT_VIEW: "audit:view",
  BILLING_MANAGE: "billing:manage",
  INTEGRATION_MANAGE: "integration:manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: Object.values(PERMISSIONS),
  MANAGER: [
    PERMISSIONS.POS_SELL,
    PERMISSIONS.POS_DISCOUNT_OVERRIDE,
    PERMISSIONS.POS_PRICE_OVERRIDE,
    PERMISSIONS.POS_REFUND,
    PERMISSIONS.POS_SHIFT_MANAGE,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.INVENTORY_RECEIVE,
    PERMISSIONS.INVENTORY_COUNT,
    PERMISSIONS.INVENTORY_TRANSFER,
    PERMISSIONS.CATALOG_MANAGE,
    PERMISSIONS.CUSTOMER_VIEW,
    PERMISSIONS.CUSTOMER_MANAGE,
    PERMISSIONS.REPORT_FINANCIAL,
    PERMISSIONS.STAFF_MANAGE,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.INTEGRATION_MANAGE,
  ],
  CASHIER: [
    PERMISSIONS.POS_SELL,
    PERMISSIONS.POS_SHIFT_MANAGE,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.CUSTOMER_VIEW,
  ],
  WAREHOUSE: [
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.INVENTORY_RECEIVE,
    PERMISSIONS.INVENTORY_COUNT,
    PERMISSIONS.INVENTORY_TRANSFER,
    PERMISSIONS.CATALOG_MANAGE,
  ],
};

export interface PermissionOverrides {
  grant?: readonly Permission[];
  revoke?: readonly Permission[];
}

/**
 * Resolve effective permissions by combining role defaults with per-member overrides.
 * Revocations take precedence over grants so explicit restrictions always win.
 */
export function resolvePermissions(
  role: Role,
  overrides?: PermissionOverrides | null,
): Set<Permission> {
  const effective = new Set<Permission>(ROLE_PERMISSIONS[role]);

  if (overrides?.grant) {
    for (const permission of overrides.grant) {
      effective.add(permission);
    }
  }

  if (overrides?.revoke) {
    for (const permission of overrides.revoke) {
      effective.delete(permission);
    }
  }

  return effective;
}

/** Check whether a role (with optional member overrides) satisfies a required permission. */
export function hasPermission(
  role: Role,
  required: Permission,
  overrides?: PermissionOverrides | null,
): boolean {
  return resolvePermissions(role, overrides).has(required);
}
