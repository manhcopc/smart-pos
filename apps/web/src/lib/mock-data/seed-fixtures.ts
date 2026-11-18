import {
  type ApiKeyItem,
  type AuditLogItem,
  type AuthBranchSummary,
  type BranchInventoryItem,
  type BranchItem,
  type CategoryItem,
  type CustomerDetailResponse,
  type InventoryLedgerItem,
  type InvoiceDetailResponse,
  type ProductItem,
  type PurchaseOrderItemResponse,
  type RegisterShiftItem,
  type ReportExportJobItem,
  type ReportOverviewResponse,
  resolvePermissions,
  type Role,
  type SalesReturnResponse,
  type StaffMemberItem,
  type StockCountItemResponse,
  type StockTransferItemView,
  type SubscriptionBillingItem,
  type SubscriptionPlanInfo,
  type SupplierItem,
  type WebhookDeliveryItem,
  type WebhookEndpointItem,
} from "@smart-pos/shared";

export interface MockTenantState {
  tenant: {
    id: string;
    slug: string;
    name: string;
    businessType: string;
    planCode: "FREE_TRIAL" | "LITE" | "PRO";
    status: string;
    trialEndsAt: string | null;
  };
  loggedOut: boolean;
  branches: BranchItem[];
  staff: StaffMemberItem[];
  categories: CategoryItem[];
  products: ProductItem[];
  inventory: BranchInventoryItem[];
  ledgers: InventoryLedgerItem[];
  suppliers: SupplierItem[];
  purchaseOrders: PurchaseOrderItemResponse[];
  stockCounts: StockCountItemResponse[];
  stockTransfers: StockTransferItemView[];
  shifts: RegisterShiftItem[];
  invoices: InvoiceDetailResponse[];
  salesReturns: SalesReturnResponse[];
  customers: CustomerDetailResponse[];
  reportExports: ReportExportJobItem[];
  auditLogs: AuditLogItem[];
  plans: SubscriptionPlanInfo[];
  billingHistory: SubscriptionBillingItem[];
  apiKeys: ApiKeyItem[];
  webhooks: WebhookEndpointItem[];
  webhookDeliveries: WebhookDeliveryItem[];
}

function isoDaysAgo(days: number, hour = 9): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hour, 15, 0, 0);
  return d.toISOString();
}

function isoDaysAhead(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function dateYmdAgo(days: number): string {
  return isoDaysAgo(days).slice(0, 10);
}

export const MOCK_IDS = {
  tenant: "10000000-0000-4000-8000-000000000001",
  branchCn01: "20000000-0000-4000-8000-000000000001",
  branchCn02: "20000000-0000-4000-8000-000000000002",
  ownerMember: "30000000-0000-4000-8000-000000000001",
  managerMember: "30000000-0000-4000-8000-000000000002",
  cashierMember: "30000000-0000-4000-8000-000000000003",
  warehouseMember: "30000000-0000-4000-8000-000000000004",
  catDrinks: "40000000-0000-4000-8000-000000000001",
  catBakery: "40000000-0000-4000-8000-000000000002",
  catRetail: "40000000-0000-4000-8000-000000000003",
  shiftOpen: "50000000-0000-4000-8000-000000000001",
  supTrungNguyen: "60000000-0000-4000-8000-000000000001",
  supPhucLong: "60000000-0000-4000-8000-000000000002",
  custLan: "70000000-0000-4000-8000-000000000001",
  custHung: "70000000-0000-4000-8000-000000000002",
  custMai: "70000000-0000-4000-8000-000000000003",
} as const;

export function toAuthBranches(branches: BranchItem[]): AuthBranchSummary[] {
  return branches
    .filter((b) => b.isActive)
    .map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      address: b.address,
      phone: b.phone,
      isDefault: b.isDefault,
      isActive: b.isActive,
    }));
}

export function memberForRole(
  state: MockTenantState,
  role: Role,
): StaffMemberItem {
  return (
    state.staff.find((s) => s.role === role && s.isActive) ?? state.staff[0]!
  );
}

export function permissionsForMember(member: StaffMemberItem) {
  return Array.from(resolvePermissions(member.role, member.permissions));
}

export function createInitialMockState(): MockTenantState {
  const now = new Date().toISOString();

  const branches: BranchItem[] = [
    {
      id: MOCK_IDS.branchCn01,
      code: "CN01",
      name: "Chi nhánh Trung tâm (Q1)",
      address: "128 Nguyễn Huệ, Quận 1, TP.HCM",
      phone: "02838221001",
      isDefault: true,
      isActive: true,
      createdAt: isoDaysAgo(30),
      updatedAt: now,
    },
    {
      id: MOCK_IDS.branchCn02,
      code: "CN02",
      name: "Chi nhánh Thảo Điền (Q2)",
      address: "45 Xuân Thủy, TP. Thủ Đức",
      phone: "02838221002",
      isDefault: false,
      isActive: true,
      createdAt: isoDaysAgo(15),
      updatedAt: now,
    },
  ];

  const staff: StaffMemberItem[] = [
    {
      id: MOCK_IDS.ownerMember,
      userId: "31000000-0000-4000-8000-000000000001",
      employeeCode: "OWNER01",
      fullName: "Nguyễn Minh Anh",
      email: "owner@minhanh.vn",
      phone: "0909111001",
      role: "OWNER",
      hasPin: true,
      allowedBranchIds: [],
      permissions: {},
      isActive: true,
      createdAt: isoDaysAgo(30),
      updatedAt: now,
    },
    {
      id: MOCK_IDS.managerMember,
      userId: "31000000-0000-4000-8000-000000000002",
      employeeCode: "MGR01",
      fullName: "Trần Bảo Châu",
      email: "manager@minhanh.vn",
      phone: "0909111002",
      role: "MANAGER",
      hasPin: true,
      allowedBranchIds: [],
      permissions: {},
      isActive: true,
      createdAt: isoDaysAgo(28),
      updatedAt: now,
    },
    {
      id: MOCK_IDS.cashierMember,
      userId: "31000000-0000-4000-8000-000000000003",
      employeeCode: "TN01",
      fullName: "Lê Thu Hà",
      email: null,
      phone: "0909111003",
      role: "CASHIER",
      hasPin: true,
      allowedBranchIds: [MOCK_IDS.branchCn01],
      permissions: {},
      isActive: true,
      createdAt: isoDaysAgo(25),
      updatedAt: now,
    },
    {
      id: MOCK_IDS.warehouseMember,
      userId: "31000000-0000-4000-8000-000000000004",
      employeeCode: "KHO01",
      fullName: "Phạm Quốc Bảo",
      email: "kho@minhanh.vn",
      phone: "0909111004",
      role: "WAREHOUSE",
      hasPin: true,
      allowedBranchIds: [],
      permissions: {},
      isActive: true,
      createdAt: isoDaysAgo(20),
      updatedAt: now,
    },
  ];

  const categories: CategoryItem[] = [
    {
      id: MOCK_IDS.catDrinks,
      parentId: null,
      name: "Đồ uống pha chế",
      sortOrder: 1,
      productCount: 3,
      createdAt: isoDaysAgo(29),
      updatedAt: now,
    },
    {
      id: MOCK_IDS.catBakery,
      parentId: null,
      name: "Bánh & Tráng miệng",
      sortOrder: 2,
      productCount: 2,
      createdAt: isoDaysAgo(29),
      updatedAt: now,
    },
    {
      id: MOCK_IDS.catRetail,
      parentId: null,
      name: "Cà phê & Dụng cụ đóng gói",
      sortOrder: 3,
      productCount: 2,
      createdAt: isoDaysAgo(28),
      updatedAt: now,
    },
  ];

  const products: ProductItem[] = [
    {
      id: "41000000-0000-4000-8000-000000000001",
      categoryId: MOCK_IDS.catDrinks,
      categoryName: "Đồ uống pha chế",
      name: "Cà phê Sữa Đá",
      description: "Cà phê phin truyền thống kết hợp sữa đặc",
      brand: "Minh Anh Signature",
      hasVariants: true,
      imageUrl: null,
      isActive: true,
      createdAt: isoDaysAgo(28),
      updatedAt: now,
      variants: [
        {
          id: "42000000-0000-4000-8000-000000000001",
          productId: "41000000-0000-4000-8000-000000000001",
          sku: "CF-SUA-M",
          barcode: "8938501001011",
          name: "Ly M",
          unit: "Ly",
          costPrice: "10000.00",
          salePrice: "29000.00",
          taxRate: "0.00",
          minStockAlert: 10,
          isActive: true,
          createdAt: isoDaysAgo(28),
          updatedAt: now,
        },
        {
          id: "42000000-0000-4000-8000-000000000002",
          productId: "41000000-0000-4000-8000-000000000001",
          sku: "CF-SUA-L",
          barcode: "8938501001012",
          name: "Ly L",
          unit: "Ly",
          costPrice: "13000.00",
          salePrice: "35000.00",
          taxRate: "0.00",
          minStockAlert: 10,
          isActive: true,
          createdAt: isoDaysAgo(28),
          updatedAt: now,
        },
      ],
    },
    {
      id: "41000000-0000-4000-8000-000000000002",
      categoryId: MOCK_IDS.catDrinks,
      categoryName: "Đồ uống pha chế",
      name: "Trà Đào Cam Sả",
      description: "Trà đen ủ lạnh cùng đào miếng và sả tươi",
      brand: "Minh Anh Tea",
      hasVariants: false,
      imageUrl: null,
      isActive: true,
      createdAt: isoDaysAgo(27),
      updatedAt: now,
      variants: [
        {
          id: "42000000-0000-4000-8000-000000000003",
          productId: "41000000-0000-4000-8000-000000000002",
          sku: "TRA-DAO-L",
          barcode: "8938501002011",
          name: "Tiêu chuẩn",
          unit: "Ly",
          costPrice: "15000.00",
          salePrice: "42000.00",
          taxRate: "8.00",
          minStockAlert: 8,
          isActive: true,
          createdAt: isoDaysAgo(27),
          updatedAt: now,
        },
      ],
    },
    {
      id: "41000000-0000-4000-8000-000000000003",
      categoryId: MOCK_IDS.catDrinks,
      categoryName: "Đồ uống pha chế",
      name: "Matcha Uji Latte",
      description: "Bột Matcha Nhật Bản đánh tay cùng sữa tươi",
      brand: "Minh Anh Tea",
      hasVariants: false,
      imageUrl: null,
      isActive: true,
      createdAt: isoDaysAgo(25),
      updatedAt: now,
      variants: [
        {
          id: "42000000-0000-4000-8000-000000000004",
          productId: "41000000-0000-4000-8000-000000000003",
          sku: "MAT-LATTE",
          barcode: "8938501003011",
          name: "Ly L",
          unit: "Ly",
          costPrice: "19000.00",
          salePrice: "48000.00",
          taxRate: "0.00",
          minStockAlert: 6,
          isActive: true,
          createdAt: isoDaysAgo(25),
          updatedAt: now,
        },
      ],
    },
    {
      id: "41000000-0000-4000-8000-000000000004",
      categoryId: MOCK_IDS.catBakery,
      categoryName: "Bánh & Tráng miệng",
      name: "Bánh Croissant Bơ Pháp",
      description: "Nướng mới mỗi sáng với bơ Elle & Vire",
      brand: "Artisan Bakery",
      hasVariants: false,
      imageUrl: null,
      isActive: true,
      createdAt: isoDaysAgo(22),
      updatedAt: now,
      variants: [
        {
          id: "42000000-0000-4000-8000-000000000005",
          productId: "41000000-0000-4000-8000-000000000004",
          sku: "BANH-CROI",
          barcode: "8938501004011",
          name: "Cái",
          unit: "Cái",
          costPrice: "14000.00",
          salePrice: "32000.00",
          taxRate: "0.00",
          minStockAlert: 5,
          isActive: true,
          createdAt: isoDaysAgo(22),
          updatedAt: now,
        },
      ],
    },
    {
      id: "41000000-0000-4000-8000-000000000005",
      categoryId: MOCK_IDS.catBakery,
      categoryName: "Bánh & Tráng miệng",
      name: "Tiramisu Cacao Hộp",
      description: "Bánh lạnh vị cà phê espresso & mascarpone",
      brand: "Artisan Bakery",
      hasVariants: false,
      imageUrl: null,
      isActive: true,
      createdAt: isoDaysAgo(20),
      updatedAt: now,
      variants: [
        {
          id: "42000000-0000-4000-8000-000000000006",
          productId: "41000000-0000-4000-8000-000000000005",
          sku: "BANH-TIRA",
          barcode: "8938501005011",
          name: "Hộp 150g",
          unit: "Hộp",
          costPrice: "26000.00",
          salePrice: "55000.00",
          taxRate: "0.00",
          minStockAlert: 5,
          isActive: true,
          createdAt: isoDaysAgo(20),
          updatedAt: now,
        },
      ],
    },
    {
      id: "41000000-0000-4000-8000-000000000006",
      categoryId: MOCK_IDS.catRetail,
      categoryName: "Cà phê & Dụng cụ đóng gói",
      name: "Cà phê Hạt Robusta Đắk Lắk",
      description: "Rang mộc nguyên chất đóng gói túi zip 250g",
      brand: "Minh Anh Roastery",
      hasVariants: true,
      imageUrl: null,
      isActive: true,
      createdAt: isoDaysAgo(18),
      updatedAt: now,
      variants: [
        {
          id: "42000000-0000-4000-8000-000000000007",
          productId: "41000000-0000-4000-8000-000000000006",
          sku: "HAT-ROB-250",
          barcode: "8938501234001",
          name: "Túi 250g",
          unit: "Túi",
          costPrice: "72000.00",
          salePrice: "125000.00",
          taxRate: "8.00",
          minStockAlert: 5,
          isActive: true,
          createdAt: isoDaysAgo(18),
          updatedAt: now,
        },
        {
          id: "42000000-0000-4000-8000-000000000008",
          productId: "41000000-0000-4000-8000-000000000006",
          sku: "PHIN-NHOM-01",
          barcode: "8938501234002",
          name: "Phin Nhôm Anode",
          unit: "Cái",
          costPrice: "42000.00",
          salePrice: "85000.00",
          taxRate: "8.00",
          minStockAlert: 4,
          isActive: true,
          createdAt: isoDaysAgo(18),
          updatedAt: now,
        },
      ],
    },
  ];

  const stockSeeds: Array<{
    branchIdx: 0 | 1;
    variantIdx: number;
    prodIdx: number;
    onHand: string;
    reserved?: string;
  }> = [
    { prodIdx: 0, variantIdx: 0, branchIdx: 0, onHand: "48.000" },
    { prodIdx: 0, variantIdx: 1, branchIdx: 0, onHand: "35.000", reserved: "2.000" },
    { prodIdx: 1, variantIdx: 0, branchIdx: 0, onHand: "28.000" },
    { prodIdx: 2, variantIdx: 0, branchIdx: 0, onHand: "3.000" }, // Low stock alert!
    { prodIdx: 3, variantIdx: 0, branchIdx: 0, onHand: "16.000" },
    { prodIdx: 4, variantIdx: 0, branchIdx: 0, onHand: "12.000" },
    { prodIdx: 5, variantIdx: 0, branchIdx: 0, onHand: "18.000" },
    { prodIdx: 5, variantIdx: 1, branchIdx: 0, onHand: "2.000" }, // Low stock alert!
    { prodIdx: 0, variantIdx: 0, branchIdx: 1, onHand: "25.000" },
    { prodIdx: 0, variantIdx: 1, branchIdx: 1, onHand: "20.000" },
    { prodIdx: 1, variantIdx: 0, branchIdx: 1, onHand: "15.000" },
    { prodIdx: 2, variantIdx: 0, branchIdx: 1, onHand: "10.000" },
    { prodIdx: 3, variantIdx: 0, branchIdx: 1, onHand: "9.000" },
    { prodIdx: 4, variantIdx: 0, branchIdx: 1, onHand: "6.000" },
    { prodIdx: 5, variantIdx: 0, branchIdx: 1, onHand: "7.000" },
    { prodIdx: 5, variantIdx: 1, branchIdx: 1, onHand: "5.000" },
  ];

  const inventory: BranchInventoryItem[] = stockSeeds.map((s) => {
    const branch = branches[s.branchIdx]!;
    const product = products[s.prodIdx]!;
    const variant = product.variants[s.variantIdx]!;
    const onHandNum = Number(s.onHand);
    const reservedNum = Number(s.reserved ?? "0.000");
    const availNum = Math.max(0, onHandNum - reservedNum);
    const avgCostNum = Number(variant.costPrice);
    return {
      branchId: branch.id,
      branchCode: branch.code,
      branchName: branch.name,
      variantId: variant.id,
      productId: product.id,
      productName: product.name,
      variantName: variant.name,
      sku: variant.sku,
      barcode: variant.barcode,
      unit: variant.unit,
      minStockAlert: variant.minStockAlert,
      onHand: onHandNum.toFixed(3),
      reserved: reservedNum.toFixed(3),
      available: availNum.toFixed(3),
      avgCost: avgCostNum.toFixed(2),
      salePrice: variant.salePrice,
      stockValue: (onHandNum * avgCostNum).toFixed(2),
      isLowStock: onHandNum <= variant.minStockAlert,
      updatedAt: now,
    };
  });

  const suppliers: SupplierItem[] = [
    {
      id: MOCK_IDS.supTrungNguyen,
      code: "NCC-TN",
      name: "Công ty Cà phê Tây Nguyên Xanh",
      phone: "02623811223",
      email: "b2b@taynguyenxanh.vn",
      address: "TP. Buôn Ma Thuột, Đắk Lắk",
      debtBalance: "0.00",
      createdAt: isoDaysAgo(25),
      updatedAt: now,
    },
    {
      id: MOCK_IDS.supPhucLong,
      code: "NCC-ART",
      name: "Xưởng Bánh Artisan Sài Gòn",
      phone: "02839100999",
      email: "orders@artisanbakery.vn",
      address: "Quận 3, TP.HCM",
      debtBalance: "1250000.00",
      createdAt: isoDaysAgo(22),
      updatedAt: now,
    },
  ];

  const purchaseOrders: PurchaseOrderItemResponse[] = [
    {
      id: "61000000-0000-4000-8000-000000000001",
      code: "PO-261116-01",
      branchId: MOCK_IDS.branchCn01,
      branchCode: "CN01",
      branchName: branches[0]!.name,
      supplierId: MOCK_IDS.supTrungNguyen,
      supplierName: suppliers[0]!.name,
      status: "COMPLETED",
      totalAmount: "1440000.00",
      paidAmount: "1440000.00",
      createdByName: "Phạm Quốc Bảo",
      completedAt: isoDaysAgo(2, 10),
      createdAt: isoDaysAgo(2, 9),
      items: [
        {
          id: "62000000-0000-4000-8000-000000000001",
          variantId: products[5]!.variants[0]!.id,
          sku: "HAT-ROB-250",
          variantName: "Túi 250g",
          unit: "Túi",
          orderedQty: "20.000",
          receivedQty: "20.000",
          unitCost: "72000.00",
          discount: "0.00",
          lineTotal: "1440000.00",
        },
      ],
    },
    {
      id: "61000000-0000-4000-8000-000000000002",
      code: "PO-261118-02",
      branchId: MOCK_IDS.branchCn01,
      branchCode: "CN01",
      branchName: branches[0]!.name,
      supplierId: MOCK_IDS.supPhucLong,
      supplierName: suppliers[1]!.name,
      status: "DRAFT",
      totalAmount: "570000.00",
      paidAmount: "0.00",
      createdByName: "Phạm Quốc Bảo",
      completedAt: null,
      createdAt: isoDaysAgo(0, 8),
      items: [
        {
          id: "62000000-0000-4000-8000-000000000002",
          variantId: products[2]!.variants[0]!.id,
          sku: "MAT-LATTE",
          variantName: "Ly L",
          unit: "Ly",
          orderedQty: "30.000",
          receivedQty: "0.000",
          unitCost: "19000.00",
          discount: "0.00",
          lineTotal: "570000.00",
        },
      ],
    },
  ];

  const stockCounts: StockCountItemResponse[] = [
    {
      id: "63000000-0000-4000-8000-000000000001",
      code: "KK-261115-01",
      branchId: MOCK_IDS.branchCn01,
      branchCode: "CN01",
      branchName: branches[0]!.name,
      status: "BALANCED",
      createdByName: "Phạm Quốc Bảo",
      balancedByName: "Nguyễn Minh Anh",
      balancedAt: isoDaysAgo(3, 18),
      createdAt: isoDaysAgo(3, 17),
      items: [
        {
          id: "64000000-0000-4000-8000-000000000001",
          variantId: products[0]!.variants[0]!.id,
          sku: "CF-SUA-M",
          variantName: "Ly M",
          unit: "Ly",
          systemQty: "50.000",
          actualQty: "48.000",
          varianceQty: "-2.000",
          reason: "Hao hụt kiểm kê định kỳ",
        },
      ],
    },
  ];

  const stockTransfers: StockTransferItemView[] = [
    {
      id: "65000000-0000-4000-8000-000000000001",
      code: "TR-261117-01",
      status: "IN_TRANSIT",
      fromBranchId: MOCK_IDS.branchCn01,
      fromBranchName: branches[0]!.name,
      toBranchId: MOCK_IDS.branchCn02,
      toBranchName: branches[1]!.name,
      createdByName: "Phạm Quốc Bảo",
      receivedByName: null,
      note: "Bổ sung cà phê ly L cuối tuần cho Thảo Điền",
      dispatchedAt: isoDaysAgo(1, 14),
      receivedAt: null,
      items: [
        {
          id: "66000000-0000-4000-8000-000000000001",
          variantId: products[0]!.variants[1]!.id,
          sku: "CF-SUA-L",
          productName: "Cà phê Sữa Đá",
          variantName: "Ly L",
          unit: "Ly",
          quantity: "10.000",
          unitCost: "13000.00",
        },
      ],
    },
  ];

  const ledgers: InventoryLedgerItem[] = [
    {
      id: "67000000-0000-4000-8000-000000000001",
      branchId: MOCK_IDS.branchCn01,
      branchCode: "CN01",
      branchName: branches[0]!.name,
      variantId: products[5]!.variants[0]!.id,
      sku: "HAT-ROB-250",
      variantName: "Túi 250g",
      movementType: "PURCHASE_IN",
      qtyDelta: "20.000",
      qtyBefore: "0.000",
      qtyAfter: "20.000",
      unitCost: "72000.00",
      referenceType: "purchase_order",
      referenceId: purchaseOrders[0]!.id,
      actorName: "Phạm Quốc Bảo",
      actorEmployeeCode: "KHO01",
      note: "Nhập kho từ PO-261116-01",
      createdAt: isoDaysAgo(2, 10),
    },
    {
      id: "67000000-0000-4000-8000-000000000002",
      branchId: MOCK_IDS.branchCn01,
      branchCode: "CN01",
      branchName: branches[0]!.name,
      variantId: products[5]!.variants[0]!.id,
      sku: "HAT-ROB-250",
      variantName: "Túi 250g",
      movementType: "SALE",
      qtyDelta: "-2.000",
      qtyBefore: "20.000",
      qtyAfter: "18.000",
      unitCost: "72000.00",
      referenceType: "invoice",
      referenceId: "81000000-0000-4000-8000-000000000001",
      actorName: "Lê Thu Hà",
      actorEmployeeCode: "TN01",
      note: "Bán hàng POS HD-261118-001",
      createdAt: isoDaysAgo(0, 9),
    },
  ];

  const customers: CustomerDetailResponse[] = [
    {
      id: MOCK_IDS.custLan,
      code: "KH-0001",
      name: "Võ Ngọc Lan",
      phone: "0903888111",
      email: "ngoclan@gmail.com",
      loyaltyPoints: 45,
      totalSpent: "1250000.00",
      debtBalance: "0.00",
      createdAt: isoDaysAgo(20),
      updatedAt: now,
      recentInvoices: [
        {
          id: "81000000-0000-4000-8000-000000000001",
          code: "HD-261118-001",
          branchName: branches[0]!.name,
          status: "COMPLETED",
          totalAmount: "285000.00",
          createdAt: isoDaysAgo(0, 9),
        },
      ],
    },
    {
      id: MOCK_IDS.custHung,
      code: "KH-0002",
      name: "Đặng Quốc Hưng",
      phone: "0912777222",
      email: "hungdq@company.vn",
      loyaltyPoints: 120,
      totalSpent: "3480000.00",
      debtBalance: "0.00",
      createdAt: isoDaysAgo(18),
      updatedAt: now,
      recentInvoices: [],
    },
    {
      id: MOCK_IDS.custMai,
      code: "KH-0003",
      name: "Bùi Tuyết Mai",
      phone: "0988555333",
      email: null,
      loyaltyPoints: 18,
      totalSpent: "420000.00",
      debtBalance: "0.00",
      createdAt: isoDaysAgo(10),
      updatedAt: now,
      recentInvoices: [],
    },
  ];

  const shifts: RegisterShiftItem[] = [
    {
      id: MOCK_IDS.shiftOpen,
      branchId: MOCK_IDS.branchCn01,
      branchCode: "CN01",
      branchName: branches[0]!.name,
      openedByMemberId: MOCK_IDS.cashierMember,
      openedByName: "Lê Thu Hà",
      closedByMemberId: null,
      closedByName: null,
      status: "OPEN",
      openingCash: "500000.00",
      expectedCash: "685000.00",
      actualCash: null,
      cashVariance: null,
      openedAt: isoDaysAgo(0, 7),
      closedAt: null,
      note: "Ca sáng CN01",
    },
  ];

  const invoices: InvoiceDetailResponse[] = [
    {
      id: "81000000-0000-4000-8000-000000000001",
      code: "HD-261118-001",
      idempotencyKey: "82000000-0000-4000-8000-000000000001",
      branchId: MOCK_IDS.branchCn01,
      branchCode: "CN01",
      branchName: branches[0]!.name,
      shiftId: MOCK_IDS.shiftOpen,
      cashierMemberId: MOCK_IDS.cashierMember,
      cashierName: "Lê Thu Hà",
      customerId: MOCK_IDS.custLan,
      customerName: "Võ Ngọc Lan",
      earnedPoints: 28,
      status: "COMPLETED",
      subtotal: "285000.00",
      discountAmount: "0.00",
      taxAmount: "0.00",
      totalAmount: "285000.00",
      paidAmount: "285000.00",
      changeGiven: "0.00",
      createdAt: isoDaysAgo(0, 9),
      items: [
        {
          id: "83000000-0000-4000-8000-000000000001",
          variantId: products[5]!.variants[0]!.id,
          productName: "Cà phê Hạt Robusta Đắk Lắk - Túi 250g",
          sku: "HAT-ROB-250",
          quantity: "2.000",
          returnedQty: "0.000",
          unitPrice: "125000.00",
          discountAmount: "0.00",
          taxAmount: "0.00",
          lineTotal: "250000.00",
        },
        {
          id: "83000000-0000-4000-8000-000000000002",
          variantId: products[0]!.variants[1]!.id,
          productName: "Cà phê Sữa Đá - Ly L",
          sku: "CF-SUA-L",
          quantity: "1.000",
          returnedQty: "0.000",
          unitPrice: "35000.00",
          discountAmount: "0.00",
          taxAmount: "0.00",
          lineTotal: "35000.00",
        },
      ],
      payments: [
        {
          id: "84000000-0000-4000-8000-000000000001",
          method: "CASH",
          amount: "185000.00",
          referenceNo: null,
          paidAt: isoDaysAgo(0, 9),
        },
        {
          id: "84000000-0000-4000-8000-000000000002",
          method: "BANK_TRANSFER_QR",
          amount: "100000.00",
          referenceNo: "VIETQR-8821",
          paidAt: isoDaysAgo(0, 9),
        },
      ],
      salesReturns: [],
    },
  ];

  const salesReturns: SalesReturnResponse[] = [];

  const reportExports: ReportExportJobItem[] = [
    {
      id: "91000000-0000-4000-8000-000000000001",
      reportType: "SALES_DETAIL",
      status: "COMPLETED",
      fileName: `smartpos-sales-detail-${dateYmdAgo(0)}.xlsx`,
      rowCount: 24,
      errorMessage: null,
      requestedByName: "Nguyễn Minh Anh",
      createdAt: isoDaysAgo(1, 17),
      completedAt: isoDaysAgo(1, 17),
    },
    {
      id: "91000000-0000-4000-8000-000000000002",
      reportType: "ACCOUNTING_LEDGER",
      status: "COMPLETED",
      fileName: `smartpos-accounting-ledger-${dateYmdAgo(0)}.xlsx`,
      rowCount: 31,
      errorMessage: null,
      requestedByName: "Nguyễn Minh Anh",
      createdAt: isoDaysAgo(0, 8),
      completedAt: isoDaysAgo(0, 8),
    },
  ];

  const auditLogs: AuditLogItem[] = [
    {
      id: "92000000-0000-4000-8000-000000000001",
      branchId: MOCK_IDS.branchCn01,
      branchName: branches[0]!.name,
      actorMemberId: MOCK_IDS.managerMember,
      actorName: "Trần Bảo Châu",
      actorEmployeeCode: "MGR01",
      action: "PRICE_OVERRIDE",
      entityType: "invoice",
      entityId: invoices[0]!.id,
      metadata: { sku: "CF-SUA-L", oldPrice: "35000.00", newPrice: "30000.00" },
      ipAddress: "127.0.0.1",
      createdAt: isoDaysAgo(1, 15),
    },
    {
      id: "92000000-0000-4000-8000-000000000002",
      branchId: MOCK_IDS.branchCn01,
      branchName: branches[0]!.name,
      actorMemberId: MOCK_IDS.ownerMember,
      actorName: "Nguyễn Minh Anh",
      actorEmployeeCode: "OWNER01",
      action: "STOCK_ADJUST",
      entityType: "stock_count",
      entityId: stockCounts[0]!.id,
      metadata: { code: "KK-261115-01", varianceQty: "-2.000" },
      ipAddress: "127.0.0.1",
      createdAt: isoDaysAgo(3, 18),
    },
    {
      id: "92000000-0000-4000-8000-000000000003",
      branchId: null,
      branchName: null,
      actorMemberId: MOCK_IDS.ownerMember,
      actorName: "Nguyễn Minh Anh",
      actorEmployeeCode: "OWNER01",
      action: "API_KEY_CREATED",
      entityType: "tenant_api_key",
      entityId: "93000000-0000-4000-8000-000000000001",
      metadata: { name: "Website Đặt Hàng Minh Anh", scopes: ["inventory:read", "orders:write"] },
      ipAddress: "127.0.0.1",
      createdAt: isoDaysAgo(4, 11),
    },
  ];

  const plans: SubscriptionPlanInfo[] = [
    {
      id: "a1000000-0000-4000-8000-000000000001",
      code: "FREE_TRIAL",
      name: "Dùng thử 30 ngày",
      priceMonthly: "0.00",
      maxBranches: 2,
      maxUsers: 5,
      maxSkus: 500,
      storageQuotaMb: 512,
      features: { posOffline: true, splitPayments: true },
    },
    {
      id: "a1000000-0000-4000-8000-000000000002",
      code: "LITE",
      name: "Gói Lite",
      priceMonthly: "290000.00",
      maxBranches: 1,
      maxUsers: 5,
      maxSkus: 2000,
      storageQuotaMb: 2048,
      features: { posOffline: true, splitPayments: true },
    },
    {
      id: "a1000000-0000-4000-8000-000000000003",
      code: "PRO",
      name: "Gói Pro",
      priceMonthly: "690000.00",
      maxBranches: 10,
      maxUsers: 50,
      maxSkus: 50000,
      storageQuotaMb: 10240,
      features: {
        posOffline: true,
        splitPayments: true,
        multiBranchTransfer: true,
        omnichannelApi: true,
      },
    },
  ];

  const billingHistory: SubscriptionBillingItem[] = [
    {
      id: "a2000000-0000-4000-8000-000000000001",
      planCode: "FREE_TRIAL",
      billingMonths: 1,
      amount: "0.00",
      status: "PAID",
      provider: "TRIAL_EXTEND",
      referenceNo: "TRIAL-START-01",
      periodStart: isoDaysAgo(12),
      periodEnd: isoDaysAhead(18),
      paidAt: isoDaysAgo(12),
      createdAt: isoDaysAgo(12),
    },
  ];

  const apiKeys: ApiKeyItem[] = [
    {
      id: "93000000-0000-4000-8000-000000000001",
      name: "Website Đặt Hàng Minh Anh",
      keyPrefix: "spos_live_100000000000",
      scopes: ["inventory:read", "orders:write"],
      isActive: true,
      lastUsedAt: isoDaysAgo(0, 8),
      createdAt: isoDaysAgo(4, 11),
      revokedAt: null,
    },
  ];

  const webhooks: WebhookEndpointItem[] = [
    {
      id: "94000000-0000-4000-8000-000000000001",
      name: "Đồng bộ tồn kho Shopee Store",
      targetUrl: "https://hooks.minhanh.vn/smartpos-stock",
      signingSecret: "whsec_mock_demo_secret_8899112233",
      events: ["STOCK_UPDATED", "EXTERNAL_ORDER_SYNCED"],
      isActive: true,
      createdAt: isoDaysAgo(4),
      updatedAt: now,
    },
  ];

  const webhookDeliveries: WebhookDeliveryItem[] = [
    {
      id: "95000000-0000-4000-8000-000000000001",
      endpointId: webhooks[0]!.id,
      endpointName: webhooks[0]!.name,
      eventType: "STOCK_UPDATED",
      status: "DELIVERED",
      httpStatus: 200,
      responseSnippet: '{"received":true}',
      attemptCount: 1,
      deliveredAt: isoDaysAgo(0, 9),
      createdAt: isoDaysAgo(0, 9),
    },
  ];

  return {
    tenant: {
      id: MOCK_IDS.tenant,
      slug: "cafe-minh-anh",
      name: "Cà phê & Tiện lợi Minh Anh",
      businessType: "RETAIL",
      planCode: "FREE_TRIAL",
      status: "ACTIVE",
      trialEndsAt: isoDaysAhead(18),
    },
    loggedOut: false,
    branches,
    staff,
    categories,
    products,
    inventory,
    ledgers,
    suppliers,
    purchaseOrders,
    stockCounts,
    stockTransfers,
    shifts,
    invoices,
    salesReturns,
    customers,
    reportExports,
    auditLogs,
    plans,
    billingHistory,
    apiKeys,
    webhooks,
    webhookDeliveries,
  };
}

export function buildMockReportOverview(
  state: MockTenantState,
  branchId?: string,
): ReportOverviewResponse {
  const dailySeries = [6, 5, 4, 3, 2, 1, 0].map((daysAgo, idx) => {
    const gross = 1850000 + idx * 320000;
    const discount = idx * 25000;
    const refund = idx === 4 ? 70000 : 0;
    const net = gross - discount - refund;
    const cogs = Math.round(net * 0.44);
    return {
      date: dateYmdAgo(daysAgo),
      invoiceCount: 16 + idx * 3,
      grossRevenue: gross.toFixed(2),
      discountTotal: discount.toFixed(2),
      refundTotal: refund.toFixed(2),
      netRevenue: net.toFixed(2),
      cogsTotal: cogs.toFixed(2),
      grossProfit: (net - cogs).toFixed(2),
    };
  });

  const lowStockAlerts = state.inventory
    .filter((it) => (!branchId || it.branchId === branchId) && it.isLowStock)
    .map((it) => ({
      branchId: it.branchId,
      branchName: it.branchName,
      variantId: it.variantId,
      sku: it.sku,
      productName: it.productName,
      variantName: it.variantName,
      onHand: it.onHand,
      minStockAlert: it.minStockAlert,
    }));

  return {
    from: dateYmdAgo(29),
    to: dateYmdAgo(0),
    branchId: branchId ?? null,
    kpis: {
      invoiceCount: 175,
      grossRevenue: "19850000.00",
      discountTotal: "525000.00",
      refundTotal: "70000.00",
      netRevenue: "19255000.00",
      cogsTotal: "8472000.00",
      grossProfit: "10783000.00",
      averageOrderValue: "110028.57",
      cashTotal: "11200000.00",
      transferTotal: "6255000.00",
      cardTotal: "1800000.00",
    },
    dailySeries,
    topProducts: [
      {
        variantId: state.products[0]!.variants[1]!.id,
        sku: "CF-SUA-L",
        productName: "Cà phê Sữa Đá",
        variantName: "Ly L",
        quantitySold: "182.000",
        revenue: "6370000.00",
      },
      {
        variantId: state.products[1]!.variants[0]!.id,
        sku: "TRA-DAO-L",
        productName: "Trà Đào Cam Sả",
        variantName: "Tiêu chuẩn",
        quantitySold: "118.000",
        revenue: "4956000.00",
      },
      {
        variantId: state.products[5]!.variants[0]!.id,
        sku: "HAT-ROB-250",
        productName: "Cà phê Hạt Robusta Đắk Lắk",
        variantName: "Túi 250g",
        quantitySold: "36.000",
        revenue: "4500000.00",
      },
    ],
    lowStockAlerts,
  };
}
