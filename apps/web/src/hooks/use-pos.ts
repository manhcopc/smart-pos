"use client";

import type {
  CashDrawerOpenInput,
  CloseShiftInput,
  CreateInvoiceInput,
  CreateSalesReturnInput,
  InvoiceDetailResponse,
  InvoiceReceiptResponse,
  OfflineSyncBatchInput,
  OfflineSyncBatchResponse,
  OpenShiftInput,
  PosCatalogSyncResponse,
  PosStockStreamEvent,
  RegisterShiftItem,
  SalesReturnResponse,
  ShiftZReportResponse,
  SupervisorApprovalResponse,
  SupervisorPinVerifyInput,
  VoidInvoiceInput,
} from "@smart-pos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiFetch, getApiBaseUrl } from "@/lib/api-client";
import { isMockDataMode } from "@/lib/data-mode";
import {
  applyPosStockPatch,
  type CachedPosCatalog,
  mergePosCatalogDelta,
  readCachedPosCatalog,
  writeCachedPosCatalog,
} from "@/lib/pos-indexeddb";
import { inventoryKeys } from "./use-inventory";
import { customerKeys } from "./use-customers";
import { reportKeys } from "./use-reports";

export const posKeys = {
  all: ["pos"] as const,
  catalog: (tenantId: string, branchId: string) =>
    [...posKeys.all, "catalog", tenantId, branchId] as const,
  currentShift: (branchId: string) =>
    [...posKeys.all, "shift-current", branchId] as const,
  zReport: (shiftId: string) => [...posKeys.all, "z-report", shiftId] as const,
  invoices: (branchId: string, shiftId?: string) =>
    [...posKeys.all, "invoices", branchId, shiftId ?? "all"] as const,
  invoiceDetail: (invoiceId: string) =>
    [...posKeys.all, "invoice-detail", invoiceId] as const,
  returns: (branchId?: string) =>
    [...posKeys.all, "returns", branchId ?? "all"] as const,
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
    if (!tenantId || !branchId || !enabled) {
      return;
    }

    if (isMockDataMode()) {
      setSseConnected(true);
      return () => setSseConnected(false);
    }

    if (typeof EventSource === "undefined") {
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
      if (receipt.shiftId) {
        void queryClient.invalidateQueries({
          queryKey: posKeys.invoices(receipt.branchId, receipt.shiftId),
        });
      }
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
      void queryClient.invalidateQueries({ queryKey: reportKeys.all });
      if (tenantId) {
        void queryClient.invalidateQueries({
          queryKey: posKeys.catalog(tenantId, receipt.branchId),
        });
      }
    },
  });
}

export function useOfflineSyncInvoices(tenantId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: OfflineSyncBatchInput) =>
      apiFetch<OfflineSyncBatchResponse>("/pos/offline-sync/invoices", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (_res, variables) => {
      void queryClient.invalidateQueries({ queryKey: posKeys.all });
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
      void queryClient.invalidateQueries({ queryKey: reportKeys.all });
      if (tenantId) {
        const branches = new Set(variables.invoices.map((i) => i.payload.branchId));
        for (const bId of branches) {
          void queryClient.invalidateQueries({
            queryKey: posKeys.catalog(tenantId, bId),
          });
        }
      }
    },
  });
}

export function useSupervisorApprove() {
  return useMutation({
    mutationFn: (input: SupervisorPinVerifyInput) =>
      apiFetch<SupervisorApprovalResponse>("/pos/supervisor-approve", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}

export function useInvoiceDetail(invoiceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: posKeys.invoiceDetail(invoiceId ?? ""),
    enabled: Boolean(invoiceId && enabled),
    queryFn: () => apiFetch<InvoiceDetailResponse>(`/pos/invoices/${invoiceId}`),
  });
}

export function useCreateSalesReturn(tenantId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      invoiceId,
      data,
    }: {
      invoiceId: string;
      data: CreateSalesReturnInput;
    }) =>
      apiFetch<SalesReturnResponse>(`/pos/invoices/${invoiceId}/returns`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (ret) => {
      void queryClient.invalidateQueries({
        queryKey: posKeys.invoiceDetail(ret.invoiceId),
      });
      void queryClient.invalidateQueries({
        queryKey: posKeys.currentShift(ret.branchId),
      });
      void queryClient.invalidateQueries({ queryKey: posKeys.all });
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
      void queryClient.invalidateQueries({ queryKey: reportKeys.all });
      if (tenantId) {
        void queryClient.invalidateQueries({
          queryKey: posKeys.catalog(tenantId, ret.branchId),
        });
      }
    },
  });
}

export function useVoidInvoice(tenantId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      invoiceId,
      data,
    }: {
      invoiceId: string;
      data: VoidInvoiceInput;
    }) =>
      apiFetch<InvoiceReceiptResponse>(`/pos/invoices/${invoiceId}/void`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (receipt) => {
      void queryClient.invalidateQueries({
        queryKey: posKeys.invoiceDetail(receipt.id),
      });
      void queryClient.invalidateQueries({
        queryKey: posKeys.currentShift(receipt.branchId),
      });
      void queryClient.invalidateQueries({ queryKey: posKeys.all });
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
      void queryClient.invalidateQueries({ queryKey: reportKeys.all });
      if (tenantId) {
        void queryClient.invalidateQueries({
          queryKey: posKeys.catalog(tenantId, receipt.branchId),
        });
      }
    },
  });
}

export function useSalesReturns(branchId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: posKeys.returns(branchId),
    enabled,
    queryFn: () => {
      const sp = new URLSearchParams();
      if (branchId) sp.set("branchId", branchId);
      sp.set("limit", "30");
      return apiFetch<{
        items: SalesReturnResponse[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>(`/pos/returns?${sp.toString()}`);
    },
  });
}

export function useOpenCashDrawer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CashDrawerOpenInput) =>
      apiFetch<{ ok: true }>("/pos/cash-drawer/open", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: reportKeys.all });
    },
  });
}
