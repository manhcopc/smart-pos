"use client";

import { PERMISSIONS } from "@smart-pos/shared";
import {
  Building2Icon,
  ScanBarcodeIcon,
  ShieldCheckIcon,
  UsersIcon,
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
import { BUSINESS_TYPE_LABELS, ROLE_LABELS } from "@/lib/labels";

export default function DashboardPage() {
  const { data: profile } = useMe();
  if (!profile) {
    return null;
  }

  const permissions = new Set(profile.member.permissions);
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
