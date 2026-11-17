import crypto from "node:crypto";
import net from "node:net";
import { BadRequestException } from "@nestjs/common";
import { ERROR_CODES, uuidSchema } from "@smart-pos/shared";

const PRIVATE_HOST_SUFFIXES = [".local", ".internal", ".localhost"];

function isBlockedIp(host: string): boolean {
  const bare = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;
  const version = net.isIP(bare);
  if (version === 0) return false;

  if (version === 4) {
    const parts = bare.split(".").map(Number);
    const [a = 0, b = 0] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }

  const normalized = bare.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
}

/**
 * Prevents SSRF to cloud metadata / internal network endpoints when tenants register outbound webhook URLs.
 */
export function assertSafeWebhookUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BadRequestException({
      code: ERROR_CODES.INVALID_WEBHOOK_URL,
      message: "URL Webhook không hợp lệ",
    });
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new BadRequestException({
      code: ERROR_CODES.INVALID_WEBHOOK_URL,
      message: "Webhook URL chỉ hỗ trợ giao thức HTTP hoặc HTTPS",
    });
  }

  const allowLocal = process.env.ALLOW_LOCAL_WEBHOOKS === "true";
  const host = parsed.hostname.toLowerCase();

  if (!allowLocal) {
    if (
      host === "localhost" ||
      PRIVATE_HOST_SUFFIXES.some((s) => host.endsWith(s)) ||
      isBlockedIp(host)
    ) {
      throw new BadRequestException({
        code: ERROR_CODES.INVALID_WEBHOOK_URL,
        message: "Không được trỏ Webhook về địa chỉ mạng nội bộ hoặc localhost",
      });
    }
  }

  return parsed;
}

export function signWebhookPayload(secret: string, bodyJson: string): string {
  const digest = crypto
    .createHmac("sha256", secret)
    .update(bodyJson)
    .digest("hex");
  return `sha256=${digest}`;
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export function generateTenantApiKey(tenantId: string): {
  plainTextKey: string;
  keyPrefix: string;
  keyHash: string;
} {
  const tenantHex = tenantId.replaceAll("-", "").toLowerCase();
  const secretHex = crypto.randomBytes(20).toString("hex");
  const plainTextKey = `spos_live_${tenantHex}_${secretHex}`;
  return {
    plainTextKey,
    keyPrefix: plainTextKey.slice(0, 22),
    keyHash: hashApiKey(plainTextKey),
  };
}

export function parseTenantApiKeyToken(
  rawKey: string,
): { tenantId: string; keyHash: string } | null {
  const match = /^spos_live_([0-9a-f]{32})_([0-9a-f]{40})$/i.exec(
    rawKey.trim(),
  );
  if (!match) return null;

  const hex = match[1]!.toLowerCase();
  const candidateTenantId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  const parsed = uuidSchema.safeParse(candidateTenantId);
  if (!parsed.success) return null;

  return {
    tenantId: parsed.data,
    keyHash: hashApiKey(rawKey.trim()),
  };
}
