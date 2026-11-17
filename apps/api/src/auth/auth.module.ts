import { Module } from "@nestjs/common";
import { RateLimitModule } from "../common/rate-limit/rate-limit.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { PermissionsGuard } from "./guards/permissions.guard";
import { TokenService } from "./token.service";

@Module({
  imports: [RateLimitModule],
  controllers: [AuthController],
  providers: [TokenService, AuthService, JwtAuthGuard, PermissionsGuard],
  exports: [TokenService, JwtAuthGuard, PermissionsGuard],
})
export class AuthModule {}
