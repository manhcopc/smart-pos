"use client";

import {
  calculateLineSubtotal,
  createPurchaseOrderSchema,
  createSupplierSchema,
  formatMoney,
  parseMoney,
  parseQuantity,
  PERMISSIONS,
} from "@smart-pos/shared";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  PackagePlusIcon,
  PlusIcon,
  Trash2Icon,
  TruckIcon,
  XCircleIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
import {
  Field,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe } from "@/hooks/use-auth";
import { useProducts } from "@/hooks/use-catalog";
import {
  useCancelPurchaseOrder,
  useCompletePurchaseOrder,
  useCreatePurchaseOrder,
  useCreateSupplier,
  usePurchaseOrders,
  useSuppliers,
} from "@/hooks/use-inventory";
import { formatApiError } from "@/lib/api-client";
import { formatVndAmount, PO_STATUS_LABELS } from "@/lib/labels";

interface PoLineDraft {
  variantId: string;
  orderedQty: string;
  unitCost: string;
  discount: string;
}

export default function PurchaseOrdersPage() {
  const { data: profile } = useMe();
  const canReceive =
    profile?.member.permissions.includes(PERMISSIONS.INVENTORY_RECEIVE) ??
    false;

  const branches = profile?.branches ?? [];
  const defaultBranchId =
    branches.find((b) => b.isDefault)?.id ?? branches[0]?.id ?? "";

  const poQuery = usePurchaseOrders({ page: 1, limit: 30 }, Boolean(profile));
  const suppliersQuery = useSuppliers(Boolean(profile));
  const productsQuery = useProducts({ page: 1, limit: 100 }, Boolean(profile));

  const createPoMutation = useCreatePurchaseOrder();
  const completePoMutation = useCompletePurchaseOrder();
  const cancelPoMutation = useCancelPurchaseOrder();
  const createSupplierMutation = useCreateSupplier();

  const allVariants = (productsQuery.data?.items ?? []).flatMap((product) =>
    product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      name: `${product.name} — ${variant.name}`,
      costPrice: variant.costPrice,
    })),
  );

  // PO Dialog state
  const [poOpen, setPoOpen] = useState(false);
  const [poBranchId, setPoBranchId] = useState("");
  const [poSupplierId, setPoSupplierId] = useState("NONE");
  const [poPaidAmount, setPoPaidAmount] = useState("0.00");
  const [completeImmediately, setCompleteImmediately] = useState(true);
  const [lines, setLines] = useState<PoLineDraft[]>([]);
  const [poError, setPoError] = useState<string | null>(null);

  // Supplier Dialog state
  const [supOpen, setSupOpen] = useState(false);
  const [supCode, setSupCode] = useState("");
  const [supName, setSupName] = useState("");
  const [supPhone, setSupPhone] = useState("");
  const [supEmail, setSupEmail] = useState("");
  const [supAddress, setSupAddress] = useState("");
  const [supError, setSupError] = useState<string | null>(null);

  function openCreatePoDialog() {
    const firstVar = allVariants[0];
    setPoBranchId(defaultBranchId);
    setPoSupplierId("NONE");
    setPoPaidAmount("0.00");
    setCompleteImmediately(true);
    setLines(
      firstVar
        ? [
            {
              variantId: firstVar.id,
              orderedQty: "1",
              unitCost: firstVar.costPrice,
              discount: "0.00",
            },
          ]
        : [],
    );
    setPoError(null);
    setPoOpen(true);
  }

  function computeDraftTotal(): string {
    try {
      let total = 0n;
      for (const line of lines) {
        const qty = parseQuantity(line.orderedQty || "0");
        const cost = parseMoney(line.unitCost || "0");
        const discount = parseMoney(line.discount || "0");
        total += calculateLineSubtotal(qty, cost) - discount;
      }
      return formatMoney(total);
    } catch {
      return "0.00";
    }
  }

  async function handleCreatePo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPoError(null);

    const parsed = createPurchaseOrderSchema.safeParse({
      branchId: poBranchId || defaultBranchId,
      supplierId: poSupplierId === "NONE" ? null : poSupplierId,
      paidAmount: poPaidAmount || "0.00",
      items: lines,
      completeImmediately,
    });

    if (!parsed.success) {
      setPoError(
        parsed.error.issues[0]?.message ?? "Dữ liệu phiếu nhập chưa hợp lệ",
      );
      return;
    }

    try {
      await createPoMutation.mutateAsync(parsed.data);
      toast.success(
        completeImmediately
          ? "Đã nhập kho và cập nhật giá vốn AVCO"
          : "Đã tạo phiếu nhập nháp",
      );
      setPoOpen(false);
    } catch (error) {
      setPoError(formatApiError(error, "Không thể tạo phiếu nhập hàng."));
    }
  }

  async function handleCreateSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSupError(null);

    const parsed = createSupplierSchema.safeParse({
      code: supCode,
      name: supName,
      phone: supPhone.trim() || null,
      email: supEmail.trim() || null,
      address: supAddress.trim() || null,
    });

    if (!parsed.success) {
      setSupError(
        parsed.error.issues[0]?.message ?? "Thông tin NCC chưa hợp lệ",
      );
      return;
    }

    try {
      await createSupplierMutation.mutateAsync(parsed.data);
      toast.success("Đã thêm nhà cung cấp");
      setSupOpen(false);
    } catch (error) {
      setSupError(formatApiError(error, "Không thể tạo nhà cung cấp."));
    }
  }

  const purchaseOrders = poQuery.data?.items ?? [];
  const suppliers = suppliersQuery.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Nhập hàng NCC &amp; Giá vốn</h1>
          <p className="text-sm text-muted-foreground">
            Tạo phiếu nhập hàng, tính giá vốn bình quân gia quyền (AVCO) và ghi
            nhận thẻ kho tự động.
          </p>
        </div>

        {canReceive ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setSupCode("");
                setSupName("");
                setSupPhone("");
                setSupEmail("");
                setSupAddress("");
                setSupError(null);
                setSupOpen(true);
              }}
            >
              <TruckIcon data-icon="inline-start" />
              Thêm NCC
            </Button>
            <Button
              onClick={openCreatePoDialog}
              disabled={allVariants.length === 0}
            >
              <PackagePlusIcon data-icon="inline-start" />
              Tạo phiếu nhập
            </Button>
          </div>
        ) : null}
      </header>

      {allVariants.length === 0 && !productsQuery.isLoading ? (
        <Alert>
          <AlertCircleIcon />
          <AlertTitle>Chưa có SKU sản phẩm</AlertTitle>
          <AlertDescription>
            Hãy tạo ít nhất 1 sản phẩm ở mục Hàng hóa &amp; Mã vạch trước khi
            lập phiếu nhập kho.
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">
            Phiếu nhập hàng ({purchaseOrders.length})
          </TabsTrigger>
          <TabsTrigger value="suppliers">
            Nhà cung cấp ({suppliers.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="flex flex-col gap-4 pt-3">
          {purchaseOrders.map((po) => (
            <Card key={po.id}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span className="font-mono">{po.code}</span>
                    <Badge
                      variant={
                        po.status === "COMPLETED"
                          ? "secondary"
                          : po.status === "CANCELLED"
                            ? "outline"
                            : "default"
                      }
                    >
                      {PO_STATUS_LABELS[po.status]}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    Chi nhánh: {po.branchCode} · {po.branchName} · NCC:{" "}
                    {po.supplierName ?? "Nhập lẻ"} · Tạo bởi {po.createdByName}
                  </CardDescription>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">
                    {formatVndAmount(po.totalAmount)}
                  </span>
                  {canReceive && po.status === "DRAFT" ? (
                    <>
                      <Button
                        size="sm"
                        onClick={async () => {
                          try {
                            await completePoMutation.mutateAsync({
                              id: po.id,
                              data: {},
                            });
                            toast.success(`Đã hoàn tất nhập kho phiếu ${po.code}`);
                          } catch (err) {
                            toast.error(formatApiError(err));
                          }
                        }}
                        disabled={completePoMutation.isPending}
                      >
                        <CheckCircle2Icon data-icon="inline-start" />
                        Hoàn tất nhập
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await cancelPoMutation.mutateAsync(po.id);
                            toast.success(`Đã hủy phiếu ${po.code}`);
                          } catch (err) {
                            toast.error(formatApiError(err));
                          }
                        }}
                        disabled={cancelPoMutation.isPending}
                      >
                        <XCircleIcon data-icon="inline-start" />
                        Hủy
                      </Button>
                    </>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="py-1.5 pr-3">SKU</th>
                      <th className="py-1.5 pr-3">Tên hàng</th>
                      <th className="py-1.5 pr-3 text-right">SL đặt</th>
                      <th className="py-1.5 pr-3 text-right">SL thực nhập</th>
                      <th className="py-1.5 pr-3 text-right">Đơn giá nhập</th>
                      <th className="py-1.5 text-right">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.items.map((item) => (
                      <tr key={item.id} className="border-b last:border-b-0">
                        <td className="py-1.5 pr-3 font-mono text-xs">
                          {item.sku}
                        </td>
                        <td className="py-1.5 pr-3">{item.variantName}</td>
                        <td className="py-1.5 pr-3 text-right font-mono">
                          {item.orderedQty}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono">
                          {item.receivedQty}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-mono">
                          {formatVndAmount(item.unitCost)}
                        </td>
                        <td className="py-1.5 text-right font-mono font-medium">
                          {formatVndAmount(item.lineTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="suppliers" className="grid gap-4 pt-3 md:grid-cols-2">
          {suppliers.map((sup) => (
            <Card key={sup.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <CardTitle className="text-base">{sup.name}</CardTitle>
                  <CardDescription className="font-mono text-xs">
                    Mã NCC: {sup.code}
                  </CardDescription>
                </div>
                <Badge variant="outline">
                  Công nợ: {formatVndAmount(sup.debtBalance)}
                </Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
                <span>SĐT: {sup.phone ?? "—"}</span>
                <span>Email: {sup.email ?? "—"}</span>
                <span>Địa chỉ: {sup.address ?? "—"}</span>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {/* Create Purchase Order Dialog */}
      <Dialog open={poOpen} onOpenChange={setPoOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Tạo phiếu nhập hàng NCC</DialogTitle>
            <DialogDescription>
              Hoàn tất phiếu nhập sẽ tự động cập nhật tồn kho chi nhánh và giá
              vốn AVCO.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreatePo} className="flex flex-col gap-4">
            {poError ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>{poError}</AlertDescription>
              </Alert>
            ) : null}

            <FieldGroup>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="po-branch">Chi nhánh nhập</FieldLabel>
                  <Select
                    value={poBranchId || defaultBranchId}
                    onValueChange={(value) => {
                      if (value) setPoBranchId(value);
                    }}
                  >
                    <SelectTrigger id="po-branch" className="w-full">
                      <SelectValue>
                        {branches.find(
                          (b) => b.id === (poBranchId || defaultBranchId),
                        )?.name ?? "Chọn chi nhánh"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {branches.map((branch) => (
                          <SelectItem key={branch.id} value={branch.id}>
                            {branch.code} · {branch.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="po-supplier">Nhà cung cấp</FieldLabel>
                  <Select
                    value={poSupplierId}
                    onValueChange={(value) => {
                      if (value) setPoSupplierId(value);
                    }}
                  >
                    <SelectTrigger id="po-supplier" className="w-full">
                      <SelectValue>
                        {poSupplierId === "NONE"
                          ? "Không chọn NCC"
                          : suppliers.find((s) => s.id === poSupplierId)
                              ?.name ?? "NCC"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="NONE">Không chọn NCC</SelectItem>
                        {suppliers.map((sup) => (
                          <SelectItem key={sup.id} value={sup.id}>
                            {sup.code} · {sup.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Chi tiết hàng nhập</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const first = allVariants[0];
                      if (!first) return;
                      setLines((prev) => [
                        ...prev,
                        {
                          variantId: first.id,
                          orderedQty: "1",
                          unitCost: first.costPrice,
                          discount: "0.00",
                        },
                      ]);
                    }}
                  >
                    <PlusIcon data-icon="inline-start" />
                    Thêm dòng
                  </Button>
                </div>

                {lines.map((line, idx) => {
                  const chosen = allVariants.find(
                    (v) => v.id === line.variantId,
                  );
                  return (
                    <div
                      key={idx}
                      className="grid gap-2 rounded-md border bg-muted/20 p-2.5 sm:grid-cols-[1.5fr_1fr_1fr_1fr_auto]"
                    >
                      <Select
                        value={line.variantId}
                        onValueChange={(value) => {
                          if (!value) return;
                          const matched = allVariants.find(
                            (v) => v.id === value,
                          );
                          setLines((prev) =>
                            prev.map((item, i) =>
                              i === idx
                                ? {
                                    ...item,
                                    variantId: value,
                                    unitCost:
                                      matched?.costPrice ?? item.unitCost,
                                  }
                                : item,
                            ),
                          );
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {chosen ? `${chosen.sku}` : "Chọn SKU"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {allVariants.map((variant) => (
                              <SelectItem key={variant.id} value={variant.id}>
                                {variant.sku} · {variant.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>

                      <Input
                        aria-label="Số lượng"
                        placeholder="SL"
                        value={line.orderedQty}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((item, i) =>
                              i === idx
                                ? { ...item, orderedQty: e.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                      <Input
                        aria-label="Đơn giá nhập"
                        placeholder="Đơn giá"
                        value={line.unitCost}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((item, i) =>
                              i === idx
                                ? { ...item, unitCost: e.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                      <Input
                        aria-label="Chiết khấu"
                        placeholder="Giảm giá"
                        value={line.discount}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((item, i) =>
                              i === idx
                                ? { ...item, discount: e.target.value }
                                : item,
                            ),
                          )
                        }
                      />

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={lines.length <= 1}
                        onClick={() =>
                          setLines((prev) => prev.filter((_, i) => i !== idx))
                        }
                      >
                        <Trash2Icon className="size-4 text-destructive" />
                      </Button>
                    </div>
                  );
                })}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="po-paid">
                    Đã thanh toán trước NCC
                  </FieldLabel>
                  <Input
                    id="po-paid"
                    value={poPaidAmount}
                    onChange={(e) => setPoPaidAmount(e.target.value)}
                  />
                </Field>

                <div className="flex flex-col justify-end text-right text-sm">
                  <span className="text-muted-foreground">Tổng phiếu nhập</span>
                  <span className="font-mono text-lg font-semibold">
                    {formatVndAmount(computeDraftTotal())}
                  </span>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={completeImmediately}
                  onChange={(e) => setCompleteImmediately(e.target.checked)}
                />
                <span>Hoàn tất nhập kho ngay (cập nhật tồn &amp; giá vốn AVCO)</span>
              </label>
            </FieldGroup>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPoOpen(false)}
              >
                Hủy
              </Button>
              <Button type="submit" disabled={createPoMutation.isPending}>
                {createPoMutation.isPending ? "Đang xử lý..." : "Lưu phiếu nhập"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create Supplier Dialog */}
      <Dialog open={supOpen} onOpenChange={setSupOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Thêm Nhà cung cấp</DialogTitle>
            <DialogDescription>
              Theo dõi thông tin liên hệ và công nợ phải trả cho nhà cung cấp.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSupplier} className="flex flex-col gap-4">
            {supError ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>{supError}</AlertDescription>
              </Alert>
            ) : null}

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="sup-code">Mã NCC</FieldLabel>
                <Input
                  id="sup-code"
                  placeholder="NCC01"
                  value={supCode}
                  onChange={(e) => setSupCode(e.target.value.toUpperCase())}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="sup-name">Tên nhà cung cấp</FieldLabel>
                <Input
                  id="sup-name"
                  placeholder="Công ty Phân phối ABC"
                  value={supName}
                  onChange={(e) => setSupName(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="sup-phone">Số điện thoại</FieldLabel>
                <Input
                  id="sup-phone"
                  value={supPhone}
                  onChange={(e) => setSupPhone(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="sup-email">Email</FieldLabel>
                <Input
                  id="sup-email"
                  type="email"
                  value={supEmail}
                  onChange={(e) => setSupEmail(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="sup-address">Địa chỉ</FieldLabel>
                <Input
                  id="sup-address"
                  value={supAddress}
                  onChange={(e) => setSupAddress(e.target.value)}
                />
              </Field>
            </FieldGroup>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSupOpen(false)}
              >
                Đóng
              </Button>
              <Button type="submit" disabled={createSupplierMutation.isPending}>
                Lưu NCC
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
