import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type BillingPaymentWebhookInput,
  billingPaymentWebhookSchema,
  PERMISSIONS,
  type SubscribePlanInput,
  subscribePlanSchema,
  type SubscriptionBillingItem,
  type SubscriptionOverviewResponse,
} from "@smart-pos/shared";
import type { Request } from "express";
import { CurrentAuth, RequirePermissions } from "../auth/auth.decorators";
import type { AuthenticatedContext } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { extractRequestMeta } from "../common/http/request-meta";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { BillingService } from "./billing.service";

@ApiTags("SaaS Billing & Subscriptions")
@Controller("billing")
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get("subscription")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.BRANCH_MANAGE)
  @ApiOperation({ summary: "Get active SaaS plan, trial countdown, usage quotas, and billing history" })
  async getSubscription(
    @CurrentAuth() auth: AuthenticatedContext,
  ): Promise<SubscriptionOverviewResponse> {
    return this.billingService.getSubscriptionOverview(auth);
  }

  @Post("subscribe")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.BILLING_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Upgrade, switch, or renew tenant SaaS plan (with downgrade quota check)" })
  async subscribe(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(subscribePlanSchema)) body: SubscribePlanInput,
    @Req() req: Request,
  ): Promise<SubscriptionBillingItem> {
    return this.billingService.subscribePlan(auth, body, extractRequestMeta(req));
  }

  @Post("payment-webhook")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Signed SaaS payment gateway webhook confirmation" })
  async paymentWebhook(
    @Body(new ZodValidationPipe(billingPaymentWebhookSchema))
    body: BillingPaymentWebhookInput,
  ): Promise<{ ok: true; status: string }> {
    return this.billingService.processPaymentWebhook(body);
  }
}
