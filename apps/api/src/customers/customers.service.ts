import crypto from "node:crypto";
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  type AdjustCustomerLoyaltyInput,
  type CreateCustomerInput,
  type CustomerDetailResponse,
  type CustomerItem,
  type CustomerQuery,
  ERROR_CODES,
  type UpdateCustomerInput,
} from "@smart-pos/shared";
import type { AuthenticatedContext, RequestMeta } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";

const CUSTOMER_SELECT = {
  id: true,
  code: true,
  name: true,
  phone: true,
  email: true,
  loyaltyPoints: true,
  totalSpent: true,
  debtBalance: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CustomerSelect;

type CustomerRow = Prisma.CustomerGetPayload<{ select: typeof CUSTOMER_SELECT }>;

function generateCustomerCode(): string {
  return `KH-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async listCustomers(
    auth: AuthenticatedContext,
    query: CustomerQuery,
  ): Promise<{
    items: CustomerItem[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const search = query.search?.trim();
      const where: Prisma.CustomerWhereInput = search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { phone: { contains: search, mode: "insensitive" } },
              { code: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          }
        : {};

      const skip = (query.page - 1) * query.limit;
      const [total, rows] = await Promise.all([
        tx.customer.count({ where }),
        tx.customer.findMany({
          where,
          select: CUSTOMER_SELECT,
          orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
          skip,
          take: query.limit,
        }),
      ]);

      return {
        items: rows.map((row) => this.serializeCustomer(row)),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.limit)),
        },
      };
    });
  }

  async getCustomerDetail(
    auth: AuthenticatedContext,
    customerId: string,
  ): Promise<CustomerDetailResponse> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const row = await tx.customer.findFirst({
        where: { id: customerId },
        select: CUSTOMER_SELECT,
      });
      if (!row) {
        throw new NotFoundException({
          code: ERROR_CODES.CUSTOMER_NOT_FOUND,
          message: "Không tìm thấy hồ sơ khách hàng",
        });
      }

      const branchFilter =
        auth.allowedBranchIds.length > 0
          ? { in: auth.allowedBranchIds }
          : undefined;

      const invoices = await tx.invoice.findMany({
        where: {
          customerId,
          ...(branchFilter !== undefined ? { branchId: branchFilter } : {}),
        },
        select: {
          id: true,
          code: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          branch: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 25,
      });

      return {
        ...this.serializeCustomer(row),
        recentInvoices: invoices.map((inv) => ({
          id: inv.id,
          code: inv.code,
          branchName: inv.branch.name,
          status: inv.status,
          totalAmount: inv.totalAmount.toFixed(2),
          createdAt: inv.createdAt.toISOString(),
        })),
      };
    });
  }

  async createCustomer(
    auth: AuthenticatedContext,
    input: CreateCustomerInput,
  ): Promise<CustomerItem> {
    const code = input.code ?? generateCustomerCode();
    try {
      return await this.prisma.withTenantTransaction(
        auth.tenantId,
        async (tx) => {
          const created = await tx.customer.create({
            data: {
              tenantId: auth.tenantId,
              code,
              name: input.name,
              phone: input.phone ?? null,
              email: input.email ?? null,
            },
            select: CUSTOMER_SELECT,
          });
          return this.serializeCustomer(created);
        },
      );
    } catch (error) {
      this.rethrowUniqueConflict(error);
      throw error;
    }
  }

  async updateCustomer(
    auth: AuthenticatedContext,
    customerId: string,
    input: UpdateCustomerInput,
  ): Promise<CustomerItem> {
    try {
      return await this.prisma.withTenantTransaction(
        auth.tenantId,
        async (tx) => {
          const existing = await tx.customer.findFirst({
            where: { id: customerId },
            select: { id: true },
          });
          if (!existing) {
            throw new NotFoundException({
              code: ERROR_CODES.CUSTOMER_NOT_FOUND,
              message: "Không tìm thấy hồ sơ khách hàng",
            });
          }

          const updated = await tx.customer.update({
            where: { id: customerId },
            data: {
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(input.phone !== undefined ? { phone: input.phone } : {}),
              ...(input.email !== undefined ? { email: input.email } : {}),
            },
            select: CUSTOMER_SELECT,
          });
          return this.serializeCustomer(updated);
        },
      );
    } catch (error) {
      this.rethrowUniqueConflict(error);
      throw error;
    }
  }

  async adjustLoyaltyPoints(
    auth: AuthenticatedContext,
    customerId: string,
    input: AdjustCustomerLoyaltyInput,
    meta: RequestMeta,
  ): Promise<CustomerItem> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const existing = await tx.customer.findFirst({
        where: { id: customerId },
        select: { id: true, code: true, name: true, loyaltyPoints: true },
      });
      if (!existing) {
        throw new NotFoundException({
          code: ERROR_CODES.CUSTOMER_NOT_FOUND,
          message: "Không tìm thấy hồ sơ khách hàng",
        });
      }

      const updatedRows = await tx.$queryRaw<Array<{ loyalty_points: number }>>`
        UPDATE customers
        SET
          loyalty_points = loyalty_points + ${input.pointsDelta}::int,
          updated_at = now()
        WHERE tenant_id = ${auth.tenantId}::uuid
          AND id = ${customerId}::uuid
          AND (loyalty_points + ${input.pointsDelta}::int) >= 0
        RETURNING loyalty_points
      `;

      if (updatedRows.length === 0) {
        throw new ConflictException({
          code: ERROR_CODES.INSUFFICIENT_LOYALTY_POINTS,
          message: "Số điểm sau điều chỉnh không được nhỏ hơn 0",
        });
      }

      await tx.auditLog.create({
        data: {
          tenantId: auth.tenantId,
          actorMemberId: auth.memberId,
          action: "CUSTOMER_LOYALTY_ADJUST",
          entityType: "customer",
          entityId: customerId,
          ipAddress: meta.ipAddress ?? null,
          metadata: {
            customerCode: existing.code,
            customerName: existing.name,
            pointsBefore: existing.loyaltyPoints,
            pointsDelta: input.pointsDelta,
            pointsAfter: updatedRows[0]!.loyalty_points,
            reason: input.reason,
          },
        },
      });

      const reloaded = await tx.customer.findFirstOrThrow({
        where: { id: customerId },
        select: CUSTOMER_SELECT,
      });
      return this.serializeCustomer(reloaded);
    });
  }

  private serializeCustomer(row: CustomerRow): CustomerItem {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      phone: row.phone,
      email: row.email,
      loyaltyPoints: row.loyaltyPoints,
      totalSpent: row.totalSpent.toFixed(2),
      debtBalance: row.debtBalance.toFixed(2),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private rethrowUniqueConflict(error: unknown): void {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      (error as { code?: unknown }).code !== "P2002"
    ) {
      return;
    }
    const meta = (error as { meta?: { target?: unknown } }).meta;
    const target = Array.isArray(meta?.target)
      ? meta.target.join(",")
      : String(meta?.target ?? "");
    if (target.includes("phone")) {
      throw new ConflictException({
        code: ERROR_CODES.CUSTOMER_PHONE_TAKEN,
        message: "Số điện thoại khách hàng đã tồn tại trong cửa hàng",
      });
    }
    throw new ConflictException({
      code: ERROR_CODES.CUSTOMER_CODE_TAKEN,
      message: "Mã khách hàng đã tồn tại trong cửa hàng",
    });
  }
}
