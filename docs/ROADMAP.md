# Roadmap Triển khai Smart-POS (Mô hình 2: Monorepo NestJS + Next.js)

Lộ trình chia theo từng giai đoạn tăng trưởng thực tế, bám sát thứ tự phụ thuộc kỹ thuật và 3 mức ưu tiên trong [SRS.md](./SRS.md).

---

## Phase 0: Khởi tạo Monorepo & Hạ tầng nền (Tuần 1)
- [x] Tạo thư mục dự án `/Users/copc/Workspace/smart-pos`, nạp bộ Agent Skills vào `.agents/skills/` và cấu hình `docker-compose.yml` (PostgreSQL 16 + Redis 7).
- [x] Khởi tạo `apps/api` (NestJS + Prisma + Zod + Swagger) và `apps/web` (Next.js App Router + Tailwind + shadcn/ui + TanStack Query).
- [x] Khởi tạo `packages/shared` chứa Zod schemas, Error codes và RBAC Permission matrix dùng chung.
- [x] Thiết lập `PrismaModule` hỗ trợ Multi-tenant scoping + migration khởi tạo + PostgreSQL RLS helper.

## Phase 1: SaaS Onboarding, Chi nhánh & RBAC (Tuần 2)
- [x] API & UI Đăng ký Shop (`POST /auth/register-tenant`): tạo Tenant, Branch mặc định, Owner account trong 1 transaction.
- [x] Đăng nhập Chủ shop/Quản lý (Email + Password) và Đăng nhập nhanh Thu ngân (`tenantSlug` + Mã NV + PIN).
- [x] Quản lý Chi nhánh (`branches`) và Nhân viên (`tenant_members` + RBAC Guards).
- [x] Điều hướng tự động theo vai trò: Thu ngân -> `/pos`, Quản lý/Chủ shop -> `/dashboard`.

## Phase 2: Hàng hóa & Kho Thời gian thực (Tuần 3–4)
- [x] CRUD Nhóm hàng, Sản phẩm, Biến thể (SKU, Barcode, Giá vốn/Giá bán, Ngưỡng tồn tối thiểu).
- [x] Upload ảnh sản phẩm nén WebP qua Presigned URL (Cloudflare R2 / S3).
- [x] Import/Export danh mục sản phẩm Excel/CSV + Bộ lọc tồn kho theo chi nhánh.
- [x] Phiếu Nhập hàng NCC (`purchase_orders`) tự cập nhật giá vốn bình quân gia quyền (AVCO) + ghi `inventory_ledgers`.
- [x] Phiếu Kiểm kho (`stock_counts`) đối chiếu thực tế vs sổ sách + ghi `audit_logs`.

## Phase 3: Màn hình POS Bán hàng & Ca Thu ngân (Tuần 5–6)
- [x] Luồng Mở ca -> Kiểm két tiền -> Bán hàng -> Đóng ca (`Z-Report`).
- [x] Đồng bộ danh mục chi nhánh về `IndexedDB` trên trình duyệt -> tìm kiếm & quét mã vạch < 50ms.
- [x] Màn hình POS: nhiều tab hóa đơn chờ, Quick-keys, chiết khấu, **Split Payments** (Tiền mặt + VietQR + Thẻ).
- [x] Transaction thanh toán an toàn (`RepeatableRead` + atomic guard `on_hand >= qty` + `idempotency_key`).
- [x] In hóa đơn nhiệt K58/K80 (`@media print`) + đẩy tồn kho realtime qua NestJS WebSocket/SSE.
- [x] Viết bộ test `Vitest` cho toàn bộ phép tính tiền, chiết khấu, VAT, trừ kho đồng thời.

## Phase 4: Báo cáo, Hoàn trả, CRM & Queue nền (Tuần 7–8)
- [ ] Luồng Trả hàng / Hoàn tiền (`sales_returns`) kiểm soát trả lũy kế + hoàn kho nguyên tử.
- [ ] PIN Quản lý duyệt thao tác nhạy cảm (sửa giá, hủy hóa đơn) + trang xem `Audit Logs`.
- [ ] Quản lý Khách hàng (CRM) & Tích điểm Loyalty.
- [ ] Dashboard tổng hợp từ `daily_branch_summaries` (Doanh thu, Lợi nhuận gộp, Hàng bán chạy, Cảnh báo tồn).
- [ ] **BullMQ Worker (Redis):** Xuất báo cáo Excel dung lượng lớn chạy nền, Chuyển kho liên chi nhánh.

## Phase 5: Offline-First nâng cao, Gói SaaS & Tích hợp (Mở rộng)
- [ ] Hàng đợi đơn hàng Offline trên `IndexedDB` khi rớt mạng hoàn toàn + tự động đồng bộ & giải quyết xung đột khi online.
- [ ] Quản lý gói SaaS (`LITE` / `PRO`, dùng thử 14–30 ngày, giới hạn quota chi nhánh/SKU/nhân viên).
- [ ] API/Webhook đồng bộ tồn kho với sàn TMĐT / Website bán hàng & Export kế toán.
