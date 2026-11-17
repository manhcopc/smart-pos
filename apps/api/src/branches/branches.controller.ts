import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type BranchItem,
  type BranchListResponse,
  type CreateBranchInput,
  createBranchSchema,
  PERMISSIONS,
  type UpdateBranchInput,
  updateBranchSchema,
  uuidSchema,
} from "@smart-pos/shared";
import type { Request } from "express";
import { CurrentAuth, RequirePermissions } from "../auth/auth.decorators";
import type { AuthenticatedContext } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { extractRequestMeta } from "../common/http/request-meta";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { BranchesService } from "./branches.service";

@ApiTags("Branches")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("branches")
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @ApiOperation({ summary: "List branches visible to current tenant member" })
  async list(
    @CurrentAuth() auth: AuthenticatedContext,
  ): Promise<BranchListResponse> {
    return this.branchesService.listBranches(auth);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.BRANCH_MANAGE)
  @ApiOperation({ summary: "Create a new branch within subscription plan quota" })
  async create(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createBranchSchema)) body: CreateBranchInput,
    @Req() req: Request,
  ): Promise<BranchItem> {
    return this.branchesService.createBranch(
      auth,
      body,
      extractRequestMeta(req),
    );
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.BRANCH_MANAGE)
  @ApiOperation({ summary: "Update branch details, default flag, or active state" })
  async update(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) branchId: string,
    @Body(new ZodValidationPipe(updateBranchSchema)) body: UpdateBranchInput,
    @Req() req: Request,
  ): Promise<BranchItem> {
    return this.branchesService.updateBranch(
      auth,
      branchId,
      body,
      extractRequestMeta(req),
    );
  }
}
