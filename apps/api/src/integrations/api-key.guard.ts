import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { type ApiKeyScope, ERROR_CODES } from "@smart-pos/shared";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { parseTenantApiKeyToken } from "./webhook-security.helper";

export const API_KEY_SCOPES_METADATA_KEY = "api_key_scopes";
export const RequireApiScopes = (...scopes: ApiKeyScope[]) =>
  SetMetadata(API_KEY_SCOPES_METADATA_KEY, scopes);

export interface ApiKeyContext {
  tenantId: string;
  apiKeyId: string;
  createdByMemberId: string;
  scopes: Set<string>;
}

export interface ApiKeyAuthenticatedRequest extends Request {
  apiKeyContext?: ApiKeyContext;
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<ApiKeyAuthenticatedRequest>();

    const rawHeader =
      typeof req.headers["x-api-key"] === "string"
        ? req.headers["x-api-key"]
        : typeof req.headers.authorization === "string" &&
            req.headers.authorization.startsWith("ApiKey ")
          ? req.headers.authorization.slice(7)
          : "";

    const parsed = parseTenantApiKeyToken(rawHeader);
    if (!parsed) {
      throw new UnauthorizedException({
        code: ERROR_CODES.INVALID_API_KEY,
        message: "API Key không hợp lệ hoặc thiếu X-Api-Key",
      });
    }

    const tenant = await this.prisma.tenant.findFirst({
      where: { id: parsed.tenantId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!tenant || tenant.status === "SUSPENDED") {
      throw new ForbiddenException({
        code: ERROR_CODES.TENANT_SUSPENDED,
        message: "Cửa hàng không tồn tại hoặc đang bị tạm ngưng",
      });
    }

    const keyRecord = await this.prisma.withTenantTransaction(
      parsed.tenantId,
      async (tx) => {
        const found = await tx.tenantApiKey.findFirst({
          where: {
            keyHash: parsed.keyHash,
            isActive: true,
          },
          select: {
            id: true,
            createdByMemberId: true,
            scopes: true,
          },
        });
        if (!found) {
          return null;
        }
        await tx.tenantApiKey.update({
          where: { id: found.id },
          data: { lastUsedAt: new Date() },
        });
        return found;
      },
    );

    if (!keyRecord) {
      throw new UnauthorizedException({
        code: ERROR_CODES.INVALID_API_KEY,
        message: "API Key không tồn tại hoặc đã bị thu hồi",
      });
    }

    const scopeSet = new Set(keyRecord.scopes);
    const requiredScopes = this.reflector.getAllAndOverride<ApiKeyScope[]>(
      API_KEY_SCOPES_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (
      requiredScopes &&
      requiredScopes.length > 0 &&
      !requiredScopes.every((s) => scopeSet.has(s))
    ) {
      throw new ForbiddenException({
        code: ERROR_CODES.AUTH_FORBIDDEN,
        message: "API Key không đủ quyền thực hiện thao tác này",
      });
    }

    req.apiKeyContext = {
      tenantId: parsed.tenantId,
      apiKeyId: keyRecord.id,
      createdByMemberId: keyRecord.createdByMemberId,
      scopes: scopeSet,
    };
    return true;
  }
}
