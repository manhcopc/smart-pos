import {
  type AuthProfileResponse,
  type CatalogListResponse,
  type InvoiceReceiptResponse,
  type OfflineSyncBatchResponse,
  type PosCatalogSyncResponse,
  type SubscriptionBillingItem,
} from "@smart-pos/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClientError, apiFetch } from "../api-client";
import {
  clearDataModeOverride,
  getDataMode,
  setDataMode,
  setMockRole,
} from "../data-mode";
import { resetMockState } from "../mock-data/mock-router";
import { MOCK_IDS } from "../mock-data/seed-fixtures";

describe("MockData & DataMode Switcher", () => {
  beforeEach(() => {
    clearDataModeOverride();
    setMockRole("OWNER");
    resetMockState();
  });

  afterEach(() => {
    clearDataModeOverride();
    setMockRole("OWNER");
    resetMockState();
  });

  it("defaults to real data mode when no override or env is set", () => {
    expect(getDataMode()).toBe("real");
  });

  it("serves interactive Vietnamese mock data across auth roles, catalog, POS checkout, offline sync conflicts, and SaaS billing", async () => {
    setDataMode("mock");
    expect(getDataMode()).toBe("mock");

    setMockRole("OWNER");
    const ownerProfile = await apiFetch<AuthProfileResponse>("/auth/me");
    expect(ownerProfile.redirectTo).toBe("/dashboard");
    expect(ownerProfile.member.role).toBe("OWNER");

    setMockRole("CASHIER");
    const cashierProfile = await apiFetch<AuthProfileResponse>("/auth/me");
    expect(cashierProfile.redirectTo).toBe("/pos");
    expect(cashierProfile.member.role).toBe("CASHIER");

    const catalog = await apiFetch<CatalogListResponse>("/products");
    expect(catalog.items.length).toBeGreaterThanOrEqual(6);

    const posCatalog = await apiFetch<PosCatalogSyncResponse>(
      `/pos/catalog-sync?branchId=${MOCK_IDS.branchCn01}`,
    );
    const espresso = posCatalog.items.find((i) => i.sku === "CF-SUA-M")!;
    expect(Number(espresso.available)).toBe(48);

    // Online mock checkout deducts available stock
    const receipt = await apiFetch<InvoiceReceiptResponse>("/pos/invoices", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: "11111111-1111-4111-8111-111111111119",
        branchId: MOCK_IDS.branchCn01,
        shiftId: MOCK_IDS.shiftOpen,
        discountAmount: "0.00",
        syncSource: "ONLINE",
        items: [
          {
            variantId: espresso.variantId,
            quantity: "2.000",
            discountAmount: "0.00",
          },
        ],
        payments: [{ method: "CASH", amount: "58000.00" }],
      }),
    });
    expect(receipt.totalAmount).toBe("58000.00");

    const afterPosCatalog = await apiFetch<PosCatalogSyncResponse>(
      `/pos/catalog-sync?branchId=${MOCK_IDS.branchCn01}`,
    );
    expect(
      Number(
        afterPosCatalog.items.find((i) => i.sku === "CF-SUA-M")!.available,
      ),
    ).toBe(46);

    // Offline sync exceeding stock returns CONFLICT + latestStock
    const syncRes = await apiFetch<OfflineSyncBatchResponse>(
      "/pos/offline-sync/invoices",
      {
        method: "POST",
        body: JSON.stringify({
          invoices: [
            {
              queuedAt: new Date().toISOString(),
              payload: {
                idempotencyKey: "22222222-2222-4222-8222-222222222229",
                branchId: MOCK_IDS.branchCn01,
                shiftId: MOCK_IDS.shiftOpen,
                discountAmount: "0.00",
                syncSource: "OFFLINE_SYNC",
                items: [
                  {
                    variantId: espresso.variantId,
                    quantity: "999.000",
                    discountAmount: "0.00",
                  },
                ],
                payments: [{ method: "CASH", amount: "9990000.00" }],
              },
            },
          ],
        }),
      },
    );
    expect(syncRes.summary.conflicts).toBe(1);
    expect(syncRes.results[0]?.latestStock?.[0]?.available).toBe("46.000");

    // Billing downgrade to LITE blocked by 2 active branches, PRO upgrade succeeds
    setMockRole("OWNER");
    await expect(
      apiFetch<SubscriptionBillingItem>("/billing/subscribe", {
        method: "POST",
        body: JSON.stringify({
          planCode: "LITE",
          billingMonths: 1,
          provider: "INTERNAL_QR",
          confirmImmediately: true,
        }),
      }),
    ).rejects.toThrow(ApiClientError);

    const proUpgrade = await apiFetch<SubscriptionBillingItem>(
      "/billing/subscribe",
      {
        method: "POST",
        body: JSON.stringify({
          planCode: "PRO",
          billingMonths: 1,
          provider: "VNPAY",
          confirmImmediately: true,
        }),
      },
    );
    expect(proUpgrade.planCode).toBe("PRO");

    // Reset restores original stock (48)
    resetMockState();
    const resetCatalog = await apiFetch<PosCatalogSyncResponse>(
      `/pos/catalog-sync?branchId=${MOCK_IDS.branchCn01}`,
    );
    expect(
      Number(resetCatalog.items.find((i) => i.sku === "CF-SUA-M")!.available),
    ).toBe(48);
  });
});
