"use client";

import { AlertCircleIcon, RefreshCwIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatApiError } from "@/lib/api-client";

export function QueryErrorAlert({
  title,
  error,
  fallbackMessage,
  onRetry,
}: {
  title: string;
  error: unknown;
  fallbackMessage?: string;
  onRetry?: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertCircleIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>{formatApiError(error, fallbackMessage)}</span>
        {onRetry ? (
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            <RefreshCwIcon data-icon="inline-start" />
            Thử lại
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

export function CardGridSkeleton({
  count = 4,
  columnsClass = "grid gap-4 md:grid-cols-2",
}: {
  count?: number;
  columnsClass?: string;
}) {
  return (
    <div className={columnsClass} aria-label="Đang tải dữ liệu">
      {Array.from({ length: count }).map((_, index) => (
        <Card key={index}>
          <CardHeader className="gap-2">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function TableRowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Card aria-label="Đang tải bảng dữ liệu">
      <CardContent className="flex flex-col gap-3 pt-4">
        <Skeleton className="h-6 w-full" />
        {Array.from({ length: rows }).map((_, idx) => (
          <Skeleton key={idx} className="h-9 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
