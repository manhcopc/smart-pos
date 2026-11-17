"use client";

import {
  createStockTransferSchema,
  type StockTransferItemView,
} from "@smart-pos/shared";
import {
  AlertCircleIcon,
  ArrowLeftRightIcon,
  CheckIcon,
  PlusIcon,
  XIcon,
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
import { useProducts } from "@/hooks/use-catalog";
import {
  useCancelStockTransfer,
  useDispatchStockTransfer,
  useReceiveStockTransfer,
  useStockTransfers,
} from "@/hooks/use-stock-transfers";
import { formatApiError } from "@/lib/api-client";
import { STOCK_TRANSFER_STATUS_LABELS } from "@/lib/labels";

interface TransferDraftLine {
  variantId: string;
  quantity: string;
}

export default function StockTransfersPage() {
  const { data: profile } = useMe();
  const transfersQuery = useStockTransfers({ limit: 30 }, Boolean(profile));
  const productsQuery = useProducts({ page: 1, limit: 50 }, Boolean(profile));

  const dispatchMutation = useDispatchStockTransfer();
  const receiveMutation = useReceiveStockTransfer();
  const cancelMutation = useCancelStockTransfer();

  const [createOpen, setCreateOpen] = useState(false);
  const [fromBranchId, setFromBranchId] = useState("");
  const [toBranchId, setToBranchId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<TransferDraftLine[]>([
    { variantId: "", quantity: "1" },
  ]);
  const [formError, setFormError] = useState<string | null>(null);

  const branches = profile?.branches ?? [];
  const allVariants = (productsQuery.data?.items ?? []).flatMap((p) =>
    p.variants.map((v) => ({
      id: v.id,
      label: `${p.name} - ${v.name} (${v.sku})`,
    })),
  );

  function openNewTransferModal() {
    setFormError(null);
    setFromBranchId(branches[0]?.id ?? "");
    setToBranchId(branches[1]?.id ?? "");
    setNote("");
    setLines([{ variantId: allVariants[0]?.id ?? "", quantity: "1" }]);
    setCreateOpen(true);
  }

  async function handleDispatchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsed = createStockTransferSchema.safeParse({
      fromBranchId,
      toBranchId,
      ...(note.trim() ? { note: note.trim() } : {}),
      items: lines.filter((l) => l.variantId),
    });

    if (!parsed.success) {
      setFormError(
        parsed.error.issues[0]?.message ??
          "Vui lòng kiểm tra chi nhánh xuất/nhận và danh sách SKU.",
      );
      return;
    }

    try {
      const created = await dispatchMutation.mutateAsync(parsed.data);
      toast.success(`Đã xuất phiếu chuyển kho ${created.code} (IN_TRANSIT)`);
      setCreateOpen(false);
    } catch (error) {
      setFormError(formatApiError(error, "Không thể tạo phiếu chuyển kho."));
    }
  }

  async function handleReceive(transfer: StockTransferItemView) {
    try {
      await receiveMutation.mutateAsync({ transferId: transfer.id, data: {} });
      toast.success(`Đã nhận hàng phiếu ${transfer.code} và cập nhật giá vốn AVCO`);
    } catch (error) {
      toast.error(formatApiError(error, "Không thể xác nhận nhận kho."));
    }
  }

  async function handleCancel(transfer: StockTransferItemView) {
    try {
      await cancelMutation.mutateAsync(transfer.id);
      toast.success(`Đã hủy phiếu ${transfer.code} và hoàn tồn về chi nhánh xuất`);
    } catch (error) {
      toast.error(formatApiError(error, "Không thể hủy phiếu chuyển kho."));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            Điều chuyển kho Liên chi nhánh
          </h1>
          <p className="text-sm text-muted-foreground">
            Xuất kho chi nhánh nguồn (IN_TRANSIT) &rarr; Xác nhận nhập kho chi
            nhánh đích kèm giá vốn bình quân gia quyền (AVCO).
          </p>
        </div>

        <Button
          type="button"
          disabled={branches.length < 2}
          onClick={openNewTransferModal}
        >
          <PlusIcon data-icon="inline-start" />
          Tạo phiếu chuyển kho
        </Button>
      </header>

      {branches.length < 2 ? (
        <Alert>
          <AlertCircleIcon />
          <AlertTitle>Cần tối thiểu 2 chi nhánh</AlertTitle>
          <AlertDescription>
            Gian hàng hiện có {branches.length} chi nhánh. Hãy thêm chi nhánh thứ
            2 (nếu gói cho phép) để thực hiện luân chuyển tồn kho nội bộ.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3">
        {(transfersQuery.data?.items ?? []).map((tr) => (
          <Card key={tr.id}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ArrowLeftRightIcon className="size-4 text-primary" />
                  <CardTitle className="font-mono text-base">{tr.code}</CardTitle>
                  <Badge
                    variant={
                      tr.status === "RECEIVED"
                        ? "default"
                        : tr.status === "CANCELLED"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {STOCK_TRANSFER_STATUS_LABELS[tr.status]}
                  </Badge>
                </div>

                {tr.status === "IN_TRANSIT" ? (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={receiveMutation.isPending}
                      onClick={() => void handleReceive(tr)}
                    >
                      <CheckIcon data-icon="inline-start" />
                      Nhận hàng tại {tr.toBranchName}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={cancelMutation.isPending}
                      onClick={() => void handleCancel(tr)}
                    >
                      <XIcon data-icon="inline-start" />
                      Hủy phiếu
                    </Button>
                  </div>
                ) : null}
              </div>
              <CardDescription>
                {tr.fromBranchName} &rarr; {tr.toBranchName} · Tạo bởi:{" "}
                {tr.createdByName}
                {tr.receivedByName ? ` · Nhận bởi: ${tr.receivedByName}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 text-sm">
              {tr.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between border-b py-1 last:border-none"
                >
                  <span>
                    <strong className="font-mono">{item.sku}</strong> ·{" "}
                    {item.productName} ({item.variantName})
                  </span>
                  <span className="font-mono">
                    {Number(item.quantity)} {item.unit}
                  </span>
                </div>
              ))}
              {tr.note ? (
                <p className="pt-1 text-xs text-muted-foreground">
                  Ghi chú: {tr.note}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ))}

        {(transfersQuery.data?.items ?? []).length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Chưa có phiếu chuyển kho nào
              </CardTitle>
              <CardDescription>
                Bấm &ldquo;Tạo phiếu chuyển kho&rdquo; để luân chuyển hàng giữa
                các chi nhánh.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Tạo phiếu điều chuyển kho</DialogTitle>
            <DialogDescription>
              Hàng hóa sẽ bị trừ ngay ở chi nhánh xuất và chuyển sang trạng thái
              vận chuyển (IN_TRANSIT).
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleDispatchSubmit} className="flex flex-col gap-4">
            {formError ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="tr-from">Chi nhánh xuất</FieldLabel>
                <Select
                  value={fromBranchId}
                  onValueChange={(v) => {
                    if (v) setFromBranchId(v);
                  }}
                >
                  <SelectTrigger id="tr-from">
                    <SelectValue>
                      {branches.find((b) => b.id === fromBranchId)?.name ??
                        "Chọn chi nhánh"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.code} · {b.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="tr-to">Chi nhánh nhận</FieldLabel>
                <Select
                  value={toBranchId}
                  onValueChange={(v) => {
                    if (v) setToBranchId(v);
                  }}
                >
                  <SelectTrigger id="tr-to">
                    <SelectValue>
                      {branches.find((b) => b.id === toBranchId)?.name ??
                        "Chọn chi nhánh"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.code} · {b.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Danh sách SKU</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setLines((prev) => [
                      ...prev,
                      { variantId: allVariants[0]?.id ?? "", quantity: "1" },
                    ])
                  }
                >
                  <PlusIcon data-icon="inline-start" />
                  Thêm dòng
                </Button>
              </div>
              {lines.map((line, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Select
                    value={line.variantId}
                    onValueChange={(v) => {
                      if (!v) return;
                      setLines((prev) =>
                        prev.map((item, i) =>
                          i === idx ? { ...item, variantId: v } : item,
                        ),
                      );
                    }}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue>
                        {allVariants.find((v) => v.id === line.variantId)
                          ?.label ?? "Chọn SKU"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {allVariants.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Input
                    aria-label={`SL chuyển dòng ${idx + 1}`}
                    className="w-24 font-mono text-right"
                    value={line.quantity}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((item, i) =>
                          i === idx
                            ? { ...item, quantity: e.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  {lines.length > 1 ? (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      onClick={() =>
                        setLines((prev) => prev.filter((_, i) => i !== idx))
                      }
                    >
                      <XIcon />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="tr-note">Ghi chú</FieldLabel>
                <Input
                  id="tr-note"
                  placeholder="Chuyển bổ sung hàng cuối tuần..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
            </FieldGroup>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                Hủy
              </Button>
              <Button type="submit" disabled={dispatchMutation.isPending}>
                {dispatchMutation.isPending
                  ? "Đang xuất chuyển..."
                  : "Xác nhận xuất chuyển kho"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
