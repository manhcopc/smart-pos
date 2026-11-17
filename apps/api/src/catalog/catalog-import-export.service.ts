import { Readable } from "node:stream";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import {
  type CatalogImportResponse,
  type CatalogImportRowError,
  ERROR_CODES,
  type ProductVariantInput,
  productVariantInputSchema,
} from "@smart-pos/shared";
import ExcelJS from "exceljs";
import type { AuthenticatedContext } from "../auth/auth.types";
import { lockTenantAndReadQuota } from "../common/tenant/tenant-quota.helper";
import { PrismaService } from "../prisma/prisma.service";

const CATALOG_COLUMNS = [
  "productName",
  "categoryName",
  "brand",
  "sku",
  "barcode",
  "variantName",
  "unit",
  "costPrice",
  "salePrice",
  "taxRate",
  "minStockAlert",
] as const;

const MAX_IMPORT_ROWS = 2000;
const FORMULA_PREFIX_REGEX = /^[=+\-@\t\r]/;

interface ParsedCatalogRow {
  rowNumber: number;
  productName: string;
  categoryName: string | null;
  brand: string | null;
  variant: ProductVariantInput;
}

function cellToString(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") {
      return value.text.trim();
    }
    if ("result" in value && value.result !== undefined) {
      return String(value.result).trim();
    }
    return "";
  }
  return String(value).trim();
}

function neutralizeCsvFormula(text: string): string {
  return FORMULA_PREFIX_REGEX.test(text) ? `'${text}` : text;
}

function escapeCsvCell(value: string): string {
  const safe = neutralizeCsvFormula(value);
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return safe;
}

@Injectable()
export class CatalogImportExportService {
  constructor(private readonly prisma: PrismaService) {}

  async generateTemplate(format: "csv" | "xlsx"): Promise<Buffer> {
    const sampleRows = [
      {
        productName: "Áo thun Cotton Basic",
        categoryName: "Thời trang nam",
        brand: "SmartWear",
        sku: "AT-COTTON-M",
        barcode: "8938505970011",
        variantName: "Áo thun Cotton - Đen - M",
        unit: "Cái",
        costPrice: "65000.00",
        salePrice: "129000.00",
        taxRate: "8.00",
        minStockAlert: 10,
      },
    ];

    return this.buildCatalogBuffer(sampleRows, format);
  }

  async exportCatalog(
    auth: AuthenticatedContext,
    format: "csv" | "xlsx",
  ): Promise<Buffer> {
    const rows = await this.prisma.withTenantTransaction(
      auth.tenantId,
      async (tx) => {
        const variants = await tx.productVariant.findMany({
          select: {
            sku: true,
            barcode: true,
            name: true,
            unit: true,
            costPrice: true,
            salePrice: true,
            taxRate: true,
            minStockAlert: true,
            product: {
              select: {
                name: true,
                brand: true,
                category: { select: { name: true } },
              },
            },
          },
          orderBy: [{ product: { name: "asc" } }, { sku: "asc" }],
        });

        return variants.map((v) => ({
          productName: v.product.name,
          categoryName: v.product.category?.name ?? "",
          brand: v.product.brand ?? "",
          sku: v.sku,
          barcode: v.barcode ?? "",
          variantName: v.name,
          unit: v.unit,
          costPrice: v.costPrice.toFixed(2),
          salePrice: v.salePrice.toFixed(2),
          taxRate: v.taxRate.toFixed(2),
          minStockAlert: v.minStockAlert,
        }));
      },
    );

    // Format Excel/CSV buffers cleanly OUTSIDE any DB transaction.
    return this.buildCatalogBuffer(rows, format);
  }

  async importCatalog(
    auth: AuthenticatedContext,
    file: { originalname: string; mimetype: string; buffer: Buffer },
  ): Promise<CatalogImportResponse> {
    const { parsedRows, parseErrors } = await this.parseUploadedWorkbook(
      file.buffer,
      file.originalname,
      file.mimetype,
    );

    if (parsedRows.length === 0) {
      return {
        createdProducts: 0,
        createdVariants: 0,
        skippedRows: parseErrors.length,
        errors: parseErrors,
      };
    }

    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const quota = await lockTenantAndReadQuota(tx, auth.tenantId);

      const [existingVariants, existingCategories] = await Promise.all([
        tx.productVariant.findMany({ select: { sku: true, barcode: true } }),
        tx.category.findMany({ select: { id: true, name: true } }),
      ]);

      const knownSkus = new Set(existingVariants.map((v) => v.sku.toUpperCase()));
      const knownBarcodes = new Set(
        existingVariants
          .map((v) => v.barcode)
          .filter((b): b is string => Boolean(b)),
      );
      const categoryIdByLowerName = new Map(
        existingCategories.map((c) => [c.name.trim().toLowerCase(), c.id]),
      );

      const errors: CatalogImportRowError[] = [...parseErrors];
      const acceptedRows: ParsedCatalogRow[] = [];

      for (const row of parsedRows) {
        if (knownSkus.has(row.variant.sku)) {
          errors.push({
            rowNumber: row.rowNumber,
            sku: row.variant.sku,
            message: `Mã SKU "${row.variant.sku}" đã tồn tại hoặc bị trùng`,
          });
          continue;
        }

        if (row.variant.barcode && knownBarcodes.has(row.variant.barcode)) {
          errors.push({
            rowNumber: row.rowNumber,
            sku: row.variant.sku,
            message: `Mã vạch "${row.variant.barcode}" đã tồn tại hoặc bị trùng`,
          });
          continue;
        }

        knownSkus.add(row.variant.sku);
        if (row.variant.barcode) {
          knownBarcodes.add(row.variant.barcode);
        }
        acceptedRows.push(row);
      }

      if (acceptedRows.length === 0) {
        return {
          createdProducts: 0,
          createdVariants: 0,
          skippedRows: errors.length,
          errors,
        };
      }

      if (existingVariants.length + acceptedRows.length > quota.maxSkus) {
        throw new ForbiddenException({
          code: ERROR_CODES.PLAN_QUOTA_EXCEEDED,
          message: `Import sẽ vượt hạn mức ${quota.maxSkus} SKU của gói hiện tại`,
        });
      }

      type ProductGroup = {
        productName: string;
        categoryName: string | null;
        brand: string | null;
        variants: ProductVariantInput[];
      };

      const groups = new Map<string, ProductGroup>();
      for (const row of acceptedRows) {
        const key = `${row.productName.toLowerCase()}||${(row.categoryName ?? "").toLowerCase()}||${(row.brand ?? "").toLowerCase()}`;
        const existingGroup = groups.get(key);
        if (existingGroup) {
          existingGroup.variants.push(row.variant);
        } else {
          groups.set(key, {
            productName: row.productName,
            categoryName: row.categoryName,
            brand: row.brand,
            variants: [row.variant],
          });
        }
      }

      let createdProducts = 0;
      let createdVariants = 0;

      for (const group of groups.values()) {
        let categoryId: string | null = null;
        if (group.categoryName) {
          const lower = group.categoryName.toLowerCase();
          categoryId = categoryIdByLowerName.get(lower) ?? null;
          if (!categoryId) {
            const createdCat = await tx.category.create({
              data: {
                tenantId: auth.tenantId,
                name: group.categoryName,
                sortOrder: 0,
              },
              select: { id: true },
            });
            categoryId = createdCat.id;
            categoryIdByLowerName.set(lower, categoryId);
          }
        }

        await tx.product.create({
          data: {
            tenantId: auth.tenantId,
            categoryId,
            name: group.productName,
            brand: group.brand,
            hasVariants: group.variants.length > 1,
            isActive: true,
            variants: {
              create: group.variants.map((v) => ({
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
        });

        createdProducts += 1;
        createdVariants += group.variants.length;
      }

      return {
        createdProducts,
        createdVariants,
        skippedRows: errors.length,
        errors,
      };
    });
  }

  private async buildCatalogBuffer(
    rows: Array<Record<(typeof CATALOG_COLUMNS)[number], string | number>>,
    format: "csv" | "xlsx",
  ): Promise<Buffer> {
    if (format === "csv") {
      const headerLine = CATALOG_COLUMNS.join(",");
      const dataLines = rows.map((row) =>
        CATALOG_COLUMNS.map((col) => escapeCsvCell(String(row[col] ?? ""))).join(
          ",",
        ),
      );
      const csvText = `\uFEFF${[headerLine, ...dataLines].join("\r\n")}\r\n`;
      return Buffer.from(csvText, "utf8");
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Catalog");
    sheet.columns = CATALOG_COLUMNS.map((col) => ({
      header: col,
      key: col,
      width: col === "productName" || col === "variantName" ? 28 : 18,
    }));

    for (const row of rows) {
      sheet.addRow({
        ...row,
        productName: neutralizeCsvFormula(String(row.productName)),
        categoryName: neutralizeCsvFormula(String(row.categoryName)),
        brand: neutralizeCsvFormula(String(row.brand)),
        sku: neutralizeCsvFormula(String(row.sku)),
        barcode: neutralizeCsvFormula(String(row.barcode)),
        variantName: neutralizeCsvFormula(String(row.variantName)),
        unit: neutralizeCsvFormula(String(row.unit)),
      });
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async parseUploadedWorkbook(
    buffer: Buffer,
    originalname: string,
    mimetype: string,
  ): Promise<{
    parsedRows: ParsedCatalogRow[];
    parseErrors: CatalogImportRowError[];
  }> {
    const workbook = new ExcelJS.Workbook();
    const isCsv =
      originalname.toLowerCase().endsWith(".csv") ||
      mimetype.includes("csv") ||
      mimetype === "text/plain";

    let worksheet: ExcelJS.Worksheet | undefined;
    try {
      if (isCsv) {
        const cleanText = buffer.toString("utf8").replace(/^\uFEFF/, "");
        worksheet = await workbook.csv.read(Readable.from([cleanText]));
      } else {
        await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
        worksheet = workbook.worksheets[0];
      }
    } catch {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Không thể đọc tệp Excel/CSV. Vui lòng dùng đúng template.",
      });
    }

    if (!worksheet || worksheet.rowCount < 2) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Tệp không có dữ liệu sản phẩm để import",
      });
    }

    if (worksheet.rowCount - 1 > MAX_IMPORT_ROWS) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Chỉ hỗ trợ tối đa ${MAX_IMPORT_ROWS} dòng mỗi lần import`,
      });
    }

    const headerRow = worksheet.getRow(1);
    const colIndexByName = new Map<string, number>();
    headerRow.eachCell((cell, colNumber) => {
      const header = cellToString(cell.value);
      if (header) {
        colIndexByName.set(header, colNumber);
      }
    });

    const missingRequiredHeaders = ["productName", "sku", "costPrice", "salePrice"].filter(
      (col) => !colIndexByName.has(col),
    );
    if (missingRequiredHeaders.length > 0) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Thiếu cột bắt buộc trong tệp: ${missingRequiredHeaders.join(", ")}`,
      });
    }

    const parsedRows: ParsedCatalogRow[] = [];
    const parseErrors: CatalogImportRowError[] = [];

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const readCol = (name: (typeof CATALOG_COLUMNS)[number]): string => {
        const colIdx = colIndexByName.get(name);
        if (!colIdx) return "";
        return cellToString(row.getCell(colIdx).value);
      };

      const productName = readCol("productName");
      const skuRaw = readCol("sku");
      if (!productName && !skuRaw) {
        continue;
      }

      if (!productName) {
        parseErrors.push({
          rowNumber,
          sku: skuRaw || "-",
          message: "Thiếu tên sản phẩm (productName)",
        });
        continue;
      }

      const variantParsed = productVariantInputSchema.safeParse({
        sku: skuRaw,
        barcode: readCol("barcode") || null,
        name: readCol("variantName") || productName,
        unit: readCol("unit") || "Cái",
        costPrice: readCol("costPrice") || "0",
        salePrice: readCol("salePrice") || "0",
        taxRate: readCol("taxRate") || "0",
        minStockAlert: readCol("minStockAlert") || "0",
      });

      if (!variantParsed.success) {
        parseErrors.push({
          rowNumber,
          sku: skuRaw || "-",
          message:
            variantParsed.error.issues[0]?.message ?? "Dữ liệu biến thể không hợp lệ",
        });
        continue;
      }

      parsedRows.push({
        rowNumber,
        productName,
        categoryName: readCol("categoryName") || null,
        brand: readCol("brand") || null,
        variant: variantParsed.data,
      });
    }

    return { parsedRows, parseErrors };
  }
}
