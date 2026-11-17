import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryProvider } from "@/providers/query-provider";
import AuditLogsPage from "../(dashboard)/dashboard/audit-logs/page";
import CustomersPage from "../(dashboard)/dashboard/customers/page";
import ReportsPage from "../(dashboard)/dashboard/reports/page";
import StockTransfersPage from "../(dashboard)/dashboard/transfers/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboard/reports",
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ownerProfile = {
  redirectTo: "/dashboard",
  user: { id: "u1", email: "owner@shop.vn", fullName: "Chủ Shop" },
  tenant: {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "shop-p4",
    name: "Cửa hàng Phase 4",
    businessType: "RETAIL",
    planCode: "PRO",
  },
  member: {
    id: "22222222-2222-2222-2222-222222222222",
    employeeCode: "OWNER01",
    role: "OWNER",
    allowedBranchIds: [],
    permissions: [
      "report:financial",
      "customer:view",
      "customer:manage",
      "audit:view",
      "inventory:transfer",
      "catalog:manage",
      "inventory:view",
    ],
  },
  branches: [
    {
      id: "33333333-3333-3333-3333-333333333333",
      code: "CN01",
      name: "Chi nhánh Chính",
      isDefault: true,
    },
    {
      id: "44444444-4444-4444-4444-444444444444",
      code: "CN02",
      name: "Chi nhánh Quận 1",
      isDefault: false,
    },
  ],
};

describe("Phase 4 Management UI pages", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders ReportsPage KPIs and enqueues BullMQ Excel export", async () => {
    let enqueuedCalled = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.endsWith("/auth/me")) return jsonResponse(ownerProfile);
        if (url.includes("/reports/overview")) {
          return jsonResponse({
            from: "2026-11-01",
            to: "2026-11-17",
            branchId: null,
            kpis: {
              invoiceCount: 12,
              grossRevenue: "1200000.00",
              discountTotal: "50000.00",
              refundTotal: "100000.00",
              netRevenue: "1050000.00",
              cogsTotal: "600000.00",
              grossProfit: "450000.00",
              averageOrderValue: "87500.00",
              cashTotal: "800000.00",
              transferTotal: "250000.00",
              cardTotal: "0.00",
            },
            dailySeries: [
              {
                date: "2026-11-17",
                invoiceCount: 12,
                grossRevenue: "1200000.00",
                discountTotal: "50000.00",
                refundTotal: "100000.00",
                netRevenue: "1050000.00",
                cogsTotal: "600000.00",
                grossProfit: "450000.00",
              },
            ],
            topProducts: [],
            lowStockAlerts: [],
          });
        }
        if (url.includes("/reports/exports") && method === "GET") {
          return jsonResponse({
            items: [
              {
                id: "55555555-5555-5555-5555-555555555555",
                reportType: "SALES_DETAIL",
                status: "COMPLETED",
                fileName: "smartpos-sales.xlsx",
                rowCount: 12,
                errorMessage: null,
                requestedByName: "Chủ Shop",
                createdAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
              },
            ],
            pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
          });
        }
        if (url.endsWith("/reports/exports") && method === "POST") {
          enqueuedCalled = true;
          return jsonResponse(
            {
              id: "66666666-6666-6666-6666-666666666666",
              reportType: "SALES_DETAIL",
              status: "COMPLETED",
              fileName: "smartpos-sales-new.xlsx",
              rowCount: 12,
              errorMessage: null,
              requestedByName: "Chủ Shop",
              createdAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
            },
            202,
          );
        }
        return jsonResponse({}, 404);
      }),
    );

    render(
      <QueryProvider>
        <ReportsPage />
      </QueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText(/1\.050\.000 ₫/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/450\.000 ₫/).length).toBeGreaterThan(0);
      expect(screen.getByText(/smartpos-sales\.xlsx/)).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: /Xuất XLSX/i }));
    await waitFor(() => {
      expect(enqueuedCalled).toBe(true);
    });
  });

  it("renders CustomersPage, AuditLogsPage, and StockTransfersPage receive flow", async () => {
    let transferReceived = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.endsWith("/auth/me")) return jsonResponse(ownerProfile);
        if (url.includes("/customers?")) {
          return jsonResponse({
            items: [
              {
                id: "77777777-7777-7777-7777-777777777777",
                code: "KH-A01",
                name: "Nguyễn Thị Hoa",
                phone: "0905999888",
                email: null,
                loyaltyPoints: 45,
                totalSpent: "450000.00",
                debtBalance: "0.00",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
            pagination: { page: 1, limit: 30, total: 1, totalPages: 1 },
          });
        }
        if (url.includes("/audit-logs")) {
          return jsonResponse({
            items: [
              {
                id: "88888888-8888-8888-8888-888888888888",
                branchId: ownerProfile.branches[0]!.id,
                branchName: "Chi nhánh Chính",
                actorMemberId: ownerProfile.member.id,
                actorName: "Chủ Shop",
                actorEmployeeCode: "OWNER01",
                action: "INVOICE_VOID",
                entityType: "invoice",
                entityId: "99999999-9999-9999-9999-999999999999",
                metadata: { invoiceCode: "HD-261117-01", reason: "Khách hủy" },
                ipAddress: "127.0.0.1",
                createdAt: new Date().toISOString(),
              },
            ],
            pagination: { page: 1, limit: 30, total: 1, totalPages: 1 },
          });
        }
        if (url.includes("/products")) {
          return jsonResponse({
            items: [],
            pagination: { page: 1, limit: 50, total: 0, totalPages: 1 },
            quota: { activeSkus: 0, maxSkus: 500 },
          });
        }
        if (url.includes("/stock-transfers?")) {
          return jsonResponse({
            items: [
              {
                id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                code: "CK-261117-001",
                status: transferReceived ? "RECEIVED" : "IN_TRANSIT",
                fromBranchId: ownerProfile.branches[0]!.id,
                fromBranchName: "Chi nhánh Chính",
                toBranchId: ownerProfile.branches[1]!.id,
                toBranchName: "Chi nhánh Quận 1",
                createdByName: "Chủ Shop",
                receivedByName: transferReceived ? "Chủ Shop" : null,
                note: "Điều chuyển cuối tuần",
                dispatchedAt: new Date().toISOString(),
                receivedAt: transferReceived ? new Date().toISOString() : null,
                items: [
                  {
                    id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    variantId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                    sku: "SP-01",
                    productName: "Sản phẩm 1",
                    variantName: "Mặc định",
                    unit: "Cái",
                    quantity: "5.000",
                    unitCost: "20000.00",
                  },
                ],
              },
            ],
            pagination: { page: 1, limit: 30, total: 1, totalPages: 1 },
          });
        }
        if (url.includes("/receive") && method === "POST") {
          transferReceived = true;
          return jsonResponse({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", status: "RECEIVED" });
        }
        return jsonResponse({}, 404);
      }),
    );

    render(
      <QueryProvider>
        <CustomersPage />
        <AuditLogsPage />
        <StockTransfersPage />
      </QueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Nguyễn Thị Hoa")).toBeDefined();
      expect(screen.getByText("45 điểm")).toBeDefined();
      expect(screen.getByText(/HD-261117-01/)).toBeDefined();
      expect(screen.getByText("CK-261117-001")).toBeDefined();
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Nhận hàng tại Chi nhánh Quận 1/i }),
    );
    await waitFor(() => {
      expect(transferReceived).toBe(true);
    });
  });
});
