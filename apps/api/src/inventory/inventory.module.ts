import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { PurchaseOrdersController } from "./purchase-orders.controller";
import { PurchaseOrdersService } from "./purchase-orders.service";
import { StockCountsController } from "./stock-counts.controller";
import { StockCountsService } from "./stock-counts.service";
import { SuppliersController } from "./suppliers.controller";
import { SuppliersService } from "./suppliers.service";

@Module({
  imports: [AuthModule],
  controllers: [
    InventoryController,
    SuppliersController,
    PurchaseOrdersController,
    StockCountsController,
  ],
  providers: [
    InventoryService,
    SuppliersService,
    PurchaseOrdersService,
    StockCountsService,
  ],
  exports: [InventoryService, SuppliersService],
})
export class InventoryModule {}
