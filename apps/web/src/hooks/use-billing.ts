"use client";

import type {
  SubscribePlanInput,
  SubscriptionBillingItem,
  SubscriptionOverviewResponse,
} from "@smart-pos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { authKeys } from "./use-auth";

export const billingKeys = {
  all: ["billing"] as const,
  subscription: () => [...billingKeys.all, "subscription"] as const,
};

export function useBillingOverview(enabled = true) {
  return useQuery({
    queryKey: billingKeys.subscription(),
    enabled,
    queryFn: () =>
      apiFetch<SubscriptionOverviewResponse>("/billing/subscription"),
  });
}

export function useSubscribePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SubscribePlanInput) =>
      apiFetch<SubscriptionBillingItem>("/billing/subscribe", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: billingKeys.all });
      void queryClient.invalidateQueries({ queryKey: authKeys.me() });
    },
  });
}
