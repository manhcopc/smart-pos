"use client";

import type {
  AdjustCustomerLoyaltyInput,
  CreateCustomerInput,
  CustomerDetailResponse,
  CustomerItem,
  UpdateCustomerInput,
} from "@smart-pos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export const customerKeys = {
  all: ["customers"] as const,
  list: (search?: string, page = 1) =>
    [...customerKeys.all, "list", search ?? "", page] as const,
  detail: (customerId: string) =>
    [...customerKeys.all, "detail", customerId] as const,
};

export function useCustomers(
  params: { search?: string; page?: number; limit?: number } = {},
  enabled = true,
) {
  const sp = new URLSearchParams();
  if (params.search?.trim()) sp.set("search", params.search.trim());
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));

  return useQuery({
    queryKey: customerKeys.list(params.search, params.page ?? 1),
    enabled,
    queryFn: () =>
      apiFetch<{
        items: CustomerItem[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>(`/customers?${sp.toString()}`),
  });
}

export function useCustomerDetail(customerId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: customerKeys.detail(customerId ?? ""),
    enabled: Boolean(customerId && enabled),
    queryFn: () => apiFetch<CustomerDetailResponse>(`/customers/${customerId}`),
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomerInput) =>
      apiFetch<CustomerItem>("/customers", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      customerId,
      data,
    }: {
      customerId: string;
      data: UpdateCustomerInput;
    }) =>
      apiFetch<CustomerItem>(`/customers/${customerId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}

export function useAdjustCustomerLoyalty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      customerId,
      data,
    }: {
      customerId: string;
      data: AdjustCustomerLoyaltyInput;
    }) =>
      apiFetch<CustomerItem>(`/customers/${customerId}/loyalty-adjust`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customerKeys.all });
    },
  });
}
