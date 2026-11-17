import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type BalanceStockCountInput,
  balanceStockCountSchema,
  type CreateStockCountInput,
  createStockCountSchema,
  PERMISSIONS,
  type StockCountItemResponse,
  type StockCountListQuery,
  stockCountListQuerySchema,
  type StockCountListResponse,
  uuidSchema,
} from "@smart-pos/shared";
import type { Request } from "express";
import { CurrentAuth, RequirePermissions } from "../auth/auth.decorators";
import type { AuthenticatedContext } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { extractRequestMeta } from "../common/http/request-meta";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { StockCountsService } from "./stock-counts.service";

@ApiTags("Stock Counts")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("stock-counts")
export class StockCountsController {
  constructor(private readonly stockCountsService: StockCountsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @ApiOperation({ summary: "List stock count / reconciliation documents" })
  async list(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(stockCountListQuerySchema))
    query: StockCountListQuery,
  ): Promise<StockCountListResponse> {
    return this.stockCountsService.list(auth, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.INVENTORY_COUNT)
  @ApiOperation({ summary: "Create stock count draft (or balance immediately)" })
  async create(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createStockCountSchema))
    body: CreateStockCountInput,
    @Req() req: Request,
  ): Promise<StockCountItemResponse> {
    return this.stockCountsService.create(
      auth,
      body,
      extractRequestMeta(req),
    );
  }

  @Post(":id/balance")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.INVENTORY_COUNT)
  @ApiOperation({ summary: "Balance stock count: adjust inventory, write ledger & audit log" })
  async balance(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) stockCountId: string,
    @Body(new ZodValidationPipe(balanceStockCountSchema))
    body: BalanceStockCountInput,
    @Req() req: Request,
  ): Promise<StockCountItemResponse> {
    return this.stockCountsService.balance(
      auth,
      stockCountId,
      body,
      extractRequestMeta(req),
    );
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.INVENTORY_COUNT)
  @ApiOperation({ summary: "Cancel a DRAFT stock count" })
  async cancel(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) stockCountId: string,
  ): Promise<StockCountItemResponse> {
    return this.stockCountsService.cancel(auth, stockCountId);
  }
}
