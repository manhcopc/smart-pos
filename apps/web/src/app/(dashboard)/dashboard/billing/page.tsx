"use client";

import {
  PERMISSIONS,
  type SubscriptionPlanCodeType,
  type SubscriptionPlanInfo,
} from "@smart-pos/shared";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CreditCardIcon,
  CrownIcon,
  SparklesIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMe } from "@/hooks/use-auth";
import { useBillingOverview, useSubscribePlan } from "@/hooks/use-billing";
import { formatApiError } from "@/lib/api-client";
import { BILLING_STATUS_LABELS, formatVndAmount } from "@/lib/labels";

function QuotaMeter({
  label,
  used,
  max,
}: {
  label: string;
  used: number;
  max: number;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const nearLimit = pct >= 85;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-mono text-2xl">
          {used} / {max}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full transition-all ${
              nearLimit ? "bg-destructive" : "bg-primary"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">Đã sử dụng {pct}% hạn mức</p>
      </CardContent>
    </Card>
  );
}

const PROVIDER_LABELS = {
  INTERNAL_QR: "Chuyển khoản VietQR",
  VNPAY: "Cổng VNPay",
  MOMO: "Ví MoMo",
  TRIAL_EXTEND: "Gia hạn Dùng thử",
} as const;

export default function BillingPage() {
  const meQuery = useMe();
  const perms = new Set(meQuery.data?.member.permissions ?? []);
  const canManageBilling = perms.has(PERMISSIONS.BILLING_MANAGE);

  const overviewQuery = useBillingOverview(Boolean(meQuery.data));
  const subscribeMutation = useSubscribePlan();

  const [billingMonths, setBillingMonths] = useState("1");
  const [provider, setProvider] =
    useState<keyof typeof PROVIDER_LABELS>("INTERNAL_QR");
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const data = overviewQuery.data;

  async function handleSelectPlan(plan: SubscriptionPlanInfo) {
    setErrorBanner(null);
    const chosenProvider =
      plan.code === "FREE_TRIAL" ? "TRIAL_EXTEND" : provider;
    try {
      const created = await subscribeMutation.mutateAsync({
        planCode: plan.code as SubscriptionPlanCodeType,
        billingMonths: plan.code === "FREE_TRIAL" ? 1 : Number(billingMonths),
        provider: chosenProvider,
        confirmImmediately: true,
      });
      toast.success(
        `Đã kích hoạt gói ${plan.name} (${created.referenceNo ?? "Thành công"})`,
      );
    } catch (err) {
      const msg = formatApiError(err, "Không thể thay đổi gói dịch vụ.");
      setErrorBanner(msg);
      toast.error(msg);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Gói SaaS & Hạn mức hệ thống
          </h1>
          <p className="text-sm text-muted-foreground">
            Quản lý thời hạn dùng thử, theo dõi quota chi nhánh / nhân viên / SKU và nâng cấp gói Lite hoặc Pro.
          </p>
        </div>
        {data ? (
          <Badge variant="secondary" className="gap-1.5 px-3 py-1 text-sm">
            <CrownIcon className="size-4 text-primary" />
            Gói hiện tại: {data.currentPlan.name}
          </Badge>
        ) : null}
      </div>

      {data?.tenant.isTrialExpired ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Thời gian dùng thử 30 ngày đã kết thúc</AlertTitle>
          <AlertDescription>
            Vui lòng nâng cấp lên gói Lite hoặc Pro để tiếp tục vận hành không gián đoạn.
          </AlertDescription>
        </Alert>
      ) : data?.currentPlan.code === "FREE_TRIAL" &&
        data.tenant.daysRemaining !== null ? (
        <Alert>
          <SparklesIcon />
          <AlertTitle>
            Đang dùng thử miễn phí (còn {data.tenant.daysRemaining} ngày)
          </AlertTitle>
          <AlertDescription>
            Bạn có thể gia hạn thử nghiệm hoặc chọn gói trả phí Lite / Pro bất cứ lúc nào.
          </AlertDescription>
        </Alert>
      ) : null}

      {errorBanner ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Không thể đổi gói</AlertTitle>
          <AlertDescription>{errorBanner}</AlertDescription>
        </Alert>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <QuotaMeter
              label="Chi nhánh đang hoạt động"
              used={data.usage.activeBranches}
              max={data.currentPlan.maxBranches}
            />
            <QuotaMeter
              label="Nhân viên đang hoạt động"
              used={data.usage.activeUsers}
              max={data.currentPlan.maxUsers}
            />
            <QuotaMeter
              label="Biến thể SKU kích hoạt"
              used={data.usage.activeSkus}
              max={data.currentPlan.maxSkus}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Chọn gói & Chu kỳ thanh toán</CardTitle>
              <CardDescription>
                Hệ thống tự động kiểm tra an toàn khi hạ gói: không cho phép chuyển xuống gói có hạn mức nhỏ hơn số lượng đang sử dụng.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <FieldGroup className="grid gap-4 sm:max-w-lg sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="billing-months">Chu kỳ thanh toán</FieldLabel>
                  <Select value={billingMonths} onValueChange={(v) => v && setBillingMonths(v)}>
                    <SelectTrigger id="billing-months">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="1">1 tháng</SelectItem>
                        <SelectItem value="3">3 tháng</SelectItem>
                        <SelectItem value="6">6 tháng</SelectItem>
                        <SelectItem value="12">12 tháng</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="billing-provider">Phương thức thanh toán</FieldLabel>
                  <Select
                    value={provider}
                    onValueChange={(v) =>
                      v && setProvider(v as keyof typeof PROVIDER_LABELS)
                    }
                  >
                    <SelectTrigger id="billing-provider">
                      <SelectValue>{PROVIDER_LABELS[provider]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="INTERNAL_QR">Chuyển khoản VietQR</SelectItem>
                        <SelectItem value="VNPAY">Cổng VNPay</SelectItem>
                        <SelectItem value="MOMO">Ví MoMo</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGroup>

              <div className="grid gap-4 lg:grid-cols-3">
                {data.availablePlans.map((plan) => {
                  const isCurrent = plan.code === data.currentPlan.code;
                  const monthlyNum = Number(plan.priceMonthly);
                  return (
                    <Card
                      key={plan.id}
                      className={isCurrent ? "border-primary ring-1 ring-primary" : ""}
                    >
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base">{plan.name}</CardTitle>
                          {isCurrent ? (
                            <Badge variant="default">Đang sử dụng</Badge>
                          ) : null}
                        </div>
                        <CardDescription className="font-mono text-lg font-semibold text-foreground">
                          {monthlyNum === 0
                            ? "Miễn phí (30 ngày)"
                            : `${formatVndAmount(plan.priceMonthly)} / tháng`}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2Icon className="size-3.5 text-primary" />
                          Tối đa {plan.maxBranches} chi nhánh · {plan.maxUsers} nhân viên
                        </div>
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2Icon className="size-3.5 text-primary" />
                          Tối đa {plan.maxSkus.toLocaleString("vi-VN")} SKU · Lưu trữ {plan.storageQuotaMb} MB
                        </div>
                        <div className="flex flex-wrap gap-1 pt-2">
                          {plan.features.posOffline ? (
                            <Badge variant="outline">POS Offline</Badge>
                          ) : null}
                          {plan.features.splitPayments ? (
                            <Badge variant="outline">Tách thanh toán</Badge>
                          ) : null}
                          {plan.features.multiBranchTransfer ? (
                            <Badge variant="outline">Chuyển kho</Badge>
                          ) : null}
                          {plan.features.omnichannelApi ? (
                            <Badge variant="secondary">API & Webhook TMĐT</Badge>
                          ) : null}
                        </div>
                      </CardContent>
                      <CardFooter>
                        <Button
                          className="w-full"
                          variant={isCurrent ? "outline" : "default"}
                          disabled={!canManageBilling || subscribeMutation.isPending}
                          onClick={() => void handleSelectPlan(plan)}
                        >
                          <CreditCardIcon data-icon="inline-start" />
                          {plan.code === "FREE_TRIAL"
                            ? "Gia hạn Dùng thử 30 ngày"
                            : isCurrent
                              ? `Gia hạn thêm ${billingMonths} tháng`
                              : `Chuyển sang ${plan.name}`}
                        </Button>
                      </CardFooter>
                    </Card>
                  );
                })}
              </div>
              {!canManageBilling ? (
                <p className="text-xs text-muted-foreground">
                  Chỉ Chủ cửa hàng (Owner) mới có quyền thực hiện nâng cấp hoặc thanh toán gói SaaS.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lịch sử giao dịch gói SaaS</CardTitle>
            </CardHeader>
            <CardContent>
              {data.billingHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Chưa có hóa đơn đăng ký hoặc nâng cấp gói nào.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="py-2 pr-3">Mã tham chiếu</th>
                        <th className="py-2 pr-3">Gói</th>
                        <th className="py-2 pr-3">Chu kỳ</th>
                        <th className="py-2 pr-3">Số tiền</th>
                        <th className="py-2 pr-3">Cổng TT</th>
                        <th className="py-2 pr-3">Trạng thái</th>
                        <th className="py-2">Hạn sử dụng</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.billingHistory.map((row) => (
                        <tr key={row.id} className="border-b last:border-0">
                          <td className="py-2 pr-3 font-mono text-xs">
                            {row.referenceNo ?? row.id.slice(0, 8)}
                          </td>
                          <td className="py-2 pr-3 font-medium">{row.planCode}</td>
                          <td className="py-2 pr-3">{row.billingMonths} tháng</td>
                          <td className="py-2 pr-3 font-mono">
                            {formatVndAmount(row.amount)}
                          </td>
                          <td className="py-2 pr-3 text-xs">{row.provider}</td>
                          <td className="py-2 pr-3">
                            <Badge
                              variant={
                                row.status === "PAID"
                                  ? "secondary"
                                  : row.status === "FAILED"
                                    ? "destructive"
                                    : "outline"
                              }
                            >
                              {BILLING_STATUS_LABELS[row.status]}
                            </Badge>
                          </td>
                          <td className="py-2 text-xs text-muted-foreground">
                            {new Date(row.periodStart).toLocaleDateString("vi-VN")} →{" "}
                            {new Date(row.periodEnd).toLocaleDateString("vi-VN")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Đang tải thông tin gói SaaS...</p>
      )}
    </div>
  );
}
