import { Injectable } from "@nestjs/common";
import {
  formatMoney,
  parseMoney,
  type DailySeriesPoint,
  type LowStockAlertItem,
  type ReportOverviewQuery,
  type ReportOverviewResponse,
  type TopSellingVariantItem,
} from "@smart-pos/shared";
import type { AuthenticatedContext } from "../auth/auth.types";
import { assertBranchAccessibleInTx } from "../common/tenant/tenant-quota.helper";
import { PrismaService } from "../prisma/prisma.service";

function getVietnamDateString(offsetDays = 0): string {
  const vnTime = new Date(
    Date.now() + 7 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000,
  );
  return vnTime.toISOString().slice(0, 10);
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(
    auth: AuthenticatedContext,
    query: ReportOverviewQuery,
  ): Promise<ReportOverviewResponse> {
    const toStr = query.to ?? getVietnamDateString(0);
    const fromStr = query.from ?? getVietnamDateString(-29);

    const fromDate = new Date(`${fromStr}T00:00:00.000Z`);
    const toDate = new Date(`${toStr}T00:00:00.000Z`);
    const fromTimestamp = new Date(`${fromStr}T00:00:00+07:00`);
    const toTimestamp = new Date(`${toStr}T23:59:59.999+07:00`);

    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      if (query.branchId) {
        await assertBranchAccessibleInTx(tx, auth, query.branchId);
      }

      const branchFilter = query.branchId
        ? query.branchId
        : auth.allowedBranchIds.length > 0
          ? { in: auth.allowedBranchIds }
          : undefined;

      const summaryRows = await tx.dailyBranchSummary.findMany({
        where: {
          ...(branchFilter !== undefined ? { branchId: branchFilter } : {}),
          summaryDate: { gte: fromDate, lte: toDate },
        },
        orderBy: { summaryDate: "asc" },
      });

      const byDate = new Map<
        string,
        {
          invoiceCount: number;
          grossRevenueMinor: bigint;
          discountTotalMinor: bigint;
          refundTotalMinor: bigint;
          netRevenueMinor: bigint;
          cogsTotalMinor: bigint;
          grossProfitMinor: bigint;
        }
      >();

      let totalInvoices = 0;
      let totalGrossMinor = 0n;
      let totalDiscountMinor = 0n;
      let totalRefundMinor = 0n;
      let totalNetMinor = 0n;
      let totalCogsMinor = 0n;
      let totalProfitMinor = 0n;
      let totalCashMinor = 0n;
      let totalTransferMinor = 0n;
      let totalCardMinor = 0n;

      for (const row of summaryRows) {
        const key = row.summaryDate.toISOString().slice(0, 10);
        const gross = parseMoney(row.grossRevenue.toFixed(2));
        const disc = parseMoney(row.discountTotal.toFixed(2));
        const refund = parseMoney(row.refundTotal.toFixed(2));
        const net = parseMoney(row.netRevenue.toFixed(2));
        const cogs = parseMoney(row.cogsTotal.toFixed(2));
        const profit = parseMoney(row.grossProfit.toFixed(2));
        const cash = parseMoney(row.cashTotal.toFixed(2));
        const transfer = parseMoney(row.transferTotal.toFixed(2));
        const card = parseMoney(row.cardTotal.toFixed(2));

        totalInvoices += row.invoiceCount;
        totalGrossMinor += gross;
        totalDiscountMinor += disc;
        totalRefundMinor += refund;
        totalNetMinor += net;
        totalCogsMinor += cogs;
        totalProfitMinor += profit;
        totalCashMinor += cash;
        totalTransferMinor += transfer;
        totalCardMinor += card;

        const existing = byDate.get(key);
        if (existing) {
          existing.invoiceCount += row.invoiceCount;
          existing.grossRevenueMinor += gross;
          existing.discountTotalMinor += disc;
          existing.refundTotalMinor += refund;
          existing.netRevenueMinor += net;
          existing.cogsTotalMinor += cogs;
          existing.grossProfitMinor += profit;
        } else {
          byDate.set(key, {
            invoiceCount: row.invoiceCount,
            grossRevenueMinor: gross,
            discountTotalMinor: disc,
            refundTotalMinor: refund,
            netRevenueMinor: net,
            cogsTotalMinor: cogs,
            grossProfitMinor: profit,
          });
        }
      }

      const dailySeries: DailySeriesPoint[] = Array.from(byDate.entries()).map(
        ([date, agg]) => ({
          date,
          invoiceCount: agg.invoiceCount,
          grossRevenue: formatMoney(agg.grossRevenueMinor),
          discountTotal: formatMoney(agg.discountTotalMinor),
          refundTotal: formatMoney(agg.refundTotalMinor),
          netRevenue: formatMoney(agg.netRevenueMinor),
          cogsTotal: formatMoney(agg.cogsTotalMinor),
          grossProfit: formatMoney(agg.grossProfitMinor),
        }),
      );

      const averageOrderMinor =
        totalInvoices > 0 ? totalNetMinor / BigInt(totalInvoices) : 0n;

      // Accessible branch list for parameterized raw SQL queries
      const branchIdsToScope = query.branchId
        ? [query.branchId]
        : auth.allowedBranchIds.length > 0
          ? auth.allowedBranchIds
          : null;

      const topRaw = branchIdsToScope
        ? await tx.$queryRaw<
            Array<{
              variant_id: string;
              sku: string;
              product_name: string;
              variant_name: string;
              qty_sold: string;
              revenue: string;
            }>
          >`
            SELECT
              pv.id AS variant_id,
              pv.sku,
              p.name AS product_name,
              pv.name AS variant_name,
              COALESCE(SUM(ii.quantity - ii.returned_qty), 0)::numeric(15, 3)::text AS qty_sold,
              COALESCE(SUM(ii.line_total), 0)::numeric(15, 2)::text AS revenue
            FROM invoice_items ii
            INNER JOIN invoices i ON i.id = ii.invoice_id
            INNER JOIN product_variants pv ON pv.id = ii.variant_id
            INNER JOIN products p ON p.id = pv.product_id
            WHERE i.tenant_id = ${auth.tenantId}::uuid
              AND i.branch_id = ANY(${branchIdsToScope}::uuid[])
              AND i.status <> 'VOIDED'
              AND i.created_at >= ${fromTimestamp}
              AND i.created_at <= ${toTimestamp}
            GROUP BY pv.id, pv.sku, p.name, pv.name
            HAVING COALESCE(SUM(ii.quantity - ii.returned_qty), 0) > 0
            ORDER BY SUM(ii.line_total) DESC
            LIMIT 10
          `
        : await tx.$queryRaw<
            Array<{
              variant_id: string;
              sku: string;
              product_name: string;
              variant_name: string;
              qty_sold: string;
              revenue: string;
            }>
          >`
            SELECT
              pv.id AS variant_id,
              pv.sku,
              p.name AS product_name,
              pv.name AS variant_name,
              COALESCE(SUM(ii.quantity - ii.returned_qty), 0)::numeric(15, 3)::text AS qty_sold,
              COALESCE(SUM(ii.line_total), 0)::numeric(15, 2)::text AS revenue
            FROM invoice_items ii
            INNER JOIN invoices i ON i.id = ii.invoice_id
            INNER JOIN product_variants pv ON pv.id = ii.variant_id
            INNER JOIN products p ON p.id = pv.product_id
            WHERE i.tenant_id = ${auth.tenantId}::uuid
              AND i.status <> 'VOIDED'
              AND i.created_at >= ${fromTimestamp}
              AND i.created_at <= ${toTimestamp}
            GROUP BY pv.id, pv.sku, p.name, pv.name
            HAVING COALESCE(SUM(ii.quantity - ii.returned_qty), 0) > 0
            ORDER BY SUM(ii.line_total) DESC
            LIMIT 10
          `;

      const topProducts: TopSellingVariantItem[] = topRaw.map((r) => ({
        variantId: r.variant_id,
        sku: r.sku,
        productName: r.product_name,
        variantName: r.variant_name,
        quantitySold: r.qty_sold,
        revenue: r.revenue,
      }));

      const lowStockRaw = branchIdsToScope
        ? await tx.$queryRaw<
            Array<{
              branch_id: string;
              branch_name: string;
              variant_id: string;
              sku: string;
              product_name: string;
              variant_name: string;
              on_hand: string;
              min_stock_alert: number;
            }>
          >`
            SELECT
              b.id AS branch_id,
              b.name AS branch_name,
              pv.id AS variant_id,
              pv.sku,
              p.name AS product_name,
              pv.name AS variant_name,
              bi.on_hand::numeric(15, 3)::text AS on_hand,
              pv.min_stock_alert
            FROM branch_inventories bi
            INNER JOIN branches b ON b.id = bi.branch_id
            INNER JOIN product_variants pv ON pv.id = bi.variant_id
            INNER JOIN products p ON p.id = pv.product_id
            WHERE bi.tenant_id = ${auth.tenantId}::uuid
              AND bi.branch_id = ANY(${branchIdsToScope}::uuid[])
              AND b.is_active = true
              AND pv.is_active = true
              AND p.is_active = true
              AND pv.min_stock_alert > 0
              AND bi.on_hand <= pv.min_stock_alert
            ORDER BY (bi.on_hand - pv.min_stock_alert) ASC
            LIMIT 20
          `
        : await tx.$queryRaw<
            Array<{
              branch_id: string;
              branch_name: string;
              variant_id: string;
              sku: string;
              product_name: string;
              variant_name: string;
              on_hand: string;
              min_stock_alert: number;
            }>
          >`
            SELECT
              b.id AS branch_id,
              b.name AS branch_name,
              pv.id AS variant_id,
              pv.sku,
              p.name AS product_name,
              pv.name AS variant_name,
              bi.on_hand::numeric(15, 3)::text AS on_hand,
              pv.min_stock_alert
            FROM branch_inventories bi
            INNER JOIN branches b ON b.id = bi.branch_id
            INNER JOIN product_variants pv ON pv.id = bi.variant_id
            INNER JOIN products p ON p.id = pv.product_id
            WHERE bi.tenant_id = ${auth.tenantId}::uuid
              AND b.is_active = true
              AND pv.is_active = true
              AND p.is_active = true
              AND pv.min_stock_alert > 0
              AND bi.on_hand <= pv.min_stock_alert
            ORDER BY (bi.on_hand - pv.min_stock_alert) ASC
            LIMIT 20
          `;

      const lowStockAlerts: LowStockAlertItem[] = lowStockRaw.map((r) => ({
        branchId: r.branch_id,
        branchName: r.branch_name,
        variantId: r.variant_id,
        sku: r.sku,
        productName: r.product_name,
        variantName: r.variant_name,
        onHand: r.on_hand,
        minStockAlert: Number(r.min_stock_alert),
      }));

      return {
        from: fromStr,
        to: toStr,
        branchId: query.branchId ?? null,
        kpis: {
          invoiceCount: totalInvoices,
          grossRevenue: formatMoney(totalGrossMinor),
          discountTotal: formatMoney(totalDiscountMinor),
          refundTotal: formatMoney(totalRefundMinor),
          netRevenue: formatMoney(totalNetMinor),
          cogsTotal: formatMoney(totalCogsMinor),
          grossProfit: formatMoney(totalProfitMinor),
          averageOrderValue: formatMoney(averageOrderMinor),
          cashTotal: formatMoney(totalCashMinor),
          transferTotal: formatMoney(totalTransferMinor),
          cardTotal: formatMoney(totalCardMinor),
        },
        dailySeries,
        topProducts,
        lowStockAlerts,
      };
    });
  }
}
