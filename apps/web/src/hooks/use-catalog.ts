"use client";

import type {
  CatalogImportResponse,
  CatalogListResponse,
  CategoryItem,
  CreateCategoryInput,
  CreateProductInput,
  PresignedUploadResponse,
  PresignProductImageInput,
  ProductItem,
  ProductVariantInput,
  ProductVariantItem,
  UpdateCategoryInput,
  UpdateProductInput,
  UpdateVariantInput,
} from "@smart-pos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiFetchForm } from "@/lib/api-client";
import { inventoryKeys } from "./use-inventory";

export const catalogKeys = {
  all: ["catalog"] as const,
  categories: () => [...catalogKeys.all, "categories"] as const,
  products: (filters: ProductFilters) =>
    [...catalogKeys.all, "products", filters] as const,
};

export interface ProductFilters {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
  branchId?: string;
  lowStockOnly?: boolean;
  isActive?: boolean;
}

function toQueryString(filters: ProductFilters): string {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.branchId) params.set("branchId", filters.branchId);
  if (filters.lowStockOnly) params.set("lowStockOnly", "true");
  if (filters.isActive !== undefined) {
    params.set("isActive", String(filters.isActive));
  }
  const str = params.toString();
  return str ? `?${str}` : "";
}

export function useCategories(enabled = true) {
  return useQuery({
    queryKey: catalogKeys.categories(),
    queryFn: () => apiFetch<CategoryItem[]>("/categories"),
    enabled,
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCategoryInput) =>
      apiFetch<CategoryItem>("/categories", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
    },
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCategoryInput }) =>
      apiFetch<CategoryItem>(`/categories/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
    },
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ success: true }>(`/categories/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
    },
  });
}

export function useProducts(filters: ProductFilters = {}, enabled = true) {
  return useQuery({
    queryKey: catalogKeys.products(filters),
    queryFn: () =>
      apiFetch<CatalogListResponse>(`/products${toQueryString(filters)}`),
    enabled,
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProductInput) =>
      apiFetch<ProductItem>("/products", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProductInput }) =>
      apiFetch<ProductItem>(`/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useAddVariant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      productId,
      data,
    }: {
      productId: string;
      data: ProductVariantInput;
    }) =>
      apiFetch<ProductVariantItem>(`/products/${productId}/variants`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useUpdateVariant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      productId,
      variantId,
      data,
    }: {
      productId: string;
      variantId: string;
      data: UpdateVariantInput;
    }) =>
      apiFetch<ProductVariantItem>(
        `/products/${productId}/variants/${variantId}`,
        {
          method: "PATCH",
          body: JSON.stringify(data),
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function usePresignProductImage() {
  return useMutation({
    mutationFn: (input: PresignProductImageInput) =>
      apiFetch<PresignedUploadResponse>("/products/upload-url", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}

export function useImportCatalog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return apiFetchForm<CatalogImportResponse>("/products/import", formData);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}
