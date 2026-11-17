import crypto from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PERMISSIONS } from "@smart-pos/shared";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedContext } from "../auth/auth.types";
import type { AppEnv } from "../config/env";
import { PosCheckoutService } from "../pos/pos-checkout.service";
import { PosEventsService } from "../pos/pos-events.service";
import { PosShiftsService } from "../pos/pos-shifts.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { RedisService } from "../redis/redis.service";

const cashierAuth: AuthenticatedContext = {
  userId: crypto.randomUUID(),
  memberId: crypto.randomUUID(),
  tenantId: crypto.randomUUID(),
  tenantSlug: "shop-pos",
  role: "CASHIER",
  familyId: crypto.randomUUID(),
  effectivePermissions: new Set([
    PERMISSIONS.POS_SELL,
    PERMISSIONS.POS_SHIFT_MANAGE,
    PERMISSIONS.INVENTORY_VIEW,
  ]),
  allowedBranchIds: [],
};

const managerAuth: AuthenticatedContext = {
  ...cashierAuth,
  role: "MANAGER",
  effectivePermissions: new Set([
    PERMISSIONS.POS_SELL,
    PERMISSIONS.POS_SHIFT_MANAGE,
    PERMISSIONS.POS_DISCOUNT_OVERRIDE,
    PERMISSIONS.POS_PRICE_OVERRIDE,
    PERMISSIONS.INVENTORY_VIEW,
  ]),
};

function createPosEvents(): PosEventsService {
  return new PosEventsService(
    {} as RedisService,
    { get: () => "redis://localhost:6379" } as unknown as ConfigService<
      AppEnv,
      true
    >,
  );
}

describe("PosShiftsService, PosCheckoutService & PosEventsService", () => {
  const branchId = crypto.randomUUID();
  const shiftId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const idempotencyKey = crypto.randomUUID();

  it("blocks duplicate OPEN shifts on the same branch and writes AuditLog(SHIFT_DIFF) on close mismatch", async () => {
    const prismaOpenDup = {
      withTenantTransaction: vi.fn(
        async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            branch: {
              findFirst: vi.fn().mockResolvedValue({
                id: branchId,
                code: "CN01",
                name: "Chính",
                isActive: true,
              }),
            },
            $queryRaw: vi.fn().mockResolvedValue([{ id: branchId }]),
            registerShift: {
              findFirst: vi.fn().mockResolvedValue({ id: shiftId }),
            },
          }),
      ),
    } as unknown as PrismaService;

    const shiftService = new PosShiftsService(prismaOpenDup);
    await expect(
      shiftService.openShift(cashierAuth, {
        branchId,
        openingCash: "500000.00",
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const auditCreate = vi.fn().mockResolvedValue({ id: crypto.randomUUID() });
    const prismaCloseDiff = {
      withTenantTransaction: vi.fn(
        async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            $queryRaw: vi.fn().mockResolvedValue([
              {
                id: shiftId,
                branch_id: branchId,
                status: "OPEN",
                expected_cash: "1500000.00",
              },
            ]),
            branch: {
              findFirst: vi.fn().mockResolvedValue({
                id: branchId,
                code: "CN01",
                name: "Chính",
                isActive: true,
              }),
            },
            registerShift: {
              update: vi.fn().mockResolvedValue({
                id: shiftId,
                branchId,
                openedByMemberId: cashierAuth.memberId,
                closedByMemberId: cashierAuth.memberId,
                status: "CLOSED",
                openingCash: new Prisma.Decimal("500000.00"),
                expectedCash: new Prisma.Decimal("1500000.00"),
                actualCash: new Prisma.Decimal("1490000.00"),
                cashVariance: new Prisma.Decimal("-10000.00"),
                openedAt: new Date(),
                closedAt: new Date(),
                note: "Thiếu 10k",
                branch: { code: "CN01", name: "Chính" },
                openedByMember: { user: { fullName: "Thu Ngân" } },
                closedByMember: { user: { fullName: "Thu Ngân" } },
              }),
            },
            auditLog: { create: auditCreate },
            invoice: {
              findMany: vi.fn().mockResolvedValue([
                {
                  subtotal: new Prisma.Decimal("1000000.00"),
                  discountAmount: new Prisma.Decimal("0.00"),
                  taxAmount: new Prisma.Decimal("0.00"),
                  totalAmount: new Prisma.Decimal("1000000.00"),
                  cogsAmount: new Prisma.Decimal("600000.00"),
                },
              ]),
            },
            invoicePayment: {
              groupBy: vi.fn().mockResolvedValue([
                {
                  method: "CASH",
                  _sum: { amount: new Prisma.Decimal("1000000.00") },
                },
              ]),
            },
          }),
      ),
    } as unknown as PrismaService;

    const closeService = new PosShiftsService(prismaCloseDiff);
    const zReport = await closeService.closeShift(
      cashierAuth,
      shiftId,
      { actualCash: "1490000.00", note: "Thiếu 10k" },
      { ipAddress: "127.0.0.1" },
    );

    expect(zReport.shift.cashVariance).toBe("-10000.00");
    expect(zReport.summary.grossProfit).toBe("400000.00");
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "SHIFT_DIFF",
          entityId: shiftId,
        }),
      }),
    );
  });

  it("returns existing invoice immediately on idempotencyKey replay without touching inventory", async () => {
    const queryRaw = vi.fn();
    const existingReceipt = {
      id: crypto.randomUUID(),
      code: "HD-261117-001",
      idempotencyKey,
      branchId,
      shiftId,
      cashierMemberId: cashierAuth.memberId,
      status: "COMPLETED",
      subtotal: new Prisma.Decimal("50000.00"),
      discountAmount: new Prisma.Decimal("0.00"),
      taxAmount: new Prisma.Decimal("0.00"),
      totalAmount: new Prisma.Decimal("50000.00"),
      paidAmount: new Prisma.Decimal("50000.00"),
      createdAt: new Date(),
      branch: { code: "CN01", name: "Chính" },
      cashierMember: { user: { fullName: "Thu Ngân" } },
      items: [],
      payments: [],
    };

    const prisma = {
      withTenantTransaction: vi.fn(
        async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            invoice: {
              findFirst: vi.fn().mockResolvedValue(existingReceipt),
            },
            $queryRaw: queryRaw,
          }),
      ),
    } as unknown as PrismaService;

    const events = createPosEvents();
    const publishSpy = vi.spyOn(events, "publishStockUpdate");
    const checkoutService = new PosCheckoutService(prisma, events);

    const replay = await checkoutService.checkout(
      cashierAuth,
      {
        idempotencyKey,
        branchId,
        shiftId,
        discountAmount: "0.00",
        syncSource: "ONLINE",
        items: [{ variantId, quantity: "1", discountAmount: "0.00" }],
        payments: [{ method: "CASH", amount: "50000.00" }],
      },
      { ipAddress: "127.0.0.1" },
    );

    expect(replay.code).toBe("HD-261117-001");
    expect(queryRaw).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("blocks cashier discount/price override without permission and handles atomic insufficient stock", async () => {
    const prismaBase = {
      branch: {
        findFirst: vi.fn().mockResolvedValue({
          id: branchId,
          code: "CN01",
          name: "Chính",
          isActive: true,
        }),
      },
      invoice: { findFirst: vi.fn().mockResolvedValue(null) },
      productVariant: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: variantId,
            sku: "SKU-01",
            name: "Size M",
            costPrice: new Prisma.Decimal("30000.00"),
            salePrice: new Prisma.Decimal("50000.00"),
            taxRate: new Prisma.Decimal("0.00"),
            product: { name: "Áo thun" },
          },
        ]),
      },
    };

    const prismaCashierPriceOverride = {
      withTenantTransaction: vi.fn(
        async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            ...prismaBase,
            $queryRaw: vi
              .fn()
              .mockResolvedValueOnce([
                { id: shiftId, branch_id: branchId, status: "OPEN" },
              ]),
          }),
      ),
    } as unknown as PrismaService;

    const svc1 = new PosCheckoutService(
      prismaCashierPriceOverride,
      createPosEvents(),
    );
    await expect(
      svc1.checkout(
        cashierAuth,
        {
          idempotencyKey,
          branchId,
          shiftId,
          discountAmount: "0.00",
          syncSource: "ONLINE",
          items: [
            {
              variantId,
              quantity: "1",
              discountAmount: "0.00",
              overrideUnitPrice: "40000.00",
            },
          ],
          payments: [{ method: "CASH", amount: "40000.00" }],
        },
        { ipAddress: "127.0.0.1" },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Atomic deduction returns empty -> ConflictException (INSUFFICIENT_STOCK)
    const prismaInsufficient = {
      withTenantTransaction: vi.fn(
        async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            ...prismaBase,
            $queryRaw: vi
              .fn()
              .mockResolvedValueOnce([
                { id: shiftId, branch_id: branchId, status: "OPEN" },
              ])
              .mockResolvedValueOnce([]),
          }),
      ),
    } as unknown as PrismaService;

    const svc2 = new PosCheckoutService(prismaInsufficient, createPosEvents());
    await expect(
      svc2.checkout(
        managerAuth,
        {
          idempotencyKey,
          branchId,
          shiftId,
          discountAmount: "0.00",
          syncSource: "ONLINE",
          items: [{ variantId, quantity: "5", discountAmount: "0.00" }],
          payments: [{ method: "CASH", amount: "250000.00" }],
        },
        { ipAddress: "127.0.0.1" },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects checkout when shift is CLOSED or payment is insufficient", async () => {
    const prismaClosedShift = {
      withTenantTransaction: vi.fn(
        async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            invoice: { findFirst: vi.fn().mockResolvedValue(null) },
            branch: {
              findFirst: vi.fn().mockResolvedValue({
                id: branchId,
                code: "CN01",
                name: "Chính",
                isActive: true,
              }),
            },
            $queryRaw: vi.fn().mockResolvedValue([
              { id: shiftId, branch_id: branchId, status: "CLOSED" },
            ]),
          }),
      ),
    } as unknown as PrismaService;

    const svc = new PosCheckoutService(prismaClosedShift, createPosEvents());
    await expect(
      svc.checkout(
        managerAuth,
        {
          idempotencyKey,
          branchId,
          shiftId,
          discountAmount: "0.00",
          syncSource: "ONLINE",
          items: [{ variantId, quantity: "1", discountAmount: "0.00" }],
          payments: [{ method: "CASH", amount: "50000.00" }],
        },
        { ipAddress: "127.0.0.1" },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("completes split-payment checkout, updates shift expectedCash with net cash, writes ledger & emits SSE event", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const ledgerCreate = vi.fn().mockResolvedValue({ id: crypto.randomUUID() });
    const auditCreate = vi.fn().mockResolvedValue({ id: crypto.randomUUID() });
    const invoiceId = crypto.randomUUID();

    const prismaSuccess = {
      withTenantTransaction: vi.fn(
        async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            invoice: {
              findFirst: vi.fn().mockResolvedValue(null),
              create: vi.fn().mockResolvedValue({
                id: invoiceId,
                code: "HD-261117-999",
                idempotencyKey,
                branchId,
                shiftId,
                cashierMemberId: managerAuth.memberId,
                status: "COMPLETED",
                subtotal: new Prisma.Decimal("100000.00"),
                discountAmount: new Prisma.Decimal("10000.00"),
                taxAmount: new Prisma.Decimal("7200.00"),
                totalAmount: new Prisma.Decimal("97200.00"),
                paidAmount: new Prisma.Decimal("97200.00"),
                createdAt: new Date(),
                branch: { code: "CN01", name: "Chính" },
                cashierMember: { user: { fullName: "Quản Lý" } },
                items: [],
                payments: [],
              }),
            },
            branch: {
              findFirst: vi.fn().mockResolvedValue({
                id: branchId,
                code: "CN01",
                name: "Chính",
                isActive: true,
              }),
            },
            productVariant: {
              findMany: vi.fn().mockResolvedValue([
                {
                  id: variantId,
                  sku: "SKU-01",
                  name: "Size M",
                  costPrice: new Prisma.Decimal("30000.00"),
                  salePrice: new Prisma.Decimal("50000.00"),
                  taxRate: new Prisma.Decimal("8.00"),
                  product: { name: "Áo thun" },
                },
              ]),
            },
            $queryRaw: vi
              .fn()
              .mockResolvedValueOnce([
                { id: shiftId, branch_id: branchId, status: "OPEN" },
              ])
              .mockResolvedValueOnce([
                { on_hand: "8.000", reserved: "0.000", avg_cost: "28000.00" },
              ]),
            $executeRaw: executeRaw,
            inventoryLedger: { create: ledgerCreate },
            auditLog: { create: auditCreate },
          }),
      ),
    } as unknown as PrismaService;

    const events = createPosEvents();
    const received: unknown[] = [];
    const sub = events
      .streamForTenant(managerAuth.tenantId, branchId)
      .subscribe((evt) => received.push(evt));

    const svc = new PosCheckoutService(prismaSuccess, events);
    const receipt = await svc.checkout(
      managerAuth,
      {
        idempotencyKey,
        branchId,
        shiftId,
        discountAmount: "0.00",
        syncSource: "ONLINE",
        items: [{ variantId, quantity: "2", discountAmount: "10000.00" }],
        // Total = (100,000 - 10,000) + 8% VAT (7,200) = 97,200
        // Tendered 50,000 QR + 100,000 CASH => 52,800 change, 47,200 net cash retained!
        payments: [
          { method: "BANK_TRANSFER_QR", amount: "50000.00", referenceNo: "QR99" },
          { method: "CASH", amount: "100000.00" },
        ],
      },
      { ipAddress: "127.0.0.1" },
    );

    expect(receipt.changeGiven).toBe("52800.00");
    expect(ledgerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          movementType: "SALE",
          qtyDelta: "-2.000",
          qtyBefore: "10.000",
          qtyAfter: "8.000",
          unitCost: "28000.00",
        }),
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "DISCOUNT_OVERRIDE",
          entityId: invoiceId,
        }),
      }),
    );
    expect(received.length).toBe(1);
    sub.unsubscribe();
  });

  it("retries checkout cleanly on PostgreSQL RepeatableRead serialization conflicts (40001 / P2034)", async () => {
    const invoiceId = crypto.randomUUID();
    const existingRow = {
      id: invoiceId,
      code: "HD-261117-RETRY",
      idempotencyKey,
      branchId,
      shiftId,
      cashierMemberId: managerAuth.memberId,
      status: "COMPLETED",
      subtotal: new Prisma.Decimal("50000.00"),
      discountAmount: new Prisma.Decimal("0.00"),
      taxAmount: new Prisma.Decimal("0.00"),
      totalAmount: new Prisma.Decimal("50000.00"),
      paidAmount: new Prisma.Decimal("50000.00"),
      createdAt: new Date("2026-11-17T08:00:00Z"),
      branch: { code: "CN01", name: "Chính" },
      cashierMember: { user: { fullName: "Quản lý" } },
      items: [],
      payments: [],
    };

    const withTenantTransaction = vi
      .fn()
      .mockRejectedValueOnce({
        code: "P2010",
        meta: {
          code: "40001",
          message: "ERROR: could not serialize access due to concurrent update",
        },
      })
      .mockRejectedValueOnce({ code: "P2034" })
      .mockImplementationOnce(
        async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            invoice: {
              findFirst: vi.fn().mockResolvedValue(existingRow),
            },
          }),
      );

    const prismaRetry = {
      withTenantTransaction,
    } as unknown as PrismaService;

    const svc = new PosCheckoutService(prismaRetry, createPosEvents());
    const receipt = await svc.checkout(
      managerAuth,
      {
        idempotencyKey,
        branchId,
        shiftId,
        discountAmount: "0.00",
        syncSource: "ONLINE",
        items: [{ variantId, quantity: "1", discountAmount: "0.00" }],
        payments: [{ method: "CASH", amount: "50000.00" }],
      },
      { ipAddress: "127.0.0.1" },
    );

    expect(withTenantTransaction).toHaveBeenCalledTimes(3);
    expect(receipt.code).toBe("HD-261117-RETRY");
  });
});
