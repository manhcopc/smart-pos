# Software Requirements Specification (SRS) — Smart-POS

> Tài liệu đặc tả yêu cầu cho nền tảng **Smart-POS** (SaaS bán hàng & quản lý kho đa chi nhánh cho nhiều chủ cửa hàng), tổng hợp và chuẩn hóa từ các tài liệu SRS ngành POS (The CFO Club, Shopify POS, PosSystems, POS_Connect, BinaryPOS) cùng các mẫu kiến trúc mã nguồn mở thực chiến (`retail-smart-erp`, `Vertex-POS`, `Tatlatat/pos-system`).

---

## 1. Mục tiêu & Phạm vi sản phẩm
- **Mô hình kinh doanh:** Multi-tenant SaaS — nhiều chủ cửa hàng (`Tenant`) tự đăng ký tài khoản, khởi tạo gian hàng riêng và quản lý 1 hoặc nhiều chi nhánh (`Branch`) trên cùng hạ tầng đám mây.
- **Hai không gian vận hành tách biệt theo vai trò** (theo chuẩn `PosSystems/SRS.md`):
  1. **Management Area (Khu quản trị):** Dành cho Chủ shop, Quản lý chi nhánh, Thủ kho, Kế toán (danh mục hàng hóa, nhập/kiểm/chuyển kho, nhà cung cấp, khách hàng, nhân viên, báo cáo tài chính & cấu hình).
  2. **POS / Cash Area (Khu thu ngân):** Dành cho Thu ngân tại quầy — tối giản số thao tác click, hỗ trợ quét mã vạch, nút bấm nhanh (Quick-keys), nhiều hóa đơn chờ, thanh toán nhanh và đối soát ca làm việc.

---

## 2. Yêu cầu Chức năng (Functional Requirements theo Priority)

### Priority 1 — Lõi SaaS, Kho & Bán hàng (MVP Core)

#### FR-1.1: Đăng ký Shop (Tenant Onboarding) & Phân quyền (RBAC)
- Chủ shop đăng ký tài khoản mới -> hệ thống tự tạo `Tenant`, `Branch` mặc định, các vai trò mặc định (`OWNER`, `MANAGER`, `CASHIER`, `WAREHOUSE`) trong 1 database transaction.
- Đăng nhập hỗ trợ 2 cơ chế:
  - Chủ shop / Quản lý: Email + Mật khẩu (có thể bật 2FA/MFA ở Priority 2).
  - Thu ngân tại quầy dùng chung: Mã gian hàng (`tenantSlug`) + Mã nhân viên / PIN để đổi ca nhanh.
- Điều hướng thông minh sau đăng nhập: Thu ngân vào thẳng màn hình **POS Area**; Chủ shop/Quản lý vào **Management Area** (có nút chuyển qua lại nếu được cấp quyền).

#### FR-1.2: Quản lý Hàng hóa & Mã vạch (Product Catalog)
- Phân loại theo Nhóm hàng (`Category`), Thương hiệu, Thuộc tính biến thể (Màu sắc, Kích thước -> `ProductVariant`).
- Mỗi biến thể có `SKU` duy nhất trong `Tenant`, `barcode` (EAN-13/UPC/Code128), `costPrice` (giá vốn), `salePrice` (giá bán lẻ), `unit` (đơn vị tính), `minStockAlert` (ngưỡng tồn tối thiểu).
- Import/Export danh mục hàng hóa bằng Excel/CSV theo template chuẩn.

#### FR-1.3: Quản lý Kho Thời gian thực & Thẻ kho (Inventory Management)
- Tồn kho tách theo từng chi nhánh (`BranchInventory`: `onHand`, `reserved`, `available`).
- **Thẻ kho bất biến (`InventoryLedger`):** Mọi biến động (+ nhập hàng, - bán hàng, +/- kiểm kho, -/+ chuyển kho, + khách trả hàng) đều phải ghi 1 dòng lịch sử kèm `beforeQty`, `changeQty`, `afterQty`, `referenceType`, `referenceId`, `actorId`.
- **Phiếu Nhập hàng NCC (`PurchaseOrder` / `GoodsReceipt`):** Nhập hàng vào chi nhánh, cập nhật tồn kho và tự động tính lại **Giá vốn bình quân gia quyền (AVCO)** (hỗ trợ mở rộng FIFO ở Phase sau).
- **Phiếu Kiểm kho (`StockCount`):** Đối chiếu tồn sổ sách vs tồn thực tế, ghi nhận lý do chênh lệch (hao hụt, hư hỏng, thất thoát) và cân bằng kho.
- Cảnh báo hàng dưới định mức tối thiểu (`onHand <= minStockAlert`).

#### FR-1.4: Quản lý Ca Thu ngân & Quy trình Bán hàng POS
- **Mở ca (`RegisterShift Open`):** Thu ngân nhập số tiền mặt đầu ca (tiền lẻ trong két).
- **Màn hình Bán hàng POS:**
  - Tìm kiếm tức thì (< 50ms) từ cache local (`IndexedDB`) theo tên, SKU hoặc quét mã vạch (máy quét USB/Bluetooth HID tự động điền và bấm Enter).
  - Nút **Quick-keys** cho sản phẩm bán chạy / theo nhóm hàng.
  - Hỗ trợ mở nhiều tab hóa đơn chờ song song.
  - Chiết khấu theo dòng hàng hoặc tổng hóa đơn (% hoặc số tiền cố định).
  - **Thanh toán kết hợp (Split Payments):** Tiền mặt + Chuyển khoản/VietQR + Thẻ/Ví trong cùng 1 hóa đơn; tự tính tiền thừa trả khách.
  - **Idempotency Key:** Mỗi hóa đơn gửi từ client POS mang 1 UUID duy nhất để mạng chập chờn bấm gửi lại không bao giờ bị trừ kho 2 lần.
- **In hóa đơn nhiệt:** Hỗ trợ template in khổ K58 / K80 trực tiếp qua trình duyệt (`@media print`) hoặc máy in LAN.
- **Đóng ca (`RegisterShift Close` / Z-Report):** Hệ thống tổng hợp doanh số theo từng phương thức thanh toán, tiền mặt lý thuyết trong két vs tiền mặt thực đếm -> ghi nhận chênh lệch ca.

#### FR-1.5: Báo cáo Vận hành Cơ bản
- Dashboard theo ngày/tuần/tháng/chi nhánh: Doanh thu thuần, Giá vốn, **Lợi nhuận gộp**, Số đơn, Giá trị đơn trung bình.
- Top hàng bán chạy / bán chậm, Báo cáo tồn kho & giá trị tồn kho, Lịch sử chốt ca thu ngân.

---

### Priority 2 — Kiểm soát Nội bộ, CRM & Đa chi nhánh Nâng cao

- **FR-2.1: Hoàn trả / Đổi hàng (`SalesReturn`):** Cho phép trả một phần hoặc toàn phần theo hóa đơn gốc; có kiểm soát cộng dồn chống hoàn vượt quá số lượng đã mua (`cumulative returned <= purchased`).
- **FR-2.2: Duyệt thao tác nhạy cảm & Audit Trail:** Cấu hình yêu cầu mã PIN Quản lý khi giảm giá vượt ngưỡng, sửa giá trực tiếp tại quầy, hủy hóa đơn đã thanh toán, hoặc mở két tiền không gắn hóa đơn; ghi nhật ký bất biến vào `AuditLog`.
- **FR-2.3: Chuyển kho giữa các chi nhánh (`StockTransfer`):** Xuất kho chi nhánh A -> Trạng thái đang vận chuyển (`IN_TRANSIT`) -> Nhập kho chi nhánh B.
- **FR-2.4: Tự động gợi ý đặt hàng (Automated Reordering):** Dựa trên `minStockAlert` và tốc độ bán trung bình 7–30 ngày để gợi ý phiếu nhập NCC.
- **FR-2.5: CRM & Khách hàng thân thiết (Loyalty):** Hồ sơ khách hàng, công nợ, lịch sử mua hàng, tích điểm theo % hóa đơn & tiêu điểm khi thanh toán (bảo vệ race condition khi trừ điểm).
- **FR-2.6: Chấm công & KPI nhân viên:** Ghi nhận `clock-in / clock-out`, doanh số theo nhân viên bán hàng.

---

### Priority 3 — SaaS Billing, Offline Nâng cao & Tích hợp Đa kênh

- **FR-3.1: Quản lý Gói cước SaaS (`POS Lite` / `POS Pro`):** Dùng thử 14–30 ngày, giới hạn số chi nhánh, số nhân viên, số SKU và dung lượng ảnh theo từng gói; gia hạn tự động qua cổng thanh toán.
- **FR-3.2: Offline-First Store-and-Forward:** Cho phép lập và lưu đơn hàng tiền mặt trong hàng đợi `IndexedDB` khi mất kết nối Internet hoàn toàn, tự đồng bộ & đối soát tồn kho khi có mạng lại (đánh dấu cảnh báo xung đột nếu hàng đã hết khi sync).
- **FR-3.3: Tích hợp & API Mở (Omnichannel / `POS_Connect`):** Webhook/API đồng bộ tồn kho & đơn hàng 2 chiều với website bán hàng, sàn TMĐT và xuất sổ sách cho phần mềm kế toán.

---

## 3. Yêu cầu Phi chức năng (Non-Functional Requirements)

### NFR-1: Hiệu năng & Khả năng chịu tải
- Thao tác tìm kiếm/quét mã vạch trên màn hình POS phản hồi **< 100ms** (nhờ cache IndexedDB cục bộ).
- Màn hình thanh toán hoàn tất giao dịch trong **< 2 giây** ở điều kiện tải bình thường (1.000+ shop).
- Chạy mượt trên thiết bị quầy tối thiểu **CPU Core i3/i5, RAM 4 GB**, trình duyệt HTML5 hiện đại (Chrome, Edge, Safari, Firefox trên Windows/macOS/Android/iOS) theo chuẩn tham khảo `BinaryPOS`.

### NFR-2: Tính toàn vẹn dữ liệu & Concurrency Safety
- Giao dịch thanh toán, nhập/xuất/hoàn trả sử dụng PostgreSQL Transaction (`REPEATABLE READ`) và điều kiện nguyên tử `WHERE on_hand >= qty` để tuyệt đối không âm kho khi nhiều thu ngân bán cùng lúc.
- Không gọi API bên thứ 3 hoặc xử lý xuất file nặng bên trong DB transaction; đẩy tác vụ nặng sang **BullMQ (Redis)**.

### NFR-3: Bảo mật & Cô lập Đa cửa hàng (Security & Multi-Tenancy)
- Cô lập dữ liệu chặt giữa các Tenant bằng `tenant_id` trên mọi bảng nghiệp vụ + PostgreSQL **Row-Level Security (RLS)** + Guard ở NestJS.
- Mã hóa mật khẩu bằng Argon2/bcrypt, truyền tải TLS/HTTPS, hỗ trợ 2FA cho tài khoản Chủ shop.
- **PCI-DSS Scope Reduction:** Không lưu số thẻ tín dụng/CVV; thanh toán thẻ/QR thực hiện qua cổng thanh toán / thiết bị rời / VietQR Webhook với tokenization.

### NFR-4: Khả năng mở rộng & Lưu trữ
- Ảnh sản phẩm nén WebP ở client trước khi upload lên Object Storage (Cloudflare R2 / S3), không lưu ảnh trong PostgreSQL.
- Các bảng lịch sử lớn (`invoices`, `inventory_ledger`) sử dụng composite index `(tenant_id, ...)` và bảng tổng hợp `daily_branch_summary` để báo cáo chạy nhanh ngay cả khi dữ liệu đạt hàng triệu dòng.
