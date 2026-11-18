import crypto from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Reflector } from "@nestjs/core";
import { Prisma } from "@prisma/client";
import { ERROR_CODES, PERMISSIONS } from "@smart-pos/shared";
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedContext } from "../auth/auth.types";
import { BillingService } from "../billing/billing.service";
import type { AppEnv } from "../config/env";
import { ApiKeyGuard } from "../integrations/api-key.guard";
import { IntegrationsService } from "../integrations/integrations.service";
import {
  assertSafeWebhookUrl,
  generateTenantApiKey,
  parseTenantApiKeyToken,
  signWebhookPayload,
} from "../integrations/webhook-security.helper";
import type { PosCheckoutService } from "../pos/pos-checkout.service";
import type { PosEventsService } from "../pos/pos-events.service";
import { PosOfflineSyncService } from "../pos/pos-offline-sync.service";
import type { PrismaService } from "../prisma/prisma.service";
import { ReportExportsService } from "../reports/report-exports.service";

describe("Phase 5 backend services", () => {
  const tenantId = crypto.randomUUID();
  const branchId = crypto.randomUUID();
  const shiftId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const memberId = crypto.randomUUID();

  const ownerAuth: AuthenticatedContext = {
    userId: crypto.randomUUID(),
    memberId,
    tenantId,
    tenantSlug: "shop-p5",
    role: "OWNER",
    familyId: crypto.randomUUID(),
    effectivePermissions: new Set(Object.values(PERMISSIONS)),
    allowedBranchIds: [],
  };

  it("PosOfflineSyncService syncs valid offline invoices and returns latestStock on INSUFFICIENT_STOCK conflict", async () => {
    const idempOk = crypto.randomUUID();
    const idempConflict = crypto.randomUUID();
    const checkoutMock = {
      checkout: vi
        .fn()
        .mockResolvedValueOnce({
          invoiceId: crypto.randomUUID(),
          invoiceCode: "HD-OFF-001",
          totalAmount: "50000.00",
        })
        .mockRejectedValueOnce(
          new ConflictException({
            code: ERROR_CODES.INSUFFICIENT_STOCK,
            message: "Không đủ tồn kho",
          }),
        ),
    } as unknown as PosCheckoutService;

    const prismaMock = {
      withTenantTransaction: vi.fn(
        async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            productVariant: {
              findMany: vi.fn().mockResolvedValue([
                {
                  id: variantId,
                  sku: "SKU-CAF-01",
                  branchInventories: [
                    {
                      onHand: new Prisma.Decimal("5.000"),
                      reserved: new Prisma.Decimal("2.000"),
                    },
                  ],
                },
              ]),
            },
          }),
      ),
    } as unknown as PrismaService;

    const svc = new PosOfflineSyncService(checkoutMock, prismaMock);
    const result = await svc.syncOfflineBatch(
      ownerAuth,
      {
        invoices: [
          {
            queuedAt: new Date().toISOString(),
            payload: {
              branchId,
              shiftId,
              idempotencyKey: idempOk,
              discountAmount: "0",
              syncSource: "OFFLINE_SYNC",
              items: [{ variantId, quantity: "1.000", discountAmount: "0" }],
              payments: [{ method: "CASH", amount: "50000" }],
            },
          },
          {
            queuedAt: new Date().toISOString(),
            payload: {
              branchId,
              shiftId,
              idempotencyKey: idempConflict,
              discountAmount: "0",
              syncSource: "OFFLINE_SYNC",
              items: [{ variantId, quantity: "10.000", discountAmount: "0" }],
              payments: [{ method: "CASH", amount: "500000" }],
            },
          },
        ],
      },
      { ipAddress: "127.0.0.1" },
    );

    expect(result.summary).toEqual({
      total: 2,
      synced: 1,
      conflicts: 1,
      failed: 0,
    });
    expect(result.results[0]?.status).toBe("SYNCED");
    expect(result.results[1]?.status).toBe("CONFLICT");
    expect(result.results[1]?.errorCode).toBe(ERROR_CODES.INSUFFICIENT_STOCK);
    expect(result.results[1]?.latestStock).toEqual([
      { variantId, sku: "SKU-CAF-01", available: "3.000" },
    ]);
  });

  it("BillingService blocks plan downgrade exceeding current quota and records PLAN_UPGRADED on upgrade", async () => {
    const litePlan = {
      id: crypto.randomUUID(),
      code: "LITE",
      name: "Gói Lite",
      priceMonthly: new Prisma.Decimal("290000.00"),
      maxBranches: 1,
      maxUsers: 5,
      maxSkus: 2000,
      storageQuotaMb: 1024,
      features: { posOffline: true },
    };
    const proPlan = {
      id: crypto.randomUUID(),
      code: "PRO",
      name: "Gói Pro",
      priceMonthly: new Prisma.Decimal("690000.00"),
      maxBranches: 10,
      maxUsers: 50,
      maxSkus: 50000,
      storageQuotaMb: 10240,
      features: { posOffline: true, omnichannelApi: true },
    };

    let activeBranchCount = 2;
    const tenantUpdate = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const billingCreate = vi.fn().mockImplementation(async (args) => ({
      id: crypto.randomUUID(),
      ...args.data,
      amount: new Prisma.Decimal(args.data.amount),
      createdAt: new Date(),
    }));

    const prismaMock = {
      subscriptionPlan: {
        findUnique: vi.fn().mockImplementation(async ({ where }) =>
          where.code === "LITE" ? litePlan : proPlan,
        ),
      },
      withTenantTransaction: vi.fn(
        async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            $executeRaw: vi.fn().mockResolvedValue(1),
            branch: { count: vi.fn().mockImplementation(async () => activeBranchCount) },
            tenantMember: { count: vi.fn().mockResolvedValue(2) },
            productVariant: { count: vi.fn().mockResolvedValue(20) },
            subscriptionBilling: { create: billingCreate },
            tenant: { update: tenantUpdate },
            auditLog: { create: auditCreate },
          }),
      ),
    } as unknown as PrismaService;

    const configMock = {
      get: vi.fn().mockReturnValue("phase5_billing_secret_32_characters_long"),
    } as unknown as ConfigService<AppEnv, true>;

    const service = new BillingService(prismaMock, configMock);

    await expect(
      service.subscribePlan(
        ownerAuth,
        {
          planCode: "LITE",
          billingMonths: 1,
          provider: "INTERNAL_QR",
          confirmImmediately: true,
        },
        { ipAddress: "127.0.0.1" },
      ),
    ).rejects.toThrow(ConflictException);

    activeBranchCount = 1;
    const upgraded = await service.subscribePlan(
      ownerAuth,
      {
        planCode: "PRO",
        billingMonths: 3,
        provider: "VNPAY",
        confirmImmediately: true,
      },
      { ipAddress: "127.0.0.1" },
    );

    expect(upgraded.planCode).toBe("PRO");
    expect(upgraded.amount).toBe("2070000.00");
    expect(upgraded.status).toBe("PAID");
    expect(tenantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ planId: proPlan.id, status: "ACTIVE" }),
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "PLAN_UPGRADED" }),
      }),
    );
  });

  it("BillingService validates HMAC webhook signature before activating pending billing", async () => {
    const billingId = crypto.randomUUID();
    const billingUpdate = vi.fn().mockResolvedValue({});
    const tenantUpdate = vi.fn().mockResolvedValue({});

    const prismaMock = {
      withTenantTransaction: vi.fn(
        async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            subscriptionBilling: {
              findFirst: vi.fn().mockResolvedValue({
                id: billingId,
                planCode: "PRO",
                status: "PENDING",
              }),
              update: billingUpdate,
            },
            subscriptionPlan: {
              findUnique: vi.fn().mockResolvedValue({
                id: "plan-pro-id",
                code: "PRO",
              }),
            },
            tenant: { update: tenantUpdate },
          }),
      ),
    } as unknown as PrismaService;

    const configMock = {
      get: vi.fn().mockReturnValue("phase5_webhook_hmac_secret_32_characters"),
    } as unknown as ConfigService<AppEnv, true>;

    const service = new BillingService(prismaMock, configMock);

    await expect(
      service.processPaymentWebhook({
        billingId,
        tenantId,
        status: "PAID",
        referenceNo: "VNP-999",
        signature: "00000000000000000000000000000000",
      }),
    ).rejects.toThrow(ForbiddenException);

    const validSig = service.signBillingWebhookPayload(billingId, tenantId, "PAID");
    const res = await service.processPaymentWebhook({
      billingId,
      tenantId,
      status: "PAID",
      referenceNo: "VNP-OK-1",
      signature: validSig,
    });
    expect(res).toEqual({ ok: true, status: "PAID" });
    expect(tenantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ planId: "plan-pro-id", status: "ACTIVE" }),
      }),
    );
  });

  it("Webhook SSRF guard blocks private IPs/localhost when ALLOW_LOCAL_WEBHOOKS is unset and parses API keys strictly", () => {
    const prev = process.env.ALLOW_LOCAL_WEBHOOKS;
    delete process.env.ALLOW_LOCAL_WEBHOOKS;
    try {
      expect(() => assertSafeWebhookUrl("http://localhost:8080/hook")).toThrow(
        BadRequestException,
      );
      expect(() =>
        assertSafeWebhookUrl("http://169.254.169.254/latest/meta-data"),
      ).toThrow(BadRequestException);
      expect(() => assertSafeWebhookUrl("http://10.0.0.5/webhook")).toThrow(
        BadRequestException,
      );
      expect(() =>
        assertSafeWebhookUrl("https://hooks.merchant.vn/smartpos"),
      ).not.toThrow();
    } finally {
      if (prev !== undefined) process.env.ALLOW_LOCAL_WEBHOOKS = prev;
    }

    const generated = generateTenantApiKey(tenantId);
    const parsed = parseTenantApiKeyToken(generated.plainTextKey);
    expect(parsed?.tenantId).toBe(tenantId);
    expect(parsed?.keyHash).toBe(generated.keyHash);
    expect(parseTenantApiKeyToken("spos_live_invalid")).toBeNull();
  });

  it("ApiKeyGuard isolates tenant lookup inside RLS transaction and enforces scopes", async () => {
    const generated = generateTenantApiKey(tenantId);
    const withTenantTransaction = vi.fn(
      async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          tenantApiKey: {
            findFirst: vi.fn().mockResolvedValue({
              id: "key-1",
              createdByMemberId: memberId,
              scopes: ["inventory:read"],
            }),
            update: vi.fn().mockResolvedValue({}),
          },
        }),
    );

    const prismaMock = {
      tenant: {
        findFirst: vi.fn().mockResolvedValue({ id: tenantId, status: "ACTIVE" }),
      },
      withTenantTransaction,
    } as unknown as PrismaService;

    const reflectorMock = {
      getAllAndOverride: vi.fn().mockReturnValue(["orders:write"]),
    } as unknown as Reflector;

    const guard = new ApiKeyGuard(prismaMock, reflectorMock);
    const req: Record<string, unknown> = {
      headers: { "x-api-key": generated.plainTextKey },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    };

    await expect(guard.canActivate(ctx as never)).rejects.toThrow(
      ForbiddenException,
    );
    expect(withTenantTransaction).toHaveBeenCalledWith(
      tenantId,
      expect.any(Function),
    );

    (reflectorMock.getAllAndOverride as ReturnType<typeof vi.fn>).mockReturnValue([
      "inventory:read",
    ]);
    await expect(guard.canActivate(ctx as never)).resolves.toBe(true);

    const badCtx = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    };
    await expect(guard.canActivate(badCtx as never)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("IntegrationsService signs webhook deliveries with HMAC-SHA256 and syncs omnichannel orders atomically", async () => {
    const deliveryUpdate = vi.fn().mockResolvedValue({});
    const invoiceCreate = vi.fn().mockResolvedValue({
      id: "inv-ext-1",
      createdAt: new Date("2026-11-17T10:00:00Z"),
    });
    const publishStockUpdate = vi.fn().mockResolvedValue(undefined);

    const prismaMock = {
      withTenantTransaction: vi.fn(
        async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            webhookEndpoint: {
              findMany: vi.fn().mockResolvedValue([
                {
                  id: "ep-1",
                  signingSecret: "whsec_test_1234567890",
                  targetUrl: "https://shop.example.vn/webhooks/smartpos",
                },
              ]),
            },
            webhookDelivery: {
              create: vi.fn().mockResolvedValue({}),
              update: deliveryUpdate,
            },
            invoice: {
              findFirst: vi.fn().mockResolvedValue(null),
              create: invoiceCreate,
            },
            branch: {
              findFirst: vi.fn().mockResolvedValue({
                id: branchId,
                code: "CN01",
                name: "Chi nhánh Trung tâm",
              }),
            },
            productVariant: {
              findMany: vi.fn().mockResolvedValue([
                {
                  id: variantId,
                  sku: "SKU-ECOM-1",
                  name: "Ly L",
                  salePrice: new Prisma.Decimal("45000.00"),
                  costPrice: new Prisma.Decimal("20000.00"),
                  taxRate: new Prisma.Decimal("0.00"),
                  product: { name: "Trà Đào" },
                },
              ]),
            },
            $queryRaw: vi.fn().mockResolvedValue([
              { on_hand: "8.000", reserved: "0.000", avg_cost: "20000.00" },
            ]),
            inventoryLedger: { create: vi.fn().mockResolvedValue({}) },
            $executeRaw: vi.fn().mockResolvedValue(1),
            auditLog: { create: vi.fn().mockResolvedValue({}) },
          }),
      ),
    } as unknown as PrismaService;

    const posEventsMock = {
      publishStockUpdate,
    } as unknown as PosEventsService;

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    try {
      const service = new IntegrationsService(
        prismaMock,
        undefined,
        posEventsMock,
      );

      const payload = { event: "STOCK_UPDATED", qty: "8.000" };
      await service.deliverWebhookBatch({
        tenantId,
        eventType: "STOCK_UPDATED",
        endpointId: "ep-1",
        payload,
      });

      const [, init] = fetchSpy.mock.calls[0]!;
      const expectedSig = signWebhookPayload(
        "whsec_test_1234567890",
        JSON.stringify(payload),
      );
      expect((init?.headers as Record<string, string>)["X-SmartPOS-Signature"]).toBe(
        expectedSig,
      );
      expect(deliveryUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "DELIVERED", httpStatus: 200 }),
        }),
      );

      const syncedOrder = await service.syncExternalOrder(
        {
          tenantId,
          apiKeyId: "key-1",
          createdByMemberId: memberId,
          scopes: new Set(["orders:write"]),
        },
        {
          externalOrderId: "SHOPEE-261117-01",
          channel: "SHOPEE",
          branchCode: "CN01",
          items: [{ sku: "SKU-ECOM-1", quantity: "2.000" }],
        },
        { ipAddress: "127.0.0.1" },
      );

      expect(syncedOrder.invoiceCode).toMatch(/^EC-/);
      expect(syncedOrder.totalAmount).toBe("90000.00");
      expect(syncedOrder.idempotentReplay).toBe(false);
      expect(publishStockUpdate).toHaveBeenCalledWith(
        tenantId,
        branchId,
        [{ variantId, onHand: "8.000", available: "8.000" }],
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("ReportExportsService builds 3-sheet ACCOUNTING_LEDGER workbook with Excel formula injection protection", async () => {
    const prismaMock = {
      withTenantTransaction: vi.fn(
        async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            invoice: {
              findMany: vi.fn().mockResolvedValue([
                {
                  code: "=SUM(1+1)",
                  status: "COMPLETED",
                  subtotal: new Prisma.Decimal("100000.00"),
                  discountAmount: new Prisma.Decimal("0.00"),
                  taxAmount: new Prisma.Decimal("10000.00"),
                  totalAmount: new Prisma.Decimal("110000.00"),
                  cogsAmount: new Prisma.Decimal("50000.00"),
                  createdAt: new Date("2026-11-17T08:00:00Z"),
                  branch: { name: "Chi nhánh 1" },
                  cashierMember: { user: { fullName: "Thu Ngân A" } },
                  customer: { name: "+HYPERLINK()" },
                  payments: [
                    { method: "CASH", amount: new Prisma.Decimal("110000.00") },
                  ],
                },
              ]),
            },
            salesReturn: {
              findMany: vi.fn().mockResolvedValue([]),
            },
            dailyBranchSummary: {
              findMany: vi.fn().mockResolvedValue([
                {
                  summaryDate: new Date("2026-11-17T00:00:00Z"),
                  invoiceCount: 1,
                  grossRevenue: new Prisma.Decimal("110000.00"),
                  discountTotal: new Prisma.Decimal("0.00"),
                  refundTotal: new Prisma.Decimal("0.00"),
                  netRevenue: new Prisma.Decimal("110000.00"),
                  cogsTotal: new Prisma.Decimal("50000.00"),
                  grossProfit: new Prisma.Decimal("60000.00"),
                  cashTotal: new Prisma.Decimal("110000.00"),
                  transferTotal: new Prisma.Decimal("0.00"),
                  cardTotal: new Prisma.Decimal("0.00"),
                  branch: { name: "Chi nhánh 1" },
                },
              ]),
            },
          }),
      ),
    } as unknown as PrismaService;

    const reportExports = new ReportExportsService(prismaMock);
    const { buffer, rowCount } =
      await reportExports.buildAccountingWorkbookBuffer(tenantId, {});
    expect(rowCount).toBe(2);

    const parsedWorkbook = new ExcelJS.Workbook();
    await parsedWorkbook.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(parsedWorkbook.worksheets.map((w) => w.name)).toEqual([
      "Hóa đơn & Thuế GTGT",
      "Trả hàng & Hoàn tiền",
      "Tổng hợp Kế toán theo ngày",
    ]);

    const firstSheet = parsedWorkbook.getWorksheet("Hóa đơn & Thuế GTGT")!;
    expect(firstSheet.getRow(2).getCell(1).value).toBe("'=SUM(1+1)");
    expect(firstSheet.getRow(2).getCell(5).value).toBe("'+HYPERLINK()");
  });
});
