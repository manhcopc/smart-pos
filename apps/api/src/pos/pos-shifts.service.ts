import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  type CloseShiftInput,
  ERROR_CODES,
  formatMoney,
  type OpenShiftInput,
  parseMoney,
  PAYMENT_METHODS,
  type PaymentMethod,
  type RegisterShiftItem,
  type ShiftQuery,
  type ShiftZReportResponse,
} from "@smart-pos/shared";
import type { AuthenticatedContext, RequestMeta } from "../auth/auth.types";
import { assertBranchAccessibleInTx } from "../common/tenant/tenant-quota.helper";
import { runWithSerializableRetry } from "../prisma/prisma-retry.helper";
import { PrismaService } from "../prisma/prisma.service";

const SHIFT_SELECT = {
  id: true,
  branchId: true,
  openedByMemberId: true,
  closedByMemberId: true,
  status: true,
  openingCash: true,
  expectedCash: true,
  actualCash: true,
  cashVariance: true,
  openedAt: true,
  closedAt: true,
  note: true,
  branch: { select: { code: true, name: true } },
  openedByMember: { select: { user: { select: { fullName: true } } } },
  closedByMember: { select: { user: { select: { fullName: true } } } },
} satisfies Prisma.RegisterShiftSelect;

type ShiftRow = Prisma.RegisterShiftGetPayload<{ select: typeof SHIFT_SELECT }>;

@Injectable()
export class PosShiftsService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentOpenShift(
    auth: AuthenticatedContext,
    branchId: string,
  ): Promise<RegisterShiftItem | null> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      await assertBranchAccessibleInTx(tx, auth, branchId);
      const shift = await tx.registerShift.findFirst({
        where: { branchId, status: "OPEN" },
        select: SHIFT_SELECT,
        orderBy: { openedAt: "desc" },
      });
      return shift ? this.serializeShift(shift) : null;
    });
  }

  async listShifts(
    auth: AuthenticatedContext,
    query: ShiftQuery,
  ): Promise<{
    items: RegisterShiftItem[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      if (query.branchId) {
        await assertBranchAccessibleInTx(tx, auth, query.branchId);
      }

      const branchFilter = query.branchId
        ? query.branchId
        : auth.allowedBranchIds.length > 0
          ? { in: auth.allowedBranchIds }
          : undefined;

      const where: Prisma.RegisterShiftWhereInput = {
        ...(branchFilter !== undefined ? { branchId: branchFilter } : {}),
        ...(query.status ? { status: query.status } : {}),
      };

      const skip = (query.page - 1) * query.limit;
      const [total, rows] = await Promise.all([
        tx.registerShift.count({ where }),
        tx.registerShift.findMany({
          where,
          select: SHIFT_SELECT,
          orderBy: { openedAt: "desc" },
          skip,
          take: query.limit,
        }),
      ]);

      return {
        items: rows.map((row) => this.serializeShift(row)),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.limit)),
        },
      };
    });
  }

  async openShift(
    auth: AuthenticatedContext,
    input: OpenShiftInput,
  ): Promise<RegisterShiftItem> {
    const openingCashStr = formatMoney(parseMoney(input.openingCash));

    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      await assertBranchAccessibleInTx(tx, auth, input.branchId);

      // Lock the branch row to prevent race-condition dual open shifts on the same branch.
      await tx.$queryRaw`
        SELECT id
        FROM branches
        WHERE id = ${input.branchId}::uuid
          AND tenant_id = ${auth.tenantId}::uuid
        FOR UPDATE
      `;

      const existingOpen = await tx.registerShift.findFirst({
        where: { branchId: input.branchId, status: "OPEN" },
        select: { id: true },
      });

      if (existingOpen) {
        throw new ConflictException({
          code: ERROR_CODES.SHIFT_ALREADY_OPEN,
          message: "Chi nhánh này đang có một ca thu ngân đang mở",
        });
      }

      const created = await tx.registerShift.create({
        data: {
          tenantId: auth.tenantId,
          branchId: input.branchId,
          openedByMemberId: auth.memberId,
          status: "OPEN",
          openingCash: openingCashStr,
          expectedCash: openingCashStr,
          note: input.note ?? null,
        },
        select: SHIFT_SELECT,
      });

      return this.serializeShift(created);
    });
  }

  async getZReport(
    auth: AuthenticatedContext,
    shiftId: string,
  ): Promise<ShiftZReportResponse> {
    return this.prisma.withTenantTransaction(auth.tenantId, async (tx) => {
      const shift = await tx.registerShift.findFirst({
        where: { id: shiftId },
        select: SHIFT_SELECT,
      });

      if (!shift) {
        throw new NotFoundException({
          code: ERROR_CODES.SHIFT_NOT_FOUND,
          message: "Không tìm thấy ca làm việc",
        });
      }

      await assertBranchAccessibleInTx(tx, auth, shift.branchId);
      return this.buildZReportInTx(tx, shift);
    });
  }

  async closeShift(
    auth: AuthenticatedContext,
    shiftId: string,
    input: CloseShiftInput,
    meta: RequestMeta,
  ): Promise<ShiftZReportResponse> {
    return runWithSerializableRetry(() =>
      this.prisma.withTenantTransaction(
        auth.tenantId,
        async (tx) => {
        const lockedRows = await tx.$queryRaw<
          Array<{
            id: string;
            branch_id: string;
            status: string;
            expected_cash: string;
          }>
        >`
          SELECT
            id,
            branch_id,
            status::text AS status,
            expected_cash::numeric(15, 2)::text AS expected_cash
          FROM register_shifts
          WHERE id = ${shiftId}::uuid
            AND tenant_id = ${auth.tenantId}::uuid
          FOR UPDATE
        `;

        const locked = lockedRows[0];
        if (!locked) {
          throw new NotFoundException({
            code: ERROR_CODES.SHIFT_NOT_FOUND,
            message: "Không tìm thấy ca làm việc",
          });
        }

        await assertBranchAccessibleInTx(tx, auth, locked.branch_id);

        if (locked.status !== "OPEN") {
          throw new BadRequestException({
            code: ERROR_CODES.SHIFT_NOT_OPEN,
            message: "Ca thu ngân này đã được đóng trước đó",
          });
        }

        const expectedMinor = parseMoney(locked.expected_cash);
        const actualMinor = parseMoney(input.actualCash);
        const varianceMinor = actualMinor - expectedMinor;

        const actualStr = formatMoney(actualMinor);
        const varianceStr = formatMoney(varianceMinor);

        const updated = await tx.registerShift.update({
          where: { id: shiftId },
          data: {
            status: "CLOSED",
            closedByMemberId: auth.memberId,
            actualCash: actualStr,
            cashVariance: varianceStr,
            closedAt: new Date(),
            ...(input.note !== undefined ? { note: input.note } : {}),
          },
          select: SHIFT_SELECT,
        });

        if (varianceMinor !== 0n) {
          await tx.auditLog.create({
            data: {
              tenantId: auth.tenantId,
              branchId: locked.branch_id,
              actorMemberId: auth.memberId,
              action: "SHIFT_DIFF",
              entityType: "register_shift",
              entityId: shiftId,
              ipAddress: meta.ipAddress ?? null,
              metadata: {
                expectedCash: formatMoney(expectedMinor),
                actualCash: actualStr,
                cashVariance: varianceStr,
                note: input.note ?? null,
              },
            },
          });
        }

        return this.buildZReportInTx(tx, updated);
        },
        { isolationLevel: "RepeatableRead" },
      ),
    );
  }

  private async buildZReportInTx(
    tx: Prisma.TransactionClient,
    shift: ShiftRow,
  ): Promise<ShiftZReportResponse> {
    const [invoices, paymentAgg] = await Promise.all([
      tx.invoice.findMany({
        where: {
          shiftId: shift.id,
          status: { not: "VOIDED" },
        },
        select: {
          subtotal: true,
          discountAmount: true,
          taxAmount: true,
          totalAmount: true,
          cogsAmount: true,
        },
      }),
      tx.invoicePayment.groupBy({
        by: ["method"],
        where: {
          invoice: {
            shiftId: shift.id,
            status: { not: "VOIDED" },
          },
        },
        _sum: { amount: true },
      }),
    ]);

    let grossSalesMinor = 0n;
    let discountTotalMinor = 0n;
    let taxTotalMinor = 0n;
    let cogsTotalMinor = 0n;

    for (const inv of invoices) {
      grossSalesMinor += parseMoney(inv.subtotal.toString());
      discountTotalMinor += parseMoney(inv.discountAmount.toString());
      taxTotalMinor += parseMoney(inv.taxAmount.toString());
      cogsTotalMinor += parseMoney(inv.cogsAmount.toString());
    }

    const netSalesMinor = grossSalesMinor - discountTotalMinor;
    const grossProfitMinor = netSalesMinor - cogsTotalMinor;

    const paymentTotals = Object.fromEntries(
      PAYMENT_METHODS.map((method) => [method, "0.00"]),
    ) as Record<PaymentMethod, string>;

    for (const group of paymentAgg) {
      if (group._sum.amount) {
        paymentTotals[group.method] = formatMoney(
          parseMoney(group._sum.amount.toString()),
        );
      }
    }

    return {
      shift: this.serializeShift(shift),
      summary: {
        invoiceCount: invoices.length,
        grossSales: formatMoney(grossSalesMinor),
        discountTotal: formatMoney(discountTotalMinor),
        taxTotal: formatMoney(taxTotalMinor),
        netSales: formatMoney(netSalesMinor),
        cogsTotal: formatMoney(cogsTotalMinor),
        grossProfit: formatMoney(grossProfitMinor),
        paymentTotals,
      },
    };
  }

  private serializeShift(row: ShiftRow): RegisterShiftItem {
    return {
      id: row.id,
      branchId: row.branchId,
      branchCode: row.branch.code,
      branchName: row.branch.name,
      openedByMemberId: row.openedByMemberId,
      openedByName: row.openedByMember.user.fullName,
      closedByMemberId: row.closedByMemberId,
      closedByName: row.closedByMember?.user.fullName ?? null,
      status: row.status,
      openingCash: row.openingCash.toFixed(2),
      expectedCash: row.expectedCash.toFixed(2),
      actualCash: row.actualCash ? row.actualCash.toFixed(2) : null,
      cashVariance: row.cashVariance ? row.cashVariance.toFixed(2) : null,
      openedAt: row.openedAt.toISOString(),
      closedAt: row.closedAt ? row.closedAt.toISOString() : null,
      note: row.note,
    };
  }
}
