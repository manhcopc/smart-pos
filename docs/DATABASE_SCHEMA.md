# Database Schema Specification — Smart-POS (PostgreSQL + Prisma)

Thiết kế dữ liệu theo mô hình **Shared-Database, Shared-Schema Multi-Tenancy**, đảm bảo 3 nguyên tắc:
1. **Cô lập 2 lớp:** Mọi bảng nghiệp vụ đều có `tenant_id NOT NULL` + Composite Index dẫn đầu bằng `tenant_id` + chính sách **PostgreSQL RLS** (`current_setting('app.current_tenant_id', true)`).
2. **Toàn vẹn tồn kho (Concurrency-Safe):** Dùng bảng `branch_inventories` kèm điều kiện nguyên tử `WHERE on_hand >= qty` và ghi bất biến vào `inventory_ledgers`.
3. **Tách dữ liệu tổng hợp & File:** Có bảng `daily_branch_summaries` cho Dashboard nhanh; không lưu file/ảnh Base64 trong DB (chỉ lưu `image_url` từ Cloudflare R2/S3).

---

## 1. Nhóm Global & SaaS Subscription
*(Các bảng không thuộc 1 tenant riêng lẻ)*

- **`subscription_plans`**
  - `id` (UUID, PK), `code` (`FREE_TRIAL`, `LITE`, `PRO`), `name`, `price_monthly` (DECIMAL), `max_branches` (INT), `max_users` (INT), `max_skus` (INT), `storage_quota_mb` (INT), `features` (JSONB).
- **`tenants`** (Mỗi chủ shop đăng ký = 1 Tenant)
  - `id` (UUID, PK), `slug` (UNIQUE, dùng để đăng nhập nhanh dạng gian hàng), `name`, `business_type`, `phone`, `plan_id` (FK), `trial_ends_at`, `status` (`ACTIVE`, `SUSPENDED`), `created_at`.
- **`users`** (Tài khoản người dùng cấp hệ thống)
  - `id` (UUID, PK), `email` (UNIQUE nullable nếu thu ngân chỉ dùng mã NV), `password_hash`, `full_name`, `phone`, `two_factor_enabled`, `two_factor_secret`, `created_at`.

---

## 2. Nhóm Tenant, Chi nhánh & Phân quyền (RBAC)
*(Tất cả các bảng từ mục 2 trở đi đều có `tenant_id UUID NOT NULL`)*

- **`branches`** (Chi nhánh / Kho hàng của shop)
  - `id` (UUID, PK), `tenant_id`, `code`, `name`, `address`, `phone`, `is_default`, `is_active`.
  - Index: `(tenant_id, is_active)`.
- **`tenant_members`** (Liên kết User vào Tenant + Vai trò + Chi nhánh được phép truy cập)
  - `id` (UUID, PK), `tenant_id`, `user_id` (FK -> `users`), `employee_code` (unique theo `tenant_id`), `pin_hash` (dùng đổi ca nhanh tại quầy), `role` (`OWNER`, `MANAGER`, `CASHIER`, `WAREHOUSE`), `permissions` (JSONB override), `allowed_branch_ids` (UUID[]), `is_active`.
  - Unique: `(tenant_id, user_id)` và `(tenant_id, employee_code)`.
- **`audit_logs`** (Nhật ký thao tác nhạy cảm — bất biến, chỉ INSERT)
  - `id` (UUID, PK), `tenant_id`, `branch_id`, `actor_member_id`, `action` (`INVOICE_VOID`, `PRICE_OVERRIDE`, `STOCK_ADJUST`, `SHIFT_DIFF`, `REFUND`), `entity_type`, `entity_id`, `metadata` (JSONB: before/after/reason), `ip_address`, `created_at`.
  - Index: `(tenant_id, created_at DESC)`.

---

## 3. Nhóm Hàng hóa & Giá bán

- **`categories`**
  - `id` (UUID, PK), `tenant_id`, `parent_id`, `name`, `sort_order`.
- **`products`** (Sản phẩm cha)
  - `id` (UUID, PK), `tenant_id`, `category_id`, `name`, `description`, `brand`, `has_variants` (BOOLEAN), `image_url`, `is_active`, `updated_at` (dùng cho delta sync về IndexedDB).
  - Index: `(tenant_id, updated_at)`.
- **`product_variants`** (SKU bán trực tiếp tại quầy & quản lý tồn kho)
  - `id` (UUID, PK), `tenant_id`, `product_id`, `sku` (unique theo `tenant_id`), `barcode` (unique theo `tenant_id`, nullable), `name` (VD: "Áo thun - Đen - L"), `unit` ("Cái", "Hộp", "Kg"), `cost_price` (DECIMAL 15,2 — giá vốn bình quân gia quyền), `sale_price` (DECIMAL 15,2), `tax_rate` (DECIMAL 5,2), `min_stock_alert` (INT), `is_active`, `updated_at`.
  - Index: `(tenant_id, barcode)`, `(tenant_id, sku)`, `(tenant_id, updated_at)`.

---

## 4. Nhóm Kho hàng & Thẻ kho (Inventory Core)

- **`branch_inventories`** (Tồn kho hiện tại của 1 SKU tại 1 Chi nhánh)
  - `id` (UUID, PK), `tenant_id`, `branch_id`, `variant_id`, `on_hand` (DECIMAL 15,3), `reserved` (DECIMAL 15,3), `avg_cost` (DECIMAL 15,2), `updated_at`.
  - Unique: `(tenant_id, branch_id, variant_id)`.
  - Constraint / Guard: `on_hand >= 0` (trừ khi shop bật cấu hình cho phép bán âm có kiểm soát).
- **`inventory_ledgers`** (Thẻ kho — mọi biến động kho đều ghi 1 dòng bất biến)
  - `id` (UUID, PK), `tenant_id`, `branch_id`, `variant_id`, `movement_type` (`SALE`, `SALE_RETURN`, `PURCHASE_IN`, `PURCHASE_RETURN`, `STOCK_COUNT`, `TRANSFER_OUT`, `TRANSFER_IN`), `qty_delta` (DECIMAL 15,3), `qty_before`, `qty_after`, `unit_cost`, `reference_type`, `reference_id`, `actor_member_id`, `note`, `created_at`.
  - Index: `(tenant_id, branch_id, variant_id, created_at DESC)`.
- **`suppliers`** (Nhà cung cấp)
  - `id` (UUID, PK), `tenant_id`, `code`, `name`, `phone`, `email`, `address`, `debt_balance` (DECIMAL 15,2).
- **`purchase_orders`** & **`purchase_order_items`** (Phiếu nhập hàng NCC)
  - `purchase_orders`: `id`, `tenant_id`, `branch_id`, `supplier_id`, `code`, `status` (`DRAFT`, `COMPLETED`, `CANCELLED`), `total_amount`, `paid_amount`, `created_by`, `completed_at`.
  - `purchase_order_items`: `id`, `tenant_id`, `purchase_order_id`, `variant_id`, `ordered_qty`, `received_qty`, `unit_cost`, `discount`.
- **`stock_counts`** & **`stock_count_items`** (Phiếu kiểm kho)
  - `stock_counts`: `id`, `tenant_id`, `branch_id`, `code`, `status` (`DRAFT`, `BALANCED`, `CANCELLED`), `created_by`, `balanced_by`, `balanced_at`.
  - `stock_count_items`: `id`, `tenant_id`, `stock_count_id`, `variant_id`, `system_qty`, `actual_qty`, `variance_qty`, `reason`.

---

## 5. Nhóm Ca Thu ngân, Bán hàng POS & Thanh toán

- **`register_shifts`** (Mở/Đóng ca thu ngân & đối soát két tiền)
  - `id` (UUID, PK), `tenant_id`, `branch_id`, `opened_by_member_id`, `closed_by_member_id`, `status` (`OPEN`, `CLOSED`), `opening_cash` (DECIMAL 15,2), `expected_cash` (tính từ tiền đầu ca + tiền mặt thu - tiền mặt chi/hoàn), `actual_cash` (thu ngân đếm cuối ca), `cash_variance`, `opened_at`, `closed_at`, `note`.
  - Index: `(tenant_id, branch_id, status)`.
- **`customers`** (CRM & Tích điểm)
  - `id` (UUID, PK), `tenant_id`, `code`, `name`, `phone`, `email`, `loyalty_points` (INT >= 0), `total_spent` (DECIMAL 15,2), `debt_balance` (DECIMAL 15,2).
  - Unique/Index: `(tenant_id, phone)`.
- **`invoices`** (Hóa đơn bán hàng)
  - `id` (UUID, PK), `tenant_id`, `branch_id`, `shift_id` (FK -> `register_shifts`), `customer_id` (nullable), `cashier_member_id`, `code` (HD000001 theo `tenant_id`), `idempotency_key` (UUID — chống trùng đơn khi offline sync/bấm đúp), `status` (`COMPLETED`, `VOIDED`, `PARTIAL_RETURNED`, `RETURNED`), `subtotal`, `discount_amount`, `tax_amount`, `total_amount`, `paid_amount`, `cogs_amount` (tổng giá vốn tại thời điểm bán để tính lợi nhuận gộp chính xác), `sync_source` (`ONLINE`, `OFFLINE_SYNC`), `created_at`.
  - Unique: `(tenant_id, idempotency_key)` và `(tenant_id, code)`.
  - Index: `(tenant_id, branch_id, created_at DESC)`.
- **`invoice_items`**
  - `id` (UUID, PK), `tenant_id`, `invoice_id`, `variant_id`, `product_name_snapshot`, `sku_snapshot`, `quantity`, `unit_price`, `discount_amount`, `tax_amount`, `line_total`, `unit_cost_snapshot`, `returned_qty` (lũy kế đã trả để chặn hoàn quá số mua).
- **`invoice_payments`** (Hỗ trợ **Split Payments** — nhiều hình thức thanh toán trên 1 hóa đơn)
  - `id` (UUID, PK), `tenant_id`, `invoice_id`, `method` (`CASH`, `BANK_TRANSFER_QR`, `CARD`, `LOYALTY_POINTS`, `STORE_CREDIT`), `amount` (DECIMAL 15,2), `reference_no` (mã giao dịch QR/POS thẻ), `paid_at`.
- **`sales_returns`** & **`sales_return_items`** (Phiếu trả hàng)
  - Ghi nhận hoàn tiền theo phương thức thanh toán, cộng lại tồn kho + ghi `InventoryLedger` (`SALE_RETURN`), đồng thời tăng `invoice_items.returned_qty` nguyên tử.

---

## 6. Nhóm Báo cáo Tổng hợp Tốc độ cao

- **`daily_branch_summaries`** (Cập nhật tăng dần hoặc qua BullMQ job để tải Dashboard tức thì)
  - `id` (UUID, PK), `tenant_id`, `branch_id`, `summary_date` (DATE), `invoice_count`, `gross_revenue`, `discount_total`, `net_revenue`, `cogs_total`, `gross_profit`, `refund_total`, `cash_total`, `transfer_total`, `card_total`.
  - Unique: `(tenant_id, branch_id, summary_date)`.

---

## 7. Quy tắc Transaction Thanh toán POS (Chống Race Condition)
Khi `POST /api/v1/pos/invoices` được gọi trong `apps/api`:
1. Kiểm tra `idempotency_key`: nếu đã tồn tại với `(tenant_id, idempotency_key)`, trả về hóa đơn đã tạo (HTTP 200) -> không trừ kho lần 2.
2. Mở PostgreSQL transaction (`IsolationLevel.RepeatableRead`), set `SET LOCAL app.current_tenant_id = :tenantId`.
3. Kiểm tra ca làm việc `register_shifts` đang `OPEN`.
4. Với từng dòng hàng (sắp xếp theo `variant_id` tăng dần để tránh deadlock):
   - Chạy cập nhật nguyên tử: `UPDATE branch_inventories SET on_hand = on_hand - :qty WHERE tenant_id = :tenantId AND branch_id = :branchId AND variant_id = :variantId AND on_hand >= :qty RETURNING *`.
   - Nếu không có dòng nào được cập nhật -> throw `InsufficientStockException` (rollback toàn bộ).
5. Ghi `invoices`, `invoice_items`, `invoice_payments`, `inventory_ledgers`, cập nhật điểm `customers` (nếu có) và `daily_branch_summaries`.
6. Sau khi commit DB thành công mới đẩy sự kiện ra **Redis / WebSocket** (cập nhật tồn kho cho các quầy khác) và **BullMQ** (nếu cần tác vụ nền).
