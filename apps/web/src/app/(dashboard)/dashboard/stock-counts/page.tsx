"use client";

import {
  createStockCountSchema,
  formatQuantity,
  parseQuantity,
  PERMISSIONS,
} from "@smart-pos/shared";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  PlusIcon,
  Trash2Icon,
  XCircleIcon,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useMe } from "@/hooks/use-auth";
import {
  useBalanceStockCount,
  useCancelStockCount,
  useCreateStockCount,
  useInventory,
  useStockCounts,
} from "@/hooks/use-inventory";
import { formatApiError } from "@/lib/api-client";
import { STOCK_COUNT_STATUS_LABELS } from "@/lib/labels";

interface StockCountLineDraft {
  variantId: string;
  actualQty: string;
  reason: string;
}

export default function StockCountsPage() {
  const { data: profile } = useMe();
  const canCount =
    profile?.member.permissions.includes(PERMISSIONS.INVENTORY_COUNT) ?? false;

  const branches = profile?.branches ?? [];
  const defaultBranchId =
    branches.find((b) => b.isDefault)?.id ?? branches[0]?.id ?? "";

  const [createOpen, setCreateOpen] = useState(false);
  const [scBranchId, setScBranchId] = useState("");
  const [balanceImmediately, setBalanceImmediately] = useState(false);
  const [lines, setLines] = useState<StockCountLineDraft[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);

  const effectiveBranchId = scBranchId || defaultBranchId;

  const stockCountsQuery = useStockCounts(
    { page: 1, limit: 30 },
    Boolean(profile),
  );
  const branchStockQuery = useInventory(
    { page: 1, limit: 100, branchId: effectiveBranchId || undefined },
    Boolean(profile) && Boolean(effectiveBranchId),
  );

  const createScMutation = useCreateStockCount();
  const balanceScMutation = useBalanceStockCount();
  const cancelScMutation = useCancelStockCount();

  const branchInventoryItems = branchStockQuery.data?.items ?? [];
  const bookQtyByVariantId = new Map(
    branchInventoryItems.map((item) => [item.variantId, item.onHand]),
  );

  function openCreateDialog() {
    const first = branchInventoryItems[0];
    setScBranchId(defaultBranchId);
    setBalanceImmediately(false);
    setLines(
      first
        ? [
            {
              variantId: first.variantId,
              actualQty: first.onHand,
              reason: "",
            },
          ]
        : [],
    );
    setCreateError(null);
    setCreateOpen(true);
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError(null);

    const parsed = createStockCountSchema.safeParse({
      branchId: effectiveBranchId,
      items: lines.map((line) => ({
        variantId: line.variantId,
        actualQty: line.actualQty,
        reason: line.reason.trim() || null,
      })),
      balanceImmediately,
    });

    if (!parsed.success) {
      setCreateError(
        parsed.error.issues[0]?.message ?? "Dữ liệu kiểm kho chưa hợp lệ",
      );
      return;
    }

    try {
      await createScMutation.mutateAsync(parsed.data);
      toast.success(
        balanceImmediately
          ? "Đã cân bằng kho và ghi nhận AuditLog"
          : "Đã tạo phiếu kiểm kho nháp",
      );
      setCreateOpen(false);
    } catch (error) {
      setCreateError(formatApiError(error, "Không thể tạo phiếu kiểm kho."));
    }
  }

  const counts = stockCountsQuery.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Phiếu Kiểm kho &amp; Đối soát</h1>
          <p className="text-sm text-muted-foreground">
            Đối chiếu tồn thực tế với sổ sách, bắt buộc ghi rõ lý do chênh lệch
            và lưu AuditLog bất biến khi cân bằng.
          </p>
        </div>

        {canCount ? (
          <Button
            onClick={openCreateDialog}
            disabled={branchInventoryItems.length === 0}
          >
            <ClipboardCheckIcon data-icon="inline-start" />
            Tạo phiếu kiểm kho
          </Button>
        ) : null}
      </header>

      {branchInventoryItems.length === 0 && !branchStockQuery.isLoading ? (
        <Alert>
          <AlertCircleIcon />
          <AlertTitle>Chưa có SKU trong chi nhánh</AlertTitle>
          <AlertDescription>
            Hãy tạo sản phẩm trước khi lập phiếu kiểm kê tồn kho.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-4">
        {counts.map((sc) => (
          <Card key={sc.id}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="font-mono">{sc.code}</span>
                  <Badge
                    variant={
                      sc.status === "BALANCED"
                        ? "secondary"
                        : sc.status === "CANCELLED"
                          ? "outline"
                          : "default"
                    }
                  >
                    {STOCK_COUNT_STATUS_LABELS[sc.status]}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Chi nhánh: {sc.branchCode} · {sc.branchName} · Tạo bởi{" "}
                  {sc.createdByName}
                  {sc.balancedByName
                    ? ` · Cân bằng bởi ${sc.balancedByName}`
                    : ""}
                </CardDescription>
              </div>

              {canCount && sc.status === "DRAFT" ? (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={async () => {
                      try {
                        await balanceScMutation.mutateAsync({
                          id: sc.id,
                          data: {},
                        });
                        toast.success(`Đã cân bằng kho phiếu ${sc.code}`);
                      } catch (err) {
                        toast.error(formatApiError(err));
                      }
                    }}
                    disabled={balanceScMutation.isPending}
                  >
                    <CheckCircle2Icon data-icon="inline-start" />
                    Cân bằng kho
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await cancelScMutation.mutateAsync(sc.id);
                        toast.success(`Đã hủy phiếu ${sc.code}`);
                      } catch (err) {
                        toast.error(formatApiError(err));
                      }
                    }}
                    disabled={cancelScMutation.isPending}
                  >
                    <XCircleIcon data-icon="inline-start" />
                    Hủy
                  </Button>
                </div>
              ) : null}
            </CardHeader>

            <CardContent className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="py-1.5 pr-3">SKU</th>
                    <th className="py-1.5 pr-3">Tên hàng</th>
                    <th className="py-1.5 pr-3 text-right">Sổ sách</th>
                    <th className="py-1.5 pr-3 text-right">Thực tế</th>
                    <th className="py-1.5 pr-3 text-right">Chênh lệch</th>
                    <th className="py-1.5">Lý do</th>
                  </tr>
                </thead>
                <tbody>
                  {sc.items.map((item) => (
                    <tr key={item.id} className="border-b last:border-b-0">
                      <td className="py-1.5 pr-3 font-mono text-xs">
                        {item.sku}
                      </td>
                      <td className="py-1.5 pr-3">{item.variantName}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">
                        {item.systemQty}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono">
                        {item.actualQty}
                      </td>
                      <td
                        className={`py-1.5 pr-3 text-right font-mono font-medium ${
                          Number(item.varianceQty) !== 0
                            ? "text-destructive"
                            : ""
                        }`}
                      >
                        {Number(item.varianceQty) > 0
                          ? `+${item.varianceQty}`
                          : item.varianceQty}
                      </td>
                      <td className="py-1.5 text-xs text-muted-foreground">
                        {item.reason ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Tạo phiếu kiểm kho</DialogTitle>
            <DialogDescription>
              Mọi SKU có chênh lệch giữa tồn thực tế và tồn sổ sách phải ghi rõ
              lý do trước khi cân bằng.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSubmit} className="flex flex-col gap-4">
            {createError ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>{createError}</AlertDescription>
              </Alert>
            ) : null}

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="sc-branch">Chi nhánh kiểm kê</FieldLabel>
                <Select
                  value={effectiveBranchId}
                  onValueChange={(value) => {
                    if (value) setScBranchId(value);
                  }}
                >
                  <SelectTrigger id="sc-branch" className="w-full">
                    <SelectValue>
                      {branches.find((b) => b.id === effectiveBranchId)?.name ??
                        "Chọn chi nhánh"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {branches.map((branch) => (
                        <SelectItem key={branch.id} value={branch.id}>
                          {branch.code} · {branch.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    Danh sách SKU kiểm đếm
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const first = branchInventoryItems[0];
                      if (!first) return;
                      setLines((prev) => [
                        ...prev,
                        {
                          variantId: first.variantId,
                          actualQty: first.onHand,
                          reason: "",
                        },
                      ]);
                    }}
                  >
                    <PlusIcon data-icon="inline-start" />
                    Thêm SKU
                  </Button>
                </div>

                {lines.map((line, idx) => {
                  const bookStr = bookQtyByVariantId.get(line.variantId) ?? "0.000";
                  let varianceText = "0.000";
                  let hasVariance = false;
                  try {
                    const diff =
                      parseQuantity(line.actualQty || "0") -
                      parseQuantity(bookStr);
                    hasVariance = diff !== 0n;
                    varianceText =
                      diff > 0n
                        ? `+${formatQuantity(diff)}`
                        : formatQuantity(diff);
                  } catch {
                    varianceText = "—";
                  }

                  const chosen = branchInventoryItems.find(
                    (i) => i.variantId === line.variantId,
                  );

                  return (
                    <div
                      key={idx}
                      className="grid gap-2 rounded-md border bg-muted/20 p-2.5 sm:grid-cols-[1.4fr_0.9fr_1fr_1.4fr_auto]"
                    >
                      <Select
                        value={line.variantId}
                        onValueChange={(value) => {
                          if (!value) return;
                          const matched = branchInventoryItems.find(
                            (i) => i.variantId === value,
                          );
                          setLines((prev) =>
                            prev.map((item, i) =>
                              i === idx
                                ? {
                                    ...item,
                                    variantId: value,
                                    actualQty: matched?.onHand ?? "0.000",
                                  }
                                : item,
                            ),
                          );
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {chosen ? `${chosen.sku}` : "Chọn SKU"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {branchInventoryItems.map((inv) => (
                              <SelectItem
                                key={inv.variantId}
                                value={inv.variantId}
                              >
                                {inv.sku} · Sổ sách: {inv.onHand}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>

                      <div className="flex items-center text-xs text-muted-foreground">
                        Sổ: {bookStr} ({varianceText})
                      </div>

                      <Input
                        aria-label="Số lượng thực tế"
                        placeholder="Thực tế"
                        value={line.actualQty}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((item, i) =>
                              i === idx
                                ? { ...item, actualQty: e.target.value }
                                : item,
                            ),
                          )
                        }
                      />

                      <Input
                        aria-label="Lý do chênh lệch"
                        placeholder={
                          hasVariance
                            ? "Lý do bắt buộc..."
                            : "Lý do (nếu lệch)"
                        }
                        value={line.reason}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((item, i) =>
                              i === idx
                                ? { ...item, reason: e.target.value }
                                : item,
                            ),
                          )
                        }
                      />

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={lines.length <= 1}
                        onClick={() =>
                          setLines((prev) => prev.filter((_, i) => i !== idx))
                        }
                      >
                        <Trash2Icon className="size-4 text-destructive" />
                      </Button>
                    </div>
                  );
                })}
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={balanceImmediately}
                  onChange={(e) => setBalanceImmediately(e.target.checked)}
                />
                <span>
                  Cân bằng tồn kho ngay (ghi InventoryLedger &amp; AuditLog)
                </span>
              </label>
            </FieldGroup>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                Hủy
              </Button>
              <Button type="submit" disabled={createScMutation.isPending}>
                {createScMutation.isPending
                  ? "Đang lưu..."
                  : "Lưu phiếu kiểm kho"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
