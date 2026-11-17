"use client";

import { PERMISSIONS } from "@smart-pos/shared";
import {
  BoxesIcon,
  Building2Icon,
  ClipboardCheckIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  PackagePlusIcon,
  ScanBarcodeIcon,
  StoreIcon,
  UsersIcon,
  WarehouseIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useLogout, useMe } from "@/hooks/use-auth";
import { ROLE_LABELS } from "@/lib/labels";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboardIcon;
  requiredPermission?: (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Tổng quan", icon: LayoutDashboardIcon },
  {
    href: "/dashboard/products",
    label: "Hàng hóa & Mã vạch",
    icon: BoxesIcon,
    requiredPermission: PERMISSIONS.INVENTORY_VIEW,
  },
  {
    href: "/dashboard/inventory",
    label: "Tồn kho & Thẻ kho",
    icon: WarehouseIcon,
    requiredPermission: PERMISSIONS.INVENTORY_VIEW,
  },
  {
    href: "/dashboard/purchase-orders",
    label: "Nhập hàng & NCC",
    icon: PackagePlusIcon,
    requiredPermission: PERMISSIONS.INVENTORY_RECEIVE,
  },
  {
    href: "/dashboard/stock-counts",
    label: "Kiểm kho",
    icon: ClipboardCheckIcon,
    requiredPermission: PERMISSIONS.INVENTORY_COUNT,
  },
  {
    href: "/dashboard/branches",
    label: "Chi nhánh",
    icon: Building2Icon,
    requiredPermission: PERMISSIONS.BRANCH_MANAGE,
  },
  {
    href: "/dashboard/staff",
    label: "Nhân viên & RBAC",
    icon: UsersIcon,
    requiredPermission: PERMISSIONS.STAFF_MANAGE,
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

  useEffect(() => {
    if (meQuery.isError) {
      router.replace("/login");
    } else if (meQuery.data?.redirectTo === "/pos") {
      router.replace("/pos");
    }
  }, [meQuery.isError, meQuery.data?.redirectTo, router]);

  async function handleLogout() {
    await logoutMutation.mutateAsync();
    toast.success("Đã đăng xuất khỏi hệ thống");
    router.replace("/login");
  }

  if (meQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          Đang tải phiên làm việc...
        </p>
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
    (item) => !item.requiredPermission || permissionSet.has(item.requiredPermission),
  );

  return (
    <div className="grid min-h-screen md:grid-cols-[260px_1fr]">
      <aside className="flex flex-col gap-4 border-r bg-muted/30 p-4">
        <div className="flex items-start justify-between gap-2">
          <Link href="/dashboard" className="flex items-center gap-2">
            <StoreIcon className="size-4 text-primary" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold leading-tight">
                {profile.tenant.name}
              </span>
              <span className="text-xs text-muted-foreground">
                @{profile.tenant.slug}
              </span>
            </div>
          </Link>
          <Badge variant="secondary">{profile.tenant.planCode}</Badge>
        </div>

        <Separator />

        <nav className="flex flex-col gap-1">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Button
                key={item.href}
                variant={active ? "secondary" : "ghost"}
                className="justify-start"
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
            render={<Link href="/pos" />}
            nativeButton={false}
          >
            <ScanBarcodeIcon data-icon="inline-start" />
            Mở quầy POS
          </Button>

          <Separator />

          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex flex-col">
              <span className="font-medium text-foreground">
                {profile.user.fullName}
              </span>
              <span className="text-muted-foreground">
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
      </aside>

      <main className="flex flex-col gap-6 p-6">{children}</main>
    </div>
  );
}
