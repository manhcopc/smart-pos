import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ERROR_CODES, type Permission } from "@smart-pos/shared";
import { PERMISSIONS_METADATA_KEY } from "../auth.decorators";
import type { AuthenticatedRequest } from "../auth.types";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) {
      throw new UnauthorizedException({
        code: ERROR_CODES.AUTH_UNAUTHORIZED,
        message: "Yêu cầu đăng nhập để tiếp tục",
      });
    }

    const hasAllPermissions = required.every((permission) =>
      request.auth!.effectivePermissions.has(permission),
    );

    if (!hasAllPermissions) {
      throw new ForbiddenException({
        code: ERROR_CODES.AUTH_FORBIDDEN,
        message: "Bạn không có quyền thực hiện thao tác này",
      });
    }

    return true;
  }
}
