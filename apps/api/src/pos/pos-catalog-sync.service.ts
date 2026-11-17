import { Injectable } from "@nestjs/common";
import {
  formatQuantity,
  parseQuantity,
  type PosCatalogCategorySummary,
  type PosCatalogItem,
  type PosCatalogSyncQuery,
  type PosCatalogSyncResponse,
} from "@smart-pos/shared";
import type { AuthenticatedContext } from "../auth/auth.types";
import { assertBranchAccessibleInTx } from "../common/tenant/tenant-quota.helper";
import { PrismaService } from "../prisma/prisma.service";

interface RawPosSyncRow {
  variant_id: string;
  product_id: string;
  category_id: string | null;
  category_name: string | null;
  product_name: string;
  variant_name: string;
  sku: string;
  barcode: string | null;
  unit: string;
  sale_price: string;
  tax_rate: string;
  min_stock_alert: number;
  image_url: string | null;
  is_active: boolean;
  on_hand: string;
  reserved: string;
  row_updated_at: Date;
}

@Injectable()
export class PosCatalogSyncService {
  constructor(private readonly prisma: PrismaService) {}

  async syncBranchCatalog(
    auth: AuthenticatedContext,
    query: PosCatalogSyncQuery,
  ): Promise<PosCatalogSyncResponse> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      await assertBranchAccessibleInTx(tx, auth, query.branchId);

      const sinceDate = query.since ? new Date(query.since) : null;
      const serverTimestamp = new Date().toISOString();

      const [categories, rows] = await Promise.all([
        tx.category.findMany({
          select: { id: true, name: true, sortOrder: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        }),
        tx.$queryRaw<RawPosSyncRow[]>`
          SELECT
            pv.id AS variant_id,
            p.id AS product_id,
            p.category_id,
            c.name AS category_name,
            p.name AS product_name,
            pv.name AS variant_name,
            pv.sku,
            pv.barcode,
            pv.unit,
            pv.sale_price::numeric(15, 2)::text AS sale_price,
            pv.tax_rate::numeric(5, 2)::text AS tax_rate,
            pv.min_stock_alert,
            p.image_url,
            (pv.is_active AND p.is_active) AS is_active,
            COALESCE(bi.on_hand, 0)::numeric(15, 3)::text AS on_hand,
            COALESCE(bi.reserved, 0)::numeric(15, 3)::text AS reserved,
            GREATEST(
              p.updated_at,
              pv.updated_at,
              COALESCE(bi.updated_at, pv.updated_at)
            ) AS row_updated_at
          FROM product_variants pv
          INNER JOIN products p
            ON p.id = pv.product_id
            AND p.tenant_id = pv.tenant_id
          LEFT JOIN categories c
            ON c.id = p.category_id
            AND c.tenant_id = p.tenant_id
          LEFT JOIN branch_inventories bi
            ON bi.variant_id = pv.id
            AND bi.tenant_id = pv.tenant_id
            AND bi.branch_id = ${query.branchId}::uuid
          WHERE pv.tenant_id = ${auth.tenantId}::uuid
            AND (
              ${sinceDate}::timestamptz IS NULL
              OR p.updated_at >= ${sinceDate}::timestamptz
              OR pv.updated_at >= ${sinceDate}::timestamptz
              OR bi.updated_at >= ${sinceDate}::timestamptz
            )
          ORDER BY p.name ASC, pv.sku ASC
        `,
      ]);

      const categorySummaries: PosCatalogCategorySummary[] = categories.map(
        (cat) => ({
          id: cat.id,
          name: cat.name,
          sortOrder: cat.sortOrder,
        }),
      );

      const items: PosCatalogItem[] = rows.map((row) => {
        const onHandMilli = parseQuantity(row.on_hand);
        const reservedMilli = parseQuantity(row.reserved);
        return {
          variantId: row.variant_id,
          productId: row.product_id,
          categoryId: row.category_id,
          categoryName: row.category_name,
          productName: row.product_name,
          variantName: row.variant_name,
          sku: row.sku,
          barcode: row.barcode,
          unit: row.unit,
          salePrice: row.sale_price,
          taxRate: row.tax_rate,
          minStockAlert: Number(row.min_stock_alert),
          imageUrl: row.image_url,
          isActive: row.is_active,
          onHand: formatQuantity(onHandMilli),
          reserved: formatQuantity(reservedMilli),
          available: formatQuantity(onHandMilli - reservedMilli),
          updatedAt: row.row_updated_at.toISOString(),
        };
      });

      return {
        branchId: query.branchId,
        serverTimestamp,
        fullSync: sinceDate === null,
        categories: categorySummaries,
        items,
      };
    });
  }
}
