"use client";

import type {
  AccountingExportQuery,
  ApiKeyItem,
  CreateApiKeyInput,
  CreateApiKeyResponse,
  CreateWebhookInput,
  UpdateWebhookInput,
  WebhookDeliveryItem,
  WebhookEndpointItem,
} from "@smart-pos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiClientError,
  apiFetch,
  getApiBaseUrl,
  triggerBlobDownload,
} from "@/lib/api-client";
import { isMockDataMode } from "@/lib/data-mode";
import {
  buildMockDownloadBlob,
  makeAccountingMockFileName,
} from "@/lib/mock-data/mock-router";

export const integrationKeys = {
  all: ["integrations"] as const,
  apiKeys: () => [...integrationKeys.all, "api-keys"] as const,
  webhooks: () => [...integrationKeys.all, "webhooks"] as const,
  deliveries: () => [...integrationKeys.all, "deliveries"] as const,
};

export function useApiKeys(enabled = true) {
  return useQuery({
    queryKey: integrationKeys.apiKeys(),
    enabled,
    queryFn: () => apiFetch<ApiKeyItem[]>("/integrations/api-keys"),
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApiKeyInput) =>
      apiFetch<CreateApiKeyResponse>("/integrations/api-keys", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: integrationKeys.apiKeys() });
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (keyId: string) =>
      apiFetch<ApiKeyItem>(`/integrations/api-keys/${keyId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: integrationKeys.apiKeys() });
    },
  });
}

export function useWebhooks(enabled = true) {
  return useQuery({
    queryKey: integrationKeys.webhooks(),
    enabled,
    queryFn: () => apiFetch<WebhookEndpointItem[]>("/integrations/webhooks"),
  });
}

export function useCreateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWebhookInput) =>
      apiFetch<WebhookEndpointItem>("/integrations/webhooks", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: integrationKeys.webhooks() });
    },
  });
}

export function useUpdateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateWebhookInput }) =>
      apiFetch<WebhookEndpointItem>(`/integrations/webhooks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: integrationKeys.webhooks() });
    },
  });
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/integrations/webhooks/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: integrationKeys.webhooks() });
      void queryClient.invalidateQueries({
        queryKey: integrationKeys.deliveries(),
      });
    },
  });
}

export function useWebhookDeliveries(enabled = true) {
  return useQuery({
    queryKey: integrationKeys.deliveries(),
    enabled,
    queryFn: () =>
      apiFetch<WebhookDeliveryItem[]>("/integrations/webhooks/deliveries?limit=30"),
  });
}

export function useTestWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (endpointId: string) =>
      apiFetch<{ enqueued: true }>(`/integrations/webhooks/${endpointId}/test`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: integrationKeys.deliveries(),
      });
    },
  });
}

export async function downloadAccountingWorkbook(
  query: AccountingExportQuery = {},
): Promise<{ fileName: string; sizeBytes: number }> {
  if (isMockDataMode()) {
    const fileName = makeAccountingMockFileName(query);
    const blob = buildMockDownloadBlob("/integrations/accounting/export");
    triggerBlobDownload(blob, fileName);
    return { fileName, sizeBytes: blob.size };
  }

  const sp = new URLSearchParams();
  if (query.branchId) sp.set("branchId", query.branchId);
  if (query.from) sp.set("from", query.from);
  if (query.to) sp.set("to", query.to);
  const qs = sp.toString();
  const url = `${getApiBaseUrl()}/integrations/accounting/export${qs ? `?${qs}` : ""}`;

  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new ApiClientError(
      "Không thể xuất sổ kế toán Excel",
      response.status,
    );
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const fileMatch = /filename="([^"]+)"/.exec(disposition);
  const fileName = fileMatch?.[1] ?? "smartpos-accounting-ledger.xlsx";

  triggerBlobDownload(blob, fileName);

  return { fileName, sizeBytes: blob.size };
}
