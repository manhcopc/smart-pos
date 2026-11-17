import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  type CreateSupplierInput,
  ERROR_CODES,
  type SupplierItem,
  type UpdateSupplierInput,
} from "@smart-pos/shared";
import type { AuthenticatedContext } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";

const SUPPLIER_SELECT = {
  id: true,
  code: true,
  name: true,
  phone: true,
  email: true,
  address: true,
  debtBalance: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SupplierSelect;

type SupplierRow = Prisma.SupplierGetPayload<{
  select: typeof SUPPLIER_SELECT;
}>;

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(auth: AuthenticatedContext): Promise<SupplierItem[]> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const rows = await tx.supplier.findMany({
        select: SUPPLIER_SELECT,
        orderBy: [{ name: "asc" }],
      });
      return rows.map((row) => this.serialize(row));
    });
  }

  async create(
    auth: AuthenticatedContext,
    input: CreateSupplierInput,
  ): Promise<SupplierItem> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const duplicate = await tx.supplier.findFirst({
        where: { code: input.code },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException({
          code: ERROR_CODES.SUPPLIER_CODE_TAKEN,
          message: `Mã nhà cung cấp "${input.code}" đã tồn tại`,
        });
      }

      const created = await tx.supplier.create({
        data: {
          tenantId: auth.tenantId,
          code: input.code,
          name: input.name,
          phone: input.phone ?? null,
          email: input.email ?? null,
          address: input.address ?? null,
          debtBalance: "0.00",
        },
        select: SUPPLIER_SELECT,
      });

      return this.serialize(created);
    });
  }

  async update(
    auth: AuthenticatedContext,
    supplierId: string,
    input: UpdateSupplierInput,
  ): Promise<SupplierItem> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const existing = await tx.supplier.findFirst({
        where: { id: supplierId },
        select: { id: true },
      });
      if (!existing) {
        throw new NotFoundException({
          code: ERROR_CODES.SUPPLIER_NOT_FOUND,
          message: "Không tìm thấy nhà cung cấp",
        });
      }

      const updated = await tx.supplier.update({
        where: { id: supplierId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.address !== undefined ? { address: input.address } : {}),
        },
        select: SUPPLIER_SELECT,
      });

      return this.serialize(updated);
    });
  }

  private serialize(row: SupplierRow): SupplierItem {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      debtBalance: row.debtBalance.toFixed(2),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
