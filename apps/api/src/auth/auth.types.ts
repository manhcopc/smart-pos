import type { Permission, Role } from "@smart-pos/shared";
import type { Request } from "express";

export const ACCESS_COOKIE_NAME = "smartpos_access";
export const REFRESH_COOKIE_NAME = "smartpos_refresh";

export const JWT_ISSUER = "smart-pos-api";
export const JWT_ACCESS_AUDIENCE = "smart-pos-client";
export const JWT_REFRESH_AUDIENCE = "smart-pos-refresh";
export const JWT_SUPERVISOR_AUDIENCE = "smart-pos-supervisor";

export interface SupervisorTokenClaims {
  sub: string;
  approverMemberId: string;
  approverName: string;
  approverEmployeeCode: string;
  tenantId: string;
  branchId: string;
  permission: Permission;
  jti: string;
  iat: number;
  exp: number;
}

export interface AccessTokenClaims {
  sub: string;
  memberId: string;
  tenantId: string;
  tenantSlug: string;
  role: Role;
  familyId: string;
  jti: string;
  iat: number;
  exp: number;
}

export interface RefreshTokenClaims {
  sub: string;
  memberId: string;
  tenantId: string;
  familyId: string;
  jti: string;
  iat: number;
  exp: number;
}

export interface AuthenticatedContext {
  userId: string;
  memberId: string;
  tenantId: string;
  tenantSlug: string;
  role: Role;
  familyId: string;
  effectivePermissions: Set<Permission>;
  allowedBranchIds: string[];
}

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthenticatedContext;
}
