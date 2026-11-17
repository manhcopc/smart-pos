import type { Request } from "express";
import type { RequestMeta } from "../../auth/auth.types";

/**
 * Extract client IP address and user-agent string cleanly without logging sensitive headers.
 */
export function extractRequestMeta(req: Request): RequestMeta {
  const forwarded = req.headers["x-forwarded-for"];
  const firstIp =
    typeof forwarded === "string"
      ? forwarded.split(",")[0]?.trim()
      : undefined;
  const rawUserAgent = req.headers["user-agent"];

  return {
    ipAddress: firstIp || req.ip || "unknown",
    userAgent: typeof rawUserAgent === "string" ? rawUserAgent : undefined,
  };
}
