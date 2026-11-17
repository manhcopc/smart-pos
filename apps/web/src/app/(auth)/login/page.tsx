"use client";

import { cashierPinLoginSchema, ownerLoginSchema } from "@smart-pos/shared";
import { KeyRoundIcon, MailIcon, StoreIcon } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function LoginPage() {
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [pin, setPin] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  function handleOwnerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = ownerLoginSchema.safeParse({
      email: ownerEmail,
      password: ownerPassword,
    });
    if (!parsed.success) {
      setFeedback(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
      return;
    }
    setFeedback(
      "Định dạng hợp lệ — API xác thực sẽ được nối ở Phase 1 (/auth/login).",
    );
  }

  function handleCashierSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = cashierPinLoginSchema.safeParse({
      tenantSlug,
      employeeCode,
      pin,
    });
    if (!parsed.success) {
      setFeedback(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
      return;
    }
    setFeedback(
      "Định dạng hợp lệ — API đổi ca nhanh sẽ được nối ở Phase 1 (/auth/cashier-pin).",
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
          <StoreIcon className="size-4 text-primary" />
          Smart-POS
        </Link>
        <Badge variant="outline">Phase 0 Shell</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Đăng nhập hệ thống</CardTitle>
          <CardDescription>
            Chọn chế độ đăng nhập cho Quản lý hoặc Thu ngân tại quầy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="owner" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="owner">Chủ shop / Quản lý</TabsTrigger>
              <TabsTrigger value="cashier">Thu ngân (PIN)</TabsTrigger>
            </TabsList>

            <TabsContent value="owner" className="pt-4">
              <form
                onSubmit={handleOwnerSubmit}
                className="flex flex-col gap-3"
              >
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="owner-email" className="text-xs font-medium">
                    Email
                  </label>
                  <Input
                    id="owner-email"
                    type="email"
                    placeholder="chu-shop@cuahang.vn"
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="owner-password"
                    className="text-xs font-medium"
                  >
                    Mật khẩu
                  </label>
                  <Input
                    id="owner-password"
                    type="password"
                    placeholder="••••••••"
                    value={ownerPassword}
                    onChange={(e) => setOwnerPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="mt-1 w-full">
                  <MailIcon data-icon="inline-start" />
                  Đăng nhập Quản trị
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="cashier" className="pt-4">
              <form
                onSubmit={handleCashierSubmit}
                className="flex flex-col gap-3"
              >
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="tenant-slug" className="text-xs font-medium">
                    Mã gian hàng
                  </label>
                  <Input
                    id="tenant-slug"
                    placeholder="vi-du-shop"
                    value={tenantSlug}
                    onChange={(e) => setTenantSlug(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="employee-code"
                    className="text-xs font-medium"
                  >
                    Mã nhân viên
                  </label>
                  <Input
                    id="employee-code"
                    placeholder="NV01"
                    value={employeeCode}
                    onChange={(e) => setEmployeeCode(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cashier-pin" className="text-xs font-medium">
                    Mã PIN (4–8 số)
                  </label>
                  <Input
                    id="cashier-pin"
                    type="password"
                    inputMode="numeric"
                    placeholder="••••"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                  />
                </div>
                <Button type="submit" className="mt-1 w-full">
                  <KeyRoundIcon data-icon="inline-start" />
                  Vào quầy POS
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          {feedback ? (
            <p className="mt-4 text-xs text-muted-foreground">{feedback}</p>
          ) : null}
        </CardContent>
        <CardFooter className="justify-between text-xs text-muted-foreground">
          <span>Multi-tenant SaaS</span>
          <Link href="/" className="underline underline-offset-4">
            Quay lại trang chủ
          </Link>
        </CardFooter>
      </Card>
    </main>
  );
}
