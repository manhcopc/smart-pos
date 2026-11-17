"use client";

import type {
  CreateStockTransferInput,
  ReceiveStockTransferInput,
  StockTransferItemView,
  StockTransferStatus,
} from "@smart-pos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { inventoryKeys } from "./use-inventory";

export const transferKeys = {
  all: ["stock-transfers"] as const,
  list: (params: { branchId?: string; status?: StockTransferStatus; page?: number }) =>
    [...transferKeys.all, "list", params] as const,
};

export function useStockTransfers(
  params: {
    branchId?: string;
    status?: StockTransferStatus;
    page?: number;
    limit?: number;
  } = {},
  enabled = true,
) {
  const sp = new URLSearchParams();
  if (params.branchId) sp.set("branchId", params.branchId);
  if (params.status) sp.set("status", params.status);
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));

  return useQuery({
    queryKey: transferKeys.list(params),
    enabled,
    queryFn: () =>
      apiFetch<{
        items: StockTransferItemView[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>(`/stock-transfers?${sp.toString()}`),
  });
}

export function useDispatchStockTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStockTransferInput) =>
      apiFetch<StockTransferItemView>("/stock-transfers", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: transferKeys.all });
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useReceiveStockTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      transferId,
      data,
    }: {
      transferId: string;
      data: ReceiveStockTransferInput;
    }) =>
      apiFetch<StockTransferItemView>(`/stock-transfers/${transferId}/receive`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: transferKeys.all });
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useCancelStockTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (transferId: string) =>
      apiFetch<StockTransferItemView>(`/stock-transfers/${transferId}/cancel`, {
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: transferKeys.all });
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}
