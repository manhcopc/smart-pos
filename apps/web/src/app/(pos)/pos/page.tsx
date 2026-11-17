"use client";

import {
  calculatePosInvoiceTotals,
  openShiftSchema,
  PAYMENT_METHODS,
  type PaymentMethod,
  PERMISSIONS,
  type PosCatalogItem,
  type InvoiceReceiptResponse,
} from "@smart-pos/shared";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CreditCardIcon,
  LayoutDashboardIcon,
  LockOpenIcon,
  LogOutIcon,
  MinusIcon,
  PlusIcon,
  PrinterIcon,
  ReceiptIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  WifiIcon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ShiftZReportDialog } from "@/components/pos/shift-z-report-dialog";
import { ThermalReceiptDialog } from "@/components/pos/thermal-receipt-dialog";
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
import { useLogout, useMe } from "@/hooks/use-auth";
import {
  useCurrentShift,
  useOpenShift,
  usePosCatalog,
  usePosCheckout,
  usePosInvoices,
} from "@/hooks/use-pos";
import { formatApiError } from "@/lib/api-client";
import {
  formatVndAmount,
  PAYMENT_METHOD_LABELS,
  ROLE_LABELS,
} from "@/lib/labels";
import { searchPosCatalog } from "@/lib/pos-indexeddb";

interface CartLineState {
  variantId: string;
  sku: string;
  name: string;
  unit: string;
  catalogPrice: string;
  taxRate: string;
  quantity: string;
  discountAmount: string;
  overrideUnitPrice?: string;
}

interface PaymentLegState {
  method: PaymentMethod;
  amount: string;
  referenceNo: string;
}

interface PendingInvoiceTab {
  id: string;
  label: string;
  idempotencyKey: string;
  items: CartLineState[];
  invoiceDiscountAmount: string;
  payments: PaymentLegState[];
}

function makeUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function createEmptyTab(index: number): PendingInvoiceTab {
  return {
    id: `tab-${index}-${Date.now()}`,
    label: `Hóa đơn ${index}`,
    idempotencyKey: makeUuid(),
    items: [],
    invoiceDiscountAmount: "0.00",
    payments: [{ method: "CASH", amount: "0.00", referenceNo: "" }],
  };
}

const QUICK_CASH_NOTES = [
  { label: "50k", amount: "50000.00" },
  { label: "100k", amount: "100000.00" },
  { label: "200k", amount: "200000.00" },
  { label: "500k", amount: "500000.00" },
] as const;

export default function PosTerminalPage() {
  const router = useRouter();
  const meQuery = useMe();
  const logoutMutation = useLogout();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );

  const [tabs, setTabs] = useState<PendingInvoiceTab[]>(() => [
    createEmptyTab(1),
    createEmptyTab(2),
  ]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [openingCash, setOpeningCash] = useState("500000.00");
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [activeReceipt, setActiveReceipt] =
    useState<InvoiceReceiptResponse | null>(null);
  const [zReportOpen, setZReportOpen] = useState(false);
  const [showRecentInvoices, setShowRecentInvoices] = useState(false);

  const profile = meQuery.data;

  useEffect(() => {
    if (meQuery.isError) {
      router.replace("/login");
    }
  }, [meQuery.isError, router]);

  useEffect(() => {
    const branches = profile?.branches;
    if (branches && branches.length > 0 && !selectedBranchId) {
      const def = branches.find((b) => b.isDefault) ?? branches[0];
      if (def) setSelectedBranchId(def.id);
    }
  }, [profile?.branches, selectedBranchId]);

  const activeBranch =
    profile?.branches.find((b) => b.id === selectedBranchId) ??
    profile?.branches[0];
  const branchId = activeBranch?.id;

  const catalogQuery = usePosCatalog(
    profile?.tenant.id,
    branchId,
    Boolean(profile && branchId),
  );
  const currentShiftQuery = useCurrentShift(branchId, Boolean(profile && branchId));
  const openShiftMutation = useOpenShift();
  const checkoutMutation = usePosCheckout(profile?.tenant.id);

  const currentShift = currentShiftQuery.data?.shift ?? null;
  const recentInvoicesQuery = usePosInvoices(
    branchId,
    currentShift?.id,
    Boolean(profile && branchId && currentShift?.id && showRecentInvoices),
  );

  const permissionSet = new Set(profile?.member.permissions ?? []);
  const canDiscount = permissionSet.has(PERMISSIONS.POS_DISCOUNT_OVERRIDE);
  const canPriceOverride = permissionSet.has(PERMISSIONS.POS_PRICE_OVERRIDE);

  const activeTab = tabs[activeTabIndex] ?? tabs[0]!;

  const updateActiveTab = useCallback(
    (updater: (prev: PendingInvoiceTab) => PendingInvoiceTab) => {
      setTabs((prevTabs) =>
        prevTabs.map((t, idx) => (idx === activeTabIndex ? updater(t) : t)),
      );
    },
    [activeTabIndex],
  );

  const catalogItems = catalogQuery.data?.items ?? [];
  const categories = catalogQuery.data?.categories ?? [];

  const filteredItems = useMemo(
    () =>
      searchPosCatalog(catalogItems, {
        query: searchQuery,
        categoryId: selectedCategoryId,
        limit: 48,
      }),
    [catalogItems, searchQuery, selectedCategoryId],
  );

  const addItemToCart = useCallback(
    (catalogItem: PosCatalogItem) => {
      setCheckoutError(null);
      if (Number(catalogItem.available) <= 0) {
        toast.error(`SKU "${catalogItem.sku}" đã hết tồn kho khả dụng`);
        return;
      }

      updateActiveTab((prev) => {
        const existingIndex = prev.items.findIndex(
          (line) => line.variantId === catalogItem.variantId,
        );
        if (existingIndex >= 0) {
          const nextItems = prev.items.map((line, i) => {
            if (i !== existingIndex) return line;
            const nextQty = Number(line.quantity) + 1;
            return { ...line, quantity: String(nextQty) };
          });
          return { ...prev, items: nextItems };
        }

        const newLine: CartLineState = {
          variantId: catalogItem.variantId,
          sku: catalogItem.sku,
          name: `${catalogItem.productName} - ${catalogItem.variantName}`,
          unit: catalogItem.unit,
          catalogPrice: catalogItem.salePrice,
          taxRate: catalogItem.taxRate,
          quantity: "1",
          discountAmount: "0.00",
        };
        return { ...prev, items: [...prev.items, newLine] };
      });
    },
    [updateActiveTab],
  );

  const totalsPreview = useMemo(() => {
    if (activeTab.items.length === 0) return null;
    try {
      return calculatePosInvoiceTotals({
        lines: activeTab.items.map((line) => ({
          quantity: line.quantity || "1",
          unitPrice: line.overrideUnitPrice ?? line.catalogPrice,
          discountAmount: line.discountAmount || "0.00",
          taxRate: line.taxRate,
        })),
        invoiceDiscountAmount: activeTab.invoiceDiscountAmount || "0.00",
        payments: activeTab.payments.map((p) => ({
          method: p.method,
          amount: p.amount || "0.00",
        })),
      });
    } catch {
      return null;
    }
  }, [activeTab]);

  // Display pre-payment subtotal/total even before cashier types payment amount.
  const cartSummary = useMemo(() => {
    if (activeTab.items.length === 0) {
      return {
        subtotal: "0.00",
        discount: "0.00",
        tax: "0.00",
        total: "0.00",
      };
    }
    try {
      const dummyCalc = calculatePosInvoiceTotals({
        lines: activeTab.items.map((line) => ({
          quantity: line.quantity || "1",
          unitPrice: line.overrideUnitPrice ?? line.catalogPrice,
          discountAmount: line.discountAmount || "0.00",
          taxRate: line.taxRate,
        })),
        invoiceDiscountAmount: activeTab.invoiceDiscountAmount || "0.00",
        payments: [{ method: "CASH", amount: "999999999.00" }],
      });
      return {
        subtotal: dummyCalc.formatted.subtotal,
        discount: dummyCalc.formatted.discountAmount,
        tax: dummyCalc.formatted.taxAmount,
        total: dummyCalc.formatted.totalAmount,
      };
    } catch {
      return {
        subtotal: "0.00",
        discount: "0.00",
        tax: "0.00",
        total: "0.00",
      };
    }
  }, [activeTab.items, activeTab.invoiceDiscountAmount]);

  const handleCheckout = useCallback(async () => {
    if (!branchId || !currentShift) {
      setCheckoutError("Vui lòng mở ca thu ngân trước khi thanh toán.");
      return;
    }
    if (activeTab.items.length === 0) {
      setCheckoutError("Giỏ hàng đang trống.");
      return;
    }
    setCheckoutError(null);

    try {
      const receipt = await checkoutMutation.mutateAsync({
        idempotencyKey: activeTab.idempotencyKey,
        branchId,
        shiftId: currentShift.id,
        discountAmount: activeTab.invoiceDiscountAmount || "0.00",
        syncSource: "ONLINE",
        items: activeTab.items.map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
          discountAmount: line.discountAmount || "0.00",
          ...(line.overrideUnitPrice !== undefined &&
          line.overrideUnitPrice !== line.catalogPrice
            ? { overrideUnitPrice: line.overrideUnitPrice }
            : {}),
        })),
        payments: activeTab.payments.map((p) => ({
          method: p.method,
          amount: p.amount || "0.00",
          ...(p.referenceNo.trim() ? { referenceNo: p.referenceNo.trim() } : {}),
        })),
      });

      toast.success(`Đã thanh toán ${receipt.code}`);
      setActiveReceipt(receipt);
      setReceiptModalOpen(true);

      updateActiveTab((prev) => ({
        ...prev,
        idempotencyKey: makeUuid(),
        items: [],
        invoiceDiscountAmount: "0.00",
        payments: [{ method: "CASH", amount: "0.00", referenceNo: "" }],
      }));
    } catch (error) {
      setCheckoutError(formatApiError(error, "Thanh toán thất bại."));
    }
  }, [activeTab, branchId, checkoutMutation, currentShift, updateActiveTab]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "F2") {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (event.key === "F9") {
        event.preventDefault();
        void handleCheckout();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleCheckout]);

  function handleSearchEnter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = searchQuery.trim().toLowerCase();
    if (!trimmed) return;

    const exact = catalogItems.find(
      (item) =>
        item.barcode?.toLowerCase() === trimmed ||
        item.sku.toLowerCase() === trimmed,
    );
    const chosen = exact ?? (filteredItems.length === 1 ? filteredItems[0] : null);
    if (chosen) {
      addItemToCart(chosen);
      setSearchQuery("");
    }
  }

  async function handleOpenShiftSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!branchId) return;
    setShiftError(null);

    const parsed = openShiftSchema.safeParse({
      branchId,
      openingCash,
    });
    if (!parsed.success) {
      setShiftError(
        parsed.error.issues[0]?.message ?? "Số tiền đầu ca không hợp lệ",
      );
      return;
    }

    try {
      await openShiftMutation.mutateAsync(parsed.data);
      toast.success("Đã mở ca làm việc mới");
    } catch (error) {
      setShiftError(formatApiError(error, "Không thể mở ca thu ngân."));
    }
  }

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

  if (meQuery.isError || !profile) {
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

  const canOpenDashboard = profile.member.role !== "CASHIER";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="pos-no-print flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
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

          <Badge
            variant={catalogQuery.sseConnected ? "secondary" : "outline"}
            className="gap-1"
          >
            {catalogQuery.sseConnected ? (
              <WifiIcon className="size-3" />
            ) : (
              <WifiOffIcon className="size-3" />
            )}
            {catalogQuery.sseConnected ? "Realtime Kho" : "Cache Cục bộ"}
          </Badge>

          {currentShift ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setZReportOpen(true)}
            >
              Ca mở · Két: {formatVndAmount(currentShift.expectedCash)}
            </Button>
          ) : (
            <Badge variant="outline">Chưa mở ca</Badge>
          )}
        </div>

        <form
          onSubmit={handleSearchEnter}
          className="flex flex-1 items-center gap-2 md:max-w-md"
        >
          <SearchIcon className="size-4 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            aria-label="Tìm hàng hóa hoặc quét mã vạch"
            placeholder="Quét mã vạch hoặc gõ SKU/tên (F2)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Đồng bộ lại danh mục"
            onClick={() => void catalogQuery.refetch()}
          >
            <RefreshCwIcon className="size-4" />
          </Button>
        </form>

        <div className="flex items-center gap-2">
          {currentShift ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowRecentInvoices((prev) => !prev)}
            >
              <ReceiptIcon data-icon="inline-start" />
              Hóa đơn ca
            </Button>
          ) : null}

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

      {showRecentInvoices && currentShift ? (
        <section className="pos-no-print border-b bg-muted/20 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
            <span className="text-xs font-semibold uppercase text-muted-foreground">
              Hóa đơn đã bán trong ca hiện tại
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowRecentInvoices(false)}
            >
              Ẩn
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(recentInvoicesQuery.data?.items ?? []).map((inv) => (
              <Button
                key={inv.id}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setActiveReceipt(inv);
                  setReceiptModalOpen(true);
                }}
              >
                <PrinterIcon data-icon="inline-start" />
                {inv.code} · {formatVndAmount(inv.totalAmount)}
              </Button>
            ))}
            {(recentInvoicesQuery.data?.items ?? []).length === 0 ? (
              <span className="text-xs text-muted-foreground">
                Chưa có hóa đơn nào trong ca này.
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="pos-no-print grid flex-1 gap-4 p-4 lg:grid-cols-[1.1fr_1fr_380px]">
        {/* Left: Quick-keys & IndexedDB Catalog Grid */}
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={selectedCategoryId === null ? "default" : "outline"}
              onClick={() => setSelectedCategoryId(null)}
            >
              Tất cả ({catalogItems.length})
            </Button>
            {categories.map((cat) => (
              <Button
                key={cat.id}
                type="button"
                size="sm"
                variant={selectedCategoryId === cat.id ? "default" : "outline"}
                onClick={() => setSelectedCategoryId(cat.id)}
              >
                {cat.name}
              </Button>
            ))}
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {filteredItems.map((item) => {
              const availableNum = Number(item.available);
              const outOfStock = availableNum <= 0;
              const lowStock =
                item.minStockAlert > 0 && availableNum <= item.minStockAlert;

              return (
                <button
                  key={item.variantId}
                  type="button"
                  disabled={outOfStock}
                  onClick={() => addItemToCart(item)}
                  className="flex flex-col justify-between gap-2 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="line-clamp-2 text-sm font-medium leading-snug">
                      {item.productName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {item.variantName} ·{" "}
                      <span className="font-mono">{item.sku}</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="font-mono text-sm font-semibold text-primary">
                      {formatVndAmount(item.salePrice)}
                    </span>
                    <Badge variant={lowStock ? "destructive" : "secondary"}>
                      Tồn: {Number(item.available)}
                    </Badge>
                  </div>
                </button>
              );
            })}
            {filteredItems.length === 0 ? (
              <Card className="col-span-full">
                <CardHeader>
                  <CardTitle className="text-sm">Không tìm thấy SKU</CardTitle>
                  <CardDescription>
                    Thử tìm tên khác hoặc nhập hàng ở Quản trị để tăng tồn kho.
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : null}
          </div>
        </section>

        {/* Center: Multi-tab Pending Invoice Cart */}
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {tabs.map((tab, idx) => (
              <div key={tab.id} className="flex items-center">
                <Button
                  type="button"
                  size="sm"
                  variant={idx === activeTabIndex ? "default" : "outline"}
                  onClick={() => setActiveTabIndex(idx)}
                >
                  {tab.label}
                  {tab.items.length > 0 ? ` (${tab.items.length})` : ""}
                </Button>
                {tabs.length > 1 ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Đóng ${tab.label}`}
                    onClick={() => {
                      setTabs((prev) => prev.filter((_, i) => i !== idx));
                      setActiveTabIndex((prevIdx) =>
                        prevIdx >= idx ? Math.max(0, prevIdx - 1) : prevIdx,
                      );
                    }}
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            ))}
            {tabs.length < 6 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  const nextNum = tabs.length + 1;
                  setTabs((prev) => [...prev, createEmptyTab(nextNum)]);
                  setActiveTabIndex(tabs.length);
                }}
              >
                <PlusIcon data-icon="inline-start" />
                Thêm tab
              </Button>
            ) : null}
          </div>

          <Card className="flex-1">
            <CardHeader>
              <CardTitle className="text-base">{activeTab.label}</CardTitle>
              <CardDescription>
                {activeBranch
                  ? `${activeBranch.code} · ${activeBranch.name}`
                  : "Chọn chi nhánh"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              {activeTab.items.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Chưa có sản phẩm trong giỏ. Quét mã vạch (F2) hoặc bấm vào ô
                  Quick-keys bên trái.
                </p>
              ) : (
                activeTab.items.map((line) => (
                  <div
                    key={line.variantId}
                    className="flex flex-col gap-2 rounded-lg border p-2.5 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col">
                        <span className="font-medium">{line.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {line.sku} ·{" "}
                          {formatVndAmount(
                            line.overrideUnitPrice ?? line.catalogPrice,
                          )}
                        </span>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Xóa ${line.sku}`}
                        onClick={() =>
                          updateActiveTab((prev) => ({
                            ...prev,
                            items: prev.items.filter(
                              (i) => i.variantId !== line.variantId,
                            ),
                          }))
                        }
                      >
                        <Trash2Icon className="size-4 text-destructive" />
                      </Button>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="outline"
                          onClick={() =>
                            updateActiveTab((prev) => ({
                              ...prev,
                              items: prev.items
                                .map((i) => {
                                  if (i.variantId !== line.variantId) return i;
                                  const next = Math.max(0, Number(i.quantity) - 1);
                                  return { ...i, quantity: String(next) };
                                })
                                .filter((i) => Number(i.quantity) > 0),
                            }))
                          }
                        >
                          <MinusIcon />
                        </Button>
                        <Input
                          aria-label={`Số lượng ${line.sku}`}
                          className="h-8 w-16 text-center font-mono"
                          value={line.quantity}
                          onChange={(e) =>
                            updateActiveTab((prev) => ({
                              ...prev,
                              items: prev.items.map((i) =>
                                i.variantId === line.variantId
                                  ? { ...i, quantity: e.target.value }
                                  : i,
                              ),
                            }))
                          }
                        />
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="outline"
                          onClick={() =>
                            updateActiveTab((prev) => ({
                              ...prev,
                              items: prev.items.map((i) =>
                                i.variantId === line.variantId
                                  ? {
                                      ...i,
                                      quantity: String(Number(i.quantity) + 1),
                                    }
                                  : i,
                              ),
                            }))
                          }
                        >
                          <PlusIcon />
                        </Button>
                      </div>

                      <div className="flex items-center gap-2">
                        {canPriceOverride ? (
                          <Input
                            aria-label={`Sửa đơn giá ${line.sku}`}
                            className="h-8 w-24 font-mono text-xs"
                            placeholder="Đơn giá"
                            value={line.overrideUnitPrice ?? line.catalogPrice}
                            onChange={(e) =>
                              updateActiveTab((prev) => ({
                                ...prev,
                                items: prev.items.map((i) =>
                                  i.variantId === line.variantId
                                    ? { ...i, overrideUnitPrice: e.target.value }
                                    : i,
                                ),
                              }))
                            }
                          />
                        ) : null}

                        {canDiscount ? (
                          <Input
                            aria-label={`Giảm giá ${line.sku}`}
                            className="h-8 w-24 font-mono text-xs"
                            placeholder="Giảm dòng"
                            value={line.discountAmount}
                            onChange={(e) =>
                              updateActiveTab((prev) => ({
                                ...prev,
                                items: prev.items.map((i) =>
                                  i.variantId === line.variantId
                                    ? { ...i, discountAmount: e.target.value }
                                    : i,
                                ),
                              }))
                            }
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </section>

        {/* Right: Shift Gate OR Split Payments & Checkout */}
        <aside className="flex flex-col gap-4">
          {!currentShift && currentShiftQuery.isFetched ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <LockOpenIcon className="size-4 text-primary" />
                  Mở ca Thu ngân
                </CardTitle>
                <CardDescription>
                  Nhập tiền mặt đầu ca trong két để bắt đầu bán hàng tại{" "}
                  {activeBranch?.name ?? "chi nhánh"}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={handleOpenShiftSubmit}
                  className="flex flex-col gap-3"
                >
                  {shiftError ? (
                    <Alert variant="destructive">
                      <AlertCircleIcon />
                      <AlertDescription>{shiftError}</AlertDescription>
                    </Alert>
                  ) : null}

                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="pos-opening-cash">
                        Tiền đầu ca (₫)
                      </FieldLabel>
                      <Input
                        id="pos-opening-cash"
                        value={openingCash}
                        onChange={(e) => setOpeningCash(e.target.value)}
                      />
                    </Field>
                  </FieldGroup>

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={openShiftMutation.isPending}
                  >
                    {openShiftMutation.isPending
                      ? "Đang mở ca..."
                      : "Mở ca & Bắt đầu bán hàng"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Thanh toán (Split Payment)</CardTitle>
              <CardDescription>
                Tiền mặt · VietQR · Thẻ · Tiền thừa tự động
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {checkoutError ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertTitle>Không thể thanh toán</AlertTitle>
                  <AlertDescription>{checkoutError}</AlertDescription>
                </Alert>
              ) : null}

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Tạm tính</span>
                <span className="font-mono font-medium">
                  {formatVndAmount(cartSummary.subtotal)}
                </span>
              </div>

              {canDiscount ? (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Chiết khấu bill</span>
                  <Input
                    aria-label="Chiết khấu hóa đơn"
                    className="h-8 w-28 text-right font-mono"
                    value={activeTab.invoiceDiscountAmount}
                    onChange={(e) =>
                      updateActiveTab((prev) => ({
                        ...prev,
                        invoiceDiscountAmount: e.target.value,
                      }))
                    }
                  />
                </div>
              ) : (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Giảm giá</span>
                  <span className="font-mono font-medium">
                    {formatVndAmount(cartSummary.discount)}
                  </span>
                </div>
              )}

              {Number(cartSummary.tax) > 0 ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Thuế VAT</span>
                  <span className="font-mono font-medium">
                    {formatVndAmount(cartSummary.tax)}
                  </span>
                </div>
              ) : null}

              <Separator />

              <div className="flex items-center justify-between text-base font-semibold">
                <span>Khách cần trả</span>
                <span className="font-mono text-primary">
                  {formatVndAmount(cartSummary.total)}
                </span>
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Hình thức thanh toán
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      updateActiveTab((prev) => ({
                        ...prev,
                        payments: [
                          ...prev.payments,
                          {
                            method: "BANK_TRANSFER_QR",
                            amount: "0.00",
                            referenceNo: "",
                          },
                        ],
                      }))
                    }
                  >
                    <PlusIcon data-icon="inline-start" />
                    Thêm phương thức
                  </Button>
                </div>

                {activeTab.payments.map((payment, idx) => (
                  <div key={idx} className="flex flex-col gap-1.5 rounded-md border p-2">
                    <div className="flex items-center gap-1.5">
                      <Select
                        value={payment.method}
                        onValueChange={(value) => {
                          if (!value) return;
                          updateActiveTab((prev) => ({
                            ...prev,
                            payments: prev.payments.map((p, i) =>
                              i === idx
                                ? { ...p, method: value as PaymentMethod }
                                : p,
                            ),
                          }));
                        }}
                      >
                        <SelectTrigger size="sm" className="w-40">
                          <SelectValue>
                            {PAYMENT_METHOD_LABELS[payment.method]}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {PAYMENT_METHODS.map((method) => (
                              <SelectItem key={method} value={method}>
                                {PAYMENT_METHOD_LABELS[method]}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>

                      <Input
                        aria-label={`Số tiền thanh toán ${idx + 1}`}
                        className="h-8 flex-1 text-right font-mono"
                        value={payment.amount}
                        onChange={(e) =>
                          updateActiveTab((prev) => ({
                            ...prev,
                            payments: prev.payments.map((p, i) =>
                              i === idx ? { ...p, amount: e.target.value } : p,
                            ),
                          }))
                        }
                      />

                      {activeTab.payments.length > 1 ? (
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          onClick={() =>
                            updateActiveTab((prev) => ({
                              ...prev,
                              payments: prev.payments.filter((_, i) => i !== idx),
                            }))
                          }
                        >
                          <XIcon className="size-3.5" />
                        </Button>
                      ) : null}
                    </div>

                    {payment.method !== "CASH" ? (
                      <Input
                        aria-label={`Mã tham chiếu giao dịch ${idx + 1}`}
                        className="h-7 text-xs"
                        placeholder="Mã giao dịch QR / Số chuẩn chi thẻ..."
                        value={payment.referenceNo}
                        onChange={(e) =>
                          updateActiveTab((prev) => ({
                            ...prev,
                            payments: prev.payments.map((p, i) =>
                              i === idx
                                ? { ...p, referenceNo: e.target.value }
                                : p,
                            ),
                          }))
                        }
                      />
                    ) : null}
                  </div>
                ))}

                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      updateActiveTab((prev) => ({
                        ...prev,
                        payments: prev.payments.map((p, i) =>
                          i === 0 ? { ...p, amount: cartSummary.total } : p,
                        ),
                      }))
                    }
                  >
                    Đủ tiền
                  </Button>
                  {QUICK_CASH_NOTES.map((note) => (
                    <Button
                      key={note.label}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        updateActiveTab((prev) => ({
                          ...prev,
                          payments: prev.payments.map((p, i) =>
                            i === 0
                              ? { ...p, method: "CASH", amount: note.amount }
                              : p,
                          ),
                        }))
                      }
                    >
                      {note.label}
                    </Button>
                  ))}
                </div>
              </div>

              {totalsPreview ? (
                <div className="flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-2 text-sm">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <CheckCircle2Icon className="size-4 text-primary" />
                    Tiền thừa trả khách
                  </span>
                  <span className="font-mono font-semibold">
                    {formatVndAmount(totalsPreview.formatted.changeDue)}
                  </span>
                </div>
              ) : activeTab.items.length > 0 ? (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Cần thanh toán thêm hoặc nhập đủ số tiền</span>
                  <span className="font-mono">
                    {formatVndAmount(cartSummary.total)}
                  </span>
                </div>
              ) : null}
            </CardContent>

            <CardFooter className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                type="button"
                disabled={!activeReceipt}
                onClick={() => setReceiptModalOpen(true)}
              >
                <PrinterIcon data-icon="inline-start" />
                In lại bill
              </Button>
              <Button
                className="flex-1"
                type="button"
                disabled={
                  !currentShift ||
                  activeTab.items.length === 0 ||
                  checkoutMutation.isPending
                }
                onClick={() => void handleCheckout()}
              >
                <CreditCardIcon data-icon="inline-start" />
                {checkoutMutation.isPending
                  ? "Đang thanh toán..."
                  : "Thanh toán (F9)"}
              </Button>
            </CardFooter>
          </Card>
        </aside>
      </div>

      <ThermalReceiptDialog
        receipt={activeReceipt}
        shopName={profile.tenant.name}
        open={receiptModalOpen}
        onOpenChange={setReceiptModalOpen}
      />

      <ShiftZReportDialog
        shiftId={currentShift?.id}
        shopName={profile.tenant.name}
        open={zReportOpen}
        onOpenChange={setZReportOpen}
        onShiftClosed={() => {
          void currentShiftQuery.refetch();
        }}
      />
    </div>
  );
}
