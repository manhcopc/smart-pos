"use client";

import {
  CreditCardIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  PrinterIcon,
  SearchIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLogout, useMe } from "@/hooks/use-auth";
import { ROLE_LABELS } from "@/lib/labels";

export default function PosTerminalPage() {
  const router = useRouter();
  const meQuery = useMe();
  const logoutMutation = useLogout();
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");

  useEffect(() => {
    if (meQuery.isError) {
      router.replace("/login");
    }
  }, [meQuery.isError, router]);

  useEffect(() => {
    const branches = meQuery.data?.branches;
    if (branches && branches.length > 0 && !selectedBranchId) {
      const def = branches.find((b) => b.isDefault) ?? branches[0];
      if (def) setSelectedBranchId(def.id);
    }
  }, [meQuery.data?.branches, selectedBranchId]);

  async function handleLogout() {
    await logoutMutation.mutateAsync();
    toast.success("Đã kết thúc phiên làm việc");
    router.replace("/login");
  }

  if (meQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          Đang tải quầy thu ngân...
        </p>
      </div>
    );
  }

  if (meQuery.isError || !meQuery.data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Yêu cầu đăng nhập POS</CardTitle>
            <CardDescription>
              Vui lòng đăng nhập bằng Email hoặc mã nhân viên + PIN để mở quầy.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              className="w-full"
              render={<Link href="/login" />}
              nativeButton={false}
            >
              Đến cổng đăng nhập
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const profile = meQuery.data;
  const activeBranch =
    profile.branches.find((b) => b.id === selectedBranchId) ??
    profile.branches[0];
  const canOpenDashboard = profile.member.role !== "CASHIER";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-sm font-semibold">{profile.tenant.name}</span>
          <Badge variant="secondary">
            {profile.user.fullName} ({profile.member.employeeCode}) ·{" "}
            {ROLE_LABELS[profile.member.role]}
          </Badge>

          {profile.branches.length > 0 ? (
            <Select
              value={activeBranch?.id ?? ""}
              onValueChange={(value) => {
                if (value) setSelectedBranchId(value);
              }}
            >
              <SelectTrigger size="sm" className="w-48">
                <SelectValue>
                  {activeBranch
                    ? `${activeBranch.code} · ${activeBranch.name}`
                    : "Chọn chi nhánh"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {profile.branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.code} · {branch.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : null}
        </div>

        <div className="flex flex-1 items-center gap-2 md:max-w-md">
          <SearchIcon className="size-4 text-muted-foreground" />
          <Input
            aria-label="Tìm hàng hóa hoặc quét mã vạch"
            placeholder="Tìm tên hàng, SKU hoặc quét mã vạch (F2)..."
          />
        </div>

        <div className="flex items-center gap-2">
          {canOpenDashboard ? (
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/dashboard" />}
              nativeButton={false}
            >
              <LayoutDashboardIcon data-icon="inline-start" />
              Quản trị
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            disabled={logoutMutation.isPending}
          >
            <LogOutIcon data-icon="inline-start" />
            Đổi ca
          </Button>
        </div>
      </header>

      <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[1fr_380px]">
        <section className="flex flex-col gap-4">
          <Tabs defaultValue="inv-1">
            <TabsList>
              <TabsTrigger value="inv-1">Hóa đơn 1</TabsTrigger>
              <TabsTrigger value="inv-2">Hóa đơn 2</TabsTrigger>
            </TabsList>
            <TabsContent value="inv-1" className="pt-2">
              <Card>
                <CardHeader>
                  <CardTitle>Giỏ hàng hiện tại</CardTitle>
                  <CardDescription>
                    Chi nhánh:{" "}
                    {activeBranch
                      ? `${activeBranch.code} · ${activeBranch.name}`
                      : "Chưa gán chi nhánh"}
                    . Danh mục đồng bộ IndexedDB sẽ hiển thị tại đây ở Phase 3.
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Chưa có sản phẩm nào trong hóa đơn. Quét mã vạch hoặc bấm nút
                  Quick-keys để thêm hàng.
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="inv-2" className="pt-2">
              <Card>
                <CardHeader>
                  <CardTitle>Hóa đơn chờ 2</CardTitle>
                  <CardDescription>
                    Giữ song song nhiều hóa đơn khi khách chọn thêm đồ.
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Tab hóa đơn chờ đang trống.
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </section>

        <aside>
          <Card>
            <CardHeader>
              <CardTitle>Thanh toán (Split Payment)</CardTitle>
              <CardDescription>
                Tiền mặt · VietQR · Thẻ · Điểm tích lũy
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Tạm tính</span>
                <span className="font-mono font-medium">0.00 ₫</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Giảm giá</span>
                <span className="font-mono font-medium">0.00 ₫</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between text-base font-semibold">
                <span>Khách cần trả</span>
                <span className="font-mono">0.00 ₫</span>
              </div>
            </CardContent>
            <CardFooter className="flex gap-2">
              <Button variant="outline" className="flex-1" type="button">
                <PrinterIcon data-icon="inline-start" />
                In tạm tính
              </Button>
              <Button className="flex-1" type="button">
                <CreditCardIcon data-icon="inline-start" />
                Thanh toán (F9)
              </Button>
            </CardFooter>
          </Card>
        </aside>
      </div>
    </div>
  );
}
