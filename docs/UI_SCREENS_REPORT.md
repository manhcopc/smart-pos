# Báo cáo Kiến trúc Màn hình, Design System, RBAC & Component Map — Smart-POS

Tài liệu tra cứu toàn diện cho **17 màn hình** (`apps/web`), gồm **Design Tokens**, **quy chuẩn Responsive & thiết bị quầy**, **luồng User Flow**, **ma trận phân quyền RBAC đồng bộ (Frontend vs Backend)**, **bản đồ chi tiết toàn bộ Dialog/Tab/Sub-view nội tuyến** và **Ma trận Trạng thái (State Matrix)**.

---

## 1. Kiến trúc Design System & Nền tảng Giao diện

### 1.1. Design Tokens ([globals.css](../apps/web/src/app/globals.css))

Hệ thống sử dụng **Tailwind CSS v4** (`@import "tailwindcss";`, `tw-animate-css`, `shadcn/tailwind.css`) cấu hình phong cách `base-nova`, bộ icon `lucide-react`, base color `neutral` ([components.json](../apps/web/components.json)).

| Nhóm Token | Biến CSS chính trong code | Giá trị / Ghi chú thực tế |
| --- | --- | --- |
| **Màu nền & Chữ (`:root`)** | `--background`, `--foreground`, `--card`, `--popover` | Light mặc định dùng không gian màu **OKLCH**: `--background: oklch(0.992 0.003 247.8)`, `--card: oklch(1 0 0)`, `--foreground: oklch(0.18 0.025 256.8)`, `--muted-foreground: oklch(0.47 0.024 256.8)` |
| **Màu nhấn & Ngữ nghĩa (`:root`)** | `--primary`, `--destructive`, `--success`, `--warning`, `--border`, `--ring` | • **Trust Blue (`--primary`):** `oklch(0.546 0.215 262.88)`<br>• `--destructive: oklch(0.577 0.245 27.325)`<br>• `--success: oklch(0.56 0.165 151)`<br>• `--warning: oklch(0.73 0.165 74)`<br>• `--border` & `--input: oklch(0.905 0.012 247.8)` |
| **Bảng màu Sidebar & Biểu đồ** | `--sidebar*`, `--chart-1..5` | `--sidebar: oklch(0.982 0.006 247.8)`, `--sidebar-primary: oklch(0.546 0.215 262.88)`; 5 màu tương phản rõ cho Recharts (`--chart-1` xanh dương, `--chart-2` xanh lục, `--chart-3` vàng hổ phách, `--chart-4` tím, `--chart-5` đỏ cam) |
| **Dark Mode (`.dark`)** | `@custom-variant dark (&:where(.dark, .dark *));` | Khai báo đầy đủ bảng `.dark` (`--background: oklch(0.145 0.018 256.8)`, `--card: oklch(0.195 0.02 256.8)`, `--primary: oklch(0.635 0.205 259.5)`, `--sidebar-primary` đồng bộ). Đã kích hoạt hoàn chỉnh qua [theme-provider.tsx](../apps/web/src/components/theme/theme-provider.tsx) + [theme-toggle.tsx](../apps/web/src/components/theme/theme-toggle.tsx) gắn ở header Auth, Sidebar Dashboard và header POS |
| **Typography** | `--font-sans`, `--font-heading`, `--font-mono` | `--font-sans` & `--font-heading`: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`<br>`--font-mono`: `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` *(dùng kèm `tabular-nums` cho SKU, mã hóa đơn, số tiền `₫` và bill nhiệt)* |
| **Spacing & Bo góc (`--radius`)** | `--radius: 0.625rem` | Scale dẫn xuất: `--radius-sm` (`- 4px`), `--radius-md` (`- 2px`), `--radius-lg` (`0.625rem`), `--radius-xl` (`+ 4px`), `--radius-2xl` (`* 1.8`), `--radius-3xl` (`* 2.2`), `--radius-4xl` (`* 2.6`) |
| **Kích thước Nút & Touch Target** | [button.tsx](../apps/web/src/components/ui/button.tsx), [input.tsx](../apps/web/src/components/ui/input.tsx) | • Standard: `xs` (`h-6`), `sm` (`h-7`), `default` (`h-8`), `lg` (`h-9`), `icon` (`size-8`), `icon-sm` (`size-7`), `icon-lg` (`size-9`)<br>• **Counter Touch (`>= 44px`):** `touch` (`h-11` = 44px) & `icon-touch` (`size-11` = 44×44px) phục vụ màn hình cảm ứng POS |
| **Z-Index & Accessibility** | `@layer base`, `@media (prefers-reduced-motion: reduce)` | • Ép `cursor-pointer` cho `button:not(:disabled)`, `[role="button"]`, `a[href]`<br>• Tôn trọng `prefers-reduced-motion: reduce`<br>• `DataModeSwitcher` đặt tại `fixed left-3 bottom-3 z-50` ([data-mode-switcher.tsx](../apps/web/src/components/dev/data-mode-switcher.tsx)) để không che nút Thanh toán (`F9`) góc dưới-phải của POS |
| **In nhiệt (`@media print`)** | `@page { margin: 0; }`, `.pos-printable-receipt`, `.pos-no-print` | Đặt `html, body { height: auto !important; overflow: visible !important; }`, ẩn toàn DOM bằng `body * { visibility: hidden; }`; giữ vùng `.pos-printable-receipt` góc trên-trái (`padding: 4mm`, nền trắng chữ đen) và ẩn toàn bộ phần tử `.pos-no-print` |

### 1.2. Shell, Primitives & Component Dùng chung

| Thành phần | Tệp nguồn | Vai trò chính |
| --- | --- | --- |
| **Root Shell, Theme & Toast** | [app/layout.tsx](../apps/web/src/app/layout.tsx), [theme-provider.tsx](../apps/web/src/components/theme/theme-provider.tsx), [theme-toggle.tsx](../apps/web/src/components/theme/theme-toggle.tsx) | `<html lang="vi" suppressHydrationWarning>`, title template `%s \| Smart-POS`, `<ThemeProvider>`, `<QueryProvider>`, `<DataModeSwitcher />`, `<Toaster richColors position="top-right" />` |
| **Dashboard Shell & Responsive Drawer** | [(dashboard)/layout.tsx](../apps/web/src/app/(dashboard)/layout.tsx) | Khung quản trị chung cho 13 màn hình `/dashboard*`, Desktop Sidebar `260px` + Mobile/Tablet Sticky Header kèm `Sheet` drawer (`< md`), lọc `NAV_ITEMS` theo `requiredAnyPermissions`, Skeleton session loader, nút mở `/pos`, `ThemeToggle` & đăng xuất có `try/catch` + `toast` |
| **20 UI Primitives (`shadcn/ui` `base-nova`)** | `apps/web/src/components/ui/` | [alert.tsx](../apps/web/src/components/ui/alert.tsx), [alert-dialog.tsx](../apps/web/src/components/ui/alert-dialog.tsx), [badge.tsx](../apps/web/src/components/ui/badge.tsx), [button.tsx](../apps/web/src/components/ui/button.tsx), [card.tsx](../apps/web/src/components/ui/card.tsx), [chart.tsx](../apps/web/src/components/ui/chart.tsx), [checkbox.tsx](../apps/web/src/components/ui/checkbox.tsx), [dialog.tsx](../apps/web/src/components/ui/dialog.tsx), [empty.tsx](../apps/web/src/components/ui/empty.tsx), [field.tsx](../apps/web/src/components/ui/field.tsx), [input.tsx](../apps/web/src/components/ui/input.tsx), [label.tsx](../apps/web/src/components/ui/label.tsx), [select.tsx](../apps/web/src/components/ui/select.tsx), [separator.tsx](../apps/web/src/components/ui/separator.tsx), [sheet.tsx](../apps/web/src/components/ui/sheet.tsx), [skeleton.tsx](../apps/web/src/components/ui/skeleton.tsx), [sonner.tsx](../apps/web/src/components/ui/sonner.tsx), [switch.tsx](../apps/web/src/components/ui/switch.tsx), [table.tsx](../apps/web/src/components/ui/table.tsx), [tabs.tsx](../apps/web/src/components/ui/tabs.tsx) |
| **3 Shared UX Components** | `apps/web/src/components/shared/` | • [confirm-dialog.tsx](../apps/web/src/components/shared/confirm-dialog.tsx): Xác nhận `AlertDialog` trước thao tác phá hủy<br>• [data-pagination.tsx](../apps/web/src/components/shared/data-pagination.tsx): Phân trang thống nhất (`Trang X / Y`, Trước/Sau)<br>• [page-states.tsx](../apps/web/src/components/shared/page-states.tsx): `CardGridSkeleton`, `TableRowsSkeleton`, `QueryErrorAlert` (kèm nút **Thử lại**) |
| **HTTP Client & Mock Router** | [api-client.ts](../apps/web/src/lib/api-client.ts), [query-provider.tsx](../apps/web/src/providers/query-provider.tsx) | `apiFetch`, `apiFetchForm`, `apiDownloadFile`, auto refresh token, `formatApiError`; tự chuyển sang [mock-router.ts](../apps/web/src/lib/mock-data/mock-router.ts) khi bật Mock Mode |
| **Từ điển Nhãn & Tiền tệ** | [labels.ts](../apps/web/src/lib/labels.ts) | `formatVndAmount`, `ROLE_LABELS`, `PERMISSION_LABELS`, `BUSINESS_TYPE_LABELS`, `PAYMENT_METHOD_LABELS`, `AUDIT_ACTION_LABELS`, `PO_STATUS_LABELS`, `STOCK_COUNT_STATUS_LABELS`, `STOCK_TRANSFER_STATUS_LABELS`, `BILLING_STATUS_LABELS`, `WEBHOOK_DELIVERY_STATUS_LABELS`, `slugifyShopName` |

---

## 2. Quy chuẩn Responsive & Thiết bị Quầy

Dựa trên các breakpoint Tailwind (`sm: >= 640px`, `md: >= 768px`, `lg: >= 1024px`, `xl: >= 1280px`):

| Thiết bị mục tiêu | Màn hình Management (`/dashboard*`) | Màn hình Quầy POS (`/pos`) | Chuẩn UX & Thao tác thực tế |
| --- | --- | --- | --- |
| **Desktop (`1440px` / `>= 1024px`)** | Khung `md:grid-cols-[260px_1fr]`: Sidebar cố định `260px`, nội dung chính giãn linh hoạt; KPI 4 cột (`lg:grid-cols-4`), gói SaaS 3 cột (`lg:grid-cols-3`), KH Master-Detail `lg:grid-cols-[1.2fr_1fr]` | Khung viewport cố định `lg:h-screen lg:overflow-hidden` với 3 cột `lg:grid-cols-[1.15fr_1fr_390px]`:<br>1. `PosCatalogGrid` (`xl:grid-cols-3` ở `>= 1280px`) cuộn độc lập<br>2. `PosCartPanel` cuộn độc lập<br>3. `PosPaymentPanel` (`390px`) ghim nút Thanh toán (`F9`) dưới đáy | Tối ưu cho màn hình quầy PC + máy quét barcode (`F2`, `F9`), vừa xem danh mục/ảnh SKU, vừa thao tác giỏ hàng & thu tiền không cần cuộn trang tổng |
| **POS Tablet (`768px–1023px`)** | Sidebar `260px` hiển thị bên trái (`md:grid-cols-[260px_1fr]`); biểu đồ Recharts dùng `ChartContainer` co giãn tự động; các form xếp 2 cột (`sm:grid-cols-2`) | Ở `< 1024px`, 3 vùng POS tự xếp chồng dọc (`flex-col`), lưới SKU `sm:grid-cols-2`, header `flex-wrap` | Sử dụng button chuẩn chạm tay **`size="touch"` (`h-11`) & `size="icon-touch"` (`size-11` = 44×44px)** cho thẻ SKU, nút `+ / −`, `Đủ tiền`, Quick-cash, và nút `Thanh toán (F9)` |
| **Mobile (`375px` / `< 640px`)** | Sticky Topbar + nút mở **`Sheet` Navigation Drawer** từ cạnh trái (`md:hidden`), lưới KPI rớt về 1 cột | Xếp chồng dọc 1 cột (Header → Quick-keys → Giỏ hàng → Thanh toán / Mở ca) | Toàn bộ bảng dữ liệu dùng component shadcn `<Table>` (đã bọc sẵn `overflow-x-auto`). Các Dialog dùng `max-h-[90vh] overflow-y-auto` |

---

## 3. Hệ thống User Flow & Entry / Exit

### 3.1. Luồng Onboarding, Đăng nhập & Điều hướng theo Role
1. **Trang chủ [`/`](../apps/web/src/app/page.tsx):** Kiểm tra `GET /health/live`, cung cấp 3 thẻ điều hướng tới `/pos`, `/dashboard`, `/login`, `/register` cùng `ThemeToggle`.
2. **Đăng ký Tenant mới [`/register`](../apps/web/src/app/(auth)/register/page.tsx):** Nhập tên cửa hàng (`tenantSlug` tự sinh bởi `slugifyShopName`), ngành hàng (`BUSINESS_TYPE_LABELS`), thông tin Owner & chi nhánh đầu tiên (hiển thị badge `Dùng thử 14 ngày miễn phí` kèm giải thích link đăng nhập dễ hiểu). Submit thành công -> `router.replace(session.redirectTo)` vào `/dashboard`.
3. **Đăng nhập [`/login`](../apps/web/src/app/(auth)/login/page.tsx):**
   - Tab **Chủ shop / Quản lý** (`value="owner"`): Email + Mật khẩu *(có nút bật/tắt ẩn hiện mật khẩu `aria-label`)*.
   - Tab **Thu ngân (PIN)** (`value="cashier"`): `tenantSlug` + Mã nhân viên + PIN 4–8 số *(có nút ẩn/hiện PIN + bàn phím số chạm tay `0–9` tùy chọn cho tablet quầy)*.
4. **Bảo vệ Entry / Exit giữa 2 khu vực:**
   - Vào `/dashboard*`: [(dashboard)/layout.tsx](../apps/web/src/app/(dashboard)/layout.tsx) gọi `useMe()`; khi tải hiển thị `Skeleton` Sidebar + Card; lỗi chưa xác thực -> `router.replace("/login")`; nếu `profile.redirectTo === "/pos"` (`CASHIER`) -> ép `router.replace("/pos")`.
   - Vào `/pos`: Nếu chưa xác thực -> Card `Yêu cầu đăng nhập POS` dẫn về `/login`. Nếu `member.role === "CASHIER"`, nút **Quản trị** (`/dashboard`) bị ẩn. Bấm **Đổi ca** thực hiện `logoutMutation` (có `try/catch` + `toast.error`) và chuyển về `/login`.

### 3.2. Luồng Vận hành POS & Supervisor PIN Approval
1. **Mở ca Thu ngân:** Nếu chi nhánh chưa có ca mở (`!currentShift && currentShiftQuery.isFetched`), `PosPaymentPanel` hiển thị form **Mở ca Thu ngân** nhập tiền mặt đầu ca.
2. **Bán hàng đa tab, Quick-Select & Phím tắt:**
   - Tối đa **6 tab hóa đơn chờ** song song (`tabs.length < 6`); khi đóng tab **đang có hàng trong giỏ**, hệ thống bật **`ConfirmDialog`** xác nhận tránh mất đơn do bấm nhầm.
   - `F2` focus ô quét mã/tìm SKU; `F9` kích hoạt thanh toán.
   - `PosCatalogGrid` hỗ trợ lọc theo Nhóm hàng, hiển thị ảnh sản phẩm WebP (fallback icon khi chưa có ảnh), và nút **Xem thêm SKU** khi vượt ngưỡng hiển thị ban đầu (48 SKU/lượt).
3. **Thanh toán tách dòng (Split Payment) & VietQR:**
   - Ô tiền mặt mặc định hiển thị gọn (`"0"` hoặc số nguyên sạch không dư `.00`).
   - Nút **Thêm phương thức** tự động điền **phần tiền còn thiếu (`remainingDue`)** vào dòng mới.
   - Hỗ trợ nút xem trước mã **QR** thanh toán ngay trong dialog khi chọn `BANK_TRANSFER_QR`.
   - Khi chọn In/Xem lại hóa đơn từ `InvoiceActionsDialog`, đóng modal thao tác trước khi mở `ThermalReceiptDialog` tránh chồng lớp focus.
4. **Phê duyệt PIN Quản lý ([supervisor-pin-dialog.tsx](../apps/web/src/components/pos/supervisor-pin-dialog.tsx)):**
   - Có bàn phím số chạm tay + input ẩn/hiện cho phép Manager/Owner nhập PIN phê duyệt tại quầy cho `pos:price_override`, `pos:discount_override`, hoặc `pos:refund`.
5. **Đóng ca & In Z-Report ([shift-z-report-dialog.tsx](../apps/web/src/components/pos/shift-z-report-dialog.tsx)):**
   - Hiển thị `Skeleton` lúc tải báo cáo, `QueryErrorAlert` + **Thử lại** khi lỗi mạng, đối soát tiền mặt cuối ca, chốt ca & in báo cáo (`window.print()`).

### 3.3. Luồng POS Offline Store-and-Forward & Giải quyết Xung đột
1. **Cache danh mục IndexedDB & SSE:** [pos-indexeddb.ts](../apps/web/src/lib/pos-indexeddb.ts) lưu cache hàng hóa chi nhánh phục vụ tìm kiếm local. `PosHeader` hiển thị badge trạng thái: `Realtime Kho`, `Cache Cục bộ`, hoặc `Đang Offline`, kèm công tắc `Giả lập Offline` / `Bật Online`.
2. **Thanh toán khi Offline:** Kích hoạt khi `!isEffectivelyOnline` hoặc lỗi mạng, **chặn `LOYALTY_POINTS` khi Offline**, lưu IndexedDB queue ([pos-offline-queue.ts](../apps/web/src/lib/pos-offline-queue.ts)), trừ tồn cục bộ tức thời, cấp mã tạm `OFFLINE-...` và mở `ThermalReceiptDialog`.
3. **Đồng bộ tự động & Giải quyết xung đột ([offline-queue-dialog.tsx](../apps/web/src/components/pos/offline-queue-dialog.tsx)):**
   - Tự sync các đơn `PENDING` khi có mạng trở lại.
   - Cho phép **"Khớp tồn kho & Gửi lại"**, **"Chuyển sang ca đang mở & Gửi lại"**, **"Thử đồng bộ"**, hoặc **"Hủy đơn hàng đợi"** *(có `ConfirmDialog` xác nhận trước khi xóa vĩnh viễn khỏi IndexedDB)*.

---

## 4. Ma trận Phân quyền RBAC Đồng bộ (Frontend vs Backend)

Phân quyền của hệ thống gồm **3 lớp khớp nhau 100%**: (1) Lọc menu Sidebar qua `requiredAnyPermissions` ở [(dashboard)/layout.tsx](../apps/web/src/app/(dashboard)/layout.tsx), (2) Guard UI & thông báo chế độ chỉ xem bên trong từng `page.tsx`, và (3) Guard API `@RequirePermissions(...)` ở `apps/api/src/*/*.controller.ts` theo [permissions.ts](../packages/shared/src/permissions.ts).

| Route | Lớp 1: Sidebar / Route Guard | Lớp 2: Kiểm tra UI trong `page.tsx` | Lớp 3: Backend Controller `@RequirePermissions` | Role mặc định (theo `ROLE_PERMISSIONS`) |
| --- | --- | --- | --- | --- |
| `/`, `/login`, `/register` | Công khai | Không | Công khai | Tất cả |
| `/pos` | Yêu cầu session hợp lệ; nút **Quản trị** ẩn nếu `role === "CASHIER"` | Check `POS_DISCOUNT_OVERRIDE`, `POS_PRICE_OVERRIDE`, `POS_REFUND` (mượn qua `SupervisorPinDialog` nếu thiếu) | `POS_SELL`, `POS_SHIFT_MANAGE`, `POS_DISCOUNT_OVERRIDE` / `POS_PRICE_OVERRIDE` / `POS_REFUND` | `OWNER`, `MANAGER`, `CASHIER` |
| `/dashboard` | Chặn `CASHIER` (`redirectTo === "/pos"`) | Ẩn/hiện block theo `REPORT_FINANCIAL`, `INVENTORY_VIEW`, `INVENTORY_RECEIVE`, `BRANCH_MANAGE`, `STAFF_MANAGE`; link cảnh báo tồn thấp dẫn sang `/dashboard/inventory?lowStock=true` | `REPORT_FINANCIAL` / `INVENTORY_VIEW` | `OWNER`, `MANAGER`, `WAREHOUSE` |
| `/dashboard/products` | `inventory:view` | `canManage = CATALOG_MANAGE` (ẩn Thêm, Chỉnh sửa, Nhóm hàng, Import, Mở/Ngưng bán) | Xem: `INVENTORY_VIEW`; Ghi: `CATALOG_MANAGE` | `OWNER`, `MANAGER`, `WAREHOUSE` |
| `/dashboard/inventory` | `inventory:view` | Đọc param `?lowStock=true` tự động bật bộ lọc tồn dưới định mức | `INVENTORY_VIEW` | `OWNER`, `MANAGER`, `WAREHOUSE` |
| `/dashboard/purchase-orders` | `inventory:receive` | `canReceive = INVENTORY_RECEIVE` (ẩn tạo NCC/PO & Hoàn tất/Hủy) | Xem: `INVENTORY_VIEW`; Ghi: `INVENTORY_RECEIVE` | `OWNER`, `MANAGER`, `WAREHOUSE` |
| `/dashboard/stock-counts` | `inventory:count` | `canCount = INVENTORY_COUNT` (ẩn Tạo phiếu, Cân bằng kho, Hủy) | Xem: `INVENTORY_VIEW`; Ghi: `INVENTORY_COUNT` | `OWNER`, `MANAGER`, `WAREHOUSE` |
| `/dashboard/transfers` | `inventory:transfer` | `canTransfer = INVENTORY_TRANSFER` *(ẩn Tạo/Nhận/Hủy + hiện Alert chế độ chỉ xem nếu thiếu quyền)* | Tất cả endpoints: `INVENTORY_TRANSFER` | `OWNER`, `MANAGER`, `WAREHOUSE` |
| `/dashboard/customers` | `customer:view` | `canManageCustomers = CUSTOMER_MANAGE` *(ẩn cả **Thêm khách hàng**, dialog tạo KH và nút **Chỉnh điểm**)* | Xem: `CUSTOMER_VIEW`; Tạo & Chỉnh điểm: `CUSTOMER_MANAGE` | `OWNER`, `MANAGER` |
| `/dashboard/reports` | `report:financial` | Hiển thị theo quyền tài chính | Tất cả endpoints: `REPORT_FINANCIAL` | `OWNER`, `MANAGER` |
| `/dashboard/audit-logs` | `audit:view` | Chỉ xem (bất biến) | `AUDIT_VIEW` | `OWNER`, `MANAGER` |
| `/dashboard/branches` | `branch:manage` | `canManage = BRANCH_MANAGE` (ẩn Thêm/Sửa & hiện Alert chỉ xem) | `BRANCH_MANAGE` | `OWNER` |
| `/dashboard/staff` | `staff:manage` | `canEditMember = isOwner \|\| member.role !== "OWNER"` | `STAFF_MANAGE` | `OWNER`, `MANAGER` |
| `/dashboard/integrations` | `integration:manage` **HOẶC** `report:financial` | Check độc lập `integration:manage` (Tabs API/Webhook) & `report:financial` (Xuất Sổ Kế toán) | API/Webhook: `INTEGRATION_MANAGE`; Accounting Excel: `REPORT_FINANCIAL` | `OWNER`, `MANAGER` |
| `/dashboard/billing` | `branch:manage` | `canManageBilling = BILLING_MANAGE` khóa nút nâng cấp/gia hạn | Xem: `BRANCH_MANAGE`; Đổi/gia hạn gói: `BILLING_MANAGE` | `OWNER` |

---

## 5. Bản đồ Chi tiết 17 Màn hình & Toàn bộ Dialog / Tab / Module Nội tuyến

### 5.1. Nhóm Công khai & Xác thực (3 màn hình)

| Route | Màn hình | Tệp UI chính | Tabs / Sub-views / Modals nội tuyến | Hooks & Libs liên quan |
| --- | --- | --- | --- | --- |
| `/` | Trang chủ & Kiểm tra kết nối API | [app/page.tsx](../apps/web/src/app/page.tsx) | • Badge trạng thái `GET /health/live`<br>• `ThemeToggle` & 3 Card điều hướng (`/pos`, `/dashboard`, `/login`, `/register`) | [api-client.ts](../apps/web/src/lib/api-client.ts), [theme-toggle.tsx](../apps/web/src/components/theme/theme-toggle.tsx) |
| `/register` | Đăng ký Cửa hàng SaaS mới | [(auth)/register/page.tsx](../apps/web/src/app/(auth)/register/page.tsx) | • Form 2 cột (`sm:grid-cols-2`) khởi tạo Tenant + CN01 + Owner<br>• Tự động sinh `tenantSlug`, nút ẩn/hiện mật khẩu & `ThemeToggle` | [use-auth.ts](../apps/web/src/hooks/use-auth.ts) (`useRegisterTenant`), [labels.ts](../apps/web/src/lib/labels.ts) |
| `/login` | Cổng đăng nhập 2 chế độ | [(auth)/login/page.tsx](../apps/web/src/app/(auth)/login/page.tsx) | • 2 Tabs: `Chủ shop / Quản lý` (`owner`) & `Thu ngân (PIN)` (`cashier`)<br>• Nút ẩn/hiện mật khẩu/PIN, bàn phím số PIN chạm tay tùy chọn & `ThemeToggle` | [use-auth.ts](../apps/web/src/hooks/use-auth.ts) (`useOwnerLogin`, `useCashierPinLogin`) |

### 5.2. Nhóm Quầy Thu ngân POS (1 màn hình modularized + 5 Dialog tách file + 2 Dialog nội tuyến)

**Route `/pos`** — Orchestrator: [(pos)/pos/page.tsx](../apps/web/src/app/(pos)/pos/page.tsx)

- **4 Modules UI + Shared Types tại `apps/web/src/components/pos/`:**
  1. [types.ts](../apps/web/src/components/pos/types.ts): Kiểu `CartLineState`, `PaymentLineState`, `PendingInvoiceTab`, `QUICK_CASH_NOTES`, `formatMoneyForInput` (bỏ `.00` dư thừa khi edit VND), `formatQuantityForDisplay`.
  2. [pos-header.tsx](../apps/web/src/components/pos/pos-header.tsx): Selector chi nhánh, trạng thái mạng (`Realtime Kho` / `Cache Cục bộ` / `Đang Offline`), công tắc giả lập Offline, nút **Hàng đợi Offline**, nút **Ca mở / Két**, **Hóa đơn ca**, **Mở két**, `ThemeToggle`, **Quản trị** (ẩn với Cashier) & **Đổi ca**.
  3. [pos-catalog-grid.tsx](../apps/web/src/components/pos/pos-catalog-grid.tsx): Ô tìm/quét barcode (`F2`), nút lọc nhóm hàng (`size="sm"`/`touch`), lưới SKU có **ảnh WebP thumbnail**, giá `tabular-nums`, badge tồn kho khả dụng (`border-warning` khi sắp hết), nút **Xem thêm** quá 48 SKU.
  4. [pos-cart-panel.tsx](../apps/web/src/components/pos/pos-cart-panel.tsx): Tối đa 6 tab hóa đơn chờ, **`ConfirmDialog`** khi đóng tab đang có hàng, nút tăng/giảm số lượng **`size="icon-touch"` (44×44px)**, sửa giá bán / chiết khấu dòng theo quyền hoặc PIN Quản lý.
  5. [pos-payment-panel.tsx](../apps/web/src/components/pos/pos-payment-panel.tsx): Form **Mở ca Thu ngân** khi chưa có ca mở, chọn/đổi điểm khách hàng Loyalty, tính tạm tính/giảm giá/VAT/Khách cần trả, Split Payment thông minh tự điền `remainingDue`, Quick-cash & **Đủ tiền** (`size="touch"`), xem trước **VietQR** dialog, nút **Thanh toán (`F9`)** (`size="touch"`).
- **2 Dialog nội tuyến trong `pos/page.tsx`:** `Thêm nhanh khách hàng` & `Mở két tiền ngoài giao dịch`.
- **5 Dialog tách file tại `apps/web/src/components/pos/`:**
  1. [thermal-receipt-dialog.tsx](../apps/web/src/components/pos/thermal-receipt-dialog.tsx): In nhiệt K58 / K80 (`window.print()`).
  2. [shift-z-report-dialog.tsx](../apps/web/src/components/pos/shift-z-report-dialog.tsx): Đóng ca, đối soát tiền mặt & in Z-Report (có `Skeleton` & `QueryErrorAlert`).
  3. [supervisor-pin-dialog.tsx](../apps/web/src/components/pos/supervisor-pin-dialog.tsx): Phê duyệt PIN Quản lý (kèm bàn phím số chạm tay tùy chọn).
  4. [invoice-actions-dialog.tsx](../apps/web/src/components/pos/invoice-actions-dialog.tsx): Chi tiết hóa đơn, 2 Tabs `Trả hàng / Hoàn tiền` & `Hủy hóa đơn`, nhúng `SupervisorPinDialog` & đóng sạch dialog trước khi mở `ThermalReceiptDialog`.
  5. [offline-queue-dialog.tsx](../apps/web/src/components/pos/offline-queue-dialog.tsx): Hàng đợi Offline & giải quyết xung đột (gắn `ConfirmDialog` trước khi xóa đơn hàng đợi).

### 5.3. Nhóm Quản trị Cửa hàng (13 màn hình dưới [(dashboard)/layout.tsx](../apps/web/src/app/(dashboard)/layout.tsx))

| Route | Màn hình | Tệp UI chính | Toàn bộ Dialog / Modal / Tabs / Sub-views nội tuyến | Hooks & Libs liên quan |
| --- | --- | --- | --- | --- |
| `/dashboard` | Tổng quan Cửa hàng & KPI | [(dashboard)/dashboard/page.tsx](../apps/web/src/app/(dashboard)/dashboard/page.tsx) | Khối KPI 30 ngày (`Skeleton` khi tải, `QueryErrorAlert` khi lỗi), Top SKU & Cảnh báo tồn thấp (`link` sang `/inventory?lowStock=true`), Quick-Action theo quyền | [use-auth.ts](../apps/web/src/hooks/use-auth.ts), [use-catalog.ts](../apps/web/src/hooks/use-catalog.ts), [use-inventory.ts](../apps/web/src/hooks/use-inventory.ts), [use-reports.ts](../apps/web/src/hooks/use-reports.ts) |
| `/dashboard/products` | Hàng hóa, Biến thể, Ảnh WebP & Import/Export | [(dashboard)/dashboard/products/page.tsx](../apps/web/src/app/(dashboard)/dashboard/products/page.tsx), [product-edit-dialog.tsx](../apps/web/src/components/products/product-edit-dialog.tsx) | **4 Dialog + 1 ConfirmDialog:**<br>1. `Thêm sản phẩm mới` (upload ảnh WebP, nhiều biến thể)<br>2. **`ProductEditDialog`** (`PATCH /products/:id` + `PATCH /products/:id/variants/:variantId`, Switch mở/ngưng bán)<br>3. `Quản lý Nhóm hàng` (xóa qua **`ConfirmDialog`**)<br>4. `Import Danh mục Excel / CSV` + `DataPagination` | [use-catalog.ts](../apps/web/src/hooks/use-catalog.ts), [image-webp.ts](../apps/web/src/lib/image-webp.ts), [data-pagination.tsx](../apps/web/src/components/shared/data-pagination.tsx) |
| `/dashboard/inventory` | Tồn kho Chi nhánh & Thẻ kho Bất biến | [(dashboard)/dashboard/inventory/page.tsx](../apps/web/src/app/(dashboard)/dashboard/inventory/page.tsx) | **2 Tabs nội tuyến (`Suspense` + `useSearchParams`):** `Tồn kho hiện tại` & `Thẻ kho bất biến`; Checkbox lọc tồn dưới định mức tự bật khi `?lowStock=true`; `Table` + `DataPagination` | [use-inventory.ts](../apps/web/src/hooks/use-inventory.ts), [labels.ts](../apps/web/src/lib/labels.ts) |
| `/dashboard/purchase-orders` | Nhập hàng NCC & Giá vốn AVCO | [(dashboard)/dashboard/purchase-orders/page.tsx](../apps/web/src/app/(dashboard)/dashboard/purchase-orders/page.tsx) | **2 Tabs (`Phiếu nhập hàng`, `Nhà cung cấp`)** + **2 Dialog** (`Tạo phiếu nhập hàng NCC`, `Thêm Nhà cung cấp`); `Table`, `Skeleton`, `Empty`, `DataPagination` | [use-inventory.ts](../apps/web/src/hooks/use-inventory.ts), [use-catalog.ts](../apps/web/src/hooks/use-catalog.ts) |
| `/dashboard/stock-counts` | Kiểm kho & Cân bằng tồn | [(dashboard)/dashboard/stock-counts/page.tsx](../apps/web/src/app/(dashboard)/dashboard/stock-counts/page.tsx) | **1 Dialog (`Tạo phiếu kiểm kho`)**; `Table`, `Skeleton`, `Empty`, `QueryErrorAlert`, `DataPagination` | [use-inventory.ts](../apps/web/src/hooks/use-inventory.ts) |
| `/dashboard/transfers` | Điều chuyển kho giữa các Chi nhánh | [(dashboard)/dashboard/transfers/page.tsx](../apps/web/src/app/(dashboard)/dashboard/transfers/page.tsx) | **1 Dialog (`Tạo phiếu điều chuyển kho`)**; Guard UI `INVENTORY_TRANSFER` + Alert chỉ xem; `Skeleton`, `Empty` (`!isLoading`), `DataPagination` | [use-stock-transfers.ts](../apps/web/src/hooks/use-stock-transfers.ts), [use-catalog.ts](../apps/web/src/hooks/use-catalog.ts) |
| `/dashboard/customers` | Khách hàng (CRM) & Điểm Loyalty | [(dashboard)/dashboard/customers/page.tsx](../apps/web/src/app/(dashboard)/dashboard/customers/page.tsx) | **Master-Detail 2 cột** + **2 Dialog** (`Thêm khách hàng mới`, `Điều chỉnh điểm Loyalty`) ẩn hoàn toàn nếu thiếu `CUSTOMER_MANAGE`; `Skeleton`, `Empty` (`!isLoading`), `DataPagination` | [use-customers.ts](../apps/web/src/hooks/use-customers.ts) |
| `/dashboard/reports` | Báo cáo Doanh thu & Xuất Excel BullMQ | [(dashboard)/dashboard/reports/page.tsx](../apps/web/src/app/(dashboard)/dashboard/reports/page.tsx) | Presets lọc nhanh (`Hôm nay`, `7 ngày`, `30 ngày`, `Tháng này`), 4 KPI card, **Biểu đồ Recharts `BarChart` (`ChartContainer` + Tooltip)** `Doanh thu thuần` vs `Lợi nhuận gộp`, Top SKU `Table`, hàng đợi Export BullMQ | [use-reports.ts](../apps/web/src/hooks/use-reports.ts), [chart.tsx](../apps/web/src/components/ui/chart.tsx) |
| `/dashboard/audit-logs` | Nhật ký Kiểm toán Bất biến | [(dashboard)/dashboard/audit-logs/page.tsx](../apps/web/src/app/(dashboard)/dashboard/audit-logs/page.tsx) | Bộ lọc 3 trường (Chi nhánh, Loại hành động, Tìm nhân sự/đối tượng), metadata hiển thị dạng key-value tiếng Việt + nút bật/ẩn JSON chi tiết (`aria-expanded`), `Skeleton`, `Empty`, `DataPagination` | [use-reports.ts](../apps/web/src/hooks/use-reports.ts) (`useAuditLogs`) |
| `/dashboard/branches` | Quản lý Chi nhánh | [(dashboard)/dashboard/branches/page.tsx](../apps/web/src/app/(dashboard)/dashboard/branches/page.tsx) | **2 Dialog** (`Thêm chi nhánh mới`, `Chỉnh sửa chi nhánh`); dùng `Switch`/`Checkbox` chuẩn shadcn + `Skeleton` & `Empty` | [use-branches.ts](../apps/web/src/hooks/use-branches.ts), [use-auth.ts](../apps/web/src/hooks/use-auth.ts) |
| `/dashboard/staff` | Nhân viên, PIN Thu ngân & Phân quyền RBAC | [(dashboard)/dashboard/staff/page.tsx](../apps/web/src/app/(dashboard)/dashboard/staff/page.tsx) | **2 Dialog** (`Thêm nhân viên mới`, `Chỉnh sửa nhân viên`); dùng `Switch` & `Checkbox` theo `FieldGroup` cho phân quyền chi nhánh/RBAC + `Skeleton` & `Empty` | [use-staff.ts](../apps/web/src/hooks/use-staff.ts), [use-branches.ts](../apps/web/src/hooks/use-branches.ts) |
| `/dashboard/integrations` | API Keys, Webhook TMĐT & Xuất Kế toán | [(dashboard)/dashboard/integrations/page.tsx](../apps/web/src/app/(dashboard)/dashboard/integrations/page.tsx) | Card `Xuất Sổ Kế toán (.xlsx — 3 sheet)` (`canExportAccounting`), 2 Tabs `API Keys` & `Webhooks & Delivery`, `SelectValue` hiển thị nhãn tiếng Việt rõ ràng, **`ConfirmDialog`** trước khi thu hồi Key hoặc xóa Webhook | [use-integrations.ts](../apps/web/src/hooks/use-integrations.ts) |
| `/dashboard/billing` | Quản lý Gói SaaS, Quota & Thanh toán | [(dashboard)/dashboard/billing/page.tsx](../apps/web/src/app/(dashboard)/dashboard/billing/page.tsx) | 3 thanh Quota, chọn chu kỳ (`1/3/6/12 tháng`) & phương thức thanh toán với nhãn tiếng Việt chuẩn trong `SelectValue`, lưới 3 gói SaaS (rõ dùng thử `14 ngày đầu` & gia hạn `30 ngày`), bảng lịch sử thanh toán `<Table>` | [use-billing.ts](../apps/web/src/hooks/use-billing.ts) |

---

## 6. Ma trận Trạng thái (State Matrix)

| Trạng thái | Quy chuẩn hiển thị thống nhất toàn hệ thống | Màn hình / Thành phần áp dụng |
| --- | --- | --- |
| **Loading** | • Toàn bộ 13 màn hình Dashboard, Layout Sidebar và Dialog POS (`ShiftZReportDialog`, `InvoiceActionsDialog`) sử dụng **`Skeleton` / `CardGridSkeleton` / `TableRowsSkeleton`** thay cho chữ giữ chỗ đơn thuần<br>• Các mutation khóa nút (`disabled={mutation.isPending}`) và đổi nhãn `"Đang lưu..."`, `"Đang xử lý..."` | [page-states.tsx](../apps/web/src/components/shared/page-states.tsx), [(dashboard)/layout.tsx](../apps/web/src/app/(dashboard)/layout.tsx), [(pos)/pos/page.tsx](../apps/web/src/app/(pos)/pos/page.tsx), tất cả `dashboard/*/page.tsx` |
| **Empty** | • **Mọi danh sách đều kiểm tra `!isLoading && items.length === 0`** (triệt tiêu hoàn toàn lỗi nháy Empty State lúc đang tải)<br>• Dùng primitive chuẩn shadcn `<Empty>` (`EmptyHeader`, `EmptyMedia`, `EmptyTitle`, `EmptyDescription`, kèm CTA khi hợp lệ) | `products`, `inventory`, `purchase-orders`, `stock-counts`, `transfers`, `customers`, `reports` (export queue), `audit-logs`, `branches`, `staff`, `integrations`, `billing`, `PosCartPanel`, `OfflineQueueDialog` |
| **Error** | • **`QueryErrorAlert`** hiển thị `Alert variant="destructive"` + `formatApiError(...)` + **nút "Thử lại" (`onRetry`)** khi tải dữ liệu thất bại<br>• Lỗi submit form hiển thị inline trong modal/panel; thao tác nhanh & đăng xuất báo qua `toast.error(...)` | Toàn bộ màn hình `/dashboard/*`, `/pos` & `ShiftZReportDialog` / `InvoiceActionsDialog` |
| **Success & Confirmation** | • Phản hồi hành động thành công qua `toast.success(...)`<br>• Mọi hành động mang tính phá hủy / không hoàn tác (**xóa nhóm hàng, thu hồi API Key, xóa Webhook, đóng tab POS có hàng, xóa đơn hàng đợi Offline**) đều yêu cầu xác nhận qua **`ConfirmDialog`** (`AlertDialog`) | [confirm-dialog.tsx](../apps/web/src/components/shared/confirm-dialog.tsx) gắn trên `ProductsPage`, `IntegrationsPage`, `PosCartPanel`, `OfflineQueueDialog` |
| **Offline** | Chỉ thiết kế cho `/pos`: Badge header đổi `destructive` `"Đang Offline"`, đơn vẫn thanh toán **(ngoại trừ `LOYALTY_POINTS`)** vào IndexedDB queue và tự sync khi có mạng | [pos-header.tsx](../apps/web/src/components/pos/pos-header.tsx), [pos-offline-queue.ts](../apps/web/src/lib/pos-offline-queue.ts), [offline-queue-dialog.tsx](../apps/web/src/components/pos/offline-queue-dialog.tsx) |
| **Disabled / Permission-restricted** | Thống nhất theo 3 lớp RBAC: ẩn nút ghi hoặc hiện `<Alert>` chỉ xem khi thiếu quyền (`transfers`, `customers`, `branches`, `integrations`), và disable kèm giải thích rõ điều kiện nghiệp vụ (`billing`, `purchase-orders`, `stock-counts`) | Mục 4 — Ma trận RBAC |
| **Print (`@media print`)** | `@page { margin: 0; }`, reset viewport `height: auto`, chỉ in `.pos-printable-receipt` (nền trắng chữ đen, `padding: 4mm`), ẩn toàn bộ `.pos-no-print` (gồm `DataModeSwitcher` và thanh điều khiển) | [globals.css](../apps/web/src/app/globals.css), [thermal-receipt-dialog.tsx](../apps/web/src/components/pos/thermal-receipt-dialog.tsx), [shift-z-report-dialog.tsx](../apps/web/src/components/pos/shift-z-report-dialog.tsx) |

---

## 7. Hướng dẫn Tra cứu nhanh & Bộ Test Giao diện

| Nhu cầu chỉnh sửa | File cần mở trực tiếp | Ghi chú kỹ thuật |
| --- | --- | --- |
| Đổi màu OKLCH (`Trust Blue`, `--success`, `--warning`), Dark Mode, `@media print` | [globals.css](../apps/web/src/app/globals.css), [theme-provider.tsx](../apps/web/src/components/theme/theme-provider.tsx) | `ThemeProvider` quản lý `.dark` class trên `<html>` thông qua `next-themes` |
| Chỉnh kích thước chạm tay (`touch` / `icon-touch` 44px) | [button.tsx](../apps/web/src/components/ui/button.tsx) | Variants `size="touch"` (`h-11`) & `size="icon-touch"` (`size-11`) |
| Đổi tên / thứ tự / quyền hiển thị Sidebar & Drawer Mobile | [(dashboard)/layout.tsx](../apps/web/src/app/(dashboard)/layout.tsx) | Mảng `NAV_ITEMS` dùng `requiredAnyPermissions` và chia sẻ cho cả Desktop Sidebar lẫn Mobile `Sheet` |
| Chỉnh Popup xác nhận, phân trang, trạng thái Skeleton/Error | `apps/web/src/components/shared/{confirm-dialog,data-pagination,page-states}.tsx` | Dùng thống nhất cho toàn Dashboard & POS |
| Chỉnh sửa sản phẩm / biến thể SKU | [product-edit-dialog.tsx](../apps/web/src/components/products/product-edit-dialog.tsx) | Gọi `PATCH /products/:id` và `PATCH /products/:id/variants/:variantId` |
| Chỉnh các khu vực của màn hình POS & Dialog POS | `apps/web/src/components/pos/*.tsx`, [(pos)/pos/page.tsx](../apps/web/src/app/(pos)/pos/page.tsx) | Tách riêng `PosHeader`, `PosCatalogGrid`, `PosCartPanel`, `PosPaymentPanel` và 5 Dialog |
| Chỉnh nhãn tiếng Việt, định dạng tiền `₫`, trạng thái | [labels.ts](../apps/web/src/lib/labels.ts) | Tập trung toàn bộ map `*_LABELS` và `formatVndAmount` |
| Đồng bộ quyền RBAC UI-Backend | [permissions.ts](../packages/shared/src/permissions.ts) | Chạy `pnpm --filter @smart-pos/shared build` nếu sửa `packages/shared` |

### Bộ Test Giao diện & Kiểm thử tương ứng (`apps/web/src/app/__tests__/`)
Sau khi chỉnh sửa, chạy `pnpm --filter @smart-pos/web test` hoặc từng file kiểm thử (tổng **10 file test / 27 test cases**):
- **Trang chủ & kết nối:** [portal.test.tsx](../apps/web/src/app/__tests__/portal.test.tsx)
- **Đăng ký & Đăng nhập:** [auth-pages.test.tsx](../apps/web/src/app/__tests__/auth-pages.test.tsx)
- **Dashboard Tổng quan, Chi nhánh, Nhân viên, POS cơ bản:** [management-and-pos.test.tsx](../apps/web/src/app/__tests__/management-and-pos.test.tsx)
- **Hàng hóa, Tồn kho, Nhập hàng, Kiểm kho:** [catalog-and-inventory-pages.test.tsx](../apps/web/src/app/__tests__/catalog-and-inventory-pages.test.tsx)
- **POS Terminal & IndexedDB Cache:** [pos-terminal.test.tsx](../apps/web/src/app/__tests__/pos-terminal.test.tsx)
- **Chuyển kho, Khách hàng/Loyalty, Báo cáo & Audit Logs:** [phase4-pages.test.tsx](../apps/web/src/app/__tests__/phase4-pages.test.tsx)
- **POS Offline Queue, Gói SaaS Billing & API/Webhook Integrations:** [phase5-offline-saas.test.tsx](../apps/web/src/app/__tests__/phase5-offline-saas.test.tsx)
- **UI/UX Enhancements, RBAC Guards, Dialog Xác nhận & Split Payment:** [ui-ux-enhancements.test.tsx](../apps/web/src/app/__tests__/ui-ux-enhancements.test.tsx)
- **API Client & Mock Data Router:** [api-client.test.ts](../apps/web/src/lib/__tests__/api-client.test.ts), [mock-data.test.ts](../apps/web/src/lib/__tests__/mock-data.test.ts)
