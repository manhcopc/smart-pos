import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ERROR_CODES } from "@smart-pos/shared";

export interface LockedTenantQuota {
  maxBranches: number;
  maxUsers: number;
}

/**
 * Lock the tenant row (`FOR UPDATE`) inside the active transaction to serialize
 * concurrent quota checks (branches / staff members) and return active plan limits.
 */
export async function lockTenantAndReadQuota(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<LockedTenantQuota> {
  const rows = await tx.$queryRaw<
    Array<{ max_branches: number; max_users: number }>
  >`
    SELECT sp.max_branches, sp.max_users
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
