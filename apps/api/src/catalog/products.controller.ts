import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import {
  type CatalogImportResponse,
  type CatalogListQuery,
  catalogListQuerySchema,
  type CatalogListResponse,
  type CreateProductInput,
  createProductSchema,
  ERROR_CODES,
  type ExportFormatQuery,
  exportFormatQuerySchema,
  PERMISSIONS,
  type PresignedUploadResponse,
  type PresignProductImageInput,
  presignProductImageSchema,
  type ProductItem,
  type ProductVariantInput,
  productVariantInputSchema,
  type ProductVariantItem,
  type UpdateProductInput,
  updateProductSchema,
  type UpdateVariantInput,
  updateVariantSchema,
  uuidSchema,
} from "@smart-pos/shared";
import type { Response } from "express";
import { CurrentAuth, RequirePermissions } from "../auth/auth.decorators";
import type { AuthenticatedContext } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { StorageService } from "../common/storage/storage.service";
import { CatalogImportExportService } from "./catalog-import-export.service";
import { ProductsService } from "./products.service";

interface UploadedCatalogFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

@ApiTags("Products")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("products")
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly catalogImportExportService: CatalogImportExportService,
    private readonly storageService: StorageService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @ApiOperation({ summary: "List paginated products/variants with optional branch stock & low-stock filter" })
  async list(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(catalogListQuerySchema))
    query: CatalogListQuery,
  ): Promise<CatalogListResponse> {
    return this.productsService.listProducts(auth, query);
  }

  @Get("export")
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @ApiOperation({ summary: "Export tenant product catalog as CSV or XLSX" })
  async exportCatalog(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(exportFormatQuerySchema))
    query: ExportFormatQuery,
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.catalogImportExportService.exportCatalog(
      auth,
      query.format,
    );
    this.sendSpreadsheet(res, buffer, `smart-pos-catalog.${query.format}`, query.format);
  }

  @Get("import-template")
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: "Download Excel/CSV import template" })
  async downloadTemplate(
    @Query(new ZodValidationPipe(exportFormatQuerySchema))
    query: ExportFormatQuery,
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.catalogImportExportService.generateTemplate(
      query.format,
    );
    this.sendSpreadsheet(
      res,
      buffer,
      `smart-pos-import-template.${query.format}`,
      query.format,
    );
  }

  @Post("upload-url")
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: "Generate presigned WebP/image upload URL for R2/S3" })
  async createUploadUrl(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(presignProductImageSchema))
    body: PresignProductImageInput,
  ): Promise<PresignedUploadResponse> {
    return this.storageService.presignProductImageUpload(auth.tenantId, body);
  }

  @Post("import")
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  @ApiOperation({ summary: "Import products and variants from Excel (.xlsx) or CSV" })
  async importCatalog(
    @CurrentAuth() auth: AuthenticatedContext,
    @UploadedFile() file: UploadedCatalogFile | undefined,
  ): Promise<CatalogImportResponse> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Vui lòng tải lên tệp .xlsx hoặc .csv hợp lệ",
      });
    }
    return this.catalogImportExportService.importCatalog(auth, file);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @ApiOperation({ summary: "Get single product details and variants" })
  async getOne(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) productId: string,
    @Query("branchId", new ZodValidationPipe(uuidSchema.optional()))
    branchId?: string,
  ): Promise<ProductItem> {
    return this.productsService.getProduct(auth, productId, branchId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: "Create product with one or more SKU variants" })
  async create(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createProductSchema))
    body: CreateProductInput,
  ): Promise<ProductItem> {
    return this.productsService.createProduct(auth, body);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: "Update product metadata" })
  async update(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) productId: string,
    @Body(new ZodValidationPipe(updateProductSchema))
    body: UpdateProductInput,
  ): Promise<ProductItem> {
    return this.productsService.updateProduct(auth, productId, body);
  }

  @Post(":id/variants")
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: "Add a new SKU variant to an existing product" })
  async addVariant(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) productId: string,
    @Body(new ZodValidationPipe(productVariantInputSchema))
    body: ProductVariantInput,
  ): Promise<ProductVariantItem> {
    return this.productsService.addVariant(auth, productId, body);
  }

  @Patch(":id/variants/:variantId")
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: "Update variant pricing, barcode, unit, or alert threshold" })
  async updateVariant(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) productId: string,
    @Param("variantId", new ZodValidationPipe(uuidSchema)) variantId: string,
    @Body(new ZodValidationPipe(updateVariantSchema))
    body: UpdateVariantInput,
  ): Promise<ProductVariantItem> {
    return this.productsService.updateVariant(
      auth,
      productId,
      variantId,
      body,
    );
  }

  private sendSpreadsheet(
    res: Response,
    buffer: Buffer,
    fileName: string,
    format: "csv" | "xlsx",
  ): void {
    const contentType =
      format === "csv"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(buffer);
  }
}
