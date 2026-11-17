/**
 * Detects PostgreSQL transaction serialization failures or deadlocks across
 * Prisma ORM errors (P2034) and raw query errors (P2010 with SQLSTATE 40001/40P01).
 */
export function isSerializationConflictError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    meta?: { code?: unknown; message?: unknown };
  };

  if (
    candidate.code === "P2034" ||
    candidate.code === "40001" ||
    candidate.code === "40P01"
  ) {
    return true;
  }

  if (candidate.code === "P2010") {
    const sqlState = String(candidate.meta?.code ?? "");
    if (sqlState === "40001" || sqlState === "40P01") {
      return true;
    }
    const msg = String(candidate.meta?.message ?? "").toLowerCase();
    if (
      msg.includes("could not serialize access") ||
      msg.includes("deadlock detected")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Retries a RepeatableRead/Serializable database transaction on transient
 * serialization failures so concurrent POS checkouts converge cleanly.
 */
export async function runWithSerializableRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 6,
): Promise<T> {
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      if (!isSerializationConflictError(error) || attempt >= maxAttempts) {
        throw error;
      }
      const backoffMs = Math.min(
        100,
        10 * attempt + Math.floor(Math.random() * 15),
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}
