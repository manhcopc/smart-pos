import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type CategoryItem,
  type CreateCategoryInput,
  createCategorySchema,
  PERMISSIONS,
  type UpdateCategoryInput,
  updateCategorySchema,
  uuidSchema,
} from "@smart-pos/shared";
import { CurrentAuth, RequirePermissions } from "../auth/auth.decorators";
import type { AuthenticatedContext } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CategoriesService } from "./categories.service";

@ApiTags("Categories")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("categories")
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @ApiOperation({ summary: "List all product categories in tenant" })
  async list(
    @CurrentAuth() auth: AuthenticatedContext,
  ): Promise<CategoryItem[]> {
    return this.categoriesService.list(auth);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: "Create a product category" })
  async create(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createCategorySchema))
    body: CreateCategoryInput,
  ): Promise<CategoryItem> {
    return this.categoriesService.create(auth, body);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: "Update category name, parent, or sort order" })
  async update(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) categoryId: string,
    @Body(new ZodValidationPipe(updateCategorySchema))
    body: UpdateCategoryInput,
  ): Promise<CategoryItem> {
    return this.categoriesService.update(auth, categoryId, body);
  }

  @Delete(":id")
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: "Delete a product category (detaches products safely)" })
  async remove(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) categoryId: string,
  ): Promise<{ success: true }> {
    return this.categoriesService.remove(auth, categoryId);
  }
}
