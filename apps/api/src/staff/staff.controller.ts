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
  type CreateStaffMemberInput,
  createStaffMemberSchema,
  PERMISSIONS,
  type StaffListResponse,
  type StaffMemberItem,
  type UpdateStaffMemberInput,
  updateStaffMemberSchema,
  uuidSchema,
} from "@smart-pos/shared";
import type { Request } from "express";
import { CurrentAuth, RequirePermissions } from "../auth/auth.decorators";
import type { AuthenticatedContext } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { extractRequestMeta } from "../common/http/request-meta";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { StaffService } from "./staff.service";

@ApiTags("Staff")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.STAFF_MANAGE)
@Controller("staff")
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  @ApiOperation({ summary: "List all staff members in current tenant" })
  async list(
    @CurrentAuth() auth: AuthenticatedContext,
  ): Promise<StaffListResponse> {
    return this.staffService.listStaff(auth);
  }

  @Post()
  @ApiOperation({ summary: "Create staff member (email+password and/or cashier PIN)" })
  async create(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createStaffMemberSchema))
    body: CreateStaffMemberInput,
    @Req() req: Request,
  ): Promise<StaffMemberItem> {
    return this.staffService.createStaffMember(
      auth,
      body,
      extractRequestMeta(req),
    );
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update staff member role, PIN, branch assignments, permissions, or active state" })
  async update(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) memberId: string,
    @Body(new ZodValidationPipe(updateStaffMemberSchema))
    body: UpdateStaffMemberInput,
    @Req() req: Request,
  ): Promise<StaffMemberItem> {
    return this.staffService.updateStaffMember(
      auth,
      memberId,
      body,
      extractRequestMeta(req),
    );
  }
}
