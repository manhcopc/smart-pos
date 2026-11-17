import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { QueryProvider } from "@/providers/query-provider";
import BranchesPage from "../(dashboard)/dashboard/branches/page";
import StaffPage from "../(dashboard)/dashboard/staff/page";
import PosTerminalPage from "../(pos)/pos/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboard",
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Management & POS UI + Token Refresh", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("retries once via /auth/refresh when apiFetch receives 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: "AUTH_UNAUTHORIZED" } }, 401))
      .mockResolvedValueOnce(jsonResponse({ accessToken: "new.token" }, 200))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<{ ok: boolean }>("/branches");
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/auth/refresh");
  });

  it("displays branches and plan quota on BranchesPage", async () => {
    const profilePayload = {
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
        permissions: ["branch:manage", "staff:manage"],
      },
      branches: [],
    };

    const branchesPayload = {
      items: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          code: "CN01",
          name: "Chi nhánh trung tâm",
          address: "123 Lê Lợi",
          phone: "0901234567",
          isDefault: true,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      quota: { activeCount: 1, maxBranches: 1 },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/auth/me")) return jsonResponse(profilePayload);
        if (url.endsWith("/branches")) return jsonResponse(branchesPayload);
        return jsonResponse({}, 404);
      }),
    );

    render(
      <QueryProvider>
        <BranchesPage />
      </QueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Chi nhánh trung tâm")).toBeDefined();
      expect(screen.getByText(/Đang dùng: 1 \/ 1 chi nhánh/i)).toBeDefined();
    });
  });

  it("displays staff roster with PIN status and hides admin button on POS for CASHIER", async () => {
    const managerProfile = {
      redirectTo: "/dashboard",
      user: { id: "u1", email: "mgr@shop.vn", fullName: "Quản Lý A" },
      tenant: {
        id: "t1",
        slug: "shop-a",
        name: "Shop A",
        businessType: "RETAIL",
        planCode: "PRO",
      },
      member: {
        id: "m1",
        employeeCode: "MGR01",
        role: "MANAGER",
        allowedBranchIds: [],
        permissions: ["staff:manage"],
      },
      branches: [],
    };

    const staffPayload = {
      items: [
        {
          id: "22222222-2222-2222-2222-222222222222",
          userId: "u2",
          employeeCode: "TN01",
          fullName: "Thu Ngân 1",
          email: null,
          phone: null,
          role: "CASHIER",
          hasPin: true,
          allowedBranchIds: [],
          permissions: {},
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      quota: { activeCount: 2, maxUsers: 20 },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/auth/me")) return jsonResponse(managerProfile);
        if (url.endsWith("/staff")) return jsonResponse(staffPayload);
        if (url.endsWith("/branches")) {
          return jsonResponse({ items: [], quota: { activeCount: 1, maxBranches: 5 } });
        }
        return jsonResponse({}, 404);
      }),
    );

    render(
      <QueryProvider>
        <StaffPage />
      </QueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Thu Ngân 1")).toBeDefined();
      expect(screen.getByText(/PIN thu ngân: Đã thiết lập/i)).toBeDefined();
    });

    cleanup();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          redirectTo: "/pos",
          user: { id: "u2", email: null, fullName: "Thu Ngân 1" },
          tenant: {
            id: "t1",
            slug: "shop-a",
            name: "Shop A",
            businessType: "RETAIL",
            planCode: "FREE_TRIAL",
          },
          member: {
            id: "m2",
            employeeCode: "TN01",
            role: "CASHIER",
            allowedBranchIds: [],
            permissions: ["pos:sell"],
          },
          branches: [
            {
              id: "11111111-1111-1111-1111-111111111111",
              code: "CN01",
              name: "Chi nhánh 1",
              address: null,
              phone: null,
              isDefault: true,
              isActive: true,
            },
          ],
        }),
      ),
    );

    render(
      <QueryProvider>
        <PosTerminalPage />
      </QueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Shop A")).toBeDefined();
      expect(screen.queryByText("Quản trị")).toBeNull();
    });
  });
});
