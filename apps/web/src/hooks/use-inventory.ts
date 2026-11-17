"use client";

import type {
  BalanceStockCountInput,
  CompletePurchaseOrderInput,
  CreatePurchaseOrderInput,
  CreateStockCountInput,
  CreateSupplierInput,
  InventoryLedgerListResponse,
  InventoryListResponse,
  InventoryMovementType,
  PurchaseOrderItemResponse,
  PurchaseOrderListResponse,
  PurchaseOrderStatus,
  StockCountItemResponse,
  StockCountListResponse,
  StockCountStatus,
  SupplierItem,
  UpdateSupplierInput,
} from "@smart-pos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export const inventoryKeys = {
  all: ["inventory"] as const,
  stock: (filters: InventoryFilters) =>
    [...inventoryKeys.all, "stock", filters] as const,
  ledgers: (filters: LedgerFilters) =>
    [...inventoryKeys.all, "ledgers", filters] as const,
  suppliers: () => [...inventoryKeys.all, "suppliers"] as const,
  purchaseOrders: (filters: PoFilters) =>
    [...inventoryKeys.all, "po", filters] as const,
  stockCounts: (filters: StockCountFilters) =>
    [...inventoryKeys.all, "stock-counts", filters] as const,
};

export interface InventoryFilters {
  page?: number;
  limit?: number;
  branchId?: string;
  categoryId?: string;
  search?: string;
  lowStockOnly?: boolean;
}

export interface LedgerFilters {
  page?: number;
  limit?: number;
  branchId?: string;
  variantId?: string;
  movementType?: InventoryMovementType;
  search?: string;
}

export interface PoFilters {
  page?: number;
  limit?: number;
  branchId?: string;
  status?: PurchaseOrderStatus;
  search?: string;
}

export interface StockCountFilters {
  page?: number;
  limit?: number;
  branchId?: string;
  status?: StockCountStatus;
  search?: string;
}

function buildSearchParams(
  entries: Record<string, string | number | boolean | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(entries)) {
    if (v === undefined || v === "" || v === false) continue;
    params.set(k, String(v));
  }
  const str = params.toString();
  return str ? `?${str}` : "";
}

export function useInventory(filters: InventoryFilters = {}, enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.stock(filters),
    queryFn: () =>
      apiFetch<InventoryListResponse>(
        `/inventory${buildSearchParams({
          page: filters.page,
          limit: filters.limit,
          branchId: filters.branchId,
          categoryId: filters.categoryId,
          search: filters.search?.trim(),
          lowStockOnly: filters.lowStockOnly,
        })}`,
      ),
    enabled,
  });
}

export function useInventoryLedgers(
  filters: LedgerFilters = {},
  enabled = true,
) {
  return useQuery({
    queryKey: inventoryKeys.ledgers(filters),
    queryFn: () =>
      apiFetch<InventoryLedgerListResponse>(
        `/inventory/ledgers${buildSearchParams({
          page: filters.page,
          limit: filters.limit,
          branchId: filters.branchId,
          variantId: filters.variantId,
          movementType: filters.movementType,
          search: filters.search?.trim(),
        })}`,
      ),
    enabled,
  });
}

export function useSuppliers(enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.suppliers(),
    queryFn: () => apiFetch<SupplierItem[]>("/suppliers"),
    enabled,
  });
}

export function useCreateSupplier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSupplierInput) =>
      apiFetch<SupplierItem>("/suppliers", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: inventoryKeys.suppliers(),
      });
    },
  });
}

export function useUpdateSupplier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSupplierInput }) =>
      apiFetch<SupplierItem>(`/suppliers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: inventoryKeys.suppliers(),
      });
    },
  });
}

export function usePurchaseOrders(filters: PoFilters = {}, enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.purchaseOrders(filters),
    queryFn: () =>
      apiFetch<PurchaseOrderListResponse>(
        `/purchase-orders${buildSearchParams({
          page: filters.page,
          limit: filters.limit,
          branchId: filters.branchId,
          status: filters.status,
          search: filters.search?.trim(),
        })}`,
      ),
    enabled,
  });
}

export function useCreatePurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePurchaseOrderInput) =>
      apiFetch<PurchaseOrderItemResponse>("/purchase-orders", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
    },
  });
}

export function useCompletePurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: CompletePurchaseOrderInput;
    }) =>
      apiFetch<PurchaseOrderItemResponse>(`/purchase-orders/${id}/complete`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
    },
  });
}

export function useCancelPurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<PurchaseOrderItemResponse>(`/purchase-orders/${id}/cancel`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useStockCounts(
  filters: StockCountFilters = {},
  enabled = true,
) {
  return useQuery({
    queryKey: inventoryKeys.stockCounts(filters),
    queryFn: () =>
      apiFetch<StockCountListResponse>(
        `/stock-counts${buildSearchParams({
          page: filters.page,
          limit: filters.limit,
          branchId: filters.branchId,
          status: filters.status,
          search: filters.search?.trim(),
        })}`,
      ),
    enabled,
  });
}

export function useCreateStockCount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStockCountInput) =>
      apiFetch<StockCountItemResponse>("/stock-counts", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
    },
  });
}

export function useBalanceStockCount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: BalanceStockCountInput;
    }) =>
      apiFetch<StockCountItemResponse>(`/stock-counts/${id}/balance`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
    },
  });
}

export function useCancelStockCount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<StockCountItemResponse>(`/stock-counts/${id}/cancel`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}
