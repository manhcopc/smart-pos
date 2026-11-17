"use client";

import type {
  AuditActionType,
  AuditLogItem,
  CreateReportExportInput,
  ReportExportJobItem,
  ReportOverviewResponse,
} from "@smart-pos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, getApiBaseUrl } from "@/lib/api-client";

export const reportKeys = {
  all: ["reports"] as const,
  overview: (params: { branchId?: string; from?: string; to?: string }) =>
    [...reportKeys.all, "overview", params] as const,
  exports: () => [...reportKeys.all, "exports"] as const,
  auditLogs: (params: Record<string, string | number | undefined>) =>
    ["audit-logs", params] as const,
};

export function useReportOverview(
  params: { branchId?: string; from?: string; to?: string } = {},
  enabled = true,
) {
  const sp = new URLSearchParams();
  if (params.branchId) sp.set("branchId", params.branchId);
  if (params.from) sp.set("from", params.from);
  if (params.to) sp.set("to", params.to);

  return useQuery({
    queryKey: reportKeys.overview(params),
    enabled,
    queryFn: () =>
      apiFetch<ReportOverviewResponse>(`/reports/overview?${sp.toString()}`),
  });
}

export function useReportExports(enabled = true) {
  return useQuery({
    queryKey: reportKeys.exports(),
    enabled,
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const hasInFlight = items.some(
        (j) => j.status === "PENDING" || j.status === "PROCESSING",
      );
      return hasInFlight ? 2000 : false;
    },
    queryFn: () =>
      apiFetch<{
        items: ReportExportJobItem[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>("/reports/exports?limit=25"),
  });
}

export function useCreateReportExport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReportExportInput) =>
      apiFetch<ReportExportJobItem>("/reports/exports", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: reportKeys.exports() });
    },
  });
}

export function getReportExportDownloadUrl(exportJobId: string): string {
  return `${getApiBaseUrl()}/reports/exports/${exportJobId}/download`;
}

export function useAuditLogs(
  params: {
    page?: number;
    limit?: number;
    branchId?: string;
    action?: AuditActionType;
    from?: string;
    to?: string;
    search?: string;
  } = {},
  enabled = true,
) {
  const sp = new URLSearchParams();
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.branchId) sp.set("branchId", params.branchId);
  if (params.action) sp.set("action", params.action);
  if (params.from) sp.set("from", params.from);
  if (params.to) sp.set("to", params.to);
  if (params.search?.trim()) sp.set("search", params.search.trim());

  return useQuery({
    queryKey: reportKeys.auditLogs(params),
    enabled,
    queryFn: () =>
      apiFetch<{
        items: AuditLogItem[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>(`/audit-logs?${sp.toString()}`),
  });
}
