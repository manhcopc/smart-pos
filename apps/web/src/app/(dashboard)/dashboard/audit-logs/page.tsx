"use client";

import { AUDIT_ACTIONS, type AuditActionType } from "@smart-pos/shared";
import { ScrollTextIcon } from "lucide-react";
import { useState } from "react";
import { DataPagination } from "@/components/shared/data-pagination";
import {
  CardGridSkeleton,
  QueryErrorAlert,
} from "@/components/shared/page-states";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
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
import { useMe } from "@/hooks/use-auth";
import { useAuditLogs } from "@/hooks/use-reports";
import { AUDIT_ACTION_LABELS } from "@/lib/labels";

const DESTRUCTIVE_ACTIONS = new Set<AuditActionType>([
  "INVOICE_VOID",
  "REFUND",
  "SHIFT_DIFF",
  "PRICE_OVERRIDE",
  "DISCOUNT_OVERRIDE",
]);

const METADATA_KEY_LABELS: Record<string, string> = {
  invoiceCode: "Mã hóa đơn",
  reason: "Lý do",
  shiftId: "Ca làm việc",
  amount: "Số tiền",
  variance: "Chênh lệch",
  sku: "Mã SKU",
  pointsDelta: "Thay đổi điểm",
  planCode: "Gói dịch vụ",
  transferCode: "Mã chuyển kho",
  branchCode: "Mã chi nhánh",
};

function formatMetadataEntries(
  metadata: Record<string, unknown> | null | undefined,
): Array<{ label: string; value: string }> {
  if (!metadata || typeof metadata !== "object") return [];
  return Object.entries(metadata).map(([key, val]) => ({
    label: METADATA_KEY_LABELS[key] ?? key,
    value:
      typeof val === "string" || typeof val === "number" || typeof val === "boolean"
        ? String(val)
        : JSON.stringify(val),
  }));
}

export default function AuditLogsPage() {
  const { data: profile } = useMe();
  const [branchId, setBranchId] = useState("ALL");
  const [action, setAction] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expandedJsonIds, setExpandedJsonIds] = useState<
    Record<string, boolean>
  >({});

  const logsQuery = useAuditLogs(
    {
      page,
      limit: 30,
      ...(branchId !== "ALL" ? { branchId } : {}),
      ...(action !== "ALL" ? { action: action as AuditActionType } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
    },
    Boolean(profile),
  );

  const items = logsQuery.data?.items ?? [];
  const pagination = logsQuery.data?.pagination;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold">
          Nhật ký Kiểm toán &amp; Thao tác Nhạy cảm
        </h1>
        <p className="text-sm text-muted-foreground">
          Ghi nhận bất biến các hành động sửa giá, chiết khấu, hủy hóa đơn, hoàn
          trả, lệch két ca, kiểm kho và điều chuyển nội bộ.
        </p>
      </header>

      <Card>
        <CardContent className="grid gap-3 pt-4 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="al-branch">Chi nhánh</FieldLabel>
            <Select
              value={branchId}
              onValueChange={(v) => {
                if (v) {
                  setBranchId(v);
                  setPage(1);
                }
              }}
            >
              <SelectTrigger id="al-branch">
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
            <FieldLabel htmlFor="al-action">Loại hành động</FieldLabel>
            <Select
              value={action}
              onValueChange={(v) => {
                if (v) {
                  setAction(v);
                  setPage(1);
                }
              }}
            >
              <SelectTrigger id="al-action">
                <SelectValue>
                  {action === "ALL"
                    ? "Tất cả thao tác"
                    : AUDIT_ACTION_LABELS[action as AuditActionType]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="ALL">Tất cả thao tác</SelectItem>
                  {AUDIT_ACTIONS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {AUDIT_ACTION_LABELS[a]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="al-search">Tìm nhân sự / đối tượng</FieldLabel>
            <Input
              id="al-search"
              placeholder="Tên NV, mã NV..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </Field>
        </CardContent>
      </Card>

      {logsQuery.isError ? (
        <QueryErrorAlert
          title="Không tải được nhật ký kiểm toán"
          error={logsQuery.error}
          onRetry={() => void logsQuery.refetch()}
        />
      ) : null}

      <div className="flex flex-col gap-2.5">
        {logsQuery.isLoading ? (
          <CardGridSkeleton count={3} columnsClass="flex flex-col gap-2.5" />
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="pt-4">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ScrollTextIcon />
                  </EmptyMedia>
                  <EmptyTitle>Chưa có bản ghi phù hợp</EmptyTitle>
                  <EmptyDescription>
                    Thử bỏ bộ lọc hoặc thực hiện giao dịch trên POS để sinh nhật
                    ký.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </CardContent>
          </Card>
        ) : (
          items.map((log) => {
            const entries = formatMetadataEntries(
              log.metadata as Record<string, unknown> | null | undefined,
            );
            return (
              <Card key={log.id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <ScrollTextIcon className="size-4 text-primary" />
                      <Badge
                        variant={
                          DESTRUCTIVE_ACTIONS.has(log.action)
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {AUDIT_ACTION_LABELS[log.action] ?? log.action}
                      </Badge>
                      <span className="text-sm font-medium">
                        {log.actorName} ({log.actorEmployeeCode})
                      </span>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString("vi-VN")}
                    </span>
                  </div>
                  <CardDescription>
                    {log.branchName ? `Chi nhánh: ${log.branchName} · ` : ""}
                    Đối tượng:{" "}
                    <span className="font-mono">{log.entityType}</span> (
                    <span className="font-mono">{log.entityId}</span>)
                    {log.ipAddress ? ` · IP: ${log.ipAddress}` : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {entries.length > 0 ? (
                    <div className="grid gap-1.5 rounded-md border bg-muted/30 p-2.5 text-xs sm:grid-cols-2">
                      {entries.map((entry) => (
                        <div
                          key={entry.label}
                          className="flex items-baseline justify-between gap-2"
                        >
                          <span className="text-muted-foreground">
                            {entry.label}:
                          </span>
                          <span className="font-mono font-medium text-foreground">
                            {entry.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      aria-expanded={Boolean(expandedJsonIds[log.id])}
                      onClick={() =>
                        setExpandedJsonIds((prev) => ({
                          ...prev,
                          [log.id]: !prev[log.id],
                        }))
                      }
                    >
                      {expandedJsonIds[log.id]
                        ? "Ẩn chi tiết kỹ thuật (JSON)"
                        : "Xem chi tiết kỹ thuật (JSON)"}
                    </button>
                    {expandedJsonIds[log.id] ? (
                      <pre className="mt-1.5 overflow-x-auto rounded bg-muted/40 p-2 font-mono text-xs">
                        {JSON.stringify(log.metadata, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {pagination ? (
        <DataPagination
          page={page}
          totalPages={pagination.totalPages}
          totalItems={pagination.total}
          onPageChange={setPage}
        />
      ) : null}
    </div>
  );
}
