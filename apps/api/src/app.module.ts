import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { BillingModule } from "./billing/billing.module";
import { BranchesModule } from "./branches/branches.module";
import { CatalogModule } from "./catalog/catalog.module";
import { RateLimitModule } from "./common/rate-limit/rate-limit.module";
import { validateEnv } from "./config/env";
import { CustomersModule } from "./customers/customers.module";
import { HealthModule } from "./health/health.module";
import { IntegrationsModule } from "./integrations/integrations.module";
import { InventoryModule } from "./inventory/inventory.module";
import { JobsModule } from "./jobs/jobs.module";
import { PosModule } from "./pos/pos.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { ReportsModule } from "./reports/reports.module";
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
    JobsModule,
    RateLimitModule,
    AuthModule,
    BranchesModule,
    StaffModule,
    CatalogModule,
    InventoryModule,
    PosModule,
    CustomersModule,
    ReportsModule,
    BillingModule,
    IntegrationsModule,
    HealthModule,
  ],
})
export class AppModule {}
