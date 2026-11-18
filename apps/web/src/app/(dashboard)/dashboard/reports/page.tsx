"use client";

import {
  REPORT_EXPORT_TYPES,
  type ReportExportJobItem,
  type ReportExportType,
} from "@smart-pos/shared";
import {
  BarChart3Icon,
  DownloadIcon,
  FileSpreadsheetIcon,
} from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import {
  CardGridSkeleton,
  QueryErrorAlert,
  TableRowsSkeleton,
} from "@/components/shared/page-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useMe } from "@/hooks/use-auth";
import {
  getReportExportDownloadUrl,
  useCreateReportExport,
  useReportExports,
  useReportOverview,
} from "@/hooks/use-reports";
import { apiDownloadFile, formatApiError } from "@/lib/api-client";
import { isMockDataMode } from "@/lib/data-mode";
import {
  EXPORT_JOB_STATUS_LABELS,
  formatVndAmount,
  REPORT_EXPORT_TYPE_LABELS,
} from "@/lib/labels";

function vnToday(): Date {
  return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

function getPresetRange(days: number | "MONTH"): { from: string; to: string } {
  const vnNow = vnToday();
  const to = vnNow.toISOString().slice(0, 10);
  if (days === "MONTH") {
    return { from: `${to.slice(0, 7)}-01`, to };
  }
  const vnFrom = new Date(vnNow.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return { from: vnFrom.toISOString().slice(0, 10), to };
}

const revenueChartConfig = {
  netRevenue: {
    label: "Doanh thu thuần",
    color: "var(--chart-1)",
  },
  grossProfit: {
    label: "Lợi nhuận gộp",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

export default function ReportsPage() {
  const { data: profile } = useMe();
  const initialRange = getPresetRange(30);
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
  const chartData = (overview?.dailySeries ?? []).map((day) => ({
    date: day.date.slice(5),
    fullDate: day.date,
    netRevenue: Number(day.netRevenue),
    grossProfit: Number(day.grossProfit),
  }));

  async function handleEnqueueExport(reportType: ReportExportType) {
    try {
      const job = await createExportMutation.mutateAsync({
        reportType,
        ...(branchId !== "ALL" ? { branchId } : {}),
        from,
        to,
      });
      toast.success(
        `Đã tạo yêu cầu xuất "${REPORT_EXPORT_TYPE_LABELS[reportType]}" (${job.fileName})`,
      );
    } catch (error) {
      toast.error(formatApiError(error, "Không thể tạo tác vụ xuất Excel."));
    }
  }

  async function handleDownload(job: ReportExportJobItem) {
    try {
      if (isMockDataMode()) {
        await apiDownloadFile(
          `/reports/exports/${job.id}/download`,
          job.fileName,
        );
        return;
      }
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

  const exportJobs = exportsQuery.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            Báo cáo Doanh thu &amp; Lợi nhuận
          </h1>
          <p className="text-sm text-muted-foreground">
            Theo dõi hiệu quả bán hàng theo ngày, sản phẩm bán chạy và xuất file
            Excel lưu trữ.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const r = getPresetRange(1);
              setFrom(r.from);
              setTo(r.to);
            }}
          >
            Hôm nay
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const r = getPresetRange(7);
              setFrom(r.from);
              setTo(r.to);
            }}
          >
            7 ngày
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const r = getPresetRange(30);
              setFrom(r.from);
              setTo(r.to);
            }}
          >
            30 ngày
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const r = getPresetRange("MONTH");
              setFrom(r.from);
              setTo(r.to);
            }}
          >
            Tháng này
          </Button>
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
        <QueryErrorAlert
          title="Không thể tải báo cáo"
          error={overviewQuery.error}
          onRetry={() => void overviewQuery.refetch()}
        />
      ) : null}

      {overviewQuery.isLoading ? (
        <CardGridSkeleton
          count={4}
          columnsClass="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        />
      ) : overview ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Doanh thu thuần
                </CardTitle>
              </CardHeader>
              <CardContent className="font-mono text-xl font-semibold tabular-nums">
                {formatVndAmount(overview.kpis.netRevenue)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Giá vốn (COGS)
                </CardTitle>
              </CardHeader>
              <CardContent className="font-mono text-xl font-semibold tabular-nums">
                {formatVndAmount(overview.kpis.cogsTotal)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Lợi nhuận gộp
                </CardTitle>
              </CardHeader>
              <CardContent className="font-mono text-xl font-semibold text-primary tabular-nums">
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
                <span className="font-mono font-semibold text-destructive tabular-nums">
                  Hoàn: {formatVndAmount(overview.kpis.refundTotal)}
                </span>
                <span className="font-mono text-muted-foreground tabular-nums">
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
              {chartData.length === 0 ? (
                <Empty className="py-4">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <BarChart3Icon />
                    </EmptyMedia>
                    <EmptyTitle>Chưa có dữ liệu tổng hợp</EmptyTitle>
                    <EmptyDescription>
                      Chưa phát sinh doanh thu trong khoảng thời gian đã chọn.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ChartContainer
                  config={revenueChartConfig}
                  className="h-64 w-full"
                >
                  <BarChart data={chartData}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={72}
                      tickFormatter={(val: number) =>
                        val >= 1_000_000
                          ? `${(val / 1_000_000).toFixed(1)}tr`
                          : val >= 1_000
                            ? `${Math.round(val / 1_000)}k`
                            : String(val)
                      }
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value, name) => (
                            <div className="flex flex-1 items-center justify-between gap-4">
                              <span className="text-muted-foreground">
                                {name === "netRevenue"
                                  ? "Doanh thu thuần"
                                  : "Lợi nhuận gộp"}
                              </span>
                              <span className="font-mono font-medium tabular-nums">
                                {formatVndAmount(Number(value))}
                              </span>
                            </div>
                          )}
                        />
                      }
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar
                      dataKey="netRevenue"
                      fill="var(--color-netRevenue)"
                      radius={4}
                    />
                    <Bar
                      dataKey="grossProfit"
                      fill="var(--color-grossProfit)"
                      radius={4}
                    />
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          {overview.topProducts.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Top sản phẩm bán chạy
                </CardTitle>
                <CardDescription>
                  Xếp hạng theo doanh thu thực bán trong kỳ lọc
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs text-muted-foreground">
                      <TableHead>SKU</TableHead>
                      <TableHead>Sản phẩm</TableHead>
                      <TableHead className="text-right">SL bán</TableHead>
                      <TableHead className="text-right">Doanh thu</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.topProducts.slice(0, 10).map((item) => (
                      <TableRow key={item.variantId}>
                        <TableCell className="font-mono text-xs">
                          {item.sku}
                        </TableCell>
                        <TableCell className="font-medium">
                          {item.productName} - {item.variantName}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {Number(item.quantitySold)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold tabular-nums">
                          {formatVndAmount(item.revenue)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Danh sách tệp Xuất Báo cáo Excel
          </CardTitle>
          <CardDescription>
            Tự động cập nhật tiến trình xử lý nền; nhấn Tải Excel khi hoàn tất.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {exportsQuery.isError ? (
            <QueryErrorAlert
              title="Không tải được danh sách file xuất"
              error={exportsQuery.error}
              onRetry={() => void exportsQuery.refetch()}
            />
          ) : null}

          {exportsQuery.isLoading ? (
            <TableRowsSkeleton rows={2} />
          ) : exportJobs.length === 0 ? (
            <Empty className="py-4">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileSpreadsheetIcon />
                </EmptyMedia>
                <EmptyTitle>Chưa có yêu cầu xuất báo cáo nào</EmptyTitle>
                <EmptyDescription>
                  Chọn loại báo cáo ở phía trên và bấm &ldquo;Xuất XLSX&rdquo;
                  để tạo tệp tải xuống.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            exportJobs.map((job) => (
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
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
