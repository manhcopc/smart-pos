import type {
  BusinessType,
  InventoryMovementType,
  Permission,
  PurchaseOrderStatus,
  Role,
  StockCountStatus,
} from "@smart-pos/shared";

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
