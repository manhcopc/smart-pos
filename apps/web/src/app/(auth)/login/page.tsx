"use client";

import { cashierPinLoginSchema, ownerLoginSchema } from "@smart-pos/shared";
import {
  AlertCircleIcon,
  KeyRoundIcon,
  MailIcon,
  StoreIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCashierPinLogin, useOwnerLogin } from "@/hooks/use-auth";
import { formatApiError } from "@/lib/api-client";

export default function LoginPage() {
  const router = useRouter();
  const ownerLoginMutation = useOwnerLogin();
  const cashierPinMutation = useCashierPinLogin();

  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [ownerTenantSlug, setOwnerTenantSlug] = useState("");

  const [tenantSlug, setTenantSlug] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [pin, setPin] = useState("");

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleOwnerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const parsed = ownerLoginSchema.safeParse({
      email: ownerEmail,
      password: ownerPassword,
      ...(ownerTenantSlug.trim() ? { tenantSlug: ownerTenantSlug.trim() } : {}),
    });

    if (!parsed.success) {
      setErrorMessage(
        parsed.error.issues[0]?.message ?? "Thông tin đăng nhập chưa hợp lệ",
      );
      return;
    }

    try {
      const session = await ownerLoginMutation.mutateAsync(parsed.data);
      toast.success(`Xin chào ${session.user.fullName}`);
      router.replace(session.redirectTo);
    } catch (error) {
      setErrorMessage(
        formatApiError(error, "Không thể đăng nhập. Vui lòng thử lại."),
      );
    }
  }

  async function handleCashierSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const parsed = cashierPinLoginSchema.safeParse({
      tenantSlug,
      employeeCode,
      pin,
    });

    if (!parsed.success) {
      setErrorMessage(
        parsed.error.issues[0]?.message ?? "Thông tin PIN chưa hợp lệ",
      );
      return;
    }

    try {
      const session = await cashierPinMutation.mutateAsync(parsed.data);
      toast.success(`Ca làm việc: ${session.user.fullName}`);
      router.replace(session.redirectTo);
    } catch (error) {
      setErrorMessage(
        formatApiError(error, "Đăng nhập PIN thất bại. Vui lòng thử lại."),
      );
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
          <StoreIcon className="size-4 text-primary" />
          Smart-POS
        </Link>
        <Badge variant="outline">Multi-Tenant Auth</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Đăng nhập hệ thống</CardTitle>
          <CardDescription>
            Chọn chế độ đăng nhập cho Quản lý hoặc Thu ngân tại quầy.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {errorMessage ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Không thể đăng nhập</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          <Tabs
            defaultValue="owner"
            className="w-full"
            onValueChange={() => setErrorMessage(null)}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="owner">Chủ shop / Quản lý</TabsTrigger>
              <TabsTrigger value="cashier">Thu ngân (PIN)</TabsTrigger>
            </TabsList>

            <TabsContent value="owner" className="pt-4">
              <form onSubmit={handleOwnerSubmit} className="flex flex-col gap-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="owner-email">Email</FieldLabel>
                    <Input
                      id="owner-email"
                      type="email"
                      autoComplete="email"
                      placeholder="chu-shop@cuahang.vn"
                      value={ownerEmail}
                      onChange={(e) => setOwnerEmail(e.target.value)}
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="owner-password">Mật khẩu</FieldLabel>
                    <Input
                      id="owner-password"
                      type="password"
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={ownerPassword}
                      onChange={(e) => setOwnerPassword(e.target.value)}
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="owner-tenant-slug">
                      Mã cửa hàng (tùy chọn)
                    </FieldLabel>
                    <Input
                      id="owner-tenant-slug"
                      placeholder="chi-nhanh-cua-toi"
                      value={ownerTenantSlug}
                      onChange={(e) =>
                        setOwnerTenantSlug(e.target.value.toLowerCase())
                      }
                    />
                    <FieldDescription>
                      Chỉ cần nhập khi email gắn với nhiều cửa hàng.
                    </FieldDescription>
                  </Field>
                </FieldGroup>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={ownerLoginMutation.isPending}
                >
                  <MailIcon data-icon="inline-start" />
                  {ownerLoginMutation.isPending
                    ? "Đang xác thực..."
                    : "Đăng nhập Quản trị"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="cashier" className="pt-4">
              <form
                onSubmit={handleCashierSubmit}
                className="flex flex-col gap-4"
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="tenant-slug">Mã cửa hàng</FieldLabel>
                    <Input
                      id="tenant-slug"
                      placeholder="vi-du-shop"
                      value={tenantSlug}
                      onChange={(e) =>
                        setTenantSlug(e.target.value.toLowerCase())
                      }
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="employee-code">
                      Mã nhân viên
                    </FieldLabel>
                    <Input
                      id="employee-code"
                      placeholder="TN01"
                      value={employeeCode}
                      onChange={(e) =>
                        setEmployeeCode(e.target.value.toUpperCase())
                      }
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="cashier-pin">
                      Mã PIN (4–8 số)
                    </FieldLabel>
                    <Input
                      id="cashier-pin"
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="••••"
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                    />
                  </Field>
                </FieldGroup>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={cashierPinMutation.isPending}
                >
                  <KeyRoundIcon data-icon="inline-start" />
                  {cashierPinMutation.isPending
                    ? "Đang kiểm tra PIN..."
                    : "Vào quầy POS"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
        <CardFooter className="justify-between text-xs text-muted-foreground">
          <Link
            href="/register"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Đăng ký mở shop mới
          </Link>
          <Link href="/" className="underline underline-offset-4">
            Trang chủ
          </Link>
        </CardFooter>
      </Card>
    </main>
  );
}
