"use client";

import { PERMISSIONS, type Permission } from "@smart-pos/shared";
import {
  ArrowLeftRightIcon,
  BarChart3Icon,
  BoxesIcon,
  Building2Icon,
  ClipboardCheckIcon,
  CreditCardIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  PackagePlusIcon,
  ScanBarcodeIcon,
  ScrollTextIcon,
  StoreIcon,
  UserCheckIcon,
  UsersIcon,
  WarehouseIcon,
  WebhookIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useLogout, useMe } from "@/hooks/use-auth";
import { formatApiError } from "@/lib/api-client";
import { ROLE_LABELS } from "@/lib/labels";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboardIcon;
  requiredAnyPermissions?: readonly Permission[];
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Tổng quan", icon: LayoutDashboardIcon },
  {
    href: "/dashboard/products",
    label: "Hàng hóa & Mã vạch",
    icon: BoxesIcon,
    requiredAnyPermissions: [PERMISSIONS.INVENTORY_VIEW],
  },
  {
    href: "/dashboard/inventory",
    label: "Tồn kho & Thẻ kho",
    icon: WarehouseIcon,
    requiredAnyPermissions: [PERMISSIONS.INVENTORY_VIEW],
  },
  {
    href: "/dashboard/purchase-orders",
    label: "Nhập hàng & NCC",
    icon: PackagePlusIcon,
    requiredAnyPermissions: [PERMISSIONS.INVENTORY_RECEIVE],
  },
  {
    href: "/dashboard/stock-counts",
    label: "Kiểm kho",
    icon: ClipboardCheckIcon,
    requiredAnyPermissions: [PERMISSIONS.INVENTORY_COUNT],
  },
  {
    href: "/dashboard/transfers",
    label: "Điều chuyển kho",
    icon: ArrowLeftRightIcon,
    requiredAnyPermissions: [PERMISSIONS.INVENTORY_TRANSFER],
  },
  {
    href: "/dashboard/customers",
    label: "Khách hàng & Loyalty",
    icon: UserCheckIcon,
    requiredAnyPermissions: [PERMISSIONS.CUSTOMER_VIEW],
  },
  {
    href: "/dashboard/reports",
    label: "Báo cáo & Xuất Excel",
    icon: BarChart3Icon,
    requiredAnyPermissions: [PERMISSIONS.REPORT_FINANCIAL],
  },
  {
    href: "/dashboard/audit-logs",
    label: "Nhật ký kiểm toán",
    icon: ScrollTextIcon,
    requiredAnyPermissions: [PERMISSIONS.AUDIT_VIEW],
  },
  {
    href: "/dashboard/branches",
    label: "Chi nhánh",
    icon: Building2Icon,
    requiredAnyPermissions: [PERMISSIONS.BRANCH_MANAGE],
  },
  {
    href: "/dashboard/staff",
    label: "Nhân viên & Phân quyền",
    icon: UsersIcon,
    requiredAnyPermissions: [PERMISSIONS.STAFF_MANAGE],
  },
  {
    href: "/dashboard/integrations",
    label: "Tích hợp & Kế toán",
    icon: WebhookIcon,
    requiredAnyPermissions: [
      PERMISSIONS.INTEGRATION_MANAGE,
      PERMISSIONS.REPORT_FINANCIAL,
    ],
  },
  {
    href: "/dashboard/billing",
    label: "Gói SaaS & Thanh toán",
    icon: CreditCardIcon,
    requiredAnyPermissions: [PERMISSIONS.BRANCH_MANAGE],
  },
];

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const meQuery = useMe();
  const logoutMutation = useLogout();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (meQuery.isError) {
      router.replace("/login");
    } else if (meQuery.data?.redirectTo === "/pos") {
      router.replace("/pos");
    }
  }, [meQuery.isError, meQuery.data?.redirectTo, router]);

  async function handleLogout() {
    try {
      await logoutMutation.mutateAsync();
      toast.success("Đã đăng xuất khỏi hệ thống");
      router.replace("/login");
    } catch (error) {
      toast.error(formatApiError(error, "Không thể đăng xuất."));
    }
  }

  if (meQuery.isLoading) {
    return (
      <div
        className="grid min-h-screen md:grid-cols-[260px_1fr]"
        aria-label="Đang tải phiên làm việc"
      >
        <aside className="hidden flex-col gap-4 border-r bg-sidebar p-4 md:flex">
          <Skeleton className="h-9 w-full" />
          <Separator />
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, idx) => (
              <Skeleton key={idx} className="h-8 w-full" />
            ))}
          </div>
        </aside>
        <main className="flex flex-col gap-6 p-6">
          <Skeleton className="h-8 w-64" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, idx) => (
              <Skeleton key={idx} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (meQuery.isError || !meQuery.data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Phiên đăng nhập chưa sẵn sàng</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Vui lòng đăng nhập để truy cập khu quản trị cửa hàng.
            </p>
            <Button render={<Link href="/login" />} nativeButton={false}>
              Đi đến trang đăng nhập
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const profile = meQuery.data;
  if (profile.redirectTo === "/pos") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Chuyển hướng sang màn hình POS</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Tài khoản Thu ngân chỉ hoạt động tại quầy bán hàng POS.
            </p>
            <Button render={<Link href="/pos" />} nativeButton={false}>
              Mở màn hình POS
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const permissionSet = new Set(profile.member.permissions);
  const visibleNavItems = NAV_ITEMS.filter(
    (item) =>
      !item.requiredAnyPermissions ||
      item.requiredAnyPermissions.some((perm) => permissionSet.has(perm)),
  );

  function renderSidebarBody(onNavigate?: () => void) {
    return (
      <>
        <div className="flex items-start justify-between gap-2">
          <Link
            href="/dashboard"
            onClick={onNavigate}
            className="flex min-w-0 items-center gap-2"
          >
            <StoreIcon className="size-4 shrink-0 text-primary" />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold leading-tight">
                {profile.tenant.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                @{profile.tenant.slug}
              </span>
            </div>
          </Link>
          <div className="flex items-center gap-1">
            <Badge variant="secondary">{profile.tenant.planCode}</Badge>
            <ThemeToggle />
          </div>
        </div>

        <Separator />

        <nav aria-label="Điều hướng quản trị" className="flex flex-col gap-1">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Button
                key={item.href}
                variant={active ? "secondary" : "ghost"}
                className="justify-start"
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                render={<Link href={item.href} />}
                nativeButton={false}
              >
                <Icon data-icon="inline-start" />
                {item.label}
              </Button>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          <Button
            className="w-full"
            onClick={onNavigate}
            render={<Link href="/pos" />}
            nativeButton={false}
          >
            <ScanBarcodeIcon data-icon="inline-start" />
            Mở quầy POS
          </Button>

          <Separator />

          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-foreground">
                {profile.user.fullName}
              </span>
              <span className="truncate text-muted-foreground">
                {profile.member.employeeCode} · {ROLE_LABELS[profile.member.role]}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Đăng xuất"
              onClick={handleLogout}
              disabled={logoutMutation.isPending}
            >
              <LogOutIcon />
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="flex min-h-screen flex-col md:grid md:grid-cols-[260px_1fr]">
      {/* Mobile/Small Tablet Topbar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b bg-card px-4 py-2.5 md:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Mở menu điều hướng"
                />
              }
            >
              <MenuIcon />
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-4">
              <SheetHeader className="sr-only">
                <SheetTitle>Menu Quản trị</SheetTitle>
                <SheetDescription>
                  Điều hướng các phân hệ quản trị Smart-POS
                </SheetDescription>
              </SheetHeader>
              <div className="flex h-full flex-col gap-4 pt-4">
                {renderSidebarBody(() => setMobileMenuOpen(false))}
              </div>
            </SheetContent>
          </Sheet>

          <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
            <StoreIcon className="size-4 shrink-0 text-primary" />
            <span className="truncate text-sm font-semibold">
              {profile.tenant.name}
            </span>
          </Link>
        </div>

        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <Button
            size="sm"
            render={<Link href="/pos" />}
            nativeButton={false}
          >
            <ScanBarcodeIcon data-icon="inline-start" />
            POS
          </Button>
        </div>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden flex-col gap-4 border-r bg-sidebar p-4 md:flex">
        {renderSidebarBody()}
      </aside>

      <main className="flex min-w-0 flex-col gap-6 p-4 md:p-6">{children}</main>
    </div>
  );
}
