import { Injectable } from "@nestjs/common";
import {
  calculateLineSubtotal,
  formatMoney,
  formatQuantity,
  type InventoryLedgerItem,
  type InventoryLedgerListResponse,
  type InventoryListResponse,
  type InventoryQuery,
  type LedgerQuery,
  parseMoney,
  parseQuantity,
} from "@smart-pos/shared";
import type { AuthenticatedContext } from "../auth/auth.types";
import { assertBranchAccessibleInTx } from "../common/tenant/tenant-quota.helper";
import { PrismaService } from "../prisma/prisma.service";

interface RawInventoryRow {
  branch_id: string;
  branch_code: string;
  branch_name: string;
  variant_id: string;
  product_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  barcode: string | null;
  unit: string;
  min_stock_alert: number;
  on_hand: string;
  reserved: string;
  avg_cost: string;
  sale_price: string;
  updated_at: Date | null;
}

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async listInventory(
    auth: AuthenticatedContext,
    query: InventoryQuery,
  ): Promise<InventoryListResponse> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      let targetBranch: { id: string; code: string; name: string } | null =
        null;
      if (query.branchId) {
        targetBranch = await assertBranchAccessibleInTx(
          tx,
          auth,
          query.branchId,
        );
      }

      const likePattern = query.search?.trim()
        ? `%${query.search.trim()}%`
        : null;
      const offset = (query.page - 1) * query.limit;

      const allowedIds = auth.allowedBranchIds;

      const summaryRows = targetBranch
        ? await tx.$queryRaw<
            Array<{
              total_count: number;
              total_value: string;
              low_stock_count: number;
            }>
          >`
            SELECT
              COUNT(*)::int AS total_count,
              COALESCE(SUM(COALESCE(bi.on_hand, 0) * COALESCE(bi.avg_cost, 0)), 0)::numeric(15, 2)::text AS total_value,
              COUNT(*) FILTER (
                WHERE pv.min_stock_alert > 0
                  AND COALESCE(bi.on_hand, 0) <= pv.min_stock_alert
              )::int AS low_stock_count
            FROM product_variants pv
            INNER JOIN products p ON p.id = pv.product_id AND p.tenant_id = pv.tenant_id
            LEFT JOIN branch_inventories bi
              ON bi.tenant_id = pv.tenant_id
              AND bi.branch_id = ${targetBranch.id}::uuid
              AND bi.variant_id = pv.id
            WHERE pv.tenant_id = ${auth.tenantId}::uuid
              AND pv.is_active = true
              AND p.is_active = true
              AND (${query.categoryId ?? null}::uuid IS NULL OR p.category_id = ${query.categoryId ?? null}::uuid)
              AND (
                ${!query.lowStockOnly}::boolean
                OR (pv.min_stock_alert > 0 AND COALESCE(bi.on_hand, 0) <= pv.min_stock_alert)
              )
              AND (
                ${likePattern}::text IS NULL
                OR p.name ILIKE ${likePattern}
                OR pv.name ILIKE ${likePattern}
                OR pv.sku ILIKE ${likePattern}
                OR pv.barcode ILIKE ${likePattern}
              )
          `
        : await tx.$queryRaw<
            Array<{
              total_count: number;
              total_value: string;
              low_stock_count: number;
            }>
          >`
            SELECT
              COUNT(*)::int AS total_count,
              COALESCE(SUM(bi.on_hand * bi.avg_cost), 0)::numeric(15, 2)::text AS total_value,
              COUNT(*) FILTER (
                WHERE pv.min_stock_alert > 0
                  AND bi.on_hand <= pv.min_stock_alert
              )::int AS low_stock_count
            FROM branch_inventories bi
            INNER JOIN branches b ON b.id = bi.branch_id AND b.tenant_id = bi.tenant_id
            INNER JOIN product_variants pv ON pv.id = bi.variant_id AND pv.tenant_id = bi.tenant_id
            INNER JOIN products p ON p.id = pv.product_id AND p.tenant_id = pv.tenant_id
            WHERE bi.tenant_id = ${auth.tenantId}::uuid
              AND b.is_active = true
              AND (${allowedIds.length}::int = 0 OR b.id = ANY(${allowedIds}::uuid[]))
              AND (${query.categoryId ?? null}::uuid IS NULL OR p.category_id = ${query.categoryId ?? null}::uuid)
              AND (
                ${!query.lowStockOnly}::boolean
                OR (pv.min_stock_alert > 0 AND bi.on_hand <= pv.min_stock_alert)
              )
              AND (
                ${likePattern}::text IS NULL
                OR p.name ILIKE ${likePattern}
                OR pv.name ILIKE ${likePattern}
                OR pv.sku ILIKE ${likePattern}
                OR pv.barcode ILIKE ${likePattern}
              )
          `;

      const rows = targetBranch
        ? await tx.$queryRaw<RawInventoryRow[]>`
            SELECT
              ${targetBranch.id}::uuid AS branch_id,
              ${targetBranch.code}::text AS branch_code,
              ${targetBranch.name}::text AS branch_name,
              pv.id AS variant_id,
              p.id AS product_id,
              p.name AS product_name,
              pv.name AS variant_name,
              pv.sku,
              pv.barcode,
              pv.unit,
              pv.min_stock_alert,
              COALESCE(bi.on_hand, 0)::numeric(15, 3)::text AS on_hand,
              COALESCE(bi.reserved, 0)::numeric(15, 3)::text AS reserved,
              COALESCE(bi.avg_cost, pv.cost_price)::numeric(15, 2)::text AS avg_cost,
              pv.sale_price::numeric(15, 2)::text AS sale_price,
              bi.updated_at
            FROM product_variants pv
            INNER JOIN products p ON p.id = pv.product_id AND p.tenant_id = pv.tenant_id
            LEFT JOIN branch_inventories bi
              ON bi.tenant_id = pv.tenant_id
              AND bi.branch_id = ${targetBranch.id}::uuid
              AND bi.variant_id = pv.id
            WHERE pv.tenant_id = ${auth.tenantId}::uuid
              AND pv.is_active = true
              AND p.is_active = true
              AND (${query.categoryId ?? null}::uuid IS NULL OR p.category_id = ${query.categoryId ?? null}::uuid)
              AND (
                ${!query.lowStockOnly}::boolean
                OR (pv.min_stock_alert > 0 AND COALESCE(bi.on_hand, 0) <= pv.min_stock_alert)
              )
              AND (
                ${likePattern}::text IS NULL
                OR p.name ILIKE ${likePattern}
                OR pv.name ILIKE ${likePattern}
                OR pv.sku ILIKE ${likePattern}
                OR pv.barcode ILIKE ${likePattern}
              )
            ORDER BY p.name ASC, pv.sku ASC
            LIMIT ${query.limit}
            OFFSET ${offset}
          `
        : await tx.$queryRaw<RawInventoryRow[]>`
            SELECT
              b.id AS branch_id,
              b.code AS branch_code,
              b.name AS branch_name,
              pv.id AS variant_id,
              p.id AS product_id,
              p.name AS product_name,
              pv.name AS variant_name,
              pv.sku,
              pv.barcode,
              pv.unit,
              pv.min_stock_alert,
              bi.on_hand::numeric(15, 3)::text AS on_hand,
              bi.reserved::numeric(15, 3)::text AS reserved,
              bi.avg_cost::numeric(15, 2)::text AS avg_cost,
              pv.sale_price::numeric(15, 2)::text AS sale_price,
              bi.updated_at
            FROM branch_inventories bi
            INNER JOIN branches b ON b.id = bi.branch_id AND b.tenant_id = bi.tenant_id
            INNER JOIN product_variants pv ON pv.id = bi.variant_id AND pv.tenant_id = bi.tenant_id
            INNER JOIN products p ON p.id = pv.product_id AND p.tenant_id = pv.tenant_id
            WHERE bi.tenant_id = ${auth.tenantId}::uuid
              AND b.is_active = true
              AND (${allowedIds.length}::int = 0 OR b.id = ANY(${allowedIds}::uuid[]))
              AND (${query.categoryId ?? null}::uuid IS NULL OR p.category_id = ${query.categoryId ?? null}::uuid)
              AND (
                ${!query.lowStockOnly}::boolean
                OR (pv.min_stock_alert > 0 AND bi.on_hand <= pv.min_stock_alert)
              )
              AND (
                ${likePattern}::text IS NULL
                OR p.name ILIKE ${likePattern}
                OR pv.name ILIKE ${likePattern}
                OR pv.sku ILIKE ${likePattern}
                OR pv.barcode ILIKE ${likePattern}
              )
            ORDER BY b.code ASC, p.name ASC, pv.sku ASC
            LIMIT ${query.limit}
            OFFSET ${offset}
          `;

      const stats = summaryRows[0];
      const total = Number(stats?.total_count ?? 0);

      return {
        items: rows.map((row) => {
          const onHandMilli = parseQuantity(row.on_hand);
          const reservedMilli = parseQuantity(row.reserved);
          const avgCostMinor = parseMoney(row.avg_cost);
          const stockValueMinor = calculateLineSubtotal(
            onHandMilli,
            avgCostMinor,
          );

          return {
            branchId: row.branch_id,
            branchCode: row.branch_code,
            branchName: row.branch_name,
            variantId: row.variant_id,
            productId: row.product_id,
            productName: row.product_name,
            variantName: row.variant_name,
            sku: row.sku,
            barcode: row.barcode,
            unit: row.unit,
            minStockAlert: Number(row.min_stock_alert),
            onHand: formatQuantity(onHandMilli),
            reserved: formatQuantity(reservedMilli),
            available: formatQuantity(onHandMilli - reservedMilli),
            avgCost: formatMoney(avgCostMinor),
            salePrice: row.sale_price,
            stockValue: formatMoney(stockValueMinor),
            isLowStock:
              Number(row.min_stock_alert) > 0 &&
              onHandMilli <= BigInt(row.min_stock_alert) * 1000n,
            updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
          };
        }),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.limit)),
        },
        summary: {
          totalStockValue: stats?.total_value ?? "0.00",
          lowStockCount: Number(stats?.low_stock_count ?? 0),
        },
      };
    });
  }

  async listLedgers(
    auth: AuthenticatedContext,
    query: LedgerQuery,
  ): Promise<InventoryLedgerListResponse> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      if (query.branchId) {
        await assertBranchAccessibleInTx(tx, auth, query.branchId);
      }

      const branchFilter = query.branchId
        ? query.branchId
        : auth.allowedBranchIds.length > 0
          ? { in: auth.allowedBranchIds }
          : undefined;

      const searchTerm = query.search?.trim();
      const where = {
        ...(branchFilter !== undefined ? { branchId: branchFilter } : {}),
        ...(query.variantId ? { variantId: query.variantId } : {}),
        ...(query.movementType ? { movementType: query.movementType } : {}),
        ...(searchTerm
          ? {
              OR: [
                { note: { contains: searchTerm, mode: "insensitive" as const } },
                {
                  variant: {
                    OR: [
                      { sku: { contains: searchTerm, mode: "insensitive" as const } },
                      { name: { contains: searchTerm, mode: "insensitive" as const } },
                    ],
                  },
                },
              ],
            }
          : {}),
      };

      const skip = (query.page - 1) * query.limit;
      const [total, entries] = await Promise.all([
        tx.inventoryLedger.count({ where }),
        tx.inventoryLedger.findMany({
          where,
          select: {
            id: true,
            branchId: true,
            variantId: true,
            movementType: true,
            qtyDelta: true,
            qtyBefore: true,
            qtyAfter: true,
            unitCost: true,
            referenceType: true,
            referenceId: true,
            note: true,
            createdAt: true,
            branch: { select: { code: true, name: true } },
            variant: { select: { sku: true, name: true } },
            actorMember: {
              select: {
                employeeCode: true,
                user: { select: { fullName: true } },
              },
            },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip,
          take: query.limit,
        }),
      ]);

      const items: InventoryLedgerItem[] = entries.map((entry) => ({
        id: entry.id,
        branchId: entry.branchId,
        branchCode: entry.branch.code,
        branchName: entry.branch.name,
        variantId: entry.variantId,
        sku: entry.variant.sku,
        variantName: entry.variant.name,
        movementType: entry.movementType,
        qtyDelta: entry.qtyDelta.toFixed(3),
        qtyBefore: entry.qtyBefore.toFixed(3),
        qtyAfter: entry.qtyAfter.toFixed(3),
        unitCost: entry.unitCost.toFixed(2),
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        actorName: entry.actorMember.user.fullName,
        actorEmployeeCode: entry.actorMember.employeeCode,
        note: entry.note,
        createdAt: entry.createdAt.toISOString(),
      }));

      return {
        items,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.limit)),
        },
      };
    });
  }
}
