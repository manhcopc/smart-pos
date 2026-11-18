## Mô tả thay đổi
<!-- Tóm tắt ngắn gọn vấn đề cần giải quyết và thay đổi chính trong PR -->

## Loại thay đổi
- [ ] `feat`: Tính năng mới
- [ ] `fix`: Sửa lỗi
- [ ] `refactor`: Tái cấu trúc mã nguồn (không đổi hành vi)
- [ ] `docs`: Cập nhật tài liệu
- [ ] `test`: Bổ sung / cập nhật unit & UI test
- [ ] `chore`: Cấu hình, dependencies, CI/CD

## Kiến trúc & Quy tắc Smart-POS (Kiểm tra bắt buộc)
- [ ] Multi-tenant isolation (`tenantId` + index đứng đầu / RLS nếu sửa Backend/DB)
- [ ] Đã validate DTO/payload bằng Zod từ `packages/shared` (nếu có)
- [ ] Không dùng float thuần cho tính toán tiền tệ / không lưu ảnh Base64 vào DB
- [ ] Giữ phân quyền RBAC đồng bộ giữa UI và API Guards

## Kiểm thử & Xác minh thực tế
- [ ] `pnpm build` pass
- [ ] `pnpm typecheck` pass
- [ ] `pnpm lint` pass
- [ ] `pnpm test` pass (ghi rõ số lượng test mới/đã chạy)

## Ghi chú Review / Rủi ro / Ảnh chụp màn hình (nếu có)
<!-- Liệt kê những điểm cần lưu ý khi review hoặc rollback -->
