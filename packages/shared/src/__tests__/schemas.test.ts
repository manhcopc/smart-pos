import { describe, expect, it } from "vitest";
import {
  cashierPinLoginSchema,
  createBranchSchema,
  createInvoiceSchema,
  createProductSchema,
  createPurchaseOrderSchema,
  createStaffMemberSchema,
  createStockCountSchema,
  registerTenantSchema,
  updateBranchSchema,
} from "../index";

describe("shared Zod schemas", () => {
  it("validates tenant registration payload and normalizes email and slug", () => {
    const parsed = registerTenantSchema.parse({
      shopName: "Cửa hàng Minh Anh",
      tenantSlug: "  Minh-Anh-Shop  ",
      ownerName: "Nguyễn Minh Anh",
      email: "  Owner@Shop.VN ",
      password: "secure-password-123",
      phone: "0905123456",
    });

    expect(parsed.tenantSlug).toBe("minh-anh-shop");
    expect(parsed.email).toBe("owner@shop.vn");
    expect(parsed.businessType).toBe("RETAIL");
    expect(parsed.branchName).toBe("Chi nhánh trung tâm");
  });

  it("rejects non-numeric cashier PIN and uppercases employeeCode", () => {
    const badPin = cashierPinLoginSchema.safeParse({
      tenantSlug: "shop-a",
      employeeCode: "nv01",
      pin: "12ab",
    });
    expect(badPin.success).toBe(false);

    const goodPin = cashierPinLoginSchema.parse({
      tenantSlug: "shop-a",
      employeeCode: "nv01",
      pin: "1234",
    });
    expect(goodPin.employeeCode).toBe("NV01");
  });

  it("validates branch and staff creation schemas", () => {
    const branch = createBranchSchema.parse({
      code: "cn02",
      name: "Chi nhánh Quận 1",
    });
    expect(branch.code).toBe("CN02");

    expect(updateBranchSchema.safeParse({}).success).toBe(false);

    const pinOnlyCashier = createStaffMemberSchema.safeParse({
      fullName: "Trần Thu Ngân",
      employeeCode: "tn01",
      role: "CASHIER",
      pin: "2580",
    });
    expect(pinOnlyCashier.success).toBe(true);

    const invalidNoCredentials = createStaffMemberSchema.safeParse({
      fullName: "Không mật khẩu",
      employeeCode: "NV02",
      role: "MANAGER",
    });
    expect(invalidNoCredentials.success).toBe(false);
  });

  it("requires idempotencyKey UUID and at least one payment for POS invoice", () => {
    const valid = createInvoiceSchema.safeParse({
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
      branchId: "550e8400-e29b-41d4-a716-446655440001",
      shiftId: "550e8400-e29b-41d4-a716-446655440002",
      items: [
        {
          variantId: "550e8400-e29b-41d4-a716-446655440003",
          quantity: "2",
        },
      ],
      payments: [
        { method: "CASH", amount: "100000.00" },
        { method: "BANK_TRANSFER_QR", amount: "50000.00", referenceNo: "QR123" },
      ],
    });
    expect(valid.success).toBe(true);
  });

  it("validates Phase 2 catalog, purchase order, and stock count duplicate guards", () => {
    const dupSku = createProductSchema.safeParse({
      name: "Áo thun",
      variants: [
        { sku: "AT-01", name: "Đen M", costPrice: "50000", salePrice: "99000" },
        { sku: "at-01", name: "Trắng L", costPrice: "50000", salePrice: "99000" },
      ],
    });
    expect(dupSku.success).toBe(false);

    const dupPo = createPurchaseOrderSchema.safeParse({
      branchId: "550e8400-e29b-41d4-a716-446655440001",
      items: [
        { variantId: "550e8400-e29b-41d4-a716-446655440010", orderedQty: "5", unitCost: "10000" },
        { variantId: "550e8400-e29b-41d4-a716-446655440010", orderedQty: "3", unitCost: "12000" },
      ],
    });
    expect(dupPo.success).toBe(false);

    const validSc = createStockCountSchema.safeParse({
      branchId: "550e8400-e29b-41d4-a716-446655440001",
      items: [
        {
          variantId: "550e8400-e29b-41d4-a716-446655440010",
          actualQty: "12.5",
          reason: "Hư hỏng bao bì",
        },
      ],
    });
    expect(validSc.success).toBe(true);
  });
});
