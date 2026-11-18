import crypto from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import {
  type BillingPaymentWebhookInput,
  ERROR_CODES,
  formatMoney,
  parseMoney,
  type SubscribePlanInput,
  type SubscriptionBillingItem,
  type SubscriptionOverviewResponse,
  type SubscriptionPlanCodeType,
  type SubscriptionPlanInfo,
} from "@smart-pos/shared";
import type { AuthenticatedContext, RequestMeta } from "../auth/auth.types";
import type { AppEnv } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class BillingService {
  private readonly webhookSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<AppEnv, true>,
  ) {
    this.webhookSecret = this.configService.get("JWT_ACCESS_SECRET", {
      infer: true,
    });
  }

  signBillingWebhookPayload(
    billingId: string,
    tenantId: string,
    status: string,
  ): string {
    return crypto
      .createHmac("sha256", this.webhookSecret)
      .update(`${billingId}:${tenantId}:${status}`)
      .digest("hex");
  }

  async getSubscriptionOverview(
    auth: AuthenticatedContext,
  ): Promise<SubscriptionOverviewResponse> {
    const [tenantRow, allPlans, billingUsage] = await Promise.all([
      this.prisma.tenant.findFirstOrThrow({
        where: { id: auth.tenantId, deletedAt: null },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          trialEndsAt: true,
          plan: true,
        },
      }),
      this.prisma.subscriptionPlan.findMany({
        orderBy: { priceMonthly: "asc" },
      }),
      this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
        const [activeBranches, activeUsers, activeSkus, history] =
          await Promise.all([
            tx.branch.count({ where: { isActive: true } }),
            tx.tenantMember.count({ where: { isActive: true } }),
            tx.productVariant.count({ where: { isActive: true } }),
            tx.subscriptionBilling.findMany({
              orderBy: { createdAt: "desc" },
              take: 20,
            }),
          ]);
        return { activeBranches, activeUsers, activeSkus, history };
      }),
    ]);

    const nowMs = Date.now();
    const trialEndsMs = tenantRow.trialEndsAt?.getTime() ?? null;
    const isTrialExpired =
      tenantRow.plan.code === "FREE_TRIAL" &&
      trialEndsMs !== null &&
      trialEndsMs < nowMs;
    const daysRemaining =
      trialEndsMs !== null
        ? Math.max(0, Math.ceil((trialEndsMs - nowMs) / (24 * 60 * 60 * 1000)))
        : null;

    return {
      tenant: {
        id: tenantRow.id,
        name: tenantRow.name,
        slug: tenantRow.slug,
        status: tenantRow.status,
        trialEndsAt: tenantRow.trialEndsAt
          ? tenantRow.trialEndsAt.toISOString()
          : null,
        daysRemaining,
        isTrialExpired,
      },
      currentPlan: this.serializePlan(tenantRow.plan),
      usage: {
        activeBranches: billingUsage.activeBranches,
        activeUsers: billingUsage.activeUsers,
        activeSkus: billingUsage.activeSkus,
      },
      availablePlans: allPlans.map((p) => this.serializePlan(p)),
      billingHistory: billingUsage.history.map((b) => ({
        id: b.id,
        planCode: b.planCode as SubscriptionPlanCodeType,
        billingMonths: b.billingMonths,
        amount: b.amount.toFixed(2),
        status: b.status,
        provider: b.provider,
        referenceNo: b.referenceNo,
        periodStart: b.periodStart.toISOString(),
        periodEnd: b.periodEnd.toISOString(),
        paidAt: b.paidAt ? b.paidAt.toISOString() : null,
        createdAt: b.createdAt.toISOString(),
      })),
    };
  }

  async subscribePlan(
    auth: AuthenticatedContext,
    input: SubscribePlanInput,
    meta: RequestMeta,
  ): Promise<SubscriptionBillingItem> {
    const targetPlan = await this.prisma.subscriptionPlan.findUnique({
      where: { code: input.planCode },
    });
    if (!targetPlan) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: "Không tìm thấy gói SaaS được chọn",
      });
    }

    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      await tx.$executeRaw`
        SELECT id FROM tenants
        WHERE id = ${auth.tenantId}::uuid
          AND deleted_at IS NULL
        FOR UPDATE
      `;

      const [activeBranches, activeUsers, activeSkus] = await Promise.all([
        tx.branch.count({ where: { isActive: true } }),
        tx.tenantMember.count({ where: { isActive: true } }),
        tx.productVariant.count({ where: { isActive: true } }),
      ]);

      if (
        activeBranches > targetPlan.maxBranches ||
        activeUsers > targetPlan.maxUsers ||
        activeSkus > targetPlan.maxSkus
      ) {
        throw new ConflictException({
          code: ERROR_CODES.PLAN_QUOTA_EXCEEDED,
          message: `Không thể chuyển sang gói ${targetPlan.name} vì dữ liệu hiện tại vượt hạn mức (${activeBranches}/${targetPlan.maxBranches} chi nhánh, ${activeUsers}/${targetPlan.maxUsers} nhân viên, ${activeSkus}/${targetPlan.maxSkus} SKU).`,
        });
      }

      const periodStart = new Date();
      const durationDays =
        targetPlan.code === "FREE_TRIAL" ? 30 : input.billingMonths * 30;
      const periodEnd = new Date(
        periodStart.getTime() + durationDays * 24 * 60 * 60 * 1000,
      );

      const monthlyMinor = parseMoney(targetPlan.priceMonthly.toFixed(2));
      const totalAmountStr =
        targetPlan.code === "FREE_TRIAL"
          ? "0.00"
          : formatMoney(monthlyMinor * BigInt(input.billingMonths));

      const isPaidNow =
        input.confirmImmediately || targetPlan.code === "FREE_TRIAL";
      const refNo = `BILL-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

      const created = await tx.subscriptionBilling.create({
        data: {
          tenantId: auth.tenantId,
          planCode: targetPlan.code,
          billingMonths: input.billingMonths,
          amount: totalAmountStr,
          status: isPaidNow ? "PAID" : "PENDING",
          provider: input.provider,
          referenceNo: refNo,
          periodStart,
          periodEnd,
          paidAt: isPaidNow ? periodStart : null,
        },
      });

      if (isPaidNow) {
        await tx.tenant.update({
          where: { id: auth.tenantId },
          data: {
            planId: targetPlan.id,
            status: "ACTIVE",
            trialEndsAt:
              targetPlan.code === "FREE_TRIAL" ? periodEnd : null,
          },
        });

        await tx.auditLog.create({
          data: {
            tenantId: auth.tenantId,
            actorMemberId: auth.memberId,
            action: "PLAN_UPGRADED",
            entityType: "tenant",
            entityId: auth.tenantId,
            ipAddress: meta.ipAddress ?? null,
            metadata: {
              planCode: targetPlan.code,
              billingMonths: input.billingMonths,
              amount: totalAmountStr,
              referenceNo: refNo,
            },
          },
        });
      }

      return {
        id: created.id,
        planCode: created.planCode as SubscriptionPlanCodeType,
        billingMonths: created.billingMonths,
        amount: created.amount.toFixed(2),
        status: created.status,
        provider: created.provider,
        referenceNo: created.referenceNo,
        periodStart: created.periodStart.toISOString(),
        periodEnd: created.periodEnd.toISOString(),
        paidAt: created.paidAt ? created.paidAt.toISOString() : null,
        createdAt: created.createdAt.toISOString(),
      };
    });
  }

  async processPaymentWebhook(
    input: BillingPaymentWebhookInput,
  ): Promise<{ ok: true; status: string }> {
    const expectedSig = this.signBillingWebhookPayload(
      input.billingId,
      input.tenantId,
      input.status,
    );
    const sigBuf = Buffer.from(input.signature, "utf8");
    const expectedBuf = Buffer.from(expectedSig, "utf8");
    if (
      sigBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expectedBuf)
    ) {
      throw new ForbiddenException({
        code: ERROR_CODES.BILLING_PAYMENT_FAILED,
        message: "Chữ ký cổng thanh toán không hợp lệ",
      });
    }

    return this.prisma.withTenantTransaction(input.tenantId, async (tx) => {
      const billing = await tx.subscriptionBilling.findFirst({
        where: { id: input.billingId },
      });
      if (!billing) {
        throw new NotFoundException({
          code: ERROR_CODES.RESOURCE_NOT_FOUND,
          message: "Không tìm thấy hóa đơn gia hạn gói",
        });
      }

      if (billing.status === "PAID") {
        return { ok: true, status: "PAID" };
      }

      if (input.status === "FAILED") {
        await tx.subscriptionBilling.update({
          where: { id: billing.id },
          data: { status: "FAILED", referenceNo: input.referenceNo },
        });
        return { ok: true, status: "FAILED" };
      }

      const plan = await tx.subscriptionPlan.findUnique({
        where: { code: billing.planCode },
      });
      if (!plan) {
        throw new BadRequestException({
          code: ERROR_CODES.RESOURCE_NOT_FOUND,
          message: "Gói SaaS không tồn tại",
        });
      }

      const paidAt = new Date();
      await tx.subscriptionBilling.update({
        where: { id: billing.id },
        data: {
          status: "PAID",
          referenceNo: input.referenceNo,
          paidAt,
        },
      });

      await tx.tenant.update({
        where: { id: input.tenantId },
        data: {
          planId: plan.id,
          status: "ACTIVE",
          trialEndsAt: null,
        },
      });

      return { ok: true, status: "PAID" };
    });
  }

  private serializePlan(plan: {
    id: string;
    code: string;
    name: string;
    priceMonthly: Prisma.Decimal;
    maxBranches: number;
    maxUsers: number;
    maxSkus: number;
    storageQuotaMb: number;
    features: Prisma.JsonValue;
  }): SubscriptionPlanInfo {
    const rawFeatures =
      plan.features &&
      typeof plan.features === "object" &&
      !Array.isArray(plan.features)
        ? (plan.features as Record<string, unknown>)
        : {};
    return {
      id: plan.id,
      code: plan.code as SubscriptionPlanCodeType,
      name: plan.name,
      priceMonthly: plan.priceMonthly.toFixed(2),
      maxBranches: plan.maxBranches,
      maxUsers: plan.maxUsers,
      maxSkus: plan.maxSkus,
      storageQuotaMb: plan.storageQuotaMb,
      features: {
        posOffline: Boolean(rawFeatures.posOffline),
        splitPayments: Boolean(rawFeatures.splitPayments),
        multiBranchTransfer: Boolean(rawFeatures.multiBranchTransfer),
        omnichannelApi: Boolean(rawFeatures.omnichannelApi),
      },
    };
  }
}
