import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AuditLogItem, AuditLogQuery } from "@smart-pos/shared";
import type { AuthenticatedContext } from "../auth/auth.types";
import { assertBranchAccessibleInTx } from "../common/tenant/tenant-quota.helper";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAuditLogs(
    auth: AuthenticatedContext,
    query: AuditLogQuery,
  ): Promise<{
    items: AuditLogItem[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      if (query.branchId) {
        await assertBranchAccessibleInTx(tx, auth, query.branchId);
      }

      const branchClause: Prisma.AuditLogWhereInput = query.branchId
        ? { branchId: query.branchId }
        : auth.allowedBranchIds.length > 0
          ? {
              OR: [
                { branchId: { in: auth.allowedBranchIds } },
                { branchId: null },
              ],
            }
          : {};

      const createdAtFilter: Prisma.DateTimeFilter | undefined =
        query.from || query.to
          ? {
              ...(query.from
                ? { gte: new Date(`${query.from}T00:00:00+07:00`) }
                : {}),
              ...(query.to
                ? { lte: new Date(`${query.to}T23:59:59.999+07:00`) }
                : {}),
            }
          : undefined;

      const searchTerm = query.search?.trim();
      const where: Prisma.AuditLogWhereInput = {
        ...branchClause,
        ...(query.action ? { action: query.action } : {}),
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
        ...(searchTerm
          ? {
              OR: [
                { entityType: { contains: searchTerm, mode: "insensitive" } },
                {
                  actorMember: {
                    employeeCode: {
                      contains: searchTerm,
                      mode: "insensitive",
                    },
                  },
                },
                {
                  actorMember: {
                    user: {
                      fullName: { contains: searchTerm, mode: "insensitive" },
                    },
                  },
                },
              ],
            }
          : {}),
      };

      const skip = (query.page - 1) * query.limit;
      const [total, rows] = await Promise.all([
        tx.auditLog.count({ where }),
        tx.auditLog.findMany({
          where,
          select: {
            id: true,
            branchId: true,
            actorMemberId: true,
            action: true,
            entityType: true,
            entityId: true,
            metadata: true,
            ipAddress: true,
            createdAt: true,
            branch: { select: { name: true } },
            actorMember: {
              select: {
                employeeCode: true,
                user: { select: { fullName: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: query.limit,
        }),
      ]);

      return {
        items: rows.map((row) => ({
          id: row.id,
          branchId: row.branchId,
          branchName: row.branch?.name ?? null,
          actorMemberId: row.actorMemberId,
          actorName: row.actorMember.user.fullName,
          actorEmployeeCode: row.actorMember.employeeCode,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          metadata:
            row.metadata &&
            typeof row.metadata === "object" &&
            !Array.isArray(row.metadata)
              ? (row.metadata as Record<string, unknown>)
              : {},
          ipAddress: row.ipAddress,
          createdAt: row.createdAt.toISOString(),
        })),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.limit)),
        },
      };
    });
  }
}
