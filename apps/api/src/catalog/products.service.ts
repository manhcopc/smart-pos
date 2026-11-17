import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  type CatalogListQuery,
  type CatalogListResponse,
  type CreateProductInput,
  ERROR_CODES,
  formatQuantity,
  parseQuantity,
  type ProductItem,
  type ProductVariantInput,
  type ProductVariantItem,
  type UpdateProductInput,
  type UpdateVariantInput,
} from "@smart-pos/shared";
import type { AuthenticatedContext } from "../auth/auth.types";
import {
  assertBranchAccessibleInTx,
  lockTenantAndReadQuota,
} from "../common/tenant/tenant-quota.helper";
import { PrismaService } from "../prisma/prisma.service";

const VARIANT_SELECT = {
  id: true,
  productId: true,
  sku: true,
  barcode: true,
  name: true,
  unit: true,
  costPrice: true,
  salePrice: true,
  taxRate: true,
  minStockAlert: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductVariantSelect;

type VariantRow = Prisma.ProductVariantGetPayload<{
  select: typeof VARIANT_SELECT;
}>;

interface StockRow {
  variantId: string;
  branchId: string;
  onHand: Prisma.Decimal;
  reserved: Prisma.Decimal;
  avgCost: Prisma.Decimal;
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async listProducts(
    auth: AuthenticatedContext,
    query: CatalogListQuery,
  ): Promise<CatalogListResponse> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      if (query.branchId) {
        await assertBranchAccessibleInTx(tx, auth, query.branchId);
      }

      const [quotaInfo, currentSkus] = await Promise.all([
        this.readMaxSkus(tx, auth.tenantId),
        tx.productVariant.count(),
      ]);

      const searchTerm = query.search?.trim();
      const where: Prisma.ProductWhereInput = {
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
        ...(searchTerm
          ? {
              OR: [
                { name: { contains: searchTerm, mode: "insensitive" } },
                { brand: { contains: searchTerm, mode: "insensitive" } },
                {
                  variants: {
                    some: {
                      OR: [
                        { sku: { contains: searchTerm, mode: "insensitive" } },
                        {
                          barcode: {
                            contains: searchTerm,
                            mode: "insensitive",
                          },
                        },
                        { name: { contains: searchTerm, mode: "insensitive" } },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
      };

      if (query.lowStockOnly && query.branchId) {
        const lowStockProductIds = await this.findLowStockProductIds(
          tx,
          auth.tenantId,
          query.branchId,
          query.categoryId,
          query.isActive,
          searchTerm,
        );
        where.id = { in: lowStockProductIds };
      }

      const skip = (query.page - 1) * query.limit;
      const [total, products] = await Promise.all([
        tx.product.count({ where }),
        tx.product.findMany({
          where,
          select: {
            id: true,
            categoryId: true,
            name: true,
            description: true,
            brand: true,
            hasVariants: true,
            imageUrl: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
            category: { select: { name: true } },
            variants: {
              select: VARIANT_SELECT,
              orderBy: { createdAt: "asc" },
            },
          },
          orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
          skip,
          take: query.limit,
        }),
      ]);

      const stockByVariantId = await this.loadBranchStockMap(
        tx,
        query.branchId,
        products.flatMap((p) => p.variants.map((v) => v.id)),
      );

      return {
        items: products.map((product) =>
          this.serializeProduct(product, stockByVariantId, query.branchId),
        ),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.limit)),
        },
        quota: {
          activeSkus: currentSkus,
          maxSkus: quotaInfo,
        },
      };
    });
  }

  async getProduct(
    auth: AuthenticatedContext,
    productId: string,
    branchId?: string,
  ): Promise<ProductItem> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      if (branchId) {
        await assertBranchAccessibleInTx(tx, auth, branchId);
      }

      const product = await tx.product.findFirst({
        where: { id: productId },
        select: {
          id: true,
          categoryId: true,
          name: true,
          description: true,
          brand: true,
          hasVariants: true,
          imageUrl: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          category: { select: { name: true } },
          variants: {
            select: VARIANT_SELECT,
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!product) {
        throw new NotFoundException({
          code: ERROR_CODES.PRODUCT_NOT_FOUND,
          message: "Không tìm thấy sản phẩm",
        });
      }

      const stockByVariantId = await this.loadBranchStockMap(
        tx,
        branchId,
        product.variants.map((v) => v.id),
      );

      return this.serializeProduct(product, stockByVariantId, branchId);
    });
  }

  async createProduct(
    auth: AuthenticatedContext,
    input: CreateProductInput,
  ): Promise<ProductItem> {
    try {
      return await this.prisma.withTenantTransaction(
        auth.tenantId,
        async (tx) => {
          const quota = await lockTenantAndReadQuota(tx, auth.tenantId);
          const currentSkus = await tx.productVariant.count();

          if (currentSkus + input.variants.length > quota.maxSkus) {
            throw new ForbiddenException({
              code: ERROR_CODES.PLAN_QUOTA_EXCEEDED,
              message: `Gói hiện tại chỉ cho phép tối đa ${quota.maxSkus} SKU sản phẩm`,
            });
          }

          if (input.categoryId) {
            await this.assertCategoryExists(tx, input.categoryId);
          }

          await this.assertUniqueVariantIdentifiers(tx, input.variants);

          const created = await tx.product.create({
            data: {
              tenantId: auth.tenantId,
              categoryId: input.categoryId ?? null,
              name: input.name,
              description: input.description ?? null,
              brand: input.brand ?? null,
              hasVariants: input.hasVariants || input.variants.length > 1,
              imageUrl: input.imageUrl ?? null,
              isActive: true,
              variants: {
                create: input.variants.map((v) => ({
                  tenantId: auth.tenantId,
                  sku: v.sku,
                  barcode: v.barcode ?? null,
                  name: v.name,
                  unit: v.unit,
                  costPrice: v.costPrice,
                  salePrice: v.salePrice,
                  taxRate: v.taxRate,
                  minStockAlert: v.minStockAlert,
                  isActive: true,
                })),
              },
            },
            select: {
              id: true,
              categoryId: true,
              name: true,
              description: true,
              brand: true,
              hasVariants: true,
              imageUrl: true,
              isActive: true,
              createdAt: true,
              updatedAt: true,
              category: { select: { name: true } },
              variants: {
                select: VARIANT_SELECT,
                orderBy: { createdAt: "asc" },
              },
            },
          });

          return this.serializeProduct(created, new Map(), undefined);
        },
      );
    } catch (error) {
      this.rethrowUniqueConstraint(error);
      throw error;
    }
  }

  async updateProduct(
    auth: AuthenticatedContext,
    productId: string,
    input: UpdateProductInput,
  ): Promise<ProductItem> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const existing = await tx.product.findFirst({
        where: { id: productId },
        select: { id: true },
      });
      if (!existing) {
        throw new NotFoundException({
          code: ERROR_CODES.PRODUCT_NOT_FOUND,
          message: "Không tìm thấy sản phẩm",
        });
      }

      if (input.categoryId) {
        await this.assertCategoryExists(tx, input.categoryId);
      }

      const updated = await tx.product.update({
        where: { id: productId },
        data: {
          ...(input.categoryId !== undefined
            ? { categoryId: input.categoryId }
            : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.brand !== undefined ? { brand: input.brand } : {}),
          ...(input.hasVariants !== undefined
            ? { hasVariants: input.hasVariants }
            : {}),
          ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
        select: {
          id: true,
          categoryId: true,
          name: true,
          description: true,
          brand: true,
          hasVariants: true,
          imageUrl: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          category: { select: { name: true } },
          variants: {
            select: VARIANT_SELECT,
            orderBy: { createdAt: "asc" },
          },
        },
      });

      return this.serializeProduct(updated, new Map(), undefined);
    });
  }

  async addVariant(
    auth: AuthenticatedContext,
    productId: string,
    input: ProductVariantInput,
  ): Promise<ProductVariantItem> {
    try {
      return await this.prisma.withTenantTransaction(
        auth.tenantId,
        async (tx) => {
          const quota = await lockTenantAndReadQuota(tx, auth.tenantId);

          const product = await tx.product.findFirst({
            where: { id: productId },
            select: { id: true, hasVariants: true },
          });
          if (!product) {
            throw new NotFoundException({
              code: ERROR_CODES.PRODUCT_NOT_FOUND,
              message: "Không tìm thấy sản phẩm",
            });
          }

          const currentSkus = await tx.productVariant.count();
          if (currentSkus + 1 > quota.maxSkus) {
            throw new ForbiddenException({
              code: ERROR_CODES.PLAN_QUOTA_EXCEEDED,
              message: `Gói hiện tại chỉ cho phép tối đa ${quota.maxSkus} SKU sản phẩm`,
            });
          }

          await this.assertUniqueVariantIdentifiers(tx, [input]);

          const created = await tx.productVariant.create({
            data: {
              tenantId: auth.tenantId,
              productId,
              sku: input.sku,
              barcode: input.barcode ?? null,
              name: input.name,
              unit: input.unit,
              costPrice: input.costPrice,
              salePrice: input.salePrice,
              taxRate: input.taxRate,
              minStockAlert: input.minStockAlert,
              isActive: true,
            },
            select: VARIANT_SELECT,
          });

          if (!product.hasVariants) {
            await tx.product.update({
              where: { id: productId },
              data: { hasVariants: true },
            });
          }

          return this.serializeVariant(created, undefined, undefined);
        },
      );
    } catch (error) {
      this.rethrowUniqueConstraint(error);
      throw error;
    }
  }

  async updateVariant(
    auth: AuthenticatedContext,
    productId: string,
    variantId: string,
    input: UpdateVariantInput,
  ): Promise<ProductVariantItem> {
    try {
      return await this.prisma.withTenantTransaction(
        auth.tenantId,
        async (tx) => {
          const existing = await tx.productVariant.findFirst({
            where: { id: variantId, productId },
            select: { id: true },
          });
          if (!existing) {
            throw new NotFoundException({
              code: ERROR_CODES.RESOURCE_NOT_FOUND,
              message: "Không tìm thấy biến thể sản phẩm",
            });
          }

          if (input.barcode) {
            const dupBarcode = await tx.productVariant.findFirst({
              where: {
                barcode: input.barcode,
                id: { not: variantId },
              },
              select: { id: true },
            });
            if (dupBarcode) {
              throw new ConflictException({
                code: ERROR_CODES.BARCODE_ALREADY_EXISTS,
                message: `Mã vạch "${input.barcode}" đã được dùng bởi biến thể khác`,
              });
            }
          }

          const updated = await tx.productVariant.update({
            where: { id: variantId },
            data: {
              ...(input.barcode !== undefined
                ? { barcode: input.barcode }
                : {}),
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(input.unit !== undefined ? { unit: input.unit } : {}),
              ...(input.costPrice !== undefined
                ? { costPrice: input.costPrice }
                : {}),
              ...(input.salePrice !== undefined
                ? { salePrice: input.salePrice }
                : {}),
              ...(input.taxRate !== undefined
                ? { taxRate: input.taxRate }
                : {}),
              ...(input.minStockAlert !== undefined
                ? { minStockAlert: input.minStockAlert }
                : {}),
              ...(input.isActive !== undefined
                ? { isActive: input.isActive }
                : {}),
            },
            select: VARIANT_SELECT,
          });

          return this.serializeVariant(updated, undefined, undefined);
        },
      );
    } catch (error) {
      this.rethrowUniqueConstraint(error);
      throw error;
    }
  }

  private async assertCategoryExists(
    tx: Prisma.TransactionClient,
    categoryId: string,
  ): Promise<void> {
    const category = await tx.category.findFirst({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) {
      throw new NotFoundException({
        code: ERROR_CODES.CATEGORY_NOT_FOUND,
        message: "Không tìm thấy nhóm hàng",
      });
    }
  }

  private async assertUniqueVariantIdentifiers(
    tx: Prisma.TransactionClient,
    variants: ReadonlyArray<{ sku: string; barcode?: string | null }>,
  ): Promise<void> {
    const skus = variants.map((v) => v.sku);
    const barcodes = variants
      .map((v) => v.barcode)
      .filter((b): b is string => Boolean(b));

    const existingSku = await tx.productVariant.findFirst({
      where: { sku: { in: skus } },
      select: { sku: true },
    });
    if (existingSku) {
      throw new ConflictException({
        code: ERROR_CODES.SKU_ALREADY_EXISTS,
        message: `Mã SKU "${existingSku.sku}" đã tồn tại`,
      });
    }

    if (barcodes.length > 0) {
      const existingBarcode = await tx.productVariant.findFirst({
        where: { barcode: { in: barcodes } },
        select: { barcode: true },
      });
      if (existingBarcode) {
        throw new ConflictException({
          code: ERROR_CODES.BARCODE_ALREADY_EXISTS,
          message: `Mã vạch "${existingBarcode.barcode}" đã tồn tại`,
        });
      }
    }
  }

  private async findLowStockProductIds(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    categoryId?: string,
    isActive?: boolean,
    search?: string,
  ): Promise<string[]> {
    const likePattern = search ? `%${search}%` : null;
    const rows = await tx.$queryRaw<Array<{ product_id: string }>>`
      SELECT DISTINCT pv.product_id
      FROM product_variants pv
      INNER JOIN products p ON p.id = pv.product_id AND p.tenant_id = pv.tenant_id
      LEFT JOIN branch_inventories bi
        ON bi.tenant_id = pv.tenant_id
        AND bi.branch_id = ${branchId}::uuid
        AND bi.variant_id = pv.id
      WHERE pv.tenant_id = ${tenantId}::uuid
        AND pv.min_stock_alert > 0
        AND COALESCE(bi.on_hand, 0) <= pv.min_stock_alert
        AND (${categoryId ?? null}::uuid IS NULL OR p.category_id = ${categoryId ?? null}::uuid)
        AND (${isActive ?? null}::boolean IS NULL OR p.is_active = ${isActive ?? null}::boolean)
        AND (
          ${likePattern}::text IS NULL
          OR p.name ILIKE ${likePattern}
          OR p.brand ILIKE ${likePattern}
          OR pv.sku ILIKE ${likePattern}
          OR pv.barcode ILIKE ${likePattern}
          OR pv.name ILIKE ${likePattern}
        )
    `;
    return rows.map((row) => row.product_id);
  }

  private async loadBranchStockMap(
    tx: Prisma.TransactionClient,
    branchId: string | undefined,
    variantIds: string[],
  ): Promise<Map<string, StockRow>> {
    const map = new Map<string, StockRow>();
    if (!branchId || variantIds.length === 0) {
      return map;
    }

    const rows = await tx.branchInventory.findMany({
      where: {
        branchId,
        variantId: { in: variantIds },
      },
      select: {
        variantId: true,
        branchId: true,
        onHand: true,
        reserved: true,
        avgCost: true,
      },
    });

    for (const row of rows) {
      map.set(row.variantId, row);
    }
    return map;
  }

  private async readMaxSkus(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<number> {
    const tenant = await tx.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: { plan: { select: { maxSkus: true } } },
    });
    return tenant?.plan.maxSkus ?? 500;
  }

  private serializeProduct(
    product: {
      id: string;
      categoryId: string | null;
      category: { name: string } | null;
      name: string;
      description: string | null;
      brand: string | null;
      hasVariants: boolean;
      imageUrl: string | null;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
      variants: VariantRow[];
    },
    stockByVariantId: Map<string, StockRow>,
    branchId: string | undefined,
  ): ProductItem {
    return {
      id: product.id,
      categoryId: product.categoryId,
      categoryName: product.category?.name ?? null,
      name: product.name,
      description: product.description,
      brand: product.brand,
      hasVariants: product.hasVariants,
      imageUrl: product.imageUrl,
      isActive: product.isActive,
      variants: product.variants.map((variant) =>
        this.serializeVariant(
          variant,
          stockByVariantId.get(variant.id),
          branchId,
        ),
      ),
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    };
  }

  private serializeVariant(
    variant: VariantRow,
    stock: StockRow | undefined,
    branchId: string | undefined,
  ): ProductVariantItem {
    let branchStock: ProductVariantItem["branchStock"] = null;
    if (branchId) {
      const onHandStr = stock ? stock.onHand.toFixed(3) : "0.000";
      const reservedStr = stock ? stock.reserved.toFixed(3) : "0.000";
      const availableMilli =
        parseQuantity(onHandStr) - parseQuantity(reservedStr);
      const isLowStock =
        variant.minStockAlert > 0 &&
        parseQuantity(onHandStr) <= BigInt(variant.minStockAlert) * 1000n;

      branchStock = {
        branchId,
        onHand: onHandStr,
        reserved: reservedStr,
        available: formatQuantity(availableMilli),
        avgCost: stock ? stock.avgCost.toFixed(2) : variant.costPrice.toFixed(2),
        isLowStock,
      };
    }

    return {
      id: variant.id,
      productId: variant.productId,
      sku: variant.sku,
      barcode: variant.barcode,
      name: variant.name,
      unit: variant.unit,
      costPrice: variant.costPrice.toFixed(2),
      salePrice: variant.salePrice.toFixed(2),
      taxRate: variant.taxRate.toFixed(2),
      minStockAlert: variant.minStockAlert,
      isActive: variant.isActive,
      ...(branchId ? { branchStock } : {}),
      createdAt: variant.createdAt.toISOString(),
      updatedAt: variant.updatedAt.toISOString(),
    };
  }

  private rethrowUniqueConstraint(error: unknown): void {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      (error as { code?: unknown }).code !== "P2002"
    ) {
      return;
    }

    const meta = (error as { meta?: { target?: unknown } }).meta;
    const target = Array.isArray(meta?.target)
      ? meta.target.join(",")
      : String(meta?.target ?? "");

    if (target.includes("sku")) {
      throw new ConflictException({
        code: ERROR_CODES.SKU_ALREADY_EXISTS,
        message: "Mã SKU đã tồn tại trong cửa hàng",
      });
    }
    if (target.includes("barcode")) {
      throw new ConflictException({
        code: ERROR_CODES.BARCODE_ALREADY_EXISTS,
        message: "Mã vạch đã tồn tại trong cửa hàng",
      });
    }
  }
}
