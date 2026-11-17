import { Prisma, PrismaClient } from "@prisma/client";
import { uuidSchema } from "@smart-pos/shared";

/**
 * Explicit separation between platform-global models and tenant-scoped models.
 * Any new model must be placed in one of these sets so scoping is never ambiguous.
 */
export const GLOBAL_MODELS = new Set<string>([
  "subscriptionPlan",
  "tenant",
  "user",
]);

export const TENANT_SCOPED_MODELS = new Set<string>([
  "branch",
  "tenantMember",
  "refreshSession",
  "auditLog",
  "category",
  "product",
  "productVariant",
  "branchInventory",
  "inventoryLedger",
  "supplier",
  "purchaseOrder",
  "purchaseOrderItem",
  "stockCount",
  "stockCountItem",
  "registerShift",
  "customer",
  "invoice",
  "invoiceItem",
  "invoicePayment",
  "salesReturn",
  "salesReturnItem",
  "dailyBranchSummary",
]);

const READ_OPERATIONS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

const UNIQUE_READ_OPERATIONS = new Set(["findUnique", "findUniqueOrThrow"]);

const MUTATION_WITH_WHERE_OPERATIONS = new Set([
  "update",
  "delete",
  "updateMany",
  "deleteMany",
]);

type AnyDelegate = Record<string, (...args: unknown[]) => unknown>;

function assertValidTenantId(tenantId: string): string {
  const parsed = uuidSchema.safeParse(tenantId);
  if (!parsed.success) {
    throw new Error("Invalid tenantId format for tenant-scoped query");
  }
  return parsed.data;
}

function assertTenantRelationMatches(
  record: Record<string, unknown>,
  tenantId: string,
): void {
  const tenantRel = record.tenant as
    | { connect?: { id?: unknown }; create?: unknown; connectOrCreate?: unknown }
    | undefined;
  if (!tenantRel || typeof tenantRel !== "object") return;
  if (tenantRel.create || tenantRel.connectOrCreate) {
    throw new Error("Nested tenant creation inside scoped query is forbidden");
  }
  if (
    tenantRel.connect &&
    tenantRel.connect.id !== undefined &&
    tenantRel.connect.id !== tenantId
  ) {
    throw new Error("Cross-tenant relation connect rejected");
  }
}

function assertCreateDataTenant(
  record: Record<string, unknown>,
  tenantId: string,
): Record<string, unknown> {
  assertTenantRelationMatches(record, tenantId);
  if (
    "tenantId" in record &&
    record.tenantId !== undefined &&
    record.tenantId !== tenantId
  ) {
    throw new Error("Cross-tenant mutation rejected");
  }
  if ("tenant" in record && record.tenant !== undefined) {
    return record;
  }
  return { ...record, tenantId };
}

function rejectTenantReassignment(
  data: Record<string, unknown> | undefined,
  tenantId: string,
): void {
  if (!data) return;
  assertTenantRelationMatches(data, tenantId);
  if (
    "tenantId" in data &&
    data.tenantId !== undefined &&
    data.tenantId !== tenantId
  ) {
    throw new Error("Changing tenantId on an existing record is forbidden");
  }
}

function validateCompoundUniqueTenant(
  where: Record<string, unknown>,
  tenantId: string,
): boolean {
  let hasTenantCompound = false;
  for (const [key, value] of Object.entries(where)) {
    if (
      key.startsWith("tenantId_") &&
      value &&
      typeof value === "object" &&
      "tenantId" in (value as Record<string, unknown>)
    ) {
      const nestedTenantId = (value as Record<string, unknown>).tenantId;
      if (nestedTenantId !== tenantId) {
        throw new Error("Cross-tenant unique lookup rejected");
      }
      hasTenantCompound = true;
    }
  }
  return hasTenantCompound;
}

function scopeWhereClause(
  where: Record<string, unknown> | undefined,
  tenantId: string,
  operationLabel: string,
): { scopedWhere: Record<string, unknown>; hasCompound: boolean } {
  const baseWhere = where ?? {};
  const hasCompound = validateCompoundUniqueTenant(baseWhere, tenantId);
  if ("tenantId" in baseWhere && baseWhere.tenantId !== tenantId) {
    throw new Error(`Cross-tenant ${operationLabel} rejected`);
  }
  return {
    scopedWhere: hasCompound ? baseWhere : { ...baseWhere, tenantId },
    hasCompound,
  };
}

function wrapModelDelegate(
  delegate: AnyDelegate,
  tenantId: string,
): AnyDelegate {
  return new Proxy(delegate, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") {
        return Reflect.get(target, prop, receiver);
      }

      const original = Reflect.get(target, prop, receiver);
      if (typeof original !== "function") {
        return original;
      }

      if (UNIQUE_READ_OPERATIONS.has(prop)) {
        return (rawArgs?: Record<string, unknown>) => {
          const args = rawArgs ? { ...rawArgs } : {};
          const where = args.where as Record<string, unknown> | undefined;
          const { scopedWhere, hasCompound } = scopeWhereClause(
            where,
            tenantId,
            "unique lookup",
          );
          if (hasCompound) {
            return original.call(target, args);
          }
          const fallbackOp =
            prop === "findUniqueOrThrow" ? "findFirstOrThrow" : "findFirst";
          const fallbackFn = target[fallbackOp];
          if (typeof fallbackFn === "function") {
            return fallbackFn.call(target, { ...args, where: scopedWhere });
          }
          return original.call(target, { ...args, where: scopedWhere });
        };
      }

      if (READ_OPERATIONS.has(prop)) {
        return (rawArgs?: Record<string, unknown>) => {
          const args = rawArgs ? { ...rawArgs } : {};
          const { scopedWhere } = scopeWhereClause(
            args.where as Record<string, unknown> | undefined,
            tenantId,
            "read",
          );
          return original.call(target, { ...args, where: scopedWhere });
        };
      }

      if (prop === "create") {
        return (rawArgs?: Record<string, unknown>) => {
          const args = rawArgs ? { ...rawArgs } : {};
          const data = (args.data as Record<string, unknown> | undefined) ?? {};
          return original.call(target, {
            ...args,
            data: assertCreateDataTenant(data, tenantId),
          });
        };
      }

      if (prop === "createMany" || prop === "createManyAndReturn") {
        return (rawArgs?: Record<string, unknown>) => {
          const args = rawArgs ? { ...rawArgs } : {};
          const data = args.data;
          const nextData = Array.isArray(data)
            ? data.map((item) =>
                assertCreateDataTenant(item as Record<string, unknown>, tenantId),
              )
            : data && typeof data === "object"
              ? assertCreateDataTenant(data as Record<string, unknown>, tenantId)
              : data;
          return original.call(target, { ...args, data: nextData });
        };
      }

      if (MUTATION_WITH_WHERE_OPERATIONS.has(prop)) {
        return (rawArgs?: Record<string, unknown>) => {
          const args = rawArgs ? { ...rawArgs } : {};
          const { scopedWhere } = scopeWhereClause(
            args.where as Record<string, unknown> | undefined,
            tenantId,
            "mutation",
          );
          rejectTenantReassignment(
            args.data as Record<string, unknown> | undefined,
            tenantId,
          );
          return original.call(target, { ...args, where: scopedWhere });
        };
      }

      if (prop === "upsert") {
        return (rawArgs?: Record<string, unknown>) => {
          const args = rawArgs ? { ...rawArgs } : {};
          const { scopedWhere } = scopeWhereClause(
            args.where as Record<string, unknown> | undefined,
            tenantId,
            "upsert",
          );
          const createData =
            (args.create as Record<string, unknown> | undefined) ?? {};
          rejectTenantReassignment(
            args.update as Record<string, unknown> | undefined,
            tenantId,
          );
          return original.call(target, {
            ...args,
            where: scopedWhere,
            create: assertCreateDataTenant(createData, tenantId),
          });
        };
      }

      return original.bind(target);
    },
  });
}

/**
 * Wraps a PrismaClient or Prisma.TransactionClient with application-layer tenant scoping.
 * Preserves the underlying connection/transaction while preventing unscoped reads or
 * cross-tenant mutations across every tenant-scoped model.
 */
export function createTenantScopedPrisma<
  T extends PrismaClient | Prisma.TransactionClient,
>(client: T, rawTenantId: string): T {
  const tenantId = assertValidTenantId(rawTenantId);

  return new Proxy(client as unknown as Record<string, unknown>, {
    get(target, prop, receiver) {
      if (typeof prop !== "string" || prop.startsWith("$") || prop.startsWith("_")) {
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      }

      if (GLOBAL_MODELS.has(prop)) {
        return Reflect.get(target, prop, receiver);
      }

      if (TENANT_SCOPED_MODELS.has(prop)) {
        const delegate = Reflect.get(target, prop, receiver) as AnyDelegate;
        return wrapModelDelegate(delegate, tenantId);
      }

      const value = Reflect.get(target, prop, receiver);
      if (value && typeof value === "object") {
        throw new Error(
          `Model delegate "${prop}" is not registered in GLOBAL_MODELS or TENANT_SCOPED_MODELS`,
        );
      }
      return value;
    },
  }) as unknown as T;
}
