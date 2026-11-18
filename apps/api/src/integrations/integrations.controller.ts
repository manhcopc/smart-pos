import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type AccountingExportQuery,
  accountingExportQuerySchema,
  type ApiKeyItem,
  type CreateApiKeyInput,
  createApiKeySchema,
  type CreateApiKeyResponse,
  type CreateWebhookInput,
  createWebhookSchema,
  PERMISSIONS,
  type UpdateWebhookInput,
  updateWebhookSchema,
  uuidSchema,
  type WebhookDeliveryItem,
  type WebhookEndpointItem,
  webhookDeliveriesQuerySchema,
} from "@smart-pos/shared";
import type { Request, Response } from "express";
import { CurrentAuth, RequirePermissions } from "../auth/auth.decorators";
import type { AuthenticatedContext } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { extractRequestMeta } from "../common/http/request-meta";
import { sendXlsxResponse } from "../common/http/xlsx-response.helper";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { ReportExportsService } from "../reports/report-exports.service";
import { IntegrationsService } from "./integrations.service";

@ApiTags("Integrations, Webhooks & Accounting Export")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("integrations")
export class IntegrationsController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly reportExportsService: ReportExportsService,
  ) {}

  @Get("api-keys")
  @RequirePermissions(PERMISSIONS.INTEGRATION_MANAGE)
  @ApiOperation({ summary: "List tenant omnichannel API keys (hashes never returned)" })
  async listApiKeys(
    @CurrentAuth() auth: AuthenticatedContext,
  ): Promise<ApiKeyItem[]> {
    return this.integrationsService.listApiKeys(auth);
  }

  @Post("api-keys")
  @RequirePermissions(PERMISSIONS.INTEGRATION_MANAGE)
  @ApiOperation({ summary: "Create new scoped tenant API key (plainTextKey shown once)" })
  async createApiKey(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createApiKeySchema)) body: CreateApiKeyInput,
    @Req() req: Request,
  ): Promise<CreateApiKeyResponse> {
    return this.integrationsService.createApiKey(
      auth,
      body,
      extractRequestMeta(req),
    );
  }

  @Delete("api-keys/:id")
  @RequirePermissions(PERMISSIONS.INTEGRATION_MANAGE)
  @ApiOperation({ summary: "Revoke a tenant API key immediately" })
  async revokeApiKey(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) keyId: string,
    @Req() req: Request,
  ): Promise<ApiKeyItem> {
    return this.integrationsService.revokeApiKey(
      auth,
      keyId,
      extractRequestMeta(req),
    );
  }

  @Get("webhooks")
  @RequirePermissions(PERMISSIONS.INTEGRATION_MANAGE)
  @ApiOperation({ summary: "List configured outbound webhook endpoints" })
  async listWebhooks(
    @CurrentAuth() auth: AuthenticatedContext,
  ): Promise<WebhookEndpointItem[]> {
    return this.integrationsService.listWebhooks(auth);
  }

  @Post("webhooks")
  @RequirePermissions(PERMISSIONS.INTEGRATION_MANAGE)
  @ApiOperation({ summary: "Register an SSRF-validated webhook endpoint with HMAC secret" })
  async createWebhook(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createWebhookSchema)) body: CreateWebhookInput,
    @Req() req: Request,
  ): Promise<WebhookEndpointItem> {
    return this.integrationsService.createWebhook(
      auth,
      body,
      extractRequestMeta(req),
    );
  }

  @Patch("webhooks/:id")
  @RequirePermissions(PERMISSIONS.INTEGRATION_MANAGE)
  @ApiOperation({ summary: "Update webhook events, target URL, or active toggle" })
  async updateWebhook(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) webhookId: string,
    @Body(new ZodValidationPipe(updateWebhookSchema)) body: UpdateWebhookInput,
  ): Promise<WebhookEndpointItem> {
    return this.integrationsService.updateWebhook(auth, webhookId, body);
  }

  @Delete("webhooks/:id")
  @RequirePermissions(PERMISSIONS.INTEGRATION_MANAGE)
  @ApiOperation({ summary: "Delete a webhook endpoint" })
  async deleteWebhook(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) webhookId: string,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    return this.integrationsService.deleteWebhook(
      auth,
      webhookId,
      extractRequestMeta(req),
    );
  }

  @Get("webhooks/deliveries")
  @RequirePermissions(PERMISSIONS.INTEGRATION_MANAGE)
  @ApiOperation({ summary: "View recent BullMQ webhook delivery attempts and HTTP statuses" })
  async listDeliveries(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(webhookDeliveriesQuerySchema))
    query: { limit: number },
  ): Promise<WebhookDeliveryItem[]> {
    return this.integrationsService.listDeliveries(auth, query.limit);
  }

  @Post("webhooks/:id/test")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.INTEGRATION_MANAGE)
  @ApiOperation({ summary: "Dispatch a signed STOCK_UPDATED test payload via BullMQ" })
  async testWebhook(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) webhookId: string,
  ): Promise<{ enqueued: true }> {
    return this.integrationsService.testWebhook(auth, webhookId);
  }

  @Get("accounting/export")
  @RequirePermissions(PERMISSIONS.REPORT_FINANCIAL)
  @ApiOperation({ summary: "Direct download 3-sheet Excel accounting ledger (.xlsx)" })
  async exportAccountingDirect(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(accountingExportQuerySchema))
    query: AccountingExportQuery,
    @Res() res: Response,
  ): Promise<void> {
    const { fileName, buffer } =
      await this.reportExportsService.exportAccountingWorkbookDirect(
        auth,
        query,
      );
    sendXlsxResponse(res, fileName, buffer);
  }
}
