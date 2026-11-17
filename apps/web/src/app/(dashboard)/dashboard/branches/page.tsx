"use client";

import {
  type BranchItem,
  createBranchSchema,
  PERMISSIONS,
  updateBranchSchema,
} from "@smart-pos/shared";
import {
  AlertCircleIcon,
  Building2Icon,
  PencilIcon,
  PlusIcon,
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
import { useMe } from "@/hooks/use-auth";
import {
  useBranches,
  useCreateBranch,
  useUpdateBranch,
} from "@/hooks/use-branches";
import { formatApiError } from "@/lib/api-client";

export default function BranchesPage() {
  const { data: profile } = useMe();
  const canManage =
    profile?.member.permissions.includes(PERMISSIONS.BRANCH_MANAGE) ?? false;

  const branchesQuery = useBranches(Boolean(profile));
  const createBranchMutation = useCreateBranch();
  const updateBranchMutation = useUpdateBranch();

  const [createOpen, setCreateOpen] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newIsDefault, setNewIsDefault] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createFieldErrors, setCreateFieldErrors] = useState<
    Record<string, string>
  >({});

  const [editingBranch, setEditingBranch] = useState<BranchItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editIsDefault, setEditIsDefault] = useState(false);
  const [editIsActive, setEditIsActive] = useState(true);
  const [editError, setEditError] = useState<string | null>(null);

  function openCreateDialog() {
    setNewCode("");
    setNewName("");
    setNewAddress("");
    setNewPhone("");
    setNewIsDefault(false);
    setCreateError(null);
    setCreateFieldErrors({});
    setCreateOpen(true);
  }

  function openEditDialog(branch: BranchItem) {
    setEditingBranch(branch);
    setEditName(branch.name);
    setEditAddress(branch.address ?? "");
    setEditPhone(branch.phone ?? "");
    setEditIsDefault(branch.isDefault);
    setEditIsActive(branch.isActive);
    setEditError(null);
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError(null);
    setCreateFieldErrors({});

    const parsed = createBranchSchema.safeParse({
      code: newCode,
      name: newName,
      address: newAddress.trim() || null,
      phone: newPhone.trim() || null,
      isDefault: newIsDefault,
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
      await createBranchMutation.mutateAsync(parsed.data);
      toast.success("Đã tạo chi nhánh mới");
      setCreateOpen(false);
    } catch (error) {
      setCreateError(formatApiError(error, "Không thể tạo chi nhánh."));
    }
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingBranch) return;
    setEditError(null);

    const parsed = updateBranchSchema.safeParse({
      name: editName,
      address: editAddress.trim() || null,
      phone: editPhone.trim() || null,
      isDefault: editIsDefault,
      isActive: editIsActive,
    });

    if (!parsed.success) {
      setEditError(
        parsed.error.issues[0]?.message ?? "Dữ liệu cập nhật chưa hợp lệ",
      );
      return;
    }

    try {
      await updateBranchMutation.mutateAsync({
        id: editingBranch.id,
        data: parsed.data,
      });
      toast.success("Đã cập nhật chi nhánh");
      setEditingBranch(null);
    } catch (error) {
      setEditError(formatApiError(error, "Không thể cập nhật chi nhánh."));
    }
  }

  const quota = branchesQuery.data?.quota;
  const branches = branchesQuery.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Quản lý Chi nhánh</h1>
          <p className="text-sm text-muted-foreground">
            Thiết lập điểm bán hàng và chi nhánh mặc định theo hạn mức gói dịch
            vụ.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {quota ? (
            <Badge variant="outline">
              Đang dùng: {quota.activeCount} / {quota.maxBranches} chi nhánh
            </Badge>
          ) : null}
          {canManage ? (
            <Button onClick={openCreateDialog}>
              <PlusIcon data-icon="inline-start" />
              Thêm chi nhánh
            </Button>
          ) : null}
        </div>
      </header>

      {!canManage ? (
        <Alert>
          <AlertCircleIcon />
          <AlertTitle>Chế độ chỉ xem</AlertTitle>
          <AlertDescription>
            Bạn cần quyền <code>branch:manage</code> để thêm hoặc chỉnh sửa chi
            nhánh.
          </AlertDescription>
        </Alert>
      ) : null}

      {branchesQuery.isError ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Không tải được danh sách chi nhánh</AlertTitle>
          <AlertDescription>
            {formatApiError(branchesQuery.error)}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {branches.map((branch) => (
          <Card key={branch.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div className="flex flex-col gap-1">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Building2Icon className="size-4 text-primary" />
                  <span>{branch.name}</span>
                </CardTitle>
                <CardDescription className="font-mono text-xs">
                  Mã: {branch.code}
                </CardDescription>
              </div>
              <div className="flex items-center gap-1.5">
                {branch.isDefault ? <Badge>Mặc định</Badge> : null}
                <Badge variant={branch.isActive ? "secondary" : "outline"}>
                  {branch.isActive ? "Đang hoạt động" : "Tạm ngưng"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
              <span>
                Địa chỉ: {branch.address ? branch.address : "Chưa cập nhật"}
              </span>
              <span>
                Số điện thoại: {branch.phone ? branch.phone : "Chưa cập nhật"}
              </span>
              {canManage ? (
                <div className="pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEditDialog(branch)}
                  >
                    <PencilIcon data-icon="inline-start" />
                    Chỉnh sửa
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Thêm chi nhánh mới</DialogTitle>
            <DialogDescription>
              Mỗi chi nhánh theo dõi tồn kho và hóa đơn riêng biệt.
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
              <Field data-invalid={Boolean(createFieldErrors.code)}>
                <FieldLabel htmlFor="branch-code">Mã chi nhánh</FieldLabel>
                <Input
                  id="branch-code"
                  placeholder="CN02"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                />
                <FieldDescription>
                  Chữ in hoa, số, dấu gạch ngang hoặc gạch dưới (VD: CN02).
                </FieldDescription>
                {createFieldErrors.code ? (
                  <FieldError>{createFieldErrors.code}</FieldError>
                ) : null}
              </Field>

              <Field data-invalid={Boolean(createFieldErrors.name)}>
                <FieldLabel htmlFor="branch-new-name">Tên chi nhánh</FieldLabel>
                <Input
                  id="branch-new-name"
                  placeholder="Chi nhánh Quận 3"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                {createFieldErrors.name ? (
                  <FieldError>{createFieldErrors.name}</FieldError>
                ) : null}
              </Field>

              <Field>
                <FieldLabel htmlFor="branch-new-phone">Số điện thoại</FieldLabel>
                <Input
                  id="branch-new-phone"
                  placeholder="0901234567"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="branch-new-address">Địa chỉ</FieldLabel>
                <Input
                  id="branch-new-address"
                  placeholder="123 Lê Lợi, Q.1, TP.HCM"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                />
              </Field>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={newIsDefault}
                  onChange={(e) => setNewIsDefault(e.target.checked)}
                />
                <span>Đặt làm chi nhánh mặc định</span>
              </label>
            </FieldGroup>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                Hủy
              </Button>
              <Button type="submit" disabled={createBranchMutation.isPending}>
                {createBranchMutation.isPending
                  ? "Đang lưu..."
                  : "Tạo chi nhánh"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editingBranch)}
        onOpenChange={(open) => {
          if (!open) setEditingBranch(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Chỉnh sửa chi nhánh {editingBranch?.code}
            </DialogTitle>
            <DialogDescription>
              Cập nhật thông tin hoặc trạng thái hoạt động của chi nhánh.
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
                <FieldLabel htmlFor="branch-edit-name">Tên chi nhánh</FieldLabel>
                <Input
                  id="branch-edit-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="branch-edit-phone">
                  Số điện thoại
                </FieldLabel>
                <Input
                  id="branch-edit-phone"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="branch-edit-address">Địa chỉ</FieldLabel>
                <Input
                  id="branch-edit-address"
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                />
              </Field>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editIsDefault}
                  onChange={(e) => setEditIsDefault(e.target.checked)}
                />
                <span>Chi nhánh mặc định</span>
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                />
                <span>Đang hoạt động</span>
              </label>
            </FieldGroup>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingBranch(null)}
              >
                Đóng
              </Button>
              <Button type="submit" disabled={updateBranchMutation.isPending}>
                {updateBranchMutation.isPending
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
