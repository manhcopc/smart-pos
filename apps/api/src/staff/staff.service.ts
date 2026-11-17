import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  type CreateStaffMemberInput,
  ERROR_CODES,
  permissionOverridesSchema,
  type PermissionOverridesInput,
  type Role,
  type StaffListResponse,
  type StaffMemberItem,
  type UpdateStaffMemberInput,
} from "@smart-pos/shared";
import type { AuthenticatedContext, RequestMeta } from "../auth/auth.types";
import { TokenService } from "../auth/token.service";
import {
  lockTenantAndReadQuota,
  validateAndNormalizeBranchIds,
} from "../common/tenant/tenant-quota.helper";
import { PrismaService } from "../prisma/prisma.service";

interface StaffMemberRow {
  id: string;
  userId: string;
  employeeCode: string;
  pinHash: string | null;
  role: Role;
  permissions: Prisma.JsonValue;
  allowedBranchIds: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
  };
}

const STAFF_SELECT = {
  id: true,
  userId: true,
  employeeCode: true,
  pinHash: true,
  role: true,
  permissions: true,
  allowedBranchIds: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
    },
  },
} satisfies Prisma.TenantMemberSelect;

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
  ) {}

  async listStaff(auth: AuthenticatedContext): Promise<StaffListResponse> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const [maxUsers, activeCount, members] = await Promise.all([
        this.readMaxUsers(tx, auth.tenantId),
        tx.tenantMember.count({ where: { isActive: true } }),
        tx.tenantMember.findMany({
          select: STAFF_SELECT,
          orderBy: { createdAt: "asc" },
        }),
      ]);

      return {
        items: members.map((row) => this.serializeMember(row)),
        quota: {
          activeCount,
          maxUsers,
        },
      };
    });
  }

  async createStaffMember(
    auth: AuthenticatedContext,
    input: CreateStaffMemberInput,
    meta: RequestMeta,
  ): Promise<StaffMemberItem> {
    if (input.role === "OWNER" && auth.role !== "OWNER") {
      throw new ForbiddenException({
        code: ERROR_CODES.AUTH_FORBIDDEN,
        message: "Chỉ Chủ cửa hàng mới có quyền tạo tài khoản OWNER",
      });
    }

    // Hash password/PIN outside DB transaction to keep transaction locks short.
    const [passwordHash, pinHash] = await Promise.all([
      input.password
        ? this.tokenService.hashSecret(input.password)
        : Promise.resolve(null),
      input.pin ? this.tokenService.hashSecret(input.pin) : Promise.resolve(null),
    ]);

    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const quota = await lockTenantAndReadQuota(tx, auth.tenantId);
      const activeCount = await tx.tenantMember.count({
        where: { isActive: true },
      });

      if (activeCount >= quota.maxUsers) {
        throw new ForbiddenException({
          code: ERROR_CODES.PLAN_QUOTA_EXCEEDED,
          message: `Gói hiện tại chỉ cho phép tối đa ${quota.maxUsers} nhân viên đang hoạt động`,
        });
      }

      const existingCode = await tx.tenantMember.findFirst({
        where: { employeeCode: input.employeeCode },
        select: { id: true },
      });
      if (existingCode) {
        throw new ConflictException({
          code: ERROR_CODES.EMPLOYEE_CODE_TAKEN,
          message: `Mã nhân viên "${input.employeeCode}" đã tồn tại`,
        });
      }

      if (input.email) {
        const existingEmail = await tx.user.findUnique({
          where: { email: input.email },
          select: { id: true },
        });
        if (existingEmail) {
          throw new ConflictException({
            code: ERROR_CODES.EMAIL_ALREADY_REGISTERED,
            message: "Email này đã được đăng ký tài khoản",
          });
        }
      }

      const normalizedBranchIds = await validateAndNormalizeBranchIds(
        tx,
        input.allowedBranchIds,
      );

      const user = await tx.user.create({
        data: {
          email: input.email ?? null,
          passwordHash,
          fullName: input.fullName,
          phone: input.phone ?? null,
        },
        select: {
          id: true,
        },
      });

      const created = await tx.tenantMember.create({
        data: {
          tenantId: auth.tenantId,
          userId: user.id,
          employeeCode: input.employeeCode,
          pinHash,
          role: input.role,
          permissions: (input.permissions ?? {}) as Prisma.InputJsonValue,
          allowedBranchIds: normalizedBranchIds,
          isActive: true,
        },
        select: STAFF_SELECT,
      });

      await tx.auditLog.create({
        data: {
          tenantId: auth.tenantId,
          actorMemberId: auth.memberId,
          action: "MEMBER_CREATED",
          entityType: "tenant_member",
          entityId: created.id,
          ipAddress: meta.ipAddress ?? null,
          metadata: {
            employeeCode: created.employeeCode,
            role: created.role,
            allowedBranchIds: created.allowedBranchIds,
          },
        },
      });

      return this.serializeMember(created);
    });
  }

  async updateStaffMember(
    auth: AuthenticatedContext,
    memberId: string,
    input: UpdateStaffMemberInput,
    meta: RequestMeta,
  ): Promise<StaffMemberItem> {
    if (input.role === "OWNER" && auth.role !== "OWNER") {
      throw new ForbiddenException({
        code: ERROR_CODES.AUTH_FORBIDDEN,
        message: "Chỉ Chủ cửa hàng mới có quyền cấp vai trò OWNER",
      });
    }

    const nextPinHash =
      typeof input.pin === "string"
        ? await this.tokenService.hashSecret(input.pin)
        : input.pin === null
          ? null
          : undefined;

    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const quota = await lockTenantAndReadQuota(tx, auth.tenantId);

      const existing = await tx.tenantMember.findFirst({
        where: { id: memberId },
        select: STAFF_SELECT,
      });

      if (!existing) {
        throw new NotFoundException({
          code: ERROR_CODES.RESOURCE_NOT_FOUND,
          message: "Không tìm thấy nhân viên",
        });
      }

      if (existing.role === "OWNER" && auth.role !== "OWNER") {
        throw new ForbiddenException({
          code: ERROR_CODES.AUTH_FORBIDDEN,
          message: "Chỉ Chủ cửa hàng mới có quyền chỉnh sửa tài khoản OWNER",
        });
      }

      const willDemoteOrDisableOwner =
        existing.role === "OWNER" &&
        existing.isActive &&
        ((input.role !== undefined && input.role !== "OWNER") ||
          input.isActive === false);

      if (willDemoteOrDisableOwner) {
        const activeOwners = await tx.tenantMember.count({
          where: { role: "OWNER", isActive: true },
        });
        if (activeOwners <= 1) {
          throw new BadRequestException({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: "Không thể hạ quyền hoặc vô hiệu hóa Chủ cửa hàng duy nhất",
          });
        }
      }

      if (input.isActive === true && !existing.isActive) {
        const activeCount = await tx.tenantMember.count({
          where: { isActive: true },
        });
        if (activeCount >= quota.maxUsers) {
          throw new ForbiddenException({
            code: ERROR_CODES.PLAN_QUOTA_EXCEEDED,
            message: `Gói hiện tại chỉ cho phép tối đa ${quota.maxUsers} nhân viên đang hoạt động`,
          });
        }
      }

      const nextAllowedBranchIds =
        input.allowedBranchIds !== undefined
          ? await validateAndNormalizeBranchIds(tx, input.allowedBranchIds)
          : undefined;

      if (input.fullName !== undefined || input.phone !== undefined) {
        await tx.user.update({
          where: { id: existing.user.id },
          data: {
            ...(input.fullName !== undefined
              ? { fullName: input.fullName }
              : {}),
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
          },
        });
      }

      const updated = await tx.tenantMember.update({
        where: { id: memberId },
        data: {
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(nextPinHash !== undefined ? { pinHash: nextPinHash } : {}),
          ...(nextAllowedBranchIds !== undefined
            ? { allowedBranchIds: nextAllowedBranchIds }
            : {}),
          ...(input.permissions !== undefined
            ? { permissions: input.permissions as Prisma.InputJsonValue }
            : {}),
          ...(input.isActive !== undefined
            ? { isActive: input.isActive }
            : {}),
        },
        select: STAFF_SELECT,
      });

      if (input.isActive === false) {
        await tx.refreshSession.updateMany({
          where: {
            memberId,
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          tenantId: auth.tenantId,
          actorMemberId: auth.memberId,
          action: "MEMBER_UPDATED",
          entityType: "tenant_member",
          entityId: updated.id,
          ipAddress: meta.ipAddress ?? null,
          metadata: {
            changedFields: Object.keys(input),
          },
        },
      });

      return this.serializeMember(updated);
    });
  }

  private async readMaxUsers(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<number> {
    const tenant = await tx.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: { plan: { select: { maxUsers: true } } },
    });
    return tenant?.plan.maxUsers ?? 1;
  }

  private serializeMember(row: StaffMemberRow): StaffMemberItem {
    const parsedOverrides = permissionOverridesSchema.safeParse(
      row.permissions,
    );
    const permissions: PermissionOverridesInput = parsedOverrides.success
      ? parsedOverrides.data
      : {};

    return {
      id: row.id,
      userId: row.userId,
      employeeCode: row.employeeCode,
      fullName: row.user.fullName,
      email: row.user.email,
      phone: row.user.phone,
      role: row.role,
      hasPin: Boolean(row.pinHash),
      allowedBranchIds: row.allowedBranchIds,
      permissions,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
