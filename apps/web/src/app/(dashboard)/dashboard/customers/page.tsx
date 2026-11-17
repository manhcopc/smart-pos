"use client";

import {
  adjustCustomerLoyaltySchema,
  createCustomerSchema,
  type CustomerItem,
  PERMISSIONS,
} from "@smart-pos/shared";
import {
  AlertCircleIcon,
  AwardIcon,
  PlusIcon,
  SearchIcon,
  UserCheckIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useMe } from "@/hooks/use-auth";
import {
  useAdjustCustomerLoyalty,
  useCreateCustomer,
  useCustomerDetail,
  useCustomers,
} from "@/hooks/use-customers";
import { formatApiError } from "@/lib/api-client";
import { formatVndAmount } from "@/lib/labels";

export default function CustomersPage() {
  const { data: profile } = useMe();
  const canManageCustomers = new Set(profile?.member.permissions ?? []).has(
    PERMISSIONS.CUSTOMER_MANAGE,
  );

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const customersQuery = useCustomers(
    { search, limit: 30 },
    Boolean(profile),
  );
  const detailQuery = useCustomerDetail(selectedId, Boolean(selectedId));

  const createMutation = useCreateCustomer();
  const adjustMutation = useAdjustCustomerLoyalty();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<CustomerItem | null>(null);
  const [pointsDelta, setPointsDelta] = useState("10");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustError, setAdjustError] = useState<string | null>(null);

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError(null);
    const parsed = createCustomerSchema.safeParse({
      name,
      phone: phone.trim() || null,
      email: email.trim() || null,
    });
    if (!parsed.success) {
      setCreateError(
        parsed.error.issues[0]?.message ?? "Dữ liệu khách hàng không hợp lệ",
      );
      return;
    }

    try {
      const created = await createMutation.mutateAsync(parsed.data);
      toast.success(`Đã tạo khách hàng ${created.name} (${created.code})`);
      setName("");
      setPhone("");
      setEmail("");
      setCreateOpen(false);
    } catch (error) {
      setCreateError(formatApiError(error, "Không thể tạo khách hàng."));
    }
  }

  async function handleAdjustSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adjustTarget) return;
    setAdjustError(null);

    const parsed = adjustCustomerLoyaltySchema.safeParse({
      pointsDelta: Number(pointsDelta),
      reason: adjustReason,
    });
    if (!parsed.success) {
      setAdjustError(
        parsed.error.issues[0]?.message ?? "Dữ liệu điều chỉnh điểm không hợp lệ",
      );
      return;
    }

    try {
      const updated = await adjustMutation.mutateAsync({
        customerId: adjustTarget.id,
        data: parsed.data,
      });
      toast.success(
        `Đã cập nhật điểm của ${updated.name}: ${updated.loyaltyPoints} điểm`,
      );
      setAdjustOpen(false);
      setAdjustReason("");
    } catch (error) {
      setAdjustError(formatApiError(error, "Không thể điều chỉnh điểm."));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            Khách hàng (CRM) &amp; Tích điểm Loyalty
          </h1>
          <p className="text-sm text-muted-foreground">
            Quy chuẩn: Tích 1 điểm mỗi 10.000 ₫ thanh toán · Quy đổi 1 điểm =
            1.000 ₫ ngay tại quầy POS.
          </p>
        </div>

        <Button type="button" onClick={() => setCreateOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          Thêm khách hàng
        </Button>
      </header>

      <div className="flex items-center gap-2 md:max-w-md">
        <SearchIcon className="size-4 text-muted-foreground" />
        <Input
          placeholder="Tìm theo tên, số điện thoại, mã KH..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-2.5">
          {(customersQuery.data?.items ?? []).map((cust) => (
            <Card
              key={cust.id}
              className={selectedId === cust.id ? "border-primary" : undefined}
            >
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <UserCheckIcon className="size-4 text-primary" />
                      {cust.name}
                    </CardTitle>
                    <CardDescription>
                      <span className="font-mono">{cust.code}</span>
                      {cust.phone ? ` · ${cust.phone}` : ""}
                      {cust.email ? ` · ${cust.email}` : ""}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge>{cust.loyaltyPoints} điểm</Badge>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedId(cust.id)}
                    >
                      Chi tiết
                    </Button>
                    {canManageCustomers ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setAdjustTarget(cust);
                          setPointsDelta("10");
                          setAdjustError(null);
                          setAdjustOpen(true);
                        }}
                      >
                        <AwardIcon data-icon="inline-start" />
                        Chỉnh điểm
                      </Button>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Tổng chi tiêu:{" "}
                  <strong className="font-mono text-foreground">
                    {formatVndAmount(cust.totalSpent)}
                  </strong>
                </span>
                <span>
                  Công nợ:{" "}
                  <strong className="font-mono">
                    {formatVndAmount(cust.debtBalance)}
                  </strong>
                </span>
              </CardContent>
            </Card>
          ))}

          {(customersQuery.data?.items ?? []).length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Chưa có hồ sơ khách hàng
                </CardTitle>
                <CardDescription>
                  Thêm khách hàng tại đây hoặc thêm nhanh ngay trên màn hình POS.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Lịch sử mua hàng khách chọn
            </CardTitle>
            <CardDescription>
              25 hóa đơn gần nhất thuộc các chi nhánh được phân quyền
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {detailQuery.data ? (
              detailQuery.data.recentInvoices.length > 0 ? (
                detailQuery.data.recentInvoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between border-b pb-1.5 last:border-none"
                  >
                    <div>
                      <div className="font-mono font-medium">{inv.code}</div>
                      <div className="text-xs text-muted-foreground">
                        {inv.branchName} ·{" "}
                        {new Date(inv.createdAt).toLocaleString("vi-VN")}
                      </div>
                    </div>
                    <span className="font-mono font-semibold">
                      {formatVndAmount(inv.totalAmount)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">
                  Khách hàng chưa phát sinh hóa đơn nào.
                </p>
              )
            ) : (
              <p className="text-xs text-muted-foreground">
                Chọn &ldquo;Chi tiết&rdquo; ở danh sách bên trái để xem lịch sử.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm khách hàng mới</DialogTitle>
            <DialogDescription>
              Hệ thống tự sinh mã KH nếu bỏ trống và chống trùng số điện thoại.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="flex flex-col gap-3">
            {createError ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>{createError}</AlertDescription>
              </Alert>
            ) : null}
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="crm-name">Họ và tên</FieldLabel>
                <Input
                  id="crm-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="crm-phone">Số điện thoại</FieldLabel>
                <Input
                  id="crm-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="crm-email">Email</FieldLabel>
                <Input
                  id="crm-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                Hủy
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Đang lưu..." : "Lưu khách hàng"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Điều chỉnh điểm Loyalty — {adjustTarget?.name}
            </DialogTitle>
            <DialogDescription>
              Điểm hiện tại: {adjustTarget?.loyaltyPoints ?? 0}. Nhập số dương để
              cộng hoặc số âm để trừ (không âm dưới 0).
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAdjustSubmit} className="flex flex-col gap-3">
            {adjustError ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>{adjustError}</AlertDescription>
              </Alert>
            ) : null}
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="adj-pts">Số điểm thay đổi</FieldLabel>
                <Input
                  id="adj-pts"
                  type="number"
                  value={pointsDelta}
                  onChange={(e) => setPointsDelta(e.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="adj-reason">Lý do điều chỉnh</FieldLabel>
                <Input
                  id="adj-reason"
                  placeholder="VD: Cộng điểm ưu đãi thành viên mới"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  required
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAdjustOpen(false)}
              >
                Hủy
              </Button>
              <Button type="submit" disabled={adjustMutation.isPending}>
                {adjustMutation.isPending ? "Đang lưu..." : "Xác nhận chỉnh điểm"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
