import { HttpException, Injectable } from "@nestjs/common";
import {
  ERROR_CODES,
  type OfflineSyncBatchInput,
  type OfflineSyncBatchResponse,
  type OfflineSyncItemOutcome,
  type OfflineSyncLatestStockInfo,
} from "@smart-pos/shared";
import type { AuthenticatedContext, RequestMeta } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { PosCheckoutService } from "./pos-checkout.service";

const CONFLICT_ERROR_CODES = new Set<string>([
  ERROR_CODES.INSUFFICIENT_STOCK,
  ERROR_CODES.SHIFT_NOT_OPEN,
  ERROR_CODES.SHIFT_NOT_FOUND,
  ERROR_CODES.INSUFFICIENT_LOYALTY_POINTS,
  ERROR_CODES.PRODUCT_NOT_FOUND,
]);

@Injectable()
export class PosOfflineSyncService {
  constructor(
    private readonly checkoutService: PosCheckoutService,
    private readonly prisma: PrismaService,
  ) {}

  async syncOfflineBatch(
    auth: AuthenticatedContext,
    input: OfflineSyncBatchInput,
    meta: RequestMeta,
  ): Promise<OfflineSyncBatchResponse> {
    const results: OfflineSyncItemOutcome[] = [];
    let synced = 0;
    let conflicts = 0;
    let failed = 0;

    for (const entry of input.invoices) {
      const idempotencyKey = entry.payload.idempotencyKey;
      try {
        const receipt = await this.checkoutService.checkout(
          auth,
          { ...entry.payload, syncSource: "OFFLINE_SYNC" },
          meta,
        );
        synced += 1;
        results.push({
          idempotencyKey,
          status: "SYNCED",
          receipt,
        });
      } catch (err) {
        const parsed = this.extractHttpError(err);
        if (CONFLICT_ERROR_CODES.has(parsed.code)) {
          conflicts += 1;
          const latestStock =
            parsed.code === ERROR_CODES.INSUFFICIENT_STOCK
              ? await this.readLatestBranchStock(
                  auth.tenantId,
                  entry.payload.branchId,
                  entry.payload.items.map((it) => it.variantId),
                )
              : undefined;
          results.push({
            idempotencyKey,
            status: "CONFLICT",
            errorCode: parsed.code,
            message: parsed.message,
            ...(latestStock ? { latestStock } : {}),
          });
        } else {
          failed += 1;
          results.push({
            idempotencyKey,
            status: "FAILED",
            errorCode: parsed.code,
            message: parsed.message,
          });
        }
      }
    }

    return {
      summary: {
        total: input.invoices.length,
        synced,
        conflicts,
        failed,
      },
      results,
    };
  }

  private async readLatestBranchStock(
    tenantId: string,
    branchId: string,
    rawVariantIds: readonly string[],
  ): Promise<OfflineSyncLatestStockInfo[]> {
    const variantIds = Array.from(new Set(rawVariantIds));
    if (variantIds.length === 0) return [];

    return this.prisma.withTenantTransaction(tenantId, async (tx) => {
      const variants = await tx.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: {
          id: true,
          sku: true,
          branchInventories: {
            where: { branchId },
            select: { onHand: true, reserved: true },
          },
        },
      });

      return variants.map((v) => {
        const inv = v.branchInventories[0];
        const onHand = inv ? Number(inv.onHand.toString()) : 0;
        const reserved = inv ? Number(inv.reserved.toString()) : 0;
        const available = Math.max(0, onHand - reserved);
        return {
          variantId: v.id,
          sku: v.sku,
          available: available.toFixed(3),
        };
      });
    });
  }

  private extractHttpError(err: unknown): { code: string; message: string } {
    if (err instanceof HttpException) {
      const body = err.getResponse();
      if (typeof body === "object" && body !== null) {
        const obj = body as { code?: unknown; message?: unknown };
        return {
          code:
            typeof obj.code === "string" ? obj.code : ERROR_CODES.INTERNAL_ERROR,
          message:
            typeof obj.message === "string"
              ? obj.message
              : err.message || "Lỗi đồng bộ đơn hàng offline",
        };
      }
      return { code: ERROR_CODES.VALIDATION_ERROR, message: err.message };
    }
    return {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: err instanceof Error ? err.message : "Lỗi đồng bộ không xác định",
    };
  }
}
