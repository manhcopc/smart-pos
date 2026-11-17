import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ERROR_CODES } from "@smart-pos/shared";
import type { AuthenticatedContext } from "../../auth/auth.types";

export interface LockedTenantQuota {
  maxBranches: number;
  maxUsers: number;
  maxSkus: number;
  storageQuotaMb: number;
}

/**
 * Lock the tenant row (`FOR UPDATE`) inside the active transaction to serialize
 * concurrent quota checks (branches, staff members, SKUs) and return plan limits.
 */
export async function lockTenantAndReadQuota(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<LockedTenantQuota> {
  const rows = await tx.$queryRaw<
    Array<{
      max_branches: number;
      max_users: number;
      max_skus: number;
      storage_quota_mb: number;
    }>
  >`
    SELECT sp.max_branches, sp.max_users, sp.max_skus, sp.storage_quota_mb
    FROM tenants t
    INNER JOIN subscription_plans sp ON sp.id = t.plan_id
    WHERE t.id = ${tenantId}::uuid
      AND t.deleted_at IS NULL
    FOR UPDATE OF t
  `;

  const row = rows[0];
  if (!row) {
    throw new ForbiddenException({
      code: ERROR_CODES.TENANT_NOT_FOUND,
      message: "Không tìm thấy thông tin cửa hàng",
    });
  }

  return {
    maxBranches: Number(row.max_branches),
    maxUsers: Number(row.max_users),
    maxSkus: Number(row.max_skus),
    storageQuotaMb: Number(row.storage_quota_mb),
  };
}

/**
 * Verify every branch ID exists in the current tenant-scoped transaction.
 * Deduplicates IDs before persisting onto `tenant_members.allowed_branch_ids`.
 */
export async function validateAndNormalizeBranchIds(
  tx: Prisma.TransactionClient,
  rawBranchIds: readonly string[],
): Promise<string[]> {
  const uniqueIds = Array.from(new Set(rawBranchIds));
  if (uniqueIds.length === 0) {
    return [];
  }

  const matchedCount = await tx.branch.count({
    where: { id: { in: uniqueIds } },
  });

  if (matchedCount !== uniqueIds.length) {
    throw new BadRequestException({
      code: ERROR_CODES.BRANCH_NOT_FOUND,
      message: "Một hoặc nhiều chi nhánh được chọn không thuộc cửa hàng này",
    });
  }

  return uniqueIds;
}

/**
 * Ensure a branch exists in the tenant, is active, and is within the actor's
 * allowedBranchIds scope when restricted.
 */
export async function assertBranchAccessibleInTx(
  tx: Prisma.TransactionClient,
  auth: AuthenticatedContext,
  branchId: string,
): Promise<{ id: string; code: string; name: string }> {
  if (
    auth.allowedBranchIds.length > 0 &&
    !auth.allowedBranchIds.includes(branchId)
  ) {
    throw new ForbiddenException({
      code: ERROR_CODES.BRANCH_ACCESS_DENIED,
      message: "Bạn không có quyền thao tác trên chi nhánh này",
    });
  }

  const branch = await tx.branch.findFirst({
    where: { id: branchId },
    select: { id: true, code: true, name: true, isActive: true },
  });

  if (!branch) {
    throw new NotFoundException({
      code: ERROR_CODES.BRANCH_NOT_FOUND,
      message: "Không tìm thấy chi nhánh",
    });
  }

  if (!branch.isActive) {
    throw new BadRequestException({
      code: ERROR_CODES.BRANCH_INACTIVE,
      message: "Chi nhánh này đã tạm ngưng hoạt động",
    });
  }

  return { id: branch.id, code: branch.code, name: branch.name };
}
