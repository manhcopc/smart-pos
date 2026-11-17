"use client";

import { AUDIT_ACTIONS, type AuditActionType } from "@smart-pos/shared";
import { ScrollTextIcon } from "lucide-react";
import { useState } from "react";
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
import { useAuditLogs } from "@/hooks/use-reports";
import { AUDIT_ACTION_LABELS } from "@/lib/labels";

const DESTRUCTIVE_ACTIONS = new Set<AuditActionType>([
  "INVOICE_VOID",
  "REFUND",
  "SHIFT_DIFF",
  "PRICE_OVERRIDE",
  "DISCOUNT_OVERRIDE",
]);

export default function AuditLogsPage() {
  const { data: profile } = useMe();
  const [branchId, setBranchId] = useState("ALL");
  const [action, setAction] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

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
          Nhật ký Kiểm toán &amp; Thao tác Nhạy cảm (Audit Logs)
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

      <div className="flex flex-col gap-2.5">
        {items.map((log) => (
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
                Đối tượng: <span className="font-mono">{log.entityType}</span> (
                <span className="font-mono">{log.entityId}</span>)
                {log.ipAddress ? ` · IP: ${log.ipAddress}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded bg-muted/40 p-2 font-mono text-xs text-muted-foreground">
                {JSON.stringify(log.metadata, null, 2)}
              </pre>
            </CardContent>
          </Card>
        ))}

        {items.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Chưa có bản ghi phù hợp</CardTitle>
              <CardDescription>
                Thử bỏ bộ lọc hoặc thực hiện giao dịch trên POS để sinh log.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}
      </div>

      {pagination && pagination.totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Trang trước
          </Button>
          <span className="text-xs text-muted-foreground">
            Trang {page} / {pagination.totalPages}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Trang sau
          </Button>
        </div>
      ) : null}
    </div>
  );
}
