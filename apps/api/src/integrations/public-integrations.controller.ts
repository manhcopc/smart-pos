import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import {
  type AccountingExportQuery,
  accountingExportQuerySchema,
  ERROR_CODES,
  type ExternalInventoryQuery,
  externalInventoryQuerySchema,
  type ExternalOrderSyncInput,
  externalOrderSyncSchema,
} from "@smart-pos/shared";
import type { Response } from "express";
import { extractRequestMeta } from "../common/http/request-meta";
import { sendXlsxResponse } from "../common/http/xlsx-response.helper";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { ReportExportsService } from "../reports/report-exports.service";
import {
  type ApiKeyAuthenticatedRequest,
  type ApiKeyContext,
  ApiKeyGuard,
  RequireApiScopes,
} from "./api-key.guard";
import { IntegrationsService } from "./integrations.service";

function extractApiKeyContext(req: ApiKeyAuthenticatedRequest): ApiKeyContext {
  if (!req.apiKeyContext) {
    throw new UnauthorizedException({
      code: ERROR_CODES.INVALID_API_KEY,
      message: "Thiếu ngữ cảnh API Key",
    });
  }
  return req.apiKeyContext;
}

@ApiTags("Public Omnichannel API (X-Api-Key)")
@ApiSecurity("X-Api-Key")
@UseGuards(ApiKeyGuard)
@Controller("integrations/public")
export class PublicIntegrationsController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly reportExportsService: ReportExportsService,
  ) {}

  @Get("inventory")
  @RequireApiScopes("inventory:read")
  @ApiOperation({ summary: "Query tenant real-time branch stock via X-Api-Key (RLS isolated)" })
  async getInventory(
    @Req() req: ApiKeyAuthenticatedRequest,
    @Query(new ZodValidationPipe(externalInventoryQuerySchema))
    query: ExternalInventoryQuery,
  ) {
    return this.integrationsService.queryPublicInventory(
      extractApiKeyContext(req),
      query,
    );
  }

  @Post("orders")
  @HttpCode(HttpStatus.OK)
  @RequireApiScopes("orders:write")
  @ApiOperation({ summary: "Sync external e-commerce order with deterministic idempotency & atomic stock deduction" })
  async syncOrder(
    @Req() req: ApiKeyAuthenticatedRequest,
    @Body(new ZodValidationPipe(externalOrderSyncSchema))
    body: ExternalOrderSyncInput,
  ) {
    return this.integrationsService.syncExternalOrder(
      extractApiKeyContext(req),
      body,
      extractRequestMeta(req),
    );
  }

  @Get("accounting/export")
  @RequireApiScopes("accounting:read")
  @ApiOperation({ summary: "External accounting system pull of 3-sheet Excel ledger via X-Api-Key" })
  async exportAccounting(
    @Req() req: ApiKeyAuthenticatedRequest,
    @Query(new ZodValidationPipe(accountingExportQuerySchema))
    query: AccountingExportQuery,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = extractApiKeyContext(req);
    const { buffer } = await this.reportExportsService.buildAccountingWorkbookBuffer(
      ctx.tenantId,
      {
        branchId: query.branchId ?? null,
        from: query.from ?? null,
        to: query.to ?? null,
      },
    );
    const stamp = new Date(Date.now() + 7 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    sendXlsxResponse(res, `smartpos-accounting-ledger-${stamp}.xlsx`, buffer);
  }
}
