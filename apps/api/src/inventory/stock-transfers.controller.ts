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
  type CreateStockTransferInput,
  createStockTransferSchema,
  PERMISSIONS,
  type ReceiveStockTransferInput,
  receiveStockTransferSchema,
  type StockTransferItemView,
  type StockTransferQuery,
  stockTransferQuerySchema,
  uuidSchema,
} from "@smart-pos/shared";
import type { Request } from "express";
import { CurrentAuth, RequirePermissions } from "../auth/auth.decorators";
import type { AuthenticatedContext } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { extractRequestMeta } from "../common/http/request-meta";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { StockTransfersService } from "./stock-transfers.service";

@ApiTags("Inventory Transfers")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("stock-transfers")
export class StockTransfersController {
  constructor(private readonly transfersService: StockTransfersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @ApiOperation({ summary: "List inter-branch stock transfers" })
  async list(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(stockTransferQuerySchema))
    query: StockTransferQuery,
  ) {
    return this.transfersService.listTransfers(auth, query);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @ApiOperation({ summary: "Get detail of an inter-branch stock transfer" })
  async detail(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) transferId: string,
  ): Promise<StockTransferItemView> {
    return this.transfersService.getTransferDetail(auth, transferId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @ApiOperation({ summary: "Dispatch inter-branch stock transfer (deduct origin stock -> IN_TRANSIT)" })
  async dispatch(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createStockTransferSchema))
    body: CreateStockTransferInput,
    @Req() req: Request,
  ): Promise<StockTransferItemView> {
    return this.transfersService.dispatchTransfer(
      auth,
      body,
      extractRequestMeta(req),
    );
  }

  @Post(":id/receive")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @ApiOperation({ summary: "Receive an IN_TRANSIT stock transfer at destination branch with AVCO update" })
  async receive(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) transferId: string,
    @Body(new ZodValidationPipe(receiveStockTransferSchema))
    body: ReceiveStockTransferInput,
    @Req() req: Request,
  ): Promise<StockTransferItemView> {
    return this.transfersService.receiveTransfer(
      auth,
      transferId,
      body,
      extractRequestMeta(req),
    );
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @ApiOperation({ summary: "Cancel an IN_TRANSIT stock transfer and restore stock to origin branch" })
  async cancel(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) transferId: string,
  ): Promise<StockTransferItemView> {
    return this.transfersService.cancelTransfer(auth, transferId);
  }
}
