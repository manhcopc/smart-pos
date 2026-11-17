import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  GLOBAL_MODELS,
  TENANT_SCOPED_MODELS,
  createTenantScopedPrisma,
} from "../prisma/tenant-context";

const TENANT_A = "550e8400-e29b-41d4-a716-446655440001";
const TENANT_B = "550e8400-e29b-41d4-a716-446655440002";

function toCamelCase(modelName: string): string {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

describe("Prisma schema & tenant isolation guard", () => {
  it("classifies every model in schema.prisma as global or tenant-scoped", () => {
    const schemaPath = path.resolve(__dirname, "../../prisma/schema.prisma");
    const schemaSource = fs.readFileSync(schemaPath, "utf8");
    const modelMatches = [
      ...schemaSource.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm),
    ];

    expect(modelMatches.length).toBeGreaterThan(15);

    for (const [, modelName, body] of modelMatches) {
      if (!modelName || body === undefined) {
        throw new Error("Invalid regex match in schema.prisma");
      }
      const delegateName = toCamelCase(modelName);
      const isGlobal = GLOBAL_MODELS.has(delegateName);
      const isTenantScoped = TENANT_SCOPED_MODELS.has(delegateName);

      expect(isGlobal || isTenantScoped).toBe(true);
      expect(isGlobal && isTenantScoped).toBe(false);

      if (isTenantScoped) {
        expect(body).toMatch(/\btenantId\s+String\b/);
      }
    }
  });

  it("rejects invalid tenantId when building scoped client", () => {
    const fakeTx = {} as unknown as Prisma.TransactionClient;
    expect(() => createTenantScopedPrisma(fakeTx, "not-a-uuid")).toThrow(
      "Invalid tenantId format",
    );
  });

  it("injects tenantId on reads/creates and blocks cross-tenant tampering", async () => {
    const productDelegate = {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({ id: "p1", tenantId: TENANT_A }),
      findUnique: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: "p2", tenantId: TENANT_A }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const productVariantDelegate = {
      findUnique: vi.fn().mockResolvedValue({ id: "v1", tenantId: TENANT_A }),
    };
    const subscriptionPlanDelegate = {
      findMany: vi.fn().mockResolvedValue([]),
    };

    const fakeTx = {
      product: productDelegate,
      productVariant: productVariantDelegate,
      subscriptionPlan: subscriptionPlanDelegate,
    } as unknown as Prisma.TransactionClient;

    const scoped = createTenantScopedPrisma(fakeTx, TENANT_A);

    await scoped.product.findMany({ where: { isActive: true } });
    expect(productDelegate.findMany).toHaveBeenCalledWith({
      where: { isActive: true, tenantId: TENANT_A },
    });

    await scoped.product.findUnique({ where: { id: "prod-1" } });
    expect(productDelegate.findFirst).toHaveBeenCalledWith({
      where: { id: "prod-1", tenantId: TENANT_A },
    });
    expect(productDelegate.findUnique).not.toHaveBeenCalled();

    await scoped.productVariant.findUnique({
      where: { tenantId_sku: { tenantId: TENANT_A, sku: "SKU-1" } },
    });
    expect(productVariantDelegate.findUnique).toHaveBeenCalledWith({
      where: { tenantId_sku: { tenantId: TENANT_A, sku: "SKU-1" } },
    });

    await scoped.product.create({
      data: { name: "Cà phê rang" } as never,
    });
    expect(productDelegate.create).toHaveBeenCalledWith({
      data: { name: "Cà phê rang", tenantId: TENANT_A },
    });

    expect(() =>
      scoped.product.create({
        data: { name: "Sneaker", tenantId: TENANT_B } as never,
      }),
    ).toThrow("Cross-tenant mutation rejected");

    expect(() =>
      scoped.product.updateMany({
        where: { id: "prod-1" },
        data: { tenantId: TENANT_B } as never,
      }),
    ).toThrow("Changing tenantId on an existing record is forbidden");

    await scoped.subscriptionPlan.findMany();
    expect(subscriptionPlanDelegate.findMany).toHaveBeenCalledWith();
  });
});
