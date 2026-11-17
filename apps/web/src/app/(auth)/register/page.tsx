"use client";

import {
  BUSINESS_TYPES,
  type BusinessType,
  registerTenantSchema,
} from "@smart-pos/shared";
import { AlertCircleIcon, StoreIcon, UserPlusIcon } from "lucide-react";
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
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRegisterTenant } from "@/hooks/use-auth";
import { formatApiError } from "@/lib/api-client";
import { BUSINESS_TYPE_LABELS, slugifyShopName } from "@/lib/labels";

export default function RegisterTenantPage() {
  const router = useRouter();
  const registerMutation = useRegisterTenant();

  const [shopName, setShopName] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [businessType, setBusinessType] = useState<BusinessType>("RETAIL");
  const [branchName, setBranchName] = useState("Chi nhánh trung tâm");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleShopNameChange(nextName: string) {
    setShopName(nextName);
    if (!slugTouched) {
      setTenantSlug(slugifyShopName(nextName));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);
    setFieldErrors({});

    const parsed = registerTenantSchema.safeParse({
      shopName,
      tenantSlug,
      businessType,
      ownerName,
      email,
      password,
      phone,
      branchName,
    });

    if (!parsed.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!nextErrors[key]) {
          nextErrors[key] = issue.message;
        }
      }
      setFieldErrors(nextErrors);
      return;
    }

    try {
      const session = await registerMutation.mutateAsync(parsed.data);
      toast.success("Khởi tạo cửa hàng thành công!");
      router.replace(session.redirectTo);
    } catch (error) {
      setSubmitError(
        formatApiError(error, "Không thể đăng ký cửa hàng. Vui lòng kiểm tra lại."),
      );
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
          <StoreIcon className="size-4 text-primary" />
          Smart-POS
        </Link>
        <Badge variant="secondary">Dùng thử 14 ngày miễn phí</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Đăng ký mở cửa hàng mới</CardTitle>
          <CardDescription>
            Tự động khởi tạo Tenant, chi nhánh mặc định CN01 và tài khoản Chủ cửa
            hàng trong một giao dịch.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {submitError ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>Đăng ký thất bại</AlertTitle>
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            ) : null}

            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={Boolean(fieldErrors.shopName)}>
                  <FieldLabel htmlFor="shop-name">Tên cửa hàng</FieldLabel>
                  <Input
                    id="shop-name"
                    placeholder="Cửa hàng Minh Anh"
                    value={shopName}
                    onChange={(e) => handleShopNameChange(e.target.value)}
                    aria-invalid={Boolean(fieldErrors.shopName)}
                  />
                  {fieldErrors.shopName ? (
                    <FieldError>{fieldErrors.shopName}</FieldError>
                  ) : null}
                </Field>

                <Field data-invalid={Boolean(fieldErrors.tenantSlug)}>
                  <FieldLabel htmlFor="tenant-slug">
                    Mã cửa hàng (Slug)
                  </FieldLabel>
                  <Input
                    id="tenant-slug"
                    placeholder="cua-hang-minh-anh"
                    value={tenantSlug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setTenantSlug(e.target.value.toLowerCase());
                    }}
                    aria-invalid={Boolean(fieldErrors.tenantSlug)}
                  />
                  <FieldDescription>
                    Dùng để thu ngân đăng nhập nhanh tại quầy POS.
                  </FieldDescription>
                  {fieldErrors.tenantSlug ? (
                    <FieldError>{fieldErrors.tenantSlug}</FieldError>
                  ) : null}
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="business-type">Ngành hàng</FieldLabel>
                  <Select
                    value={businessType}
                    onValueChange={(value) => {
                      if (value) {
                        setBusinessType(value as BusinessType);
                      }
                    }}
                  >
                    <SelectTrigger id="business-type" className="w-full">
                      <SelectValue>
                        {BUSINESS_TYPE_LABELS[businessType]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {BUSINESS_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {BUSINESS_TYPE_LABELS[type]}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field data-invalid={Boolean(fieldErrors.branchName)}>
                  <FieldLabel htmlFor="branch-name">
                    Tên chi nhánh mặc định (CN01)
                  </FieldLabel>
                  <Input
                    id="branch-name"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    aria-invalid={Boolean(fieldErrors.branchName)}
                  />
                  {fieldErrors.branchName ? (
                    <FieldError>{fieldErrors.branchName}</FieldError>
                  ) : null}
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={Boolean(fieldErrors.ownerName)}>
                  <FieldLabel htmlFor="owner-name">Họ tên Chủ shop</FieldLabel>
                  <Input
                    id="owner-name"
                    placeholder="Nguyễn Văn A"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    aria-invalid={Boolean(fieldErrors.ownerName)}
                  />
                  {fieldErrors.ownerName ? (
                    <FieldError>{fieldErrors.ownerName}</FieldError>
                  ) : null}
                </Field>

                <Field data-invalid={Boolean(fieldErrors.phone)}>
                  <FieldLabel htmlFor="owner-phone">Số điện thoại</FieldLabel>
                  <Input
                    id="owner-phone"
                    type="tel"
                    placeholder="0901234567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    aria-invalid={Boolean(fieldErrors.phone)}
                  />
                  {fieldErrors.phone ? (
                    <FieldError>{fieldErrors.phone}</FieldError>
                  ) : null}
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={Boolean(fieldErrors.email)}>
                  <FieldLabel htmlFor="owner-email">Email đăng nhập</FieldLabel>
                  <Input
                    id="owner-email"
                    type="email"
                    placeholder="chu-shop@cuahang.vn"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-invalid={Boolean(fieldErrors.email)}
                  />
                  {fieldErrors.email ? (
                    <FieldError>{fieldErrors.email}</FieldError>
                  ) : null}
                </Field>

                <Field data-invalid={Boolean(fieldErrors.password)}>
                  <FieldLabel htmlFor="owner-password">Mật khẩu</FieldLabel>
                  <Input
                    id="owner-password"
                    type="password"
                    placeholder="Ít nhất 8 ký tự"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={Boolean(fieldErrors.password)}
                  />
                  {fieldErrors.password ? (
                    <FieldError>{fieldErrors.password}</FieldError>
                  ) : null}
                </Field>
              </div>
            </FieldGroup>

            <Button
              type="submit"
              className="w-full"
              disabled={registerMutation.isPending}
            >
              <UserPlusIcon data-icon="inline-start" />
              {registerMutation.isPending
                ? "Đang khởi tạo cửa hàng..."
                : "Tạo cửa hàng & Bắt đầu dùng thử"}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-between text-xs text-muted-foreground">
          <span>Đã có tài khoản?</span>
          <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
            Đăng nhập ngay
          </Link>
        </CardFooter>
      </Card>
    </main>
  );
}
