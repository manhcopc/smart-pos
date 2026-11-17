"use client";

import {
  SUPERVISOR_APPROVAL_PERMISSIONS,
  type SupervisorApprovalResponse,
} from "@smart-pos/shared";
import { AlertCircleIcon, ShieldCheckIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useSupervisorApprove } from "@/hooks/use-pos";
import { formatApiError } from "@/lib/api-client";
import { PERMISSION_LABELS } from "@/lib/labels";

interface SupervisorPinDialogProps {
  branchId: string | undefined;
  permission: (typeof SUPERVISOR_APPROVAL_PERMISSIONS)[number] | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApproved: (approval: SupervisorApprovalResponse) => void;
}

export function SupervisorPinDialog({
  branchId,
  permission,
  open,
  onOpenChange,
  onApproved,
}: SupervisorPinDialogProps) {
  const [employeeCode, setEmployeeCode] = useState("");
  const [pin, setPin] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const approveMutation = useSupervisorApprove();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!branchId || !permission) return;
    setErrorMsg(null);

    try {
      const approval = await approveMutation.mutateAsync({
        branchId,
        permission,
        ...(employeeCode.trim()
          ? { managerEmployeeCode: employeeCode.trim().toUpperCase() }
          : {}),
        pin: pin.trim(),
      });
      toast.success(`Đã xác thực bởi ${approval.approverName}`);
      setPin("");
      onApproved(approval);
      onOpenChange(false);
    } catch (error) {
      setErrorMsg(formatApiError(error, "Mã PIN Quản lý không hợp lệ."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4 text-primary" />
            Phê duyệt bằng PIN Quản lý
          </DialogTitle>
          <DialogDescription>
            {permission
              ? `Yêu cầu quyền "${PERMISSION_LABELS[permission]}" tại chi nhánh hiện tại.`
              : "Nhập mã PIN của Quản lý hoặc Chủ cửa hàng để duyệt thao tác."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {errorMsg ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          ) : null}

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="sup-emp-code">
                Mã nhân viên Quản lý (tuỳ chọn)
              </FieldLabel>
              <Input
                id="sup-emp-code"
                placeholder="VD: QL01 (bỏ trống nếu chỉ dùng PIN)"
                value={employeeCode}
                onChange={(e) => setEmployeeCode(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="sup-pin">Mã PIN phê duyệt</FieldLabel>
              <Input
                id="sup-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                placeholder="4–8 chữ số"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                required
              />
              <FieldDescription>
                Phiên xác thực có hiệu lực 5 phút và được ghi vào Audit Log.
              </FieldDescription>
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              disabled={approveMutation.isPending || pin.trim().length < 4}
            >
              {approveMutation.isPending ? "Đang xác thực..." : "Xác nhận PIN"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
