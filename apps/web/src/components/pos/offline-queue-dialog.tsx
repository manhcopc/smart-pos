"use client";

import {
  calculatePosInvoiceTotals,
  ERROR_CODES,
  formatMoney,
  formatQuantity,
  parseMoney,
  parseQuantity,
} from "@smart-pos/shared";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CloudOffIcon,
  RefreshCwIcon,
  Trash2Icon,
  WrenchIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatVndAmount } from "@/lib/labels";
import type { QueuedOfflineInvoice } from "@/lib/pos-offline-queue";

interface OfflineQueueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: QueuedOfflineInvoice[];
  isOnline: boolean;
  isSyncing: boolean;
  currentShiftId: string | null;
  onSyncEntries: (entriesToSync: QueuedOfflineInvoice[]) => Promise<void>;
  onResolveEntry: (updatedEntry: QueuedOfflineInvoice) => Promise<void>;
  onDiscardEntry: (idempotencyKey: string) => Promise<void>;
}

export function buildClampedOfflineEntry(
  entry: QueuedOfflineInvoice,
): QueuedOfflineInvoice | null {
  const latestMap = new Map(
    (entry.latestStock ?? []).map((s) => [s.variantId, parseQuantity(s.available)]),
  );

  const nextSummaries = entry.itemSummaries
    .map((item) => {
      const requested = parseQuantity(item.quantity);
      const avail = latestMap.get(item.variantId);
      const clamped = avail !== undefined && avail < requested ? avail : requested;
      if (clamped <= 0n) return null;
      const lineSubMinor =
        (parseMoney(item.unitPrice) * clamped) / 1000n -
        parseMoney(item.discountAmount);
      return {
        ...item,
        quantity: formatQuantity(clamped),
        lineTotal: formatMoney(lineSubMinor > 0n ? lineSubMinor : 0n),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (nextSummaries.length === 0) return null;

  const totals = calculatePosInvoiceTotals({
    lines: nextSummaries.map((it) => ({
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      discountAmount: it.discountAmount,
      taxRate: it.taxRate,
    })),
    invoiceDiscountAmount: entry.discountAmount,
    payments: [{ method: "CASH", amount: "999999999.00" }],
  });

  const nextTotal = totals.formatted.totalAmount;

  return {
    ...entry,
    subtotal: totals.formatted.subtotal,
    taxAmount: totals.formatted.taxAmount,
    totalAmount: nextTotal,
    paidAmount: nextTotal,
    changeGiven: "0.00",
    itemSummaries: nextSummaries,
    status: "PENDING",
    errorCode: undefined,
    errorMessage: undefined,
    latestStock: undefined,
    payload: {
      ...entry.payload,
      items: nextSummaries.map((it) => ({
        variantId: it.variantId,
        quantity: it.quantity,
        discountAmount: it.discountAmount,
      })),
      payments: [{ method: "CASH", amount: nextTotal }],
    },
  };
}

export function OfflineQueueDialog({
  open,
  onOpenChange,
  entries,
  isOnline,
  isSyncing,
  currentShiftId,
  onSyncEntries,
  onResolveEntry,
  onDiscardEntry,
}: OfflineQueueDialogProps) {
  const pendingOrFailed = entries.filter((e) => e.status !== "CONFLICT");
  const conflictCount = entries.filter((e) => e.status === "CONFLICT").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudOffIcon className="size-5" />
            Hàng đợi hóa đơn Offline ({entries.length})
          </DialogTitle>
          <DialogDescription>
            Hóa đơn tạo khi mất mạng được lưu an toàn trong IndexedDB và tự động
            đồng bộ lại khi kết nối khôi phục.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 p-3">
          <div className="flex items-center gap-2 text-xs">
            <Badge variant={isOnline ? "secondary" : "destructive"}>
              {isOnline ? "Đã có mạng" : "Đang Offline"}
            </Badge>
            {conflictCount > 0 ? (
              <Badge variant="destructive">
                {conflictCount} đơn xung đột cần xử lý
              </Badge>
            ) : null}
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!isOnline || isSyncing || pendingOrFailed.length === 0}
            onClick={() => void onSyncEntries(pendingOrFailed)}
          >
            <RefreshCwIcon data-icon="inline-start" />
            {isSyncing
              ? "Đang đồng bộ..."
              : `Đồng bộ ${pendingOrFailed.length} đơn`}
          </Button>
        </div>

        {entries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <CheckCircle2Icon className="size-8 text-primary" />
            <p>Tất cả hóa đơn đã được đồng bộ lên máy chủ.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {entries.map((entry) => {
              const isStockConflict =
                entry.status === "CONFLICT" &&
                entry.errorCode === ERROR_CODES.INSUFFICIENT_STOCK;
              const isShiftConflict =
                entry.status === "CONFLICT" &&
                (entry.errorCode === ERROR_CODES.SHIFT_NOT_OPEN ||
                  entry.errorCode === ERROR_CODES.SHIFT_NOT_FOUND);
              const clampedPreview = isStockConflict
                ? buildClampedOfflineEntry(entry)
                : null;

              return (
                <div
                  key={entry.idempotencyKey}
                  className="flex flex-col gap-2.5 rounded-lg border bg-card p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">
                        {entry.localReceiptCode}
                      </span>
                      <Badge
                        variant={
                          entry.status === "CONFLICT" ||
                          entry.status === "FAILED"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {entry.status === "CONFLICT"
                          ? "Xung đột"
                          : entry.status === "FAILED"
                            ? "Lỗi gửi"
                            : "Chờ đồng bộ"}
                      </Badge>
                    </div>
                    <span className="font-mono text-sm font-semibold text-primary">
                      {formatVndAmount(entry.totalAmount)}
                    </span>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Lưu lúc:{" "}
                    {new Date(entry.queuedAt).toLocaleString("vi-VN")} ·{" "}
                    {entry.itemSummaries
                      .map((it) => `${it.sku} x${Number(it.quantity)}`)
                      .join(", ")}
                  </div>

                  {entry.status !== "PENDING" && entry.errorMessage ? (
                    <Alert variant="destructive">
                      <AlertTriangleIcon />
                      <AlertTitle>
                        {entry.errorCode ?? "Cần kiểm tra"}
                      </AlertTitle>
                      <AlertDescription className="flex flex-col gap-1">
                        <span>{entry.errorMessage}</span>
                        {entry.latestStock && entry.latestStock.length > 0 ? (
                          <span className="font-mono text-xs">
                            Tồn kho máy chủ:{" "}
                            {entry.latestStock
                              .map(
                                (s) => `${s.sku}: còn ${Number(s.available)}`,
                              )
                              .join(" | ")}
                          </span>
                        ) : null}
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {isStockConflict && clampedPreview ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={!isOnline || isSyncing}
                        onClick={() => void onResolveEntry(clampedPreview)}
                      >
                        <WrenchIcon data-icon="inline-start" />
                        Khớp tồn kho ({formatVndAmount(clampedPreview.totalAmount)}) & Gửi lại
                      </Button>
                    ) : null}

                    {isShiftConflict && currentShiftId ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={!isOnline || isSyncing}
                        onClick={() =>
                          void onResolveEntry({
                            ...entry,
                            shiftId: currentShiftId,
                            status: "PENDING",
                            errorCode: undefined,
                            errorMessage: undefined,
                            payload: {
                              ...entry.payload,
                              shiftId: currentShiftId,
                            },
                          })
                        }
                      >
                        <WrenchIcon data-icon="inline-start" />
                        Chuyển sang ca đang mở & Gửi lại
                      </Button>
                    ) : null}

                    {entry.status !== "CONFLICT" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!isOnline || isSyncing}
                        onClick={() => void onSyncEntries([entry])}
                      >
                        <RefreshCwIcon data-icon="inline-start" />
                        Thử đồng bộ
                      </Button>
                    ) : null}

                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={isSyncing}
                      onClick={() => void onDiscardEntry(entry.idempotencyKey)}
                    >
                      <Trash2Icon data-icon="inline-start" />
                      Hủy đơn hàng đợi
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
