"use client";

import {
  closeShiftSchema,
  formatMoney,
  parseMoney,
  PAYMENT_METHODS,
  type ShiftZReportResponse,
} from "@smart-pos/shared";
import { AlertCircleIcon, PrinterIcon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { QueryErrorAlert } from "@/components/shared/page-states";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useCloseShift, useShiftZReport } from "@/hooks/use-pos";
import { formatApiError } from "@/lib/api-client";
import { formatVndAmount, PAYMENT_METHOD_LABELS } from "@/lib/labels";

interface ShiftZReportDialogProps {
  shiftId: string | undefined;
  shopName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShiftClosed: (report: ShiftZReportResponse) => void;
}

export function ShiftZReportDialog({
  shiftId,
  shopName,
  open,
  onOpenChange,
  onShiftClosed,
}: ShiftZReportDialogProps) {
  const zReportQuery = useShiftZReport(shiftId, open && Boolean(shiftId));
  const closeShiftMutation = useCloseShift();

  const [actualCash, setActualCash] = useState("");
  const [note, setNote] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [closedReport, setClosedReport] = useState<ShiftZReportResponse | null>(
    null,
  );

  const report = closedReport ?? zReportQuery.data ?? null;

  useEffect(() => {
    if (open && zReportQuery.data && !closedReport) {
      setActualCash(zReportQuery.data.shift.expectedCash);
      setNote("");
      setErrorMsg(null);
    }
  }, [open, zReportQuery.data, closedReport]);

  useEffect(() => {
    if (!open) {
      setClosedReport(null);
      setErrorMsg(null);
    }
  }, [open]);

  function computeVariancePreview(): string {
    if (!report) return "0.00";
    try {
      const expected = parseMoney(report.shift.expectedCash);
      const actual = parseMoney(actualCash || "0");
      return formatMoney(actual - expected);
    } catch {
      return "0.00";
    }
  }

  async function handleCloseSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shiftId) return;
    setErrorMsg(null);

    const parsed = closeShiftSchema.safeParse({
      actualCash,
      ...(note.trim() ? { note: note.trim() } : {}),
    });

    if (!parsed.success) {
      setErrorMsg(
        parsed.error.issues[0]?.message ?? "Số tiền két thực tế không hợp lệ",
      );
      return;
    }

    try {
      const closed = await closeShiftMutation.mutateAsync({
        shiftId,
        data: parsed.data,
      });
      setClosedReport(closed);
      onShiftClosed(closed);
      toast.success("Đã chốt ca và lưu Z-Report");
    } catch (error) {
      setErrorMsg(formatApiError(error, "Không thể đóng ca thu ngân."));
    }
  }

  const variancePreview = computeVariancePreview();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="pos-no-print">
          <DialogTitle>
            {closedReport
              ? "Báo cáo Chốt ca (Z-Report)"
              : "Đóng ca & Đối soát két"}
          </DialogTitle>
          <DialogDescription>
            Kiểm đếm tiền mặt thực tế trong két để đối chiếu với doanh thu ca.
          </DialogDescription>
        </DialogHeader>

        {errorMsg ? (
          <Alert variant="destructive" className="pos-no-print">
            <AlertCircleIcon />
            <AlertDescription>{errorMsg}</AlertDescription>
          </Alert>
        ) : null}

        {zReportQuery.isError && !closedReport ? (
          <QueryErrorAlert
            title="Không tải được số liệu chốt ca"
            error={zReportQuery.error}
            onRetry={() => void zReportQuery.refetch()}
          />
        ) : report ? (
          <div className="pos-printable-receipt flex flex-col gap-3 rounded-lg border bg-card p-4 text-sm">
            <div className="flex flex-col gap-0.5 text-center">
              <span className="font-semibold uppercase">{shopName}</span>
              <span className="text-xs text-muted-foreground">
                {report.shift.branchCode} · {report.shift.branchName} · Mở ca:{" "}
                {report.shift.openedByName}
              </span>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <span className="text-muted-foreground">Số hóa đơn</span>
              <span className="text-right font-mono font-medium tabular-nums">
                {report.summary.invoiceCount}
              </span>

              <span className="text-muted-foreground">Doanh thu gộp</span>
              <span className="text-right font-mono tabular-nums">
                {formatVndAmount(report.summary.grossSales)}
              </span>

              <span className="text-muted-foreground">Chiết khấu</span>
              <span className="text-right font-mono tabular-nums">
                -{formatVndAmount(report.summary.discountTotal)}
              </span>

              <span className="text-muted-foreground">Thuế VAT</span>
              <span className="text-right font-mono tabular-nums">
                {formatVndAmount(report.summary.taxTotal)}
              </span>

              <span className="font-medium">Doanh thu thuần</span>
              <span className="text-right font-mono font-semibold tabular-nums">
                {formatVndAmount(report.summary.netSales)}
              </span>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-1.5 text-xs">
              {PAYMENT_METHODS.map((method) => {
                const amount = report.summary.paymentTotals[method];
                if (Number(amount) === 0 && method !== "CASH") return null;
                return (
                  <div key={method} className="contents">
                    <span className="text-muted-foreground">
                      {PAYMENT_METHOD_LABELS[method]}
                    </span>
                    <span className="text-right font-mono tabular-nums">
                      {formatVndAmount(amount)}
                    </span>
                  </div>
                );
              })}
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <span className="text-muted-foreground">Tiền đầu ca</span>
              <span className="text-right font-mono tabular-nums">
                {formatVndAmount(report.shift.openingCash)}
              </span>

              <span className="font-medium">Tiền két lý thuyết</span>
              <span className="text-right font-mono font-semibold tabular-nums">
                {formatVndAmount(report.shift.expectedCash)}
              </span>

              {closedReport ? (
                <>
                  <span className="font-medium">Tiền thực đếm</span>
                  <span className="text-right font-mono font-semibold tabular-nums">
                    {formatVndAmount(report.shift.actualCash ?? "0")}
                  </span>
                  <span className="font-medium">Chênh lệch ca</span>
                  <span
                    className={`text-right font-mono font-semibold tabular-nums ${
                      Number(report.shift.cashVariance ?? 0) !== 0
                        ? "text-destructive"
                        : ""
                    }`}
                  >
                    {formatVndAmount(report.shift.cashVariance ?? "0")}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 py-2">
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        )}

        {!closedReport && report?.shift.status === "OPEN" ? (
          <form
            onSubmit={handleCloseSubmit}
            className="pos-no-print flex flex-col gap-4"
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="shift-actual-cash">
                  Tiền mặt thực đếm trong két (₫)
                </FieldLabel>
                <Input
                  id="shift-actual-cash"
                  value={actualCash}
                  onChange={(e) => setActualCash(e.target.value)}
                />
                <span
                  className={`text-xs ${
                    Number(variancePreview) !== 0
                      ? "font-medium text-destructive"
                      : "text-muted-foreground"
                  }`}
                >
                  Chênh lệch dự kiến: {formatVndAmount(variancePreview)}
                </span>
              </Field>

              <Field>
                <FieldLabel htmlFor="shift-close-note">
                  Ghi chú bàn giao ca
                </FieldLabel>
                <Input
                  id="shift-close-note"
                  placeholder="Lý do thừa/thiếu tiền két (nếu có)..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
            </FieldGroup>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Hủy
              </Button>
              <Button
                type="submit"
                size="touch"
                disabled={closeShiftMutation.isPending}
              >
                {closeShiftMutation.isPending
                  ? "Đang chốt ca..."
                  : "Xác nhận đóng ca"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <DialogFooter className="pos-no-print">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Đóng
            </Button>
            <Button type="button" onClick={() => window.print()}>
              <PrinterIcon data-icon="inline-start" />
              In Z-Report
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
