"use client";

import type {
  CreateStaffMemberInput,
  StaffListResponse,
  StaffMemberItem,
  UpdateStaffMemberInput,
} from "@smart-pos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export const staffKeys = {
  all: ["staff"] as const,
  list: () => [...staffKeys.all, "list"] as const,
};

export function useStaff(enabled = true) {
  return useQuery({
    queryKey: staffKeys.list(),
    queryFn: () => apiFetch<StaffListResponse>("/staff"),
    enabled,
  });
}

export function useCreateStaff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateStaffMemberInput) =>
      apiFetch<StaffMemberItem>("/staff", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: staffKeys.all });
    },
  });
}

export function useUpdateStaff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateStaffMemberInput }) =>
      apiFetch<StaffMemberItem>(`/staff/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: staffKeys.all });
    },
  });
}
