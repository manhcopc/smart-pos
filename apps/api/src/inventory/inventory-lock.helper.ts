import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { parseMoney, parseQuantity } from "@smart-pos/shared";

export interface LockedBranchInventoryState {
  onHandMilli: bigint;
  reservedMilli: bigint;
  avgCostMinor: bigint;
}

/**
 * Ensure a `branch_inventories` row exists and acquire a row-level `FOR UPDATE`
 * lock inside the current tenant transaction before mutating stock or AVCO cost.
 */
export async function lockBranchInventoryRow(
  tx: Prisma.TransactionClient,
  tenantId: string,
  branchId: string,
  variantId: string,
): Promise<LockedBranchInventoryState> {
  await tx.$executeRaw`
    INSERT INTO branch_inventories (
      id, tenant_id, branch_id, variant_id, on_hand, reserved, avg_cost, updated_at
    ) VALUES (
      ${crypto.randomUUID()}::uuid,
      ${tenantId}::uuid,
      ${branchId}::uuid,
      ${variantId}::uuid,
      0,
      0,
      0,
      now()
    )
    ON CONFLICT (tenant_id, branch_id, variant_id) DO NOTHING
  `;

  const rows = await tx.$queryRaw<
    Array<{ on_hand: string; reserved: string; avg_cost: string }>
  >`
    SELECT
      on_hand::text AS on_hand,
      reserved::text AS reserved,
      avg_cost::text AS avg_cost
    FROM branch_inventories
    WHERE tenant_id = ${tenantId}::uuid
      AND branch_id = ${branchId}::uuid
      AND variant_id = ${variantId}::uuid
    FOR UPDATE
  `;

  const row = rows[0];
  return {
    onHandMilli: row ? parseQuantity(row.on_hand) : 0n,
    reservedMilli: row ? parseQuantity(row.reserved) : 0n,
    avgCostMinor: row ? parseMoney(row.avg_cost) : 0n,
  };
}

export function generateDocumentCode(prefix: string): string {
  const datePart = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const randPart = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${datePart}-${randPart}`;
}
