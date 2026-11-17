import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  type BranchItem,
  type BranchListResponse,
  type CreateBranchInput,
  ERROR_CODES,
  PERMISSIONS,
  type UpdateBranchInput,
} from "@smart-pos/shared";
import type { AuthenticatedContext, RequestMeta } from "../auth/auth.types";
import { lockTenantAndReadQuota } from "../common/tenant/tenant-quota.helper";
import { PrismaService } from "../prisma/prisma.service";

interface BranchRow {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BRANCH_SELECT = {
  id: true,
  code: true,
  name: true,
  address: true,
  phone: true,
  isDefault: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BranchSelect;

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  async listBranches(auth: AuthenticatedContext): Promise<BranchListResponse> {
    const canManage =
      auth.effectivePermissions.has(PERMISSIONS.BRANCH_MANAGE) ||
      auth.effectivePermissions.has(PERMISSIONS.STAFF_MANAGE);

    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const [quota, activeCount, branches] = await Promise.all([
        this.readMaxBranches(tx, auth.tenantId),
        tx.branch.count({ where: { isActive: true } }),
        tx.branch.findMany({
          where: canManage
            ? undefined
            : {
                isActive: true,
                ...(auth.allowedBranchIds.length > 0
                  ? { id: { in: auth.allowedBranchIds } }
                  : {}),
              },
          select: BRANCH_SELECT,
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        }),
      ]);

      return {
        items: branches.map((row) => this.serializeBranch(row)),
        quota: {
          activeCount,
          maxBranches: quota,
        },
      };
    });
  }

  async createBranch(
    auth: AuthenticatedContext,
    input: CreateBranchInput,
    meta: RequestMeta,
  ): Promise<BranchItem> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const quota = await lockTenantAndReadQuota(tx, auth.tenantId);
      const activeCount = await tx.branch.count({ where: { isActive: true } });

      if (activeCount >= quota.maxBranches) {
        throw new ForbiddenException({
          code: ERROR_CODES.PLAN_QUOTA_EXCEEDED,
          message: `Gói hiện tại chỉ cho phép tối đa ${quota.maxBranches} chi nhánh đang hoạt động`,
        });
      }

      const duplicate = await tx.branch.findFirst({
        where: { code: input.code },
        select: { id: true },
      });

      if (duplicate) {
        throw new ConflictException({
          code: ERROR_CODES.BRANCH_CODE_TAKEN,
          message: `Mã chi nhánh "${input.code}" đã tồn tại`,
        });
      }

      if (input.isDefault) {
        await tx.branch.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }

      const created = await tx.branch.create({
        data: {
          tenantId: auth.tenantId,
          code: input.code,
          name: input.name,
          address: input.address ?? null,
          phone: input.phone ?? null,
          isDefault: input.isDefault,
          isActive: true,
        },
        select: BRANCH_SELECT,
      });

      await tx.auditLog.create({
        data: {
          tenantId: auth.tenantId,
          branchId: created.id,
          actorMemberId: auth.memberId,
          action: "BRANCH_CREATED",
          entityType: "branch",
          entityId: created.id,
          ipAddress: meta.ipAddress ?? null,
          metadata: {
            code: created.code,
            name: created.name,
            isDefault: created.isDefault,
          },
        },
      });

      return this.serializeBranch(created);
    });
  }

  async updateBranch(
    auth: AuthenticatedContext,
    branchId: string,
    input: UpdateBranchInput,
    meta: RequestMeta,
  ): Promise<BranchItem> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const quota = await lockTenantAndReadQuota(tx, auth.tenantId);

      const existing = await tx.branch.findFirst({
        where: { id: branchId },
        select: BRANCH_SELECT,
      });

      if (!existing) {
        throw new NotFoundException({
          code: ERROR_CODES.BRANCH_NOT_FOUND,
          message: "Không tìm thấy chi nhánh",
        });
      }

      const nextIsDefault = input.isDefault ?? existing.isDefault;
      const nextIsActive = input.isActive ?? existing.isActive;

      if (input.isDefault === false && existing.isDefault) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_ERROR,
          message:
            "Phải luôn có một chi nhánh mặc định. Hãy chọn chi nhánh mặc định khác trước.",
        });
      }

      if (!nextIsActive && nextIsDefault) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: "Không thể vô hiệu hóa chi nhánh mặc định",
        });
      }

      if (input.isActive === false && existing.isActive) {
        const activeCount = await tx.branch.count({ where: { isActive: true } });
        if (activeCount <= 1) {
          throw new BadRequestException({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: "Cửa hàng phải giữ ít nhất 1 chi nhánh đang hoạt động",
          });
        }
      }

      if (input.isActive === true && !existing.isActive) {
        const activeCount = await tx.branch.count({ where: { isActive: true } });
        if (activeCount >= quota.maxBranches) {
          throw new ForbiddenException({
            code: ERROR_CODES.PLAN_QUOTA_EXCEEDED,
            message: `Gói hiện tại chỉ cho phép tối đa ${quota.maxBranches} chi nhánh đang hoạt động`,
          });
        }
      }

      if (input.isDefault === true && !existing.isDefault) {
        await tx.branch.updateMany({
          where: { isDefault: true, id: { not: branchId } },
          data: { isDefault: false },
        });
      }

      const updated = await tx.branch.update({
        where: { id: branchId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.address !== undefined ? { address: input.address } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
        select: BRANCH_SELECT,
      });

      await tx.auditLog.create({
        data: {
          tenantId: auth.tenantId,
          branchId: updated.id,
          actorMemberId: auth.memberId,
          action: "BRANCH_UPDATED",
          entityType: "branch",
          entityId: updated.id,
          ipAddress: meta.ipAddress ?? null,
          metadata: {
            changedFields: Object.keys(input),
          },
        },
      });

      return this.serializeBranch(updated);
    });
  }

  private async readMaxBranches(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<number> {
    const tenant = await tx.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: { plan: { select: { maxBranches: true } } },
    });
    return tenant?.plan.maxBranches ?? 1;
  }

  private serializeBranch(row: BranchRow): BranchItem {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      address: row.address,
      phone: row.phone,
      isDefault: row.isDefault,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
