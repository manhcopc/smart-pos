import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PosCatalogSyncService } from "./pos-catalog-sync.service";
import { PosCheckoutService } from "./pos-checkout.service";
import { PosEventsService } from "./pos-events.service";
import { PosOfflineSyncService } from "./pos-offline-sync.service";
import { PosReturnsService } from "./pos-returns.service";
import { PosShiftsService } from "./pos-shifts.service";
import { PosSupervisorService } from "./pos-supervisor.service";
import { PosController } from "./pos.controller";

@Module({
  imports: [AuthModule],
  controllers: [PosController],
  providers: [
    PosEventsService,
    PosCatalogSyncService,
    PosShiftsService,
    PosSupervisorService,
    PosCheckoutService,
    PosReturnsService,
    PosOfflineSyncService,
  ],
  exports: [PosEventsService, PosSupervisorService, PosCheckoutService],
})
export class PosModule {}
