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
  type CashDrawerOpenInput,
  cashDrawerOpenSchema,
  type CloseShiftInput,
  closeShiftSchema,
  type CreateInvoiceInput,
  createInvoiceSchema,
  type CreateSalesReturnInput,
  createSalesReturnSchema,
  type InvoiceDetailResponse,
  type InvoiceListQuery,
  invoiceListQuerySchema,
  type InvoiceReceiptResponse,
  type OfflineSyncBatchInput,
  offlineSyncBatchSchema,
  type OfflineSyncBatchResponse,
  type OpenShiftInput,
  openShiftSchema,
  PERMISSIONS,
  type PosCatalogSyncQuery,
  posCatalogSyncQuerySchema,
  type PosCatalogSyncResponse,
  type RegisterShiftItem,
  type SalesReturnListQuery,
  salesReturnListQuerySchema,
  type SalesReturnResponse,
  type ShiftQuery,
  shiftQuerySchema,
  type ShiftZReportResponse,
  type SupervisorApprovalResponse,
  type SupervisorPinVerifyInput,
  supervisorPinVerifySchema,
  uuidSchema,
  type VoidInvoiceInput,
  voidInvoiceSchema,
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
import { PosOfflineSyncService } from "./pos-offline-sync.service";
import { PosReturnsService } from "./pos-returns.service";
import { PosShiftsService } from "./pos-shifts.service";
import { PosSupervisorService } from "./pos-supervisor.service";

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
    private readonly returnsService: PosReturnsService,
    private readonly supervisorService: PosSupervisorService,
    private readonly offlineSyncService: PosOfflineSyncService,
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

  @Post("supervisor-approve")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.POS_SELL)
  @ApiOperation({ summary: "Verify a supervisor PIN for sensitive POS actions and issue a short-lived approval token" })
  async approveSupervisorPin(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(supervisorPinVerifySchema))
    body: SupervisorPinVerifyInput,
    @Req() req: Request,
  ): Promise<SupervisorApprovalResponse> {
    return this.supervisorService.approveWithPin(
      auth,
      body,
      extractRequestMeta(req),
    );
  }

  @Get("invoices/:id")
  @RequirePermissions(PERMISSIONS.POS_SELL)
  @ApiOperation({ summary: "Get full POS invoice detail including returned quantities and return receipts" })
  async getInvoiceDetail(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) invoiceId: string,
  ): Promise<InvoiceDetailResponse> {
    return this.returnsService.getInvoiceDetail(auth, invoiceId);
  }

  @Post("invoices/:id/void")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.POS_SELL)
  @ApiOperation({ summary: "Void an unreturned POS invoice atomically and record INVOICE_VOID AuditLog" })
  async voidInvoice(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) invoiceId: string,
    @Body(new ZodValidationPipe(voidInvoiceSchema)) body: VoidInvoiceInput,
    @Req() req: Request,
  ): Promise<InvoiceReceiptResponse> {
    return this.returnsService.voidInvoice(
      auth,
      invoiceId,
      body,
      extractRequestMeta(req),
    );
  }

  @Get("returns")
  @RequirePermissions(PERMISSIONS.POS_SELL)
  @ApiOperation({ summary: "List sales returns for accessible branches" })
  async listReturns(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(salesReturnListQuerySchema))
    query: SalesReturnListQuery,
  ) {
    return this.returnsService.listReturns(auth, query);
  }

  @Post("invoices/:id/returns")
  @RequirePermissions(PERMISSIONS.POS_SELL)
  @ApiOperation({ summary: "Process partial or full sales return with cumulative returned_qty guard and restock" })
  async createReturn(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) invoiceId: string,
    @Body(new ZodValidationPipe(createSalesReturnSchema))
    body: CreateSalesReturnInput,
    @Req() req: Request,
  ): Promise<SalesReturnResponse> {
    return this.returnsService.createReturn(
      auth,
      invoiceId,
      body,
      extractRequestMeta(req),
    );
  }

  @Post("cash-drawer/open")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.POS_SELL)
  @ApiOperation({ summary: "Record opening the physical cash drawer without a sale into AuditLog" })
  async openCashDrawer(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(cashDrawerOpenSchema))
    body: CashDrawerOpenInput,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    return this.returnsService.openCashDrawer(
      auth,
      body,
      extractRequestMeta(req),
    );
  }

  @Post("offline-sync/invoices")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.POS_SELL)
  @ApiOperation({ summary: "Batch synchronize queued IndexedDB offline invoices and return stock/shift conflict diagnostics" })
  async syncOfflineInvoices(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(offlineSyncBatchSchema))
    body: OfflineSyncBatchInput,
    @Req() req: Request,
  ): Promise<OfflineSyncBatchResponse> {
    return this.offlineSyncService.syncOfflineBatch(
      auth,
      body,
      extractRequestMeta(req),
    );
  }
}
