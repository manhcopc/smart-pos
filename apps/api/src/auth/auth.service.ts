import crypto from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  type AuthBranchSummary,
  type AuthProfileResponse,
  type AuthSessionResponse,
  type CashierPinLoginInput,
  ERROR_CODES,
  type OwnerLoginInput,
  permissionOverridesSchema,
  type RegisterTenantInput,
  resolvePermissions,
  type Role,
  uuidSchema,
} from "@smart-pos/shared";
import { RateLimitService } from "../common/rate-limit/rate-limit.service";
import { PrismaService } from "../prisma/prisma.service";
import { createTenantScopedPrisma } from "../prisma/tenant-context";
import type { AuthenticatedContext, RequestMeta } from "./auth.types";
import { TokenService } from "./token.service";

const TRIAL_DURATION_DAYS = 14;
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_SECONDS = 300;
const PIN_LIMIT = 5;
const PIN_WINDOW_SECONDS = 300;
const REGISTER_LIMIT = 5;
const REGISTER_WINDOW_SECONDS = 3600;

export interface AuthIssueResult {
  session: AuthSessionResponse;
  refreshToken: string;
  refreshExpiresAt: Date;
}

interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  businessType: string;
  status: string;
  planCode: string;
}

interface UserSummary {
  id: string;
  email: string | null;
  fullName: string;
}

interface MemberSummary {
  id: string;
  employeeCode: string;
  role: Role;
  permissions: Prisma.JsonValue;
  allowedBranchIds: string[];
}

@Injectable()
export class AuthService {
  private dummyHashPromise: Promise<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  async registerTenant(
    input: RegisterTenantInput,
    meta: RequestMeta,
  ): Promise<AuthIssueResult> {
    const ipKey = meta.ipAddress ?? "unknown";
    await this.rateLimitService.enforceOrThrow(
      `auth:reg:${ipKey}`,
      REGISTER_LIMIT,
      REGISTER_WINDOW_SECONDS,
    );

    const [trialPlan, existingTenant, existingUser] = await Promise.all([
      this.prisma.subscriptionPlan.findUnique({
        where: { code: "FREE_TRIAL" },
        select: { id: true, code: true },
      }),
      this.prisma.tenant.findUnique({
        where: { slug: input.tenantSlug },
        select: { id: true },
      }),
      this.prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      }),
    ]);

    if (!trialPlan) {
      throw new InternalServerErrorException({
        code: ERROR_CODES.INTERNAL_ERROR,
        message: "Chưa khởi tạo gói dùng thử FREE_TRIAL trong hệ thống",
      });
    }

    if (existingTenant) {
      throw new ConflictException({
        code: ERROR_CODES.TENANT_SLUG_TAKEN,
        message: "Mã cửa hàng (slug) này đã được sử dụng",
      });
    }

    if (existingUser) {
      throw new ConflictException({
        code: ERROR_CODES.EMAIL_ALREADY_REGISTERED,
        message: "Email này đã được đăng ký tài khoản",
      });
    }

    // Hash password before opening DB transaction to keep transaction duration minimal.
    const passwordHash = await this.tokenService.hashSecret(input.password);
    const trialEndsAt = new Date(
      Date.now() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000,
    );

    try {
      return await this.prisma.$transaction(async (rawTx) => {
        const tenant = await rawTx.tenant.create({
          data: {
            slug: input.tenantSlug,
            name: input.shopName,
            businessType: input.businessType,
            phone: input.phone,
            planId: trialPlan.id,
            trialEndsAt,
            status: "ACTIVE",
          },
          select: {
            id: true,
            slug: true,
            name: true,
            businessType: true,
            status: true,
          },
        });

        const user = await rawTx.user.create({
          data: {
            email: input.email,
            passwordHash,
            fullName: input.ownerName,
            phone: input.phone,
          },
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        });

        await rawTx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenant.id}, true)`;
        const tx = createTenantScopedPrisma(rawTx, tenant.id);

        const defaultBranch = await tx.branch.create({
          data: {
            tenantId: tenant.id,
            code: "CN01",
            name: input.branchName,
            phone: input.phone,
            isDefault: true,
            isActive: true,
          },
          select: {
            id: true,
            code: true,
            name: true,
            address: true,
            phone: true,
            isDefault: true,
            isActive: true,
          },
        });

        const ownerMember = await tx.tenantMember.create({
          data: {
            tenantId: tenant.id,
            userId: user.id,
            employeeCode: "OWNER01",
            role: "OWNER",
            permissions: {},
            allowedBranchIds: [],
            isActive: true,
          },
          select: {
            id: true,
            employeeCode: true,
            role: true,
            permissions: true,
            allowedBranchIds: true,
          },
        });

        return this.issueSessionInsideTx(tx, {
          tenant: { ...tenant, planCode: trialPlan.code },
          user,
          member: ownerMember,
          branches: [defaultBranch],
          familyId: crypto.randomUUID(),
          meta,
        });
      });
    } catch (error) {
      this.rethrowRegistrationConflictIfUniqueViolation(error);
      throw error;
    }
  }

  async loginWithPassword(
    input: OwnerLoginInput,
    meta: RequestMeta,
  ): Promise<AuthIssueResult> {
    const ipKey = meta.ipAddress ?? "unknown";
    await this.rateLimitService.enforceOrThrow(
      `auth:login:${ipKey}:${input.email}`,
      LOGIN_LIMIT,
      LOGIN_WINDOW_SECONDS,
    );

    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        fullName: true,
      },
    });

    const hashToVerify = user?.passwordHash ?? (await this.getDummyHash());
    const passwordMatches = await this.tokenService.verifySecret(
      hashToVerify,
      input.password,
    );

    if (!user || !user.passwordHash || !passwordMatches) {
      throw new UnauthorizedException({
        code: ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        message: "Email hoặc mật khẩu không đúng",
      });
    }

    const tenant = await this.resolveTenantForUser(user.id, input.tenantSlug);
    if (tenant.status === "SUSPENDED") {
      throw new ForbiddenException({
        code: ERROR_CODES.TENANT_SUSPENDED,
        message: "Cửa hàng hiện đang bị tạm ngưng hoạt động",
      });
    }

    return this.prisma.withTenantTransaction(tenant.id, async (tx) => {
      const member = await tx.tenantMember.findFirst({
        where: {
          userId: user.id,
          isActive: true,
        },
        select: {
          id: true,
          employeeCode: true,
          role: true,
          permissions: true,
          allowedBranchIds: true,
        },
      });

      if (!member) {
        throw new UnauthorizedException({
          code: ERROR_CODES.AUTH_INVALID_CREDENTIALS,
          message: "Tài khoản không còn quyền truy cập cửa hàng này",
        });
      }

      const branches = await this.fetchAccessibleBranches(
        tx,
        member.allowedBranchIds,
      );

      return this.issueSessionInsideTx(tx, {
        tenant,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
        },
        member,
        branches,
        familyId: crypto.randomUUID(),
        meta,
      });
    });
  }

  async loginWithCashierPin(
    input: CashierPinLoginInput,
    meta: RequestMeta,
  ): Promise<AuthIssueResult> {
    const ipKey = meta.ipAddress ?? "unknown";
    await this.rateLimitService.enforceOrThrow(
      `auth:pin:${ipKey}:${input.tenantSlug}:${input.employeeCode}`,
      PIN_LIMIT,
      PIN_WINDOW_SECONDS,
    );

    const tenantRecord = await this.prisma.tenant.findFirst({
      where: {
        slug: input.tenantSlug,
        deletedAt: null,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        businessType: true,
        status: true,
        plan: { select: { code: true } },
      },
    });

    if (!tenantRecord) {
      await this.verifyDummySecret(input.pin);
      throw new UnauthorizedException({
        code: ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        message: "Mã cửa hàng, mã nhân viên hoặc mã PIN không đúng",
      });
    }

    const memberRecord = await this.prisma.withTenantTransaction(
      tenantRecord.id,
      (tx) =>
        tx.tenantMember.findFirst({
          where: {
            employeeCode: input.employeeCode,
            isActive: true,
          },
          select: {
            id: true,
            employeeCode: true,
            pinHash: true,
            role: true,
            permissions: true,
            allowedBranchIds: true,
            user: {
              select: {
                id: true,
                email: true,
                fullName: true,
              },
            },
          },
        }),
    );

    const pinHash = memberRecord?.pinHash ?? (await this.getDummyHash());
    const pinValid = await this.tokenService.verifySecret(pinHash, input.pin);

    if (!memberRecord || !memberRecord.pinHash || !pinValid) {
      throw new UnauthorizedException({
        code: ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        message: "Mã cửa hàng, mã nhân viên hoặc mã PIN không đúng",
      });
    }

    if (tenantRecord.status === "SUSPENDED") {
      throw new ForbiddenException({
        code: ERROR_CODES.TENANT_SUSPENDED,
        message: "Cửa hàng hiện đang bị tạm ngưng hoạt động",
      });
    }

    const tenant: TenantSummary = {
      id: tenantRecord.id,
      slug: tenantRecord.slug,
      name: tenantRecord.name,
      businessType: tenantRecord.businessType,
      status: tenantRecord.status,
      planCode: tenantRecord.plan.code,
    };

    return this.prisma.withTenantTransaction(tenant.id, async (tx) => {
      const branches = await this.fetchAccessibleBranches(
        tx,
        memberRecord.allowedBranchIds,
      );

      return this.issueSessionInsideTx(tx, {
        tenant,
        user: memberRecord.user,
        member: {
          id: memberRecord.id,
          employeeCode: memberRecord.employeeCode,
          role: memberRecord.role,
          permissions: memberRecord.permissions,
          allowedBranchIds: memberRecord.allowedBranchIds,
        },
        branches,
        familyId: crypto.randomUUID(),
        meta,
      });
    });
  }

  async refreshSession(
    rawRefreshToken: string,
    meta: RequestMeta,
  ): Promise<AuthIssueResult> {
    const claims = this.tokenService.verifyRefreshToken(rawRefreshToken);
    const tokenHash = this.tokenService.hashRefreshToken(rawRefreshToken);

    const tenantRecord = await this.prisma.tenant.findFirst({
      where: {
        id: claims.tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        businessType: true,
        status: true,
        plan: { select: { code: true } },
      },
    });

    if (!tenantRecord) {
      throw new UnauthorizedException({
        code: ERROR_CODES.AUTH_UNAUTHORIZED,
        message: "Phiên làm việc không hợp lệ",
      });
    }

    if (tenantRecord.status === "SUSPENDED") {
      throw new ForbiddenException({
        code: ERROR_CODES.TENANT_SUSPENDED,
        message: "Cửa hàng hiện đang bị tạm ngưng hoạt động",
      });
    }

    const tenant: TenantSummary = {
      id: tenantRecord.id,
      slug: tenantRecord.slug,
      name: tenantRecord.name,
      businessType: tenantRecord.businessType,
      status: tenantRecord.status,
      planCode: tenantRecord.plan.code,
    };

    type RefreshOutcome =
      | { status: "revoked" }
      | { status: "member_disabled" }
      | { status: "ok"; result: AuthIssueResult };

    const outcome = await this.prisma.withTenantTransaction<RefreshOutcome>(
      tenant.id,
      async (tx) => {
        // Single atomic update guarantees concurrent reuse can succeed at most once.
        const consumed = await tx.$queryRaw<Array<{ id: string }>>`
          UPDATE refresh_sessions
          SET consumed_at = now()
          WHERE id = ${claims.jti}::uuid
            AND tenant_id = ${tenant.id}::uuid
            AND token_hash = ${tokenHash}
            AND consumed_at IS NULL
            AND revoked_at IS NULL
            AND expires_at > now()
          RETURNING id
        `;

        if (consumed.length === 0) {
          // Commit family revocation cleanly before throwing outside the transaction.
          await tx.refreshSession.updateMany({
            where: {
              familyId: claims.familyId,
              revokedAt: null,
            },
            data: {
              revokedAt: new Date(),
            },
          });

          return { status: "revoked" };
        }

        const member = await tx.tenantMember.findFirst({
          where: {
            id: claims.memberId,
            userId: claims.sub,
            isActive: true,
          },
          select: {
            id: true,
            employeeCode: true,
            role: true,
            permissions: true,
            allowedBranchIds: true,
            user: {
              select: {
                id: true,
                email: true,
                fullName: true,
              },
            },
          },
        });

        if (!member) {
          await tx.refreshSession.updateMany({
            where: {
              familyId: claims.familyId,
              revokedAt: null,
            },
            data: {
              revokedAt: new Date(),
            },
          });

          return { status: "member_disabled" };
        }

        const branches = await this.fetchAccessibleBranches(
          tx,
          member.allowedBranchIds,
        );

        const issued = await this.issueSessionInsideTx(tx, {
          tenant,
          user: member.user,
          member: {
            id: member.id,
            employeeCode: member.employeeCode,
            role: member.role,
            permissions: member.permissions,
            allowedBranchIds: member.allowedBranchIds,
          },
          branches,
          familyId: claims.familyId,
          meta,
        });

        return { status: "ok", result: issued };
      },
    );

    if (outcome.status === "revoked") {
      throw new UnauthorizedException({
        code: ERROR_CODES.AUTH_UNAUTHORIZED,
        message: "Phiên làm việc đã hết hạn hoặc bị thu hồi",
      });
    }

    if (outcome.status === "member_disabled") {
      throw new UnauthorizedException({
        code: ERROR_CODES.AUTH_UNAUTHORIZED,
        message: "Tài khoản nhân viên đã bị vô hiệu hóa",
      });
    }

    return outcome.result;
  }

  async logout(params: {
    rawRefreshToken?: string;
    rawAccessToken?: string;
    auth?: AuthenticatedContext;
  }): Promise<void> {
    let targetTenantId = params.auth?.tenantId;
    let targetFamilyId = params.auth?.familyId;

    if ((!targetTenantId || !targetFamilyId) && params.rawRefreshToken) {
      try {
        const claims = this.tokenService.verifyRefreshToken(
          params.rawRefreshToken,
          { allowExpired: true },
        );
        targetTenantId = claims.tenantId;
        targetFamilyId = claims.familyId;
      } catch {
        targetTenantId = undefined;
        targetFamilyId = undefined;
      }
    }

    if ((!targetTenantId || !targetFamilyId) && params.rawAccessToken) {
      try {
        const claims = this.tokenService.verifyAccessToken(
          params.rawAccessToken,
        );
        targetTenantId = claims.tenantId;
        targetFamilyId = claims.familyId;
      } catch {
        return;
      }
    }

    if (
      !targetTenantId ||
      !targetFamilyId ||
      !uuidSchema.safeParse(targetTenantId).success ||
      !uuidSchema.safeParse(targetFamilyId).success
    ) {
      return;
    }

    await this.prisma.withTenantTransaction(targetTenantId, async (tx) => {
      await tx.refreshSession.updateMany({
        where: {
          familyId: targetFamilyId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    });
  }

  async getProfile(auth: AuthenticatedContext): Promise<AuthProfileResponse> {
    const tenantRecord = await this.prisma.tenant.findFirst({
      where: {
        id: auth.tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        businessType: true,
        status: true,
        plan: { select: { code: true } },
      },
    });

    if (!tenantRecord) {
      throw new UnauthorizedException({
        code: ERROR_CODES.AUTH_UNAUTHORIZED,
        message: "Phiên làm việc không hợp lệ",
      });
    }

    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const member = await tx.tenantMember.findFirst({
        where: {
          id: auth.memberId,
          userId: auth.userId,
          isActive: true,
        },
        select: {
          id: true,
          employeeCode: true,
          role: true,
          permissions: true,
          allowedBranchIds: true,
          user: {
            select: {
              id: true,
              email: true,
              fullName: true,
            },
          },
        },
      });

      if (!member) {
        throw new UnauthorizedException({
          code: ERROR_CODES.AUTH_UNAUTHORIZED,
          message: "Tài khoản không còn hoạt động",
        });
      }

      const branches = await this.fetchAccessibleBranches(
        tx,
        member.allowedBranchIds,
      );

      return this.buildProfilePayload({
        tenant: {
          id: tenantRecord.id,
          slug: tenantRecord.slug,
          name: tenantRecord.name,
          businessType: tenantRecord.businessType,
          status: tenantRecord.status,
          planCode: tenantRecord.plan.code,
        },
        user: member.user,
        member: {
          id: member.id,
          employeeCode: member.employeeCode,
          role: member.role,
          permissions: member.permissions,
          allowedBranchIds: member.allowedBranchIds,
        },
        branches,
      });
    });
  }

  private async resolveTenantForUser(
    userId: string,
    tenantSlug?: string,
  ): Promise<TenantSummary> {
    if (tenantSlug) {
      const tenant = await this.prisma.tenant.findFirst({
        where: {
          slug: tenantSlug,
          deletedAt: null,
        },
        select: {
          id: true,
          slug: true,
          name: true,
          businessType: true,
          status: true,
          plan: { select: { code: true } },
        },
      });

      if (!tenant) {
        throw new UnauthorizedException({
          code: ERROR_CODES.AUTH_INVALID_CREDENTIALS,
          message: "Email, mật khẩu hoặc mã cửa hàng không đúng",
        });
      }

      return {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        businessType: tenant.businessType,
        status: tenant.status,
        planCode: tenant.plan.code,
      };
    }

    const memberships = await this.prisma.tenantMember.findMany({
      where: {
        userId,
        isActive: true,
        tenant: { deletedAt: null },
      },
      select: {
        tenant: {
          select: {
            id: true,
            slug: true,
            name: true,
            businessType: true,
            status: true,
            plan: { select: { code: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 2,
    });

    if (memberships.length === 0) {
      throw new UnauthorizedException({
        code: ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        message: "Tài khoản chưa gắn với cửa hàng nào",
      });
    }

    if (memberships.length > 1) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_ERROR,
        message:
          "Tài khoản thuộc nhiều cửa hàng, vui lòng nhập mã cửa hàng (slug)",
      });
    }

    const chosen = memberships[0]!.tenant;
    return {
      id: chosen.id,
      slug: chosen.slug,
      name: chosen.name,
      businessType: chosen.businessType,
      status: chosen.status,
      planCode: chosen.plan.code,
    };
  }

  private async issueSessionInsideTx(
    tx: Prisma.TransactionClient,
    params: {
      tenant: TenantSummary;
      user: UserSummary;
      member: MemberSummary;
      branches: AuthBranchSummary[];
      familyId: string;
      meta: RequestMeta;
    },
  ): Promise<AuthIssueResult> {
    const sessionId = crypto.randomUUID();
    const refresh = this.tokenService.signRefreshToken({
      tokenId: sessionId,
      userId: params.user.id,
      memberId: params.member.id,
      tenantId: params.tenant.id,
      familyId: params.familyId,
    });

    await tx.refreshSession.create({
      data: {
        id: sessionId,
        tenantId: params.tenant.id,
        memberId: params.member.id,
        userId: params.user.id,
        familyId: params.familyId,
        tokenHash: refresh.tokenHash,
        expiresAt: refresh.expiresAt,
        ipAddress: params.meta.ipAddress ?? null,
        userAgent: params.meta.userAgent?.slice(0, 500) ?? null,
      },
    });

    const accessToken = this.tokenService.signAccessToken({
      userId: params.user.id,
      memberId: params.member.id,
      tenantId: params.tenant.id,
      tenantSlug: params.tenant.slug,
      role: params.member.role,
      familyId: params.familyId,
    });

    const profile = this.buildProfilePayload(params);

    return {
      session: {
        accessToken,
        ...profile,
      },
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
    };
  }

  private buildProfilePayload(params: {
    tenant: TenantSummary;
    user: UserSummary;
    member: MemberSummary;
    branches: AuthBranchSummary[];
  }): AuthProfileResponse {
    const parsedOverrides = permissionOverridesSchema.safeParse(
      params.member.permissions,
    );
    const effectivePermissions = Array.from(
      resolvePermissions(
        params.member.role,
        parsedOverrides.success ? parsedOverrides.data : null,
      ),
    );

    return {
      redirectTo: params.member.role === "CASHIER" ? "/pos" : "/dashboard",
      user: {
        id: params.user.id,
        email: params.user.email,
        fullName: params.user.fullName,
      },
      tenant: {
        id: params.tenant.id,
        slug: params.tenant.slug,
        name: params.tenant.name,
        businessType: params.tenant.businessType,
        planCode: params.tenant.planCode,
      },
      member: {
        id: params.member.id,
        employeeCode: params.member.employeeCode,
        role: params.member.role,
        allowedBranchIds: params.member.allowedBranchIds,
        permissions: effectivePermissions,
      },
      branches: params.branches,
    };
  }

  private async fetchAccessibleBranches(
    tx: Prisma.TransactionClient,
    allowedBranchIds: string[],
  ): Promise<AuthBranchSummary[]> {
    return tx.branch.findMany({
      where: {
        isActive: true,
        ...(allowedBranchIds.length > 0
          ? { id: { in: allowedBranchIds } }
          : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        address: true,
        phone: true,
        isDefault: true,
        isActive: true,
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
  }

  private async getDummyHash(): Promise<string> {
    if (!this.dummyHashPromise) {
      this.dummyHashPromise = this.tokenService.hashSecret(
        "smart-pos-constant-time-dummy",
      );
    }
    return this.dummyHashPromise;
  }

  private async verifyDummySecret(candidate: string): Promise<void> {
    const dummy = await this.getDummyHash();
    await this.tokenService.verifySecret(dummy, candidate);
  }

  private rethrowRegistrationConflictIfUniqueViolation(error: unknown): void {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      (error as { code?: unknown }).code !== "P2002"
    ) {
      return;
    }

    const meta = (error as { meta?: { target?: unknown } }).meta;
    const targets = Array.isArray(meta?.target)
      ? meta.target.join(",")
      : String(meta?.target ?? "");

    if (targets.includes("slug")) {
      throw new ConflictException({
        code: ERROR_CODES.TENANT_SLUG_TAKEN,
        message: "Mã cửa hàng (slug) này đã được sử dụng",
      });
    }

    if (targets.includes("email")) {
      throw new ConflictException({
        code: ERROR_CODES.EMAIL_ALREADY_REGISTERED,
        message: "Email này đã được đăng ký tài khoản",
      });
    }
  }
}
