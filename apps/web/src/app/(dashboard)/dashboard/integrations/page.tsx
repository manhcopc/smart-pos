"use client";

import {
  API_KEY_SCOPES,
  type ApiKeyScope,
  PERMISSIONS,
  WEBHOOK_EVENTS,
  type WebhookEventType,
} from "@smart-pos/shared";
import {
  CheckIcon,
  CopyIcon,
  FileSpreadsheetIcon,
  KeyIcon,
  PlusIcon,
  SendIcon,
  ShieldAlertIcon,
  Trash2Icon,
  WebhookIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe } from "@/hooks/use-auth";
import {
  downloadAccountingWorkbook,
  useApiKeys,
  useCreateApiKey,
  useCreateWebhook,
  useDeleteWebhook,
  useRevokeApiKey,
  useTestWebhook,
  useUpdateWebhook,
  useWebhookDeliveries,
  useWebhooks,
} from "@/hooks/use-integrations";
import { formatApiError } from "@/lib/api-client";
import { WEBHOOK_DELIVERY_STATUS_LABELS } from "@/lib/labels";

const SCOPE_LABELS: Record<ApiKeyScope, string> = {
  "inventory:read": "Đọc tồn kho realtime (inventory:read)",
  "inventory:write": "Cập nhật kho (inventory:write)",
  "orders:write": "Đồng bộ đơn TMĐT (orders:write)",
  "accounting:read": "Xuất sổ kế toán (accounting:read)",
};

const EVENT_LABELS: Record<WebhookEventType, string> = {
  STOCK_UPDATED: "Biến động tồn kho (STOCK_UPDATED)",
  INVOICE_CREATED: "Phát sinh hóa đơn mới (INVOICE_CREATED)",
  EXTERNAL_ORDER_SYNCED: "Đồng bộ đơn TMĐT (EXTERNAL_ORDER_SYNCED)",
};

export default function IntegrationsPage() {
  const meQuery = useMe();
  const perms = new Set(meQuery.data?.member.permissions ?? []);
  const canManageIntegrations = perms.has(PERMISSIONS.INTEGRATION_MANAGE);
  const canExportAccounting = perms.has(PERMISSIONS.REPORT_FINANCIAL);
  const branches = meQuery.data?.branches ?? [];

  const apiKeysQuery = useApiKeys(canManageIntegrations);
  const webhooksQuery = useWebhooks(canManageIntegrations);
  const deliveriesQuery = useWebhookDeliveries(canManageIntegrations);

  const createKeyMutation = useCreateApiKey();
  const revokeKeyMutation = useRevokeApiKey();
  const createWebhookMutation = useCreateWebhook();
  const updateWebhookMutation = useUpdateWebhook();
  const deleteWebhookMutation = useDeleteWebhook();
  const testWebhookMutation = useTestWebhook();

  const [keyName, setKeyName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<ApiKeyScope[]>([
    "inventory:read",
    "orders:write",
  ]);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const [hookName, setHookName] = useState("");
  const [hookUrl, setHookUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<WebhookEventType[]>([
    "STOCK_UPDATED",
  ]);

  const [accBranchId, setAccBranchId] = useState("ALL");
  const [accFrom, setAccFrom] = useState("");
  const [accTo, setAccTo] = useState("");
  const [downloadingAcc, setDownloadingAcc] = useState(false);

  function toggleScope(scope: ApiKeyScope) {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  function toggleEvent(ev: WebhookEventType) {
    setSelectedEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev],
    );
  }

  async function handleCreateApiKey(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!keyName.trim() || selectedScopes.length === 0) {
      toast.error("Nhập tên API Key và chọn ít nhất 1 quyền (scope)");
      return;
    }
    try {
      const created = await createKeyMutation.mutateAsync({
        name: keyName.trim(),
        scopes: selectedScopes,
      });
      setRevealedKey(created.plainTextKey);
      setCopiedKey(false);
      setKeyName("");
      toast.success("Đã tạo API Key mới");
    } catch (err) {
      toast.error(formatApiError(err, "Không thể tạo API Key."));
    }
  }

  async function handleCreateWebhook(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!hookName.trim() || !hookUrl.trim() || selectedEvents.length === 0) {
      toast.error("Vui lòng điền tên, URL HTTPS và ít nhất 1 sự kiện Webhook");
      return;
    }
    try {
      await createWebhookMutation.mutateAsync({
        name: hookName.trim(),
        targetUrl: hookUrl.trim(),
        events: selectedEvents,
      });
      setHookName("");
      setHookUrl("");
      toast.success("Đã đăng ký Webhook endpoint");
    } catch (err) {
      toast.error(formatApiError(err, "URL Webhook không hợp lệ."));
    }
  }

  async function handleExportAccounting() {
    setDownloadingAcc(true);
    try {
      const result = await downloadAccountingWorkbook({
        ...(accBranchId !== "ALL" ? { branchId: accBranchId } : {}),
        ...(accFrom ? { from: accFrom } : {}),
        ...(accTo ? { to: accTo } : {}),
      });
      toast.success(`Đã tải xuống ${result.fileName}`);
    } catch (err) {
      toast.error(formatApiError(err, "Không thể xuất file kế toán."));
    } finally {
      setDownloadingAcc(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Tích hợp Omnichannel, Webhook & Xuất Kế toán
        </h1>
        <p className="text-sm text-muted-foreground">
          Cấp khóa API cho Website / sàn TMĐT, nhận Webhook tồn kho theo thời gian thực qua BullMQ và xuất Sổ kế toán Excel 3 sheet.
        </p>
      </div>

      {canExportAccounting ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheetIcon className="size-4 text-primary" />
              Xuất Sổ Kế toán Tổng hợp (.xlsx — 3 sheet)
            </CardTitle>
            <CardDescription>
              Bao gồm: Hóa đơn & Thuế GTGT, Trả hàng & Hoàn tiền, và Bảng tổng hợp Kế toán theo ngày.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="w-48">
              <FieldLabel>Chi nhánh</FieldLabel>
              <Select
                value={accBranchId}
                onValueChange={(v) => v && setAccBranchId(v)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="ALL">Tất cả chi nhánh</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.code} · {b.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div>
              <FieldLabel htmlFor="acc-from">Từ ngày</FieldLabel>
              <Input
                id="acc-from"
                type="date"
                className="mt-1 w-40"
                value={accFrom}
                onChange={(e) => setAccFrom(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="acc-to">Đến ngày</FieldLabel>
              <Input
                id="acc-to"
                type="date"
                className="mt-1 w-40"
                value={accTo}
                onChange={(e) => setAccTo(e.target.value)}
              />
            </div>
            <Button
              type="button"
              disabled={downloadingAcc}
              onClick={() => void handleExportAccounting()}
            >
              <FileSpreadsheetIcon data-icon="inline-start" />
              {downloadingAcc
                ? "Đang tạo sổ..."
                : "Tải Sổ kế toán (.xlsx)"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {!canManageIntegrations ? (
        <Alert>
          <ShieldAlertIcon />
          <AlertTitle>Hạn chế quyền cấu hình API / Webhook</AlertTitle>
          <AlertDescription>
            Tài khoản cần quyền integration:manage để tạo API Key hoặc đăng ký Webhook.
          </AlertDescription>
        </Alert>
      ) : (
        <Tabs defaultValue="api-keys">
          <TabsList>
            <TabsTrigger value="api-keys">
              <KeyIcon className="mr-1.5 size-4" />
              API Keys ({apiKeysQuery.data?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="webhooks">
              <WebhookIcon className="mr-1.5 size-4" />
              Webhooks & Delivery ({webhooksQuery.data?.length ?? 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="api-keys" className="mt-4 flex flex-col gap-4">
            {revealedKey ? (
              <Alert>
                <KeyIcon />
                <AlertTitle>Sao chép API Key ngay (chỉ hiển thị 1 lần)</AlertTitle>
                <AlertDescription className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="rounded bg-muted px-2 py-1 font-mono text-xs break-all">
                    {revealedKey}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await navigator.clipboard?.writeText(revealedKey);
                      setCopiedKey(true);
                    }}
                  >
                    {copiedKey ? (
                      <CheckIcon data-icon="inline-start" />
                    ) : (
                      <CopyIcon data-icon="inline-start" />
                    )}
                    {copiedKey ? "Đã chép" : "Sao chép"}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tạo API Key tích hợp mới</CardTitle>
                <CardDescription>
                  Truy cập Public API bằng header{" "}
                  <code className="font-mono text-xs">X-Api-Key: spos_live_...</code> (cô lập strict RLS theo từng shop).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreateApiKey} className="flex flex-col gap-4">
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="api-key-name">Tên kết nối / Sàn</FieldLabel>
                      <Input
                        id="api-key-name"
                        placeholder="VD: Shopee Storefront / Website Next.js"
                        value={keyName}
                        onChange={(e) => setKeyName(e.target.value)}
                        required
                      />
                    </Field>
                  </FieldGroup>
                  <div className="flex flex-wrap gap-2">
                    {API_KEY_SCOPES.map((scope) => {
                      const active = selectedScopes.includes(scope);
                      return (
                        <Button
                          key={scope}
                          type="button"
                          size="sm"
                          variant={active ? "default" : "outline"}
                          onClick={() => toggleScope(scope)}
                        >
                          {SCOPE_LABELS[scope]}
                        </Button>
                      );
                    })}
                  </div>
                  <div>
                    <Button type="submit" disabled={createKeyMutation.isPending}>
                      <PlusIcon data-icon="inline-start" />
                      {createKeyMutation.isPending ? "Đang tạo..." : "Phát hành API Key"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Danh sách API Keys đã cấp</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {(apiKeysQuery.data ?? []).map((key) => (
                  <div
                    key={key.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{key.name}</span>
                        <Badge variant={key.isActive ? "secondary" : "destructive"}>
                          {key.isActive ? "Hoạt động" : "Đã thu hồi"}
                        </Badge>
                      </div>
                      <span className="font-mono text-xs text-muted-foreground">
                        {key.keyPrefix}... · Scopes: {key.scopes.join(", ")}
                      </span>
                    </div>
                    {key.isActive ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        disabled={revokeKeyMutation.isPending}
                        onClick={() =>
                          void revokeKeyMutation
                            .mutateAsync(key.id)
                            .then(() => toast.success("Đã thu hồi API Key"))
                        }
                      >
                        <Trash2Icon data-icon="inline-start" />
                        Thu hồi
                      </Button>
                    ) : null}
                  </div>
                ))}
                {(apiKeysQuery.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Chưa có API Key nào.</p>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="webhooks" className="mt-4 flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Đăng ký Webhook Endpoint mới</CardTitle>
                <CardDescription>
                  Mỗi yêu cầu gửi đi qua BullMQ đều đính kèm chữ ký HMAC-SHA256 trong header{" "}
                  <code className="font-mono text-xs">X-SmartPOS-Signature</code>.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreateWebhook} className="flex flex-col gap-4">
                  <FieldGroup className="grid gap-4 md:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="wh-name">Tên Webhook</FieldLabel>
                      <Input
                        id="wh-name"
                        placeholder="VD: Đồng bộ kho Website"
                        value={hookName}
                        onChange={(e) => setHookName(e.target.value)}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="wh-url">Endpoint URL (HTTPS)</FieldLabel>
                      <Input
                        id="wh-url"
                        type="url"
                        placeholder="https://api.myshop.vn/webhooks/smartpos"
                        value={hookUrl}
                        onChange={(e) => setHookUrl(e.target.value)}
                        required
                      />
                    </Field>
                  </FieldGroup>

                  <div className="flex flex-wrap gap-2">
                    {WEBHOOK_EVENTS.map((ev) => {
                      const active = selectedEvents.includes(ev);
                      return (
                        <Button
                          key={ev}
                          type="button"
                          size="sm"
                          variant={active ? "default" : "outline"}
                          onClick={() => toggleEvent(ev)}
                        >
                          {EVENT_LABELS[ev]}
                        </Button>
                      );
                    })}
                  </div>

                  <div>
                    <Button type="submit" disabled={createWebhookMutation.isPending}>
                      <PlusIcon data-icon="inline-start" />
                      {createWebhookMutation.isPending ? "Đang lưu..." : "Thêm Webhook"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Endpoints đang cấu hình</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {(webhooksQuery.data ?? []).map((hook) => (
                  <div
                    key={hook.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{hook.name}</span>
                        <Badge variant={hook.isActive ? "secondary" : "outline"}>
                          {hook.isActive ? "Đang bật" : "Tạm tắt"}
                        </Badge>
                      </div>
                      <span className="font-mono text-xs">{hook.targetUrl}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        Events: {hook.events.join(", ")} · Secret: {hook.signingSecret.slice(0, 12)}...
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={testWebhookMutation.isPending}
                        onClick={() =>
                          void testWebhookMutation
                            .mutateAsync(hook.id)
                            .then(() => toast.success("Đã đẩy event Test vào hàng đợi"))
                        }
                      >
                        <SendIcon data-icon="inline-start" />
                        Test
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void updateWebhookMutation.mutateAsync({
                            id: hook.id,
                            data: { isActive: !hook.isActive },
                          })
                        }
                      >
                        {hook.isActive ? "Tạm tắt" : "Bật lại"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() =>
                          void deleteWebhookMutation
                            .mutateAsync(hook.id)
                            .then(() => toast.success("Đã xóa Webhook"))
                        }
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </div>
                ))}
                {(webhooksQuery.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Chưa có Webhook nào.</p>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Lịch sử gửi Webhook (BullMQ Delivery Log)</CardTitle>
              </CardHeader>
              <CardContent>
                {(deliveriesQuery.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Chưa có lượt gửi nào.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="py-2 pr-3">Thời gian</th>
                          <th className="py-2 pr-3">Endpoint</th>
                          <th className="py-2 pr-3">Sự kiện</th>
                          <th className="py-2 pr-3">Trạng thái</th>
                          <th className="py-2 pr-3">HTTP</th>
                          <th className="py-2">Phản hồi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(deliveriesQuery.data ?? []).map((del) => (
                          <tr key={del.id} className="border-b last:border-0">
                            <td className="py-2 pr-3">
                              {new Date(del.createdAt).toLocaleString("vi-VN")}
                            </td>
                            <td className="py-2 pr-3 font-medium">{del.endpointName}</td>
                            <td className="py-2 pr-3 font-mono">{del.eventType}</td>
                            <td className="py-2 pr-3">
                              <Badge
                                variant={
                                  del.status === "DELIVERED"
                                    ? "secondary"
                                    : del.status === "FAILED"
                                      ? "destructive"
                                      : "outline"
                                }
                              >
                                {WEBHOOK_DELIVERY_STATUS_LABELS[del.status]}
                              </Badge>
                            </td>
                            <td className="py-2 pr-3 font-mono">{del.httpStatus ?? "-"}</td>
                            <td className="py-2 max-w-xs truncate font-mono text-muted-foreground">
                              {del.responseSnippet ?? ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
