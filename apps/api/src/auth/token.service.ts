import crypto from "node:crypto";
import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ERROR_CODES,
  type Permission,
  PERMISSIONS,
  type Role,
  ROLES,
  uuidSchema,
} from "@smart-pos/shared";
import * as argon2 from "argon2";
import jwt, { type SignOptions } from "jsonwebtoken";
import { AppEnv } from "../config/env";
import {
  type AccessTokenClaims,
  JWT_ACCESS_AUDIENCE,
  JWT_ISSUER,
  JWT_REFRESH_AUDIENCE,
  JWT_SUPERVISOR_AUDIENCE,
  type RefreshTokenClaims,
  type SupervisorTokenClaims,
} from "./auth.types";

const ROLE_SET = new Set<string>(ROLES);
const PERMISSION_SET = new Set<string>(Object.values(PERMISSIONS));

@Injectable()
export class TokenService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessExpiresIn: SignOptions["expiresIn"];
  private readonly refreshExpiresIn: SignOptions["expiresIn"];

  constructor(private readonly configService: ConfigService<AppEnv, true>) {
    this.accessSecret = this.configService.get("JWT_ACCESS_SECRET", {
      infer: true,
    });
    this.refreshSecret = this.configService.get("JWT_REFRESH_SECRET", {
      infer: true,
    });
    this.accessExpiresIn = this.configService.get("JWT_ACCESS_EXPIRES_IN", {
      infer: true,
    }) as SignOptions["expiresIn"];
    this.refreshExpiresIn = this.configService.get("JWT_REFRESH_EXPIRES_IN", {
      infer: true,
    }) as SignOptions["expiresIn"];
  }

  async hashSecret(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, {
      type: argon2.argon2id,
    });
  }

  async verifySecret(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch {
      return false;
    }
  }

  signAccessToken(payload: {
    userId: string;
    memberId: string;
    tenantId: string;
    tenantSlug: string;
    role: Role;
    familyId: string;
  }): string {
    return jwt.sign(
      {
        sub: payload.userId,
        memberId: payload.memberId,
        tenantId: payload.tenantId,
        tenantSlug: payload.tenantSlug,
        role: payload.role,
        familyId: payload.familyId,
        jti: crypto.randomUUID(),
      },
      this.accessSecret,
      {
        algorithm: "HS256",
        issuer: JWT_ISSUER,
        audience: JWT_ACCESS_AUDIENCE,
        expiresIn: this.accessExpiresIn,
      },
    );
  }

  signRefreshToken(payload: {
    tokenId: string;
    userId: string;
    memberId: string;
    tenantId: string;
    familyId: string;
  }): { token: string; tokenHash: string; expiresAt: Date } {
    const token = jwt.sign(
      {
        sub: payload.userId,
        memberId: payload.memberId,
        tenantId: payload.tenantId,
        familyId: payload.familyId,
        jti: payload.tokenId,
      },
      this.refreshSecret,
      {
        algorithm: "HS256",
        issuer: JWT_ISSUER,
        audience: JWT_REFRESH_AUDIENCE,
        expiresIn: this.refreshExpiresIn,
      },
    );

    const decoded = jwt.decode(token) as { exp?: number } | null;
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    return {
      token,
      tokenHash: this.hashRefreshToken(token),
      expiresAt,
    };
  }

  hashRefreshToken(rawToken: string): string {
    return crypto
      .createHmac("sha256", this.refreshSecret)
      .update(rawToken)
      .digest("hex");
  }

  private isUuid(value: unknown): value is string {
    return typeof value === "string" && uuidSchema.safeParse(value).success;
  }

  getTokenTtlMs(token: string, fallbackMs: number): number {
    const decoded = jwt.decode(token) as { exp?: number; iat?: number } | null;
    if (
      decoded &&
      typeof decoded.exp === "number" &&
      typeof decoded.iat === "number" &&
      decoded.exp > decoded.iat
    ) {
      return (decoded.exp - decoded.iat) * 1000;
    }
    return fallbackMs;
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    try {
      const claims = jwt.verify(token, this.accessSecret, {
        algorithms: ["HS256"],
        issuer: JWT_ISSUER,
        audience: JWT_ACCESS_AUDIENCE,
      });

      if (
        !claims ||
        typeof claims === "string" ||
        !this.isUuid(claims.sub) ||
        !this.isUuid(claims.memberId) ||
        !this.isUuid(claims.tenantId) ||
        typeof claims.tenantSlug !== "string" ||
        !this.isUuid(claims.familyId) ||
        !this.isUuid(claims.jti) ||
        typeof claims.role !== "string" ||
        !ROLE_SET.has(claims.role) ||
        !Number.isSafeInteger(claims.iat) ||
        !Number.isSafeInteger(claims.exp) ||
        (claims.exp as number) <= (claims.iat as number)
      ) {
        throw new Error("Invalid access token claims");
      }

      return claims as AccessTokenClaims;
    } catch {
      throw new UnauthorizedException({
        code: ERROR_CODES.AUTH_UNAUTHORIZED,
        message: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn",
      });
    }
  }

  verifyRefreshToken(
    token: string,
    options?: { allowExpired?: boolean },
  ): RefreshTokenClaims {
    try {
      const claims = jwt.verify(token, this.refreshSecret, {
        algorithms: ["HS256"],
        issuer: JWT_ISSUER,
        audience: JWT_REFRESH_AUDIENCE,
        ignoreExpiration: options?.allowExpired === true,
      });

      if (
        !claims ||
        typeof claims === "string" ||
        !this.isUuid(claims.sub) ||
        !this.isUuid(claims.memberId) ||
        !this.isUuid(claims.tenantId) ||
        !this.isUuid(claims.familyId) ||
        !this.isUuid(claims.jti) ||
        !Number.isSafeInteger(claims.iat) ||
        !Number.isSafeInteger(claims.exp) ||
        (claims.exp as number) <= (claims.iat as number)
      ) {
        throw new Error("Invalid refresh token claims");
      }

      return claims as RefreshTokenClaims;
    } catch {
      throw new UnauthorizedException({
        code: ERROR_CODES.AUTH_UNAUTHORIZED,
        message: "Refresh token không hợp lệ hoặc đã hết hạn",
      });
    }
  }

  signSupervisorApprovalToken(payload: {
    approverMemberId: string;
    approverName: string;
    approverEmployeeCode: string;
    tenantId: string;
    branchId: string;
    permission: Permission;
  }): { token: string; expiresAt: Date } {
    const expiresInSeconds = 300;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    const token = jwt.sign(
      {
        sub: payload.approverMemberId,
        approverMemberId: payload.approverMemberId,
        approverName: payload.approverName,
        approverEmployeeCode: payload.approverEmployeeCode,
        tenantId: payload.tenantId,
        branchId: payload.branchId,
        permission: payload.permission,
        jti: crypto.randomUUID(),
      },
      this.accessSecret,
      {
        algorithm: "HS256",
        issuer: JWT_ISSUER,
        audience: JWT_SUPERVISOR_AUDIENCE,
        expiresIn: expiresInSeconds,
      },
    );
    return { token, expiresAt };
  }

  verifySupervisorApprovalToken(
    token: string,
    expected: {
      tenantId: string;
      branchId: string;
      permission: Permission;
    },
  ): SupervisorTokenClaims {
    try {
      const claims = jwt.verify(token, this.accessSecret, {
        algorithms: ["HS256"],
        issuer: JWT_ISSUER,
        audience: JWT_SUPERVISOR_AUDIENCE,
      });

      if (
        !claims ||
        typeof claims === "string" ||
        !this.isUuid(claims.approverMemberId) ||
        !this.isUuid(claims.tenantId) ||
        !this.isUuid(claims.branchId) ||
        !this.isUuid(claims.jti) ||
        typeof claims.approverName !== "string" ||
        typeof claims.approverEmployeeCode !== "string" ||
        typeof claims.permission !== "string" ||
        !PERMISSION_SET.has(claims.permission)
      ) {
        throw new Error("Invalid supervisor token");
      }

      if (
        claims.tenantId !== expected.tenantId ||
        claims.branchId !== expected.branchId ||
        claims.permission !== expected.permission
      ) {
        throw new Error("Supervisor token scope mismatch");
      }

      return claims as SupervisorTokenClaims;
    } catch {
      throw new ForbiddenException({
        code: ERROR_CODES.AUTH_FORBIDDEN,
        message: "Mã phê duyệt Quản lý không hợp lệ hoặc đã hết hạn",
      });
    }
  }
}
