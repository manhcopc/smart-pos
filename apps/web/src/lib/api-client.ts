import { ERROR_CODES, type ErrorCode } from "@smart-pos/shared";

const DEFAULT_API_BASE_URL = "http://localhost:4000/api/v1";

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

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const response = await fetch(`${getApiBaseUrl()}${normalizedPath}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    credentials: "include",
  });

  if (!response.ok) {
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

    throw new ApiClientError(
      payload?.error?.message ?? `Request failed with status ${response.status}`,
      response.status,
      payload?.error?.code ?? ERROR_CODES.INTERNAL_ERROR,
      payload?.error?.details,
    );
  }

  return (await response.json()) as T;
}
