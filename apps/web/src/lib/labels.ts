import type {
  AuditActionType,
  BusinessType,
  ExportJobStatus,
  InventoryMovementType,
  PaymentMethod,
  Permission,
  PurchaseOrderStatus,
  ReportExportType,
  Role,
  StockCountStatus,
  StockTransferStatus,
} from "@smart-pos/shared";

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  COMPLETED: "Hoàn thành",
  VOIDED: "Đã hủy",
  PARTIAL_RETURNED: "Trả một phần",
  RETURNED: "Đã trả hết",
};

export const STOCK_TRANSFER_STATUS_LABELS: Record<StockTransferStatus, string> = {
  IN_TRANSIT: "Đang vận chuyển",
  RECEIVED: "Đã nhận kho",
  CANCELLED: "Đã hủy",
};

export const EXPORT_JOB_STATUS_LABELS: Record<ExportJobStatus, string> = {
  PENDING: "Đang chờ",
  PROCESSING: "Đang xử lý",
  COMPLETED: "Hoàn tất",
  FAILED: "Thất bại",
};

export const REPORT_EXPORT_TYPE_LABELS: Record<ReportExportType, string> = {
  SALES_DETAIL: "Chi tiết hóa đơn bán hàng",
  INVENTORY_LEDGER: "Thẻ kho chi tiết",
  DAILY_SUMMARY: "Tổng hợp doanh thu theo ngày",
};

export const AUDIT_ACTION_LABELS: Record<AuditActionType, string> = {
  INVOICE_VOID: "Hủy hóa đơn",
  PRICE_OVERRIDE: "Sửa giá bán tại quầy",
  DISCOUNT_OVERRIDE: "Chiết khấu tại quầy",
  STOCK_ADJUST: "Điều chỉnh kiểm kho",
  SHIFT_DIFF: "Lệch tiền chốt ca",
  REFUND: "Hoàn trả hàng / tiền",
  CASH_DRAWER_OPEN: "Mở két tiền thủ công",
  BRANCH_CREATED: "Tạo chi nhánh",
  BRANCH_UPDATED: "Cập nhật chi nhánh",
  MEMBER_CREATED: "Thêm nhân viên",
  MEMBER_UPDATED: "Cập nhật nhân viên",
  TRANSFER_DISPATCHED: "Xuất chuyển kho",
  TRANSFER_RECEIVED: "Nhận chuyển kho",
  CUSTOMER_LOYALTY_ADJUST: "Điều chỉnh điểm Loyalty",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Tiền mặt",
  BANK_TRANSFER_QR: "Chuyển khoản / VietQR",
  CARD: "Thẻ / POS",
  LOYALTY_POINTS: "Điểm thưởng",
  STORE_CREDIT: "Ghi nợ / Trả trước",
};

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Chủ cửa hàng",
  MANAGER: "Quản lý",
  CASHIER: "Thu ngân",
  WAREHOUSE: "Thủ kho",
};

export const MOVEMENT_TYPE_LABELS: Record<InventoryMovementType, string> = {
  PURCHASE_IN: "Nhập hàng NCC",
  PURCHASE_RETURN: "Trả hàng NCC",
  SALE: "Bán hàng POS",
  SALE_RETURN: "Khách trả hàng",
  STOCK_COUNT: "Kiểm kho cân bằng",
  TRANSFER_OUT: "Xuất chuyển kho",
  TRANSFER_IN: "Nhập chuyển kho",
};

export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: "Nháp",
  COMPLETED: "Đã nhập kho",
  CANCELLED: "Đã hủy",
};

export const STOCK_COUNT_STATUS_LABELS: Record<StockCountStatus, string> = {
  DRAFT: "Đang kiểm",
  BALANCED: "Đã cân bằng",
  CANCELLED: "Đã hủy",
};

export function formatVndAmount(decimalString: string | number): string {
  const num = Number(decimalString);
  if (!Number.isFinite(num)) return "0 ₫";
  return `${new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: 2,
  }).format(num)} ₫`;
}

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  RETAIL: "Bán lẻ tổng hợp",
  FASHION: "Thời trang & Phụ kiện",
  GROCERY: "Tạp hóa & Siêu thị mini",
  PHARMACY: "Nhà thuốc",
  ELECTRONICS: "Điện tử & Gia dụng",
  OTHER: "Ngành hàng khác",
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  "pos:sell": "Bán hàng tại quầy POS",
  "pos:discount_override": "Sửa chiết khấu tại quầy",
  "pos:price_override": "Sửa giá bán tại quầy",
  "pos:refund": "Hoàn trả hàng & Hoàn tiền",
  "pos:shift_manage": "Mở / Đóng ca thu ngân",
  "inventory:view": "Xem tồn kho",
  "inventory:receive": "Nhập hàng từ nhà cung cấp",
  "inventory:count": "Kiểm kho & Cân bằng tồn",
  "inventory:transfer": "Điều chuyển kho nội bộ",
  "catalog:manage": "Quản lý danh mục & sản phẩm",
  "customer:view": "Xem & chọn khách hàng tại POS",
  "customer:manage": "Quản lý CRM & điểm Loyalty",
  "report:financial": "Xem báo cáo doanh thu & lãi gộp",
  "staff:manage": "Quản lý nhân viên & phân quyền",
  "branch:manage": "Quản lý chi nhánh",
  "audit:view": "Xem nhật ký kiểm toán",
};

/** Generate an ASCII URL-safe tenant slug from a Vietnamese shop name. */
export function slugifyShopName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
