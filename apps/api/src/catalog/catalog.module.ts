import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { StorageModule } from "../common/storage/storage.module";
import { CatalogImportExportService } from "./catalog-import-export.service";
import { CategoriesController } from "./categories.controller";
import { CategoriesService } from "./categories.service";
import { ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [CategoriesController, ProductsController],
  providers: [CategoriesService, ProductsService, CatalogImportExportService],
  exports: [CategoriesService, ProductsService],
})
export class CatalogModule {}
