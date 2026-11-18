import {
  type AccountingExportQuery,
  type AdjustCustomerLoyaltyInput,
  type BalanceStockCountInput,
  calculatePosInvoiceTotals,
  type CashierPinLoginInput,
  type CloseShiftInput,
  type CompletePurchaseOrderInput,
  type CreateApiKeyInput,
  type CreateApiKeyResponse,
  type CreateBranchInput,
  type CreateCategoryInput,
  type CreateCustomerInput,
  type CreateInvoiceInput,
  type CreateProductInput,
  type CreatePurchaseOrderInput,
  type CreateReportExportInput,
  type CreateSalesReturnInput,
  type CreateStaffMemberInput,
  type CreateStockCountInput,
  type CreateStockTransferInput,
  type CreateSupplierInput,
  type CreateWebhookInput,
  ERROR_CODES,
  type InvoiceDetailResponse,
  type OpenShiftInput,
  type OwnerLoginInput,
  type PresignProductImageInput,
  type ProductVariantInput,
  type RegisterTenantInput,
  type SalesReturnResponse,
  type StockCountItemResponse,
  type StockTransferItemView,
  type SubscribePlanInput,
  type SupervisorPinVerifyInput,
  type UpdateBranchInput,
  type UpdateCategoryInput,
  type UpdateCustomerInput,
  type UpdateProductInput,
  type UpdateStaffMemberInput,
  type UpdateSupplierInput,
  type UpdateVariantInput,
  type UpdateWebhookInput,
  type VoidInvoiceInput,
  type AuthSessionResponse,
  type OfflineSyncBatchInput,
  type OfflineSyncBatchResponse,
  type OfflineSyncItemOutcome,
  type OfflineSyncLatestStockInfo,
  type ShiftZReportResponse,
} from "@smart-pos/shared";
import { getMockRole, setMockRole } from "../data-mode";
import {
  buildMockReportOverview,
  createInitialMockState,
  memberForRole,
  type MockTenantState,
  permissionsForMember,
  toAuthBranches,
} from "./seed-fixtures";

export class MockHttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string = ERROR_CODES.INTERNAL_ERROR,
  ) {
    super(message);
    this.name = "MockHttpError";
  }
}

let state: MockTenantState = createInitialMockState();
let seqCounter = 100;

export function resetMockState(): void {
  state = createInitialMockState();
  seqCounter = 100;
}

function nextUuid(): string {
  seqCounter += 1;
  const tail = String(seqCounter).padStart(12, "0");
  return `f0000000-0000-4000-8000-${tail}`;
}

function parseBody<T>(init?: RequestInit): T {
  if (!init?.body || typeof init.body !== "string") {
    return {} as T;
  }
  return JSON.parse(init.body) as T;
}

function paginate<T>(items: T[], sp: URLSearchParams) {
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const limit = Math.max(1, Math.min(100, Number(sp.get("limit") ?? 20) || 20));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const slice = items.slice((page - 1) * limit, page * limit);
  return {
    items: slice,
    pagination: { page, limit, total, totalPages },
  };
}

function currentPlan() {
  return (
    state.plans.find((p) => p.code === state.tenant.planCode) ?? state.plans[0]!
  );
}

function currentMember() {
  return memberForRole(state, getMockRole());
}

function buildAuthSession(): AuthSessionResponse {
  const member = currentMember();
  const visibleBranches = toAuthBranches(state.branches).filter(
    (b) =>
      member.allowedBranchIds.length === 0 ||
      member.allowedBranchIds.includes(b.id),
  );
  return {
    accessToken: "mock-access-token",
    redirectTo: member.role === "CASHIER" ? "/pos" : "/dashboard",
    user: {
      id: member.userId,
      email: member.email,
      fullName: member.fullName,
    },
    tenant: {
      id: state.tenant.id,
      slug: state.tenant.slug,
      name: state.tenant.name,
      businessType: state.tenant.businessType,
      planCode: state.tenant.planCode,
    },
    member: {
      id: member.id,
      employeeCode: member.employeeCode,
      role: member.role,
      allowedBranchIds: member.allowedBranchIds,
      permissions: permissionsForMember(member),
    },
    branches: visibleBranches.length > 0 ? visibleBranches : toAuthBranches(state.branches),
  };
}

function enrichProductsWithBranchStock(branchId?: string) {
  const targetBranchId = branchId ?? state.branches[0]?.id;
  return state.products.map((prod) => ({
    ...prod,
    variants: prod.variants.map((v) => {
      const inv = state.inventory.find(
        (row) => row.branchId === targetBranchId && row.variantId === v.id,
      );
      return {
        ...v,
        branchStock: inv
          ? {
              branchId: inv.branchId,
              onHand: inv.onHand,
              reserved: inv.reserved,
              available: inv.available,
              avgCost: inv.avgCost,
              isLowStock: inv.isLowStock,
            }
          : null,
      };
    }),
  }));
}

function adjustBranchStock(params: {
  branchId: string;
  variantId: string;
  qtyDelta: number;
  unitCost?: number;
  movementType: MockTenantState["ledgers"][number]["movementType"];
  referenceType: string;
  referenceId: string;
  note: string;
}): void {
  const branch = state.branches.find((b) => b.id === params.branchId);
  if (!branch) return;

  let inv = state.inventory.find(
    (r) => r.branchId === params.branchId && r.variantId === params.variantId,
  );
  let prodRef: (typeof state.products)[number] | undefined;
  let varRef: (typeof state.products)[number]["variants"][number] | undefined;
  for (const p of state.products) {
    const found = p.variants.find((v) => v.id === params.variantId);
    if (found) {
      prodRef = p;
      varRef = found;
      break;
    }
  }
  if (!prodRef || !varRef) return;

  const now = new Date().toISOString();
  if (!inv) {
    inv = {
      branchId: branch.id,
      branchCode: branch.code,
      branchName: branch.name,
      variantId: varRef.id,
      productId: prodRef.id,
      productName: prodRef.name,
      variantName: varRef.name,
      sku: varRef.sku,
      barcode: varRef.barcode,
      unit: varRef.unit,
      minStockAlert: varRef.minStockAlert,
      onHand: "0.000",
      reserved: "0.000",
      available: "0.000",
      avgCost: varRef.costPrice,
      salePrice: varRef.salePrice,
      stockValue: "0.00",
      isLowStock: true,
      updatedAt: now,
    };
    state.inventory.push(inv);
  }

  const before = Number(inv.onHand);
  const reserved = Number(inv.reserved);
  const after = Math.max(0, before + params.qtyDelta);
  const oldAvgCost = Number(inv.avgCost);
  let nextAvgCost = oldAvgCost;
  if (params.qtyDelta > 0 && params.unitCost !== undefined && after > 0) {
    nextAvgCost =
      (before * oldAvgCost + params.qtyDelta * params.unitCost) / after;
  }

  inv.onHand = after.toFixed(3);
  inv.available = Math.max(0, after - reserved).toFixed(3);
  inv.avgCost = nextAvgCost.toFixed(2);
  inv.stockValue = (after * nextAvgCost).toFixed(2);
  inv.isLowStock = after <= inv.minStockAlert;
  inv.updatedAt = now;

  const actor = currentMember();
  state.ledgers.unshift({
    id: nextUuid(),
    branchId: branch.id,
    branchCode: branch.code,
    branchName: branch.name,
    variantId: varRef.id,
    sku: varRef.sku,
    variantName: varRef.name,
    movementType: params.movementType,
    qtyDelta: params.qtyDelta.toFixed(3),
    qtyBefore: before.toFixed(3),
    qtyAfter: after.toFixed(3),
    unitCost: (params.unitCost ?? nextAvgCost).toFixed(2),
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    actorName: actor.fullName,
    actorEmployeeCode: actor.employeeCode,
    note: params.note,
    createdAt: now,
  });
}

function executeMockCheckout(body: CreateInvoiceInput) {
  const existing = state.invoices.find(
    (inv) => inv.idempotencyKey === body.idempotencyKey,
  );
  if (existing) return existing;

  const shift = state.shifts.find(
    (s) => s.id === body.shiftId && s.status === "OPEN",
  );
  if (!shift) {
    throw new MockHttpError(
      "Ca thu ngân đã đóng hoặc không tồn tại",
      409,
      ERROR_CODES.SHIFT_NOT_OPEN,
    );
  }
  const branch = state.branches.find((b) => b.id === body.branchId);
  if (!branch) {
    throw new MockHttpError("Không tìm thấy chi nhánh", 404, ERROR_CODES.BRANCH_NOT_FOUND);
  }

  // Verify stock atomically before mutating.
  for (const item of body.items) {
    const inv = state.inventory.find(
      (r) => r.branchId === body.branchId && r.variantId === item.variantId,
    );
    const avail = inv ? Number(inv.available) : 0;
    if (avail < Number(item.quantity)) {
      throw new MockHttpError(
        `SKU "${inv?.sku ?? item.variantId}" chỉ còn ${avail} khả dụng`,
        409,
        ERROR_CODES.INSUFFICIENT_STOCK,
      );
    }
  }

  const lineMeta = body.items.map((item) => {
    let prodName = "Sản phẩm";
    let varName = "Mặc định";
    let sku = "SKU";
    let salePrice = "0.00";
    let taxRate = "0.00";
    for (const p of state.products) {
      const v = p.variants.find((vr) => vr.id === item.variantId);
      if (v) {
        prodName = p.name;
        varName = v.name;
        sku = v.sku;
        salePrice = v.salePrice;
        taxRate = v.taxRate;
        break;
      }
    }
    return {
      ...item,
      productName: `${prodName} - ${varName}`,
      sku,
      unitPrice: item.overrideUnitPrice ?? salePrice,
      taxRate,
    };
  });

  let totals;
  try {
    totals = calculatePosInvoiceTotals({
      lines: lineMeta.map((l) => ({
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountAmount: l.discountAmount ?? "0.00",
        taxRate: l.taxRate,
      })),
      invoiceDiscountAmount: body.discountAmount ?? "0.00",
      payments: body.payments,
    });
  } catch (err) {
    throw new MockHttpError(
      err instanceof Error ? err.message : "Số tiền thanh toán chưa đủ",
      400,
      ERROR_CODES.PAYMENT_MISMATCH,
    );
  }

  const now = new Date().toISOString();
  const invId = nextUuid();
  const code = `HD-${now.slice(2, 10).replaceAll("-", "")}-${String(seqCounter).slice(-3)}`;

  const invoiceLines = lineMeta.map((l, idx) => {
    const qty = Number(l.quantity);
    const unit = Number(l.unitPrice);
    const disc = Number(l.discountAmount ?? "0");
    const lineTotal = Math.max(0, qty * unit - disc).toFixed(2);
    adjustBranchStock({
      branchId: body.branchId,
      variantId: l.variantId,
      qtyDelta: -qty,
      movementType: "SALE",
      referenceType: "invoice",
      referenceId: invId,
      note: `Bán hàng POS ${code}`,
    });
    return {
      id: `${invId}-l${idx}`,
      variantId: l.variantId,
      productName: l.productName,
      sku: l.sku,
      quantity: Number(l.quantity).toFixed(3),
      returnedQty: "0.000",
      unitPrice: Number(l.unitPrice).toFixed(2),
      discountAmount: Number(l.discountAmount ?? "0").toFixed(2),
      taxAmount: "0.00",
      lineTotal,
    };
  });

  const customer = body.customerId
    ? state.customers.find((c) => c.id === body.customerId)
    : undefined;
  const earnedPoints = customer
    ? Math.floor(Number(totals.formatted.totalAmount) / 10000)
    : 0;
  if (customer) {
    customer.loyaltyPoints += earnedPoints;
    customer.totalSpent = (
      Number(customer.totalSpent) + Number(totals.formatted.totalAmount)
    ).toFixed(2);
    customer.recentInvoices.unshift({
      id: invId,
      code,
      branchName: branch.name,
      status: "COMPLETED",
      totalAmount: totals.formatted.totalAmount,
      createdAt: now,
    });
  }

  const cashReceived = Number(totals.formatted.netCashReceived);
  shift.expectedCash = (Number(shift.expectedCash) + cashReceived).toFixed(2);

  const member = currentMember();
  const receipt: InvoiceDetailResponse = {
    id: invId,
    code,
    idempotencyKey: body.idempotencyKey,
    branchId: branch.id,
    branchCode: branch.code,
    branchName: branch.name,
    shiftId: shift.id,
    cashierMemberId: member.id,
    cashierName: member.fullName,
    customerId: customer?.id ?? null,
    customerName: customer?.name ?? null,
    earnedPoints,
    status: "COMPLETED",
    subtotal: totals.formatted.subtotal,
    discountAmount: totals.formatted.discountAmount,
    taxAmount: totals.formatted.taxAmount,
    totalAmount: totals.formatted.totalAmount,
    paidAmount: totals.formatted.paidTendered,
    changeGiven: totals.formatted.changeDue,
    createdAt: now,
    items: invoiceLines,
    payments: body.payments.map((p, idx) => ({
      id: `${invId}-p${idx}`,
      method: p.method,
      amount: Number(p.amount).toFixed(2),
      referenceNo: p.referenceNo ?? null,
      paidAt: now,
    })),
    salesReturns: [],
  };

  state.invoices.unshift(receipt);
  return receipt;
}

function buildShiftZReport(shift: MockTenantState["shifts"][number]): ShiftZReportResponse {
  const shiftInvoices = state.invoices.filter(
    (inv) => inv.shiftId === shift.id && inv.status !== "VOIDED",
  );
  const sumMethod = (m: string) =>
    shiftInvoices
      .flatMap((inv) => inv.payments)
      .filter((p) => p.method === m)
      .reduce((acc, p) => acc + Number(p.amount), 0)
      .toFixed(2);
  const net = shiftInvoices.reduce((acc, i) => acc + Number(i.totalAmount), 0);
  const disc = shiftInvoices.reduce((acc, i) => acc + Number(i.discountAmount), 0);
  const tax = shiftInvoices.reduce((acc, i) => acc + Number(i.taxAmount), 0);
  const cogs = net * 0.44;
  return {
    shift,
    summary: {
      invoiceCount: shiftInvoices.length,
      grossSales: (net + disc).toFixed(2),
      discountTotal: disc.toFixed(2),
      taxTotal: tax.toFixed(2),
      netSales: net.toFixed(2),
      cogsTotal: cogs.toFixed(2),
      grossProfit: (net - cogs).toFixed(2),
      paymentTotals: {
        CASH: sumMethod("CASH"),
        BANK_TRANSFER_QR: sumMethod("BANK_TRANSFER_QR"),
        CARD: sumMethod("CARD"),
        LOYALTY_POINTS: sumMethod("LOYALTY_POINTS"),
        STORE_CREDIT: sumMethod("STORE_CREDIT"),
      },
    },
  };
}

export async function mockApiRequest<T>(
  rawPath: string,
  init?: RequestInit,
): Promise<T> {
  // Slight artificial delay for realistic loading states on interactive UI testing.
  await new Promise((r) => setTimeout(r, 60));

  const normalized = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const [pathname, searchStr = ""] = normalized.split("?");
  const path = pathname!;
  const sp = new URLSearchParams(searchStr);
  const method = (init?.method ?? "GET").toUpperCase();

  // Health & Auth
  if (path === "/health/live" || path === "/health/ready") {
    return {
      status: "ok",
      service: "smart-pos-mock-mode",
      timestamp: new Date().toISOString(),
    } as T;
  }

  if (path === "/auth/me" && method === "GET") {
    if (state.loggedOut) {
      throw new MockHttpError("Chưa đăng nhập", 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }
    const s = buildAuthSession();
    return {
      redirectTo: s.redirectTo,
      user: s.user,
      tenant: s.tenant,
      member: s.member,
      branches: s.branches,
    } as T;
  }

  if (path === "/auth/login" && method === "POST") {
    const body = parseBody<OwnerLoginInput>(init);
    const matched = state.staff.find(
      (m) => m.email?.toLowerCase() === body.email.toLowerCase(),
    );
    if (matched) setMockRole(matched.role);
    state.loggedOut = false;
    return buildAuthSession() as T;
  }

  if (path === "/auth/cashier-pin" && method === "POST") {
    const body = parseBody<CashierPinLoginInput>(init);
    const matched = state.staff.find(
      (m) => m.employeeCode === body.employeeCode.toUpperCase(),
    );
    if (matched) setMockRole(matched.role);
    else setMockRole("CASHIER");
    state.loggedOut = false;
    return buildAuthSession() as T;
  }

  if (path === "/auth/register-tenant" && method === "POST") {
    const body = parseBody<RegisterTenantInput>(init);
    state.tenant.name = body.shopName;
    state.tenant.slug = body.tenantSlug;
    state.tenant.businessType = body.businessType;
    state.staff[0]!.fullName = body.ownerName;
    state.staff[0]!.email = body.email;
    state.branches[0]!.name = body.branchName;
    setMockRole("OWNER");
    state.loggedOut = false;
    return buildAuthSession() as T;
  }

  if (path === "/auth/logout" && method === "POST") {
    state.loggedOut = true;
    return { success: true } as T;
  }

  // Branches
  if (path === "/branches" && method === "GET") {
    return {
      items: state.branches,
      quota: {
        activeCount: state.branches.filter((b) => b.isActive).length,
        maxBranches: currentPlan().maxBranches,
      },
    } as T;
  }

  if (path === "/branches" && method === "POST") {
    const plan = currentPlan();
    const activeCount = state.branches.filter((b) => b.isActive).length;
    if (activeCount >= plan.maxBranches) {
      throw new MockHttpError(
        `Gói hiện tại (${plan.name}) tối đa ${plan.maxBranches} chi nhánh`,
        409,
        ERROR_CODES.PLAN_QUOTA_EXCEEDED,
      );
    }
    const body = parseBody<CreateBranchInput>(init);
    const now = new Date().toISOString();
    const created = {
      id: nextUuid(),
      code: body.code.toUpperCase(),
      name: body.name,
      address: body.address ?? null,
      phone: body.phone ?? null,
      isDefault: Boolean(body.isDefault),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    state.branches.push(created);
    return created as T;
  }

  if (path.startsWith("/branches/") && method === "PATCH") {
    const id = path.slice("/branches/".length);
    const branch = state.branches.find((b) => b.id === id);
    if (!branch) throw new MockHttpError("Không tìm thấy chi nhánh", 404);
    const body = parseBody<UpdateBranchInput>(init);
    Object.assign(branch, body, { updatedAt: new Date().toISOString() });
    return branch as T;
  }

  // Staff
  if (path === "/staff" && method === "GET") {
    return {
      items: state.staff,
      quota: {
        activeCount: state.staff.filter((s) => s.isActive).length,
        maxUsers: currentPlan().maxUsers,
      },
    } as T;
  }

  if (path === "/staff" && method === "POST") {
    const body = parseBody<CreateStaffMemberInput>(init);
    const now = new Date().toISOString();
    const created = {
      id: nextUuid(),
      userId: nextUuid(),
      employeeCode: body.employeeCode.toUpperCase(),
      fullName: body.fullName,
      email: body.email ?? null,
      phone: body.phone ?? null,
      role: body.role,
      hasPin: Boolean(body.pin),
      allowedBranchIds: body.allowedBranchIds ?? [],
      permissions: body.permissions ?? {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    state.staff.push(created);
    return created as T;
  }

  if (path.startsWith("/staff/") && method === "PATCH") {
    const id = path.slice("/staff/".length);
    const staff = state.staff.find((s) => s.id === id);
    if (!staff) throw new MockHttpError("Không tìm thấy nhân viên", 404);
    const body = parseBody<UpdateStaffMemberInput>(init);
    Object.assign(staff, body, {
      ...(body.pin ? { hasPin: true } : {}),
      updatedAt: new Date().toISOString(),
    });
    return staff as T;
  }

  // Categories
  if (path === "/categories" && method === "GET") {
    return state.categories as T;
  }

  if (path === "/categories" && method === "POST") {
    const body = parseBody<CreateCategoryInput>(init);
    const now = new Date().toISOString();
    const cat = {
      id: nextUuid(),
      parentId: body.parentId ?? null,
      name: body.name,
      sortOrder: body.sortOrder ?? 0,
      productCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    state.categories.push(cat);
    return cat as T;
  }

  if (path.startsWith("/categories/") && method === "PATCH") {
    const id = path.slice("/categories/".length);
    const cat = state.categories.find((c) => c.id === id);
    if (!cat) throw new MockHttpError("Không tìm thấy nhóm hàng", 404);
    Object.assign(cat, parseBody<UpdateCategoryInput>(init), {
      updatedAt: new Date().toISOString(),
    });
    return cat as T;
  }

  if (path.startsWith("/categories/") && method === "DELETE") {
    const id = path.slice("/categories/".length);
    state.categories = state.categories.filter((c) => c.id !== id);
    return { success: true } as T;
  }

  // Products
  if (path === "/products" && method === "GET") {
    const branchId = sp.get("branchId") ?? undefined;
    const categoryId = sp.get("categoryId");
    const search = (sp.get("search") ?? "").trim().toLowerCase();
    const lowStockOnly = sp.get("lowStockOnly") === "true";

    let items = enrichProductsWithBranchStock(branchId);
    if (categoryId) items = items.filter((p) => p.categoryId === categoryId);
    if (search) {
      items = items.filter(
        (p) =>
          p.name.toLowerCase().includes(search) ||
          p.variants.some(
            (v) =>
              v.sku.toLowerCase().includes(search) ||
              (v.barcode?.toLowerCase().includes(search) ?? false),
          ),
      );
    }
    if (lowStockOnly) {
      items = items.filter((p) =>
        p.variants.some((v) => v.branchStock?.isLowStock),
      );
    }

    const totalSkus = state.products.reduce((acc, p) => acc + p.variants.length, 0);
    return {
      ...paginate(items, sp),
      quota: { activeSkus: totalSkus, maxSkus: currentPlan().maxSkus },
    } as T;
  }

  if (path === "/products" && method === "POST") {
    const body = parseBody<CreateProductInput>(init);
    const now = new Date().toISOString();
    const productId = nextUuid();
    const cat = state.categories.find((c) => c.id === body.categoryId);
    const created = {
      id: productId,
      categoryId: body.categoryId ?? null,
      categoryName: cat?.name ?? null,
      name: body.name,
      description: body.description ?? null,
      brand: body.brand ?? null,
      hasVariants: body.hasVariants ?? body.variants.length > 1,
      imageUrl: body.imageUrl ?? null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      variants: body.variants.map((v) => ({
        id: nextUuid(),
        productId,
        sku: v.sku.toUpperCase(),
        barcode: v.barcode ?? null,
        name: v.name,
        unit: v.unit ?? "Cái",
        costPrice: Number(v.costPrice).toFixed(2),
        salePrice: Number(v.salePrice).toFixed(2),
        taxRate: Number(v.taxRate ?? "0").toFixed(2),
        minStockAlert: v.minStockAlert ?? 0,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })),
    };
    state.products.unshift(created);
    return created as T;
  }

  if (path === "/products/upload-url" && method === "POST") {
    const body = parseBody<PresignProductImageInput>(init);
    return {
      uploadUrl: `https://mock-r2.local/upload/${encodeURIComponent(body.fileName)}`,
      publicUrl: `https://placehold.co/400x400/png?text=${encodeURIComponent(body.fileName.slice(0, 12))}`,
      key: `mock/${body.fileName}`,
      expiresInSeconds: 300,
    } as T;
  }

  if (path === "/products/import" && method === "POST") {
    return {
      createdProducts: 1,
      createdVariants: 1,
      skippedRows: 0,
      errors: [],
    } as T;
  }

  const varPatchMatch = /^\/products\/([^/]+)\/variants\/([^/]+)$/.exec(path);
  if (varPatchMatch && method === "PATCH") {
    const [, pId, vId] = varPatchMatch;
    const prod = state.products.find((p) => p.id === pId);
    const variant = prod?.variants.find((v) => v.id === vId);
    if (!variant) throw new MockHttpError("Không tìm thấy biến thể", 404);
    Object.assign(variant, parseBody<UpdateVariantInput>(init), {
      updatedAt: new Date().toISOString(),
    });
    return variant as T;
  }

  const varAddMatch = /^\/products\/([^/]+)\/variants$/.exec(path);
  if (varAddMatch && method === "POST") {
    const prod = state.products.find((p) => p.id === varAddMatch[1]);
    if (!prod) throw new MockHttpError("Không tìm thấy sản phẩm", 404);
    const body = parseBody<ProductVariantInput>(init);
    const now = new Date().toISOString();
    const v = {
      id: nextUuid(),
      productId: prod.id,
      sku: body.sku.toUpperCase(),
      barcode: body.barcode ?? null,
      name: body.name,
      unit: body.unit ?? "Cái",
      costPrice: Number(body.costPrice).toFixed(2),
      salePrice: Number(body.salePrice).toFixed(2),
      taxRate: Number(body.taxRate ?? "0").toFixed(2),
      minStockAlert: body.minStockAlert ?? 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    prod.variants.push(v);
    return v as T;
  }

  if (path.startsWith("/products/") && method === "PATCH") {
    const id = path.slice("/products/".length);
    const prod = state.products.find((p) => p.id === id);
    if (!prod) throw new MockHttpError("Không tìm thấy sản phẩm", 404);
    Object.assign(prod, parseBody<UpdateProductInput>(init), {
      updatedAt: new Date().toISOString(),
    });
    return prod as T;
  }

  // Inventory & Ledgers
  if (path === "/inventory" && method === "GET") {
    const branchId = sp.get("branchId");
    const search = (sp.get("search") ?? "").trim().toLowerCase();
    const lowStockOnly = sp.get("lowStockOnly") === "true";
    let items = state.inventory;
    if (branchId) items = items.filter((r) => r.branchId === branchId);
    if (search) {
      items = items.filter(
        (r) =>
          r.sku.toLowerCase().includes(search) ||
          r.productName.toLowerCase().includes(search) ||
          (r.barcode?.toLowerCase().includes(search) ?? false),
      );
    }
    if (lowStockOnly) items = items.filter((r) => r.isLowStock);
    const totalStockValue = items
      .reduce((acc, r) => acc + Number(r.stockValue), 0)
      .toFixed(2);
    const lowStockCount = items.filter((r) => r.isLowStock).length;
    return {
      ...paginate(items, sp),
      summary: { totalStockValue, lowStockCount },
    } as T;
  }

  if (path === "/inventory/ledgers" && method === "GET") {
    const branchId = sp.get("branchId");
    const movementType = sp.get("movementType");
    const search = (sp.get("search") ?? "").trim().toLowerCase();
    let items = state.ledgers;
    if (branchId) items = items.filter((l) => l.branchId === branchId);
    if (movementType) items = items.filter((l) => l.movementType === movementType);
    if (search) {
      items = items.filter(
        (l) =>
          l.sku.toLowerCase().includes(search) ||
          (l.note?.toLowerCase().includes(search) ?? false),
      );
    }
    return paginate(items, sp) as T;
  }

  // Suppliers
  if (path === "/suppliers" && method === "GET") {
    return state.suppliers as T;
  }

  if (path === "/suppliers" && method === "POST") {
    const body = parseBody<CreateSupplierInput>(init);
    const now = new Date().toISOString();
    const sup = {
      id: nextUuid(),
      code: body.code.toUpperCase(),
      name: body.name,
      phone: body.phone ?? null,
      email: body.email ?? null,
      address: body.address ?? null,
      debtBalance: "0.00",
      createdAt: now,
      updatedAt: now,
    };
    state.suppliers.unshift(sup);
    return sup as T;
  }

  if (path.startsWith("/suppliers/") && method === "PATCH") {
    const id = path.slice("/suppliers/".length);
    const sup = state.suppliers.find((s) => s.id === id);
    if (!sup) throw new MockHttpError("Không tìm thấy nhà cung cấp", 404);
    Object.assign(sup, parseBody<UpdateSupplierInput>(init), {
      updatedAt: new Date().toISOString(),
    });
    return sup as T;
  }

  // Purchase Orders
  if (path === "/purchase-orders" && method === "GET") {
    const branchId = sp.get("branchId");
    const status = sp.get("status");
    let items = state.purchaseOrders;
    if (branchId) items = items.filter((po) => po.branchId === branchId);
    if (status) items = items.filter((po) => po.status === status);
    return paginate(items, sp) as T;
  }

  if (path === "/purchase-orders" && method === "POST") {
    const body = parseBody<CreatePurchaseOrderInput>(init);
    const branch = state.branches.find((b) => b.id === body.branchId);
    if (!branch) throw new MockHttpError("Không tìm thấy chi nhánh", 404);
    const sup = body.supplierId
      ? state.suppliers.find((s) => s.id === body.supplierId)
      : undefined;
    const now = new Date().toISOString();
    const poId = nextUuid();
    const poCode = body.code?.trim() || `PO-${now.slice(2, 10).replaceAll("-", "")}-${seqCounter}`;
    let total = 0;

    const lines = body.items.map((item) => {
      let sku = "SKU";
      let varName = "Mặc định";
      let unit = "Cái";
      for (const p of state.products) {
        const v = p.variants.find((vr) => vr.id === item.variantId);
        if (v) {
          sku = v.sku;
          varName = v.name;
          unit = v.unit;
          break;
        }
      }
      const lineTotalNum =
        Number(item.orderedQty) * Number(item.unitCost) -
        Number(item.discount ?? "0");
      total += Math.max(0, lineTotalNum);
      return {
        id: nextUuid(),
        variantId: item.variantId,
        sku,
        variantName: varName,
        unit,
        orderedQty: Number(item.orderedQty).toFixed(3),
        receivedQty: body.completeImmediately
          ? Number(item.orderedQty).toFixed(3)
          : "0.000",
        unitCost: Number(item.unitCost).toFixed(2),
        discount: Number(item.discount ?? "0").toFixed(2),
        lineTotal: Math.max(0, lineTotalNum).toFixed(2),
      };
    });

    const po = {
      id: poId,
      code: poCode,
      branchId: branch.id,
      branchCode: branch.code,
      branchName: branch.name,
      supplierId: sup?.id ?? null,
      supplierName: sup?.name ?? null,
      status: body.completeImmediately ? ("COMPLETED" as const) : ("DRAFT" as const),
      totalAmount: total.toFixed(2),
      paidAmount: Number(body.paidAmount ?? "0").toFixed(2),
      createdByName: currentMember().fullName,
      completedAt: body.completeImmediately ? now : null,
      createdAt: now,
      items: lines,
    };

    if (body.completeImmediately) {
      for (const l of po.items) {
        adjustBranchStock({
          branchId: po.branchId,
          variantId: l.variantId,
          qtyDelta: Number(l.orderedQty),
          unitCost: Number(l.unitCost),
          movementType: "PURCHASE_IN",
          referenceType: "purchase_order",
          referenceId: po.id,
          note: `Nhập hàng ${po.code}`,
        });
      }
    }

    state.purchaseOrders.unshift(po);
    return po as T;
  }

  const poActionMatch = /^\/purchase-orders\/([^/]+)\/(complete|cancel)$/.exec(path);
  if (poActionMatch && method === "POST") {
    const [, poId, action] = poActionMatch;
    const po = state.purchaseOrders.find((p) => p.id === poId);
    if (!po) throw new MockHttpError("Không tìm thấy phiếu nhập", 404);
    if (action === "cancel") {
      po.status = "CANCELLED";
      return po as T;
    }
    const body = parseBody<CompletePurchaseOrderInput>(init);
    po.status = "COMPLETED";
    po.completedAt = new Date().toISOString();
    if (body.paidAmount !== undefined) po.paidAmount = Number(body.paidAmount).toFixed(2);
    for (const l of po.items) {
      l.receivedQty = l.orderedQty;
      adjustBranchStock({
        branchId: po.branchId,
        variantId: l.variantId,
        qtyDelta: Number(l.orderedQty),
        unitCost: Number(l.unitCost),
        movementType: "PURCHASE_IN",
        referenceType: "purchase_order",
        referenceId: po.id,
        note: `Nhập hàng ${po.code}`,
      });
    }
    return po as T;
  }

  // Stock Counts
  if (path === "/stock-counts" && method === "GET") {
    const branchId = sp.get("branchId");
    const status = sp.get("status");
    let items = state.stockCounts;
    if (branchId) items = items.filter((sc) => sc.branchId === branchId);
    if (status) items = items.filter((sc) => sc.status === status);
    return paginate(items, sp) as T;
  }

  if (path === "/stock-counts" && method === "POST") {
    const body = parseBody<CreateStockCountInput>(init);
    const branch = state.branches.find((b) => b.id === body.branchId);
    if (!branch) throw new MockHttpError("Không tìm thấy chi nhánh", 404);
    const now = new Date().toISOString();
    const scId = nextUuid();
    const code = `KK-${now.slice(2, 10).replaceAll("-", "")}-${seqCounter}`;
    const items = body.items.map((item) => {
      const inv = state.inventory.find(
        (r) => r.branchId === body.branchId && r.variantId === item.variantId,
      );
      const sysQty = inv ? Number(inv.onHand) : 0;
      const actQty = Number(item.actualQty);
      return {
        id: nextUuid(),
        variantId: item.variantId,
        sku: inv?.sku ?? "SKU",
        variantName: inv?.variantName ?? "Mặc định",
        unit: inv?.unit ?? "Cái",
        systemQty: sysQty.toFixed(3),
        actualQty: actQty.toFixed(3),
        varianceQty: (actQty - sysQty).toFixed(3),
        reason: item.reason ?? null,
      };
    });
    const sc: StockCountItemResponse = {
      id: scId,
      code,
      branchId: branch.id,
      branchCode: branch.code,
      branchName: branch.name,
      status: body.balanceImmediately ? "BALANCED" : "DRAFT",
      createdByName: currentMember().fullName,
      balancedByName: body.balanceImmediately ? currentMember().fullName : null,
      balancedAt: body.balanceImmediately ? now : null,
      createdAt: now,
      items,
    };
    if (body.balanceImmediately) {
      for (const l of items) {
        const diff = Number(l.varianceQty);
        if (diff !== 0) {
          adjustBranchStock({
            branchId: branch.id,
            variantId: l.variantId,
            qtyDelta: diff,
            movementType: "STOCK_COUNT",
            referenceType: "stock_count",
            referenceId: sc.id,
            note: l.reason ?? `Cân bằng kiểm kho ${sc.code}`,
          });
        }
      }
    }
    state.stockCounts.unshift(sc);
    return sc as T;
  }

  const scActionMatch = /^\/stock-counts\/([^/]+)\/(balance|cancel)$/.exec(path);
  if (scActionMatch && method === "POST") {
    const [, scId, action] = scActionMatch;
    const sc = state.stockCounts.find((s) => s.id === scId);
    if (!sc) throw new MockHttpError("Không tìm thấy phiếu kiểm kho", 404);
    if (action === "cancel") {
      sc.status = "CANCELLED";
      return sc as T;
    }
    parseBody<BalanceStockCountInput>(init);
    sc.status = "BALANCED";
    sc.balancedByName = currentMember().fullName;
    sc.balancedAt = new Date().toISOString();
    for (const l of sc.items) {
      const diff = Number(l.varianceQty);
      if (diff !== 0) {
        adjustBranchStock({
          branchId: sc.branchId,
          variantId: l.variantId,
          qtyDelta: diff,
          movementType: "STOCK_COUNT",
          referenceType: "stock_count",
          referenceId: sc.id,
          note: l.reason ?? `Cân bằng kiểm kho ${sc.code}`,
        });
      }
    }
    return sc as T;
  }

  // Stock Transfers
  if (path === "/stock-transfers" && method === "GET") {
    const status = sp.get("status");
    const branchId = sp.get("branchId");
    let items = state.stockTransfers;
    if (status) items = items.filter((t) => t.status === status);
    if (branchId) {
      items = items.filter(
        (t) => t.fromBranchId === branchId || t.toBranchId === branchId,
      );
    }
    return paginate(items, sp) as T;
  }

  if (path === "/stock-transfers" && method === "POST") {
    const body = parseBody<CreateStockTransferInput>(init);
    const fromB = state.branches.find((b) => b.id === body.fromBranchId);
    const toB = state.branches.find((b) => b.id === body.toBranchId);
    if (!fromB || !toB) throw new MockHttpError("Không tìm thấy chi nhánh", 404);
    const now = new Date().toISOString();
    const trId = nextUuid();
    const code = `TR-${now.slice(2, 10).replaceAll("-", "")}-${seqCounter}`;
    const lines = body.items.map((item) => {
      const inv = state.inventory.find(
        (r) => r.branchId === fromB.id && r.variantId === item.variantId,
      );
      adjustBranchStock({
        branchId: fromB.id,
        variantId: item.variantId,
        qtyDelta: -Number(item.quantity),
        movementType: "TRANSFER_OUT",
        referenceType: "stock_transfer",
        referenceId: trId,
        note: `Xuất chuyển sang ${toB.code}`,
      });
      return {
        id: nextUuid(),
        variantId: item.variantId,
        sku: inv?.sku ?? "SKU",
        productName: inv?.productName ?? "Sản phẩm",
        variantName: inv?.variantName ?? "Mặc định",
        unit: inv?.unit ?? "Cái",
        quantity: Number(item.quantity).toFixed(3),
        unitCost: inv?.avgCost ?? "0.00",
      };
    });
    const created: StockTransferItemView = {
      id: trId,
      code,
      status: "IN_TRANSIT",
      fromBranchId: fromB.id,
      fromBranchName: fromB.name,
      toBranchId: toB.id,
      toBranchName: toB.name,
      createdByName: currentMember().fullName,
      receivedByName: null,
      note: body.note ?? null,
      dispatchedAt: now,
      receivedAt: null,
      items: lines,
    };
    state.stockTransfers.unshift(created);
    return created as T;
  }

  const trMatch = /^\/stock-transfers\/([^/]+)\/(receive|cancel)$/.exec(path);
  if (trMatch && method === "POST") {
    const [, trId, action] = trMatch;
    const tr = state.stockTransfers.find((t) => t.id === trId);
    if (!tr) throw new MockHttpError("Không tìm thấy phiếu chuyển kho", 404);
    if (action === "cancel") {
      tr.status = "CANCELLED";
      for (const l of tr.items) {
        adjustBranchStock({
          branchId: tr.fromBranchId,
          variantId: l.variantId,
          qtyDelta: Number(l.quantity),
          unitCost: Number(l.unitCost),
          movementType: "TRANSFER_IN",
          referenceType: "stock_transfer",
          referenceId: tr.id,
          note: `Hủy phiếu chuyển ${tr.code}`,
        });
      }
      return tr as T;
    }
    tr.status = "RECEIVED";
    tr.receivedByName = currentMember().fullName;
    tr.receivedAt = new Date().toISOString();
    for (const l of tr.items) {
      adjustBranchStock({
        branchId: tr.toBranchId,
        variantId: l.variantId,
        qtyDelta: Number(l.quantity),
        unitCost: Number(l.unitCost),
        movementType: "TRANSFER_IN",
        referenceType: "stock_transfer",
        referenceId: tr.id,
        note: `Nhận chuyển kho ${tr.code}`,
      });
    }
    return tr as T;
  }

  // POS Catalog Sync, Shifts, Invoices, Returns
  if (path === "/pos/catalog-sync" && method === "GET") {
    const branchId = sp.get("branchId") ?? state.branches[0]!.id;
    const items = state.products.flatMap((prod) =>
      prod.variants.map((v) => {
        const inv = state.inventory.find(
          (r) => r.branchId === branchId && r.variantId === v.id,
        );
        return {
          variantId: v.id,
          productId: prod.id,
          categoryId: prod.categoryId,
          categoryName: prod.categoryName,
          productName: prod.name,
          variantName: v.name,
          sku: v.sku,
          barcode: v.barcode,
          unit: v.unit,
          salePrice: v.salePrice,
          taxRate: v.taxRate,
          minStockAlert: v.minStockAlert,
          imageUrl: prod.imageUrl,
          isActive: prod.isActive && v.isActive,
          onHand: inv?.onHand ?? "0.000",
          reserved: inv?.reserved ?? "0.000",
          available: inv?.available ?? "0.000",
          updatedAt: inv?.updatedAt ?? prod.updatedAt,
        };
      }),
    );
    return {
      branchId,
      serverTimestamp: new Date().toISOString(),
      fullSync: true,
      categories: state.categories.map((c) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder,
      })),
      items,
    } as T;
  }

  if (path === "/pos/shifts/current" && method === "GET") {
    const branchId = sp.get("branchId");
    const open = state.shifts.find(
      (s) => s.status === "OPEN" && (!branchId || s.branchId === branchId),
    );
    return { shift: open ?? null } as T;
  }

  if (path === "/pos/shifts/open" && method === "POST") {
    const body = parseBody<OpenShiftInput>(init);
    const branch = state.branches.find((b) => b.id === body.branchId);
    if (!branch) throw new MockHttpError("Không tìm thấy chi nhánh", 404);
    const shift = {
      id: nextUuid(),
      branchId: branch.id,
      branchCode: branch.code,
      branchName: branch.name,
      openedByMemberId: currentMember().id,
      openedByName: currentMember().fullName,
      closedByMemberId: null,
      closedByName: null,
      status: "OPEN" as const,
      openingCash: Number(body.openingCash).toFixed(2),
      expectedCash: Number(body.openingCash).toFixed(2),
      actualCash: null,
      cashVariance: null,
      openedAt: new Date().toISOString(),
      closedAt: null,
      note: body.note ?? null,
    };
    state.shifts.unshift(shift);
    return shift as T;
  }

  const shiftZMatch = /^\/pos\/shifts\/([^/]+)\/z-report$/.exec(path);
  if (shiftZMatch && method === "GET") {
    const shift = state.shifts.find((s) => s.id === shiftZMatch[1]);
    if (!shift) throw new MockHttpError("Không tìm thấy ca làm việc", 404);
    return buildShiftZReport(shift) as T;
  }

  const shiftCloseMatch = /^\/pos\/shifts\/([^/]+)\/close$/.exec(path);
  if (shiftCloseMatch && method === "POST") {
    const shift = state.shifts.find((s) => s.id === shiftCloseMatch[1]);
    if (!shift) throw new MockHttpError("Không tìm thấy ca làm việc", 404);
    const body = parseBody<CloseShiftInput>(init);
    shift.status = "CLOSED";
    shift.closedByMemberId = currentMember().id;
    shift.closedByName = currentMember().fullName;
    shift.actualCash = Number(body.actualCash).toFixed(2);
    shift.cashVariance = (
      Number(body.actualCash) - Number(shift.expectedCash)
    ).toFixed(2);
    shift.closedAt = new Date().toISOString();
    return buildShiftZReport(shift) as T;
  }

  if (path === "/pos/invoices" && method === "GET") {
    const branchId = sp.get("branchId");
    const shiftId = sp.get("shiftId");
    let items = state.invoices;
    if (branchId) items = items.filter((i) => i.branchId === branchId);
    if (shiftId) items = items.filter((i) => i.shiftId === shiftId);
    return paginate(items, sp) as T;
  }

  if (path === "/pos/invoices" && method === "POST") {
    return executeMockCheckout(parseBody<CreateInvoiceInput>(init)) as T;
  }

  if (path === "/pos/offline-sync/invoices" && method === "POST") {
    const body = parseBody<OfflineSyncBatchInput>(init);
    const results: OfflineSyncItemOutcome[] = [];
    let synced = 0;
    let conflicts = 0;
    let failed = 0;

    for (const entry of body.invoices) {
      try {
        const receipt = executeMockCheckout(entry.payload);
        synced += 1;
        results.push({
          idempotencyKey: entry.payload.idempotencyKey,
          status: "SYNCED",
          receipt,
        });
      } catch (err) {
        if (err instanceof MockHttpError) {
          conflicts += 1;
          const latestStock: OfflineSyncLatestStockInfo[] =
            err.code === ERROR_CODES.INSUFFICIENT_STOCK
              ? entry.payload.items.map((it) => {
                  const inv = state.inventory.find(
                    (r) =>
                      r.branchId === entry.payload.branchId &&
                      r.variantId === it.variantId,
                  );
                  return {
                    variantId: it.variantId,
                    sku: inv?.sku ?? "SKU",
                    available: inv?.available ?? "0.000",
                  };
                })
              : [];
          results.push({
            idempotencyKey: entry.payload.idempotencyKey,
            status: "CONFLICT",
            errorCode: err.code,
            message: err.message,
            ...(latestStock.length > 0 ? { latestStock } : {}),
          });
        } else {
          failed += 1;
          results.push({
            idempotencyKey: entry.payload.idempotencyKey,
            status: "FAILED",
            message: "Lỗi đồng bộ mock",
          });
        }
      }
    }

    const res: OfflineSyncBatchResponse = {
      summary: {
        total: body.invoices.length,
        synced,
        conflicts,
        failed,
      },
      results,
    };
    return res as T;
  }

  if (path === "/pos/supervisor-approve" && method === "POST") {
    const body = parseBody<SupervisorPinVerifyInput>(init);
    if (body.pin !== "1234" && body.pin !== "0000") {
      throw new MockHttpError(
        "Mã PIN quản lý không đúng (Mock PIN mặc định: 1234)",
        403,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
      );
    }
    const mgr =
      state.staff.find((s) => s.role === "MANAGER") ?? state.staff[0]!;
    return {
      approvalToken: `mock-supervisor-token-${Date.now()}`,
      approverMemberId: mgr.id,
      approverName: mgr.fullName,
      approverEmployeeCode: mgr.employeeCode,
      permission: body.permission,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    } as T;
  }

  if (path === "/pos/cash-drawer/open" && method === "POST") {
    return { ok: true } as T;
  }

  const invDetailMatch = /^\/pos\/invoices\/([^/]+)$/.exec(path);
  if (invDetailMatch && method === "GET") {
    const inv = state.invoices.find((i) => i.id === invDetailMatch[1]);
    if (!inv) throw new MockHttpError("Không tìm thấy hóa đơn", 404);
    return inv as T;
  }

  const invVoidMatch = /^\/pos\/invoices\/([^/]+)\/void$/.exec(path);
  if (invVoidMatch && method === "POST") {
    const inv = state.invoices.find((i) => i.id === invVoidMatch[1]);
    if (!inv) throw new MockHttpError("Không tìm thấy hóa đơn", 404);
    parseBody<VoidInvoiceInput>(init);
    inv.status = "VOIDED";
    for (const line of inv.items) {
      adjustBranchStock({
        branchId: inv.branchId,
        variantId: line.variantId,
        qtyDelta: Number(line.quantity),
        movementType: "SALE_RETURN",
        referenceType: "invoice",
        referenceId: inv.id,
        note: `Hủy hóa đơn ${inv.code}`,
      });
    }
    return inv as T;
  }

  const invReturnMatch = /^\/pos\/invoices\/([^/]+)\/returns$/.exec(path);
  if (invReturnMatch && method === "POST") {
    const inv = state.invoices.find((i) => i.id === invReturnMatch[1]);
    if (!inv) throw new MockHttpError("Không tìm thấy hóa đơn", 404);
    const body = parseBody<CreateSalesReturnInput>(init);
    const now = new Date().toISOString();
    const retId = nextUuid();
    let totalRefund = 0;

    const retLines = body.items.map((reqItem) => {
      const line = inv.items.find((li) => li.id === reqItem.invoiceItemId);
      if (!line) throw new MockHttpError("Không tìm thấy dòng hàng hóa đơn", 404);
      const q = Number(reqItem.quantity);
      const lineUnit = Number(line.lineTotal) / Math.max(1, Number(line.quantity));
      const refund = q * lineUnit;
      totalRefund += refund;
      line.returnedQty = (Number(line.returnedQty ?? "0") + q).toFixed(3);
      adjustBranchStock({
        branchId: inv.branchId,
        variantId: line.variantId,
        qtyDelta: q,
        movementType: "SALE_RETURN",
        referenceType: "sales_return",
        referenceId: retId,
        note: `Trả hàng từ ${inv.code}`,
      });
      return {
        id: nextUuid(),
        invoiceItemId: line.id,
        variantId: line.variantId,
        sku: line.sku,
        productName: line.productName,
        quantity: q.toFixed(3),
        refundAmount: refund.toFixed(2),
      };
    });

    const allReturned = inv.items.every(
      (l) => Number(l.returnedQty ?? "0") >= Number(l.quantity),
    );
    inv.status = allReturned ? "RETURNED" : "PARTIAL_RETURNED";
    const ret: SalesReturnResponse = {
      id: retId,
      code: `TH-${now.slice(2, 10).replaceAll("-", "")}-${seqCounter}`,
      branchId: inv.branchId,
      branchName: inv.branchName,
      invoiceId: inv.id,
      invoiceCode: inv.code,
      invoiceStatus: inv.status,
      shiftId: inv.shiftId,
      processedByName: currentMember().fullName,
      status: "COMPLETED",
      totalRefundAmount: totalRefund.toFixed(2),
      refundMethod: body.refundMethod,
      reason: body.reason ?? null,
      createdAt: now,
      items: retLines,
    };
    inv.salesReturns.unshift(ret);
    state.salesReturns.unshift(ret);
    return ret as T;
  }

  if (path === "/pos/returns" && method === "GET") {
    return paginate(state.salesReturns, sp) as T;
  }

  // Customers
  if (path === "/customers" && method === "GET") {
    const search = (sp.get("search") ?? "").trim().toLowerCase();
    let items = state.customers;
    if (search) {
      items = items.filter(
        (c) =>
          c.name.toLowerCase().includes(search) ||
          c.code.toLowerCase().includes(search) ||
          (c.phone?.includes(search) ?? false),
      );
    }
    return paginate(items, sp) as T;
  }

  if (path === "/customers" && method === "POST") {
    const body = parseBody<CreateCustomerInput>(init);
    const now = new Date().toISOString();
    const cust = {
      id: nextUuid(),
      code: body.code?.trim() || `KH-${seqCounter}`,
      name: body.name,
      phone: body.phone ?? null,
      email: body.email ?? null,
      loyaltyPoints: 0,
      totalSpent: "0.00",
      debtBalance: "0.00",
      createdAt: now,
      updatedAt: now,
      recentInvoices: [],
    };
    state.customers.unshift(cust);
    return cust as T;
  }

  const custLoyaltyMatch = /^\/customers\/([^/]+)\/loyalty-adjust$/.exec(path);
  if (custLoyaltyMatch && method === "POST") {
    const cust = state.customers.find((c) => c.id === custLoyaltyMatch[1]);
    if (!cust) throw new MockHttpError("Không tìm thấy khách hàng", 404);
    const body = parseBody<AdjustCustomerLoyaltyInput>(init);
    cust.loyaltyPoints = Math.max(0, cust.loyaltyPoints + body.pointsDelta);
    cust.updatedAt = new Date().toISOString();
    return cust as T;
  }

  if (path.startsWith("/customers/") && method === "GET") {
    const id = path.slice("/customers/".length);
    const cust = state.customers.find((c) => c.id === id);
    if (!cust) throw new MockHttpError("Không tìm thấy khách hàng", 404);
    return cust as T;
  }

  if (path.startsWith("/customers/") && method === "PATCH") {
    const id = path.slice("/customers/".length);
    const cust = state.customers.find((c) => c.id === id);
    if (!cust) throw new MockHttpError("Không tìm thấy khách hàng", 404);
    Object.assign(cust, parseBody<UpdateCustomerInput>(init), {
      updatedAt: new Date().toISOString(),
    });
    return cust as T;
  }

  // Reports & Audit Logs
  if (path === "/reports/overview" && method === "GET") {
    const branchId = sp.get("branchId") ?? undefined;
    return buildMockReportOverview(state, branchId) as T;
  }

  if (path === "/reports/exports" && method === "GET") {
    return paginate(state.reportExports, sp) as T;
  }

  if (path === "/reports/exports" && method === "POST") {
    const body = parseBody<CreateReportExportInput>(init);
    const now = new Date().toISOString();
    const job = {
      id: nextUuid(),
      reportType: body.reportType,
      status: "COMPLETED" as const,
      fileName: `smartpos-${body.reportType.toLowerCase().replaceAll("_", "-")}-${now.slice(0, 10)}.xlsx`,
      rowCount: 25,
      errorMessage: null,
      requestedByName: currentMember().fullName,
      createdAt: now,
      completedAt: now,
    };
    state.reportExports.unshift(job);
    return job as T;
  }

  if (path === "/audit-logs" && method === "GET") {
    const branchId = sp.get("branchId");
    const action = sp.get("action");
    let items = state.auditLogs;
    if (branchId) items = items.filter((l) => l.branchId === branchId);
    if (action) items = items.filter((l) => l.action === action);
    return paginate(items, sp) as T;
  }

  // SaaS Billing
  if (path === "/billing/subscription" && method === "GET") {
    const trialMs = state.tenant.trialEndsAt
      ? new Date(state.tenant.trialEndsAt).getTime()
      : null;
    const daysRemaining =
      trialMs !== null
        ? Math.max(0, Math.ceil((trialMs - Date.now()) / (24 * 60 * 60 * 1000)))
        : null;
    return {
      tenant: {
        id: state.tenant.id,
        name: state.tenant.name,
        slug: state.tenant.slug,
        status: state.tenant.status,
        trialEndsAt: state.tenant.trialEndsAt,
        daysRemaining,
        isTrialExpired: false,
      },
      currentPlan: currentPlan(),
      usage: {
        activeBranches: state.branches.filter((b) => b.isActive).length,
        activeUsers: state.staff.filter((s) => s.isActive).length,
        activeSkus: state.products.reduce((acc, p) => acc + p.variants.length, 0),
      },
      availablePlans: state.plans,
      billingHistory: state.billingHistory,
    } as T;
  }

  if (path === "/billing/subscribe" && method === "POST") {
    const body = parseBody<SubscribePlanInput>(init);
    const targetPlan = state.plans.find((p) => p.code === body.planCode);
    if (!targetPlan) throw new MockHttpError("Không tìm thấy gói SaaS", 404);

    const activeBranches = state.branches.filter((b) => b.isActive).length;
    const activeUsers = state.staff.filter((s) => s.isActive).length;
    const activeSkus = state.products.reduce((acc, p) => acc + p.variants.length, 0);
    if (
      activeBranches > targetPlan.maxBranches ||
      activeUsers > targetPlan.maxUsers ||
      activeSkus > targetPlan.maxSkus
    ) {
      throw new MockHttpError(
        `Không thể chuyển sang ${targetPlan.name} vì dữ liệu hiện tại vượt hạn mức (${activeBranches}/${targetPlan.maxBranches} chi nhánh, ${activeUsers}/${targetPlan.maxUsers} nhân viên).`,
        409,
        ERROR_CODES.PLAN_QUOTA_EXCEEDED,
      );
    }

    const now = new Date();
    const days = targetPlan.code === "FREE_TRIAL" ? 30 : body.billingMonths * 30;
    const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const amount = (Number(targetPlan.priceMonthly) * body.billingMonths).toFixed(2);
    const created = {
      id: nextUuid(),
      planCode: targetPlan.code,
      billingMonths: body.billingMonths,
      amount: targetPlan.code === "FREE_TRIAL" ? "0.00" : amount,
      status: "PAID" as const,
      provider: body.provider,
      referenceNo: `MOCK-BILL-${seqCounter}`,
      periodStart: now.toISOString(),
      periodEnd: end.toISOString(),
      paidAt: now.toISOString(),
      createdAt: now.toISOString(),
    };
    state.tenant.planCode = targetPlan.code;
    state.tenant.trialEndsAt =
      targetPlan.code === "FREE_TRIAL" ? end.toISOString() : null;
    state.billingHistory.unshift(created);
    return created as T;
  }

  // Integrations (API Keys & Webhooks)
  if (path === "/integrations/api-keys" && method === "GET") {
    return state.apiKeys as T;
  }

  if (path === "/integrations/api-keys" && method === "POST") {
    const body = parseBody<CreateApiKeyInput>(init);
    const tenantHex = state.tenant.id.replaceAll("-", "");
    const secretHex = `${seqCounter}${Date.now().toString(16)}`.padEnd(40, "a").slice(0, 40);
    const plainTextKey = `spos_live_${tenantHex}_${secretHex}`;
    const apiKey = {
      id: nextUuid(),
      name: body.name,
      keyPrefix: plainTextKey.slice(0, 22),
      scopes: body.scopes,
      isActive: true,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    state.apiKeys.unshift(apiKey);
    const res: CreateApiKeyResponse = { apiKey, plainTextKey };
    return res as T;
  }

  if (path.startsWith("/integrations/api-keys/") && method === "DELETE") {
    const id = path.slice("/integrations/api-keys/".length);
    const key = state.apiKeys.find((k) => k.id === id);
    if (!key) throw new MockHttpError("Không tìm thấy API Key", 404);
    key.isActive = false;
    key.revokedAt = new Date().toISOString();
    return key as T;
  }

  if (path === "/integrations/webhooks" && method === "GET") {
    return state.webhooks as T;
  }

  if (path === "/integrations/webhooks" && method === "POST") {
    const body = parseBody<CreateWebhookInput>(init);
    const now = new Date().toISOString();
    const hook = {
      id: nextUuid(),
      name: body.name,
      targetUrl: body.targetUrl,
      signingSecret: `whsec_mock_${seqCounter}abcdef`,
      events: body.events,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    state.webhooks.unshift(hook);
    return hook as T;
  }

  const whTestMatch = /^\/integrations\/webhooks\/([^/]+)\/test$/.exec(path);
  if (whTestMatch && method === "POST") {
    const hook = state.webhooks.find((w) => w.id === whTestMatch[1]);
    if (!hook) throw new MockHttpError("Không tìm thấy Webhook", 404);
    const now = new Date().toISOString();
    state.webhookDeliveries.unshift({
      id: nextUuid(),
      endpointId: hook.id,
      endpointName: hook.name,
      eventType: "STOCK_UPDATED",
      status: "DELIVERED",
      httpStatus: 200,
      responseSnippet: '{"mock":true}',
      attemptCount: 1,
      deliveredAt: now,
      createdAt: now,
    });
    return { enqueued: true } as T;
  }

  if (path === "/integrations/webhooks/deliveries" && method === "GET") {
    return state.webhookDeliveries as T;
  }

  if (path.startsWith("/integrations/webhooks/") && method === "PATCH") {
    const id = path.slice("/integrations/webhooks/".length);
    const hook = state.webhooks.find((w) => w.id === id);
    if (!hook) throw new MockHttpError("Không tìm thấy Webhook", 404);
    Object.assign(hook, parseBody<UpdateWebhookInput>(init), {
      updatedAt: new Date().toISOString(),
    });
    return hook as T;
  }

  if (path.startsWith("/integrations/webhooks/") && method === "DELETE") {
    const id = path.slice("/integrations/webhooks/".length);
    state.webhooks = state.webhooks.filter((w) => w.id !== id);
    return { ok: true } as T;
  }

  throw new MockHttpError(
    `Mock endpoint chưa được định nghĩa: ${method} ${path}`,
    404,
    ERROR_CODES.RESOURCE_NOT_FOUND,
  );
}

export function buildMockDownloadBlob(rawPath: string): Blob {
  const [pathname] = rawPath.split("?");
  if (pathname === "/products/import-template" || pathname === "/products/export") {
    const header = "sku,barcode,productName,variantName,categoryName,unit,costPrice,salePrice,taxRate,minStockAlert\n";
    const rows = state.products
      .flatMap((p) =>
        p.variants.map(
          (v) =>
            `${v.sku},${v.barcode ?? ""},${p.name},${v.name},${p.categoryName ?? ""},${v.unit},${v.costPrice},${v.salePrice},${v.taxRate},${v.minStockAlert}`,
        ),
      )
      .join("\n");
    return new Blob([`\uFEFF${header}${rows}`], {
      type: "text/csv;charset=utf-8",
    });
  }

  const lines = [
    `Smart-POS Mock Export (${pathname})`,
    `Cửa hàng: ${state.tenant.name} (@${state.tenant.slug})`,
    `Số hóa đơn: ${state.invoices.length}`,
    ...state.invoices.map(
      (inv) =>
        `${inv.code}\t${inv.createdAt}\t${inv.branchName}\t${inv.totalAmount}\t${inv.status}`,
    ),
  ].join("\n");
  return new Blob([`\uFEFF${lines}`], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function makeAccountingMockFileName(query: AccountingExportQuery): string {
  const stamp = query.to ?? new Date().toISOString().slice(0, 10);
  return `smartpos-accounting-mock-${stamp}.csv`;
}
