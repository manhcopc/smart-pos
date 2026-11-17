import crypto from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PERMISSIONS } from "@smart-pos/shared";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedContext } from "../auth/auth.types";
import { assertBranchAccessibleInTx } from "../common/tenant/tenant-quota.helper";
import { PurchaseOrdersService } from "../inventory/purchase-orders.service";
import { StockCountsService } from "../inventory/stock-counts.service";
import type { PrismaService } from "../prisma/prisma.service";

const ownerAuth: AuthenticatedContext = {
  userId: crypto.randomUUID(),
  memberId: crypto.randomUUID(),
  tenantId: crypto.randomUUID(),
  tenantSlug: "shop-p2",
  role: "OWNER",
  familyId: crypto.randomUUID(),
  effectivePermissions: new Set(Object.values(PERMISSIONS)),
  allowedBranchIds: [],
};

describe("Inventory, Purchase Orders (AVCO) & Stock Reconciliation", () => {
  const branchId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const poId = crypto.randomUUID();
  const stockCountId = crypto.randomUUID();

  it("blocks branch-restricted users from accessing unauthorized branches", async () => {
    const restrictedAuth: AuthenticatedContext = {
      ...ownerAuth,
      role: "WAREHOUSE",
      allowedBranchIds: [crypto.randomUUID()],
    };

    await expect(
      assertBranchAccessibleInTx({} as Prisma.TransactionClient, restrictedAuth, branchId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("computes Weighted Average Cost (AVCO) on PO completion, writes ledger, and blocks double completion", async () => {
    const ledgerCreate = vi.fn().mockResolvedValue({ id: crypto.randomUUID() });
    const variantUpdate = vi.fn().mockResolvedValue({ id: variantId });
    const executeRaw = vi.fn().mockResolvedValue(1);
    const queryRaw = vi
      .fn()
      // Claim PO DRAFT -> COMPLETED
      .mockResolvedValueOnce([{ id: poId }])
      // Lock branch_inventories row (current stock: 10 @ 10,000.00)
      .mockResolvedValueOnce([
        { on_hand: "10.000", reserved: "0.000", avg_cost: "10000.00" },
      ]);

    const poRecord = {
      id: poId,
      code: "PO-20261117-01",
      branchId,
      supplierId: null,
      status: "DRAFT",
      totalAmount: new Prisma.Decimal("65000.00"),
      paidAmount: new Prisma.Decimal("0.00"),
      completedAt: null,
      createdAt: new Date(),
      branch: { code: "CN01", name: "Chính" },
      supplier: null,
      createdBy: { user: { fullName: "Owner" } },
      items: [
        {
          id: crypto.randomUUID(),
          variantId,
          orderedQty: new Prisma.Decimal("5.000"),
          receivedQty: new Prisma.Decimal("0.000"),
          unitCost: new Prisma.Decimal("13000.00"),
          discount: new Prisma.Decimal("0.00"),
          variant: { sku: "CF-01", name: "Cà phê", unit: "Gói" },
        },
      ],
    };

    const prisma = {
      withTenantTransaction: vi.fn(
        async (_tenantId: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            branch: {
              findFirst: vi.fn().mockResolvedValue({
                id: branchId,
                code: "CN01",
                name: "Chính",
                isActive: true,
              }),
            },
            purchaseOrder: {
              findFirst: vi.fn().mockResolvedValue(poRecord),
              findFirstOrThrow: vi.fn().mockResolvedValue({
                ...poRecord,
                status: "COMPLETED",
                completedAt: new Date(),
              }),
            },
            $queryRaw: queryRaw,
            $executeRaw: executeRaw,
            productVariant: { update: variantUpdate },
            purchaseOrderItem: { update: vi.fn().mockResolvedValue({}) },
            inventoryLedger: { create: ledgerCreate },
          }),
      ),
    } as unknown as PrismaService;

    const poService = new PurchaseOrdersService(prisma);
    const completed = await poService.complete(ownerAuth, poId, {
      paidAmount: "65000.00",
    });

    expect(completed.status).toBe("COMPLETED");
    // New AVCO = (10 * 10000 + 5 * 13000) / 15 = 11000.00
    expect(variantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { costPrice: "11000.00" },
      }),
    );
    expect(ledgerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          movementType: "PURCHASE_IN",
          qtyBefore: "10.000",
          qtyDelta: "5.000",
          qtyAfter: "15.000",
          unitCost: "13000.00",
        }),
      }),
    );

    // Double completion claim returns empty -> ConflictException
    const doublePrisma = {
      withTenantTransaction: vi.fn(
        async (_tenantId: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            branch: {
              findFirst: vi.fn().mockResolvedValue({
                id: branchId,
                code: "CN01",
                name: "Chính",
                isActive: true,
              }),
            },
            purchaseOrder: {
              findFirst: vi.fn().mockResolvedValue(poRecord),
            },
            $queryRaw: vi.fn().mockResolvedValue([]),
          }),
      ),
    } as unknown as PrismaService;

    const doubleService = new PurchaseOrdersService(doublePrisma);
    await expect(
      doubleService.complete(ownerAuth, poId, {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("requires variance reason on stock count balancing and writes ledger + audit log", async () => {
    const scItem = {
      id: crypto.randomUUID(),
      variantId,
      systemQty: new Prisma.Decimal("10.000"),
      actualQty: new Prisma.Decimal("8.000"),
      varianceQty: new Prisma.Decimal("-2.000"),
      reason: null,
      variant: {
        sku: "CF-01",
        name: "Cà phê",
        unit: "Gói",
        costPrice: new Prisma.Decimal("11000.00"),
      },
    };

    const scRecord = {
      id: stockCountId,
      code: "KK-20261117-01",
      branchId,
      status: "DRAFT",
      balancedAt: null,
      createdAt: new Date(),
      branch: { code: "CN01", name: "Chính" },
      createdBy: { user: { fullName: "Owner" } },
      balancedBy: null,
      items: [scItem],
    };

    const prismaMissingReason = {
      withTenantTransaction: vi.fn(
        async (_tenantId: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            branch: {
              findFirst: vi.fn().mockResolvedValue({
                id: branchId,
                code: "CN01",
                name: "Chính",
                isActive: true,
              }),
            },
            stockCount: {
              findFirst: vi.fn().mockResolvedValue(scRecord),
            },
            $queryRaw: vi
              .fn()
              .mockResolvedValueOnce([{ id: stockCountId }])
              .mockResolvedValueOnce([
                { on_hand: "10.000", reserved: "0.000", avg_cost: "11000.00" },
              ]),
            $executeRaw: vi.fn().mockResolvedValue(1),
          }),
      ),
    } as unknown as PrismaService;

    const scServiceMissing = new StockCountsService(prismaMissingReason);
    await expect(
      scServiceMissing.balance(
        ownerAuth,
        stockCountId,
        {},
        { ipAddress: "127.0.0.1" },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    const ledgerCreate = vi.fn().mockResolvedValue({ id: crypto.randomUUID() });
    const auditCreate = vi.fn().mockResolvedValue({ id: crypto.randomUUID() });

    const prismaWithReason = {
      withTenantTransaction: vi.fn(
        async (_tenantId: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            branch: {
              findFirst: vi.fn().mockResolvedValue({
                id: branchId,
                code: "CN01",
                name: "Chính",
                isActive: true,
              }),
            },
            stockCount: {
              findFirst: vi.fn().mockResolvedValue(scRecord),
              findFirstOrThrow: vi.fn().mockResolvedValue({
                ...scRecord,
                status: "BALANCED",
                balancedAt: new Date(),
                balancedBy: { user: { fullName: "Owner" } },
              }),
            },
            stockCountItem: { update: vi.fn().mockResolvedValue({}) },
            $queryRaw: vi
              .fn()
              .mockResolvedValueOnce([{ id: stockCountId }])
              .mockResolvedValueOnce([
                { on_hand: "10.000", reserved: "0.000", avg_cost: "11000.00" },
              ]),
            $executeRaw: vi.fn().mockResolvedValue(1),
            inventoryLedger: { create: ledgerCreate },
            auditLog: { create: auditCreate },
          }),
      ),
    } as unknown as PrismaService;

    const scServiceOk = new StockCountsService(prismaWithReason);
    const result = await scServiceOk.balance(
      ownerAuth,
      stockCountId,
      { itemReasons: { [variantId]: "Hao hụt ẩm mốc" } },
      { ipAddress: "127.0.0.1" },
    );

    expect(result.status).toBe("BALANCED");
    expect(ledgerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          movementType: "STOCK_COUNT",
          qtyDelta: "-2.000",
          qtyBefore: "10.000",
          qtyAfter: "8.000",
        }),
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "STOCK_ADJUST",
          entityType: "stock_count",
          entityId: stockCountId,
        }),
      }),
    );
  });
});
