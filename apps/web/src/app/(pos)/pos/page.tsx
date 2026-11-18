"use client";

import {
  calculatePosInvoiceTotals,
  createCustomerSchema,
  type CustomerItem,
  type InvoiceReceiptResponse,
  openShiftSchema,
  PERMISSIONS,
  type PosCatalogItem,
  SUPERVISOR_APPROVAL_PERMISSIONS,
} from "@smart-pos/shared";
import { AlertCircleIcon, PrinterIcon, RotateCcwIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { toast } from "sonner";
import { InvoiceActionsDialog } from "@/components/pos/invoice-actions-dialog";
import { OfflineQueueDialog } from "@/components/pos/offline-queue-dialog";
import { PosCartPanel } from "@/components/pos/pos-cart-panel";
import { PosCatalogGrid } from "@/components/pos/pos-catalog-grid";
import { PosHeader } from "@/components/pos/pos-header";
import { PosPaymentPanel } from "@/components/pos/pos-payment-panel";
import { ShiftZReportDialog } from "@/components/pos/shift-z-report-dialog";
import { SupervisorPinDialog } from "@/components/pos/supervisor-pin-dialog";
import { ThermalReceiptDialog } from "@/components/pos/thermal-receipt-dialog";
import {
  type CartLineState,
  createEmptyTab,
  makeUuid,
  type PendingInvoiceTab,
} from "@/components/pos/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useLogout, useMe } from "@/hooks/use-auth";
import { useCreateCustomer, useCustomers } from "@/hooks/use-customers";
import {
  posKeys,
  useCurrentShift,
  useOfflineSyncInvoices,
  useOpenCashDrawer,
  useOpenShift,
  usePosCatalog,
  usePosCheckout,
  usePosInvoices,
} from "@/hooks/use-pos";
import { ApiClientError, formatApiError } from "@/lib/api-client";
import { formatVndAmount } from "@/lib/labels";
import {
  type CachedPosCatalog,
  searchPosCatalog,
  writeCachedPosCatalog,
} from "@/lib/pos-indexeddb";
import {
  applyLocalOfflineSale,
  buildLocalOfflineReceipt,
  buildOfflineQueueEntry,
  enqueueOfflineInvoice,
  type QueuedOfflineInvoice,
  readOfflineInvoiceQueue,
  removeOfflineInvoiceFromQueue,
  updateOfflineInvoiceQueueEntry,
} from "@/lib/pos-offline-queue";

const CATALOG_PAGE_STEP = 48;

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
  const [catalogLimit, setCatalogLimit] = useState(CATALOG_PAGE_STEP);

  const [tabs, setTabs] = useState<PendingInvoiceTab[]>(() => [
    createEmptyTab(1),
    createEmptyTab(2),
  ]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [openingCash, setOpeningCash] = useState("500000");
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [activeReceipt, setActiveReceipt] =
    useState<InvoiceReceiptResponse | null>(null);
  const [zReportOpen, setZReportOpen] = useState(false);
  const [showRecentInvoices, setShowRecentInvoices] = useState(false);
  const [selectedInvoiceActionId, setSelectedInvoiceActionId] = useState<
    string | null
  >(null);
  const [invoiceActionOpen, setInvoiceActionOpen] = useState(false);

  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [pinPermission, setPinPermission] = useState<
    (typeof SUPERVISOR_APPROVAL_PERMISSIONS)[number] | null
  >(null);

  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerError, setNewCustomerError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const [drawerDialogOpen, setDrawerDialogOpen] = useState(false);
  const [drawerReason, setDrawerReason] = useState("");
  const [navigatorOnline, setNavigatorOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [manualOfflineMode, setManualOfflineMode] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState<QueuedOfflineInvoice[]>([]);
  const [offlineQueueDialogOpen, setOfflineQueueDialogOpen] = useState(false);
  const syncingOfflineRef = useRef(false);

  const isEffectivelyOnline = navigatorOnline && !manualOfflineMode;

  useEffect(() => {
    const onOnline = () => setNavigatorOnline(true);
    const onOffline = () => setNavigatorOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

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
  const currentShiftQuery = useCurrentShift(
    branchId,
    Boolean(profile && branchId),
  );
  const openShiftMutation = useOpenShift();
  const checkoutMutation = usePosCheckout(profile?.tenant.id);
  const offlineSyncMutation = useOfflineSyncInvoices(profile?.tenant.id);
  const createCustomerMutation = useCreateCustomer();
  const openDrawerMutation = useOpenCashDrawer();

  const refreshOfflineQueue = useCallback(async () => {
    if (!profile?.tenant.id || !branchId) return;
    const items = await readOfflineInvoiceQueue(profile.tenant.id, branchId);
    setOfflineQueue(items);
  }, [branchId, profile?.tenant.id]);

  useEffect(() => {
    void refreshOfflineQueue();
  }, [refreshOfflineQueue]);

  const handleSyncOfflineEntries = useCallback(
    async (entriesToSync: QueuedOfflineInvoice[]) => {
      if (
        !profile?.tenant.id ||
        !isEffectivelyOnline ||
        entriesToSync.length === 0 ||
        syncingOfflineRef.current
      ) {
        return;
      }

      syncingOfflineRef.current = true;
      try {
        const res = await offlineSyncMutation.mutateAsync({
          invoices: entriesToSync.map((entry) => ({
            queuedAt: entry.queuedAt,
            payload: entry.payload,
          })),
        });

        for (const outcome of res.results) {
          if (outcome.status === "SYNCED") {
            await removeOfflineInvoiceFromQueue(outcome.idempotencyKey);
          } else if (outcome.status === "CONFLICT") {
            await updateOfflineInvoiceQueueEntry(outcome.idempotencyKey, {
              status: "CONFLICT",
              errorCode: outcome.errorCode,
              errorMessage: outcome.message,
              latestStock: outcome.latestStock,
            });
          } else {
            await updateOfflineInvoiceQueueEntry(outcome.idempotencyKey, {
              status: "FAILED",
              errorCode: outcome.errorCode,
              errorMessage: outcome.message,
            });
          }
        }

        await refreshOfflineQueue();

        if (res.summary.synced > 0) {
          toast.success(
            `Đã đồng bộ ${res.summary.synced} hóa đơn offline lên máy chủ`,
          );
        }
        if (res.summary.conflicts > 0 || res.summary.failed > 0) {
          toast.error(
            `Có ${res.summary.conflicts} xung đột và ${res.summary.failed} lỗi cần xử lý`,
          );
          setReceiptModalOpen(false);
          setOfflineQueueDialogOpen(true);
        }
      } catch (error) {
        toast.error(
          formatApiError(error, "Không thể đồng bộ hàng đợi Offline."),
        );
      } finally {
        syncingOfflineRef.current = false;
      }
    },
    [
      isEffectivelyOnline,
      offlineSyncMutation,
      profile?.tenant.id,
      refreshOfflineQueue,
    ],
  );

  useEffect(() => {
    if (!isEffectivelyOnline) return;
    const pending = offlineQueue.filter((e) => e.status === "PENDING");
    if (pending.length > 0 && !syncingOfflineRef.current) {
      void handleSyncOfflineEntries(pending);
    }
  }, [handleSyncOfflineEntries, isEffectivelyOnline, offlineQueue]);

  const customersQuery = useCustomers(
    { search: customerSearch, limit: 10 },
    Boolean(profile && customerPickerOpen),
  );

  const currentShift = currentShiftQuery.data?.shift ?? null;
  const recentInvoicesQuery = usePosInvoices(
    branchId,
    currentShift?.id,
    Boolean(profile && branchId && currentShift?.id && showRecentInvoices),
  );

  const activeTab = tabs[activeTabIndex] ?? tabs[0]!;

  const permissionSet = new Set(profile?.member.permissions ?? []);
  const hasNativeDiscount = permissionSet.has(
    PERMISSIONS.POS_DISCOUNT_OVERRIDE,
  );
  const hasNativePrice = permissionSet.has(PERMISSIONS.POS_PRICE_OVERRIDE);
  const canRefundDirect = permissionSet.has(PERMISSIONS.POS_REFUND);

  const canDiscount =
    hasNativeDiscount ||
    (Boolean(activeTab.supervisorApprovalToken) &&
      activeTab.supervisorPermission === PERMISSIONS.POS_DISCOUNT_OVERRIDE);
  const canPriceOverride =
    hasNativePrice ||
    (Boolean(activeTab.supervisorApprovalToken) &&
      activeTab.supervisorPermission === PERMISSIONS.POS_PRICE_OVERRIDE);

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

  const allMatchedItems = useMemo(
    () =>
      searchPosCatalog(catalogItems, {
        query: searchQuery,
        categoryId: selectedCategoryId,
        limit: Math.max(catalogItems.length, 500),
      }),
    [catalogItems, searchQuery, selectedCategoryId],
  );

  const filteredItems = useMemo(
    () => allMatchedItems.slice(0, catalogLimit),
    [allMatchedItems, catalogLimit],
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
          discountAmount: "0",
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
          discountAmount: line.discountAmount || "0",
          taxRate: line.taxRate,
        })),
        invoiceDiscountAmount: activeTab.invoiceDiscountAmount || "0",
        payments: activeTab.payments.map((p) => ({
          method: p.method,
          amount: p.amount || "0",
        })),
      });
    } catch {
      return null;
    }
  }, [activeTab]);

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
          discountAmount: line.discountAmount || "0",
          taxRate: line.taxRate,
        })),
        invoiceDiscountAmount: activeTab.invoiceDiscountAmount || "0",
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

  const queueOfflineAndShowReceipt = useCallback(
    async (payload: Parameters<typeof checkoutMutation.mutateAsync>[0]) => {
      if (!profile || !activeBranch || !currentShift) return;

      const entry = buildOfflineQueueEntry({
        tenantId: profile.tenant.id,
        customerName: activeTab.customerName,
        payload,
        itemSummaries: activeTab.items.map((line) => ({
          variantId: line.variantId,
          sku: line.sku,
          name: line.name,
          quantity: line.quantity,
          unitPrice: line.overrideUnitPrice ?? line.catalogPrice,
          discountAmount: line.discountAmount || "0",
          taxRate: line.taxRate,
          lineTotal: "0.00",
        })),
      });

      await enqueueOfflineInvoice(entry);
      const currentCatalog = queryClient.getQueryData<CachedPosCatalog>(
        posKeys.catalog(profile.tenant.id, activeBranch.id),
      );
      if (currentCatalog) {
        const patched = applyLocalOfflineSale(
          currentCatalog,
          activeTab.items.map((line) => ({
            variantId: line.variantId,
            quantity: line.quantity,
          })),
        );
        queryClient.setQueryData(
          posKeys.catalog(profile.tenant.id, activeBranch.id),
          patched,
        );
        void writeCachedPosCatalog(patched);
      }

      await refreshOfflineQueue();
      const localReceipt = buildLocalOfflineReceipt(
        entry,
        activeBranch.code,
        activeBranch.name,
        profile.member.id,
        profile.user.fullName,
      );
      toast.warning(
        `Đã lưu tạm hóa đơn ${entry.localReceiptCode} vào hàng đợi Offline`,
      );
      setActiveReceipt(localReceipt);
      setReceiptModalOpen(true);

      updateActiveTab((prev) => ({
        ...prev,
        idempotencyKey: makeUuid(),
        customerId: null,
        customerName: null,
        customerPoints: 0,
        supervisorApprovalToken: undefined,
        supervisorPermission: undefined,
        supervisorApproverName: undefined,
        items: [],
        invoiceDiscountAmount: "0",
        payments: [{ method: "CASH", amount: "0", referenceNo: "" }],
      }));
    },
    [
      activeBranch,
      activeTab.customerName,
      activeTab.items,
      currentShift,
      profile,
      queryClient,
      refreshOfflineQueue,
      updateActiveTab,
    ],
  );

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

    const checkoutPayload = {
      idempotencyKey: activeTab.idempotencyKey,
      branchId,
      shiftId: currentShift.id,
      ...(activeTab.customerId ? { customerId: activeTab.customerId } : {}),
      discountAmount: activeTab.invoiceDiscountAmount || "0",
      syncSource: "ONLINE" as const,
      ...(activeTab.supervisorApprovalToken
        ? { supervisorApprovalToken: activeTab.supervisorApprovalToken }
        : {}),
      items: activeTab.items.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        discountAmount: line.discountAmount || "0",
        ...(line.overrideUnitPrice !== undefined &&
        line.overrideUnitPrice !== line.catalogPrice
          ? { overrideUnitPrice: line.overrideUnitPrice }
          : {}),
      })),
      payments: activeTab.payments.map((p) => ({
        method: p.method,
        amount: p.amount || "0",
        ...(p.referenceNo.trim() ? { referenceNo: p.referenceNo.trim() } : {}),
      })),
    };

    if (!isEffectivelyOnline) {
      if (activeTab.payments.some((p) => p.method === "LOYALTY_POINTS")) {
        setCheckoutError(
          "Không thể trừ điểm Loyalty khi đang Offline. Vui lòng đổi sang Tiền mặt hoặc Chuyển khoản.",
        );
        return;
      }
      try {
        await queueOfflineAndShowReceipt(checkoutPayload);
      } catch (err) {
        setCheckoutError(formatApiError(err, "Số tiền thanh toán chưa đủ."));
      }
      return;
    }

    try {
      const receipt = await checkoutMutation.mutateAsync(checkoutPayload);

      const earnedSuffix =
        receipt.earnedPoints && receipt.earnedPoints > 0
          ? ` (+${receipt.earnedPoints} điểm)`
          : "";
      toast.success(`Đã thanh toán ${receipt.code}${earnedSuffix}`);
      setActiveReceipt(receipt);
      setReceiptModalOpen(true);

      updateActiveTab((prev) => ({
        ...prev,
        idempotencyKey: makeUuid(),
        customerId: null,
        customerName: null,
        customerPoints: 0,
        supervisorApprovalToken: undefined,
        supervisorPermission: undefined,
        supervisorApproverName: undefined,
        items: [],
        invoiceDiscountAmount: "0",
        payments: [{ method: "CASH", amount: "0", referenceNo: "" }],
      }));
    } catch (error) {
      const isNetworkFailure =
        !(error instanceof ApiClientError) ||
        (typeof navigator !== "undefined" && !navigator.onLine);
      if (
        isNetworkFailure &&
        !activeTab.payments.some((p) => p.method === "LOYALTY_POINTS")
      ) {
        try {
          await queueOfflineAndShowReceipt(checkoutPayload);
          return;
        } catch {
          // Fall back to regular error display below.
        }
      }
      setCheckoutError(formatApiError(error, "Thanh toán thất bại."));
    }
  }, [
    activeTab,
    branchId,
    checkoutMutation,
    currentShift,
    isEffectivelyOnline,
    queueOfflineAndShowReceipt,
    updateActiveTab,
  ]);

  async function handleQuickCreateCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNewCustomerError(null);
    const parsed = createCustomerSchema.safeParse({
      name: newCustomerName,
      phone: newCustomerPhone.trim() || null,
    });
    if (!parsed.success) {
      setNewCustomerError(
        parsed.error.issues[0]?.message ?? "Thông tin khách hàng chưa hợp lệ",
      );
      return;
    }

    try {
      const created: CustomerItem = await createCustomerMutation.mutateAsync(
        parsed.data,
      );
      updateActiveTab((prev) => ({
        ...prev,
        customerId: created.id,
        customerName: created.name,
        customerPoints: created.loyaltyPoints,
      }));
      setNewCustomerOpen(false);
      setCustomerPickerOpen(false);
      setNewCustomerName("");
      setNewCustomerPhone("");
      toast.success(`Đã thêm khách hàng ${created.name}`);
    } catch (error) {
      setNewCustomerError(formatApiError(error, "Không thể tạo khách hàng."));
    }
  }

  async function handleOpenDrawerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!branchId || !drawerReason.trim()) return;
    try {
      await openDrawerMutation.mutateAsync({
        branchId,
        reason: drawerReason.trim(),
      });
      toast.success("Đã ghi nhận mở két tiền vào nhật ký kiểm toán");
      setDrawerReason("");
      setDrawerDialogOpen(false);
    } catch (error) {
      toast.error(formatApiError(error, "Không thể mở két tiền."));
    }
  }

  function applyLoyaltyRedeemToTab() {
    if (!activeTab.customerId || activeTab.customerPoints <= 0) return;
    const dueVnd = Number(cartSummary.total);
    const maxVndFromPoints = activeTab.customerPoints * 1000;
    const redeemableVnd = Math.min(
      Math.floor(dueVnd / 1000) * 1000,
      maxVndFromPoints,
    );
    if (redeemableVnd <= 0) {
      toast.error(
        "Điểm thưởng hoặc giá trị hóa đơn chưa đủ quy đổi bội số 1.000 ₫",
      );
      return;
    }

    const redeemAmountStr = String(redeemableVnd);
    const remainderNum = Math.max(0, dueVnd - redeemableVnd);
    updateActiveTab((prev) => ({
      ...prev,
      payments: [
        {
          method: "LOYALTY_POINTS",
          amount: redeemAmountStr,
          referenceNo: "LOYALTY",
        },
        ...(remainderNum > 0
          ? [
              {
                method: "CASH" as const,
                amount: String(remainderNum),
                referenceNo: "",
              },
            ]
          : []),
      ],
    }));
  }

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
    const chosen =
      exact ?? (allMatchedItems.length === 1 ? allMatchedItems[0] : null);
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
    try {
      await logoutMutation.mutateAsync();
      toast.success("Đã kết thúc phiên làm việc");
      router.replace("/login");
    } catch (error) {
      toast.error(formatApiError(error, "Không thể đăng xuất."));
    }
  }

  if (meQuery.isLoading) {
    return (
      <div
        className="flex min-h-screen flex-col gap-4 p-4"
        aria-label="Đang tải quầy thu ngân"
      >
        <Skeleton className="h-12 w-full rounded-lg" />
        <div className="grid flex-1 gap-4 lg:grid-cols-[1.1fr_1fr_380px]">
          <Skeleton className="h-96 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
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
  const branchDisplay = activeBranch
    ? `${activeBranch.code} · ${activeBranch.name}`
    : "Chọn chi nhánh";

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <PosHeader
        tenantName={profile.tenant.name}
        userFullName={profile.user.fullName}
        employeeCode={profile.member.employeeCode}
        role={profile.member.role}
        branches={profile.branches}
        activeBranch={activeBranch}
        onBranchChange={setSelectedBranchId}
        isEffectivelyOnline={isEffectivelyOnline}
        sseConnected={catalogQuery.sseConnected}
        manualOfflineMode={manualOfflineMode}
        onToggleManualOffline={() => setManualOfflineMode((prev) => !prev)}
        offlineQueue={offlineQueue}
        onOpenOfflineQueue={() => setOfflineQueueDialogOpen(true)}
        currentShift={currentShift}
        onOpenZReport={() => setZReportOpen(true)}
        searchInputRef={searchInputRef}
        searchQuery={searchQuery}
        onSearchQueryChange={(val) => {
          setSearchQuery(val);
          setCatalogLimit(CATALOG_PAGE_STEP);
        }}
        onSearchSubmit={handleSearchEnter}
        onRefetchCatalog={() => void catalogQuery.refetch()}
        onOpenCashDrawer={() => setDrawerDialogOpen(true)}
        onToggleRecentInvoices={() => setShowRecentInvoices((prev) => !prev)}
        canOpenDashboard={canOpenDashboard}
        onLogout={() => void handleLogout()}
        logoutPending={logoutMutation.isPending}
      />

      {showRecentInvoices && currentShift ? (
        <section className="pos-no-print border-b bg-muted/20 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
            <span className="text-xs font-semibold uppercase text-muted-foreground">
              Hóa đơn trong ca hiện tại (bấm để xem / trả hàng / hủy đơn)
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
              <div
                key={inv.id}
                className="flex items-center gap-1 rounded-md border bg-card p-1"
              >
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setActiveReceipt(inv);
                    setReceiptModalOpen(true);
                  }}
                >
                  <PrinterIcon data-icon="inline-start" />
                  {inv.code} · {formatVndAmount(inv.totalAmount)}
                  {inv.status !== "COMPLETED" ? ` (${inv.status})` : ""}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSelectedInvoiceActionId(inv.id);
                    setInvoiceActionOpen(true);
                  }}
                >
                  <RotateCcwIcon data-icon="inline-start" />
                  Trả / Hủy
                </Button>
              </div>
            ))}
            {!recentInvoicesQuery.isLoading &&
            (recentInvoicesQuery.data?.items ?? []).length === 0 ? (
              <span className="text-xs text-muted-foreground">
                Chưa có hóa đơn nào trong ca này.
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="pos-no-print grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[1.1fr_1fr_380px]">
        <PosCatalogGrid
          catalogItemsCount={catalogItems.length}
          categories={categories}
          selectedCategoryId={selectedCategoryId}
          onSelectCategory={(categoryId) => {
            setSelectedCategoryId(categoryId);
            setCatalogLimit(CATALOG_PAGE_STEP);
          }}
          items={filteredItems}
          totalMatched={allMatchedItems.length}
          hasMore={allMatchedItems.length > filteredItems.length}
          onLoadMore={() => setCatalogLimit((prev) => prev + CATALOG_PAGE_STEP)}
          isLoading={catalogQuery.isLoading}
          onAddItem={addItemToCart}
        />

        <PosCartPanel
          tabs={tabs}
          activeTabIndex={activeTabIndex}
          activeTab={activeTab}
          branchDisplay={branchDisplay}
          canPriceOverride={canPriceOverride}
          canDiscount={canDiscount}
          onSelectTab={setActiveTabIndex}
          onAddTab={() => {
            const nextNum = tabs.length + 1;
            setTabs((prev) => [...prev, createEmptyTab(nextNum)]);
            setActiveTabIndex(tabs.length);
          }}
          onCloseTab={(idx) => {
            setTabs((prev) => prev.filter((_, i) => i !== idx));
            setActiveTabIndex((prevIdx) =>
              prevIdx >= idx ? Math.max(0, prevIdx - 1) : prevIdx,
            );
          }}
          onUpdateActiveTab={updateActiveTab}
        />

        <PosPaymentPanel
          currentShift={currentShift}
          shiftFetched={currentShiftQuery.isFetched}
          branchName={activeBranch?.name ?? "chi nhánh"}
          openingCash={openingCash}
          onOpeningCashChange={setOpeningCash}
          shiftError={shiftError}
          onOpenShiftSubmit={handleOpenShiftSubmit}
          openShiftPending={openShiftMutation.isPending}
          checkoutError={checkoutError}
          activeTab={activeTab}
          onUpdateActiveTab={updateActiveTab}
          customerPickerOpen={customerPickerOpen}
          onToggleCustomerPicker={() => setCustomerPickerOpen((v) => !v)}
          onCloseCustomerPicker={() => setCustomerPickerOpen(false)}
          customerSearch={customerSearch}
          onCustomerSearchChange={setCustomerSearch}
          customers={customersQuery.data?.items ?? []}
          customersLoading={customersQuery.isLoading}
          onOpenNewCustomer={() => setNewCustomerOpen(true)}
          onApplyLoyaltyRedeem={applyLoyaltyRedeemToTab}
          hasNativePrice={hasNativePrice}
          hasNativeDiscount={hasNativeDiscount}
          canPriceOverride={canPriceOverride}
          canDiscount={canDiscount}
          onRequestPin={(permission) => {
            setPinPermission(permission);
            setPinDialogOpen(true);
          }}
          cartSummary={cartSummary}
          changeDueFormatted={totalsPreview?.formatted.changeDue ?? null}
          hasActiveReceipt={Boolean(activeReceipt)}
          onOpenReceiptModal={() => setReceiptModalOpen(true)}
          checkoutPending={checkoutMutation.isPending}
          onCheckout={() => void handleCheckout()}
          shopName={profile.tenant.name}
        />
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

      <SupervisorPinDialog
        branchId={branchId}
        permission={pinPermission}
        open={pinDialogOpen}
        onOpenChange={setPinDialogOpen}
        onApproved={(approval) => {
          updateActiveTab((prev) => ({
            ...prev,
            supervisorApprovalToken: approval.approvalToken,
            supervisorPermission: approval.permission,
            supervisorApproverName: approval.approverName,
          }));
        }}
      />

      <InvoiceActionsDialog
        tenantId={profile.tenant.id}
        branchId={branchId}
        shiftId={currentShift?.id}
        invoiceId={selectedInvoiceActionId}
        canRefundDirect={canRefundDirect}
        open={invoiceActionOpen}
        onOpenChange={setInvoiceActionOpen}
        onPrintReceipt={(receipt) => {
          setInvoiceActionOpen(false);
          setActiveReceipt(receipt);
          setReceiptModalOpen(true);
        }}
      />

      <OfflineQueueDialog
        open={offlineQueueDialogOpen}
        onOpenChange={setOfflineQueueDialogOpen}
        entries={offlineQueue}
        isOnline={isEffectivelyOnline}
        isSyncing={offlineSyncMutation.isPending}
        currentShiftId={currentShift?.id ?? null}
        onSyncEntries={handleSyncOfflineEntries}
        onResolveEntry={async (updatedEntry) => {
          await updateOfflineInvoiceQueueEntry(
            updatedEntry.idempotencyKey,
            updatedEntry,
          );
          await refreshOfflineQueue();
          if (isEffectivelyOnline) {
            await handleSyncOfflineEntries([updatedEntry]);
          }
        }}
        onDiscardEntry={async (idempotencyKey) => {
          await removeOfflineInvoiceFromQueue(idempotencyKey);
          await refreshOfflineQueue();
        }}
      />

      <Dialog open={newCustomerOpen} onOpenChange={setNewCustomerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm nhanh khách hàng</DialogTitle>
            <DialogDescription>
              Tạo hồ sơ khách hàng mới để tích lũy điểm thưởng ngay tại quầy.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={handleQuickCreateCustomer}
            className="flex flex-col gap-3"
          >
            {newCustomerError ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>{newCustomerError}</AlertDescription>
              </Alert>
            ) : null}
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="pos-cust-name">Tên khách hàng</FieldLabel>
                <Input
                  id="pos-cust-name"
                  placeholder="Nguyễn Văn A"
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="pos-cust-phone">Số điện thoại</FieldLabel>
                <Input
                  id="pos-cust-phone"
                  placeholder="0905123456"
                  value={newCustomerPhone}
                  onChange={(e) => setNewCustomerPhone(e.target.value)}
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewCustomerOpen(false)}
              >
                Hủy
              </Button>
              <Button type="submit" disabled={createCustomerMutation.isPending}>
                {createCustomerMutation.isPending
                  ? "Đang lưu..."
                  : "Lưu & Chọn khách"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={drawerDialogOpen} onOpenChange={setDrawerDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mở két tiền ngoài giao dịch</DialogTitle>
            <DialogDescription>
              Thao tác này sẽ được lưu bất biến vào Nhật ký kiểm toán.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={handleOpenDrawerSubmit}
            className="flex flex-col gap-3"
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="pos-drawer-reason">
                  Lý do mở két tiền
                </FieldLabel>
                <Input
                  id="pos-drawer-reason"
                  placeholder="VD: Đổi tiền lẻ / Kiểm tra tiền két"
                  value={drawerReason}
                  onChange={(e) => setDrawerReason(e.target.value)}
                  required
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDrawerDialogOpen(false)}
              >
                Hủy
              </Button>
              <Button type="submit" disabled={openDrawerMutation.isPending}>
                {openDrawerMutation.isPending
                  ? "Đang ghi nhận..."
                  : "Xác nhận mở két"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
