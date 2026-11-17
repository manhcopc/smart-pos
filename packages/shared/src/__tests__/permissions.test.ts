import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  hasPermission,
  resolvePermissions,
} from "../permissions";

describe("RBAC permissions matrix", () => {
  it("grants all permissions to OWNER", () => {
    const resolved = resolvePermissions("OWNER");
    for (const permission of Object.values(PERMISSIONS)) {
      expect(resolved.has(permission)).toBe(true);
    }
  });

  it("restricts CASHIER from management and refund overrides by default", () => {
    expect(hasPermission("CASHIER", PERMISSIONS.POS_SELL)).toBe(true);
    expect(hasPermission("CASHIER", PERMISSIONS.POS_SHIFT_MANAGE)).toBe(true);
    expect(hasPermission("CASHIER", PERMISSIONS.POS_REFUND)).toBe(false);
    expect(hasPermission("CASHIER", PERMISSIONS.BRANCH_MANAGE)).toBe(false);
  });

  it("applies member overrides with revoke taking precedence over grant", () => {
    const overrides = {
      grant: [PERMISSIONS.POS_REFUND, PERMISSIONS.POS_DISCOUNT_OVERRIDE],
      revoke: [PERMISSIONS.POS_REFUND],
    };

    expect(hasPermission("CASHIER", PERMISSIONS.POS_DISCOUNT_OVERRIDE, overrides)).toBe(true);
    expect(hasPermission("CASHIER", PERMISSIONS.POS_REFUND, overrides)).toBe(false);
  });
});
