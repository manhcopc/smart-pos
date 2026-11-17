"use client";

import {
  createCategorySchema,
  createProductSchema,
  PERMISSIONS,
  type ProductItem,
  type ProductVariantInput,
} from "@smart-pos/shared";
import {
  AlertCircleIcon,
  BoxesIcon,
  DownloadIcon,
  FolderPlusIcon,
  ImagePlusIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useState, type ChangeEvent, type FormEvent } from "react";
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
import { useMe } from "@/hooks/use-auth";
import {
  useCategories,
  useCreateCategory,
  useCreateProduct,
  useDeleteCategory,
  useImportCatalog,
  usePresignProductImage,
  useProducts,
  useUpdateProduct,
} from "@/hooks/use-catalog";
import { apiDownloadFile, formatApiError } from "@/lib/api-client";
import { compressImageToWebP } from "@/lib/image-webp";
import { formatVndAmount } from "@/lib/labels";

interface VariantDraft {
  sku: string;
  barcode: string;
  name: string;
  unit: string;
  costPrice: string;
  salePrice: string;
  taxRate: string;
  minStockAlert: string;
}

function emptyVariantDraft(): VariantDraft {
  return {
    sku: "",
    barcode: "",
    name: "",
    unit: "Cái",
    costPrice: "0.00",
    salePrice: "0.00",
    taxRate: "0.00",
    minStockAlert: "0",
  };
}

export default function ProductsPage() {
  const { data: profile } = useMe();
  const canManage =
    profile?.member.permissions.includes(PERMISSIONS.CATALOG_MANAGE) ?? false;

  const branches = profile?.branches ?? [];
  const defaultBranchId =
    branches.find((b) => b.isDefault)?.id ?? branches[0]?.id ?? "";

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [branchFilter, setBranchFilter] = useState<string>("");
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const effectiveBranchId = branchFilter || defaultBranchId;

  const categoriesQuery = useCategories(Boolean(profile));
  const productsQuery = useProducts(
    {
      page: 1,
      limit: 50,
      search,
      categoryId: categoryFilter === "ALL" ? undefined : categoryFilter,
      branchId: effectiveBranchId || undefined,
      lowStockOnly,
    },
    Boolean(profile),
  );

  const createProductMutation = useCreateProduct();
  const updateProductMutation = useUpdateProduct();
  const createCategoryMutation = useCreateCategory();
  const deleteCategoryMutation = useDeleteCategory();
  const presignMutation = usePresignProductImage();
  const importMutation = useImportCatalog();

  // Category dialog state
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [catError, setCatError] = useState<string | null>(null);

  // Create Product dialog state
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [prodName, setProdName] = useState("");
  const [prodBrand, setProdBrand] = useState("");
  const [prodCategoryId, setProdCategoryId] = useState<string>("NONE");
  const [prodImageUrl, setProdImageUrl] = useState("");
  const [prodDescription, setProdDescription] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [variants, setVariants] = useState<VariantDraft[]>([emptyVariantDraft()]);
  const [prodError, setProdError] = useState<string | null>(null);

  // Import dialog state
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResultSummary, setImportResultSummary] = useState<string | null>(
    null,
  );
  const [importError, setImportError] = useState<string | null>(null);

  function openProductDialog() {
    setProdName("");
    setProdBrand("");
    setProdCategoryId("NONE");
    setProdImageUrl("");
    setProdDescription("");
    setVariants([emptyVariantDraft()]);
    setProdError(null);
    setProductDialogOpen(true);
  }

  async function handleImageFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setProdError(null);
    setUploadingImage(true);
    try {
      const compressed = await compressImageToWebP(file);
      const presigned = await presignMutation.mutateAsync({
        fileName: compressed.fileName,
        contentType: compressed.contentType,
        fileSizeBytes: compressed.sizeBytes,
      });

      const putRes = await fetch(presigned.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": compressed.contentType },
        body: compressed.blob,
      });
      if (!putRes.ok) {
        throw new Error(`Upload ảnh thất bại (${putRes.status})`);
      }

      setProdImageUrl(presigned.publicUrl);
      toast.success("Đã nén WebP và tải ảnh sản phẩm lên Storage");
    } catch (error) {
      toast.error(
        formatApiError(
          error,
          "Chưa cấu hình R2/S3 hoặc không thể tải ảnh. Bạn có thể dán URL ảnh trực tiếp.",
        ),
      );
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleCreateProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProdError(null);

    const parsedVariants: ProductVariantInput[] = variants.map((v) => ({
      sku: v.sku.trim().toUpperCase(),
      barcode: v.barcode.trim() || null,
      name: v.name.trim() || prodName.trim(),
      unit: v.unit.trim() || "Cái",
      costPrice: v.costPrice.trim() || "0.00",
      salePrice: v.salePrice.trim() || "0.00",
      taxRate: v.taxRate.trim() || "0.00",
      minStockAlert: Number(v.minStockAlert || 0),
    }));

    const parsed = createProductSchema.safeParse({
      categoryId: prodCategoryId === "NONE" ? null : prodCategoryId,
      name: prodName,
      brand: prodBrand.trim() || null,
      description: prodDescription.trim() || null,
      imageUrl: prodImageUrl.trim() || null,
      hasVariants: parsedVariants.length > 1,
      variants: parsedVariants,
    });

    if (!parsed.success) {
      setProdError(
        parsed.error.issues[0]?.message ?? "Dữ liệu sản phẩm chưa hợp lệ",
      );
      return;
    }

    try {
      await createProductMutation.mutateAsync(parsed.data);
      toast.success("Đã thêm sản phẩm mới");
      setProductDialogOpen(false);
    } catch (error) {
      setProdError(formatApiError(error, "Không thể tạo sản phẩm."));
    }
  }

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCatError(null);

    const parsed = createCategorySchema.safeParse({ name: newCategoryName });
    if (!parsed.success) {
      setCatError(parsed.error.issues[0]?.message ?? "Tên nhóm hàng không hợp lệ");
      return;
    }

    try {
      await createCategoryMutation.mutateAsync(parsed.data);
      setNewCategoryName("");
      toast.success("Đã tạo nhóm hàng");
    } catch (error) {
      setCatError(formatApiError(error, "Không thể tạo nhóm hàng."));
    }
  }

  async function handleToggleProductActive(product: ProductItem) {
    try {
      await updateProductMutation.mutateAsync({
        id: product.id,
        data: { isActive: !product.isActive },
      });
      toast.success(
        product.isActive ? "Đã tạm ngưng bán sản phẩm" : "Đã mở bán lại sản phẩm",
      );
    } catch (error) {
      toast.error(formatApiError(error));
    }
  }

  async function handleExport(format: "csv" | "xlsx") {
    try {
      await apiDownloadFile(
        `/products/export?format=${format}`,
        `smart-pos-catalog.${format}`,
      );
      toast.success(`Đã tải xuống tệp ${format.toUpperCase()}`);
    } catch (error) {
      toast.error(formatApiError(error, "Không thể export danh mục"));
    }
  }

  async function handleImportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!importFile) {
      setImportError("Vui lòng chọn tệp .xlsx hoặc .csv");
      return;
    }
    setImportError(null);
    setImportResultSummary(null);
    try {
      const result = await importMutation.mutateAsync(importFile);
      setImportResultSummary(
        `Đã tạo ${result.createdProducts} sản phẩm / ${result.createdVariants} biến thể. Bỏ qua: ${result.skippedRows} dòng.`,
      );
      toast.success("Hoàn tất import danh mục");
    } catch (error) {
      setImportError(formatApiError(error, "Import danh mục thất bại."));
    }
  }

  const categories = categoriesQuery.data ?? [];
  const selectedCategoryName =
    categoryFilter === "ALL"
      ? "Tất cả nhóm hàng"
      : categories.find((c) => c.id === categoryFilter)?.name ?? "Nhóm hàng";
  const selectedBranch = branches.find((b) => b.id === effectiveBranchId);
  const products = productsQuery.data?.items ?? [];
  const quota = productsQuery.data?.quota;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Hàng hóa &amp; Mã vạch</h1>
          <p className="text-sm text-muted-foreground">
            Quản lý nhóm hàng, biến thể SKU/Barcode, giá vốn/giá bán và ngưỡng
            cảnh báo tồn tối thiểu.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {quota ? (
            <Badge variant="outline">
              SKU: {quota.activeSkus} / {quota.maxSkus}
            </Badge>
          ) : null}

          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport("xlsx")}
          >
            <DownloadIcon data-icon="inline-start" />
            Export Excel
          </Button>

          {canManage ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setImportFile(null);
                  setImportError(null);
                  setImportResultSummary(null);
                  setImportDialogOpen(true);
                }}
              >
                <UploadIcon data-icon="inline-start" />
                Import CSV/Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCatError(null);
                  setCatDialogOpen(true);
                }}
              >
                <FolderPlusIcon data-icon="inline-start" />
                Nhóm hàng
              </Button>
              <Button onClick={openProductDialog}>
                <PlusIcon data-icon="inline-start" />
                Thêm sản phẩm
              </Button>
            </>
          ) : null}
        </div>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-4">
          <div className="flex min-w-56 flex-1 items-center gap-2">
            <SearchIcon className="size-4 text-muted-foreground" />
            <Input
              aria-label="Tìm theo tên hàng, thương hiệu, SKU, mã vạch"
              placeholder="Tìm tên hàng, SKU hoặc quét mã vạch..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <Select
            value={categoryFilter}
            onValueChange={(value) => {
              if (value) setCategoryFilter(value);
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue>{selectedCategoryName}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="ALL">Tất cả nhóm hàng</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name} ({cat.productCount})
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          {branches.length > 0 ? (
            <Select
              value={effectiveBranchId}
              onValueChange={(value) => {
                if (value) setBranchFilter(value);
              }}
            >
              <SelectTrigger className="w-52">
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

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={lowStockOnly}
              onChange={(e) => setLowStockOnly(e.target.checked)}
            />
            <span>Dưới tồn tối thiểu</span>
          </label>
        </CardContent>
      </Card>

      {productsQuery.isError ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Không tải được danh mục</AlertTitle>
          <AlertDescription>{formatApiError(productsQuery.error)}</AlertDescription>
        </Alert>
      ) : null}

      {products.length === 0 && !productsQuery.isLoading ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BoxesIcon className="size-4 text-muted-foreground" />
              Chưa có sản phẩm phù hợp
            </CardTitle>
            <CardDescription>
              Bấm &ldquo;Thêm sản phẩm&rdquo; hoặc import từ tệp Excel/CSV theo
              template chuẩn để khởi tạo danh mục.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-4">
        {products.map((product) => (
          <Card key={product.id}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <CardTitle className="text-base">{product.name}</CardTitle>
                <CardDescription>
                  {product.categoryName ?? "Chưa phân nhóm"}
                  {product.brand ? ` · ${product.brand}` : ""} ·{" "}
                  {product.variants.length} biến thể
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={product.isActive ? "secondary" : "outline"}>
                  {product.isActive ? "Đang bán" : "Tạm ngưng"}
                </Badge>
                {canManage ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggleProductActive(product)}
                  >
                    {product.isActive ? "Ngưng bán" : "Mở bán"}
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="py-2 pr-3">SKU</th>
                    <th className="py-2 pr-3">Tên biến thể</th>
                    <th className="py-2 pr-3">Barcode</th>
                    <th className="py-2 pr-3">ĐVT</th>
                    <th className="py-2 pr-3 text-right">Giá vốn</th>
                    <th className="py-2 pr-3 text-right">Giá bán</th>
                    <th className="py-2 text-right">Tồn kho</th>
                  </tr>
                </thead>
                <tbody>
                  {product.variants.map((variant) => (
                    <tr key={variant.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-3 font-mono text-xs">
                        {variant.sku}
                      </td>
                      <td className="py-2 pr-3 font-medium">{variant.name}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
                        {variant.barcode ?? "—"}
                      </td>
                      <td className="py-2 pr-3">{variant.unit}</td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {formatVndAmount(variant.costPrice)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono font-medium">
                        {formatVndAmount(variant.salePrice)}
                      </td>
                      <td className="py-2 text-right font-mono">
                        {variant.branchStock ? (
                          <span
                            className={
                              variant.branchStock.isLowStock
                                ? "font-semibold text-destructive"
                                : ""
                            }
                          >
                            {variant.branchStock.onHand}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create Product Dialog */}
      <Dialog open={productDialogOpen} onOpenChange={setProductDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Thêm sản phẩm mới</DialogTitle>
            <DialogDescription>
              Hỗ trợ 1 hoặc nhiều biến thể SKU (màu sắc, kích cỡ) và ảnh nén WebP.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateProduct} className="flex flex-col gap-4">
            {prodError ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>{prodError}</AlertDescription>
              </Alert>
            ) : null}

            <FieldGroup>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="prod-name">Tên sản phẩm</FieldLabel>
                  <Input
                    id="prod-name"
                    placeholder="Áo thun Cotton Basic"
                    value={prodName}
                    onChange={(e) => setProdName(e.target.value)}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="prod-category">Nhóm hàng</FieldLabel>
                  <Select
                    value={prodCategoryId}
                    onValueChange={(value) => {
                      if (value) setProdCategoryId(value);
                    }}
                  >
                    <SelectTrigger id="prod-category" className="w-full">
                      <SelectValue>
                        {prodCategoryId === "NONE"
                          ? "Không chọn nhóm"
                          : categories.find((c) => c.id === prodCategoryId)
                              ?.name ?? "Nhóm hàng"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="NONE">Không chọn nhóm</SelectItem>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="prod-brand">Thương hiệu</FieldLabel>
                  <Input
                    id="prod-brand"
                    placeholder="VD: Vinamilk, Coolmate"
                    value={prodBrand}
                    onChange={(e) => setProdBrand(e.target.value)}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="prod-image-url">
                    Ảnh sản phẩm (R2/S3 WebP hoặc URL)
                  </FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      id="prod-image-url"
                      placeholder="https://..."
                      value={prodImageUrl}
                      onChange={(e) => setProdImageUrl(e.target.value)}
                    />
                    <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border px-3 text-xs font-medium hover:bg-muted">
                      <ImagePlusIcon className="mr-1.5 size-4" />
                      {uploadingImage ? "Đang tải..." : "Upload"}
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        disabled={uploadingImage}
                        onChange={handleImageFileChange}
                      />
                    </label>
                  </div>
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="prod-desc">Mô tả</FieldLabel>
                <Input
                  id="prod-desc"
                  placeholder="Ghi chú chất liệu, quy cách đóng gói..."
                  value={prodDescription}
                  onChange={(e) => setProdDescription(e.target.value)}
                />
              </Field>
            </FieldGroup>

            <div className="flex flex-col gap-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  Danh sách biến thể SKU ({variants.length})
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setVariants((prev) => [...prev, emptyVariantDraft()])
                  }
                >
                  <PlusIcon data-icon="inline-start" />
                  Thêm biến thể
                </Button>
              </div>

              {variants.map((variant, idx) => (
                <div
                  key={idx}
                  className="grid gap-2 rounded-md border bg-muted/20 p-3 sm:grid-cols-4"
                >
                  <Field>
                    <FieldLabel htmlFor={`v-sku-${idx}`}>SKU *</FieldLabel>
                    <Input
                      id={`v-sku-${idx}`}
                      placeholder="SKU-001"
                      value={variant.sku}
                      onChange={(e) =>
                        setVariants((prev) =>
                          prev.map((item, i) =>
                            i === idx
                              ? { ...item, sku: e.target.value.toUpperCase() }
                              : item,
                          ),
                        )
                      }
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor={`v-name-${idx}`}>Tên biến thể</FieldLabel>
                    <Input
                      id={`v-name-${idx}`}
                      placeholder="Đen - Size L"
                      value={variant.name}
                      onChange={(e) =>
                        setVariants((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, name: e.target.value } : item,
                          ),
                        )
                      }
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor={`v-barcode-${idx}`}>Barcode</FieldLabel>
                    <Input
                      id={`v-barcode-${idx}`}
                      placeholder="893..."
                      value={variant.barcode}
                      onChange={(e) =>
                        setVariants((prev) =>
                          prev.map((item, i) =>
                            i === idx
                              ? { ...item, barcode: e.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor={`v-unit-${idx}`}>ĐVT</FieldLabel>
                    <Input
                      id={`v-unit-${idx}`}
                      value={variant.unit}
                      onChange={(e) =>
                        setVariants((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, unit: e.target.value } : item,
                          ),
                        )
                      }
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor={`v-cost-${idx}`}>Giá vốn</FieldLabel>
                    <Input
                      id={`v-cost-${idx}`}
                      value={variant.costPrice}
                      onChange={(e) =>
                        setVariants((prev) =>
                          prev.map((item, i) =>
                            i === idx
                              ? { ...item, costPrice: e.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor={`v-sale-${idx}`}>Giá bán *</FieldLabel>
                    <Input
                      id={`v-sale-${idx}`}
                      value={variant.salePrice}
                      onChange={(e) =>
                        setVariants((prev) =>
                          prev.map((item, i) =>
                            i === idx
                              ? { ...item, salePrice: e.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor={`v-min-${idx}`}>Tồn tối thiểu</FieldLabel>
                    <Input
                      id={`v-min-${idx}`}
                      type="number"
                      min={0}
                      value={variant.minStockAlert}
                      onChange={(e) =>
                        setVariants((prev) =>
                          prev.map((item, i) =>
                            i === idx
                              ? { ...item, minStockAlert: e.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </Field>

                  <div className="flex items-end justify-end">
                    {variants.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setVariants((prev) =>
                            prev.filter((_, i) => i !== idx),
                          )
                        }
                      >
                        <Trash2Icon className="size-4 text-destructive" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setProductDialogOpen(false)}
              >
                Đóng
              </Button>
              <Button
                type="submit"
                disabled={createProductMutation.isPending}
              >
                {createProductMutation.isPending
                  ? "Đang tạo..."
                  : "Lưu sản phẩm"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Category Dialog */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quản lý Nhóm hàng</DialogTitle>
            <DialogDescription>
              Tạo nhanh hoặc xóa nhóm hàng hóa của cửa hàng.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateCategory} className="flex flex-col gap-3">
            {catError ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>{catError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex gap-2">
              <Input
                placeholder="Tên nhóm hàng mới..."
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
              />
              <Button type="submit" disabled={createCategoryMutation.isPending}>
                Thêm
              </Button>
            </div>
          </form>

          <div className="flex max-h-60 flex-col gap-2 overflow-y-auto pt-2">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <span>
                  {cat.name}{" "}
                  <span className="text-xs text-muted-foreground">
                    ({cat.productCount} SP)
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Xóa ${cat.name}`}
                  onClick={async () => {
                    try {
                      await deleteCategoryMutation.mutateAsync(cat.id);
                      toast.success("Đã xóa nhóm hàng");
                    } catch (err) {
                      toast.error(formatApiError(err));
                    }
                  }}
                >
                  <Trash2Icon className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Catalog Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Danh mục Excel / CSV</DialogTitle>
            <DialogDescription>
              Tải template mẫu, điền danh sách SKU và tải lên hệ thống (tối đa
              2.000 dòng).
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleImportSubmit} className="flex flex-col gap-4">
            {importError ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>{importError}</AlertDescription>
              </Alert>
            ) : null}

            {importResultSummary ? (
              <Alert>
                <AlertTitle>Kết quả import</AlertTitle>
                <AlertDescription>{importResultSummary}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  apiDownloadFile(
                    "/products/import-template?format=xlsx",
                    "smart-pos-import-template.xlsx",
                  )
                }
              >
                <DownloadIcon data-icon="inline-start" />
                Template .XLSX
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  apiDownloadFile(
                    "/products/import-template?format=csv",
                    "smart-pos-import-template.csv",
                  )
                }
              >
                <DownloadIcon data-icon="inline-start" />
                Template .CSV
              </Button>
            </div>

            <Field>
              <FieldLabel htmlFor="catalog-import-file">
                Chọn tệp (.xlsx hoặc .csv)
              </FieldLabel>
              <Input
                id="catalog-import-file"
                type="file"
                accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              />
              <FieldDescription>
                Các SKU cùng Tên sản phẩm sẽ tự động gộp thành biến thể.
              </FieldDescription>
              {importError ? <FieldError>{importError}</FieldError> : null}
            </Field>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setImportDialogOpen(false)}
              >
                Đóng
              </Button>
              <Button type="submit" disabled={importMutation.isPending}>
                {importMutation.isPending ? "Đang xử lý..." : "Bắt đầu Import"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
