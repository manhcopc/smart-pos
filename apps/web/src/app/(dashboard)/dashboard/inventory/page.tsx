"use client";

import {
  INVENTORY_MOVEMENT_TYPES,
  type InventoryMovementType,
} from "@smart-pos/shared";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  HistoryIcon,
  SearchIcon,
  WarehouseIcon,
} from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe } from "@/hooks/use-auth";
import { useInventory, useInventoryLedgers } from "@/hooks/use-inventory";
import { formatApiError } from "@/lib/api-client";
import { formatVndAmount, MOVEMENT_TYPE_LABELS } from "@/lib/labels";

export default function InventoryPage() {
  const { data: profile } = useMe();
  const branches = profile?.branches ?? [];
  const defaultBranchId =
    branches.find((b) => b.isDefault)?.id ?? branches[0]?.id ?? "";

  const [branchId, setBranchId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [movementType, setMovementType] = useState<string>("ALL");

  const effectiveBranchId = branchId || defaultBranchId;
  const selectedBranch = branches.find((b) => b.id === effectiveBranchId);

  const inventoryQuery = useInventory(
    {
      page: 1,
      limit: 50,
      branchId: effectiveBranchId || undefined,
      search,
      lowStockOnly,
    },
    Boolean(profile),
  );

  const ledgerQuery = useInventoryLedgers(
    {
      page: 1,
      limit: 50,
      branchId: effectiveBranchId || undefined,
      search,
      movementType:
        movementType === "ALL"
          ? undefined
          : (movementType as InventoryMovementType),
    },
    Boolean(profile),
  );

  const stockItems = inventoryQuery.data?.items ?? [];
  const summary = inventoryQuery.data?.summary;
  const ledgerItems = ledgerQuery.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Tồn kho &amp; Thẻ kho</h1>
          <p className="text-sm text-muted-foreground">
            Theo dõi tồn thực tế, giữ chỗ, giá vốn AVCO theo chi nhánh và lịch
            sử biến động bất biến.
          </p>
        </div>

        {branches.length > 0 ? (
          <Select
            value={effectiveBranchId}
            onValueChange={(value) => {
              if (value) setBranchId(value);
            }}
          >
            <SelectTrigger className="w-56">
              <SelectValue>
                {selectedBranch
                  ? `${selectedBranch.code} · ${selectedBranch.name}`
                  : "Chọn chi nhánh"}
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
        ) : null}
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <WarehouseIcon className="size-4 text-primary" />
              Giá trị tồn kho chi nhánh
            </CardTitle>
            <CardDescription>
              Tổng tồn &times; giá vốn bình quân gia quyền
            </CardDescription>
          </CardHeader>
          <CardContent className="font-mono text-2xl font-semibold">
            {summary ? formatVndAmount(summary.totalStockValue) : "0 ₫"}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangleIcon className="size-4 text-destructive" />
              Cảnh báo dưới định mức
            </CardTitle>
            <CardDescription>
              Các SKU có tồn kho nhỏ hơn hoặc bằng min_stock_alert
            </CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {summary ? `${summary.lowStockCount} SKU` : "0 SKU"}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-4">
          <div className="flex min-w-56 flex-1 items-center gap-2">
            <SearchIcon className="size-4 text-muted-foreground" />
            <Input
              aria-label="Tìm theo tên hàng, SKU hoặc ghi chú thẻ kho"
              placeholder="Tìm tên hàng, SKU hoặc mã vạch..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={lowStockOnly}
              onChange={(e) => setLowStockOnly(e.target.checked)}
            />
            <span>Chỉ hiện hàng dưới định mức</span>
          </label>
        </CardContent>
      </Card>

      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">Tồn kho hiện tại</TabsTrigger>
          <TabsTrigger value="ledger">Thẻ kho bất biến</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="pt-3">
          {inventoryQuery.isError ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Không tải được tồn kho</AlertTitle>
              <AlertDescription>
                {formatApiError(inventoryQuery.error)}
              </AlertDescription>
            </Alert>
          ) : null}

          <Card>
            <CardContent className="overflow-x-auto pt-4">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="py-2 pr-3">SKU</th>
                    <th className="py-2 pr-3">Sản phẩm</th>
                    <th className="py-2 pr-3 text-right">Tồn kho</th>
                    <th className="py-2 pr-3 text-right">Khả dụng</th>
                    <th className="py-2 pr-3 text-right">Giá vốn AVCO</th>
                    <th className="py-2 text-right">Giá trị tồn</th>
                  </tr>
                </thead>
                <tbody>
                  {stockItems.map((item) => (
                    <tr
                      key={`${item.branchId}-${item.variantId}`}
                      className="border-b last:border-b-0"
                    >
                      <td className="py-2 pr-3 font-mono text-xs">{item.sku}</td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {item.variantName}
                          </span>
                          {item.isLowStock ? (
                            <Badge variant="destructive">Sắp hết</Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {item.onHand}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {item.available}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {formatVndAmount(item.avgCost)}
                      </td>
                      <td className="py-2 text-right font-mono font-medium">
                        {formatVndAmount(item.stockValue)}
                      </td>
                    </tr>
                  ))}
                  {stockItems.length === 0 && !inventoryQuery.isLoading ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-6 text-center text-muted-foreground"
                      >
                        Chưa có dữ liệu tồn kho phù hợp bộ lọc.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ledger" className="flex flex-col gap-3 pt-3">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <HistoryIcon className="size-4" />
              Nhật ký thẻ kho chỉ ghi thêm (append-only)
            </span>

            <Select
              value={movementType}
              onValueChange={(value) => {
                if (value) setMovementType(value);
              }}
            >
              <SelectTrigger className="w-52">
                <SelectValue>
                  {movementType === "ALL"
                    ? "Tất cả loại phát sinh"
                    : MOVEMENT_TYPE_LABELS[
                        movementType as InventoryMovementType
                      ]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="ALL">Tất cả loại phát sinh</SelectItem>
                  {INVENTORY_MOVEMENT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {MOVEMENT_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="overflow-x-auto pt-4">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="py-2 pr-3">Thời gian</th>
                    <th className="py-2 pr-3">Loại</th>
                    <th className="py-2 pr-3">SKU</th>
                    <th className="py-2 pr-3 text-right">Trước</th>
                    <th className="py-2 pr-3 text-right">Biến động</th>
                    <th className="py-2 pr-3 text-right">Sau</th>
                    <th className="py-2 pr-3">Người thực hiện</th>
                    <th className="py-2">Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerItems.map((entry) => (
                    <tr key={entry.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleString("vi-VN")}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline">
                          {MOVEMENT_TYPE_LABELS[entry.movementType]}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {entry.sku}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {entry.qtyBefore}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono font-semibold">
                        {Number(entry.qtyDelta) > 0
                          ? `+${entry.qtyDelta}`
                          : entry.qtyDelta}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {entry.qtyAfter}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {entry.actorName} ({entry.actorEmployeeCode})
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {entry.note ?? "—"}
                      </td>
                    </tr>
                  ))}
                  {ledgerItems.length === 0 && !ledgerQuery.isLoading ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-6 text-center text-muted-foreground"
                      >
                        Chưa có biến động kho nào được ghi nhận.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
