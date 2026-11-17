"use client";

import {
  createStaffMemberSchema,
  type Role,
  ROLES,
  type StaffMemberItem,
  updateStaffMemberSchema,
} from "@smart-pos/shared";
import {
  AlertCircleIcon,
  KeyRoundIcon,
  PencilIcon,
  PlusIcon,
  UsersIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMe } from "@/hooks/use-auth";
import { useBranches } from "@/hooks/use-branches";
import { useCreateStaff, useStaff, useUpdateStaff } from "@/hooks/use-staff";
import { formatApiError } from "@/lib/api-client";
import { ROLE_LABELS } from "@/lib/labels";

function toggleBranchSelection(current: string[], branchId: string): string[] {
  return current.includes(branchId)
    ? current.filter((id) => id !== branchId)
    : [...current, branchId];
}

export default function StaffPage() {
  const { data: profile } = useMe();
  const isOwner = profile?.member.role === "OWNER";
  const assignableRoles = isOwner
    ? ROLES
    : ROLES.filter((role) => role !== "OWNER");

  const staffQuery = useStaff(Boolean(profile));
  const branchesQuery = useBranches(Boolean(profile));
  const createStaffMutation = useCreateStaff();
  const updateStaffMutation = useUpdateStaff();

  const [createOpen, setCreateOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [role, setRole] = useState<Role>("CASHIER");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [phone, setPhone] = useState("");
  const [allowedBranchIds, setAllowedBranchIds] = useState<string[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createFieldErrors, setCreateFieldErrors] = useState<
    Record<string, string>
  >({});

  const [editingStaff, setEditingStaff] = useState<StaffMemberItem | null>(
    null,
  );
  const [editFullName, setEditFullName] = useState("");
  const [editRole, setEditRole] = useState<Role>("CASHIER");
  const [editPhone, setEditPhone] = useState("");
  const [editPin, setEditPin] = useState("");
  const [clearPin, setClearPin] = useState(false);
  const [editAllowedBranchIds, setEditAllowedBranchIds] = useState<string[]>(
    [],
  );
  const [editIsActive, setEditIsActive] = useState(true);
  const [editError, setEditError] = useState<string | null>(null);

  const branches = branchesQuery.data?.items ?? [];
  const branchNameById = new Map(branches.map((b) => [b.id, `${b.code} · ${b.name}`]));

  function openCreateDialog() {
    setFullName("");
    setEmployeeCode("");
    setRole("CASHIER");
    setEmail("");
    setPassword("");
    setPin("");
    setPhone("");
    setAllowedBranchIds([]);
    setCreateError(null);
    setCreateFieldErrors({});
    setCreateOpen(true);
  }

  function openEditDialog(member: StaffMemberItem) {
    setEditingStaff(member);
    setEditFullName(member.fullName);
    setEditRole(member.role);
    setEditPhone(member.phone ?? "");
    setEditPin("");
    setClearPin(false);
    setEditAllowedBranchIds(member.allowedBranchIds);
    setEditIsActive(member.isActive);
    setEditError(null);
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError(null);
    setCreateFieldErrors({});

    const parsed = createStaffMemberSchema.safeParse({
      fullName,
      employeeCode,
      role,
      email: email.trim() || null,
      password: password || null,
      pin: pin.trim() || null,
      phone: phone.trim() || null,
      allowedBranchIds,
    });

    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!next[key]) next[key] = issue.message;
      }
      setCreateFieldErrors(next);
      return;
    }

    try {
      await createStaffMutation.mutateAsync(parsed.data);
      toast.success("Đã thêm nhân viên mới");
      setCreateOpen(false);
    } catch (error) {
      setCreateError(formatApiError(error, "Không thể tạo nhân viên."));
    }
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingStaff) return;
    setEditError(null);

    const parsed = updateStaffMemberSchema.safeParse({
      fullName: editFullName,
      role: editRole,
      phone: editPhone.trim() || null,
      ...(clearPin
        ? { pin: null }
        : editPin.trim()
          ? { pin: editPin.trim() }
          : {}),
      allowedBranchIds: editAllowedBranchIds,
      isActive: editIsActive,
    });

    if (!parsed.success) {
      setEditError(
        parsed.error.issues[0]?.message ?? "Dữ liệu cập nhật chưa hợp lệ",
      );
      return;
    }

    try {
      await updateStaffMutation.mutateAsync({
        id: editingStaff.id,
        data: parsed.data,
      });
      toast.success("Đã cập nhật thông tin nhân viên");
      setEditingStaff(null);
    } catch (error) {
      setEditError(formatApiError(error, "Không thể cập nhật nhân viên."));
    }
  }

  const quota = staffQuery.data?.quota;
  const members = staffQuery.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Nhân viên &amp; Phân quyền</h1>
          <p className="text-sm text-muted-foreground">
            Tạo tài khoản Email hoặc cấp nhanh Mã nhân viên + PIN cho Thu ngân
            tại quầy.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {quota ? (
            <Badge variant="outline">
              Đang dùng: {quota.activeCount} / {quota.maxUsers} nhân sự
            </Badge>
          ) : null}
          <Button onClick={openCreateDialog}>
            <PlusIcon data-icon="inline-start" />
            Thêm nhân viên
          </Button>
        </div>
      </header>

      {staffQuery.isError ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Không tải được danh sách nhân viên</AlertTitle>
          <AlertDescription>{formatApiError(staffQuery.error)}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {members.map((member) => {
          const canEditMember = isOwner || member.role !== "OWNER";
          const branchText =
            member.allowedBranchIds.length === 0
              ? "Tất cả chi nhánh"
              : member.allowedBranchIds
                  .map((id) => branchNameById.get(id) ?? id)
                  .join(", ");

          return (
            <Card key={member.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <UsersIcon className="size-4 text-primary" />
                    <span>{member.fullName}</span>
                  </CardTitle>
                  <CardDescription className="font-mono text-xs">
                    Mã NV: {member.employeeCode}
                  </CardDescription>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <Badge>{ROLE_LABELS[member.role]}</Badge>
                  <Badge variant={member.isActive ? "secondary" : "outline"}>
                    {member.isActive ? "Đang hoạt động" : "Đã khóa"}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-1.5 text-sm text-muted-foreground">
                <span>
                  Email: {member.email ? member.email : "Chỉ đăng nhập PIN"}
                </span>
                <span className="flex items-center gap-1.5">
                  <KeyRoundIcon className="size-3.5" />
                  PIN thu ngân: {member.hasPin ? "Đã thiết lập" : "Chưa có"}
                </span>
                <span>Chi nhánh: {branchText}</span>

                {canEditMember ? (
                  <div className="pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditDialog(member)}
                    >
                      <PencilIcon data-icon="inline-start" />
                      Chỉnh sửa
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Thêm nhân viên mới</DialogTitle>
            <DialogDescription>
              Thu ngân có thể chỉ cần Mã nhân viên + PIN (4–8 số) để đổi ca
              nhanh tại quầy.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSubmit} className="flex flex-col gap-4">
            {createError ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>{createError}</AlertDescription>
              </Alert>
            ) : null}

            <FieldGroup>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field data-invalid={Boolean(createFieldErrors.fullName)}>
                  <FieldLabel htmlFor="staff-fullname">Họ tên</FieldLabel>
                  <Input
                    id="staff-fullname"
                    placeholder="Trần Thị Thu Ngân"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                  {createFieldErrors.fullName ? (
                    <FieldError>{createFieldErrors.fullName}</FieldError>
                  ) : null}
                </Field>

                <Field data-invalid={Boolean(createFieldErrors.employeeCode)}>
                  <FieldLabel htmlFor="staff-code">Mã nhân viên</FieldLabel>
                  <Input
                    id="staff-code"
                    placeholder="TN01"
                    value={employeeCode}
                    onChange={(e) =>
                      setEmployeeCode(e.target.value.toUpperCase())
                    }
                  />
                  {createFieldErrors.employeeCode ? (
                    <FieldError>{createFieldErrors.employeeCode}</FieldError>
                  ) : null}
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="staff-role">Vai trò</FieldLabel>
                  <Select
                    value={role}
                    onValueChange={(value) => {
                      if (value) setRole(value as Role);
                    }}
                  >
                    <SelectTrigger id="staff-role" className="w-full">
                      <SelectValue>{ROLE_LABELS[role]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {assignableRoles.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field data-invalid={Boolean(createFieldErrors.pin)}>
                  <FieldLabel htmlFor="staff-pin">Mã PIN (4–8 số)</FieldLabel>
                  <Input
                    id="staff-pin"
                    type="password"
                    inputMode="numeric"
                    placeholder="123456"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                  />
                  {createFieldErrors.pin ? (
                    <FieldError>{createFieldErrors.pin}</FieldError>
                  ) : null}
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field data-invalid={Boolean(createFieldErrors.email)}>
                  <FieldLabel htmlFor="staff-email">
                    Email (tùy chọn)
                  </FieldLabel>
                  <Input
                    id="staff-email"
                    type="email"
                    placeholder="nhanvien@cuahang.vn"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  {createFieldErrors.email ? (
                    <FieldError>{createFieldErrors.email}</FieldError>
                  ) : null}
                </Field>

                <Field data-invalid={Boolean(createFieldErrors.password)}>
                  <FieldLabel htmlFor="staff-password">
                    Mật khẩu (khi có email)
                  </FieldLabel>
                  <Input
                    id="staff-password"
                    type="password"
                    placeholder="Tối thiểu 8 ký tự"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  {createFieldErrors.password ? (
                    <FieldError>{createFieldErrors.password}</FieldError>
                  ) : null}
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="staff-phone">Số điện thoại</FieldLabel>
                <Input
                  id="staff-phone"
                  placeholder="0901234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>

              {branches.length > 0 ? (
                <Field>
                  <FieldLabel>Phạm vi chi nhánh được phép</FieldLabel>
                  <FieldDescription>
                    Bỏ trống nếu nhân viên được truy cập tất cả chi nhánh.
                  </FieldDescription>
                  <div className="flex flex-col gap-1.5 pt-1">
                    {branches.map((branch) => (
                      <label
                        key={branch.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={allowedBranchIds.includes(branch.id)}
                          onChange={() =>
                            setAllowedBranchIds((prev) =>
                              toggleBranchSelection(prev, branch.id),
                            )
                          }
                        />
                        <span>
                          {branch.code} · {branch.name}
                        </span>
                      </label>
                    ))}
                  </div>
                </Field>
              ) : null}
            </FieldGroup>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                Hủy
              </Button>
              <Button type="submit" disabled={createStaffMutation.isPending}>
                {createStaffMutation.isPending
                  ? "Đang lưu..."
                  : "Tạo nhân viên"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editingStaff)}
        onOpenChange={(open) => {
          if (!open) setEditingStaff(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Chỉnh sửa nhân viên {editingStaff?.employeeCode}
            </DialogTitle>
            <DialogDescription>
              Cập nhật vai trò, phạm vi chi nhánh hoặc đặt lại mã PIN.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
            {editError ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>{editError}</AlertDescription>
              </Alert>
            ) : null}

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="staff-edit-fullname">Họ tên</FieldLabel>
                <Input
                  id="staff-edit-fullname"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="staff-edit-role">Vai trò</FieldLabel>
                  <Select
                    value={editRole}
                    onValueChange={(value) => {
                      if (value) setEditRole(value as Role);
                    }}
                  >
                    <SelectTrigger id="staff-edit-role" className="w-full">
                      <SelectValue>{ROLE_LABELS[editRole]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {assignableRoles.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="staff-edit-phone">
                    Số điện thoại
                  </FieldLabel>
                  <Input
                    id="staff-edit-phone"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="staff-edit-pin">
                  Đổi mã PIN mới (để trống nếu giữ nguyên)
                </FieldLabel>
                <Input
                  id="staff-edit-pin"
                  type="password"
                  inputMode="numeric"
                  disabled={clearPin}
                  placeholder="4–8 chữ số"
                  value={editPin}
                  onChange={(e) => setEditPin(e.target.value)}
                />
                <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={clearPin}
                    onChange={(e) => {
                      setClearPin(e.target.checked);
                      if (e.target.checked) setEditPin("");
                    }}
                  />
                  <span>Xóa mã PIN hiện tại</span>
                </label>
              </Field>

              {branches.length > 0 ? (
                <Field>
                  <FieldLabel>Phạm vi chi nhánh được phép</FieldLabel>
                  <div className="flex flex-col gap-1.5">
                    {branches.map((branch) => (
                      <label
                        key={branch.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={editAllowedBranchIds.includes(branch.id)}
                          onChange={() =>
                            setEditAllowedBranchIds((prev) =>
                              toggleBranchSelection(prev, branch.id),
                            )
                          }
                        />
                        <span>
                          {branch.code} · {branch.name}
                        </span>
                      </label>
                    ))}
                  </div>
                </Field>
              ) : null}

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                />
                <span>Tài khoản đang hoạt động</span>
              </label>
            </FieldGroup>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingStaff(null)}
              >
                Đóng
              </Button>
              <Button type="submit" disabled={updateStaffMutation.isPending}>
                {updateStaffMutation.isPending
                  ? "Đang lưu..."
                  : "Lưu thay đổi"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
