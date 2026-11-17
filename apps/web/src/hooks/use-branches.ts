"use client";

import type {
  BranchItem,
  BranchListResponse,
  CreateBranchInput,
  UpdateBranchInput,
} from "@smart-pos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { authKeys } from "./use-auth";

export const branchKeys = {
  all: ["branches"] as const,
  list: () => [...branchKeys.all, "list"] as const,
};

export function useBranches(enabled = true) {
  return useQuery({
    queryKey: branchKeys.list(),
    queryFn: () => apiFetch<BranchListResponse>("/branches"),
    enabled,
  });
}

export function useCreateBranch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateBranchInput) =>
      apiFetch<BranchItem>("/branches", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: branchKeys.all });
      void queryClient.invalidateQueries({ queryKey: authKeys.all });
    },
  });
}

export function useUpdateBranch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBranchInput }) =>
      apiFetch<BranchItem>(`/branches/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: branchKeys.all });
      void queryClient.invalidateQueries({ queryKey: authKeys.all });
    },
  });
}
