import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { uuidSchema } from "@smart-pos/shared";
import { createTenantScopedPrisma } from "./tenant-context";

export interface TenantTransactionOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  maxWait?: number;
  timeout?: number;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    if (process.env.SKIP_DB_CONNECT === "true") {
      return;
    }
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Executes database work inside an explicit transaction bound to a verified tenantId.
   * Sets transaction-local PostgreSQL RLS context (`app.current_tenant_id`) and wraps
   * the transaction client with application-layer tenant scoping.
   */
  async withTenantTransaction<T>(
    tenantId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: TenantTransactionOptions,
  ): Promise<T> {
    const parsedTenantId = uuidSchema.parse(tenantId);

    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${parsedTenantId}, true)`;
        const scopedTx = createTenantScopedPrisma(tx, parsedTenantId);
        return work(scopedTx);
      },
      {
        isolationLevel: options?.isolationLevel,
        maxWait: options?.maxWait,
        timeout: options?.timeout,
      },
    );
  }

  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
