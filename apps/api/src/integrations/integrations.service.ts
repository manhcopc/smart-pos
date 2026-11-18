import crypto from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import {
  type ApiKeyItem,
  calculateLineSubtotal,
  type CreateApiKeyInput,
  type CreateApiKeyResponse,
  type CreateWebhookInput,
  ERROR_CODES,
  type ExternalInventoryQuery,
  type ExternalOrderSyncInput,
  formatMoney,
  formatQuantity,
  parseMoney,
  parseQuantity,
  type UpdateWebhookInput,
  type WebhookDeliveryItem,
  type WebhookEndpointItem,
} from "@smart-pos/shared";
import type { AuthenticatedContext, RequestMeta } from "../auth/auth.types";
import {
  BullMqJobsService,
  type WebhookDeliveryJobPayload,
} from "../jobs/bullmq-jobs.service";
import { PosEventsService } from "../pos/pos-events.service";
import { getVietnamBusinessDate } from "../pos/pos-invoice.helper";
import { runWithSerializableRetry } from "../prisma/prisma-retry.helper";
import { PrismaService } from "../prisma/prisma.service";
import type { ApiKeyContext } from "./api-key.guard";
import {
  assertSafeWebhookUrl,
  generateTenantApiKey,
  signWebhookPayload,
} from "./webhook-security.helper";

function deterministicExternalOrderUuid(
  tenantId: string,
  channel: string,
  externalOrderId: string,
): string {
  const hash = crypto
    .createHash("sha256")
    .update(`ext:${tenantId}:${channel.toUpperCase()}:${externalOrderId}`)
    .digest();
  // Set RFC-4122 UUID v4/v5 version & variant bits deterministically.
  hash[6] = (hash[6]! & 0x0f) | 0x40;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

@Injectable()
export class IntegrationsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly bullMqJobs?: BullMqJobsService,
    @Optional() private readonly posEvents?: PosEventsService,
  ) {}

  onModuleInit(): void {
    this.bullMqJobs?.registerWebhookDeliveryProcessor((payload) =>
      this.deliverWebhookBatch(payload),
    );
  }

  // ---------------------------------------------------------------------------
  // Admin API Keys
  // ---------------------------------------------------------------------------

  async listApiKeys(auth: AuthenticatedContext): Promise<ApiKeyItem[]> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const rows = await tx.tenantApiKey.findMany({
        orderBy: { createdAt: "desc" },
      });
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        keyPrefix: row.keyPrefix,
        scopes: row.scopes,
        isActive: row.isActive,
        lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
      }));
    });
  }

  async createApiKey(
    auth: AuthenticatedContext,
    input: CreateApiKeyInput,
    meta: RequestMeta,
  ): Promise<CreateApiKeyResponse> {
    const generated = generateTenantApiKey(auth.tenantId);

    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const created = await tx.tenantApiKey.create({
        data: {
          tenantId: auth.tenantId,
          createdByMemberId: auth.memberId,
          name: input.name,
          keyPrefix: generated.keyPrefix,
          keyHash: generated.keyHash,
          scopes: input.scopes,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: auth.tenantId,
          actorMemberId: auth.memberId,
          action: "API_KEY_CREATED",
          entityType: "tenant_api_key",
          entityId: created.id,
          ipAddress: meta.ipAddress ?? null,
          metadata: {
            name: input.name,
            keyPrefix: generated.keyPrefix,
            scopes: input.scopes,
          },
        },
      });

      return {
        apiKey: {
          id: created.id,
          name: created.name,
          keyPrefix: created.keyPrefix,
          scopes: created.scopes,
          isActive: created.isActive,
          lastUsedAt: null,
          createdAt: created.createdAt.toISOString(),
          revokedAt: null,
        },
        plainTextKey: generated.plainTextKey,
      };
    });
  }

  async revokeApiKey(
    auth: AuthenticatedContext,
    keyId: string,
    meta: RequestMeta,
  ): Promise<ApiKeyItem> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const existing = await tx.tenantApiKey.findFirst({
        where: { id: keyId },
      });
      if (!existing) {
        throw new NotFoundException({
          code: ERROR_CODES.API_KEY_NOT_FOUND,
          message: "Không tìm thấy API Key",
        });
      }

      const updated = await tx.tenantApiKey.update({
        where: { id: keyId },
        data: { isActive: false, revokedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          tenantId: auth.tenantId,
          actorMemberId: auth.memberId,
          action: "API_KEY_REVOKED",
          entityType: "tenant_api_key",
          entityId: keyId,
          ipAddress: meta.ipAddress ?? null,
          metadata: { name: updated.name, keyPrefix: updated.keyPrefix },
        },
      });

      return {
        id: updated.id,
        name: updated.name,
        keyPrefix: updated.keyPrefix,
        scopes: updated.scopes,
        isActive: updated.isActive,
        lastUsedAt: updated.lastUsedAt ? updated.lastUsedAt.toISOString() : null,
        createdAt: updated.createdAt.toISOString(),
        revokedAt: updated.revokedAt ? updated.revokedAt.toISOString() : null,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Admin Webhooks & Delivery History
  // ---------------------------------------------------------------------------

  async listWebhooks(auth: AuthenticatedContext): Promise<WebhookEndpointItem[]> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const rows = await tx.webhookEndpoint.findMany({
        orderBy: { createdAt: "desc" },
      });
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        targetUrl: row.targetUrl,
        signingSecret: row.signingSecret,
        events: row.events,
        isActive: row.isActive,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }));
    });
  }

  async createWebhook(
    auth: AuthenticatedContext,
    input: CreateWebhookInput,
    meta: RequestMeta,
  ): Promise<WebhookEndpointItem> {
    assertSafeWebhookUrl(input.targetUrl);
    const signingSecret = `whsec_${crypto.randomBytes(20).toString("hex")}`;

    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const created = await tx.webhookEndpoint.create({
        data: {
          tenantId: auth.tenantId,
          name: input.name,
          targetUrl: input.targetUrl,
          signingSecret,
          events: input.events,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: auth.tenantId,
          actorMemberId: auth.memberId,
          action: "WEBHOOK_CREATED",
          entityType: "webhook_endpoint",
          entityId: created.id,
          ipAddress: meta.ipAddress ?? null,
          metadata: {
            name: created.name,
            targetUrl: created.targetUrl,
            events: created.events,
          },
        },
      });

      return {
        id: created.id,
        name: created.name,
        targetUrl: created.targetUrl,
        signingSecret: created.signingSecret,
        events: created.events,
        isActive: created.isActive,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      };
    });
  }

  async updateWebhook(
    auth: AuthenticatedContext,
    webhookId: string,
    input: UpdateWebhookInput,
  ): Promise<WebhookEndpointItem> {
    if (input.targetUrl) {
      assertSafeWebhookUrl(input.targetUrl);
    }

    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const existing = await tx.webhookEndpoint.findFirst({
        where: { id: webhookId },
      });
      if (!existing) {
        throw new NotFoundException({
          code: ERROR_CODES.WEBHOOK_NOT_FOUND,
          message: "Không tìm thấy cấu hình Webhook",
        });
      }

      const updated = await tx.webhookEndpoint.update({
        where: { id: webhookId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.targetUrl !== undefined ? { targetUrl: input.targetUrl } : {}),
          ...(input.events !== undefined ? { events: input.events } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });

      return {
        id: updated.id,
        name: updated.name,
        targetUrl: updated.targetUrl,
        signingSecret: updated.signingSecret,
        events: updated.events,
        isActive: updated.isActive,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    });
  }

  async deleteWebhook(
    auth: AuthenticatedContext,
    webhookId: string,
    meta: RequestMeta,
  ): Promise<{ ok: true }> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const existing = await tx.webhookEndpoint.findFirst({
        where: { id: webhookId },
      });
      if (!existing) {
        throw new NotFoundException({
          code: ERROR_CODES.WEBHOOK_NOT_FOUND,
          message: "Không tìm thấy cấu hình Webhook",
        });
      }

      await tx.webhookEndpoint.delete({ where: { id: webhookId } });
      await tx.auditLog.create({
        data: {
          tenantId: auth.tenantId,
          actorMemberId: auth.memberId,
          action: "WEBHOOK_REVOKED",
          entityType: "webhook_endpoint",
          entityId: webhookId,
          ipAddress: meta.ipAddress ?? null,
          metadata: { name: existing.name, targetUrl: existing.targetUrl },
        },
      });
      return { ok: true };
    });
  }

  async listDeliveries(
    auth: AuthenticatedContext,
    limit = 30,
  ): Promise<WebhookDeliveryItem[]> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const rows = await tx.webhookDelivery.findMany({
        select: {
          id: true,
          endpointId: true,
          eventType: true,
          status: true,
          httpStatus: true,
          responseSnippet: true,
          attemptCount: true,
          deliveredAt: true,
          createdAt: true,
          endpoint: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      return rows.map((r) => ({
        id: r.id,
        endpointId: r.endpointId,
        endpointName: r.endpoint.name,
        eventType: r.eventType,
        status: r.status,
        httpStatus: r.httpStatus,
        responseSnippet: r.responseSnippet,
        attemptCount: r.attemptCount,
        deliveredAt: r.deliveredAt ? r.deliveredAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  async testWebhook(
    auth: AuthenticatedContext,
    endpointId: string,
  ): Promise<{ enqueued: true }> {
    const endpoint = await this.prisma.withTenantTransaction(
      auth.tenantId,
      async (tx) =>
        tx.webhookEndpoint.findFirst({ where: { id: endpointId } }),
    );
    if (!endpoint) {
      throw new NotFoundException({
        code: ERROR_CODES.WEBHOOK_NOT_FOUND,
        message: "Không tìm thấy Webhook endpoint",
      });
    }

    const payload = {
      event: "STOCK_UPDATED",
      test: true,
      tenantId: auth.tenantId,
      timestamp: new Date().toISOString(),
      items: [{ variantId: crypto.randomUUID(), onHand: "10.000", available: "10.000" }],
    };

    if (this.bullMqJobs) {
      await this.bullMqJobs.enqueueWebhookDelivery({
        tenantId: auth.tenantId,
        eventType: "STOCK_UPDATED",
        endpointId: endpoint.id,
        payload,
      });
    } else {
      await this.deliverWebhookBatch({
        tenantId: auth.tenantId,
        eventType: "STOCK_UPDATED",
        endpointId: endpoint.id,
        payload,
      });
    }

    return { enqueued: true };
  }

  async deliverWebhookBatch(job: WebhookDeliveryJobPayload): Promise<void> {
    const endpoints = await this.prisma.withTenantTransaction(
      job.tenantId,
      async (tx) =>
        tx.webhookEndpoint.findMany({
          where: {
            isActive: true,
            ...(job.endpointId ? { id: job.endpointId } : {}),
            events: { has: job.eventType },
          },
        }),
    );

    if (endpoints.length === 0) return;

    const bodyJson = JSON.stringify(job.payload);
    for (const endpoint of endpoints) {
      const deliveryId = crypto.randomUUID();
      await this.prisma.withTenantTransaction(job.tenantId, async (tx) => {
        await tx.webhookDelivery.create({
          data: {
            id: deliveryId,
            tenantId: job.tenantId,
            endpointId: endpoint.id,
            eventType: job.eventType,
            payload: job.payload as object,
            status: "PENDING",
            attemptCount: 1,
          },
        });
      });

      try {
        assertSafeWebhookUrl(endpoint.targetUrl);
        const signature = signWebhookPayload(endpoint.signingSecret, bodyJson);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);

        let response: Response;
        try {
          response = await fetch(endpoint.targetUrl, {
            method: "POST",
            redirect: "manual",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              "X-SmartPOS-Event": job.eventType,
              "X-SmartPOS-Delivery": deliveryId,
              "X-SmartPOS-Signature": signature,
            },
            body: bodyJson,
          });
        } finally {
          clearTimeout(timer);
        }

        const snippet = (await response.text()).slice(0, 300);
        const delivered = response.ok;

        await this.prisma.withTenantTransaction(job.tenantId, async (tx) => {
          await tx.webhookDelivery.update({
            where: { id: deliveryId },
            data: {
              status: delivered ? "DELIVERED" : "FAILED",
              httpStatus: response.status,
              responseSnippet: snippet,
              deliveredAt: delivered ? new Date() : null,
            },
          });
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Delivery failed";
        await this.prisma.withTenantTransaction(job.tenantId, async (tx) => {
          await tx.webhookDelivery.update({
            where: { id: deliveryId },
            data: {
              status: "FAILED",
              responseSnippet: msg.slice(0, 300),
            },
          });
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public Omnichannel Endpoints (Authenticated via X-Api-Key + Strict RLS)
  // ---------------------------------------------------------------------------

  async queryPublicInventory(
    ctx: ApiKeyContext,
    query: ExternalInventoryQuery,
  ) {
    return this.prisma.withTenantTransaction(ctx.tenantId, async (tx) => {
      const sinceDate = query.since ? new Date(query.since) : undefined;
      const rows = await tx.branchInventory.findMany({
        where: {
          branch: {
            isActive: true,
            ...(query.branchCode ? { code: query.branchCode } : {}),
          },
          variant: {
            isActive: true,
            ...(query.sku ? { sku: query.sku } : {}),
          },
          ...(sinceDate ? { updatedAt: { gte: sinceDate } } : {}),
        },
        select: {
          onHand: true,
          reserved: true,
          updatedAt: true,
          branch: { select: { id: true, code: true, name: true } },
          variant: {
            select: {
              id: true,
              sku: true,
              barcode: true,
              name: true,
              salePrice: true,
              product: { select: { name: true } },
            },
          },
        },
        orderBy: [{ branch: { code: "asc" } }, { variant: { sku: "asc" } }],
        take: 1000,
      });

      return {
        serverTimestamp: new Date().toISOString(),
        items: rows.map((r) => {
          const onHand = parseQuantity(r.onHand.toFixed(3));
          const reserved = parseQuantity(r.reserved.toFixed(3));
          const avail = onHand > reserved ? onHand - reserved : 0n;
          return {
            branchId: r.branch.id,
            branchCode: r.branch.code,
            branchName: r.branch.name,
            variantId: r.variant.id,
            sku: r.variant.sku,
            barcode: r.variant.barcode,
            productName: `${r.variant.product.name} - ${r.variant.name}`,
            salePrice: r.variant.salePrice.toFixed(2),
            onHand: formatQuantity(onHand),
            reserved: formatQuantity(reserved),
            available: formatQuantity(avail),
            updatedAt: r.updatedAt.toISOString(),
          };
        }),
      };
    });
  }

  async syncExternalOrder(
    ctx: ApiKeyContext,
    input: ExternalOrderSyncInput,
    meta: RequestMeta,
  ) {
    const idempotencyKey = deterministicExternalOrderUuid(
      ctx.tenantId,
      input.channel,
      input.externalOrderId,
    );

    const outcome = await runWithSerializableRetry(() =>
      this.prisma.withTenantTransaction(
        ctx.tenantId,
        async (tx) => {
          const existing = await tx.invoice.findFirst({
            where: { idempotencyKey },
            select: { id: true, code: true, branchId: true, totalAmount: true, createdAt: true },
          });
          if (existing) {
            return {
              invoiceId: existing.id,
              invoiceCode: existing.code,
              branchId: existing.branchId,
              totalAmount: existing.totalAmount.toFixed(2),
              createdAt: existing.createdAt.toISOString(),
              idempotentReplay: true,
              publishedStock: [] as Array<{
                variantId: string;
                onHand: string;
                available: string;
              }>,
            };
          }

          const branch = await tx.branch.findFirst({
            where: input.branchCode
              ? { code: input.branchCode.toUpperCase(), isActive: true }
              : { isDefault: true, isActive: true },
            select: { id: true, code: true, name: true },
          });
          if (!branch) {
            throw new NotFoundException({
              code: ERROR_CODES.BRANCH_NOT_FOUND,
              message: "Không tìm thấy chi nhánh áp dụng cho đơn TMĐT",
            });
          }

          const qtyBySku = new Map<string, bigint>();
          for (const item of input.items) {
            const q = parseQuantity(item.quantity);
            qtyBySku.set(item.sku, (qtyBySku.get(item.sku) ?? 0n) + q);
          }

          const variants = await tx.productVariant.findMany({
            where: {
              sku: { in: Array.from(qtyBySku.keys()) },
              isActive: true,
              product: { isActive: true },
            },
            select: {
              id: true,
              sku: true,
              name: true,
              salePrice: true,
              costPrice: true,
              taxRate: true,
              product: { select: { name: true } },
            },
          });

          const bySku = new Map(variants.map((v) => [v.sku, v]));
          if (bySku.size !== qtyBySku.size) {
            throw new BadRequestException({
              code: ERROR_CODES.PRODUCT_NOT_FOUND,
              message: "Một hoặc nhiều SKU trong đơn TMĐT không tồn tại",
            });
          }

          const sortedEntries = Array.from(bySku.values()).sort((a, b) =>
            a.id.localeCompare(b.id),
          );

          const publishedStock: Array<{
            variantId: string;
            onHand: string;
            available: string;
          }> = [];
          const invoiceItemsData: Array<{
            tenantId: string;
            variantId: string;
            productNameSnapshot: string;
            skuSnapshot: string;
            quantity: string;
            unitPrice: string;
            discountAmount: string;
            taxAmount: string;
            lineTotal: string;
            unitCostSnapshot: string;
            returnedQty: string;
          }> = [];
          const ledgerData: Array<{
            variantId: string;
            qtyDelta: string;
            qtyBefore: string;
            qtyAfter: string;
            unitCost: string;
          }> = [];

          let totalMinor = 0n;
          let totalCogsMinor = 0n;

          for (const variant of sortedEntries) {
            const neededMilli = qtyBySku.get(variant.sku)!;
            const neededStr = formatQuantity(neededMilli);

            const deducted = await tx.$queryRaw<
              Array<{ on_hand: string; reserved: string; avg_cost: string }>
            >`
              UPDATE branch_inventories
              SET
                on_hand = on_hand - ${neededStr}::decimal(15, 3),
                updated_at = now()
              WHERE tenant_id = ${ctx.tenantId}::uuid
                AND branch_id = ${branch.id}::uuid
                AND variant_id = ${variant.id}::uuid
                AND (on_hand - reserved) >= ${neededStr}::decimal(15, 3)
              RETURNING
                on_hand::numeric(15, 3)::text AS on_hand,
                reserved::numeric(15, 3)::text AS reserved,
                avg_cost::numeric(15, 2)::text AS avg_cost
            `;

            const updated = deducted[0];
            if (!updated) {
              throw new ConflictException({
                code: ERROR_CODES.INSUFFICIENT_STOCK,
                message: `SKU "${variant.sku}" không đủ tồn kho khả dụng để đồng bộ đơn TMĐT`,
              });
            }

            const afterMilli = parseQuantity(updated.on_hand);
            const reservedMilli = parseQuantity(updated.reserved);
            const beforeMilli = afterMilli + neededMilli;
            const avgCostMinor = parseMoney(updated.avg_cost);
            const fallbackCostMinor = parseMoney(variant.costPrice.toFixed(2));
            const unitCostMinor =
              avgCostMinor > 0n ? avgCostMinor : fallbackCostMinor;
            const salePriceMinor = parseMoney(variant.salePrice.toFixed(2));

            const lineTotalMinor = calculateLineSubtotal(neededMilli, salePriceMinor);
            const lineCogsMinor = calculateLineSubtotal(neededMilli, unitCostMinor);
            totalMinor += lineTotalMinor;
            totalCogsMinor += lineCogsMinor;

            invoiceItemsData.push({
              tenantId: ctx.tenantId,
              variantId: variant.id,
              productNameSnapshot: `${variant.product.name} - ${variant.name}`,
              skuSnapshot: variant.sku,
              quantity: neededStr,
              unitPrice: formatMoney(salePriceMinor),
              discountAmount: "0.00",
              taxAmount: "0.00",
              lineTotal: formatMoney(lineTotalMinor),
              unitCostSnapshot: formatMoney(unitCostMinor),
              returnedQty: "0.000",
            });

            ledgerData.push({
              variantId: variant.id,
              qtyDelta: formatQuantity(-neededMilli),
              qtyBefore: formatQuantity(beforeMilli),
              qtyAfter: updated.on_hand,
              unitCost: formatMoney(unitCostMinor),
            });

            publishedStock.push({
              variantId: variant.id,
              onHand: updated.on_hand,
              available: formatQuantity(afterMilli - reservedMilli),
            });
          }

          const invoiceCode = `EC-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
          const totalStr = formatMoney(totalMinor);
          const cogsStr = formatMoney(totalCogsMinor);
          const grossProfitStr = formatMoney(totalMinor - totalCogsMinor);

          const createdInvoice = await tx.invoice.create({
            data: {
              tenantId: ctx.tenantId,
              branchId: branch.id,
              shiftId: null,
              cashierMemberId: ctx.createdByMemberId,
              code: invoiceCode,
              idempotencyKey,
              status: "COMPLETED",
              subtotal: totalStr,
              discountAmount: "0.00",
              taxAmount: "0.00",
              totalAmount: totalStr,
              paidAmount: totalStr,
              cogsAmount: cogsStr,
              syncSource: "ONLINE",
              items: { create: invoiceItemsData },
              payments: {
                create: [
                  {
                    tenantId: ctx.tenantId,
                    method: "BANK_TRANSFER_QR",
                    amount: totalStr,
                    referenceNo: `${input.channel}:${input.externalOrderId}`,
                  },
                ],
              },
            },
          });

          for (const l of ledgerData) {
            await tx.inventoryLedger.create({
              data: {
                tenantId: ctx.tenantId,
                branchId: branch.id,
                variantId: l.variantId,
                movementType: "SALE",
                qtyDelta: l.qtyDelta,
                qtyBefore: l.qtyBefore,
                qtyAfter: l.qtyAfter,
                unitCost: l.unitCost,
                referenceType: "invoice",
                referenceId: createdInvoice.id,
                actorMemberId: ctx.createdByMemberId,
                note: `Đồng bộ đơn ${input.channel} #${input.externalOrderId}`,
              },
            });
          }

          const businessDate = getVietnamBusinessDate();
          await tx.$executeRaw`
            INSERT INTO daily_branch_summaries (
              id, tenant_id, branch_id, summary_date,
              invoice_count, gross_revenue, discount_total, net_revenue,
              cogs_total, gross_profit, refund_total,
              cash_total, transfer_total, card_total, updated_at
            ) VALUES (
              ${crypto.randomUUID()}::uuid,
              ${ctx.tenantId}::uuid,
              ${branch.id}::uuid,
              ${businessDate}::date,
              1,
              ${totalStr}::decimal(15, 2),
              0.00,
              ${totalStr}::decimal(15, 2),
              ${cogsStr}::decimal(15, 2),
              ${grossProfitStr}::decimal(15, 2),
              0.00,
              0.00,
              ${totalStr}::decimal(15, 2),
              0.00,
              now()
            )
            ON CONFLICT (tenant_id, branch_id, summary_date)
            DO UPDATE SET
              invoice_count = daily_branch_summaries.invoice_count + 1,
              gross_revenue = daily_branch_summaries.gross_revenue + EXCLUDED.gross_revenue,
              net_revenue = daily_branch_summaries.net_revenue + EXCLUDED.net_revenue,
              cogs_total = daily_branch_summaries.cogs_total + EXCLUDED.cogs_total,
              gross_profit = daily_branch_summaries.gross_profit + EXCLUDED.gross_profit,
              transfer_total = daily_branch_summaries.transfer_total + EXCLUDED.transfer_total,
              updated_at = now()
          `;

          await tx.auditLog.create({
            data: {
              tenantId: ctx.tenantId,
              branchId: branch.id,
              actorMemberId: ctx.createdByMemberId,
              action: "EXTERNAL_ORDER_SYNCED",
              entityType: "invoice",
              entityId: createdInvoice.id,
              ipAddress: meta.ipAddress ?? null,
              metadata: {
                channel: input.channel,
                externalOrderId: input.externalOrderId,
                invoiceCode,
                totalAmount: totalStr,
              },
            },
          });

          return {
            invoiceId: createdInvoice.id,
            invoiceCode,
            branchId: branch.id,
            totalAmount: totalStr,
            createdAt: createdInvoice.createdAt.toISOString(),
            idempotentReplay: false,
            publishedStock,
          };
        },
        { isolationLevel: "RepeatableRead" },
      ),
    );

    if (!outcome.idempotentReplay && outcome.publishedStock.length > 0) {
      await this.posEvents?.publishStockUpdate(
        ctx.tenantId,
        outcome.branchId,
        outcome.publishedStock,
      );
    }

    return {
      invoiceId: outcome.invoiceId,
      invoiceCode: outcome.invoiceCode,
      branchId: outcome.branchId,
      totalAmount: outcome.totalAmount,
      idempotentReplay: outcome.idempotentReplay,
      createdAt: outcome.createdAt,
    };
  }
}
