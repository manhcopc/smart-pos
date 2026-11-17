"use client";

import {
  REPORT_EXPORT_TYPES,
  type ReportExportJobItem,
  type ReportExportType,
} from "@smart-pos/shared";
import {
  AlertCircleIcon,
  BarChart3Icon,
  DownloadIcon,
  FileSpreadsheetIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMe } from "@/hooks/use-auth";
import {
  getReportExportDownloadUrl,
  useCreateReportExport,
  useReportExports,
  useReportOverview,
} from "@/hooks/use-reports";
import { formatApiError } from "@/lib/api-client";
import {
  EXPORT_JOB_STATUS_LABELS,
  formatVndAmount,
  REPORT_EXPORT_TYPE_LABELS,
} from "@/lib/labels";

function defaultDateRange() {
  const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const to = vnNow.toISOString().slice(0, 10);
  const vnFrom = new Date(vnNow.getTime() - 29 * 24 * 60 * 60 * 1000);
  const from = vnFrom.toISOString().slice(0, 10);
  return { from, to };
}

export default function ReportsPage() {
  const { data: profile } = useMe();
  const initialRange = defaultDateRange();
  const [branchId, setBranchId] = useState<string>("ALL");
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [exportType, setExportType] =
    useState<ReportExportType>("SALES_DETAIL");

  const filterParams = {
    ...(branchId !== "ALL" ? { branchId } : {}),
    from,
    to,
  };

  const overviewQuery = useReportOverview(filterParams, Boolean(profile));
  const exportsQuery = useReportExports(Boolean(profile));
  const createExportMutation = useCreateReportExport();

  const overview = overviewQuery.data;
  const maxDailyNet = Math.max(
    1,
    ...(overview?.dailySeries.map((d) => Math.abs(Number(d.netRevenue))) ?? [1]),
  );

  async function handleEnqueueExport(reportType: ReportExportType) {
    try {
      const job = await createExportMutation.mutateAsync({
        reportType,
        ...(branchId !== "ALL" ? { branchId } : {}),
        from,
        to,
      });
      toast.success(
        `Đã đưa báo cáo "${REPORT_EXPORT_TYPE_LABELS[reportType]}" vào hàng đợi BullMQ (${job.fileName})`,
      );
    } catch (error) {
      toast.error(formatApiError(error, "Không thể tạo tác vụ xuất Excel."));
    }
  }

  async function handleDownload(job: ReportExportJobItem) {
    try {
      const response = await fetch(getReportExportDownloadUrl(job.id), {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = job.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(formatApiError(error, "Không thể tải file Excel."));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            Báo cáo Doanh thu &amp; Xuất Excel nền (BullMQ)
          </h1>
          <p className="text-sm text-muted-foreground">
            Tổng hợp tức thì từ bảng daily_branch_summaries và xuất file XLSX dung
            lượng lớn không chặn phiên làm việc.
          </p>
        </div>
      </header>

      <Card>
        <CardContent className="grid gap-3 pt-4 sm:grid-cols-4">
          <Field>
            <FieldLabel htmlFor="rep-branch">Chi nhánh</FieldLabel>
            <Select
              value={branchId}
              onValueChange={(v) => {
                if (v) setBranchId(v);
              }}
            >
              <SelectTrigger id="rep-branch">
                <SelectValue>
                  {branchId === "ALL"
                    ? "Tất cả chi nhánh"
                    : profile?.branches.find((b) => b.id === branchId)?.name ??
                      "Chi nhánh"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="ALL">Tất cả chi nhánh</SelectItem>
                  {(profile?.branches ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.code} · {b.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="rep-from">Từ ngày</FieldLabel>
            <Input
              id="rep-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="rep-to">Đến ngày</FieldLabel>
            <Input
              id="rep-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="rep-export-type">Loại báo cáo Excel</FieldLabel>
            <div className="flex gap-2">
              <Select
                value={exportType}
                onValueChange={(v) => {
                  if (v) setExportType(v as ReportExportType);
                }}
              >
                <SelectTrigger id="rep-export-type" className="flex-1">
                  <SelectValue>
                    {REPORT_EXPORT_TYPE_LABELS[exportType]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {REPORT_EXPORT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {REPORT_EXPORT_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button
                type="button"
                disabled={createExportMutation.isPending}
                onClick={() => void handleEnqueueExport(exportType)}
              >
                <FileSpreadsheetIcon data-icon="inline-start" />
                Xuất XLSX
              </Button>
            </div>
          </Field>
        </CardContent>
      </Card>

      {overviewQuery.isError ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Không thể tải báo cáo</AlertTitle>
          <AlertDescription>
            {formatApiError(overviewQuery.error)}
          </AlertDescription>
        </Alert>
      ) : null}

      {overview ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Doanh thu thuần
                </CardTitle>
              </CardHeader>
              <CardContent className="font-mono text-xl font-semibold">
                {formatVndAmount(overview.kpis.netRevenue)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Giá vốn (COGS)
                </CardTitle>
              </CardHeader>
              <CardContent className="font-mono text-xl font-semibold">
                {formatVndAmount(overview.kpis.cogsTotal)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Lợi nhuận gộp
                </CardTitle>
              </CardHeader>
              <CardContent className="font-mono text-xl font-semibold text-primary">
                {formatVndAmount(overview.kpis.grossProfit)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Hoàn trả / Chiết khấu
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-0.5 text-sm">
                <span className="font-mono font-semibold text-destructive">
                  Hoàn: {formatVndAmount(overview.kpis.refundTotal)}
                </span>
                <span className="font-mono text-muted-foreground">
                  CK: {formatVndAmount(overview.kpis.discountTotal)}
                </span>
              </CardContent>
            </Card>
          </section>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3Icon className="size-4 text-primary" />
                Diễn biến doanh thu &amp; lợi nhuận theo ngày
              </CardTitle>
              <CardDescription>
                Tiền mặt: {formatVndAmount(overview.kpis.cashTotal)} · Chuyển
                khoản QR: {formatVndAmount(overview.kpis.transferTotal)} · Thẻ:{" "}
                {formatVndAmount(overview.kpis.cardTotal)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {overview.dailySeries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Chưa có dữ liệu tổng hợp trong khoảng ngày đã chọn.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {overview.dailySeries.map((day) => {
                    const widthPct = Math.min(
                      100,
                      Math.round(
                        (Math.abs(Number(day.netRevenue)) / maxDailyNet) * 100,
                      ),
                    );
                    return (
                      <div
                        key={day.date}
                        className="grid items-center gap-3 text-xs sm:grid-cols-[100px_1fr_200px]"
                      >
                        <span className="font-mono text-muted-foreground">
                          {day.date}
                        </span>
                        <div className="h-3 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.max(widthPct, 2)}%` }}
                          />
                        </div>
                        <span className="text-right font-mono">
                          DT: {formatVndAmount(day.netRevenue)} · LG:{" "}
                          {formatVndAmount(day.grossProfit)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Hàng đợi Xuất Báo cáo Excel (BullMQ Worker)
          </CardTitle>
          <CardDescription>
            Tự động cập nhật tiến trình chạy nền; nhấn Tải về khi hoàn tất.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {(exportsQuery.data?.items ?? []).map((job) => (
            <div
              key={job.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
            >
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {REPORT_EXPORT_TYPE_LABELS[job.reportType]}
                  </span>
                  <Badge
                    variant={
                      job.status === "COMPLETED"
                        ? "default"
                        : job.status === "FAILED"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {EXPORT_JOB_STATUS_LABELS[job.status]}
                  </Badge>
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {job.fileName} · {job.rowCount} dòng · Người tạo:{" "}
                  {job.requestedByName}
                </span>
                {job.errorMessage ? (
                  <span className="text-xs text-destructive">
                    {job.errorMessage}
                  </span>
                ) : null}
              </div>

              {job.status === "COMPLETED" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleDownload(job)}
                >
                  <DownloadIcon data-icon="inline-start" />
                  Tải Excel
                </Button>
              ) : null}
            </div>
          ))}
          {(exportsQuery.data?.items ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Chưa có yêu cầu xuất báo cáo nào.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
