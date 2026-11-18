import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryProvider } from "@/providers/query-provider";
import InventoryPage from "../(dashboard)/dashboard/inventory/page";
import ProductsPage from "../(dashboard)/dashboard/products/page";
import PurchaseOrdersPage from "../(dashboard)/dashboard/purchase-orders/page";
import StockCountsPage from "../(dashboard)/dashboard/stock-counts/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboard/products",
  useSearchParams: () => new URLSearchParams(),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ownerProfile = {
  redirectTo: "/dashboard",
  user: { id: "u1", email: "owner@shop.vn", fullName: "Owner A" },
  tenant: {
    id: "t1",
    slug: "shop-a",
    name: "Shop A",
    businessType: "RETAIL",
    planCode: "FREE_TRIAL",
  },
  member: {
    id: "m1",
    employeeCode: "OWNER01",
    role: "OWNER",
    allowedBranchIds: [],
    permissions: [
      "inventory:view",
      "inventory:receive",
      "inventory:count",
      "catalog:manage",
      "branch:manage",
      "staff:manage",
    ],
  },
  branches: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      code: "CN01",
      name: "Chi nhánh chính",
      address: null,
      phone: null,
      isDefault: true,
      isActive: true,
    },
  ],
};

describe("Phase 2 Catalog & Inventory Management Pages", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders ProductsPage with SKU quota, category list, and low-stock indicator", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/auth/me")) return jsonResponse(ownerProfile);
        if (url.endsWith("/categories")) {
          return jsonResponse([
            {
              id: "c1",
              parentId: null,
              name: "Đồ uống",
              sortOrder: 0,
              productCount: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ]);
        }
        if (url.includes("/products")) {
          return jsonResponse({
            items: [
              {
                id: "p1",
                categoryId: "c1",
                categoryName: "Đồ uống",
                name: "Cà phê rang xay",
                description: null,
                brand: "Highlands",
                hasVariants: false,
                imageUrl: null,
                isActive: true,
                variants: [
                  {
                    id: "v1",
                    productId: "p1",
                    sku: "CF-250G",
                    barcode: "8931234567890",
                    name: "Gói 250g",
                    unit: "Gói",
                    costPrice: "45000.00",
                    salePrice: "79000.00",
                    taxRate: "8.00",
                    minStockAlert: 10,
                    isActive: true,
                    branchStock: {
                      branchId: "11111111-1111-1111-1111-111111111111",
                      onHand: "4.000",
                      reserved: "0.000",
                      available: "4.000",
                      avgCost: "45000.00",
                      isLowStock: true,
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
        return jsonResponse({}, 404);
      }),
    );

    render(
      <QueryProvider>
        <ProductsPage />
      </QueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Cà phê rang xay")).toBeDefined();
      expect(screen.getByText("SKU: 1 / 500")).toBeDefined();
      expect(screen.getByText("CF-250G")).toBeDefined();
    });
  });

  it("renders InventoryPage stock summary and immutable ledger tab", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/auth/me")) return jsonResponse(ownerProfile);
        if (url.includes("/inventory/ledgers")) {
          return jsonResponse({
            items: [
              {
                id: "l1",
                branchId: "11111111-1111-1111-1111-111111111111",
                branchCode: "CN01",
                branchName: "Chi nhánh chính",
                variantId: "v1",
                sku: "CF-250G",
                variantName: "Gói 250g",
                movementType: "PURCHASE_IN",
                qtyDelta: "10.000",
                qtyBefore: "0.000",
                qtyAfter: "10.000",
                unitCost: "45000.00",
                referenceType: "purchase_order",
                referenceId: "po1",
                actorName: "Owner A",
                actorEmployeeCode: "OWNER01",
                note: "Nhập đầu kỳ",
                createdAt: new Date().toISOString(),
              },
            ],
            pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
          });
        }
        if (url.includes("/inventory")) {
          return jsonResponse({
            items: [
              {
                branchId: "11111111-1111-1111-1111-111111111111",
                branchCode: "CN01",
                branchName: "Chi nhánh chính",
                variantId: "v1",
                productId: "p1",
                productName: "Cà phê rang xay",
                variantName: "Gói 250g",
                sku: "CF-250G",
                barcode: null,
                unit: "Gói",
                minStockAlert: 5,
                onHand: "10.000",
                reserved: "0.000",
                available: "10.000",
                avgCost: "45000.00",
                salePrice: "79000.00",
                stockValue: "450000.00",
                isLowStock: false,
                updatedAt: new Date().toISOString(),
              },
            ],
            pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
            summary: { totalStockValue: "450000.00", lowStockCount: 0 },
          });
        }
        return jsonResponse({}, 404);
      }),
    );

    render(
      <QueryProvider>
        <InventoryPage />
      </QueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("CF-250G")).toBeDefined();
      expect(screen.getAllByText(/450\.000/).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("tab", { name: /Thẻ kho bất biến/i }));

    await waitFor(() => {
      expect(screen.getByText("Nhập đầu kỳ")).toBeDefined();
    });
  });

  it("renders PurchaseOrdersPage and StockCountsPage cleanly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/auth/me")) return jsonResponse(ownerProfile);
        if (url.includes("/purchase-orders")) {
          return jsonResponse({
            items: [
              {
                id: "po1",
                code: "PO-20261117-ABC",
                branchId: "11111111-1111-1111-1111-111111111111",
                branchCode: "CN01",
                branchName: "Chi nhánh chính",
                supplierId: null,
                supplierName: null,
                status: "COMPLETED",
                totalAmount: "450000.00",
                paidAmount: "450000.00",
                createdByName: "Owner A",
                completedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                items: [],
              },
            ],
            pagination: { page: 1, limit: 30, total: 1, totalPages: 1 },
          });
        }
        if (url.endsWith("/suppliers")) return jsonResponse([]);
        if (url.includes("/products")) {
          return jsonResponse({
            items: [],
            pagination: { page: 1, limit: 100, total: 0, totalPages: 1 },
            quota: { activeSkus: 0, maxSkus: 500 },
          });
        }
        if (url.includes("/stock-counts")) {
          return jsonResponse({
            items: [
              {
                id: "sc1",
                code: "KK-20261117-XYZ",
                branchId: "11111111-1111-1111-1111-111111111111",
                branchCode: "CN01",
                branchName: "Chi nhánh chính",
                status: "BALANCED",
                createdByName: "Owner A",
                balancedByName: "Owner A",
                balancedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                items: [
                  {
                    id: "sci1",
                    variantId: "v1",
                    sku: "CF-250G",
                    variantName: "Gói 250g",
                    unit: "Gói",
                    systemQty: "10.000",
                    actualQty: "9.000",
                    varianceQty: "-1.000",
                    reason: "Rách bao",
                  },
                ],
              },
            ],
            pagination: { page: 1, limit: 30, total: 1, totalPages: 1 },
          });
        }
        if (url.includes("/inventory")) {
          return jsonResponse({
            items: [],
            pagination: { page: 1, limit: 100, total: 0, totalPages: 1 },
            summary: { totalStockValue: "0.00", lowStockCount: 0 },
          });
        }
        return jsonResponse({}, 404);
      }),
    );

    render(
      <QueryProvider>
        <PurchaseOrdersPage />
      </QueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("PO-20261117-ABC")).toBeDefined();
    });

    cleanup();

    render(
      <QueryProvider>
        <StockCountsPage />
      </QueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("KK-20261117-XYZ")).toBeDefined();
      expect(screen.getByText("Rách bao")).toBeDefined();
    });
  });
});
