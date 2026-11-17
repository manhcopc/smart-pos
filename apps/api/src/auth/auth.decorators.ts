import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { ERROR_CODES, type Permission } from "@smart-pos/shared";
import type {
  AuthenticatedContext,
  AuthenticatedRequest,
} from "./auth.types";

export const PERMISSIONS_METADATA_KEY = "smartpos:required_permissions";

/**
 * Attach required RBAC permissions to a controller or route handler.
 * Enforced by `PermissionsGuard` after `JwtAuthGuard` populates `request.auth`.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_METADATA_KEY, permissions);

/**
 * Extract the verified `AuthenticatedContext` populated by `JwtAuthGuard`.
 */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedContext => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) {
      throw new UnauthorizedException({
        code: ERROR_CODES.AUTH_UNAUTHORIZED,
        message: "Yêu cầu đăng nhập để tiếp tục",
      });
    }
    return request.auth;
  },
);
