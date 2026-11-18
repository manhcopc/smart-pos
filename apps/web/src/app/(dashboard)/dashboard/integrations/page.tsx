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
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  QueryErrorAlert,
  TableRowsSkeleton,
} from "@/components/shared/page-states";
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

  const [pendingRevokeKey, setPendingRevokeKey] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [pendingDeleteHook, setPendingDeleteHook] = useState<{
    id: string;
    name: string;
  } | null>(null);

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

  async function handleConfirmRevokeKey() {
    if (!pendingRevokeKey) return;
    try {
      await revokeKeyMutation.mutateAsync(pendingRevokeKey.id);
      toast.success(`Đã thu hồi API Key "${pendingRevokeKey.name}"`);
      setPendingRevokeKey(null);
    } catch (err) {
      toast.error(formatApiError(err, "Không thể thu hồi API Key."));
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

  async function handleConfirmDeleteWebhook() {
    if (!pendingDeleteHook) return;
    try {
      await deleteWebhookMutation.mutateAsync(pendingDeleteHook.id);
      toast.success(`Đã xóa Webhook "${pendingDeleteHook.name}"`);
      setPendingDeleteHook(null);
    } catch (err) {
      toast.error(formatApiError(err, "Không thể xóa Webhook."));
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

  const selectedAccBranch = branches.find((b) => b.id === accBranchId);
  const apiKeys = apiKeysQuery.data ?? [];
  const webhooks = webhooksQuery.data ?? [];
  const deliveries = deliveriesQuery.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Tích hợp Omnichannel, Webhook &amp; Xuất Kế toán
        </h1>
        <p className="text-sm text-muted-foreground">
          Cấp khóa API cho Website / sàn TMĐT, nhận Webhook tồn kho theo thời
          gian thực và xuất Sổ kế toán Excel 3 sheet.
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
              Bao gồm: Hóa đơn &amp; Thuế GTGT, Trả hàng &amp; Hoàn tiền, và
              Bảng tổng hợp Kế toán theo ngày.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <Field className="w-52">
              <FieldLabel htmlFor="acc-branch">Chi nhánh</FieldLabel>
              <Select
                value={accBranchId}
                onValueChange={(v) => v && setAccBranchId(v)}
              >
                <SelectTrigger id="acc-branch" className="w-full">
                  <SelectValue>
                    {accBranchId === "ALL"
                      ? "Tất cả chi nhánh"
                      : selectedAccBranch
                        ? `${selectedAccBranch.code} · ${selectedAccBranch.name}`
                        : "Chi nhánh"}
                  </SelectValue>
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
            </Field>
            <Field className="w-40">
              <FieldLabel htmlFor="acc-from">Từ ngày</FieldLabel>
              <Input
                id="acc-from"
                type="date"
                value={accFrom}
                onChange={(e) => setAccFrom(e.target.value)}
              />
            </Field>
            <Field className="w-40">
              <FieldLabel htmlFor="acc-to">Đến ngày</FieldLabel>
              <Input
                id="acc-to"
                type="date"
                value={accTo}
                onChange={(e) => setAccTo(e.target.value)}
              />
            </Field>
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
            Tài khoản cần quyền Quản lý tích hợp để tạo API Key hoặc đăng ký
            Webhook.
          </AlertDescription>
        </Alert>
      ) : (
        <Tabs defaultValue="api-keys">
          <TabsList>
            <TabsTrigger value="api-keys">
              <KeyIcon data-icon="inline-start" />
              API Keys ({apiKeys.length})
            </TabsTrigger>
            <TabsTrigger value="webhooks">
              <WebhookIcon data-icon="inline-start" />
              Webhooks &amp; Delivery ({webhooks.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="api-keys" className="mt-4 flex flex-col gap-4">
            {revealedKey ? (
              <Alert>
                <KeyIcon />
                <AlertTitle>
                  Sao chép API Key ngay (chỉ hiển thị 1 lần)
                </AlertTitle>
                <AlertDescription className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">
                    {revealedKey}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard?.writeText(revealedKey);
                        setCopiedKey(true);
                        toast.success("Đã sao chép API Key");
                      } catch {
                        toast.error("Không thể truy cập clipboard");
                      }
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
                <CardTitle className="text-base">
                  Tạo API Key tích hợp mới
                </CardTitle>
                <CardDescription>
                  Truy cập Public API bằng header{" "}
                  <code className="font-mono text-xs">
                    X-Api-Key: spos_live_...
                  </code>
                  .
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={handleCreateApiKey}
                  className="flex flex-col gap-4"
                >
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="api-key-name">
                        Tên kết nối / Sàn
                      </FieldLabel>
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
                          aria-pressed={active}
                          variant={active ? "default" : "outline"}
                          onClick={() => toggleScope(scope)}
                        >
                          {SCOPE_LABELS[scope]}
                        </Button>
                      );
                    })}
                  </div>
                  <div>
                    <Button
                      type="submit"
                      disabled={createKeyMutation.isPending}
                    >
                      <PlusIcon data-icon="inline-start" />
                      {createKeyMutation.isPending
                        ? "Đang tạo..."
                        : "Phát hành API Key"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            {apiKeysQuery.isError ? (
              <QueryErrorAlert
                title="Không tải được danh sách API Keys"
                error={apiKeysQuery.error}
                onRetry={() => void apiKeysQuery.refetch()}
              />
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Danh sách API Keys đã cấp
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {apiKeysQuery.isLoading ? (
                  <TableRowsSkeleton rows={2} />
                ) : apiKeys.length === 0 ? (
                  <Empty className="py-4">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <KeyIcon />
                      </EmptyMedia>
                      <EmptyTitle>Chưa có API Key nào</EmptyTitle>
                      <EmptyDescription>
                        Phát hành API Key ở biểu mẫu trên để kết nối website
                        hoặc sàn TMĐT.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  apiKeys.map((key) => (
                    <div
                      key={key.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                    >
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {key.name}
                          </span>
                          <Badge
                            variant={key.isActive ? "secondary" : "destructive"}
                          >
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
                            setPendingRevokeKey({ id: key.id, name: key.name })
                          }
                        >
                          <Trash2Icon data-icon="inline-start" />
                          Thu hồi
                        </Button>
                      ) : null}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="webhooks" className="mt-4 flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Đăng ký Webhook Endpoint mới
                </CardTitle>
                <CardDescription>
                  Mỗi yêu cầu gửi đi đều đính kèm chữ ký HMAC-SHA256 trong
                  header{" "}
                  <code className="font-mono text-xs">
                    X-SmartPOS-Signature
                  </code>
                  .
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={handleCreateWebhook}
                  className="flex flex-col gap-4"
                >
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
                      <FieldLabel htmlFor="wh-url">
                        Endpoint URL (HTTPS)
                      </FieldLabel>
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
                          aria-pressed={active}
                          variant={active ? "default" : "outline"}
                          onClick={() => toggleEvent(ev)}
                        >
                          {EVENT_LABELS[ev]}
                        </Button>
                      );
                    })}
                  </div>

                  <div>
                    <Button
                      type="submit"
                      disabled={createWebhookMutation.isPending}
                    >
                      <PlusIcon data-icon="inline-start" />
                      {createWebhookMutation.isPending
                        ? "Đang lưu..."
                        : "Thêm Webhook"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            {webhooksQuery.isError ? (
              <QueryErrorAlert
                title="Không tải được danh sách Webhook"
                error={webhooksQuery.error}
                onRetry={() => void webhooksQuery.refetch()}
              />
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Endpoints đang cấu hình
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {webhooksQuery.isLoading ? (
                  <TableRowsSkeleton rows={2} />
                ) : webhooks.length === 0 ? (
                  <Empty className="py-4">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <WebhookIcon />
                      </EmptyMedia>
                      <EmptyTitle>Chưa có Webhook nào</EmptyTitle>
                      <EmptyDescription>
                        Đăng ký endpoint HTTPS ở trên để nhận thông báo tồn kho
                        và hóa đơn tự động.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  webhooks.map((hook) => (
                    <div
                      key={hook.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                    >
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {hook.name}
                          </span>
                          <Badge
                            variant={hook.isActive ? "secondary" : "outline"}
                          >
                            {hook.isActive ? "Đang bật" : "Tạm tắt"}
                          </Badge>
                        </div>
                        <span className="font-mono text-xs">
                          {hook.targetUrl}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          Events: {hook.events.join(", ")} · Secret:{" "}
                          {hook.signingSecret.slice(0, 12)}...
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={testWebhookMutation.isPending}
                          onClick={async () => {
                            try {
                              await testWebhookMutation.mutateAsync(hook.id);
                              toast.success("Đã đẩy event Test vào hàng đợi");
                            } catch (err) {
                              toast.error(formatApiError(err));
                            }
                          }}
                        >
                          <SendIcon data-icon="inline-start" />
                          Test
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            try {
                              await updateWebhookMutation.mutateAsync({
                                id: hook.id,
                                data: { isActive: !hook.isActive },
                              });
                            } catch (err) {
                              toast.error(formatApiError(err));
                            }
                          }}
                        >
                          {hook.isActive ? "Tạm tắt" : "Bật lại"}
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Xóa webhook ${hook.name}`}
                          className="text-destructive"
                          onClick={() =>
                            setPendingDeleteHook({
                              id: hook.id,
                              name: hook.name,
                            })
                          }
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Lịch sử gửi Webhook (Delivery Log)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {deliveriesQuery.isError ? (
                  <QueryErrorAlert
                    title="Không tải được lịch sử gửi Webhook"
                    error={deliveriesQuery.error}
                    onRetry={() => void deliveriesQuery.refetch()}
                  />
                ) : deliveriesQuery.isLoading ? (
                  <TableRowsSkeleton rows={3} />
                ) : deliveries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Chưa có lượt gửi nào.
                  </p>
                ) : (
                  <Table className="text-xs">
                    <TableHeader>
                      <TableRow className="text-muted-foreground">
                        <TableHead>Thời gian</TableHead>
                        <TableHead>Endpoint</TableHead>
                        <TableHead>Sự kiện</TableHead>
                        <TableHead>Trạng thái</TableHead>
                        <TableHead>HTTP</TableHead>
                        <TableHead>Phản hồi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deliveries.map((del) => (
                        <TableRow key={del.id}>
                          <TableCell>
                            {new Date(del.createdAt).toLocaleString("vi-VN")}
                          </TableCell>
                          <TableCell className="font-medium">
                            {del.endpointName}
                          </TableCell>
                          <TableCell className="font-mono">
                            {del.eventType}
                          </TableCell>
                          <TableCell>
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
                          </TableCell>
                          <TableCell className="font-mono">
                            {del.httpStatus ?? "-"}
                          </TableCell>
                          <TableCell className="max-w-xs truncate font-mono text-muted-foreground">
                            {del.responseSnippet ?? ""}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <ConfirmDialog
        open={Boolean(pendingRevokeKey)}
        onOpenChange={(open) => {
          if (!open) setPendingRevokeKey(null);
        }}
        title={`Thu hồi API Key "${pendingRevokeKey?.name ?? ""}"?`}
        description="Mọi tích hợp đang sử dụng khóa này sẽ lập tức bị từ chối kết nối."
        confirmLabel="Thu hồi khóa"
        isPending={revokeKeyMutation.isPending}
        onConfirm={handleConfirmRevokeKey}
      />

      <ConfirmDialog
        open={Boolean(pendingDeleteHook)}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteHook(null);
        }}
        title={`Xóa Webhook "${pendingDeleteHook?.name ?? ""}"?`}
        description="Endpoint này sẽ ngừng nhận các sự kiện tồn kho và hóa đơn từ Smart-POS."
        confirmLabel="Xóa Webhook"
        isPending={deleteWebhookMutation.isPending}
        onConfirm={handleConfirmDeleteWebhook}
      />
    </div>
  );
}
