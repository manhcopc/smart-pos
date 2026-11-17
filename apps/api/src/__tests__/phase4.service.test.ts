import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PERMISSIONS } from "@smart-pos/shared";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedContext } from "../auth/auth.types";
import { TokenService } from "../auth/token.service";
import type { RateLimitService } from "../common/rate-limit/rate-limit.service";
import type { AppEnv } from "../config/env";
import { CustomersService } from "../customers/customers.service";
import { StockTransfersService } from "../inventory/stock-transfers.service";
import type { BullMqJobsService } from "../jobs/bullmq-jobs.service";
import { PosCheckoutService } from "../pos/pos-checkout.service";
import { PosEventsService } from "../pos/pos-events.service";
import { PosReturnsService } from "../pos/pos-returns.service";
import { PosSupervisorService } from "../pos/pos-supervisor.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { RedisService } from "../redis/redis.service";
import { ReportExportsService } from "../reports/report-exports.service";

function createTokenService(): TokenService {
  const values: Partial<AppEnv> = {
    JWT_ACCESS_SECRET: "phase4_test_access_secret_key_32_characters",
    JWT_REFRESH_SECRET: "phase4_test_refresh_secret_key_32_characters",
    JWT_ACCESS_EXPIRES_IN: "15m",
    JWT_REFRESH_EXPIRES_IN: "7d",
  };
  return new TokenService({
    get: (key: keyof AppEnv) => values[key],
  } as unknown as ConfigService<AppEnv, true>);
}

function createPosEvents(): PosEventsService {
  const dummyRedis = {
    getClient: () => ({
      publish: vi.fn().mockResolvedValue(1),
      duplicate: () => ({
        status: "ready",
        subscribe: vi.fn(),
        on: vi.fn(),
        quit: vi.fn(),
      }),
    }),
  } as unknown as RedisService;
  return new PosEventsService(
    dummyRedis,
    { get: () => "redis://localhost:6379" } as unknown as ConfigService<
      AppEnv,
      true
    >,
  );
}

describe("Phase 4 backend services", () => {
  const tenantId = crypto.randomUUID();
  const branchA = crypto.randomUUID();
  const branchB = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  const invoiceId = crypto.randomUUID();
  const tokenService = createTokenService();

  const cashierAuth: AuthenticatedContext = {
    userId: crypto.randomUUID(),
    memberId: crypto.randomUUID(),
    tenantId,
    tenantSlug: "shop-p4",
    role: "CASHIER",
    familyId: crypto.randomUUID(),
    effectivePermissions: new Set([
      PERMISSIONS.POS_SELL,
      PERMISSIONS.POS_SHIFT_MANAGE,
      PERMISSIONS.CUSTOMER_VIEW,
    ]),
    allowedBranchIds: [],
  };

  const managerAuth: AuthenticatedContext = {
    userId: crypto.randomUUID(),
    memberId: crypto.randomUUID(),
    tenantId,
    tenantSlug: "shop-p4",
    role: "MANAGER",
    familyId: crypto.randomUUID(),
    effectivePermissions: new Set(Object.values(PERMISSIONS)),
    allowedBranchIds: [],
  };

  it("issues scoped Supervisor Approval Tokens via PIN and enforces branch & permission bounds", async () => {
    const managerPinHash = await tokenService.hashSecret("9988");
    const prisma = {
      withTenantTransaction: vi.fn(
        async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            branch: {
              findFirst: vi
                .fn()
                .mockResolvedValue({ id: branchA, code: "CN1", name: "CN1", isActive: true }),
            },
            tenantMember: {
              findMany: vi.fn().mockResolvedValue([
                {
                  id: managerAuth.memberId,
                  employeeCode: "QL01",
                  pinHash: managerPinHash,
                  role: "MANAGER",
                  permissions: {},
                  allowedBranchIds: [branchA],
                  user: { fullName: "Quản lý A" },
                },
              ]),
            },
          }),
      ),
    } as unknown as PrismaService;

    const rateLimit = {
      enforceOrThrow: vi.fn().mockResolvedValue(undefined),
    } as unknown as RateLimitService;

    const supService = new PosSupervisorService(
      prisma,
      tokenService,
      rateLimit,
    );

    const approval = await supService.approveWithPin(
      cashierAuth,
      { branchId: branchA, permission: "pos:price_override", pin: "9988" },
      { ipAddress: "127.0.0.1" },
    );

    expect(approval.approverEmployeeCode).toBe("QL01");

    const resolved = supService.resolvePermissionOrApproval(
      cashierAuth,
      PERMISSIONS.POS_PRICE_OVERRIDE,
      branchA,
      approval.approvalToken,
    );
    expect(resolved.approvedByMemberId).toBe(managerAuth.memberId);

    expect(() =>
      supService.resolvePermissionOrApproval(
        cashierAuth,
        PERMISSIONS.POS_REFUND,
        branchA,
        approval.approvalToken,
      ),
    ).toThrowError(ForbiddenException);
  });

  it("blocks LOYALTY_POINTS checkout when customer lacks points atomically", async () => {
    const prisma = {
      withTenantTransaction: vi.fn(
        async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            invoice: { findFirst: vi.fn().mockResolvedValue(null) },
            branch: {
              findFirst: vi
                .fn()
                .mockResolvedValue({ id: branchA, code: "CN1", name: "CN1", isActive: true }),
            },
            customer: { findFirst: vi.fn().mockResolvedValue({ id: customerId }) },
            productVariant: {
              findMany: vi.fn().mockResolvedValue([
                {
                  id: variantId,
                  sku: "SKU-L",
                  name: "L",
                  costPrice: new Prisma.Decimal("10000.00"),
                  salePrice: new Prisma.Decimal("50000.00"),
                  taxRate: new Prisma.Decimal("0.00"),
                  product: { name: "SP" },
                },
              ]),
            },
            $queryRaw: vi
              .fn()
              .mockResolvedValueOnce([
                { id: crypto.randomUUID(), branch_id: branchA, status: "OPEN" },
              ])
              .mockResolvedValueOnce([]), // Customer UPDATE returns empty -> insufficient points
          }),
      ),
    } as unknown as PrismaService;

    const checkoutSvc = new PosCheckoutService(prisma, createPosEvents());
    await expect(
      checkoutSvc.checkout(
        managerAuth,
        {
          idempotencyKey: crypto.randomUUID(),
          branchId: branchA,
          shiftId: crypto.randomUUID(),
          customerId,
          discountAmount: "0.00",
          syncSource: "ONLINE",
          items: [{ variantId, quantity: "1", discountAmount: "0.00" }],
          payments: [{ method: "LOYALTY_POINTS", amount: "50000.00" }],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("processes partial sales return with atomic returned_qty guard and rejects invalid invoice void", async () => {
    const invoiceItemId = crypto.randomUUID();
    const rateLimit = { enforceOrThrow: vi.fn() } as unknown as RateLimitService;
    const supService = new PosSupervisorService(
      {} as PrismaService,
      tokenService,
      rateLimit,
    );
    const { token: refundToken } = tokenService.signSupervisorApprovalToken({
      approverMemberId: managerAuth.memberId,
      approverName: "Quản lý A",
      approverEmployeeCode: "QL01",
      tenantId,
      branchId: branchA,
      permission: PERMISSIONS.POS_REFUND,
    });

    const ledgerCreate = vi.fn().mockResolvedValue({ id: crypto.randomUUID() });
    const auditCreate = vi.fn().mockResolvedValue({ id: crypto.randomUUID() });

    const prismaReturn = {
      withTenantTransaction: vi.fn(
        async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            branch: {
              findFirst: vi
                .fn()
                .mockResolvedValue({ id: branchA, code: "CN1", name: "CN1", isActive: true }),
            },
            invoice: {
              update: vi.fn().mockResolvedValue({ id: invoiceId }),
            },
            invoiceItem: {
              findMany: vi
                .fn()
                .mockResolvedValueOnce([
                  {
                    id: invoiceItemId,
                    variantId,
                    quantity: new Prisma.Decimal("3.000"),
                    returnedQty: new Prisma.Decimal("0.000"),
                    taxAmount: new Prisma.Decimal("0.00"),
                    lineTotal: new Prisma.Decimal("150000.00"),
                    unitCostSnapshot: new Prisma.Decimal("25000.00"),
                  },
                ])
                .mockResolvedValueOnce([
                  {
                    quantity: new Prisma.Decimal("3.000"),
                    returnedQty: new Prisma.Decimal("1.000"),
                  },
                ]),
            },
            invoicePayment: {
              findMany: vi.fn().mockResolvedValue([
                { method: "CASH", amount: new Prisma.Decimal("150000.00") },
              ]),
            },
            salesReturn: {
              aggregate: vi.fn().mockResolvedValue({ _sum: { totalRefundAmount: null } }),
              create: vi.fn().mockResolvedValue({
                id: crypto.randomUUID(),
                code: "TH-261117-ABC",
                branchId: branchA,
                invoiceId,
                shiftId: null,
                status: "COMPLETED",
                totalRefundAmount: new Prisma.Decimal("50000.00"),
                refundMethod: "CASH",
                reason: "Đổi size",
                createdAt: new Date(),
                branch: { name: "CN1" },
                invoice: { code: "HD-01", status: "PARTIAL_RETURNED" },
                processedBy: { user: { fullName: "Thu Ngân" } },
                items: [],
              }),
            },
            inventoryLedger: { create: ledgerCreate },
            auditLog: { create: auditCreate },
            $executeRaw: vi.fn().mockResolvedValue(1),
            $queryRaw: vi
              .fn()
              .mockResolvedValueOnce([
                {
                  id: invoiceId,
                  branch_id: branchA,
                  customer_id: null,
                  code: "HD-01",
                  status: "COMPLETED",
                  total_amount: "150000.00",
                },
              ])
              .mockResolvedValueOnce([{ id: invoiceItemId }])
              .mockResolvedValueOnce([]) // no open shift
              .mockResolvedValueOnce([
                { on_hand: "5.000", reserved: "0.000", avg_cost: "25000.00" },
              ]),
          }),
      ),
    } as unknown as PrismaService;

    const returnsSvc = new PosReturnsService(
      prismaReturn,
      createPosEvents(),
      supService,
    );

    const res = await returnsSvc.createReturn(
      cashierAuth,
      invoiceId,
      {
        refundMethod: "CASH",
        reason: "Đổi size",
        supervisorApprovalToken: refundToken,
        items: [{ invoiceItemId, quantity: "1" }],
      },
      { ipAddress: "127.0.0.1" },
    );

    expect(res.totalRefundAmount).toBe("50000.00");
    expect(res.invoiceStatus).toBe("PARTIAL_RETURNED");
    expect(ledgerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          movementType: "SALE_RETURN",
          qtyDelta: "1.000",
        }),
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "REFUND" }),
      }),
    );
  });

  it("receives inter-branch StockTransfer with AVCO update and produces downloadable BullMQ export workbook", async () => {
    const transferId = crypto.randomUUID();
    const exportJobId = crypto.randomUUID();

    const transferPrisma = {
      withTenantTransaction: vi.fn(
        async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            branch: {
              findFirst: vi
                .fn()
                .mockResolvedValue({ id: branchB, code: "CN2", name: "CN2", isActive: true }),
            },
            stockTransferItem: {
              findMany: vi.fn().mockResolvedValue([
                {
                  variantId,
                  quantity: new Prisma.Decimal("4.000"),
                  unitCost: new Prisma.Decimal("20000.00"),
                },
              ]),
            },
            stockTransfer: {
              update: vi.fn().mockResolvedValue({
                id: transferId,
                code: "CK-261117-01",
                status: "RECEIVED",
                fromBranchId: branchA,
                toBranchId: branchB,
                note: null,
                dispatchedAt: new Date(),
                receivedAt: new Date(),
                fromBranch: { name: "CN1" },
                toBranch: { name: "CN2" },
                createdByMember: { user: { fullName: "Thủ kho 1" } },
                receivedByMember: { user: { fullName: "Quản lý" } },
                items: [],
              }),
            },
            inventoryLedger: { create: vi.fn() },
            auditLog: { create: vi.fn() },
            $executeRaw: vi.fn().mockResolvedValue(1),
            $queryRaw: vi
              .fn()
              .mockResolvedValueOnce([
                {
                  id: transferId,
                  code: "CK-261117-01",
                  from_branch_id: branchA,
                  to_branch_id: branchB,
                  status: "IN_TRANSIT",
                  note: null,
                },
              ])
              .mockResolvedValueOnce([
                // Existing 4 @ 10,000 + incoming 4 @ 20,000 => AVCO 15,000.00!
                { on_hand: "4.000", reserved: "0.000", avg_cost: "10000.00" },
              ]),
          }),
      ),
    } as unknown as PrismaService;

    const bullMqMock = {
      enqueueTransferEvent: vi.fn().mockResolvedValue(undefined),
      registerReportExportProcessor: vi.fn(),
    } as unknown as BullMqJobsService;

    const transferSvc = new StockTransfersService(
      transferPrisma,
      createPosEvents(),
      bullMqMock,
    );
    const receivedTransfer = await transferSvc.receiveTransfer(
      managerAuth,
      transferId,
      {},
      {},
    );
    expect(receivedTransfer.status).toBe("RECEIVED");
    expect(bullMqMock.enqueueTransferEvent).toHaveBeenCalledWith({
      tenantId,
      transferId,
      event: "RECEIVED",
    });

    const exportUpdate = vi.fn().mockResolvedValue({ id: exportJobId });
    const exportPrisma = {
      withTenantTransaction: vi
        .fn()
        .mockImplementationOnce(async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            reportExportJob: {
              findFirst: vi.fn().mockResolvedValue({
                id: exportJobId,
                status: "PENDING",
                reportType: "DAILY_SUMMARY",
                filters: {},
                fileName: "daily.xlsx",
              }),
              update: vi.fn(),
            },
          }),
        )
        .mockImplementationOnce(async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            dailyBranchSummary: {
              findMany: vi.fn().mockResolvedValue([
                {
                  summaryDate: new Date("2026-11-17T00:00:00Z"),
                  invoiceCount: 3,
                  grossRevenue: new Prisma.Decimal("300000.00"),
                  discountTotal: new Prisma.Decimal("0.00"),
                  refundTotal: new Prisma.Decimal("0.00"),
                  netRevenue: new Prisma.Decimal("300000.00"),
                  cogsTotal: new Prisma.Decimal("150000.00"),
                  grossProfit: new Prisma.Decimal("150000.00"),
                  cashTotal: new Prisma.Decimal("300000.00"),
                  transferTotal: new Prisma.Decimal("0.00"),
                  cardTotal: new Prisma.Decimal("0.00"),
                  branch: { name: "CN1" },
                },
              ]),
            },
          }),
        )
        .mockImplementationOnce(async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            reportExportJob: { update: exportUpdate },
          }),
        ),
    } as unknown as PrismaService;

    const exportSvc = new ReportExportsService(exportPrisma, bullMqMock);
    await exportSvc.processExportJob({ tenantId, exportJobId });

    const outPath = path.resolve("/tmp/smart-pos-exports", tenantId, `${exportJobId}.xlsx`);
    const stat = await fs.stat(outPath);
    expect(stat.size).toBeGreaterThan(1000);
    expect(exportUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETED",
          rowCount: 1,
        }),
      }),
    );

    await fs.rm(path.resolve("/tmp/smart-pos-exports", tenantId), {
      recursive: true,
      force: true,
    });
  });

  it("blocks negative loyalty balance during manual CustomersService adjustment", async () => {
    const custPrisma = {
      withTenantTransaction: vi.fn(
        async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            customer: {
              findFirst: vi.fn().mockResolvedValue({
                id: customerId,
                code: "KH01",
                name: "Khách A",
                loyaltyPoints: 5,
              }),
            },
            $queryRaw: vi.fn().mockResolvedValue([]),
          }),
      ),
    } as unknown as PrismaService;

    const custSvc = new CustomersService(custPrisma);
    await expect(
      custSvc.adjustLoyaltyPoints(
        managerAuth,
        customerId,
        { pointsDelta: -10, reason: "Trừ điểm sai" },
        {},
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
