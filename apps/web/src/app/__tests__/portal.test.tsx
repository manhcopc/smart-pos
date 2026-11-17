import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryProvider } from "@/providers/query-provider";
import HomePage from "../page";

describe("HomePage portal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders links to POS, Management Dashboard, and Login and displays API health", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "ok",
            service: "smart-pos-api",
            timestamp: new Date().toISOString(),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    render(
      <QueryProvider>
        <HomePage />
      </QueryProvider>,
    );

    expect(screen.getByText("Smart-POS")).toBeDefined();
    expect(screen.getByText("Mở màn hình POS")).toBeDefined();
    expect(screen.getByText("Vào trang Quản trị")).toBeDefined();
    expect(screen.getByText("Cổng Đăng nhập")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText(/API Online \(smart-pos-api\)/)).toBeDefined();
    });
  });
});
