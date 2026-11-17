import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import {
  ERROR_CODES,
  permissionOverridesSchema,
  resolvePermissions,
} from "@smart-pos/shared";
import type { Request } from "express";
import { PrismaService } from "../../prisma/prisma.service";
import { ACCESS_COOKIE_NAME, type AuthenticatedRequest } from "../auth.types";
import { TokenService } from "../token.service";

function extractAccessToken(request: Request): string | null {
  const authHeader = request.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token.length > 0) {
      return token;
    }
  }

  const cookies = request.cookies as Record<string, unknown> | undefined;
  const cookieToken = cookies?.[ACCESS_COOKIE_NAME];
  if (typeof cookieToken === "string" && cookieToken.trim().length > 0) {
    return cookieToken.trim();
  }

  return null;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const rawToken = extractAccessToken(request);
    if (!rawToken) {
      throw new UnauthorizedException({
        code: ERROR_CODES.AUTH_UNAUTHORIZED,
        message: "Thiếu thông tin xác thực",
      });
    }

    const claims = this.tokenService.verifyAccessToken(rawToken);

    const tenant = await this.prisma.tenant.findFirst({
      where: {
        id: claims.tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        slug: true,
        status: true,
      },
    });

    if (!tenant) {
      throw new UnauthorizedException({
        code: ERROR_CODES.AUTH_UNAUTHORIZED,
        message: "Phiên đăng nhập không hợp lệ",
      });
    }

    if (tenant.status === "SUSPENDED") {
      throw new ForbiddenException({
        code: ERROR_CODES.TENANT_SUSPENDED,
        message: "Cửa hàng hiện đang bị tạm ngưng hoạt động",
      });
    }

    const { member, activeSession } = await this.prisma.withTenantTransaction(
      tenant.id,
      async (tx) => {
        const foundMember = await tx.tenantMember.findFirst({
          where: {
            id: claims.memberId,
            userId: claims.sub,
            isActive: true,
          },
          select: {
            id: true,
            role: true,
            permissions: true,
            allowedBranchIds: true,
          },
        });

        if (!foundMember) {
          return { member: null, activeSession: null };
        }

        const foundSession = await tx.refreshSession.findFirst({
          where: {
            familyId: claims.familyId,
            memberId: foundMember.id,
            consumedAt: null,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
        });

        return { member: foundMember, activeSession: foundSession };
      },
    );

    if (!member || !activeSession) {
      throw new UnauthorizedException({
        code: ERROR_CODES.AUTH_UNAUTHORIZED,
        message: "Phiên đăng nhập đã hết hạn hoặc bị thu hồi",
      });
    }

    const parsedOverrides = permissionOverridesSchema.safeParse(
      member.permissions,
    );

    request.auth = {
      userId: claims.sub,
      memberId: member.id,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      role: member.role,
      familyId: claims.familyId,
      effectivePermissions: resolvePermissions(
        member.role,
        parsedOverrides.success ? parsedOverrides.data : null,
      ),
      allowedBranchIds: member.allowedBranchIds,
    };

    return true;
  }
}
