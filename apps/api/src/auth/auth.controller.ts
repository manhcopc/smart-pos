import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type AuthProfileResponse,
  type AuthSessionResponse,
  type CashierPinLoginInput,
  cashierPinLoginSchema,
  ERROR_CODES,
  type OwnerLoginInput,
  ownerLoginSchema,
  type RefreshTokenBodyInput,
  refreshTokenBodySchema,
  type RegisterTenantInput,
  registerTenantSchema,
} from "@smart-pos/shared";
import type { Request, Response } from "express";
import { extractRequestMeta } from "../common/http/request-meta";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AppEnv } from "../config/env";
import { CurrentAuth } from "./auth.decorators";
import { AuthIssueResult, AuthService } from "./auth.service";
import {
  ACCESS_COOKIE_NAME,
  type AuthenticatedContext,
  type AuthenticatedRequest,
  REFRESH_COOKIE_NAME,
} from "./auth.types";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { TokenService } from "./token.service";

const DEFAULT_ACCESS_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;
const DEFAULT_REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  private readonly cookieSecure: boolean;
  private readonly allowedOrigins: Set<string>;

  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly configService: ConfigService<AppEnv, true>,
  ) {
    this.cookieSecure = Boolean(
      this.configService.get("COOKIE_SECURE", { infer: true }),
    );
    const corsOrigin = this.configService.get("CORS_ORIGIN", { infer: true });
    this.allowedOrigins = new Set(
      corsOrigin
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    );
  }

  @Post("register-tenant")
  @ApiOperation({ summary: "Register a new shop (Tenant + default Branch + Owner)" })
  async registerTenant(
    @Body(new ZodValidationPipe(registerTenantSchema))
    body: RegisterTenantInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponse> {
    const result = await this.authService.registerTenant(
      body,
      extractRequestMeta(req),
    );
    this.setAuthCookies(res, result);
    return result.session;
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Owner/Manager login with email & password" })
  async loginWithPassword(
    @Body(new ZodValidationPipe(ownerLoginSchema)) body: OwnerLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponse> {
    const result = await this.authService.loginWithPassword(
      body,
      extractRequestMeta(req),
    );
    this.setAuthCookies(res, result);
    return result.session;
  }

  @Post("cashier-pin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Quick cashier counter login via tenant slug + employee code + PIN" })
  async loginWithCashierPin(
    @Body(new ZodValidationPipe(cashierPinLoginSchema))
    body: CashierPinLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponse> {
    const result = await this.authService.loginWithCashierPin(
      body,
      extractRequestMeta(req),
    );
    this.setAuthCookies(res, result);
    return result.session;
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Rotate refresh token cookie/body and issue fresh tokens" })
  async refresh(
    @Body(new ZodValidationPipe(refreshTokenBodySchema))
    body: RefreshTokenBodyInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponse> {
    const cookieToken = this.readCookie(req, REFRESH_COOKIE_NAME);
    if (cookieToken && !body.refreshToken) {
      this.assertTrustedOriginIfPresent(req);
    }

    const rawRefreshToken = cookieToken ?? body.refreshToken;
    if (!rawRefreshToken) {
      throw new UnauthorizedException({
        code: ERROR_CODES.AUTH_UNAUTHORIZED,
        message: "Thiếu refresh token",
      });
    }

    try {
      const result = await this.authService.refreshSession(
        rawRefreshToken,
        extractRequestMeta(req),
      );
      this.setAuthCookies(res, result);
      return result.session;
    } catch (error) {
      this.clearAuthCookies(res);
      throw error;
    }
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Revoke current session family and clear auth cookies" })
  async logout(
    @Body(new ZodValidationPipe(refreshTokenBodySchema))
    body: RefreshTokenBodyInput,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true }> {
    const cookieToken = this.readCookie(req, REFRESH_COOKIE_NAME);
    if (cookieToken) {
      this.assertTrustedOriginIfPresent(req);
    }

    const rawRefreshToken = cookieToken ?? body.refreshToken;
    const rawAccessToken =
      this.readBearerToken(req) ?? this.readCookie(req, ACCESS_COOKIE_NAME);

    await this.authService.logout({
      rawRefreshToken,
      rawAccessToken,
      auth: req.auth,
    });
    this.clearAuthCookies(res);
    return { success: true };
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Return current authenticated member, tenant, permissions, and branches" })
  async me(@CurrentAuth() auth: AuthenticatedContext): Promise<AuthProfileResponse> {
    return this.authService.getProfile(auth);
  }

  private readCookie(req: Request, name: string): string | undefined {
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const raw = cookies?.[name];
    return typeof raw === "string" && raw.length > 0 ? raw : undefined;
  }

  private readBearerToken(req: Request): string | undefined {
    const header = req.headers.authorization;
    if (typeof header === "string" && header.startsWith("Bearer ")) {
      const token = header.slice(7).trim();
      return token.length > 0 ? token : undefined;
    }
    return undefined;
  }

  private assertTrustedOriginIfPresent(req: Request): void {
    const originHeader = req.headers.origin;
    if (typeof originHeader !== "string" || originHeader.length === 0) {
      return;
    }

    if (!this.allowedOrigins.has(originHeader)) {
      throw new ForbiddenException({
        code: ERROR_CODES.AUTH_FORBIDDEN,
        message: "Origin không được phép thực hiện thao tác này",
      });
    }
  }

  private setAuthCookies(res: Response, result: AuthIssueResult): void {
    const accessMaxAgeMs = this.tokenService.getTokenTtlMs(
      result.session.accessToken,
      DEFAULT_ACCESS_COOKIE_MAX_AGE_MS,
    );
    const refreshMaxAgeMs = Math.max(
      1000,
      result.refreshExpiresAt.getTime() - Date.now() ||
        DEFAULT_REFRESH_COOKIE_MAX_AGE_MS,
    );

    res.cookie(ACCESS_COOKIE_NAME, result.session.accessToken, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: "lax",
      path: "/",
      maxAge: accessMaxAgeMs,
    });

    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: "lax",
      path: "/api/v1/auth",
      maxAge: refreshMaxAgeMs,
    });
  }

  private clearAuthCookies(res: Response): void {
    res.clearCookie(ACCESS_COOKIE_NAME, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: "lax",
      path: "/",
    });

    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: "lax",
      path: "/api/v1/auth",
    });
  }
}
