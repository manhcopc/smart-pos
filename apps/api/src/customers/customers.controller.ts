import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type AdjustCustomerLoyaltyInput,
  adjustCustomerLoyaltySchema,
  type CreateCustomerInput,
  createCustomerSchema,
  type CustomerDetailResponse,
  type CustomerItem,
  type CustomerQuery,
  customerQuerySchema,
  PERMISSIONS,
  type UpdateCustomerInput,
  updateCustomerSchema,
  uuidSchema,
} from "@smart-pos/shared";
import type { Request } from "express";
import { CurrentAuth, RequirePermissions } from "../auth/auth.decorators";
import type { AuthenticatedContext } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { extractRequestMeta } from "../common/http/request-meta";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CustomersService } from "./customers.service";

@ApiTags("Customers (CRM & Loyalty)")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("customers")
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMER_VIEW)
  @ApiOperation({ summary: "Search and list customers with loyalty balances" })
  async list(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(customerQuerySchema)) query: CustomerQuery,
  ) {
    return this.customersService.listCustomers(auth, query);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.CUSTOMER_VIEW)
  @ApiOperation({ summary: "Get customer profile and recent purchase history" })
  async detail(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) customerId: string,
  ): Promise<CustomerDetailResponse> {
    return this.customersService.getCustomerDetail(auth, customerId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMER_VIEW)
  @ApiOperation({ summary: "Create or quick-add customer profile (allowed from POS & Dashboard)" })
  async create(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createCustomerSchema)) body: CreateCustomerInput,
  ): Promise<CustomerItem> {
    return this.customersService.createCustomer(auth, body);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.CUSTOMER_MANAGE)
  @ApiOperation({ summary: "Update customer contact information" })
  async update(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) customerId: string,
    @Body(new ZodValidationPipe(updateCustomerSchema)) body: UpdateCustomerInput,
  ): Promise<CustomerItem> {
    return this.customersService.updateCustomer(auth, customerId, body);
  }

  @Post(":id/loyalty-adjust")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.CUSTOMER_MANAGE)
  @ApiOperation({ summary: "Adjust customer loyalty points atomically with AuditLog" })
  async adjustLoyalty(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) customerId: string,
    @Body(new ZodValidationPipe(adjustCustomerLoyaltySchema))
    body: AdjustCustomerLoyaltyInput,
    @Req() req: Request,
  ): Promise<CustomerItem> {
    return this.customersService.adjustLoyaltyPoints(
      auth,
      customerId,
      body,
      extractRequestMeta(req),
    );
  }
}
