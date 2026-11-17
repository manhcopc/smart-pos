import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type CreateSupplierInput,
  createSupplierSchema,
  PERMISSIONS,
  type SupplierItem,
  type UpdateSupplierInput,
  updateSupplierSchema,
  uuidSchema,
} from "@smart-pos/shared";
import { CurrentAuth, RequirePermissions } from "../auth/auth.decorators";
import type { AuthenticatedContext } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { SuppliersService } from "./suppliers.service";

@ApiTags("Suppliers")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("suppliers")
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @ApiOperation({ summary: "List suppliers and payable debt balance" })
  async list(
    @CurrentAuth() auth: AuthenticatedContext,
  ): Promise<SupplierItem[]> {
    return this.suppliersService.list(auth);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.INVENTORY_RECEIVE)
  @ApiOperation({ summary: "Create a supplier" })
  async create(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createSupplierSchema))
    body: CreateSupplierInput,
  ): Promise<SupplierItem> {
    return this.suppliersService.create(auth, body);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.INVENTORY_RECEIVE)
  @ApiOperation({ summary: "Update supplier profile" })
  async update(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) supplierId: string,
    @Body(new ZodValidationPipe(updateSupplierSchema))
    body: UpdateSupplierInput,
  ): Promise<SupplierItem> {
    return this.suppliersService.update(auth, supplierId, body);
  }
}
