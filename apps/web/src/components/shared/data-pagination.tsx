"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DataPaginationProps {
  page: number;
  totalPages: number;
  totalItems?: number;
  onPageChange: (nextPage: number) => void;
}

export function DataPagination({
  page,
  totalPages,
  totalItems,
  onPageChange,
}: DataPaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label="Phân trang danh sách"
      className="flex flex-wrap items-center justify-between gap-3 pt-2"
    >
      <span className="text-xs text-muted-foreground">
        Trang {page} / {totalPages}
        {typeof totalItems === "number" ? ` · Tổng ${totalItems} mục` : ""}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          <ChevronLeftIcon data-icon="inline-start" />
          Trang trước
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        >
          Trang sau
          <ChevronRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </nav>
  );
}
