import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditLogsController } from "./audit-logs.controller";
import { AuditLogsService } from "./audit-logs.service";
import { ReportExportsService } from "./report-exports.service";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

@Module({
  imports: [AuthModule],
  controllers: [ReportsController, AuditLogsController],
  providers: [ReportsService, ReportExportsService, AuditLogsService],
  exports: [ReportsService, ReportExportsService, AuditLogsService],
})
export class ReportsModule {}
