import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { BranchesModule } from "./branches/branches.module";
import { RateLimitModule } from "./common/rate-limit/rate-limit.module";
import { validateEnv } from "./config/env";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { StaffModule } from "./staff/staff.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: [".env", "../../.env"],
    }),
    PrismaModule,
    RedisModule,
    RateLimitModule,
    AuthModule,
    BranchesModule,
    StaffModule,
    HealthModule,
  ],
})
export class AppModule {}
