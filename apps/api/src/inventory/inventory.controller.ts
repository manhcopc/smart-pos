import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type InventoryLedgerListResponse,
  type InventoryListResponse,
  type InventoryQuery,
  inventoryQuerySchema,
  type LedgerQuery,
  ledgerQuerySchema,
  PERMISSIONS,
} from "@smart-pos/shared";
import { CurrentAuth, RequirePermissions } from "../auth/auth.decorators";
import type { AuthenticatedContext } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { InventoryService } from "./inventory.service";

@ApiTags("Inventory")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
@Controller("inventory")
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @ApiOperation({ summary: "Query branch inventory stock levels and low-stock alerts" })
  async list(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(inventoryQuerySchema)) query: InventoryQuery,
  ): Promise<InventoryListResponse> {
    return this.inventoryService.listInventory(auth, query);
  }

  @Get("ledgers")
  @ApiOperation({ summary: "Query immutable inventory ledger history (thẻ kho)" })
  async ledgers(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(ledgerQuerySchema)) query: LedgerQuery,
  ): Promise<InventoryLedgerListResponse> {
    return this.inventoryService.listLedgers(auth, query);
  }
}
