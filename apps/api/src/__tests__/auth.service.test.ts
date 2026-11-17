import crypto from "node:crypto";
import {
  ConflictException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ERROR_CODES } from "@smart-pos/shared";
import { describe, expect, it, vi } from "vitest";
import { AuthService } from "../auth/auth.service";
import { TokenService } from "../auth/token.service";
import type { RateLimitService } from "../common/rate-limit/rate-limit.service";
import type { AppEnv } from "../config/env";
import type { PrismaService } from "../prisma/prisma.service";

function createTokenService(): TokenService {
  const values: Partial<AppEnv> = {
    JWT_ACCESS_SECRET: "auth_service_test_access_secret_32_chars",
    JWT_REFRESH_SECRET: "auth_service_test_refresh_secret_32_chars",
    JWT_ACCESS_EXPIRES_IN: "15m",
    JWT_REFRESH_EXPIRES_IN: "7d",
  };
  return new TokenService({
    get: (key: keyof AppEnv) => values[key],
  } as unknown as ConfigService<AppEnv, true>);
}

describe("AuthService", () => {
  const tokenService = createTokenService();
  const ids = {
    planId: crypto.randomUUID(),
    tenantId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    branchId: crypto.randomUUID(),
    memberId: crypto.randomUUID(),
  };

  it("registers a tenant, default branch CN01, OWNER01 member, and sets RLS context atomically", async () => {
    const rateLimitService = {
      enforceOrThrow: vi.fn().mockResolvedValue(undefined),
    } as unknown as RateLimitService;

    const executeRaw = vi.fn().mockResolvedValue(1);
    const createBranch = vi.fn().mockResolvedValue({
      id: ids.branchId,
      code: "CN01",
      name: "Chi nhánh 1",
      address: null,
      phone: "0901234567",
      isDefault: true,
      isActive: true,
    });
    const createMember = vi.fn().mockResolvedValue({
      id: ids.memberId,
      employeeCode: "OWNER01",
      role: "OWNER",
      permissions: {},
      allowedBranchIds: [],
    });
    const createSession = vi.fn().mockResolvedValue({ id: crypto.randomUUID() });

    const prisma = {
      subscriptionPlan: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: ids.planId, code: "FREE_TRIAL" }),
      },
      tenant: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn(
        async (cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            tenant: {
              create: vi.fn().mockResolvedValue({
                id: ids.tenantId,
                slug: "shop-test",
                name: "Shop Test",
                businessType: "RETAIL",
                status: "ACTIVE",
              }),
            },
            user: {
              create: vi.fn().mockResolvedValue({
                id: ids.userId,
                email: "owner@example.com",
                fullName: "Chủ Shop",
              }),
            },
            $executeRaw: executeRaw,
            branch: { create: createBranch },
            tenantMember: { create: createMember },
            refreshSession: { create: createSession },
          }),
      ),
    } as unknown as PrismaService;

    const service = new AuthService(prisma, tokenService, rateLimitService);

    const result = await service.registerTenant(
      {
        shopName: "Shop Test",
        tenantSlug: "shop-test",
        businessType: "RETAIL",
        ownerName: "Chủ Shop",
        email: "owner@example.com",
        password: "Password123!",
        phone: "0901234567",
        branchName: "Chi nhánh 1",
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(createBranch).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: ids.tenantId,
          code: "CN01",
          isDefault: true,
        }),
      }),
    );
    expect(createMember).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: ids.tenantId,
          employeeCode: "OWNER01",
          role: "OWNER",
        }),
      }),
    );
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(result.session.redirectTo).toBe("/dashboard");
    expect(result.session.tenant.slug).toBe("shop-test");
    expect(result.session.member.role).toBe("OWNER");
  });

  it("rejects duplicate tenantSlug during registration", async () => {
    const rateLimitService = {
      enforceOrThrow: vi.fn().mockResolvedValue(undefined),
    } as unknown as RateLimitService;

    const prisma = {
      subscriptionPlan: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: ids.planId, code: "FREE_TRIAL" }),
      },
      tenant: {
        findUnique: vi.fn().mockResolvedValue({ id: ids.tenantId }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaService;

    const service = new AuthService(prisma, tokenService, rateLimitService);

    await expect(
      service.registerTenant(
        {
          shopName: "Shop Test",
          tenantSlug: "taken-slug",
          businessType: "RETAIL",
          ownerName: "Chủ Shop",
          email: "owner@example.com",
          password: "Password123!",
          phone: "0901234567",
          branchName: "CN",
        },
        { ipAddress: "127.0.0.1" },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("logs cashier in via PIN and directs to /pos while honoring allowedBranchIds", async () => {
    const pinHash = await tokenService.hashSecret("123456");
    const rateLimitService = {
      enforceOrThrow: vi.fn().mockResolvedValue(undefined),
    } as unknown as RateLimitService;

    const branchFindMany = vi.fn().mockResolvedValue([
      {
        id: ids.branchId,
        code: "CN01",
        name: "Quầy 1",
        address: null,
        phone: null,
        isDefault: true,
        isActive: true,
      },
    ]);

    const txMock = {
      tenantMember: {
        findFirst: vi.fn().mockResolvedValue({
          id: ids.memberId,
          employeeCode: "TN01",
          pinHash,
          role: "CASHIER",
          permissions: {},
          allowedBranchIds: [ids.branchId],
          user: {
            id: ids.userId,
            email: null,
            fullName: "Thu Ngân A",
          },
        }),
      },
      branch: { findMany: branchFindMany },
      refreshSession: {
        create: vi.fn().mockResolvedValue({ id: crypto.randomUUID() }),
      },
    };

    const prisma = {
      tenant: {
        findFirst: vi.fn().mockResolvedValue({
          id: ids.tenantId,
          slug: "shop-test",
          name: "Shop Test",
          businessType: "RETAIL",
          status: "ACTIVE",
          plan: { code: "FREE_TRIAL" },
        }),
      },
      withTenantTransaction: vi.fn(
        async (_tenantId: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb(txMock),
      ),
    } as unknown as PrismaService;

    const service = new AuthService(prisma, tokenService, rateLimitService);
    const result = await service.loginWithCashierPin(
      { tenantSlug: "shop-test", employeeCode: "TN01", pin: "123456" },
      { ipAddress: "127.0.0.1" },
    );

    expect(result.session.redirectTo).toBe("/pos");
    expect(result.session.member.employeeCode).toBe("TN01");
    expect(branchFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, id: { in: [ids.branchId] } },
      }),
    );
  });

  it("propagates 429 rate-limit block on cashier PIN brute-force attempts", async () => {
    const rateLimitService = {
      enforceOrThrow: vi.fn().mockRejectedValue(
        new HttpException(
          {
            code: ERROR_CODES.AUTH_RATE_LIMITED,
            message: "Too many attempts",
          },
          HttpStatus.TOO_MANY_REQUESTS,
        ),
      ),
    } as unknown as RateLimitService;

    const service = new AuthService(
      {} as PrismaService,
      tokenService,
      rateLimitService,
    );

    await expect(
      service.loginWithCashierPin(
        { tenantSlug: "shop-test", employeeCode: "TN01", pin: "0000" },
        { ipAddress: "127.0.0.1" },
      ),
    ).rejects.toThrowError(HttpException);
  });

  it("rotates refresh tokens atomically and revokes the full family when token reuse is detected", async () => {
    const familyId = crypto.randomUUID();
    const tokenId = crypto.randomUUID();
    const signedRefresh = tokenService.signRefreshToken({
      tokenId,
      userId: ids.userId,
      memberId: ids.memberId,
      tenantId: ids.tenantId,
      familyId,
    });

    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const createSession = vi.fn().mockResolvedValue({ id: crypto.randomUUID() });
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ id: tokenId }])
      .mockResolvedValueOnce([]);

    const txMock = {
      $queryRaw: queryRaw,
      refreshSession: {
        updateMany,
        create: createSession,
      },
      tenantMember: {
        findFirst: vi.fn().mockResolvedValue({
          id: ids.memberId,
          employeeCode: "OWNER01",
          role: "OWNER",
          permissions: {},
          allowedBranchIds: [],
          user: {
            id: ids.userId,
            email: "owner@example.com",
            fullName: "Chủ Shop",
          },
        }),
      },
      branch: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const prisma = {
      tenant: {
        findFirst: vi.fn().mockResolvedValue({
          id: ids.tenantId,
          slug: "shop-test",
          name: "Shop Test",
          businessType: "RETAIL",
          status: "ACTIVE",
          plan: { code: "FREE_TRIAL" },
        }),
      },
      withTenantTransaction: vi.fn(
        async (_tenantId: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb(txMock),
      ),
    } as unknown as PrismaService;

    const rateLimitService = {
      enforceOrThrow: vi.fn().mockResolvedValue(undefined),
    } as unknown as RateLimitService;

    const service = new AuthService(prisma, tokenService, rateLimitService);

    // First legitimate refresh succeeds and keeps the same familyId.
    const rotated = await service.refreshSession(signedRefresh.token, {
      ipAddress: "127.0.0.1",
    });
    expect(rotated.session.accessToken).toBeTruthy();
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ familyId }),
      }),
    );

    // Reusing the already-consumed refresh token commits family revocation before throwing 401.
    await expect(
      service.refreshSession(signedRefresh.token, { ipAddress: "127.0.0.1" }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const txSpy = prisma.withTenantTransaction as unknown as ReturnType<typeof vi.fn>;
    await expect(txSpy.mock.results[1]?.value).resolves.toEqual({
      status: "revoked",
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { familyId, revokedAt: null },
      }),
    );
  });
});
