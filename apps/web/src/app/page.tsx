"use client";

import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboardIcon,
  LogInIcon,
  ScanBarcodeIcon,
  ShieldCheckIcon,
  StoreIcon,
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
import { Separator } from "@/components/ui/separator";
import { apiFetch } from "@/lib/api-client";

interface HealthLiveResponse {
  status: string;
  service: string;
  timestamp: string;
}

export default function HomePage() {
  const healthQuery = useQuery({
    queryKey: ["api-health-live"],
    queryFn: () => apiFetch<HealthLiveResponse>("/health/live"),
  });

  const apiBadge = healthQuery.isLoading ? (
    <Badge variant="secondary">Đang kiểm tra API...</Badge>
  ) : healthQuery.isSuccess ? (
    <Badge>API Online ({healthQuery.data.service})</Badge>
  ) : (
    <Badge variant="outline">API chưa kết nối (Dev Shell)</Badge>
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <StoreIcon className="size-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Smart-POS</h1>
          </div>
          {apiBadge}
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Nền tảng SaaS bán hàng &amp; quản lý kho đa chi nhánh. Tách biệt hai
          không gian vận hành cho quầy thu ngân và khu vực quản trị cửa hàng.
        </p>
      </header>

      <Separator />

      <section className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScanBarcodeIcon className="size-4 text-primary" />
              Khu Thu ngân (POS)
            </CardTitle>
            <CardDescription>
              Màn hình bán hàng tốc độ cao, quét mã vạch, nhiều tab hóa đơn chờ
              và thanh toán kết hợp.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Tối ưu cho máy cấu hình từ 4 GB RAM, hỗ trợ bộ nhớ đệm cục bộ
            IndexedDB và in bill K58/K80.
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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayoutDashboardIcon className="size-4 text-primary" />
              Khu Quản trị (Management)
            </CardTitle>
            <CardDescription>
              Quản lý hàng hóa, nhập hàng NCC, kiểm kho, thẻ kho bất biến và báo
              cáo lợi nhuận gộp.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Cô lập dữ liệu đa cửa hàng bằng PostgreSQL RLS và nhật ký kiểm toán
            AuditLog.
          </CardContent>
          <CardFooter>
            <Button
              variant="outline"
              className="w-full"
              render={<Link href="/dashboard" />}
              nativeButton={false}
            >
              <LayoutDashboardIcon data-icon="inline-start" />
              Vào trang Quản trị
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheckIcon className="size-4 text-primary" />
              Đăng nhập &amp; Đăng ký Shop
            </CardTitle>
            <CardDescription>
              Hỗ trợ đăng nhập Email cho Chủ shop/Quản lý và đăng nhập nhanh mã
              gian hàng + PIN cho Thu ngân.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Khởi tạo Tenant, chi nhánh mặc định và phân quyền RBAC chỉ trong một
            giao dịch an toàn.
          </CardContent>
          <CardFooter>
            <Button
              variant="secondary"
              className="w-full"
              render={<Link href="/login" />}
              nativeButton={false}
            >
              <LogInIcon data-icon="inline-start" />
              Cổng Đăng nhập
            </Button>
          </CardFooter>
        </Card>
      </section>
    </main>
  );
}
