import { ERROR_CODES, type ErrorCode } from "@smart-pos/shared";

const DEFAULT_API_BASE_URL = "http://localhost:4000/api/v1";
const NON_REFRESHABLE_PATHS = new Set([
  "/auth/login",
  "/auth/cashier-pin",
  "/auth/register-tenant",
  "/auth/refresh",
  "/auth/logout",
]);

let inFlightRefresh: Promise<boolean> | null = null;

export function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  return configured ? configured.replace(/\/+$/, "") : DEFAULT_API_BASE_URL;
}

export class ApiClientError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode | string;
  readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number,
    code: ErrorCode | string = ERROR_CODES.INTERNAL_ERROR,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function formatApiError(
  error: unknown,
  fallback = "Đã xảy ra lỗi, vui lòng thử lại.",
): string {
  if (error instanceof ApiClientError) {
    if (
      error.code === ERROR_CODES.AUTH_RATE_LIMITED &&
      error.details &&
      typeof error.details === "object" &&
      "retryAfterSeconds" in error.details
    ) {
      const seconds = Number(
        (error.details as { retryAfterSeconds?: unknown }).retryAfterSeconds,
      );
      if (Number.isFinite(seconds) && seconds > 0) {
        return `Quá nhiều lần thử thất bại. Vui lòng thử lại sau ${seconds} giây.`;
      }
    }
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

async function parseErrorResponse(response: Response): Promise<ApiClientError> {
  let payload:
    | { error?: { code?: string; message?: string; details?: unknown } }
    | undefined;
  try {
    payload = (await response.json()) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
  } catch {
    payload = undefined;
  }

  return new ApiClientError(
    payload?.error?.message ?? `Request failed with status ${response.status}`,
    response.status,
    payload?.error?.code ?? ERROR_CODES.INTERNAL_ERROR,
    payload?.error?.details,
  );
}

async function tryRefreshSession(): Promise<boolean> {
  if (inFlightRefresh) {
    return inFlightRefresh;
  }

  inFlightRefresh = (async () => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      inFlightRefresh = null;
    }
  })();

  return inFlightRefresh;
}

async function fetchWithAuthRetry(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const isFormData =
    typeof FormData !== "undefined" && init?.body instanceof FormData;

  const executeFetch = () =>
    fetch(`${getApiBaseUrl()}${normalizedPath}`, {
      ...init,
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...init?.headers,
      },
      credentials: "include",
    });

  let response = await executeFetch();

  if (response.status === 401 && !NON_REFRESHABLE_PATHS.has(normalizedPath)) {
    const refreshed = await tryRefreshSession();
    if (refreshed) {
      response = await executeFetch();
    }
  }

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return response;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetchWithAuthRetry(path, init);
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function apiFetchForm<T>(
  path: string,
  formData: FormData,
): Promise<T> {
  const response = await fetchWithAuthRetry(path, {
    method: "POST",
    body: formData,
  });
  return (await response.json()) as T;
}

export async function apiDownloadFile(
  path: string,
  fallbackFilename: string,
): Promise<void> {
  const response = await fetchWithAuthRetry(path, { method: "GET" });
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fallbackFilename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
