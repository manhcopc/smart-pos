import crypto from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { PERMISSIONS } from "@smart-pos/shared";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedContext } from "../auth/auth.types";
import type { TokenService } from "../auth/token.service";
import { BranchesService } from "../branches/branches.service";
import type { PrismaService } from "../prisma/prisma.service";
import { StaffService } from "../staff/staff.service";

const ownerAuth: AuthenticatedContext = {
  userId: crypto.randomUUID(),
  memberId: crypto.randomUUID(),
  tenantId: crypto.randomUUID(),
  tenantSlug: "shop-a",
  role: "OWNER",
  familyId: crypto.randomUUID(),
  effectivePermissions: new Set(Object.values(PERMISSIONS)),
  allowedBranchIds: [],
};

const managerAuth: AuthenticatedContext = {
  ...ownerAuth,
  role: "MANAGER",
};

describe("BranchesService & StaffService", () => {
  it("enforces plan maxBranches quota when creating branches", async () => {
    const prisma = {
      withTenantTransaction: vi.fn(
        async (_tenantId: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            $queryRaw: vi
              .fn()
              .mockResolvedValue([{ max_branches: 1, max_users: 2 }]),
            branch: {
              count: vi.fn().mockResolvedValue(1),
            },
          }),
      ),
    } as unknown as PrismaService;

    const service = new BranchesService(prisma);
    await expect(
      service.createBranch(
        ownerAuth,
        { code: "CN02", name: "Chi nhánh 2", isDefault: false },
        { ipAddress: "127.0.0.1" },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("prevents disabling the default branch or creating duplicate branch codes", async () => {
    const branchId = crypto.randomUUID();
    const prismaDisableDefault = {
      withTenantTransaction: vi.fn(
        async (_tenantId: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            $queryRaw: vi
              .fn()
              .mockResolvedValue([{ max_branches: 5, max_users: 5 }]),
            branch: {
              findFirst: vi.fn().mockResolvedValue({
                id: branchId,
                code: "CN01",
                name: "CN Mặc định",
                address: null,
                phone: null,
                isDefault: true,
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
              }),
            },
          }),
      ),
    } as unknown as PrismaService;

    const branchService = new BranchesService(prismaDisableDefault);
    await expect(
      branchService.updateBranch(
        ownerAuth,
        branchId,
        { isActive: false },
        { ipAddress: "127.0.0.1" },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    const prismaDuplicate = {
      withTenantTransaction: vi.fn(
        async (_tenantId: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            $queryRaw: vi
              .fn()
              .mockResolvedValue([{ max_branches: 5, max_users: 5 }]),
            branch: {
              count: vi.fn().mockResolvedValue(1),
              findFirst: vi.fn().mockResolvedValue({ id: branchId }),
            },
          }),
      ),
    } as unknown as PrismaService;

    const branchServiceDup = new BranchesService(prismaDuplicate);
    await expect(
      branchServiceDup.createBranch(
        ownerAuth,
        { code: "CN01", name: "Duplicate", isDefault: false },
        { ipAddress: "127.0.0.1" },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("blocks non-OWNER privilege escalation to OWNER", async () => {
    const tokenService = {
      hashSecret: vi.fn(),
    } as unknown as TokenService;

    const staffService = new StaffService({} as PrismaService, tokenService);

    await expect(
      staffService.createStaffMember(
        managerAuth,
        {
          fullName: "Rogue Owner",
          employeeCode: "ROGUE01",
          role: "OWNER",
          pin: "9999",
          allowedBranchIds: [],
        },
        { ipAddress: "127.0.0.1" },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tokenService.hashSecret).not.toHaveBeenCalled();
  });

  it("validates allowedBranchIds belong to tenant, writes audit log, and protects last active OWNER", async () => {
    const targetMemberId = crypto.randomUUID();
    const foreignBranchId = crypto.randomUUID();
    const tokenService = {
      hashSecret: vi.fn().mockResolvedValue("$argon2id$hashed"),
    } as unknown as TokenService;

    const prismaMissingBranch = {
      withTenantTransaction: vi.fn(
        async (_tenantId: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            $queryRaw: vi
              .fn()
              .mockResolvedValue([{ max_branches: 5, max_users: 5 }]),
            tenantMember: {
              count: vi.fn().mockResolvedValue(1),
              findFirst: vi.fn().mockResolvedValue(null),
            },
            user: {
              findUnique: vi.fn().mockResolvedValue(null),
            },
            branch: {
              count: vi.fn().mockResolvedValue(0),
            },
          }),
      ),
    } as unknown as PrismaService;

    const staffService = new StaffService(prismaMissingBranch, tokenService);
    await expect(
      staffService.createStaffMember(
        ownerAuth,
        {
          fullName: "Cashier 1",
          employeeCode: "TN01",
          role: "CASHIER",
          pin: "1234",
          allowedBranchIds: [foreignBranchId],
        },
        { ipAddress: "127.0.0.1" },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    const prismaLastOwner = {
      withTenantTransaction: vi.fn(
        async (_tenantId: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            $queryRaw: vi
              .fn()
              .mockResolvedValue([{ max_branches: 5, max_users: 5 }]),
            tenantMember: {
              findFirst: vi.fn().mockResolvedValue({
                id: targetMemberId,
                userId: ownerAuth.userId,
                employeeCode: "OWNER01",
                pinHash: null,
                role: "OWNER",
                permissions: {},
                allowedBranchIds: [],
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
                user: {
                  id: ownerAuth.userId,
                  fullName: "Owner",
                  email: "owner@example.com",
                  phone: "0901234567",
                },
              }),
              count: vi.fn().mockResolvedValue(1),
            },
          }),
      ),
    } as unknown as PrismaService;

    const staffServiceLastOwner = new StaffService(prismaLastOwner, tokenService);
    await expect(
      staffServiceLastOwner.updateStaffMember(
        ownerAuth,
        targetMemberId,
        { isActive: false },
        { ipAddress: "127.0.0.1" },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("revokes active sessions and logs MEMBER_UPDATED when deactivating a cashier", async () => {
    const cashierMemberId = crypto.randomUUID();
    const cashierUserId = crypto.randomUUID();
    const refreshRevoke = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn().mockResolvedValue({ id: crypto.randomUUID() });

    const prisma = {
      withTenantTransaction: vi.fn(
        async (_tenantId: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            $queryRaw: vi
              .fn()
              .mockResolvedValue([{ max_branches: 5, max_users: 5 }]),
            tenantMember: {
              findFirst: vi.fn().mockResolvedValue({
                id: cashierMemberId,
                userId: cashierUserId,
                employeeCode: "TN02",
                pinHash: "$argon2id$pin",
                role: "CASHIER",
                permissions: {},
                allowedBranchIds: [],
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
                user: {
                  id: cashierUserId,
                  fullName: "Cashier 2",
                  email: null,
                  phone: null,
                },
              }),
              update: vi.fn().mockResolvedValue({
                id: cashierMemberId,
                userId: cashierUserId,
                employeeCode: "TN02",
                pinHash: "$argon2id$pin",
                role: "CASHIER",
                permissions: {},
                allowedBranchIds: [],
                isActive: false,
                createdAt: new Date(),
                updatedAt: new Date(),
                user: {
                  id: cashierUserId,
                  fullName: "Cashier 2",
                  email: null,
                  phone: null,
                },
              }),
            },
            refreshSession: { updateMany: refreshRevoke },
            auditLog: { create: auditCreate },
          }),
      ),
    } as unknown as PrismaService;

    const staffService = new StaffService(prisma, {
      hashSecret: vi.fn(),
    } as unknown as TokenService);

    const result = await staffService.updateStaffMember(
      ownerAuth,
      cashierMemberId,
      { isActive: false },
      { ipAddress: "127.0.0.1" },
    );

    expect(result.isActive).toBe(false);
    expect(result.hasPin).toBe(true);
    expect(refreshRevoke).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { memberId: cashierMemberId, revokedAt: null },
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "MEMBER_UPDATED",
          entityId: cashierMemberId,
        }),
      }),
    );
  });
});
