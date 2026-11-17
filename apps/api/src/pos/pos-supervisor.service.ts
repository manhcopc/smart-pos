import { ForbiddenException, Injectable } from "@nestjs/common";
import {
  ERROR_CODES,
  type Permission,
  permissionOverridesSchema,
  resolvePermissions,
  type SupervisorApprovalResponse,
  type SupervisorPinVerifyInput,
} from "@smart-pos/shared";
import type { AuthenticatedContext, RequestMeta } from "../auth/auth.types";
import { TokenService } from "../auth/token.service";
import { RateLimitService } from "../common/rate-limit/rate-limit.service";
import { assertBranchAccessibleInTx } from "../common/tenant/tenant-quota.helper";
import { PrismaService } from "../prisma/prisma.service";

const SUPERVISOR_PIN_LIMIT = 8;
const SUPERVISOR_PIN_WINDOW_SECONDS = 300;

export interface ApprovalResolution {
  approvedByMemberId: string | null;
  approvedByName: string | null;
}

@Injectable()
export class PosSupervisorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  async approveWithPin(
    auth: AuthenticatedContext,
    input: SupervisorPinVerifyInput,
    meta: RequestMeta,
  ): Promise<SupervisorApprovalResponse> {
    const rateKey = `pos:sup-pin:${auth.tenantId}:${input.managerEmployeeCode ?? auth.memberId}:${meta.ipAddress ?? "unknown"}`;
    await this.rateLimitService.enforceOrThrow(
      rateKey,
      SUPERVISOR_PIN_LIMIT,
      SUPERVISOR_PIN_WINDOW_SECONDS,
    );

    const candidates = await this.prisma.withTenantTransaction(
      auth.tenantId,
      async (tx) => {
        await assertBranchAccessibleInTx(tx, auth, input.branchId);
        return tx.tenantMember.findMany({
          where: {
            isActive: true,
            pinHash: { not: null },
            ...(input.managerEmployeeCode
              ? { employeeCode: input.managerEmployeeCode }
              : {}),
          },
          select: {
            id: true,
            employeeCode: true,
            pinHash: true,
            role: true,
            permissions: true,
            allowedBranchIds: true,
            user: { select: { fullName: true } },
          },
          orderBy: { createdAt: "asc" },
        });
      },
    );

    const eligible = candidates.filter((member) => {
      if (
        member.allowedBranchIds.length > 0 &&
        !member.allowedBranchIds.includes(input.branchId)
      ) {
        return false;
      }
      const parsedOverrides = permissionOverridesSchema.safeParse(
        member.permissions,
      );
      const effective = resolvePermissions(
        member.role,
        parsedOverrides.success ? parsedOverrides.data : null,
      );
      return effective.has(input.permission);
    });

    for (const candidate of eligible) {
      if (!candidate.pinHash) continue;
      const matches = await this.tokenService.verifySecret(
        candidate.pinHash,
        input.pin,
      );
      if (matches) {
        const { token, expiresAt } =
          this.tokenService.signSupervisorApprovalToken({
            approverMemberId: candidate.id,
            approverName: candidate.user.fullName,
            approverEmployeeCode: candidate.employeeCode,
            tenantId: auth.tenantId,
            branchId: input.branchId,
            permission: input.permission,
          });

        return {
          approvalToken: token,
          approverMemberId: candidate.id,
          approverName: candidate.user.fullName,
          approverEmployeeCode: candidate.employeeCode,
          permission: input.permission,
          expiresAt: expiresAt.toISOString(),
        };
      }
    }

    throw new ForbiddenException({
      code: ERROR_CODES.INVALID_SUPERVISOR_PIN,
      message:
        "Mã PIN Quản lý không hợp lệ hoặc nhân sự không có quyền phê duyệt tại chi nhánh này",
    });
  }

  /**
   * Verify either the caller directly holds `permission`, or supplied a valid
   * short-lived SupervisorApprovalToken matching tenant, branch, and permission.
   */
  resolvePermissionOrApproval(
    auth: AuthenticatedContext,
    permission: Permission,
    branchId: string,
    supervisorApprovalToken?: string,
    forbiddenMessage = "Bạn không có quyền thực hiện thao tác này",
  ): ApprovalResolution {
    if (auth.effectivePermissions.has(permission)) {
      return { approvedByMemberId: null, approvedByName: null };
    }

    if (supervisorApprovalToken) {
      const claims = this.tokenService.verifySupervisorApprovalToken(
        supervisorApprovalToken,
        {
          tenantId: auth.tenantId,
          branchId,
          permission,
        },
      );
      return {
        approvedByMemberId: claims.approverMemberId,
        approvedByName: claims.approverName,
      };
    }

    throw new ForbiddenException({
      code: ERROR_CODES.AUTH_FORBIDDEN,
      message: forbiddenMessage,
    });
  }
}
