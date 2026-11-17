import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  type MessageEvent,
  Param,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type CloseShiftInput,
  closeShiftSchema,
  type CreateInvoiceInput,
  createInvoiceSchema,
  type InvoiceListQuery,
  invoiceListQuerySchema,
  type InvoiceReceiptResponse,
  type OpenShiftInput,
  openShiftSchema,
  PERMISSIONS,
  type PosCatalogSyncQuery,
  posCatalogSyncQuerySchema,
  type PosCatalogSyncResponse,
  type RegisterShiftItem,
  type ShiftQuery,
  shiftQuerySchema,
  type ShiftZReportResponse,
  uuidSchema,
} from "@smart-pos/shared";
import type { Request } from "express";
import type { Observable } from "rxjs";
import { CurrentAuth, RequirePermissions } from "../auth/auth.decorators";
import type { AuthenticatedContext } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { extractRequestMeta } from "../common/http/request-meta";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { PosCatalogSyncService } from "./pos-catalog-sync.service";
import { PosCheckoutService } from "./pos-checkout.service";
import { PosEventsService } from "./pos-events.service";
import { PosShiftsService } from "./pos-shifts.service";

@ApiTags("POS")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("pos")
export class PosController {
  constructor(
    private readonly catalogSyncService: PosCatalogSyncService,
    private readonly shiftsService: PosShiftsService,
    private readonly checkoutService: PosCheckoutService,
    private readonly eventsService: PosEventsService,
  ) {}

  @Get("catalog-sync")
  @RequirePermissions(PERMISSIONS.POS_SELL)
  @ApiOperation({ summary: "Sync branch products, variants, and inventory snapshot/delta for IndexedDB" })
  async catalogSync(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(posCatalogSyncQuerySchema))
    query: PosCatalogSyncQuery,
  ): Promise<PosCatalogSyncResponse> {
    return this.catalogSyncService.syncBranchCatalog(auth, query);
  }

  @Sse("events")
  @RequirePermissions(PERMISSIONS.POS_SELL)
  @ApiOperation({ summary: "Subscribe to real-time branch stock update SSE stream" })
  streamEvents(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query("branchId", new ZodValidationPipe(uuidSchema.optional()))
    branchId?: string,
  ): Observable<MessageEvent> {
    return this.eventsService.streamForTenant(auth.tenantId, branchId);
  }

  @Get("shifts/current")
  @RequirePermissions(PERMISSIONS.POS_SHIFT_MANAGE)
  @ApiOperation({ summary: "Get active OPEN register shift for branch" })
  async getCurrentShift(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query("branchId", new ZodValidationPipe(uuidSchema)) branchId: string,
  ): Promise<{ shift: RegisterShiftItem | null }> {
    const shift = await this.shiftsService.getCurrentOpenShift(auth, branchId);
    return { shift };
  }

  @Get("shifts")
  @RequirePermissions(PERMISSIONS.POS_SHIFT_MANAGE)
  @ApiOperation({ summary: "List register shifts" })
  async listShifts(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(shiftQuerySchema)) query: ShiftQuery,
  ) {
    return this.shiftsService.listShifts(auth, query);
  }

  @Post("shifts/open")
  @RequirePermissions(PERMISSIONS.POS_SHIFT_MANAGE)
  @ApiOperation({ summary: "Open a new cashier register shift with opening cash count" })
  async openShift(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(openShiftSchema)) body: OpenShiftInput,
  ): Promise<RegisterShiftItem> {
    return this.shiftsService.openShift(auth, body);
  }

  @Get("shifts/:id/z-report")
  @RequirePermissions(PERMISSIONS.POS_SHIFT_MANAGE)
  @ApiOperation({ summary: "Get Z-Report summary for a shift" })
  async getZReport(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) shiftId: string,
  ): Promise<ShiftZReportResponse> {
    return this.shiftsService.getZReport(auth, shiftId);
  }

  @Post("shifts/:id/close")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.POS_SHIFT_MANAGE)
  @ApiOperation({ summary: "Close an open shift with actual cash count and compute Z-Report variance" })
  async closeShift(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) shiftId: string,
    @Body(new ZodValidationPipe(closeShiftSchema)) body: CloseShiftInput,
    @Req() req: Request,
  ): Promise<ShiftZReportResponse> {
    return this.shiftsService.closeShift(
      auth,
      shiftId,
      body,
      extractRequestMeta(req),
    );
  }

  @Get("invoices")
  @RequirePermissions(PERMISSIONS.POS_SELL)
  @ApiOperation({ summary: "List POS invoices (e.g. current shift receipts)" })
  async listInvoices(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(invoiceListQuerySchema))
    query: InvoiceListQuery,
  ) {
    return this.checkoutService.listInvoices(auth, query);
  }

  @Post("invoices")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.POS_SELL)
  @ApiOperation({ summary: "Checkout POS invoice atomically (idempotencyKey + RepeatableRead + on_hand guard)" })
  async checkout(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createInvoiceSchema)) body: CreateInvoiceInput,
    @Req() req: Request,
  ): Promise<InvoiceReceiptResponse> {
    return this.checkoutService.checkout(auth, body, extractRequestMeta(req));
  }
}
