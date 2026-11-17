import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PosModule } from "../pos/pos.module";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { PurchaseOrdersController } from "./purchase-orders.controller";
import { PurchaseOrdersService } from "./purchase-orders.service";
import { StockCountsController } from "./stock-counts.controller";
import { StockCountsService } from "./stock-counts.service";
import { StockTransfersController } from "./stock-transfers.controller";
import { StockTransfersService } from "./stock-transfers.service";
import { SuppliersController } from "./suppliers.controller";
import { SuppliersService } from "./suppliers.service";

@Module({
  imports: [AuthModule, PosModule],
  controllers: [
    InventoryController,
    SuppliersController,
    PurchaseOrdersController,
    StockCountsController,
    StockTransfersController,
  ],
  providers: [
    InventoryService,
    SuppliersService,
    PurchaseOrdersService,
    StockCountsService,
    StockTransfersService,
  ],
  exports: [InventoryService, SuppliersService, StockTransfersService],
})
export class InventoryModule {}
