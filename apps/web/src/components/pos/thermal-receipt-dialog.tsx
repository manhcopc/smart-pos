"use client";

import type { InvoiceReceiptResponse } from "@smart-pos/shared";
import { PrinterIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { formatVndAmount, PAYMENT_METHOD_LABELS } from "@/lib/labels";

interface ThermalReceiptDialogProps {
  receipt: InvoiceReceiptResponse | null;
  shopName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ThermalReceiptDialog({
  receipt,
  shopName,
  open,
  onOpenChange,
}: ThermalReceiptDialogProps) {
  const [paperSize, setPaperSize] = useState<"K58" | "K80">("K80");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pos-no-print">
          <DialogTitle>Hóa đơn bán hàng {receipt?.code ?? ""}</DialogTitle>
          <DialogDescription>
            Chọn khổ giấy in nhiệt K58 hoặc K80 trước khi in.
          </DialogDescription>
        </DialogHeader>

        <div className="pos-no-print flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={paperSize === "K58" ? "default" : "outline"}
            onClick={() => setPaperSize("K58")}
          >
            Khổ K58 (58mm)
          </Button>
          <Button
            type="button"
            size="sm"
            variant={paperSize === "K80" ? "default" : "outline"}
            onClick={() => setPaperSize("K80")}
          >
            Khổ K80 (80mm)
          </Button>
        </div>

        {receipt ? (
          <div className="flex justify-center overflow-y-auto rounded-lg border bg-muted/20 p-3 max-h-[60vh]">
            <div
              className={`pos-printable-receipt bg-white p-3 font-mono text-xs text-black shadow-xs ${
                paperSize === "K58" ? "w-[220px]" : "w-[300px]"
              }`}
            >
              <div className="flex flex-col items-center gap-0.5 text-center">
                <span className="text-sm font-bold uppercase">{shopName}</span>
                <span>
                  {receipt.branchCode} · {receipt.branchName}
                </span>
                <span className="pt-1 font-semibold">
                  HÓA ĐƠN #{receipt.code}
                </span>
                <span>
                  {new Date(receipt.createdAt).toLocaleString("vi-VN")}
                </span>
                <span>Thu ngân: {receipt.cashierName}</span>
              </div>

              <Separator className="my-2 border-dashed" />

              <div className="flex flex-col gap-1.5">
                {receipt.items.map((item) => (
                  <div key={item.id} className="flex flex-col gap-0.5">
                    <span className="font-medium">{item.productName}</span>
                    <div className="flex justify-between">
                      <span>
                        {Number(item.quantity)} x{" "}
                        {formatVndAmount(item.unitPrice)}
                      </span>
                      <span>{formatVndAmount(item.lineTotal)}</span>
                    </div>
                    {Number(item.discountAmount) > 0 ? (
                      <div className="flex justify-between text-[11px] opacity-80">
                        <span>Giảm giá dòng</span>
                        <span>-{formatVndAmount(item.discountAmount)}</span>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              <Separator className="my-2 border-dashed" />

              <div className="flex flex-col gap-1">
                <div className="flex justify-between">
                  <span>Tạm tính</span>
                  <span>{formatVndAmount(receipt.subtotal)}</span>
                </div>
                {Number(receipt.discountAmount) > 0 ? (
                  <div className="flex justify-between">
                    <span>Chiết khấu</span>
                    <span>-{formatVndAmount(receipt.discountAmount)}</span>
                  </div>
                ) : null}
                {Number(receipt.taxAmount) > 0 ? (
                  <div className="flex justify-between">
                    <span>Thuế VAT</span>
                    <span>{formatVndAmount(receipt.taxAmount)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between text-sm font-bold">
                  <span>TỔNG CỘNG</span>
                  <span>{formatVndAmount(receipt.totalAmount)}</span>
                </div>
              </div>

              <Separator className="my-2 border-dashed" />

              <div className="flex flex-col gap-1">
                {receipt.payments.map((payment) => (
                  <div key={payment.id} className="flex justify-between">
                    <span>{PAYMENT_METHOD_LABELS[payment.method]}</span>
                    <span>{formatVndAmount(payment.amount)}</span>
                  </div>
                ))}
                {Number(receipt.changeGiven) > 0 ? (
                  <div className="flex justify-between font-semibold">
                    <span>Tiền thừa trả khách</span>
                    <span>{formatVndAmount(receipt.changeGiven)}</span>
                  </div>
                ) : null}
              </div>

              <p className="pt-3 text-center text-[11px]">
                Cảm ơn quý khách &amp; Hẹn gặp lại!
              </p>
            </div>
          </div>
        ) : null}

        <DialogFooter className="pos-no-print">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Đóng
          </Button>
          <Button
            type="button"
            onClick={() => window.print()}
            disabled={!receipt}
          >
            <PrinterIcon data-icon="inline-start" />
            In hóa đơn ({paperSize})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
