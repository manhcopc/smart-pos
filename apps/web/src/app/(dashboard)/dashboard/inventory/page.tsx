"use client";

import {
  INVENTORY_MOVEMENT_TYPES,
  type InventoryMovementType,
} from "@smart-pos/shared";
import {
  AlertTriangleIcon,
  HistoryIcon,
  SearchIcon,
  WarehouseIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { DataPagination } from "@/components/shared/data-pagination";
import {
  QueryErrorAlert,
  TableRowsSkeleton,
} from "@/components/shared/page-states";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe } from "@/hooks/use-auth";
import { useInventory, useInventoryLedgers } from "@/hooks/use-inventory";
import { formatVndAmount, MOVEMENT_TYPE_LABELS } from "@/lib/labels";

function InventoryPageContent() {
  const searchParams = useSearchParams();
  const initialLowStock = searchParams.get("lowStock") === "true";

  const { data: profile } = useMe();
  const branches = profile?.branches ?? [];
  const defaultBranchId =
    branches.find((b) => b.isDefault)?.id ?? branches[0]?.id ?? "";

  const [branchId, setBranchId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(initialLowStock);
  const [movementType, setMovementType] = useState<string>("ALL");
  const [stockPage, setStockPage] = useState(1);
  const [ledgerPage, setLedgerPage] = useState(1);

  useEffect(() => {
    setLowStockOnly(searchParams.get("lowStock") === "true");
    setStockPage(1);
  }, [searchParams]);

  const effectiveBranchId = branchId || defaultBranchId;
  const selectedBranch = branches.find((b) => b.id === effectiveBranchId);

  const inventoryQuery = useInventory(
    {
      page: stockPage,
      limit: 30,
      branchId: effectiveBranchId || undefined,
      search,
      lowStockOnly,
    },
    Boolean(profile),
  );

  const ledgerQuery = useInventoryLedgers(
    {
      page: ledgerPage,
      limit: 30,
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
  const stockPagination = inventoryQuery.data?.pagination;
  const summary = inventoryQuery.data?.summary;
  const ledgerItems = ledgerQuery.data?.items ?? [];
  const ledgerPagination = ledgerQuery.data?.pagination;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Tồn kho &amp; Thẻ kho</h1>
          <p className="text-sm text-muted-foreground">
            Theo dõi tồn thực tế, tồn khả dụng, giá vốn AVCO theo chi nhánh và
            lịch sử biến động bất biến.
          </p>
        </div>

        {branches.length > 0 ? (
          <Select
            value={effectiveBranchId}
            onValueChange={(value) => {
              if (value) {
                setBranchId(value);
                setStockPage(1);
                setLedgerPage(1);
              }
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
          <CardContent className="font-mono text-2xl font-semibold tabular-nums">
            {inventoryQuery.isLoading ? (
              <Skeleton className="h-8 w-36" />
            ) : summary ? (
              formatVndAmount(summary.totalStockValue)
            ) : (
              "0 ₫"
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangleIcon className="size-4 text-destructive" />
              Cảnh báo dưới định mức
            </CardTitle>
            <CardDescription>
              Các SKU có tồn kho nhỏ hơn hoặc bằng mức tối thiểu
            </CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {inventoryQuery.isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : summary ? (
              `${summary.lowStockCount} SKU`
            ) : (
              "0 SKU"
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 pt-4">
          <div className="flex min-w-56 flex-1 items-center gap-2">
            <SearchIcon className="size-4 text-muted-foreground" />
            <Input
              aria-label="Tìm theo tên hàng, SKU hoặc ghi chú thẻ kho"
              placeholder="Tìm tên hàng, SKU hoặc mã vạch..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setStockPage(1);
                setLedgerPage(1);
              }}
            />
          </div>

          <Field orientation="horizontal" className="w-auto">
            <Checkbox
              id="inv-low-stock"
              checked={lowStockOnly}
              onCheckedChange={(checked) => {
                setLowStockOnly(Boolean(checked));
                setStockPage(1);
              }}
            />
            <FieldLabel htmlFor="inv-low-stock" className="font-normal">
              Chỉ hiện hàng dưới định mức
            </FieldLabel>
          </Field>
        </CardContent>
      </Card>

      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">Tồn kho hiện tại</TabsTrigger>
          <TabsTrigger value="ledger">Thẻ kho bất biến</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="flex flex-col gap-3 pt-3">
          {inventoryQuery.isError ? (
            <QueryErrorAlert
              title="Không tải được tồn kho"
              error={inventoryQuery.error}
              onRetry={() => void inventoryQuery.refetch()}
            />
          ) : null}

          {inventoryQuery.isLoading ? (
            <TableRowsSkeleton rows={5} />
          ) : stockItems.length === 0 ? (
            <Card>
              <CardContent className="pt-4">
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <WarehouseIcon />
                    </EmptyMedia>
                    <EmptyTitle>Chưa có dữ liệu tồn kho phù hợp</EmptyTitle>
                    <EmptyDescription>
                      Thử thay đổi bộ lọc hoặc tạo phiếu nhập hàng để tăng tồn
                      kho chi nhánh.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-4">
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs text-muted-foreground">
                      <TableHead>SKU</TableHead>
                      <TableHead>Sản phẩm</TableHead>
                      <TableHead className="text-right">Tồn kho</TableHead>
                      <TableHead className="text-right">Khả dụng</TableHead>
                      <TableHead className="text-right">Giá vốn AVCO</TableHead>
                      <TableHead className="text-right">Giá trị tồn</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stockItems.map((item) => (
                      <TableRow key={`${item.branchId}-${item.variantId}`}>
                        <TableCell className="font-mono text-xs">
                          {item.sku}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {item.variantName}
                            </span>
                            {item.isLowStock ? (
                              <Badge variant="destructive">Sắp hết</Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {item.onHand}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {item.available}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatVndAmount(item.avgCost)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium tabular-nums">
                          {formatVndAmount(item.stockValue)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {stockPagination ? (
                  <DataPagination
                    page={stockPage}
                    totalPages={stockPagination.totalPages}
                    totalItems={stockPagination.total}
                    onPageChange={setStockPage}
                  />
                ) : null}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="ledger" className="flex flex-col gap-3 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <HistoryIcon className="size-4" />
              Nhật ký thẻ kho chỉ ghi thêm (append-only)
            </span>

            <Select
              value={movementType}
              onValueChange={(value) => {
                if (value) {
                  setMovementType(value);
                  setLedgerPage(1);
                }
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

          {ledgerQuery.isError ? (
            <QueryErrorAlert
              title="Không tải được nhật ký thẻ kho"
              error={ledgerQuery.error}
              onRetry={() => void ledgerQuery.refetch()}
            />
          ) : null}

          {ledgerQuery.isLoading ? (
            <TableRowsSkeleton rows={5} />
          ) : ledgerItems.length === 0 ? (
            <Card>
              <CardContent className="pt-4">
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <HistoryIcon />
                    </EmptyMedia>
                    <EmptyTitle>Chưa có biến động kho nào</EmptyTitle>
                    <EmptyDescription>
                      Các giao dịch bán hàng, nhập kho, kiểm kho và chuyển kho
                      sẽ tự động ghi nhận tại đây.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-4">
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs text-muted-foreground">
                      <TableHead>Thời gian</TableHead>
                      <TableHead>Loại</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Trước</TableHead>
                      <TableHead className="text-right">Biến động</TableHead>
                      <TableHead className="text-right">Sau</TableHead>
                      <TableHead>Người thực hiện</TableHead>
                      <TableHead>Ghi chú</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledgerItems.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(entry.createdAt).toLocaleString("vi-VN")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {MOVEMENT_TYPE_LABELS[entry.movementType]}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {entry.sku}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {entry.qtyBefore}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold tabular-nums">
                          {Number(entry.qtyDelta) > 0
                            ? `+${entry.qtyDelta}`
                            : entry.qtyDelta}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {entry.qtyAfter}
                        </TableCell>
                        <TableCell className="text-xs">
                          {entry.actorName} ({entry.actorEmployeeCode})
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {entry.note ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {ledgerPagination ? (
                  <DataPagination
                    page={ledgerPage}
                    totalPages={ledgerPagination.totalPages}
                    totalItems={ledgerPagination.total}
                    onPageChange={setLedgerPage}
                  />
                ) : null}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<TableRowsSkeleton rows={6} />}>
      <InventoryPageContent />
    </Suspense>
  );
}
