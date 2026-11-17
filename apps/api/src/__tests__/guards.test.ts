import crypto from "node:crypto";
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS } from "@smart-pos/shared";
import { describe, expect, it, vi } from "vitest";
import { PERMISSIONS_METADATA_KEY } from "../auth/auth.decorators";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { TokenService } from "../auth/token.service";
import type { AppEnv } from "../config/env";
import type { PrismaService } from "../prisma/prisma.service";

function createTokenService(): TokenService {
  const values: Partial<AppEnv> = {
    JWT_ACCESS_SECRET: "guard_test_access_secret_key_32_characters",
    JWT_REFRESH_SECRET: "guard_test_refresh_secret_key_32_characters",
    JWT_ACCESS_EXPIRES_IN: "15m",
    JWT_REFRESH_EXPIRES_IN: "7d",
  };
  return new TokenService({
    get: (key: keyof AppEnv) => values[key],
  } as unknown as ConfigService<AppEnv, true>);
}

function makeHttpContext(req: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
    getHandler: () => (() => undefined) as unknown,
    getClass: () => class DummyController {},
  } as unknown as ExecutionContext;
}

describe("JwtAuthGuard & PermissionsGuard", () => {
  const tokenService = createTokenService();
  const ids = {
    userId: crypto.randomUUID(),
    memberId: crypto.randomUUID(),
    tenantId: crypto.randomUUID(),
    familyId: crypto.randomUUID(),
  };

  it("authenticates from cookie and applies DB role + permission overrides", async () => {
    const accessToken = tokenService.signAccessToken({
      userId: ids.userId,
      memberId: ids.memberId,
      tenantId: ids.tenantId,
      tenantSlug: "shop-a",
      role: "CASHIER",
      familyId: ids.familyId,
    });

    const prisma = {
      tenant: {
        findFirst: vi.fn().mockResolvedValue({
          id: ids.tenantId,
          slug: "shop-a",
          status: "ACTIVE",
        }),
      },
      withTenantTransaction: vi.fn(
        async (_tenantId: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            tenantMember: {
              findFirst: vi.fn().mockResolvedValue({
                id: ids.memberId,
                role: "CASHIER",
                permissions: {
                  grant: [PERMISSIONS.POS_DISCOUNT_OVERRIDE],
                  revoke: [PERMISSIONS.INVENTORY_VIEW],
                },
                allowedBranchIds: [],
              }),
            },
            refreshSession: {
              findFirst: vi.fn().mockResolvedValue({ id: crypto.randomUUID() }),
            },
          }),
      ),
    } as unknown as PrismaService;

    const guard = new JwtAuthGuard(tokenService, prisma);
    const request: Partial<AuthenticatedRequest> = {
      headers: {},
      cookies: { smartpos_access: accessToken },
    };

    const allowed = await guard.canActivate(makeHttpContext(request));
    expect(allowed).toBe(true);
    expect(request.auth?.effectivePermissions.has(PERMISSIONS.POS_DISCOUNT_OVERRIDE)).toBe(
      true,
    );
    expect(request.auth?.effectivePermissions.has(PERMISSIONS.INVENTORY_VIEW)).toBe(
      false,
    );
  });

  it("blocks suspended tenants with 403 and revoked sessions with 401", async () => {
    const accessToken = tokenService.signAccessToken({
      userId: ids.userId,
      memberId: ids.memberId,
      tenantId: ids.tenantId,
      tenantSlug: "shop-a",
      role: "OWNER",
      familyId: ids.familyId,
    });

    const suspendedPrisma = {
      tenant: {
        findFirst: vi.fn().mockResolvedValue({
          id: ids.tenantId,
          slug: "shop-a",
          status: "SUSPENDED",
        }),
      },
    } as unknown as PrismaService;

    const suspendedGuard = new JwtAuthGuard(tokenService, suspendedPrisma);
    await expect(
      suspendedGuard.canActivate(
        makeHttpContext({
          headers: { authorization: `Bearer ${accessToken}` },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const revokedPrisma = {
      tenant: {
        findFirst: vi.fn().mockResolvedValue({
          id: ids.tenantId,
          slug: "shop-a",
          status: "ACTIVE",
        }),
      },
      withTenantTransaction: vi.fn(
        async (_tenantId: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            tenantMember: {
              findFirst: vi.fn().mockResolvedValue({
                id: ids.memberId,
                role: "OWNER",
                permissions: {},
                allowedBranchIds: [],
              }),
            },
            refreshSession: {
              findFirst: vi.fn().mockResolvedValue(null),
            },
          }),
      ),
    } as unknown as PrismaService;

    const revokedGuard = new JwtAuthGuard(tokenService, revokedPrisma);
    await expect(
      revokedGuard.canActivate(
        makeHttpContext({
          headers: { authorization: `Bearer ${accessToken}` },
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("enforces @RequirePermissions via PermissionsGuard", () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) =>
        key === PERMISSIONS_METADATA_KEY ? [PERMISSIONS.BRANCH_MANAGE] : undefined,
      ),
    } as unknown as Reflector;

    const guard = new PermissionsGuard(reflector);

    expect(() =>
      guard.canActivate(
        makeHttpContext({
          auth: {
            userId: ids.userId,
            memberId: ids.memberId,
            tenantId: ids.tenantId,
            tenantSlug: "shop-a",
            role: "CASHIER",
            familyId: ids.familyId,
            effectivePermissions: new Set([PERMISSIONS.POS_SELL]),
            allowedBranchIds: [],
          },
        }),
      ),
    ).toThrowError(ForbiddenException);

    expect(
      guard.canActivate(
        makeHttpContext({
          auth: {
            userId: ids.userId,
            memberId: ids.memberId,
            tenantId: ids.tenantId,
            tenantSlug: "shop-a",
            role: "OWNER",
            familyId: ids.familyId,
            effectivePermissions: new Set([PERMISSIONS.BRANCH_MANAGE]),
            allowedBranchIds: [],
          },
        }),
      ),
    ).toBe(true);
  });
});
