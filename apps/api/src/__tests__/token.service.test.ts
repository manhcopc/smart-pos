import crypto from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import {
  JWT_ACCESS_AUDIENCE,
  JWT_ISSUER,
  JWT_REFRESH_AUDIENCE,
} from "../auth/auth.types";
import { TokenService } from "../auth/token.service";
import type { AppEnv } from "../config/env";

function createConfigService(): ConfigService<AppEnv, true> {
  const values: Partial<AppEnv> = {
    JWT_ACCESS_SECRET: "unit_test_access_secret_key_32_characters_min",
    JWT_REFRESH_SECRET: "unit_test_refresh_secret_key_32_characters_min",
    JWT_ACCESS_EXPIRES_IN: "15m",
    JWT_REFRESH_EXPIRES_IN: "7d",
  };

  return {
    get: (key: keyof AppEnv) => values[key],
  } as unknown as ConfigService<AppEnv, true>;
}

describe("TokenService", () => {
  const tokenService = new TokenService(createConfigService());
  const sampleIds = {
    userId: crypto.randomUUID(),
    memberId: crypto.randomUUID(),
    tenantId: crypto.randomUUID(),
    familyId: crypto.randomUUID(),
    tokenId: crypto.randomUUID(),
  };

  it("hashes and verifies secrets with Argon2id", async () => {
    const hash = await tokenService.hashSecret("SuperSecret123!");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await tokenService.verifySecret(hash, "SuperSecret123!")).toBe(true);
    expect(await tokenService.verifySecret(hash, "WrongSecret")).toBe(false);
  });

  it("signs and verifies access tokens with strict claims", () => {
    const token = tokenService.signAccessToken({
      userId: sampleIds.userId,
      memberId: sampleIds.memberId,
      tenantId: sampleIds.tenantId,
      tenantSlug: "cafe-abc",
      role: "OWNER",
      familyId: sampleIds.familyId,
    });

    const claims = tokenService.verifyAccessToken(token);
    expect(claims.sub).toBe(sampleIds.userId);
    expect(claims.memberId).toBe(sampleIds.memberId);
    expect(claims.tenantId).toBe(sampleIds.tenantId);
    expect(claims.tenantSlug).toBe("cafe-abc");
    expect(claims.role).toBe("OWNER");
    expect(claims.familyId).toBe(sampleIds.familyId);
  });

  it("rejects refresh tokens or tampered tokens presented as access tokens", () => {
    const refresh = tokenService.signRefreshToken({
      tokenId: sampleIds.tokenId,
      userId: sampleIds.userId,
      memberId: sampleIds.memberId,
      tenantId: sampleIds.tenantId,
      familyId: sampleIds.familyId,
    });

    expect(() => tokenService.verifyAccessToken(refresh.token)).toThrow(
      UnauthorizedException,
    );

    const wrongIssuerToken = jwt.sign(
      {
        sub: sampleIds.userId,
        memberId: sampleIds.memberId,
        tenantId: sampleIds.tenantId,
        tenantSlug: "cafe-abc",
        role: "OWNER",
        familyId: sampleIds.familyId,
        jti: crypto.randomUUID(),
      },
      "unit_test_access_secret_key_32_characters_min",
      {
        algorithm: "HS256",
        issuer: "attacker",
        audience: JWT_ACCESS_AUDIENCE,
        expiresIn: "15m",
      },
    );
    expect(() => tokenService.verifyAccessToken(wrongIssuerToken)).toThrow(
      UnauthorizedException,
    );

    const nonUuidSubToken = jwt.sign(
      {
        sub: "not-a-uuid",
        memberId: sampleIds.memberId,
        tenantId: sampleIds.tenantId,
        tenantSlug: "cafe-abc",
        role: "OWNER",
        familyId: sampleIds.familyId,
        jti: crypto.randomUUID(),
      },
      "unit_test_access_secret_key_32_characters_min",
      {
        algorithm: "HS256",
        issuer: JWT_ISSUER,
        audience: JWT_ACCESS_AUDIENCE,
        expiresIn: "15m",
      },
    );
    expect(() => tokenService.verifyAccessToken(nonUuidSubToken)).toThrow(
      UnauthorizedException,
    );
  });

  it("verifies refresh tokens, computes deterministic HMAC hashes, and supports allowExpired for logout", () => {
    const refresh = tokenService.signRefreshToken({
      tokenId: sampleIds.tokenId,
      userId: sampleIds.userId,
      memberId: sampleIds.memberId,
      tenantId: sampleIds.tenantId,
      familyId: sampleIds.familyId,
    });

    const verified = tokenService.verifyRefreshToken(refresh.token);
    expect(verified.jti).toBe(sampleIds.tokenId);
    expect(tokenService.hashRefreshToken(refresh.token)).toBe(
      refresh.tokenHash,
    );

    const expiredRefresh = jwt.sign(
      {
        sub: sampleIds.userId,
        memberId: sampleIds.memberId,
        tenantId: sampleIds.tenantId,
        familyId: sampleIds.familyId,
        jti: sampleIds.tokenId,
        iat: Math.floor(Date.now() / 1000) - 3600,
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      "unit_test_refresh_secret_key_32_characters_min",
      {
        algorithm: "HS256",
        issuer: JWT_ISSUER,
        audience: JWT_REFRESH_AUDIENCE,
      },
    );

    expect(() => tokenService.verifyRefreshToken(expiredRefresh)).toThrow(
      UnauthorizedException,
    );
    const decodedForLogout = tokenService.verifyRefreshToken(expiredRefresh, {
      allowExpired: true,
    });
    expect(decodedForLogout.familyId).toBe(sampleIds.familyId);
  });
});
