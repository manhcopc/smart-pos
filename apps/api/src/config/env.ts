import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .default(
      "postgresql://smartpos:smartpos_dev_password@localhost:5432/smart_pos?schema=public",
    ),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, "JWT_ACCESS_SECRET must be at least 32 characters")
    .default("dev_only_change_me_access_secret_32_chars"),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, "JWT_REFRESH_SECRET must be at least 32 characters")
    .default("dev_only_change_me_refresh_secret_32_chars"),
  JWT_ACCESS_EXPIRES_IN: z.string().min(1).default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().min(1).default("7d"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  SWAGGER_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v !== "false"),
  S3_ENDPOINT: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  S3_REGION: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : "auto")),
  S3_BUCKET: z
    .string()
    .optional()
    .transform((v) =>
      v && v.trim().length > 0 ? v.trim() : "smart-pos-assets",
    ),
  S3_ACCESS_KEY_ID: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  S3_SECRET_ACCESS_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  S3_PUBLIC_BASE_URL: z
    .string()
    .optional()
    .transform((v) =>
      v && v.trim().length > 0 ? v.trim().replace(/\/+$/, "") : undefined,
    ),
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): AppEnv {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join("."));
    throw new Error(
      `Invalid environment configuration for fields: ${fields.join(", ")}`,
    );
  }
  return parsed.data;
}
