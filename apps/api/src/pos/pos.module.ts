import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PosCatalogSyncService } from "./pos-catalog-sync.service";
import { PosCheckoutService } from "./pos-checkout.service";
import { PosEventsService } from "./pos-events.service";
import { PosShiftsService } from "./pos-shifts.service";
import { PosController } from "./pos.controller";

@Module({
  imports: [AuthModule],
  controllers: [PosController],
  providers: [
    PosEventsService,
    PosCatalogSyncService,
    PosShiftsService,
    PosCheckoutService,
  ],
  exports: [PosEventsService],
})
export class PosModule {}
