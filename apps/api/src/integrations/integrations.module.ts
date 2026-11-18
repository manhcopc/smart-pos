import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PosModule } from "../pos/pos.module";
import { ReportsModule } from "../reports/reports.module";
import { ApiKeyGuard } from "./api-key.guard";
import { IntegrationsController } from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";
import { PublicIntegrationsController } from "./public-integrations.controller";

@Module({
  imports: [AuthModule, ReportsModule, PosModule],
  controllers: [IntegrationsController, PublicIntegrationsController],
  providers: [IntegrationsService, ApiKeyGuard],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
