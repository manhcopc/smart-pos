"use client";

import type {
  AuthProfileResponse,
  AuthSessionResponse,
  CashierPinLoginInput,
  OwnerLoginInput,
  RegisterTenantInput,
} from "@smart-pos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export const authKeys = {
  all: ["auth"] as const,
  me: () => [...authKeys.all, "me"] as const,
};

function toProfile(session: AuthSessionResponse): AuthProfileResponse {
  return {
    redirectTo: session.redirectTo,
    user: session.user,
    tenant: session.tenant,
    member: session.member,
    branches: session.branches,
  };
}

export function useMe(enabled = true) {
  return useQuery({
    queryKey: authKeys.me(),
    queryFn: () => apiFetch<AuthProfileResponse>("/auth/me"),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

export function useRegisterTenant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: RegisterTenantInput) =>
      apiFetch<AuthSessionResponse>("/auth/register-tenant", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (session) => {
      queryClient.clear();
      queryClient.setQueryData(authKeys.me(), toProfile(session));
    },
  });
}

export function useOwnerLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: OwnerLoginInput) =>
      apiFetch<AuthSessionResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (session) => {
      queryClient.clear();
      queryClient.setQueryData(authKeys.me(), toProfile(session));
    },
  });
}

export function useCashierPinLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CashierPinLoginInput) =>
      apiFetch<AuthSessionResponse>("/auth/cashier-pin", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (session) => {
      queryClient.clear();
      queryClient.setQueryData(authKeys.me(), toProfile(session));
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiFetch<{ success: true }>("/auth/logout", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSettled: () => {
      queryClient.clear();
    },
  });
}
