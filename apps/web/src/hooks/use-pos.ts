"use client";

import type {
  CloseShiftInput,
  CreateInvoiceInput,
  InvoiceReceiptResponse,
  OpenShiftInput,
  PosCatalogSyncResponse,
  PosStockStreamEvent,
  RegisterShiftItem,
  ShiftZReportResponse,
} from "@smart-pos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiFetch, getApiBaseUrl } from "@/lib/api-client";
import {
  applyPosStockPatch,
  type CachedPosCatalog,
  mergePosCatalogDelta,
  readCachedPosCatalog,
  writeCachedPosCatalog,
} from "@/lib/pos-indexeddb";
import { inventoryKeys } from "./use-inventory";

export const posKeys = {
  all: ["pos"] as const,
  catalog: (tenantId: string, branchId: string) =>
    [...posKeys.all, "catalog", tenantId, branchId] as const,
  currentShift: (branchId: string) =>
    [...posKeys.all, "shift-current", branchId] as const,
  zReport: (shiftId: string) => [...posKeys.all, "z-report", shiftId] as const,
  invoices: (branchId: string, shiftId?: string) =>
    [...posKeys.all, "invoices", branchId, shiftId ?? "all"] as const,
};

export function usePosCatalog(
  tenantId: string | undefined,
  branchId: string | undefined,
  enabled = true,
) {
  const queryClient = useQueryClient();
  const [sseConnected, setSseConnected] = useState(false);

  const query = useQuery({
    queryKey: posKeys.catalog(tenantId ?? "", branchId ?? ""),
    enabled: Boolean(tenantId && branchId && enabled),
    staleTime: 15_000,
    queryFn: async (): Promise<CachedPosCatalog> => {
      const tId = tenantId!;
      const bId = branchId!;
      const cached = await readCachedPosCatalog(tId, bId);

      const sinceParam = cached?.serverTimestamp
        ? `&since=${encodeURIComponent(cached.serverTimestamp)}`
        : "";
      const syncResponse = await apiFetch<PosCatalogSyncResponse>(
        `/pos/catalog-sync?branchId=${bId}${sinceParam}`,
      );

      const merged = mergePosCatalogDelta(tId, cached, syncResponse);
      await writeCachedPosCatalog(merged);
      return merged;
    },
  });

  useEffect(() => {
    if (
      !tenantId ||
      !branchId ||
      !enabled ||
      typeof EventSource === "undefined"
    ) {
      return;
    }

    const url = `${getApiBaseUrl()}/pos/events?branchId=${encodeURIComponent(branchId)}`;
    const source = new EventSource(url, { withCredentials: true });

    source.onopen = () => setSseConnected(true);
    source.onerror = () => setSseConnected(false);

    source.addEventListener("STOCK_UPDATED", (event) => {
      setSseConnected(true);
      try {
        const parsed = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as PosStockStreamEvent;
        if (!parsed.items || parsed.items.length === 0) return;

        queryClient.setQueryData<CachedPosCatalog>(
          posKeys.catalog(tenantId, branchId),
          (prev) => {
            if (!prev) return prev;
            const next = applyPosStockPatch(prev, parsed.items!);
            void writeCachedPosCatalog(next);
            return next;
          },
        );
      } catch {
        // Ignore malformed SSE payload safely.
      }
    });

    return () => {
      setSseConnected(false);
      source.close();
    };
  }, [tenantId, branchId, enabled, queryClient]);

  return {
    ...query,
    sseConnected,
  };
}

export function useCurrentShift(branchId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: posKeys.currentShift(branchId ?? ""),
    enabled: Boolean(branchId && enabled),
    queryFn: () =>
      apiFetch<{ shift: RegisterShiftItem | null }>(
        `/pos/shifts/current?branchId=${branchId}`,
      ),
  });
}

export function useOpenShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: OpenShiftInput) =>
      apiFetch<RegisterShiftItem>("/pos/shifts/open", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (shift) => {
      void queryClient.invalidateQueries({
        queryKey: posKeys.currentShift(shift.branchId),
      });
    },
  });
}

export function useShiftZReport(shiftId: string | undefined, enabled = false) {
  return useQuery({
    queryKey: posKeys.zReport(shiftId ?? ""),
    enabled: Boolean(shiftId && enabled),
    queryFn: () => apiFetch<ShiftZReportResponse>(`/pos/shifts/${shiftId}/z-report`),
  });
}

export function useCloseShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      shiftId,
      data,
    }: {
      shiftId: string;
      data: CloseShiftInput;
    }) =>
      apiFetch<ShiftZReportResponse>(`/pos/shifts/${shiftId}/close`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (zReport) => {
      void queryClient.invalidateQueries({
        queryKey: posKeys.currentShift(zReport.shift.branchId),
      });
    },
  });
}

export function usePosInvoices(
  branchId: string | undefined,
  shiftId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: posKeys.invoices(branchId ?? "", shiftId),
    enabled: Boolean(branchId && shiftId && enabled),
    queryFn: () =>
      apiFetch<{
        items: InvoiceReceiptResponse[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>(`/pos/invoices?branchId=${branchId}&shiftId=${shiftId}&limit=30`),
  });
}

export function usePosCheckout(tenantId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInvoiceInput) =>
      apiFetch<InvoiceReceiptResponse>("/pos/invoices", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (receipt) => {
      void queryClient.invalidateQueries({
        queryKey: posKeys.currentShift(receipt.branchId),
      });
      void queryClient.invalidateQueries({
        queryKey: posKeys.invoices(receipt.branchId, receipt.shiftId),
      });
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      if (tenantId) {
        void queryClient.invalidateQueries({
          queryKey: posKeys.catalog(tenantId, receipt.branchId),
        });
      }
    },
  });
}
