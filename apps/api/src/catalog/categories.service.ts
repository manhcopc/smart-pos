import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  type CategoryItem,
  type CreateCategoryInput,
  ERROR_CODES,
  type UpdateCategoryInput,
} from "@smart-pos/shared";
import type { AuthenticatedContext } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";

const CATEGORY_SELECT = {
  id: true,
  parentId: true,
  name: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: { products: true },
  },
} satisfies Prisma.CategorySelect;

type CategoryRow = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(auth: AuthenticatedContext): Promise<CategoryItem[]> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const rows = await tx.category.findMany({
        select: CATEGORY_SELECT,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      });
      return rows.map((row) => this.serialize(row));
    });
  }

  async create(
    auth: AuthenticatedContext,
    input: CreateCategoryInput,
  ): Promise<CategoryItem> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      if (input.parentId) {
        await this.assertCategoryExists(tx, input.parentId);
      }

      const created = await tx.category.create({
        data: {
          tenantId: auth.tenantId,
          parentId: input.parentId ?? null,
          name: input.name,
          sortOrder: input.sortOrder,
        },
        select: CATEGORY_SELECT,
      });

      return this.serialize(created);
    });
  }

  async update(
    auth: AuthenticatedContext,
    categoryId: string,
    input: UpdateCategoryInput,
  ): Promise<CategoryItem> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      await this.assertCategoryExists(tx, categoryId);

      if (input.parentId !== undefined && input.parentId !== null) {
        if (input.parentId === categoryId) {
          throw new BadRequestException({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: "Nhóm hàng không thể tự làm nhóm cha của chính nó",
          });
        }
        await this.assertNoCycle(tx, categoryId, input.parentId);
      }

      const updated = await tx.category.update({
        where: { id: categoryId },
        data: {
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.sortOrder !== undefined
            ? { sortOrder: input.sortOrder }
            : {}),
        },
        select: CATEGORY_SELECT,
      });

      return this.serialize(updated);
    });
  }

  async remove(
    auth: AuthenticatedContext,
    categoryId: string,
  ): Promise<{ success: true }> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      await this.assertCategoryExists(tx, categoryId);
      await tx.category.delete({ where: { id: categoryId } });
      return { success: true };
    });
  }

  private async assertCategoryExists(
    tx: Prisma.TransactionClient,
    categoryId: string,
  ): Promise<void> {
    const found = await tx.category.findFirst({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException({
        code: ERROR_CODES.CATEGORY_NOT_FOUND,
        message: "Không tìm thấy nhóm hàng",
      });
    }
  }

  private async assertNoCycle(
    tx: Prisma.TransactionClient,
    targetId: string,
    proposedParentId: string,
  ): Promise<void> {
    const categories = await tx.category.findMany({
      select: { id: true, parentId: true },
    });
    const parentById = new Map(categories.map((c) => [c.id, c.parentId]));

    if (!parentById.has(proposedParentId)) {
      throw new NotFoundException({
        code: ERROR_CODES.CATEGORY_NOT_FOUND,
        message: "Không tìm thấy nhóm hàng cha",
      });
    }

    let cursor: string | null | undefined = proposedParentId;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === targetId) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: "Không thể chọn nhóm con làm nhóm cha (vòng lặp phân cấp)",
        });
      }
      if (visited.has(cursor)) {
        break;
      }
      visited.add(cursor);
      cursor = parentById.get(cursor);
    }
  }

  private serialize(row: CategoryRow): CategoryItem {
    return {
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      sortOrder: row.sortOrder,
      productCount: row._count.products,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
