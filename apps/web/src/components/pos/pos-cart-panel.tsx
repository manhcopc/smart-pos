"use client";

import {
  MinusIcon,
  PlusIcon,
  ShoppingCartIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
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
import { Input } from "@/components/ui/input";
import { formatVndAmount } from "@/lib/labels";
import type { PendingInvoiceTab } from "./types";

interface PosCartPanelProps {
  tabs: readonly PendingInvoiceTab[];
  activeTabIndex: number;
  activeTab: PendingInvoiceTab;
  branchDisplay: string;
  canPriceOverride: boolean;
  canDiscount: boolean;
  onSelectTab: (index: number) => void;
  onAddTab: () => void;
  onCloseTab: (index: number) => void;
  onUpdateActiveTab: (
    updater: (prev: PendingInvoiceTab) => PendingInvoiceTab,
  ) => void;
}

export function PosCartPanel({
  tabs,
  activeTabIndex,
  activeTab,
  branchDisplay,
  canPriceOverride,
  canDiscount,
  onSelectTab,
  onAddTab,
  onCloseTab,
  onUpdateActiveTab,
}: PosCartPanelProps) {
  const [confirmCloseIndex, setConfirmCloseIndex] = useState<number | null>(
    null,
  );
  const pendingTabToClose =
    confirmCloseIndex !== null ? tabs[confirmCloseIndex] : undefined;

  function requestCloseTab(idx: number) {
    const target = tabs[idx];
    if (!target) return;
    if (target.items.length > 0) {
      setConfirmCloseIndex(idx);
      return;
    }
    onCloseTab(idx);
  }

  return (
    <section className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {tabs.map((tab, idx) => (
          <div key={tab.id} className="flex items-center">
            <Button
              type="button"
              size="sm"
              variant={idx === activeTabIndex ? "default" : "outline"}
              onClick={() => onSelectTab(idx)}
            >
              {tab.label}
              {tab.items.length > 0 ? ` (${tab.items.length})` : ""}
            </Button>
            {tabs.length > 1 ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Đóng ${tab.label}`}
                onClick={() => requestCloseTab(idx)}
              >
                <XIcon />
              </Button>
            ) : null}
          </div>
        ))}
        {tabs.length < 6 ? (
          <Button type="button" size="sm" variant="ghost" onClick={onAddTab}>
            <PlusIcon data-icon="inline-start" />
            Thêm tab
          </Button>
        ) : null}
      </div>

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader>
          <CardTitle className="text-base">{activeTab.label}</CardTitle>
          <CardDescription>{branchDisplay}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
          {activeTab.items.length === 0 ? (
            <Empty className="py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ShoppingCartIcon />
                </EmptyMedia>
                <EmptyTitle>Giỏ hàng đang trống</EmptyTitle>
                <EmptyDescription>
                  Quét mã vạch (F2) hoặc chạm vào sản phẩm bên trái để thêm vào
                  hóa đơn.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            activeTab.items.map((line) => (
              <div
                key={line.variantId}
                className="flex flex-col gap-2 rounded-lg border p-2.5 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">{line.name}</span>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {line.sku} ·{" "}
                      {formatVndAmount(
                        line.overrideUnitPrice ?? line.catalogPrice,
                      )}
                    </span>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-touch"
                    aria-label={`Xóa ${line.sku}`}
                    onClick={() =>
                      onUpdateActiveTab((prev) => ({
                        ...prev,
                        items: prev.items.filter(
                          (i) => i.variantId !== line.variantId,
                        ),
                      }))
                    }
                  >
                    <Trash2Icon className="text-destructive" />
                  </Button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      size="icon-touch"
                      variant="outline"
                      aria-label={`Giảm số lượng ${line.sku}`}
                      onClick={() =>
                        onUpdateActiveTab((prev) => ({
                          ...prev,
                          items: prev.items
                            .map((i) => {
                              if (i.variantId !== line.variantId) return i;
                              const next = Math.max(0, Number(i.quantity) - 1);
                              return { ...i, quantity: String(next) };
                            })
                            .filter((i) => Number(i.quantity) > 0),
                        }))
                      }
                    >
                      <MinusIcon />
                    </Button>
                    <Input
                      aria-label={`Số lượng ${line.sku}`}
                      className="h-11 w-16 text-center font-mono tabular-nums"
                      value={line.quantity}
                      onChange={(e) =>
                        onUpdateActiveTab((prev) => ({
                          ...prev,
                          items: prev.items.map((i) =>
                            i.variantId === line.variantId
                              ? { ...i, quantity: e.target.value }
                              : i,
                          ),
                        }))
                      }
                    />
                    <Button
                      type="button"
                      size="icon-touch"
                      variant="outline"
                      aria-label={`Tăng số lượng ${line.sku}`}
                      onClick={() =>
                        onUpdateActiveTab((prev) => ({
                          ...prev,
                          items: prev.items.map((i) =>
                            i.variantId === line.variantId
                              ? {
                                  ...i,
                                  quantity: String(Number(i.quantity) + 1),
                                }
                              : i,
                          ),
                        }))
                      }
                    >
                      <PlusIcon />
                    </Button>
                  </div>

                  <div className="flex items-center gap-2">
                    {canPriceOverride ? (
                      <Input
                        aria-label={`Sửa đơn giá ${line.sku}`}
                        className="h-9 w-24 font-mono text-xs tabular-nums"
                        placeholder="Đơn giá"
                        value={line.overrideUnitPrice ?? line.catalogPrice}
                        onChange={(e) =>
                          onUpdateActiveTab((prev) => ({
                            ...prev,
                            items: prev.items.map((i) =>
                              i.variantId === line.variantId
                                ? { ...i, overrideUnitPrice: e.target.value }
                                : i,
                            ),
                          }))
                        }
                      />
                    ) : null}

                    {canDiscount ? (
                      <Input
                        aria-label={`Giảm giá ${line.sku}`}
                        className="h-9 w-24 font-mono text-xs tabular-nums"
                        placeholder="Giảm dòng"
                        value={line.discountAmount}
                        onChange={(e) =>
                          onUpdateActiveTab((prev) => ({
                            ...prev,
                            items: prev.items.map((i) =>
                              i.variantId === line.variantId
                                ? { ...i, discountAmount: e.target.value }
                                : i,
                            ),
                          }))
                        }
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmCloseIndex !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmCloseIndex(null);
        }}
        title={`Đóng ${pendingTabToClose?.label ?? "hóa đơn"}?`}
        description="Hóa đơn này đang có sản phẩm trong giỏ. Đóng tab sẽ xóa toàn bộ danh sách hàng đã chọn."
        confirmLabel="Đóng tab"
        onConfirm={() => {
          if (confirmCloseIndex !== null) {
            onCloseTab(confirmCloseIndex);
            setConfirmCloseIndex(null);
          }
        }}
      />
    </section>
  );
}
