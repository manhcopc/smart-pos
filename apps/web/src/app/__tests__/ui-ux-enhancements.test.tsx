import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ThemeProvider } from "next-themes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OfflineQueueDialog } from "@/components/pos/offline-queue-dialog";
import type { QueuedOfflineInvoice } from "@/lib/pos-offline-queue";
import { QueryProvider } from "@/providers/query-provider";
import BillingPage from "../(dashboard)/dashboard/billing/page";
import CustomersPage from "../(dashboard)/dashboard/customers/page";
import IntegrationsPage from "../(dashboard)/dashboard/integrations/page";
import InventoryPage from "../(dashboard)/dashboard/inventory/page";
import ProductsPage from "../(dashboard)/dashboard/products/page";
import StockTransfersPage from "../(dashboard)/dashboard/transfers/page";
import DashboardLayout from "../(dashboard)/layout";
import PosTerminalPage from "../(pos)/pos/page";

let mockSearchParams = new URLSearchParams();
let mockPathname = "/dashboard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const branchId = "11111111-1111-4111-8111-111111111111";
const branch2Id = "11111111-1111-4111-8111-111111111112";
const categoryId = "44444444-4444-4444-8444-444444444444";
const productId = "55555555-5555-4555-8555-555555555555";
const variantId = "22222222-2222-4222-8222-222222222222";
const shiftId = "33333333-3333-4333-8333-333333333333";

const ownerProfile = {
  redirectTo: "/dashboard",
  user: { id: "u1", email: "owner@shop.vn", fullName: "Chủ Shop" },
  tenant: {
    id: tenantId,
    slug: "smart-shop",
    name: "Cửa hàng Smart-POS",
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
      "catalog:manage",
      "inventory:view",
      "inventory:manage",
      "inventory:transfer",
      "customer:view",
      "customer:manage",
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
    {
      id: branch2Id,
      code: "CN02",
      name: "Chi nhánh Quận 3",
      isDefault: false,
    },
  ],
};

describe("UI/UX Enhancements & Regressions Suite", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    mockPathname = "/dashboard";
  });

  it("wires ?lowStock=true query param cleanly inside InventoryPage", async () => {
    mockSearchParams = new URLSearchParams("lowStock=true");
    const requestedUrls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.endsWith("/auth/me")) return jsonResponse(ownerProfile);
        if (url.includes("/inventory/ledgers")) {
          return jsonResponse({
            items: [],
            pagination: { page: 1, limit: 30, total: 0, totalPages: 1 },
          });
        }
        if (url.includes("/inventory")) {
          return jsonResponse({
            items: [],
            pagination: { page: 1, limit: 30, total: 0, totalPages: 1 },
            summary: { totalStockValue: "0.00", lowStockCount: 0 },
          });
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryProvider>
        <InventoryPage />
      </QueryProvider>,
    );

    const checkbox = await screen.findByRole("checkbox", {
      name: /Chỉ hiện hàng dưới định mức/i,
    });
    await waitFor(() => {
      expect(checkbox.getAttribute("aria-checked")).toBe("true");
      expect(
        requestedUrls.some(
          (u) => u.includes("/inventory?") && u.includes("lowStockOnly=true"),
        ),
      ).toBe(true);
    });
  });

  it("hides mutation actions on StockTransfersPage and CustomersPage when RBAC permissions are missing", async () => {
    const viewOnlyProfile = {
      ...ownerProfile,
      member: {
        ...ownerProfile.member,
        role: "MANAGER",
        permissions: ["inventory:view", "customer:view"],
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/auth/me")) return jsonResponse(viewOnlyProfile);
        if (url.includes("/stock-transfers")) {
          return jsonResponse({
            items: [
              {
                id: "tr-1",
                code: "CK-001",
                fromBranchId: branchId,
                fromBranchName: "Chi nhánh Trung tâm",
                toBranchId: branch2Id,
                toBranchName: "Chi nhánh Quận 3",
                status: "IN_TRANSIT",
                note: null,
                createdByName: "Manager",
                receivedByName: null,
                dispatchedAt: new Date().toISOString(),
                receivedAt: null,
                items: [],
              },
            ],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
          });
        }
        if (url.includes("/products")) {
          return jsonResponse({
            items: [],
            pagination: { page: 1, limit: 50, total: 0, totalPages: 1 },
          });
        }
        if (url.includes("/customers")) {
          return jsonResponse({
            items: [
              {
                id: "cust-1",
                code: "KH001",
                name: "Khách Xem",
                phone: "0901234567",
                email: null,
                loyaltyPoints: 20,
                totalSpent: "200000.00",
                visitCount: 2,
              },
            ],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
          });
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryProvider>
        <StockTransfersPage />
        <CustomersPage />
      </QueryProvider>,
    );

    await screen.findByText("Chế độ chỉ xem");
    await screen.findByText("Khách Xem");
    expect(screen.queryByRole("button", { name: /Điều chuyển mới/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Nhận hàng tại/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Thêm khách hàng/i })).toBeNull();
  });

  it("shows /dashboard/integrations nav item for report:financial and renders mobile drawer trigger", async () => {
    const accountantProfile = {
      ...ownerProfile,
      member: {
        ...ownerProfile.member,
        role: "ACCOUNTANT",
        permissions: ["report:financial"],
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/auth/me")) {
          return jsonResponse(accountantProfile);
        }
        return jsonResponse({});
      }),
    );

    render(
      <ThemeProvider attribute="class" defaultTheme="light">
        <QueryProvider>
          <DashboardLayout>
            <div>Nội dung báo cáo</div>
          </DashboardLayout>
        </QueryProvider>
      </ThemeProvider>,
    );

    await screen.findByText("Nội dung báo cáo");
    expect(
      screen.getByRole("button", { name: /Tích hợp & Kế toán/i }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Mở menu điều hướng/i }),
    ).toBeDefined();
  });

  it("supports editing product & variant in ProductEditDialog and requires ConfirmDialog before deleting a category", async () => {
    let productPatched = false;
    let variantPatched = false;
    let categoryDeleted = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.endsWith("/auth/me")) return jsonResponse(ownerProfile);
        if (url.endsWith("/categories") && method === "GET") {
          return jsonResponse([
            {
              id: categoryId,
              parentId: null,
              name: "Đồ uống",
              sortOrder: 0,
              productCount: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ]);
        }
        if (url.endsWith(`/categories/${categoryId}`) && method === "DELETE") {
          categoryDeleted = true;
          return jsonResponse({ deleted: true });
        }
        if (url.includes("/products") && method === "GET") {
          return jsonResponse({
            items: [
              {
                id: productId,
                categoryId,
                categoryName: "Đồ uống",
                name: "Trà Đào Cam Sả",
                description: null,
                brand: "House",
                hasVariants: false,
                imageUrl: null,
                isActive: true,
                variants: [
                  {
                    id: variantId,
                    productId,
                    sku: "TRA-DAO-M",
                    barcode: "8930001",
                    name: "Size M",
                    unit: "Ly",
                    costPrice: "15000.00",
                    salePrice: "35000.00",
                    taxRate: "0.00",
                    minStockAlert: 5,
                    isActive: true,
                    branchStock: {
                      branchId,
                      onHand: "25.000",
                      reserved: "0.000",
                      available: "25.000",
                      avgCost: "15000.00",
                      isLowStock: false,
                    },
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  },
                ],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
            pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
            quota: { activeSkus: 1, maxSkus: 500 },
          });
        }
        if (url.endsWith(`/products/${productId}`) && method === "PATCH") {
          productPatched = true;
          return jsonResponse({ id: productId });
        }
        if (
          url.endsWith(`/products/${productId}/variants/${variantId}`) &&
          method === "PATCH"
        ) {
          variantPatched = true;
          return jsonResponse({ id: variantId });
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryProvider>
        <ProductsPage />
      </QueryProvider>,
    );

    await screen.findByText("Trà Đào Cam Sả");

    fireEvent.click(screen.getByRole("button", { name: /Chỉnh sửa/i }));
    const nameInput = await screen.findByLabelText("Tên sản phẩm");
    fireEvent.change(nameInput, { target: { value: "Trà Đào Đặc Biệt" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu thay đổi/i }));

    await waitFor(() => {
      expect(productPatched).toBe(true);
      expect(variantPatched).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: /Nhóm hàng/i }));
    const delBtn = await screen.findByRole("button", { name: "Xóa Đồ uống" });
    fireEvent.click(delBtn);

    expect(categoryDeleted).toBe(false);
    await screen.findByText(/Xóa nhóm hàng "Đồ uống"\?/i);
    fireEvent.click(screen.getByRole("button", { name: "Xóa nhóm hàng" }));

    await waitFor(() => {
      expect(categoryDeleted).toBe(true);
    });
  });

  it("protects dirty POS cart tabs with ConfirmDialog and auto-fills remaining balance in Split Payment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/auth/me")) return jsonResponse(ownerProfile);
        if (url.includes("/pos/catalog-sync")) {
          return jsonResponse({
            branchId,
            serverTimestamp: new Date().toISOString(),
            fullSync: true,
            categories: [{ id: categoryId, name: "Đồ uống", sortOrder: 0 }],
            items: [
              {
                variantId,
                productId,
                categoryId,
                categoryName: "Đồ uống",
                productName: "Cà phê Sữa Đá",
                variantName: "Ly L",
                sku: "CF-SUA-L",
                barcode: "8931111111111",
                unit: "Ly",
                salePrice: "35000.00",
                taxRate: "0.00",
                onHand: "20.000",
                reserved: "0.000",
                available: "20.000",
                isActive: true,
                imageUrl: null,
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
              openingCash: "1000000.00",
              expectedCash: "1000000.00",
              actualCash: null,
              cashVariance: null,
              status: "OPEN",
              openedAt: new Date().toISOString(),
              closedAt: null,
              note: null,
            },
          });
        }
        if (url.includes("/pos/customers")) {
          return jsonResponse({ items: [] });
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryProvider>
        <PosTerminalPage />
      </QueryProvider>,
    );

    const productTitle = await screen.findByText("Cà phê Sữa Đá");
    fireEvent.click(productTitle.closest("button")!);

    await screen.findByText("Hóa đơn 1 (1)");

    fireEvent.click(screen.getByRole("button", { name: "Đủ tiền" }));
    const amount1 = screen.getByLabelText("Số tiền thanh toán 1");
    expect((amount1 as HTMLInputElement).value).toBe("35000");

    fireEvent.change(amount1, { target: { value: "15000" } });
    fireEvent.click(
      screen.getByRole("button", { name: /Thêm phương thức/i }),
    );

    const amount2 = await screen.findByLabelText("Số tiền thanh toán 2");
    expect((amount2 as HTMLInputElement).value).toBe("20000");

    fireEvent.click(screen.getByRole("button", { name: "Hóa đơn 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Đóng Hóa đơn 1" }));

    await screen.findByText(/Đóng Hóa đơn 1\?/i);
    expect(screen.getByText("Hóa đơn 1 (1)")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Đóng tab" }));
    await waitFor(() => {
      expect(screen.queryByText("Hóa đơn 1 (1)")).toBeNull();
    });
  });

  it("asks ConfirmDialog before discarding an invoice in OfflineQueueDialog", async () => {
    const onDiscardEntry = vi.fn(async () => undefined);
    const sampleEntry: QueuedOfflineInvoice = {
      idempotencyKey: "11111111-1111-4111-8111-111111111119",
      tenantId,
      branchId,
      shiftId,
      queuedAt: new Date().toISOString(),
      localReceiptCode: "OFF-9988",
      customerName: null,
      subtotal: "35000.00",
      discountAmount: "0.00",
      taxAmount: "0.00",
      totalAmount: "35000.00",
      paidAmount: "35000.00",
      changeGiven: "0.00",
      itemSummaries: [
        {
          variantId,
          sku: "CF-SUA-L",
          name: "Cà phê Sữa Đá",
          quantity: "1.000",
          unitPrice: "35000.00",
          discountAmount: "0.00",
          taxRate: "0.00",
          lineTotal: "35000.00",
        },
      ],
      status: "FAILED",
      errorMessage: "Mất kết nối",
      payload: {
        branchId,
        shiftId,
        idempotencyKey: "11111111-1111-4111-8111-111111111119",
        discountAmount: "0.00",
        syncSource: "OFFLINE_SYNC",
        items: [
          {
            variantId,
            quantity: "1.000",
            discountAmount: "0.00",
          },
        ],
        payments: [{ method: "CASH", amount: "35000.00" }],
      },
    };

    render(
      <OfflineQueueDialog
        open={true}
        onOpenChange={() => undefined}
        entries={[sampleEntry]}
        isOnline={true}
        isSyncing={false}
        currentShiftId={shiftId}
        onSyncEntries={async () => undefined}
        onResolveEntry={async () => undefined}
        onDiscardEntry={onDiscardEntry}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Hủy đơn hàng đợi/i }));
    expect(onDiscardEntry).not.toHaveBeenCalled();

    await screen.findByText(/Hủy hóa đơn offline OFF-9988\?/i);
    fireEvent.click(screen.getByRole("button", { name: "Xóa khỏi hàng đợi" }));

    await waitFor(() => {
      expect(onDiscardEntry).toHaveBeenCalledWith(sampleEntry.idempotencyKey);
    });
  });

  it("renders Vietnamese labels on IntegrationsPage and BillingPage SelectValue triggers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/auth/me")) return jsonResponse(ownerProfile);
        if (url.endsWith("/integrations/api-keys")) return jsonResponse([]);
        if (url.endsWith("/integrations/webhooks")) return jsonResponse([]);
        if (url.includes("/integrations/webhooks/deliveries")) {
          return jsonResponse([]);
        }
        if (url.endsWith("/billing/subscription")) {
          return jsonResponse({
            tenant: {
              id: tenantId,
              name: "Cửa hàng Smart-POS",
              slug: "smart-shop",
              planCode: "FREE_TRIAL",
              trialEndsAt: new Date().toISOString(),
              isTrialExpired: false,
              daysRemaining: 14,
            },
            currentPlan: {
              id: "p0",
              code: "FREE_TRIAL",
              name: "Dùng thử",
              priceMonthly: "0.00",
              maxBranches: 2,
              maxUsers: 5,
              maxSkus: 500,
              storageQuotaMb: 256,
              features: {
                posOffline: true,
                splitPayments: true,
                multiBranchTransfer: true,
                omnichannelApi: true,
              },
            },
            usage: { activeBranches: 1, activeUsers: 1, activeSkus: 10 },
            availablePlans: [],
            billingHistory: [],
          });
        }
        return jsonResponse({});
      }),
    );

    render(
      <QueryProvider>
        <IntegrationsPage />
        <BillingPage />
      </QueryProvider>,
    );

    await screen.findByText("Tất cả chi nhánh");
    await screen.findByText("1 tháng");
    await screen.findByText("Chuyển khoản VietQR");
  });
});
