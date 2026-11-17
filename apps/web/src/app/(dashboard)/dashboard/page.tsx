"use client";

import { PERMISSIONS } from "@smart-pos/shared";
import {
  AlertTriangleIcon,
  BarChart3Icon,
  BoxesIcon,
  Building2Icon,
  PackagePlusIcon,
  RotateCcwIcon,
  ScanBarcodeIcon,
  ShieldCheckIcon,
  TrendingUpIcon,
  UsersIcon,
  WarehouseIcon,
} from "lucide-react";
import Link from "next/link";
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
import { useMe } from "@/hooks/use-auth";
import { useProducts } from "@/hooks/use-catalog";
import { useInventory } from "@/hooks/use-inventory";
import { useReportOverview } from "@/hooks/use-reports";
import {
  BUSINESS_TYPE_LABELS,
  formatVndAmount,
  ROLE_LABELS,
} from "@/lib/labels";

export default function DashboardPage() {
  const { data: profile } = useMe();
  const permissions = new Set(profile?.member.permissions ?? []);
  const canViewInventory = permissions.has(PERMISSIONS.INVENTORY_VIEW);
  const canViewFinancialReports = permissions.has(PERMISSIONS.REPORT_FINANCIAL);

  const defaultBranchId =
    profile?.branches.find((b) => b.isDefault)?.id ?? profile?.branches[0]?.id;

  const catalogQuery = useProducts({ page: 1, limit: 1 }, Boolean(profile) && canViewInventory);
  const inventoryQuery = useInventory(
    { page: 1, limit: 1, branchId: defaultBranchId },
    Boolean(profile) && canViewInventory,
  );
  const overviewQuery = useReportOverview(
    {},
    Boolean(profile) && canViewFinancialReports,
  );

  if (!profile) {
    return null;
  }

  const businessLabel =
    BUSINESS_TYPE_LABELS[
      profile.tenant.businessType as keyof typeof BUSINESS_TYPE_LABELS
    ] ?? profile.tenant.businessType;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Tổng quan cửa hàng</h1>
          <p className="text-sm text-muted-foreground">
            {profile.tenant.name} · Ngành hàng: {businessLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {profile.branches.length} chi nhánh khả dụng
          </Badge>
          <Badge>{ROLE_LABELS[profile.member.role]}</Badge>
        </div>
      </header>

      {canViewFinancialReports && overviewQuery.data ? (
        <section className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
                  <BarChart3Icon className="size-4 text-primary" />
                  Doanh thu thuần (30 ngày)
                </CardTitle>
              </CardHeader>
              <CardContent className="font-mono text-2xl font-semibold">
                {formatVndAmount(overviewQuery.data.kpis.netRevenue)}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
                  <TrendingUpIcon className="size-4 text-primary" />
                  Lợi nhuận gộp (30 ngày)
                </CardTitle>
              </CardHeader>
              <CardContent className="font-mono text-2xl font-semibold text-primary">
                {formatVndAmount(overviewQuery.data.kpis.grossProfit)}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Số đơn &amp; Giá trị TB
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-0.5">
                <span className="font-mono text-2xl font-semibold">
                  {overviewQuery.data.kpis.invoiceCount} đơn
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  TB: {formatVndAmount(overviewQuery.data.kpis.averageOrderValue)}
                </span>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
                  <RotateCcwIcon className="size-4 text-destructive" />
                  Tổng hoàn trả
                </CardTitle>
              </CardHeader>
              <CardContent className="font-mono text-2xl font-semibold text-destructive">
                {formatVndAmount(overviewQuery.data.kpis.refundTotal)}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top hàng bán chạy (30 ngày)</CardTitle>
                <CardDescription>Tổng hợp theo doanh số thực bán</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                {overviewQuery.data.topProducts.slice(0, 5).map((item) => (
                  <div
                    key={item.variantId}
                    className="flex items-center justify-between gap-2 border-b pb-1.5 last:border-none last:pb-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {item.productName} - {item.variantName}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {item.sku} · SL: {Number(item.quantitySold)}
                      </div>
                    </div>
                    <span className="font-mono font-semibold">
                      {formatVndAmount(item.revenue)}
                    </span>
                  </div>
                ))}
                {overviewQuery.data.topProducts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Chưa có giao dịch bán hàng trong khoảng thời gian này.
                  </p>
                ) : null}
              </CardContent>
              <CardFooter>
                <Button
                  variant="outline"
                  className="w-full"
                  render={<Link href="/dashboard/reports" />}
                  nativeButton={false}
                >
                  Xem báo cáo chi tiết &amp; Xuất Excel
                </Button>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangleIcon className="size-4 text-destructive" />
                  Cảnh báo tồn kho dưới định mức
                </CardTitle>
                <CardDescription>
                  Các SKU cần nhập hàng hoặc điều chuyển bổ sung
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                {overviewQuery.data.lowStockAlerts.slice(0, 5).map((alert) => (
                  <div
                    key={`${alert.branchId}-${alert.variantId}`}
                    className="flex items-center justify-between gap-2 border-b pb-1.5 last:border-none last:pb-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {alert.productName} ({alert.sku})
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {alert.branchName} · Ngưỡng: {alert.minStockAlert}
                      </div>
                    </div>
                    <Badge variant="destructive">Tồn: {Number(alert.onHand)}</Badge>
                  </div>
                ))}
                {overviewQuery.data.lowStockAlerts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Tất cả mặt hàng đều đạt định mức tồn kho an toàn.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </section>
      ) : null}

      {canViewInventory ? (
        <section className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BoxesIcon className="size-4 text-primary" />
                Danh mục SKU
              </CardTitle>
              <CardDescription>
                Hạn mức theo gói {profile.tenant.planCode}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {catalogQuery.data
                ? `${catalogQuery.data.quota.activeSkus} / ${catalogQuery.data.quota.maxSkus}`
                : "—"}
            </CardContent>
            <CardFooter>
              <Button
                variant="outline"
                className="w-full"
                render={<Link href="/dashboard/products" />}
                nativeButton={false}
              >
                Mở danh mục hàng hóa
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <WarehouseIcon className="size-4 text-primary" />
                Giá trị tồn kho (chi nhánh chính)
              </CardTitle>
              <CardDescription>
                Tính theo giá vốn bình quân gia quyền (AVCO)
              </CardDescription>
            </CardHeader>
            <CardContent className="font-mono text-2xl font-semibold">
              {inventoryQuery.data
                ? formatVndAmount(inventoryQuery.data.summary.totalStockValue)
                : "0 ₫"}
            </CardContent>
            <CardFooter className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                render={<Link href="/dashboard/inventory" />}
                nativeButton={false}
              >
                Xem tồn &amp; Thẻ kho
              </Button>
              {permissions.has(PERMISSIONS.INVENTORY_RECEIVE) ? (
                <Button
                  className="flex-1"
                  render={<Link href="/dashboard/purchase-orders" />}
                  nativeButton={false}
                >
                  <PackagePlusIcon data-icon="inline-start" />
                  Nhập hàng
                </Button>
              ) : null}
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangleIcon className="size-4 text-destructive" />
                Cảnh báo tồn tối thiểu
              </CardTitle>
              <CardDescription>
                Số SKU có tồn kho &le; min_stock_alert
              </CardDescription>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {inventoryQuery.data
                ? `${inventoryQuery.data.summary.lowStockCount} SKU`
                : "0 SKU"}
            </CardContent>
            <CardFooter>
              <Button
                variant="outline"
                className="w-full"
                render={<Link href="/dashboard/inventory?lowStock=true" />}
                nativeButton={false}
              >
                Kiểm tra hàng sắp hết
              </Button>
            </CardFooter>
          </Card>
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2Icon className="size-4 text-primary" />
              Chi nhánh vận hành
            </CardTitle>
            <CardDescription>
              Quản lý địa điểm bán hàng, chi nhánh mặc định và hạn mức gói.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {profile.branches.map((branch) => (
              <div
                key={branch.id}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate font-medium">
                  {branch.code} · {branch.name}
                </span>
                {branch.isDefault ? (
                  <Badge variant="secondary">Mặc định</Badge>
                ) : null}
              </div>
            ))}
          </CardContent>
          <CardFooter>
            {permissions.has(PERMISSIONS.BRANCH_MANAGE) ? (
              <Button
                variant="outline"
                className="w-full"
                render={<Link href="/dashboard/branches" />}
                nativeButton={false}
              >
                Quản lý chi nhánh
              </Button>
            ) : (
              <Badge variant="secondary">Chỉ xem</Badge>
            )}
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersIcon className="size-4 text-primary" />
              Nhân viên &amp; RBAC
            </CardTitle>
            <CardDescription>
              Cấp mã PIN thu ngân, phân quyền vai trò và giới hạn chi nhánh làm
              việc.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Bạn đang đăng nhập với mã nhân viên{" "}
            <span className="font-mono font-medium text-foreground">
              {profile.member.employeeCode}
            </span>{" "}
            ({profile.member.permissions.length} quyền hiệu lực).
          </CardContent>
          <CardFooter>
            {permissions.has(PERMISSIONS.STAFF_MANAGE) ? (
              <Button
                variant="outline"
                className="w-full"
                render={<Link href="/dashboard/staff" />}
                nativeButton={false}
              >
                Quản lý nhân viên
              </Button>
            ) : (
              <Badge variant="secondary">Không có quyền STAFF_MANAGE</Badge>
            )}
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheckIcon className="size-4 text-primary" />
              Bán hàng tại quầy (POS)
            </CardTitle>
            <CardDescription>
              Chuyển nhanh sang màn hình bán hàng hoặc đổi ca cho thu ngân bằng
              PIN.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Mã cửa hàng dùng cho đăng nhập nhanh:{" "}
            <span className="font-mono font-medium text-foreground">
              {profile.tenant.slug}
            </span>
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              render={<Link href="/pos" />}
              nativeButton={false}
            >
              <ScanBarcodeIcon data-icon="inline-start" />
              Mở màn hình POS
            </Button>
          </CardFooter>
        </Card>
      </section>
    </div>
  );
}
