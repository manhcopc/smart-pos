import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  type AccountingExportQuery,
  type CreateReportExportInput,
  ERROR_CODES,
  type ReportExportJobItem,
  type ReportExportListQuery,
  type ReportExportType,
  uuidSchema,
} from "@smart-pos/shared";
import ExcelJS from "exceljs";
import type { AuthenticatedContext } from "../auth/auth.types";
import { assertBranchAccessibleInTx } from "../common/tenant/tenant-quota.helper";
import {
  BullMqJobsService,
  type ReportExportJobPayload,
} from "../jobs/bullmq-jobs.service";
import { PrismaService } from "../prisma/prisma.service";

const EXPORT_ROOT_DIR = "/tmp/smart-pos-exports";
const FORMULA_PREFIX_REGEX = /^[=+\-@\t\r]/;

const EXPORT_JOB_SELECT = {
  id: true,
  reportType: true,
  status: true,
  fileName: true,
  rowCount: true,
  errorMessage: true,
  createdAt: true,
  completedAt: true,
  requestedByMember: { select: { user: { select: { fullName: true } } } },
} satisfies Prisma.ReportExportJobSelect;

type ExportJobRow = Prisma.ReportExportJobGetPayload<{
  select: typeof EXPORT_JOB_SELECT;
}>;

function neutralizeCell(value: string): string {
  return FORMULA_PREFIX_REGEX.test(value) ? `'${value}` : value;
}

function defaultExportFileName(reportType: ReportExportType): string {
  const stamp = new Date(Date.now() + 7 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const slug = reportType.toLowerCase().replaceAll("_", "-");
  return `smartpos-${slug}-${stamp}-${crypto.randomBytes(2).toString("hex")}.xlsx`;
}

export interface ReportExportFilters {
  branchId?: string | null;
  from?: string | null;
  to?: string | null;
  allowedBranchIds?: string[];
}

function buildCreatedAtRange(from?: string | null, to?: string | null) {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: new Date(`${from}T00:00:00+07:00`) } : {}),
    ...(to ? { lte: new Date(`${to}T23:59:59.999+07:00`) } : {}),
  };
}

function resolveBranchFilter(filters: ReportExportFilters) {
  if (filters.branchId) return filters.branchId;
  if (filters.allowedBranchIds && filters.allowedBranchIds.length > 0) {
    return { in: filters.allowedBranchIds };
  }
  return undefined;
}

@Injectable()
export class ReportExportsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly bullMqJobs?: BullMqJobsService,
  ) {}

  onModuleInit(): void {
    this.bullMqJobs?.registerReportExportProcessor((payload) =>
      this.processExportJob(payload),
    );
  }

  async enqueueExport(
    auth: AuthenticatedContext,
    input: CreateReportExportInput,
  ): Promise<ReportExportJobItem> {
    const created = await this.prisma.withTenantTransaction(
      auth.tenantId,
      async (tx) => {
        if (input.branchId) {
          await assertBranchAccessibleInTx(tx, auth, input.branchId);
        }

        const row = await tx.reportExportJob.create({
          data: {
            tenantId: auth.tenantId,
            requestedByMemberId: auth.memberId,
            reportType: input.reportType,
            status: "PENDING",
            filters: {
              branchId: input.branchId ?? null,
              from: input.from ?? null,
              to: input.to ?? null,
              allowedBranchIds: auth.allowedBranchIds,
            },
            fileName: defaultExportFileName(input.reportType),
          },
          select: EXPORT_JOB_SELECT,
        });

        return this.serializeJob(row);
      },
    );

    if (this.bullMqJobs) {
      await this.bullMqJobs.enqueueReportExport({
        tenantId: auth.tenantId,
        exportJobId: created.id,
      });
    } else {
      await this.processExportJob({
        tenantId: auth.tenantId,
        exportJobId: created.id,
      });
    }

    return this.getJobById(auth, created.id);
  }

  async listExports(
    auth: AuthenticatedContext,
    query: ReportExportListQuery,
  ): Promise<{
    items: ReportExportJobItem[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const skip = (query.page - 1) * query.limit;
      const [total, rows] = await Promise.all([
        tx.reportExportJob.count(),
        tx.reportExportJob.findMany({
          select: EXPORT_JOB_SELECT,
          orderBy: { createdAt: "desc" },
          skip,
          take: query.limit,
        }),
      ]);

      return {
        items: rows.map((r) => this.serializeJob(r)),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.limit)),
        },
      };
    });
  }

  async getJobById(
    auth: AuthenticatedContext,
    exportJobId: string,
  ): Promise<ReportExportJobItem> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const row = await tx.reportExportJob.findFirst({
        where: { id: exportJobId },
        select: EXPORT_JOB_SELECT,
      });
      if (!row) {
        throw new NotFoundException({
          code: ERROR_CODES.EXPORT_JOB_NOT_FOUND,
          message: "Không tìm thấy yêu cầu xuất báo cáo",
        });
      }
      return this.serializeJob(row);
    });
  }

  async getDownloadFile(
    auth: AuthenticatedContext,
    exportJobId: string,
  ): Promise<{ fileName: string; buffer: Buffer }> {
    const parsedTenantId = uuidSchema.parse(auth.tenantId);
    const parsedJobId = uuidSchema.parse(exportJobId);

    const jobMeta = await this.prisma.withTenantTransaction(
      parsedTenantId,
      async (tx) => {
        const row = await tx.reportExportJob.findFirst({
          where: { id: parsedJobId },
          select: {
            id: true,
            status: true,
            fileName: true,
            storageKey: true,
          },
        });
        if (!row) {
          throw new NotFoundException({
            code: ERROR_CODES.EXPORT_JOB_NOT_FOUND,
            message: "Không tìm thấy yêu cầu xuất báo cáo",
          });
        }
        if (row.status !== "COMPLETED" || !row.storageKey) {
          throw new ConflictException({
            code: ERROR_CODES.EXPORT_FILE_NOT_READY,
            message: "Tệp báo cáo chưa sẵn sàng hoặc đang được xử lý",
          });
        }
        return row;
      },
    );

    const expectedPrefix = path.resolve(EXPORT_ROOT_DIR, parsedTenantId) + path.sep;
    const resolvedPath = path.resolve(jobMeta.storageKey!);
    if (!resolvedPath.startsWith(expectedPrefix)) {
      throw new NotFoundException({
        code: ERROR_CODES.EXPORT_FILE_NOT_READY,
        message: "Đường dẫn tệp báo cáo không hợp lệ",
      });
    }

    const buffer = await fs.readFile(resolvedPath);
    return { fileName: jobMeta.fileName, buffer };
  }

  async exportAccountingWorkbookDirect(
    auth: AuthenticatedContext,
    query: AccountingExportQuery,
  ): Promise<{ fileName: string; buffer: Buffer; rowCount: number }> {
    const filters: ReportExportFilters = {
      branchId: query.branchId ?? null,
      from: query.from ?? null,
      to: query.to ?? null,
      allowedBranchIds: auth.allowedBranchIds,
    };
    if (query.branchId) {
      await this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
        await assertBranchAccessibleInTx(tx, auth, query.branchId!);
      });
    }
    const { buffer, rowCount } = await this.buildAccountingWorkbookBuffer(
      auth.tenantId,
      filters,
    );
    return {
      fileName: defaultExportFileName("ACCOUNTING_LEDGER"),
      buffer,
      rowCount,
    };
  }

  async buildAccountingWorkbookBuffer(
    tenantId: string,
    filters: ReportExportFilters,
  ): Promise<{ buffer: Buffer; rowCount: number }> {
    const branchFilter = resolveBranchFilter(filters);
    const createdAtRange = buildCreatedAtRange(filters.from, filters.to);
    const summaryDateRange =
      filters.from || filters.to
        ? {
            ...(filters.from
              ? { gte: new Date(`${filters.from}T00:00:00.000Z`) }
              : {}),
            ...(filters.to
              ? { lte: new Date(`${filters.to}T00:00:00.000Z`) }
              : {}),
          }
        : undefined;

    const { invoices, returns, summaries } =
      await this.prisma.withTenantTransaction(tenantId, async (tx) => {
        const [invRows, retRows, sumRows] = await Promise.all([
          tx.invoice.findMany({
            where: {
              ...(branchFilter !== undefined ? { branchId: branchFilter } : {}),
              ...(createdAtRange ? { createdAt: createdAtRange } : {}),
            },
            select: {
              code: true,
              status: true,
              subtotal: true,
              discountAmount: true,
              taxAmount: true,
              totalAmount: true,
              cogsAmount: true,
              createdAt: true,
              branch: { select: { name: true } },
              cashierMember: { select: { user: { select: { fullName: true } } } },
              customer: { select: { name: true } },
              payments: { select: { method: true, amount: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 25000,
          }),
          tx.salesReturn.findMany({
            where: {
              ...(branchFilter !== undefined ? { branchId: branchFilter } : {}),
              ...(createdAtRange ? { createdAt: createdAtRange } : {}),
            },
            select: {
              code: true,
              createdAt: true,
              totalRefundAmount: true,
              refundMethod: true,
              reason: true,
              branch: { select: { name: true } },
              invoice: { select: { code: true } },
              processedBy: { select: { user: { select: { fullName: true } } } },
            },
            orderBy: { createdAt: "desc" },
            take: 15000,
          }),
          tx.dailyBranchSummary.findMany({
            where: {
              ...(branchFilter !== undefined ? { branchId: branchFilter } : {}),
              ...(summaryDateRange ? { summaryDate: summaryDateRange } : {}),
            },
            select: {
              summaryDate: true,
              invoiceCount: true,
              grossRevenue: true,
              discountTotal: true,
              refundTotal: true,
              netRevenue: true,
              cogsTotal: true,
              grossProfit: true,
              cashTotal: true,
              transferTotal: true,
              cardTotal: true,
              branch: { select: { name: true } },
            },
            orderBy: { summaryDate: "desc" },
            take: 10000,
          }),
        ]);
        return { invoices: invRows, returns: retRows, summaries: sumRows };
      });

    const workbook = new ExcelJS.Workbook();
    this.populateSalesSheet(workbook, "Hóa đơn & Thuế GTGT", invoices, true);

    const retSheet = workbook.addWorksheet("Trả hàng & Hoàn tiền");
    retSheet.columns = [
      { header: "Mã phiếu trả", key: "code", width: 20 },
      { header: "Thời gian", key: "createdAt", width: 22 },
      { header: "Chi nhánh", key: "branch", width: 22 },
      { header: "Hóa đơn gốc", key: "invoiceCode", width: 20 },
      { header: "Người xử lý", key: "actor", width: 20 },
      { header: "Phương thức hoàn", key: "method", width: 16 },
      { header: "Số tiền hoàn", key: "amount", width: 16 },
      { header: "Lý do", key: "reason", width: 32 },
    ];
    for (const r of returns) {
      retSheet.addRow({
        code: neutralizeCell(r.code),
        createdAt: r.createdAt.toISOString(),
        branch: neutralizeCell(r.branch.name),
        invoiceCode: neutralizeCell(r.invoice.code),
        actor: neutralizeCell(r.processedBy.user.fullName),
        method: r.refundMethod,
        amount: Number(r.totalRefundAmount.toFixed(2)),
        reason: neutralizeCell(r.reason ?? ""),
      });
    }

    this.populateDailySummarySheet(
      workbook,
      "Tổng hợp Kế toán theo ngày",
      summaries,
    );

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      buffer,
      rowCount: invoices.length + returns.length + summaries.length,
    };
  }

  async processExportJob(payload: ReportExportJobPayload): Promise<void> {
    const tenantId = uuidSchema.parse(payload.tenantId);
    const exportJobId = uuidSchema.parse(payload.exportJobId);

    try {
      const jobRecord = await this.prisma.withTenantTransaction(
        tenantId,
        async (tx) => {
          const existing = await tx.reportExportJob.findFirst({
            where: { id: exportJobId },
            select: {
              id: true,
              status: true,
              reportType: true,
              filters: true,
              fileName: true,
            },
          });
          if (!existing) {
            return null;
          }
          await tx.reportExportJob.update({
            where: { id: exportJobId },
            data: { status: "PROCESSING", errorMessage: null },
          });
          return existing;
        },
      );

      if (!jobRecord) return;

      const filters: ReportExportFilters =
        jobRecord.filters &&
        typeof jobRecord.filters === "object" &&
        !Array.isArray(jobRecord.filters)
          ? (jobRecord.filters as ReportExportFilters)
          : {};

      const branchFilter = resolveBranchFilter(filters);
      const createdAtRange = buildCreatedAtRange(filters.from, filters.to);

      let buffer: Buffer;
      let rowCount = 0;

      if (jobRecord.reportType === "ACCOUNTING_LEDGER") {
        const result = await this.buildAccountingWorkbookBuffer(
          tenantId,
          filters,
        );
        buffer = result.buffer;
        rowCount = result.rowCount;
      } else {
        const workbook = new ExcelJS.Workbook();

        if (jobRecord.reportType === "SALES_DETAIL") {
          const rows = await this.prisma.withTenantTransaction(
            tenantId,
            async (tx) =>
              tx.invoice.findMany({
                where: {
                  ...(branchFilter !== undefined ? { branchId: branchFilter } : {}),
                  ...(createdAtRange ? { createdAt: createdAtRange } : {}),
                },
                select: {
                  code: true,
                  status: true,
                  subtotal: true,
                  discountAmount: true,
                  taxAmount: true,
                  totalAmount: true,
                  cogsAmount: true,
                  createdAt: true,
                  branch: { select: { name: true } },
                  cashierMember: {
                    select: { user: { select: { fullName: true } } },
                  },
                  customer: { select: { name: true } },
                },
                orderBy: { createdAt: "desc" },
                take: 25000,
              }),
          );

          this.populateSalesSheet(workbook, "Báo cáo bán hàng", rows, false);
          rowCount = rows.length;
        } else if (jobRecord.reportType === "INVENTORY_LEDGER") {
          const rows = await this.prisma.withTenantTransaction(
            tenantId,
            async (tx) =>
              tx.inventoryLedger.findMany({
                where: {
                  ...(branchFilter !== undefined ? { branchId: branchFilter } : {}),
                  ...(createdAtRange ? { createdAt: createdAtRange } : {}),
                },
                select: {
                  createdAt: true,
                  movementType: true,
                  qtyDelta: true,
                  qtyBefore: true,
                  qtyAfter: true,
                  unitCost: true,
                  note: true,
                  branch: { select: { name: true } },
                  variant: {
                    select: { sku: true, product: { select: { name: true } } },
                  },
                  actorMember: { select: { user: { select: { fullName: true } } } },
                },
                orderBy: { createdAt: "desc" },
                take: 25000,
              }),
          );

          const sheet = workbook.addWorksheet("Thẻ kho chi tiết");
          sheet.columns = [
            { header: "Thời gian", key: "createdAt", width: 22 },
            { header: "Chi nhánh", key: "branch", width: 22 },
            { header: "SKU", key: "sku", width: 18 },
            { header: "Sản phẩm", key: "product", width: 28 },
            { header: "Loại biến động", key: "type", width: 18 },
            { header: "Thay đổi", key: "delta", width: 12 },
            { header: "Tồn trước", key: "before", width: 12 },
            { header: "Tồn sau", key: "after", width: 12 },
            { header: "Đơn giá vốn", key: "unitCost", width: 15 },
            { header: "Người thực hiện", key: "actor", width: 20 },
            { header: "Ghi chú", key: "note", width: 32 },
          ];
          for (const r of rows) {
            sheet.addRow({
              createdAt: r.createdAt.toISOString(),
              branch: neutralizeCell(r.branch.name),
              sku: neutralizeCell(r.variant.sku),
              product: neutralizeCell(r.variant.product.name),
              type: r.movementType,
              delta: Number(r.qtyDelta.toFixed(3)),
              before: Number(r.qtyBefore.toFixed(3)),
              after: Number(r.qtyAfter.toFixed(3)),
              unitCost: Number(r.unitCost.toFixed(2)),
              actor: neutralizeCell(r.actorMember.user.fullName),
              note: neutralizeCell(r.note ?? ""),
            });
          }
          rowCount = rows.length;
        } else {
          const rows = await this.prisma.withTenantTransaction(
            tenantId,
            async (tx) =>
              tx.dailyBranchSummary.findMany({
                where: {
                  ...(branchFilter !== undefined ? { branchId: branchFilter } : {}),
                  ...(filters.from || filters.to
                    ? {
                        summaryDate: {
                          ...(filters.from
                            ? { gte: new Date(`${filters.from}T00:00:00.000Z`) }
                            : {}),
                          ...(filters.to
                            ? { lte: new Date(`${filters.to}T00:00:00.000Z`) }
                            : {}),
                        },
                      }
                    : {}),
                },
                select: {
                  summaryDate: true,
                  invoiceCount: true,
                  grossRevenue: true,
                  discountTotal: true,
                  refundTotal: true,
                  netRevenue: true,
                  cogsTotal: true,
                  grossProfit: true,
                  cashTotal: true,
                  transferTotal: true,
                  cardTotal: true,
                  branch: { select: { name: true } },
                },
                orderBy: { summaryDate: "desc" },
                take: 10000,
              }),
          );

          this.populateDailySummarySheet(workbook, "Tổng hợp theo ngày", rows);
          rowCount = rows.length;
        }

        buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      }

      const tenantDir = path.resolve(EXPORT_ROOT_DIR, tenantId);
      await fs.mkdir(tenantDir, { recursive: true });
      const filePath = path.resolve(tenantDir, `${exportJobId}.xlsx`);
      await fs.writeFile(filePath, buffer);

      await this.prisma.withTenantTransaction(tenantId, async (tx) => {
        await tx.reportExportJob.update({
          where: { id: exportJobId },
          data: {
            status: "COMPLETED",
            storageKey: filePath,
            rowCount,
            completedAt: new Date(),
          },
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Export failed";
      await this.prisma
        .withTenantTransaction(tenantId, async (tx) => {
          await tx.reportExportJob.update({
            where: { id: exportJobId },
            data: { status: "FAILED", errorMessage: msg.slice(0, 500) },
          });
        })
        .catch(() => undefined);
    }
  }

  private populateSalesSheet(
    workbook: ExcelJS.Workbook,
    sheetName: string,
    rows: Array<{
      code: string;
      status: string;
      subtotal: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      totalAmount: Prisma.Decimal;
      cogsAmount: Prisma.Decimal;
      createdAt: Date;
      branch: { name: string };
      cashierMember: { user: { fullName: string } };
      customer: { name: string } | null;
      payments?: Array<{ method: string; amount: Prisma.Decimal }>;
    }>,
    includePayments: boolean,
  ): void {
    const sheet = workbook.addWorksheet(sheetName);
    const cols: Partial<ExcelJS.Column>[] = [
      { header: "Mã hóa đơn", key: "code", width: 20 },
      { header: "Thời gian", key: "createdAt", width: 22 },
      { header: "Chi nhánh", key: "branch", width: 22 },
      { header: "Thu ngân", key: "cashier", width: 20 },
      { header: "Khách hàng", key: "customer", width: 20 },
      { header: "Trạng thái", key: "status", width: 16 },
      { header: "Tạm tính", key: "subtotal", width: 16 },
      { header: "Chiết khấu", key: "discount", width: 16 },
      { header: "VAT", key: "tax", width: 14 },
      { header: "Thành tiền", key: "total", width: 16 },
      { header: "Giá vốn", key: "cogs", width: 16 },
    ];
    if (includePayments) {
      cols.push({ header: "Hình thức thanh toán", key: "payments", width: 28 });
    }
    sheet.columns = cols;

    for (const r of rows) {
      sheet.addRow({
        code: neutralizeCell(r.code),
        createdAt: r.createdAt.toISOString(),
        branch: neutralizeCell(r.branch.name),
        cashier: neutralizeCell(r.cashierMember.user.fullName),
        customer: neutralizeCell(r.customer?.name ?? "Khách lẻ"),
        status: r.status,
        subtotal: Number(r.subtotal.toFixed(2)),
        discount: Number(r.discountAmount.toFixed(2)),
        tax: Number(r.taxAmount.toFixed(2)),
        total: Number(r.totalAmount.toFixed(2)),
        cogs: Number(r.cogsAmount.toFixed(2)),
        ...(includePayments
          ? {
              payments: neutralizeCell(
                (r.payments ?? [])
                  .map((p) => `${p.method}:${p.amount.toFixed(0)}`)
                  .join("; "),
              ),
            }
          : {}),
      });
    }
  }

  private populateDailySummarySheet(
    workbook: ExcelJS.Workbook,
    sheetName: string,
    rows: Array<{
      summaryDate: Date;
      invoiceCount: number;
      grossRevenue: Prisma.Decimal;
      discountTotal: Prisma.Decimal;
      refundTotal: Prisma.Decimal;
      netRevenue: Prisma.Decimal;
      cogsTotal: Prisma.Decimal;
      grossProfit: Prisma.Decimal;
      cashTotal: Prisma.Decimal;
      transferTotal: Prisma.Decimal;
      cardTotal: Prisma.Decimal;
      branch: { name: string };
    }>,
  ): void {
    const sheet = workbook.addWorksheet(sheetName);
    sheet.columns = [
      { header: "Ngày", key: "date", width: 14 },
      { header: "Chi nhánh", key: "branch", width: 22 },
      { header: "Số đơn", key: "count", width: 10 },
      { header: "Tổng bán", key: "gross", width: 16 },
      { header: "Chiết khấu", key: "discount", width: 16 },
      { header: "Hoàn trả", key: "refund", width: 16 },
      { header: "Doanh thu thuần", key: "net", width: 18 },
      { header: "Giá vốn", key: "cogs", width: 16 },
      { header: "Lãi gộp", key: "profit", width: 16 },
      { header: "Tiền mặt", key: "cash", width: 16 },
      { header: "Chuyển khoản QR", key: "transfer", width: 16 },
      { header: "Thẻ", key: "card", width: 16 },
    ];
    for (const r of rows) {
      sheet.addRow({
        date: r.summaryDate.toISOString().slice(0, 10),
        branch: neutralizeCell(r.branch.name),
        count: r.invoiceCount,
        gross: Number(r.grossRevenue.toFixed(2)),
        discount: Number(r.discountTotal.toFixed(2)),
        refund: Number(r.refundTotal.toFixed(2)),
        net: Number(r.netRevenue.toFixed(2)),
        cogs: Number(r.cogsTotal.toFixed(2)),
        profit: Number(r.grossProfit.toFixed(2)),
        cash: Number(r.cashTotal.toFixed(2)),
        transfer: Number(r.transferTotal.toFixed(2)),
        card: Number(r.cardTotal.toFixed(2)),
      });
    }
  }

  private serializeJob(row: ExportJobRow): ReportExportJobItem {
    return {
      id: row.id,
      reportType: row.reportType,
      status: row.status,
      fileName: row.fileName,
      rowCount: row.rowCount,
      errorMessage: row.errorMessage,
      requestedByName: row.requestedByMember.user.fullName,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    };
  }
}
