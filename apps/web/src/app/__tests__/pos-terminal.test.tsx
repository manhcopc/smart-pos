import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyPosStockPatch,
  mergePosCatalogDelta,
  searchPosCatalog,
} from "@/lib/pos-indexeddb";
import { QueryProvider } from "@/providers/query-provider";
import PosTerminalPage from "../(pos)/pos/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/pos",
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const branchId = "11111111-1111-1111-1111-111111111111";
const variantId = "22222222-2222-2222-2222-222222222222";
const shiftId = "33333333-3333-3333-3333-333333333333";

const cashierProfile = {
  redirectTo: "/pos",
  user: { id: "u1", email: null, fullName: "Thu Ngân Lan" },
  tenant: {
    id: "t1",
    slug: "cafe-lan",
    name: "Cafe Lan",
    businessType: "RETAIL",
    planCode: "FREE_TRIAL",
  },
  member: {
    id: "m1",
    employeeCode: "TN01",
    role: "CASHIER",
    allowedBranchIds: [branchId],
    permissions: ["pos:sell", "pos:shift_manage", "inventory:view"],
  },
  branches: [
    {
      id: branchId,
      code: "CN01",
      name: "Quầy chính",
      address: null,
      phone: null,
      isDefault: true,
      isActive: true,
    },
  ],
};

describe("Phase 3 POS Terminal & IndexedDB Cache", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("merges delta sync, patches SSE stock updates, and matches barcode first in local search", () => {
    const initial = mergePosCatalogDelta("t1", null, {
      branchId,
      serverTimestamp: "2026-11-17T08:00:00.000Z",
      fullSync: true,
      categories: [{ id: "c1", name: "Đồ uống", sortOrder: 0 }],
      items: [
        {
          variantId,
          productId: "p1",
          categoryId: "c1",
          categoryName: "Đồ uống",
          productName: "Cà phê Sữa Đá",
          variantName: "Ly Lớn",
          sku: "CF-SUA-L",
          barcode: "8931234567890",
          unit: "Ly",
          salePrice: "35000.00",
          taxRate: "0.00",
          minStockAlert: 5,
          imageUrl: null,
          isActive: true,
          onHand: "20.000",
          reserved: "0.000",
          available: "20.000",
          updatedAt: "2026-11-17T08:00:00.000Z",
        },
        {
          variantId: "v-other",
          productId: "p2",
          categoryId: "c1",
          categoryName: "Đồ uống",
          productName: "Trà Đào 893",
          variantName: "Ly",
          sku: "TRA-DAO",
          barcode: "8939999999999",
          unit: "Ly",
          salePrice: "30000.00",
          taxRate: "0.00",
          minStockAlert: 5,
          imageUrl: null,
          isActive: true,
          onHand: "10.000",
          reserved: "0.000",
          available: "10.000",
          updatedAt: "2026-11-17T08:00:00.000Z",
        },
      ],
    });

    const patched = applyPosStockPatch(initial, [
      { variantId, onHand: "17.000", available: "17.000" },
    ]);
    expect(patched.items[0]?.onHand).toBe("17.000");

    const barcodeHits = searchPosCatalog(patched.items, {
      query: "8931234567890",
    });
    expect(barcodeHits).toHaveLength(1);
    expect(barcodeHits[0]?.sku).toBe("CF-SUA-L");
  });

  it("opens a register shift, scans barcode to cart, preserves multi-tab state, and completes checkout with K58/K80 receipt", async () => {
    let shiftOpened = false;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/auth/me")) return jsonResponse(cashierProfile);
      if (url.includes("/pos/catalog-sync")) {
        return jsonResponse({
          branchId,
          serverTimestamp: new Date().toISOString(),
          fullSync: true,
          categories: [{ id: "c1", name: "Đồ uống", sortOrder: 0 }],
          items: [
            {
              variantId,
              productId: "p1",
              categoryId: "c1",
              categoryName: "Đồ uống",
              productName: "Cà phê Sữa Đá",
              variantName: "Ly Lớn",
              sku: "CF-SUA-L",
              barcode: "8931234567890",
              unit: "Ly",
              salePrice: "35000.00",
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
          shift: shiftOpened
            ? {
                id: shiftId,
                branchId,
                branchCode: "CN01",
                branchName: "Quầy chính",
                openedByMemberId: "m1",
                openedByName: "Thu Ngân Lan",
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
              }
            : null,
        });
      }
      if (url.endsWith("/pos/shifts/open") && method === "POST") {
        shiftOpened = true;
        return jsonResponse(
          {
            id: shiftId,
            branchId,
            branchCode: "CN01",
            branchName: "Quầy chính",
            openedByMemberId: "m1",
            openedByName: "Thu Ngân Lan",
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
          201,
        );
      }
      if (url.endsWith("/pos/invoices") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as {
          idempotencyKey: string;
        };
        return jsonResponse(
          {
            id: "inv-1",
            code: "HD-261117-TEST01",
            idempotencyKey: body.idempotencyKey,
            branchId,
            branchCode: "CN01",
            branchName: "Quầy chính",
            shiftId,
            cashierMemberId: "m1",
            cashierName: "Thu Ngân Lan",
            status: "COMPLETED",
            subtotal: "35000.00",
            discountAmount: "0.00",
            taxAmount: "0.00",
            totalAmount: "35000.00",
            paidAmount: "35000.00",
            changeGiven: "15000.00",
            createdAt: new Date().toISOString(),
            items: [
              {
                id: "ii-1",
                variantId,
                productName: "Cà phê Sữa Đá - Ly Lớn",
                sku: "CF-SUA-L",
                quantity: "1.000",
                unitPrice: "35000.00",
                discountAmount: "0.00",
                taxAmount: "0.00",
                lineTotal: "35000.00",
              },
            ],
            payments: [
              {
                id: "ip-1",
                method: "CASH",
                amount: "35000.00",
                referenceNo: null,
                paidAt: new Date().toISOString(),
              },
            ],
          },
          200,
        );
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <QueryProvider>
        <PosTerminalPage />
      </QueryProvider>,
    );

    // 1. Open shift card renders -> open shift
    await waitFor(() => {
      expect(screen.getByText(/Mở ca & Bắt đầu bán hàng/i)).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: /Mở ca & Bắt đầu bán hàng/i }));

    await waitFor(() => {
      expect(screen.getByText(/Ca mở · Két:/i)).toBeDefined();
    });

    // 2. Scan barcode + Enter adds item to Hóa đơn 1
    const searchInput = screen.getByLabelText("Tìm hàng hóa hoặc quét mã vạch");
    fireEvent.change(searchInput, { target: { value: "8931234567890" } });
    fireEvent.submit(searchInput.closest("form")!);

    await waitFor(() => {
      expect(screen.getByText("Cà phê Sữa Đá - Ly Lớn")).toBeDefined();
    });

    // 3. Switch to Hóa đơn 2 (empty), then back to Hóa đơn 1 (item preserved)
    fireEvent.click(screen.getByRole("button", { name: "Hóa đơn 2" }));
    expect(screen.queryByText("Cà phê Sữa Đá - Ly Lớn")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hóa đơn 1 (1)" }));
    expect(screen.getByText("Cà phê Sữa Đá - Ly Lớn")).toBeDefined();

    // 4. Quick cash 50k -> Checkout -> Thermal Receipt Dialog appears
    fireEvent.click(screen.getByRole("button", { name: "50k" }));
    fireEvent.click(screen.getByRole("button", { name: /Thanh toán \(F9\)/i }));

    await waitFor(() => {
      expect(screen.getByText(/Hóa đơn bán hàng HD-261117-TEST01/i)).toBeDefined();
      expect(screen.getByText(/Tiền thừa trả khách/i)).toBeDefined();
    });
  });
});
