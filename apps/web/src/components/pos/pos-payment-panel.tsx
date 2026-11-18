"use client";

import {
  type CustomerItem,
  PAYMENT_METHODS,
  type PaymentMethod,
  PERMISSIONS,
  type RegisterShiftItem,
  SUPERVISOR_APPROVAL_PERMISSIONS,
} from "@smart-pos/shared";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CreditCardIcon,
  LockOpenIcon,
  PlusIcon,
  PrinterIcon,
  QrCodeIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import { Separator } from "@/components/ui/separator";
import { formatVndAmount, PAYMENT_METHOD_LABELS } from "@/lib/labels";
import {
  formatMoneyForInput,
  type PendingInvoiceTab,
  QUICK_CASH_NOTES,
} from "./types";

interface PosPaymentPanelProps {
  currentShift: RegisterShiftItem | null;
  shiftFetched: boolean;
  branchName: string;
  openingCash: string;
  onOpeningCashChange: (value: string) => void;
  shiftError: string | null;
  onOpenShiftSubmit: (event: FormEvent<HTMLFormElement>) => void;
  openShiftPending: boolean;
  checkoutError: string | null;
  activeTab: PendingInvoiceTab;
  onUpdateActiveTab: (
    updater: (prev: PendingInvoiceTab) => PendingInvoiceTab,
  ) => void;
  customerPickerOpen: boolean;
  onToggleCustomerPicker: () => void;
  onCloseCustomerPicker: () => void;
  customerSearch: string;
  onCustomerSearchChange: (value: string) => void;
  customers: readonly CustomerItem[];
  customersLoading: boolean;
  onOpenNewCustomer: () => void;
  onApplyLoyaltyRedeem: () => void;
  hasNativePrice: boolean;
  hasNativeDiscount: boolean;
  canPriceOverride: boolean;
  canDiscount: boolean;
  onRequestPin: (
    permission: (typeof SUPERVISOR_APPROVAL_PERMISSIONS)[number],
  ) => void;
  cartSummary: {
    subtotal: string;
    discount: string;
    tax: string;
    total: string;
  };
  changeDueFormatted: string | null;
  hasActiveReceipt: boolean;
  onOpenReceiptModal: () => void;
  checkoutPending: boolean;
  onCheckout: () => void;
  shopName: string;
}

export function PosPaymentPanel({
  currentShift,
  shiftFetched,
  branchName,
  openingCash,
  onOpeningCashChange,
  shiftError,
  onOpenShiftSubmit,
  openShiftPending,
  checkoutError,
  activeTab,
  onUpdateActiveTab,
  customerPickerOpen,
  onToggleCustomerPicker,
  onCloseCustomerPicker,
  customerSearch,
  onCustomerSearchChange,
  customers,
  customersLoading,
  onOpenNewCustomer,
  onApplyLoyaltyRedeem,
  hasNativePrice,
  hasNativeDiscount,
  canPriceOverride,
  canDiscount,
  onRequestPin,
  cartSummary,
  changeDueFormatted,
  hasActiveReceipt,
  onOpenReceiptModal,
  checkoutPending,
  onCheckout,
  shopName,
}: PosPaymentPanelProps) {
  const [qrPreviewAmount, setQrPreviewAmount] = useState<string | null>(null);

  const totalDueNum = Math.max(0, Number(cartSummary.total) || 0);
  const currentPaidSum = activeTab.payments.reduce(
    (acc, p) => acc + (Number(p.amount) || 0),
    0,
  );
  const remainingDue = Math.max(0, totalDueNum - currentPaidSum);

  const hasBankTransfer = activeTab.payments.some(
    (p) => p.method === "BANK_TRANSFER_QR",
  );
  const bankTransferAmount = activeTab.payments
    .filter((p) => p.method === "BANK_TRANSFER_QR")
    .reduce((acc, p) => acc + (Number(p.amount) || 0), 0);

  return (
    <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto">
      {!currentShift && shiftFetched ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LockOpenIcon className="size-4 text-primary" />
              Mở ca Thu ngân
            </CardTitle>
            <CardDescription>
              Nhập tiền mặt đầu ca trong két để bắt đầu bán hàng tại{" "}
              {branchName}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onOpenShiftSubmit} className="flex flex-col gap-3">
              {shiftError ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertDescription>{shiftError}</AlertDescription>
                </Alert>
              ) : null}

              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="pos-opening-cash">
                    Tiền đầu ca (₫)
                  </FieldLabel>
                  <Input
                    id="pos-opening-cash"
                    inputMode="numeric"
                    value={openingCash}
                    onChange={(e) => onOpeningCashChange(e.target.value)}
                  />
                </Field>
              </FieldGroup>

              <Button
                type="submit"
                size="touch"
                className="w-full"
                disabled={openShiftPending}
              >
                {openShiftPending
                  ? "Đang mở ca..."
                  : "Mở ca & Bắt đầu bán hàng"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card className="flex flex-col">
        <CardHeader>
          <CardTitle>Thanh toán (Split Payment)</CardTitle>
          <CardDescription>
            Tiền mặt · VietQR · Thẻ · Tiền thừa tự động
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {checkoutError ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Không thể thanh toán</AlertTitle>
              <AlertDescription>{checkoutError}</AlertDescription>
            </Alert>
          ) : null}

          {/* CRM Customer & Loyalty Selector */}
          <div className="flex flex-col gap-1.5 rounded-md border bg-muted/20 p-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 font-medium">
                <UsersIcon className="size-3.5 text-primary" />
                {activeTab.customerId
                  ? `${activeTab.customerName} (${activeTab.customerPoints} điểm)`
                  : "Khách lẻ"}
              </span>
              <div className="flex items-center gap-1">
                {activeTab.customerId && activeTab.customerPoints > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={onApplyLoyaltyRedeem}
                  >
                    Dùng điểm
                  </Button>
                ) : null}
                {activeTab.customerId ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Bỏ chọn khách hàng"
                    onClick={() =>
                      onUpdateActiveTab((prev) => ({
                        ...prev,
                        customerId: null,
                        customerName: null,
                        customerPoints: 0,
                      }))
                    }
                  >
                    <XIcon />
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={onToggleCustomerPicker}
                    >
                      Tìm KH
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Thêm nhanh khách hàng"
                      onClick={onOpenNewCustomer}
                    >
                      <UserPlusIcon />
                    </Button>
                  </>
                )}
              </div>
            </div>

            {customerPickerOpen ? (
              <div className="flex flex-col gap-1.5 pt-1">
                <Input
                  aria-label="Tìm khách hàng theo SĐT hoặc tên"
                  className="h-8 text-xs"
                  placeholder="Nhập SĐT hoặc tên khách hàng..."
                  value={customerSearch}
                  onChange={(e) => onCustomerSearchChange(e.target.value)}
                />
                <div className="max-h-32 divide-y overflow-y-auto rounded border bg-background">
                  {customers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="flex w-full items-center justify-between px-2 py-1.5 text-left hover:bg-muted/50"
                      onClick={() => {
                        onUpdateActiveTab((prev) => ({
                          ...prev,
                          customerId: c.id,
                          customerName: c.name,
                          customerPoints: c.loyaltyPoints,
                        }));
                        onCloseCustomerPicker();
                      }}
                    >
                      <span>
                        {c.name} {c.phone ? `· ${c.phone}` : ""}
                      </span>
                      <Badge variant="outline">{c.loyaltyPoints} đ</Badge>
                    </button>
                  ))}
                  {customers.length === 0 ? (
                    <p className="p-2 text-center text-muted-foreground">
                      {customersLoading
                        ? "Đang tìm..."
                        : "Không có khách phù hợp"}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {/* Manager PIN Override Banner for Cashiers */}
          {!hasNativePrice || !hasNativeDiscount ? (
            <div className="flex flex-wrap items-center justify-between gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-xs">
              <span className="flex items-center gap-1 text-muted-foreground">
                <ShieldCheckIcon className="size-3.5 text-primary" />
                {activeTab.supervisorApproverName
                  ? `QL duyệt: ${activeTab.supervisorApproverName}`
                  : "Sửa giá / Chiết khấu cần PIN QL"}
              </span>
              <div className="flex gap-1">
                {!canPriceOverride ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onRequestPin(PERMISSIONS.POS_PRICE_OVERRIDE)}
                  >
                    PIN Giá
                  </Button>
                ) : null}
                {!canDiscount ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onRequestPin(PERMISSIONS.POS_DISCOUNT_OVERRIDE)
                    }
                  >
                    PIN CK
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Tạm tính</span>
            <span className="font-mono font-medium tabular-nums">
              {formatVndAmount(cartSummary.subtotal)}
            </span>
          </div>

          {canDiscount ? (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Chiết khấu bill</span>
              <Input
                aria-label="Chiết khấu hóa đơn"
                inputMode="numeric"
                className="h-9 w-28 text-right font-mono tabular-nums"
                value={activeTab.invoiceDiscountAmount}
                onChange={(e) =>
                  onUpdateActiveTab((prev) => ({
                    ...prev,
                    invoiceDiscountAmount: e.target.value,
                  }))
                }
              />
            </div>
          ) : (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Giảm giá</span>
              <span className="font-mono font-medium tabular-nums">
                {formatVndAmount(cartSummary.discount)}
              </span>
            </div>
          )}

          {Number(cartSummary.tax) > 0 ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Thuế VAT</span>
              <span className="font-mono font-medium tabular-nums">
                {formatVndAmount(cartSummary.tax)}
              </span>
            </div>
          ) : null}

          <Separator />

          <div className="flex items-center justify-between text-base font-semibold">
            <span>Khách cần trả</span>
            <span className="font-mono text-lg text-primary tabular-nums">
              {formatVndAmount(cartSummary.total)}
            </span>
          </div>

          <div className="flex flex-col gap-2 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Hình thức thanh toán
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  onUpdateActiveTab((prev) => ({
                    ...prev,
                    payments: [
                      ...prev.payments,
                      {
                        method: "BANK_TRANSFER_QR",
                        amount:
                          remainingDue > 0
                            ? formatMoneyForInput(String(remainingDue))
                            : "0",
                        referenceNo: "",
                      },
                    ],
                  }))
                }
              >
                <PlusIcon data-icon="inline-start" />
                Thêm phương thức
              </Button>
            </div>

            {activeTab.payments.map((payment, idx) => (
              <div
                key={idx}
                className="flex flex-col gap-1.5 rounded-md border p-2"
              >
                <div className="flex items-center gap-1.5">
                  <Select
                    value={payment.method}
                    onValueChange={(value) => {
                      if (!value) return;
                      onUpdateActiveTab((prev) => ({
                        ...prev,
                        payments: prev.payments.map((p, i) =>
                          i === idx
                            ? { ...p, method: value as PaymentMethod }
                            : p,
                        ),
                      }));
                    }}
                  >
                    <SelectTrigger size="sm" className="w-40">
                      <SelectValue>
                        {PAYMENT_METHOD_LABELS[payment.method]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {PAYMENT_METHODS.map((method) => (
                          <SelectItem key={method} value={method}>
                            {PAYMENT_METHOD_LABELS[method]}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>

                  <Input
                    aria-label={`Số tiền thanh toán ${idx + 1}`}
                    inputMode="numeric"
                    className="h-9 flex-1 text-right font-mono tabular-nums"
                    value={payment.amount}
                    onChange={(e) =>
                      onUpdateActiveTab((prev) => ({
                        ...prev,
                        payments: prev.payments.map((p, i) =>
                          i === idx ? { ...p, amount: e.target.value } : p,
                        ),
                      }))
                    }
                  />

                  {activeTab.payments.length > 1 ? (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Xóa phương thức thanh toán ${idx + 1}`}
                      onClick={() =>
                        onUpdateActiveTab((prev) => ({
                          ...prev,
                          payments: prev.payments.filter((_, i) => i !== idx),
                        }))
                      }
                    >
                      <XIcon />
                    </Button>
                  ) : null}
                </div>

                {payment.method !== "CASH" ? (
                  <Input
                    aria-label={`Mã tham chiếu giao dịch ${idx + 1}`}
                    className="h-8 text-xs"
                    placeholder="Mã giao dịch QR / Số chuẩn chi thẻ..."
                    value={payment.referenceNo}
                    onChange={(e) =>
                      onUpdateActiveTab((prev) => ({
                        ...prev,
                        payments: prev.payments.map((p, i) =>
                          i === idx
                            ? { ...p, referenceNo: e.target.value }
                            : p,
                        ),
                      }))
                    }
                  />
                ) : null}
              </div>
            ))}

            {hasBankTransfer ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() =>
                  setQrPreviewAmount(
                    String(
                      bankTransferAmount > 0
                        ? bankTransferAmount
                        : totalDueNum,
                    ),
                  )
                }
              >
                <QrCodeIcon data-icon="inline-start" />
                Hiển thị mã VietQR cho khách quét
              </Button>
            ) : null}

            <div className="flex flex-wrap gap-1.5 pt-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-9"
                onClick={() =>
                  onUpdateActiveTab((prev) => ({
                    ...prev,
                    payments: prev.payments.map((p, i) =>
                      i === 0
                        ? { ...p, amount: formatMoneyForInput(cartSummary.total) }
                        : p,
                    ),
                  }))
                }
              >
                Đủ tiền
              </Button>
              {QUICK_CASH_NOTES.map((note) => (
                <Button
                  key={note.label}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-9"
                  onClick={() =>
                    onUpdateActiveTab((prev) => ({
                      ...prev,
                      payments: prev.payments.map((p, i) =>
                        i === 0
                          ? { ...p, method: "CASH", amount: note.amount }
                          : p,
                      ),
                    }))
                  }
                >
                  {note.label}
                </Button>
              ))}
            </div>
          </div>

          {changeDueFormatted !== null ? (
            <div className="flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-2 text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <CheckCircle2Icon className="size-4 text-primary" />
                Tiền thừa trả khách
              </span>
              <span className="font-mono font-semibold tabular-nums">
                {formatVndAmount(changeDueFormatted)}
              </span>
            </div>
          ) : activeTab.items.length > 0 ? (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Cần thanh toán thêm</span>
              <span className="font-mono font-medium text-destructive tabular-nums">
                {formatVndAmount(remainingDue)}
              </span>
            </div>
          ) : null}
        </CardContent>

        <CardFooter className="sticky bottom-0 flex gap-2 bg-card/95 backdrop-blur-xs">
          <Button
            variant="outline"
            size="touch"
            className="flex-1"
            type="button"
            disabled={!hasActiveReceipt}
            onClick={onOpenReceiptModal}
          >
            <PrinterIcon data-icon="inline-start" />
            In lại bill
          </Button>
          <Button
            size="touch"
            className="flex-1"
            type="button"
            disabled={
              !currentShift ||
              activeTab.items.length === 0 ||
              checkoutPending
            }
            onClick={onCheckout}
          >
            <CreditCardIcon data-icon="inline-start" />
            {checkoutPending ? "Đang thanh toán..." : "Thanh toán (F9)"}
          </Button>
        </CardFooter>
      </Card>

      <Dialog
        open={qrPreviewAmount !== null}
        onOpenChange={(open) => {
          if (!open) setQrPreviewAmount(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCodeIcon className="size-4 text-primary" />
              Mã VietQR Thanh toán
            </DialogTitle>
            <DialogDescription>
              Khách hàng quét mã bằng ứng dụng ngân hàng để thanh toán chuyển
              khoản tại {shopName}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted/20 p-4">
            <div className="flex size-44 items-center justify-center rounded-lg border bg-background p-3">
              <QrCodeIcon className="size-32 text-foreground" />
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Số tiền cần chuyển</p>
              <p className="font-mono text-xl font-semibold text-primary tabular-nums">
                {formatVndAmount(qrPreviewAmount ?? "0")}
              </p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                Nội dung: {activeTab.label} · {branchName}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setQrPreviewAmount(null)}
            >
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
