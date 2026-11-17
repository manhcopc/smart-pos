import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type CreateReportExportInput,
  createReportExportSchema,
  PERMISSIONS,
  type ReportExportJobItem,
  type ReportExportListQuery,
  reportExportListQuerySchema,
  type ReportOverviewQuery,
  reportOverviewQuerySchema,
  type ReportOverviewResponse,
  uuidSchema,
} from "@smart-pos/shared";
import type { Response } from "express";
import { CurrentAuth, RequirePermissions } from "../auth/auth.decorators";
import type { AuthenticatedContext } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { ReportExportsService } from "./report-exports.service";
import { ReportsService } from "./reports.service";

@ApiTags("Reports & Background Exports")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("reports")
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly reportExportsService: ReportExportsService,
  ) {}

  @Get("overview")
  @RequirePermissions(PERMISSIONS.REPORT_FINANCIAL)
  @ApiOperation({ summary: "Get financial KPIs from daily_branch_summaries, top SKUs, and low stock alerts" })
  async getOverview(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(reportOverviewQuerySchema))
    query: ReportOverviewQuery,
  ): Promise<ReportOverviewResponse> {
    return this.reportsService.getOverview(auth, query);
  }

  @Get("exports")
  @RequirePermissions(PERMISSIONS.REPORT_FINANCIAL)
  @ApiOperation({ summary: "List BullMQ background Excel export jobs for current tenant" })
  async listExports(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(reportExportListQuerySchema))
    query: ReportExportListQuery,
  ) {
    return this.reportExportsService.listExports(auth, query);
  }

  @Post("exports")
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(PERMISSIONS.REPORT_FINANCIAL)
  @ApiOperation({ summary: "Enqueue a heavy multi-sheet Excel report export on BullMQ" })
  async createExport(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createReportExportSchema))
    body: CreateReportExportInput,
  ): Promise<ReportExportJobItem> {
    return this.reportExportsService.enqueueExport(auth, body);
  }

  @Get("exports/:id/download")
  @RequirePermissions(PERMISSIONS.REPORT_FINANCIAL)
  @ApiOperation({ summary: "Download completed Excel export workbook (tenant-isolated)" })
  async downloadExport(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", new ZodValidationPipe(uuidSchema)) exportJobId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { fileName, buffer } = await this.reportExportsService.getDownloadFile(
      auth,
      exportJobId,
    );
    const safeName = fileName.replace(/[^A-Za-z0-9._-]/g, "_");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.setHeader("Content-Length", String(buffer.length));
    res.send(buffer);
  }
}
