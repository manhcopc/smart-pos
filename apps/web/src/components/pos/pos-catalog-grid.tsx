"use client";

import type {
  PosCatalogCategorySummary,
  PosCatalogItem,
} from "@smart-pos/shared";
import { BoxesIcon, ImageIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { formatVndAmount } from "@/lib/labels";

interface PosCatalogGridProps {
  catalogItemsCount: number;
  categories: readonly PosCatalogCategorySummary[];
  selectedCategoryId: string | null;
  onSelectCategory: (categoryId: string | null) => void;
  items: readonly PosCatalogItem[];
  totalMatched: number;
  hasMore: boolean;
  onLoadMore: () => void;
  isLoading: boolean;
  onAddItem: (item: PosCatalogItem) => void;
}

export function PosCatalogGrid({
  catalogItemsCount,
  categories,
  selectedCategoryId,
  onSelectCategory,
  items,
  totalMatched,
  hasMore,
  onLoadMore,
  isLoading,
  onAddItem,
}: PosCatalogGridProps) {
  return (
    <section className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        <Button
          type="button"
          size="sm"
          variant={selectedCategoryId === null ? "default" : "outline"}
          onClick={() => onSelectCategory(null)}
        >
          Tất cả ({catalogItemsCount})
        </Button>
        {categories.map((cat) => (
          <Button
            key={cat.id}
            type="button"
            size="sm"
            variant={selectedCategoryId === cat.id ? "default" : "outline"}
            onClick={() => onSelectCategory(cat.id)}
          >
            {cat.name}
          </Button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
        {isLoading ? (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <Skeleton key={idx} className="h-28 w-full rounded-lg" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="pt-4">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <BoxesIcon />
                  </EmptyMedia>
                  <EmptyTitle>Không tìm thấy SKU</EmptyTitle>
                  <EmptyDescription>
                    Thử tìm tên khác, quét lại mã vạch hoặc nhập hàng ở trang
                    Quản trị để tăng tồn kho.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => {
                const availableNum = Number(item.available);
                const outOfStock = availableNum <= 0;
                const lowStock =
                  item.minStockAlert > 0 && availableNum <= item.minStockAlert;

                return (
                  <button
                    key={item.variantId}
                    type="button"
                    disabled={outOfStock}
                    onClick={() => onAddItem(item)}
                    className="flex min-h-24 flex-col justify-between gap-2 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <div className="flex items-start gap-2.5">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.productName}
                          loading="lazy"
                          className="size-10 shrink-0 rounded-md border object-cover"
                        />
                      ) : (
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                          <ImageIcon className="size-4" aria-hidden="true" />
                        </div>
                      )}
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="line-clamp-2 text-sm font-medium leading-snug">
                          {item.productName}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {item.variantName} ·{" "}
                          <span className="font-mono">{item.sku}</span>
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="font-mono text-sm font-semibold text-primary tabular-nums">
                        {formatVndAmount(item.salePrice)}
                      </span>
                      <Badge variant={lowStock ? "destructive" : "secondary"}>
                        Tồn: {availableNum}
                      </Badge>
                    </div>
                  </button>
                );
              })}
            </div>

            {totalMatched > items.length ? (
              <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <span>
                  Đang hiện {items.length} / {totalMatched} mặt hàng khớp bộ lọc
                </span>
                {hasMore ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onLoadMore}
                  >
                    <PlusIcon data-icon="inline-start" />
                    Xem thêm
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
