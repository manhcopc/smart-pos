import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryProvider } from "@/providers/query-provider";
import LoginPage from "../(auth)/login/page";
import RegisterTenantPage from "../(auth)/register/page";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  usePathname: () => "/",
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Phase 1 Auth Pages", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("auto-slugifies shop name and redirects to /dashboard after tenant registration", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          accessToken: "access.jwt.token",
          redirectTo: "/dashboard",
          user: { id: "u1", email: "chu@shop.vn", fullName: "Nguyễn Văn A" },
          tenant: {
            id: "t1",
            slug: "cua-hang-minh-anh",
            name: "Cửa Hàng Minh Anh",
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
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <QueryProvider>
        <RegisterTenantPage />
      </QueryProvider>,
    );

    const shopInput = screen.getByLabelText("Tên cửa hàng");
    fireEvent.change(shopInput, { target: { value: "Cửa Hàng Minh Anh" } });

    const slugInput = screen.getByLabelText(
      "Mã cửa hàng (Slug)",
    ) as HTMLInputElement;
    expect(slugInput.value).toBe("cua-hang-minh-anh");

    fireEvent.change(screen.getByLabelText("Họ tên Chủ shop"), {
      target: { value: "Nguyễn Văn A" },
    });
    fireEvent.change(screen.getByLabelText("Số điện thoại"), {
      target: { value: "0901234567" },
    });
    fireEvent.change(screen.getByLabelText("Email đăng nhập"), {
      target: { value: "chu@shop.vn" },
    });
    fireEvent.change(screen.getByLabelText("Mật khẩu"), {
      target: { value: "Password123!" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Tạo cửa hàng & Bắt đầu dùng thử/i }),
    );

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/dashboard");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/auth/register-tenant"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("logs cashier in via PIN tab, displays rate-limit countdown on 429, and redirects to /pos", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "AUTH_RATE_LIMITED",
              message: "Rate limited",
              details: { retryAfterSeconds: 45 },
            },
          },
          429,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken: "cashier.jwt.token",
          redirectTo: "/pos",
          user: { id: "u2", email: null, fullName: "Thu Ngân Lan" },
          tenant: {
            id: "t1",
            slug: "shop-lan",
            name: "Shop Lan",
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
          branches: [],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <QueryProvider>
        <LoginPage />
      </QueryProvider>,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Thu ngân \(PIN\)/i }));

    fireEvent.change(screen.getByLabelText("Mã cửa hàng"), {
      target: { value: "shop-lan" },
    });
    fireEvent.change(screen.getByLabelText("Mã nhân viên"), {
      target: { value: "tn01" },
    });
    fireEvent.change(screen.getByLabelText("Mã PIN (4–8 số)"), {
      target: { value: "123456" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Vào quầy POS/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Vui lòng thử lại sau 45 giây/i),
      ).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: /Vào quầy POS/i }));

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/pos");
    });
  });
});
