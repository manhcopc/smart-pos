# Smart-POS — Agent & Engineering Guidelines

## 1. Project Overview
**Smart-POS** là nền tảng **SaaS POS Bán hàng & Quản lý kho đa chi nhánh** dành cho nhiều chủ cửa hàng (Multi-tenant SaaS), xây dựng theo kiến trúc **Mô hình 2 (Monorepo)**:
- `apps/api`: Backend API bằng **NestJS + TypeScript + Prisma + PostgreSQL + Redis + BullMQ + WebSockets/SSE**
- `apps/web`: Frontend Web POS & Dashboard quản trị bằng **Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui + TanStack Query + IndexedDB (Offline Cache)**
- `packages/shared`: Chia sẻ Zod schemas, TypeScript types, permissions, error codes và hằng số nghiệp vụ giữa `api` và `web`.

## 2. Non-Negotiable Architecture Rules
1. **Multi-Tenant Isolation (Bắt buộc mọi bảng nghiệp vụ):**
   - Mọi bảng dữ liệu thuộc cửa hàng đều phải có cột `tenantId` (`NOT NULL`) và đánh composite index với `tenantId` đứng đầu (ví dụ `(tenantId, branchId, createdAt)`).
   - Bảo vệ 2 lớp: Tenant-scoped Prisma/Context ở `apps/api` (trích xuất từ session/JWT đã xác thực, **không bao giờ** tin `tenantId` từ body/query client gửi lên nếu chưa verify membership) + PostgreSQL Row-Level Security (RLS) với `SET LOCAL app.current_tenant_id`.
2. **Inventory Ledger & Concurrency Safety (Chống âm kho & sai số):**
   - Không cập nhật trực tiếp `stock` mà không ghi lịch sử. Mọi thay đổi tồn kho phải đi kèm bản ghi bất biến trong `InventoryLedger` (Thẻ kho).
   - Giao dịch thanh toán POS / trừ kho / hoàn hàng / nhập hàng phải chạy trong PostgreSQL transaction (`RepeatableRead` khi cần) và dùng guard nguyên tử (`WHERE quantity >= soldQty`) để chặn âm kho, double-checkout (`idempotencyKey`), và hoàn trả vượt số lượng đã bán.
   - Giữ DB transaction thật ngắn: tuyệt đối không gọi API bên thứ 3 hoặc tạo file PDF/Excel bên trong DB transaction.
3. **RBAC & Audit Trail:**
   - Mọi hành động nhạy cảm (sửa giá tại quầy, hủy hóa đơn, hoàn tiền, điều chỉnh kiểm kho, mở két tiền ngoài giao dịch) phải kiểm tra quyền bằng NestJS Guard và ghi nhận bất biến vào `AuditLog`.
4. **Offline Resilience & POS Client Performance:**
   - Màn hình POS tìm kiếm hàng hóa/barcode từ cache local (`IndexedDB`) trên trình duyệt, đồng bộ delta với `apps/api`, và gắn `idempotencyKey` (UUID v4) cho mọi hóa đơn gửi từ client.
   - Đảm bảo giao diện nhẹ, chạy mượt trên máy cấu hình tối thiểu 4 GB RAM.
5. **Media & Storage:**
   - Không lưu ảnh Base64 trong PostgreSQL. Ảnh sản phẩm nén WebP và upload qua Presigned URL lên Object Storage (Cloudflare R2 / S3).

## 3. Coding Conventions
- Sử dụng `pnpm` workspace + `Turborepo`.
- Validate toàn bộ DTO/payload bằng **Zod** từ `packages/shared`.
- Tiền tệ lưu bằng số nguyên (`BIGINT` hoặc `DECIMAL(15,2)` — khuyến nghị `DECIMAL(15,2)` hoặc đơn vị nhỏ nhất tùy chuẩn tiền tệ, thống nhất toàn hệ thống và không dùng float `number` thuần khi cộng trừ tiền nếu có phần thập phân).
- Viết unit test bằng **Vitest** cho toàn bộ logic tính giá, chiết khấu, VAT, giá vốn bình quân gia quyền, trừ kho và hoàn trả.
