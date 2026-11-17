import { ERROR_CODES } from "@smart-pos/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, apiFetch, getApiBaseUrl } from "../api-client";

describe("api-client helper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("normalizes trailing slash from NEXT_PUBLIC_API_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.smartpos.vn/api/v1///");
    expect(getApiBaseUrl()).toBe("https://api.smartpos.vn/api/v1");
  });

  it("parses structured API error responses into ApiClientError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: ERROR_CODES.INSUFFICIENT_STOCK,
            message: "Không đủ tồn kho",
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/pos/invoices", { method: "POST" })).rejects.toMatchObject({
      name: "ApiClientError",
      statusCode: 409,
      code: ERROR_CODES.INSUFFICIENT_STOCK,
      message: "Không đủ tồn kho",
    } satisfies Partial<ApiClientError>);
  });
});
