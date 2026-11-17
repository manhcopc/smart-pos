import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type CompletePurchaseOrderInput,
  completePurchaseOrderSchema,
  type CreatePurchaseOrderInput,
  createPurchaseOrderSchema,
  PERMISSIONS,
  type PurchaseOrderItemResponse,
  type PurchaseOrderListQuery,
  purchaseOrderListQuerySchema,
  type PurchaseOrderListResponse,
  uuidSchema,
} from "@smart-pos/shared";
import { CurrentAuth, RequirePermissions } from "../auth/auth.decorators";
import type { AuthenticatedContext } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { PurchaseOrdersService } from "./purchase-orders.service";

@ApiTags("Purchase Orders")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("purchase-orders")
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @ApiOperation({ summary: "List paginated purchase orders" })
  async list(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(purchaseOrderListQuerySchema))
    query: PurchaseOrderListQuery,
  ): Promise<PurchaseOrderListResponse> {
    return this.purchaseOrdersService.list(auth, query);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @ApiOperation({ summary: "Get single purchase order details" })
  async getOne(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) poId: string,
  ): Promise<PurchaseOrderItemResponse> {
    return this.purchaseOrdersService.getOne(auth, poId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.INVENTORY_RECEIVE)
  @ApiOperation({ summary: "Create purchase order draft (or complete immediately)" })
  async create(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createPurchaseOrderSchema))
    body: CreatePurchaseOrderInput,
  ): Promise<PurchaseOrderItemResponse> {
    return this.purchaseOrdersService.create(auth, body);
  }

  @Post(":id/complete")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.INVENTORY_RECEIVE)
  @ApiOperation({ summary: "Complete purchase order: update branch stock, AVCO cost, supplier debt, and ledger" })
  async complete(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) poId: string,
    @Body(new ZodValidationPipe(completePurchaseOrderSchema))
    body: CompletePurchaseOrderInput,
  ): Promise<PurchaseOrderItemResponse> {
    return this.purchaseOrdersService.complete(auth, poId, body);
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.INVENTORY_RECEIVE)
  @ApiOperation({ summary: "Cancel a DRAFT purchase order" })
  async cancel(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) poId: string,
  ): Promise<PurchaseOrderItemResponse> {
    return this.purchaseOrdersService.cancel(auth, poId);
  }
}
