import crypto from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PERMISSIONS } from "@smart-pos/shared";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedContext } from "../auth/auth.types";
import { CatalogImportExportService } from "../catalog/catalog-import-export.service";
import { CategoriesService } from "../catalog/categories.service";
import { ProductsService } from "../catalog/products.service";
import { StorageService } from "../common/storage/storage.service";
import type { AppEnv } from "../config/env";
import type { PrismaService } from "../prisma/prisma.service";

const ownerAuth: AuthenticatedContext = {
  userId: crypto.randomUUID(),
  memberId: crypto.randomUUID(),
  tenantId: crypto.randomUUID(),
  tenantSlug: "shop-p2",
  role: "OWNER",
  familyId: crypto.randomUUID(),
  effectivePermissions: new Set(Object.values(PERMISSIONS)),
  allowedBranchIds: [],
};

describe("StorageService & Catalog Services", () => {
  it("reports STORAGE_NOT_CONFIGURED when S3 env vars are absent and presigns when configured", async () => {
    const emptyConfig = {
      get: (key: keyof AppEnv) =>
        key === "S3_BUCKET" ? "smart-pos-assets" : undefined,
    } as unknown as ConfigService<AppEnv, true>;

    const unconfigured = new StorageService(emptyConfig);
    expect(unconfigured.isConfigured()).toBe(false);
    await expect(
      unconfigured.presignProductImageUpload(ownerAuth.tenantId, {
        fileName: "shirt.webp",
        contentType: "image/webp",
        fileSizeBytes: 102400,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    const activeConfig = {
      get: (key: keyof AppEnv) => {
        const map: Partial<AppEnv> = {
          S3_ENDPOINT: "https://r2.example.com",
          S3_REGION: "auto",
          S3_BUCKET: "smart-pos-assets",
          S3_ACCESS_KEY_ID: "test-access-key",
          S3_SECRET_ACCESS_KEY: "test-secret-key",
          S3_PUBLIC_BASE_URL: "https://cdn.example.com",
        };
        return map[key];
      },
    } as unknown as ConfigService<AppEnv, true>;

    const configured = new StorageService(activeConfig);
    expect(configured.isConfigured()).toBe(true);
    const presigned = await configured.presignProductImageUpload(
      ownerAuth.tenantId,
      {
        fileName: "shirt.webp",
        contentType: "image/webp",
        fileSizeBytes: 102400,
      },
    );
    expect(presigned.key).toMatch(
      new RegExp(`^tenants/${ownerAuth.tenantId}/products/.+\\.webp$`),
    );
    expect(presigned.publicUrl).toContain("https://cdn.example.com/");
    expect(presigned.uploadUrl).toContain("X-Amz-Signature");
  });

  it("prevents circular category parent relationships", async () => {
    const catA = crypto.randomUUID();
    const catB = crypto.randomUUID();

    const prisma = {
      withTenantTransaction: vi.fn(
        async (_tenantId: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            category: {
              findFirst: vi.fn().mockResolvedValue({ id: catA }),
              findMany: vi.fn().mockResolvedValue([
                { id: catA, parentId: null },
                { id: catB, parentId: catA },
              ]),
            },
          }),
      ),
    } as unknown as PrismaService;

    const service = new CategoriesService(prisma);
    await expect(
      service.update(ownerAuth, catA, { parentId: catB }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("enforces maxSkus quota and SKU uniqueness when creating products", async () => {
    const quotaPrisma = {
      withTenantTransaction: vi.fn(
        async (_tenantId: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            $queryRaw: vi.fn().mockResolvedValue([
              {
                max_branches: 2,
                max_users: 5,
                max_skus: 1,
                storage_quota_mb: 256,
              },
            ]),
            productVariant: {
              count: vi.fn().mockResolvedValue(1),
            },
          }),
      ),
    } as unknown as PrismaService;

    const quotaService = new ProductsService(quotaPrisma);
    await expect(
      quotaService.createProduct(ownerAuth, {
        name: "Sản phẩm vượt quota",
        hasVariants: false,
        variants: [
          {
            sku: "SKU-OVER",
            name: "Mặc định",
            unit: "Cái",
            costPrice: "10000",
            salePrice: "15000",
            taxRate: "0",
            minStockAlert: 5,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const dupSkuPrisma = {
      withTenantTransaction: vi.fn(
        async (_tenantId: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            $queryRaw: vi.fn().mockResolvedValue([
              {
                max_branches: 10,
                max_users: 10,
                max_skus: 500,
                storage_quota_mb: 256,
              },
            ]),
            productVariant: {
              count: vi.fn().mockResolvedValue(1),
              findFirst: vi.fn().mockResolvedValue({ sku: "SKU-001" }),
            },
          }),
      ),
    } as unknown as PrismaService;

    const dupService = new ProductsService(dupSkuPrisma);
    await expect(
      dupService.createProduct(ownerAuth, {
        name: "Sản phẩm trùng SKU",
        hasVariants: false,
        variants: [
          {
            sku: "SKU-001",
            name: "Mặc định",
            unit: "Cái",
            costPrice: "10000",
            salePrice: "15000",
            taxRate: "0",
            minStockAlert: 5,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("neutralizes spreadsheet formulas on CSV export and imports grouped products from CSV", async () => {
    const createCategory = vi.fn().mockResolvedValue({ id: crypto.randomUUID() });
    const createProduct = vi.fn().mockResolvedValue({ id: crypto.randomUUID() });
    const findManyVariants = vi
      .fn()
      .mockResolvedValueOnce([
        {
          sku: "FORMULA-1",
          barcode: null,
          name: "Bánh mì",
          unit: "Cái",
          costPrice: new Prisma.Decimal("5000.00"),
          salePrice: new Prisma.Decimal("15000.00"),
          taxRate: new Prisma.Decimal("0.00"),
          minStockAlert: 5,
          product: {
            name: "=CMD('calc')",
            brand: "Test",
            category: { name: "Đồ ăn" },
          },
        },
      ])
      .mockResolvedValueOnce([{ sku: "EXIST-1", barcode: null }]);

    const prisma = {
      withTenantTransaction: vi.fn(
        async (_tenantId: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            $queryRaw: vi.fn().mockResolvedValue([
              {
                max_branches: 10,
                max_users: 20,
                max_skus: 500,
                storage_quota_mb: 1024,
              },
            ]),
            productVariant: {
              findMany: findManyVariants,
            },
            category: {
              findMany: vi.fn().mockResolvedValue([]),
              create: createCategory,
            },
            product: {
              create: createProduct,
            },
          }),
      ),
    } as unknown as PrismaService;

    const ioService = new CatalogImportExportService(prisma);
    const csvBuffer = await ioService.exportCatalog(ownerAuth, "csv");
    const csvString = csvBuffer.toString("utf8");
    expect(csvString).toContain("'=CMD('calc')");

    const uploadCsv = [
      "productName,categoryName,brand,sku,barcode,variantName,unit,costPrice,salePrice,taxRate,minStockAlert",
      "Áo Polo,Thời trang,Smart,EXIST-1,,Áo Polo S,Cái,50000,120000,8,5",
      "Áo Polo,Thời trang,Smart,NEW-POLO-M,8930001,Áo Polo Đen M,Cái,55000,129000,8,5",
      "Áo Polo,Thời trang,Smart,NEW-POLO-L,8930002,Áo Polo Đen L,Cái,55000,129000,8,5",
    ].join("\n");

    const importResult = await ioService.importCatalog(ownerAuth, {
      originalname: "catalog.csv",
      mimetype: "text/csv",
      buffer: Buffer.from(uploadCsv, "utf8"),
    });

    expect(importResult.createdProducts).toBe(1);
    expect(importResult.createdVariants).toBe(2);
    expect(importResult.skippedRows).toBe(1);
    expect(importResult.errors[0]?.sku).toBe("EXIST-1");
    expect(createCategory).toHaveBeenCalledTimes(1);
    expect(createProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Áo Polo",
          hasVariants: true,
        }),
      }),
    );
  });
});
