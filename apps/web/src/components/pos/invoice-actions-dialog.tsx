"use client";

import {
  PERMISSIONS,
  REFUND_PAYMENT_METHODS,
  type InvoiceReceiptResponse,
  type PaymentMethod,
} from "@smart-pos/shared";
import {
  AlertCircleIcon,
  BanIcon,
  PrinterIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { QueryErrorAlert } from "@/components/shared/page-states";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useCreateSalesReturn,
  useInvoiceDetail,
  useVoidInvoice,
} from "@/hooks/use-pos";
import { formatApiError } from "@/lib/api-client";
import {
  formatVndAmount,
  INVOICE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
} from "@/lib/labels";
import { SupervisorPinDialog } from "./supervisor-pin-dialog";

interface InvoiceActionsDialogProps {
  tenantId: string | undefined;
  branchId: string | undefined;
  shiftId: string | undefined;
  invoiceId: string | null;
  canRefundDirect: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPrintReceipt: (receipt: InvoiceReceiptResponse) => void;
}

export function InvoiceActionsDialog({
  tenantId,
  branchId,
  shiftId,
  invoiceId,
  canRefundDirect,
  open,
  onOpenChange,
  onPrintReceipt,
}: InvoiceActionsDialogProps) {
  const detailQuery = useInvoiceDetail(
    invoiceId ?? undefined,
    Boolean(open && invoiceId),
  );
  const returnMutation = useCreateSalesReturn(tenantId);
  const voidMutation = useVoidInvoice(tenantId);

  const [returnQuantities, setReturnQuantities] = useState<
    Record<string, string>
  >({});
  const [refundMethod, setRefundMethod] = useState<
    (typeof REFUND_PAYMENT_METHODS)[number]
  >("CASH");
  const [returnReason, setReturnReason] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [approvalToken, setApprovalToken] = useState<string | undefined>(
    undefined,
  );
  const [approverName, setApproverName] = useState<string | null>(null);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);

  const detail = detailQuery.data;

  useEffect(() => {
    if (open) {
      setErrorMsg(null);
      setReturnReason("");
      setVoidReason("");
      setApprovalToken(undefined);
      setApproverName(null);
    }
  }, [open, invoiceId]);

  useEffect(() => {
    if (!detail) return;
    const init: Record<string, string> = {};
    for (const item of detail.items) {
      init[item.id] = "0";
    }
    setReturnQuantities(init);
  }, [detail]);

  const isVoided = detail?.status === "VOIDED";
  const hasPriorReturns = (detail?.salesReturns.length ?? 0) > 0;
  const canSubmitWithAuth = canRefundDirect || Boolean(approvalToken);

  async function handleReturnSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !invoiceId) return;
    setErrorMsg(null);

    if (!canSubmitWithAuth) {
      setPinDialogOpen(true);
      return;
    }

    const lines = detail.items
      .map((item) => ({
        invoiceItemId: item.id,
        quantity: (returnQuantities[item.id] ?? "0").trim(),
      }))
      .filter((l) => Number(l.quantity) > 0);

    if (lines.length === 0) {
      setErrorMsg(
        "Vui lòng nhập số lượng trả lớn hơn 0 cho ít nhất 1 mặt hàng.",
      );
      return;
    }

    try {
      const created = await returnMutation.mutateAsync({
        invoiceId,
        data: {
          shiftId: refundMethod === "CASH" ? shiftId ?? null : null,
          refundMethod,
          reason: returnReason.trim(),
          ...(approvalToken ? { supervisorApprovalToken: approvalToken } : {}),
          items: lines,
        },
      });
      toast.success(
        `Đã lập phiếu trả hàng ${created.code} · Hoàn ${formatVndAmount(created.totalRefundAmount)}`,
      );
      setReturnReason("");
      void detailQuery.refetch();
    } catch (error) {
      setErrorMsg(formatApiError(error, "Không thể lập phiếu trả hàng."));
    }
  }

  async function handleVoidSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !invoiceId) return;
    setErrorMsg(null);

    if (!canSubmitWithAuth) {
      setPinDialogOpen(true);
      return;
    }

    try {
      const voided = await voidMutation.mutateAsync({
        invoiceId,
        data: {
          reason: voidReason.trim(),
          ...(approvalToken ? { supervisorApprovalToken: approvalToken } : {}),
        },
      });
      toast.success(`Đã hủy hóa đơn ${voided.code}`);
      onOpenChange(false);
    } catch (error) {
      setErrorMsg(formatApiError(error, "Không thể hủy hóa đơn."));
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <span>Chi tiết hóa đơn {detail?.code ?? ""}</span>
              {detail ? (
                <Badge
                  variant={detail.status === "VOIDED" ? "destructive" : "secondary"}
                >
                  {INVOICE_STATUS_LABELS[detail.status] ?? detail.status}
                </Badge>
              ) : null}
            </DialogTitle>
            <DialogDescription>
              Xử lý trả hàng một phần/toàn phần, hủy hóa đơn hoặc in lại bill
              nhiệt.
            </DialogDescription>
          </DialogHeader>

          {detailQuery.isError ? (
            <QueryErrorAlert
              title="Không tải được chi tiết hóa đơn"
              error={detailQuery.error}
              onRetry={() => void detailQuery.refetch()}
            />
          ) : detailQuery.isLoading ? (
            <div className="flex flex-col gap-3 py-2">
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-32 w-full rounded-lg" />
            </div>
          ) : detail ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-3 text-sm">
                <div>
                  <div>
                    Thu ngân: <strong>{detail.cashierName}</strong> · Tổng:{" "}
                    <strong className="font-mono tabular-nums">
                      {formatVndAmount(detail.totalAmount)}
                    </strong>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {detail.customerName
                      ? `Khách hàng: ${detail.customerName}`
                      : "Khách lẻ"}{" "}
                    · {new Date(detail.createdAt).toLocaleString("vi-VN")}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onPrintReceipt(detail)}
                >
                  <PrinterIcon data-icon="inline-start" />
                  In hóa đơn
                </Button>
              </div>

              {!canRefundDirect ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/50 bg-warning/15 px-3 py-2 text-xs text-foreground">
                  <span>
                    {approverName
                      ? `Đã mở khóa bằng PIN Quản lý: ${approverName}`
                      : "Thu ngân cần PIN Quản lý để trả hàng hoặc hủy hóa đơn."}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setPinDialogOpen(true)}
                  >
                    {approvalToken ? "Đổi Quản lý" : "Nhập PIN Quản lý"}
                  </Button>
                </div>
              ) : null}

              {errorMsg ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertDescription>{errorMsg}</AlertDescription>
                </Alert>
              ) : null}

              <Tabs defaultValue="return">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="return" disabled={isVoided}>
                    <RotateCcwIcon data-icon="inline-start" />
                    Trả hàng / Hoàn tiền
                  </TabsTrigger>
                  <TabsTrigger
                    value="void"
                    disabled={isVoided || hasPriorReturns}
                  >
                    <BanIcon data-icon="inline-start" />
                    Hủy hóa đơn
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="return" className="pt-3">
                  {isVoided ? (
                    <p className="text-sm text-muted-foreground">
                      Hóa đơn đã bị hủy, không thể tạo phiếu trả hàng.
                    </p>
                  ) : (
                    <form
                      onSubmit={handleReturnSubmit}
                      className="flex flex-col gap-3"
                    >
                      <div className="divide-y rounded-md border">
                        {detail.items.map((item) => {
                          const bought = Number(item.quantity);
                          const returned = Number(item.returnedQty ?? "0");
                          const remaining = Math.max(0, bought - returned);

                          return (
                            <div
                              key={item.id}
                              className="flex flex-wrap items-center justify-between gap-2 p-2.5 text-sm"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="font-medium">
                                  {item.productName}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {item.sku} · Mua: {bought} · Đã trả:{" "}
                                  {returned} · Còn lại:{" "}
                                  <strong>{remaining}</strong> · Thành tiền:{" "}
                                  {formatVndAmount(item.lineTotal)}
                                </div>
                              </div>
                              <Input
                                aria-label={`SL trả ${item.sku}`}
                                className="h-9 w-24 text-right font-mono tabular-nums"
                                value={returnQuantities[item.id] ?? "0"}
                                disabled={remaining <= 0}
                                onChange={(e) =>
                                  setReturnQuantities((prev) => ({
                                    ...prev,
                                    [item.id]: e.target.value,
                                  }))
                                }
                              />
                            </div>
                          );
                        })}
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field>
                          <FieldLabel htmlFor="ret-method">
                            Phương thức hoàn tiền
                          </FieldLabel>
                          <Select
                            value={refundMethod}
                            onValueChange={(v) => {
                              if (v) {
                                setRefundMethod(
                                  v as (typeof REFUND_PAYMENT_METHODS)[number],
                                );
                              }
                            }}
                          >
                            <SelectTrigger id="ret-method" className="w-full">
                              <SelectValue>
                                {
                                  PAYMENT_METHOD_LABELS[
                                    refundMethod as PaymentMethod
                                  ]
                                }
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {REFUND_PAYMENT_METHODS.map((m) => (
                                  <SelectItem key={m} value={m}>
                                    {PAYMENT_METHOD_LABELS[m]}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Field>

                        <Field>
                          <FieldLabel htmlFor="ret-reason">
                            Lý do trả hàng
                          </FieldLabel>
                          <Input
                            id="ret-reason"
                            placeholder="VD: Đổi kích cỡ / Lỗi sản phẩm"
                            value={returnReason}
                            onChange={(e) => setReturnReason(e.target.value)}
                            required
                          />
                        </Field>
                      </div>

                      <Button
                        type="submit"
                        size="touch"
                        disabled={returnMutation.isPending}
                      >
                        {returnMutation.isPending
                          ? "Đang xử lý hoàn trả..."
                          : "Xác nhận Trả hàng & Hoàn kho"}
                      </Button>
                    </form>
                  )}

                  {detail.salesReturns.length > 0 ? (
                    <div className="mt-4 flex flex-col gap-2">
                      <Separator />
                      <span className="text-xs font-semibold uppercase text-muted-foreground">
                        Lịch sử phiếu trả hàng ({detail.salesReturns.length})
                      </span>
                      {detail.salesReturns.map((sr) => (
                        <div
                          key={sr.id}
                          className="flex items-center justify-between rounded-md border p-2 text-xs"
                        >
                          <div>
                            <strong className="font-mono">{sr.code}</strong> ·{" "}
                            {PAYMENT_METHOD_LABELS[sr.refundMethod]} ·{" "}
                            {sr.reason}
                          </div>
                          <span className="font-mono font-semibold text-destructive tabular-nums">
                            -{formatVndAmount(sr.totalRefundAmount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </TabsContent>

                <TabsContent value="void" className="pt-3">
                  <form
                    onSubmit={handleVoidSubmit}
                    className="flex flex-col gap-3"
                  >
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="void-reason">
                          Lý do hủy hóa đơn
                        </FieldLabel>
                        <Input
                          id="void-reason"
                          placeholder="VD: Thu ngân bấm nhầm phương thức / khách hủy toàn đơn"
                          value={voidReason}
                          onChange={(e) => setVoidReason(e.target.value)}
                          required
                        />
                      </Field>
                    </FieldGroup>
                    <Button
                      type="submit"
                      size="touch"
                      variant="destructive"
                      disabled={voidMutation.isPending}
                    >
                      {voidMutation.isPending
                        ? "Đang hủy hóa đơn..."
                        : "Xác nhận Hủy hóa đơn & Hoàn tồn kho"}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <SupervisorPinDialog
        branchId={branchId ?? detail?.branchId}
        permission={PERMISSIONS.POS_REFUND}
        open={pinDialogOpen}
        onOpenChange={setPinDialogOpen}
        onApproved={(approval) => {
          setApprovalToken(approval.approvalToken);
          setApproverName(approval.approverName);
        }}
      />
    </>
  );
}
