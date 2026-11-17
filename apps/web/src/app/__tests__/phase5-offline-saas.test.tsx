import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearOfflineInvoiceQueue } from "@/lib/pos-offline-queue";
import { QueryProvider } from "@/providers/query-provider";
import BillingPage from "../(dashboard)/dashboard/billing/page";
import IntegrationsPage from "../(dashboard)/dashboard/integrations/page";
import PosTerminalPage from "../(pos)/pos/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboard/billing",
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const branchId = "11111111-1111-4111-8111-111111111111";
const variantId = "22222222-2222-4222-8222-222222222222";
const shiftId = "33333333-3333-4333-8333-333333333333";

const ownerProfile = {
  redirectTo: "/dashboard",
  user: { id: "u1", email: "owner@shop.vn", fullName: "Chủ Shop" },
  tenant: {
    id: tenantId,
    slug: "shop-p5",
    name: "Cửa hàng Phase 5",
    businessType: "RETAIL",
    planCode: "FREE_TRIAL",
  },
  member: {
    id: "m1",
    employeeCode: "OWNER01",
    role: "OWNER",
    allowedBranchIds: [],
    permissions: [
      "pos:sell",
      "pos:shift_manage",
      "inventory:view",
      "branch:manage",
      "billing:manage",
      "integration:manage",
      "report:financial",
    ],
  },
  branches: [
    {
      id: branchId,
      code: "CN01",
      name: "Chi nhánh Trung tâm",
      isDefault: true,
    },
  ],
};

describe("Phase 5 Offline Queue, SaaS Billing & Omnichannel Integrations UI", () => {
  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    await clearOfflineInvoiceQueue();
  });

  it("queues POS invoice offline, decrements local stock, surfaces INSUFFICIENT_STOCK conflict on reconnect, and resolves to SYNCED", async () => {
    let onlineCheckoutCalled = false;
    let offlineSyncAttempts = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.endsWith("/auth/me")) return jsonResponse(ownerProfile);
        if (url.includes("/pos/catalog-sync")) {
          return jsonResponse({
            branchId,
            serverTimestamp: new Date().toISOString(),
            fullSync: true,
            categories: [{ id: "c1", name: "Cà phê", sortOrder: 0 }],
            items: [
              {
                variantId,
                productId: "p1",
                categoryId: "c1",
                categoryName: "Cà phê",
                productName: "Cà phê Đen",
                variantName: "Ly L",
                sku: "CF-DEN-L",
                barcode: "8931111111111",
                unit: "Ly",
                salePrice: "25000.00",
                taxRate: "0.00",
                minStockAlert: 5,
                imageUrl: null,
                isActive: true,
                onHand: "20.000",
                reserved: "0.000",
                available: "20.000",
                updatedAt: new Date().toISOString(),
              },
            ],
          });
        }
        if (url.includes("/pos/shifts/current")) {
          return jsonResponse({
            shift: {
              id: shiftId,
              branchId,
              branchCode: "CN01",
              branchName: "Chi nhánh Trung tâm",
              openedByMemberId: "m1",
              openedByName: "Chủ Shop",
              closedByMemberId: null,
              closedByName: null,
              status: "OPEN",
              openingCash: "500000.00",
              expectedCash: "500000.00",
              actualCash: null,
              cashVariance: null,
              openedAt: new Date().toISOString(),
              closedAt: null,
              note: null,
            },
          });
        }
        if (url.endsWith("/pos/invoices") && method === "POST") {
          onlineCheckoutCalled = true;
          return jsonResponse({}, 500);
        }
        if (url.endsWith("/pos/offline-sync/invoices") && method === "POST") {
          offlineSyncAttempts += 1;
          const body = JSON.parse(String(init?.body)) as {
            invoices: Array<{ payload: { idempotencyKey: string; items: Array<{ quantity: string }> } }>;
          };
          const key = body.invoices[0]!.payload.idempotencyKey;
          if (offlineSyncAttempts === 1) {
            return jsonResponse({
              summary: { total: 1, synced: 0, conflicts: 1, failed: 0 },
              results: [
                {
                  idempotencyKey: key,
                  status: "CONFLICT",
                  errorCode: "INSUFFICIENT_STOCK",
                  message: "SKU CF-DEN-L chỉ còn 1",
                  latestStock: [
                    { variantId, sku: "CF-DEN-L", available: "1.000" },
                  ],
                },
              ],
            });
          }

          return jsonResponse({
            summary: { total: 1, synced: 1, conflicts: 0, failed: 0 },
            results: [
              {
                idempotencyKey: key,
                status: "SYNCED",
                receipt: {
                  id: "inv-synced-1",
                  code: "HD-SYNC-01",
                  idempotencyKey: key,
                  branchId,
                  branchCode: "CN01",
                  branchName: "Chi nhánh Trung tâm",
                  shiftId,
                  cashierMemberId: "m1",
                  cashierName: "Chủ Shop",
                  status: "COMPLETED",
                  subtotal: "25000.00",
                  discountAmount: "0.00",
                  taxAmount: "0.00",
                  totalAmount: "25000.00",
                  paidAmount: "25000.00",
                  changeGiven: "0.00",
                  createdAt: new Date().toISOString(),
                  items: [],
                  payments: [],
                },
              },
            ],
          });
        }
        return jsonResponse({ items: [], pagination: { page: 1, limit: 30, total: 0, totalPages: 1 } });
      }),
    );

    render(
      <QueryProvider>
        <PosTerminalPage />
      </QueryProvider>,
    );

    await screen.findByText("Cà phê Đen");
    fireEvent.click(screen.getByRole("button", { name: "Chuyển chế độ Offline" }));
    expect(screen.getByText("Đang Offline")).toBeTruthy();

    fireEvent.click(screen.getByText("Cà phê Đen").closest("button")!);
    fireEvent.click(screen.getByText("Cà phê Đen").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Đủ tiền" }));
    fireEvent.click(screen.getByRole("button", { name: /Thanh toán \(F9\)/i }));

    await waitFor(() => {
      expect(screen.getByText(/Hàng đợi Offline \(1\)/i)).toBeTruthy();
    });
    expect(onlineCheckoutCalled).toBe(false);
    expect(screen.getByText("Tồn: 18")).toBeTruthy();

    // Close offline receipt modal before toggling back online
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));

    // Reconnect online -> automatic sync triggers conflict -> dialog opens
    fireEvent.click(screen.getByRole("button", { name: "Chuyển chế độ Offline" }));
    await screen.findByText(/Tồn kho máy chủ: CF-DEN-L: còn 1/i);

    fireEvent.click(
      screen.getByRole("button", { name: /Khớp tồn kho .* & Gửi lại/i }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Hàng đợi Offline/i }),
      ).toBeNull();
    });
    expect(offlineSyncAttempts).toBe(2);
  });

  it("renders BillingPage quotas, shows error when downgrade exceeds active quota, and completes PRO upgrade", async () => {
    let currentPlanCode: "FREE_TRIAL" | "PRO" = "FREE_TRIAL";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.endsWith("/auth/me")) return jsonResponse(ownerProfile);
        if (url.endsWith("/billing/subscription")) {
          const proPlan = {
            id: "plan-pro",
            code: "PRO",
            name: "Gói Pro",
            priceMonthly: "690000.00",
            maxBranches: 10,
            maxUsers: 50,
            maxSkus: 50000,
            storageQuotaMb: 10240,
            features: { posOffline: true, omnichannelApi: true },
          };
          const trialPlan = {
            id: "plan-trial",
            code: "FREE_TRIAL",
            name: "Dùng thử 30 ngày",
            priceMonthly: "0.00",
            maxBranches: 2,
            maxUsers: 5,
            maxSkus: 500,
            storageQuotaMb: 512,
            features: { posOffline: true },
          };
          const litePlan = {
            id: "plan-lite",
            code: "LITE",
            name: "Gói Lite",
            priceMonthly: "290000.00",
            maxBranches: 1,
            maxUsers: 5,
            maxSkus: 2000,
            storageQuotaMb: 1024,
            features: { posOffline: true },
          };

          return jsonResponse({
            tenant: {
              id: tenantId,
              name: "Cửa hàng Phase 5",
              slug: "shop-p5",
              status: "ACTIVE",
              trialEndsAt: "2026-12-01T00:00:00.000Z",
              daysRemaining: 12,
              isTrialExpired: false,
            },
            currentPlan: currentPlanCode === "PRO" ? proPlan : trialPlan,
            usage: { activeBranches: 2, activeUsers: 3, activeSkus: 12 },
            availablePlans: [trialPlan, litePlan, proPlan],
            billingHistory: [],
          });
        }
        if (url.endsWith("/billing/subscribe") && method === "POST") {
          const body = JSON.parse(String(init?.body)) as { planCode: string };
          if (body.planCode === "LITE") {
            return jsonResponse(
              {
                error: {
                  code: "PLAN_QUOTA_EXCEEDED",
                  message: "Vượt hạn mức chi nhánh cho Gói Lite",
                },
              },
              409,
            );
          }
          currentPlanCode = "PRO";
          return jsonResponse({
            id: "bill-1",
            planCode: "PRO",
            billingMonths: 1,
            amount: "690000.00",
            status: "PAID",
            provider: "INTERNAL_QR",
            referenceNo: "BILL-PRO99",
            periodStart: new Date().toISOString(),
            periodEnd: new Date().toISOString(),
            paidAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          });
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryProvider>
        <BillingPage />
      </QueryProvider>,
    );

    await screen.findByText(/Đang dùng thử miễn phí \(còn 12 ngày\)/i);
    expect(screen.getByText("2 / 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Chuyển sang Gói Lite" }));
    await screen.findByText(/Vượt hạn mức chi nhánh cho Gói Lite/i);

    fireEvent.click(screen.getByRole("button", { name: "Chuyển sang Gói Pro" }));
    await waitFor(() => {
      expect(screen.getByText(/Gói hiện tại: Gói Pro/i)).toBeTruthy();
    });
  });

  it("renders IntegrationsPage, issues an API Key once, and downloads Accounting Excel", async () => {
    const keys: Array<{
      id: string;
      name: string;
      keyPrefix: string;
      scopes: string[];
      isActive: boolean;
      lastUsedAt: string | null;
      createdAt: string;
      revokedAt: string | null;
    }> = [];
    let accountingDownloaded = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.endsWith("/auth/me")) return jsonResponse(ownerProfile);
        if (url.endsWith("/integrations/api-keys") && method === "GET") {
          return jsonResponse(keys);
        }
        if (url.endsWith("/integrations/api-keys") && method === "POST") {
          const item = {
            id: "key-uuid-1",
            name: "Website NextJS",
            keyPrefix: "spos_live_aaaaaaaaaaaa",
            scopes: ["inventory:read", "orders:write"],
            isActive: true,
            lastUsedAt: null,
            createdAt: new Date().toISOString(),
            revokedAt: null,
          };
          keys.push(item);
          return jsonResponse({
            apiKey: item,
            plainTextKey: "spos_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_secret1234",
          });
        }
        if (url.endsWith("/integrations/webhooks")) return jsonResponse([]);
        if (url.includes("/integrations/webhooks/deliveries")) return jsonResponse([]);
        if (url.includes("/integrations/accounting/export")) {
          accountingDownloaded = true;
          return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
            status: 200,
            headers: {
              "Content-Disposition": 'attachment; filename="smartpos-acc.xlsx"',
            },
          });
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryProvider>
        <IntegrationsPage />
      </QueryProvider>,
    );

    await screen.findByLabelText("Tên kết nối / Sàn");
    fireEvent.change(screen.getByLabelText("Tên kết nối / Sàn"), {
      target: { value: "Website NextJS" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Phát hành API Key" }));

    await screen.findByText(
      /spos_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_secret1234/i,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Tải Sổ kế toán (.xlsx)" }),
    );
    await waitFor(() => {
      expect(accountingDownloaded).toBe(true);
    });
  });
});
