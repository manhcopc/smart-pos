"use client";

import {
  type CategoryItem,
  type ProductItem,
  updateProductSchema,
  updateVariantSchema,
} from "@smart-pos/shared";
import { AlertCircleIcon, ImagePlusIcon, SaveIcon } from "lucide-react";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  usePresignProductImage,
  useUpdateProduct,
  useUpdateVariant,
} from "@/hooks/use-catalog";
import { formatApiError } from "@/lib/api-client";
import { isMockDataMode } from "@/lib/data-mode";
import { compressImageToWebP } from "@/lib/image-webp";

interface EditableVariantRow {
  id: string;
  sku: string;
  name: string;
  barcode: string;
  unit: string;
  costPrice: string;
  salePrice: string;
  taxRate: string;
  minStockAlert: string;
  isActive: boolean;
}

interface ProductEditDialogProps {
  product: ProductItem | null;
  categories: CategoryItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProductEditDialog({
  product,
  categories,
  open,
  onOpenChange,
}: ProductEditDialogProps) {
  const updateProductMutation = useUpdateProduct();
  const updateVariantMutation = useUpdateVariant();
  const presignMutation = usePresignProductImage();

  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [categoryId, setCategoryId] = useState("NONE");
  const [imageUrl, setImageUrl] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [variants, setVariants] = useState<EditableVariantRow[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!product || !open) return;
    setName(product.name);
    setBrand(product.brand ?? "");
    setCategoryId(product.categoryId ?? "NONE");
    setImageUrl(product.imageUrl ?? "");
    setDescription(product.description ?? "");
    setIsActive(product.isActive);
    setVariants(
      product.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        name: v.name,
        barcode: v.barcode ?? "",
        unit: v.unit,
        costPrice: v.costPrice,
        salePrice: v.salePrice,
        taxRate: v.taxRate,
        minStockAlert: String(v.minStockAlert),
        isActive: v.isActive,
      })),
    );
    setErrorMsg(null);
  }, [product, open]);

  async function handleImageFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setUploadingImage(true);
    try {
      const compressed = await compressImageToWebP(file);
      const presigned = await presignMutation.mutateAsync({
        fileName: compressed.fileName,
        contentType: compressed.contentType,
        fileSizeBytes: compressed.sizeBytes,
      });

      if (!isMockDataMode()) {
        const putRes = await fetch(presigned.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": compressed.contentType },
          body: compressed.blob,
        });
        if (!putRes.ok) {
          throw new Error(`Upload ảnh thất bại (${putRes.status})`);
        }
      }

      setImageUrl(presigned.publicUrl);
      toast.success("Đã cập nhật ảnh WebP sản phẩm");
    } catch (error) {
      toast.error(
        formatApiError(error, "Không thể tải ảnh. Bạn có thể dán URL trực tiếp."),
      );
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!product) return;
    setErrorMsg(null);

    const parsedProduct = updateProductSchema.safeParse({
      categoryId: categoryId === "NONE" ? null : categoryId,
      name,
      brand: brand.trim() || null,
      description: description.trim() || null,
      imageUrl: imageUrl.trim() || null,
      isActive,
    });

    if (!parsedProduct.success) {
      setErrorMsg(
        parsedProduct.error.issues[0]?.message ??
          "Thông tin sản phẩm chưa hợp lệ",
      );
      return;
    }

    const parsedVariants: Array<{
      variantId: string;
      data: ReturnType<typeof updateVariantSchema.parse>;
    }> = [];

    for (const v of variants) {
      const parsedVar = updateVariantSchema.safeParse({
        name: v.name,
        barcode: v.barcode.trim() || null,
        unit: v.unit,
        costPrice: v.costPrice.trim() || "0.00",
        salePrice: v.salePrice.trim() || "0.00",
        taxRate: v.taxRate.trim() || "0.00",
        minStockAlert: Number(v.minStockAlert || 0),
        isActive: v.isActive,
      });
      if (!parsedVar.success) {
        setErrorMsg(
          `Biến thể ${v.sku}: ${parsedVar.error.issues[0]?.message ?? "không hợp lệ"}`,
        );
        return;
      }
      parsedVariants.push({ variantId: v.id, data: parsedVar.data });
    }

    setSaving(true);
    try {
      await updateProductMutation.mutateAsync({
        id: product.id,
        data: parsedProduct.data,
      });
      for (const item of parsedVariants) {
        await updateVariantMutation.mutateAsync({
          productId: product.id,
          variantId: item.variantId,
          data: item.data,
        });
      }
      toast.success(`Đã cập nhật sản phẩm ${name}`);
      onOpenChange(false);
    } catch (error) {
      setErrorMsg(formatApiError(error, "Không thể cập nhật sản phẩm."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Chỉnh sửa sản phẩm</DialogTitle>
          <DialogDescription>
            Cập nhật thông tin chung, ảnh hiển thị, giá bán và định mức tồn kho
            cho từng biến thể.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {errorMsg ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          ) : null}

          <FieldGroup>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="edit-prod-name">Tên sản phẩm</FieldLabel>
                <Input
                  id="edit-prod-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="edit-prod-category">Nhóm hàng</FieldLabel>
                <Select
                  value={categoryId}
                  onValueChange={(value) => {
                    if (value) setCategoryId(value);
                  }}
                >
                  <SelectTrigger id="edit-prod-category" className="w-full">
                    <SelectValue>
                      {categoryId === "NONE"
                        ? "Không chọn nhóm"
                        : categories.find((c) => c.id === categoryId)?.name ??
                          "Nhóm hàng"}
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
                <FieldLabel htmlFor="edit-prod-brand">Thương hiệu</FieldLabel>
                <Input
                  id="edit-prod-brand"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="edit-prod-image">
                  Ảnh sản phẩm (WebP / URL)
                </FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="edit-prod-image"
                    placeholder="https://..."
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
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
              <FieldLabel htmlFor="edit-prod-desc">Mô tả</FieldLabel>
              <Input
                id="edit-prod-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>

            <Field orientation="horizontal">
              <Switch
                id="edit-prod-active"
                checked={isActive}
                onCheckedChange={(checked) => setIsActive(Boolean(checked))}
              />
              <FieldLabel htmlFor="edit-prod-active" className="font-normal">
                Đang mở bán trên hệ thống và POS
              </FieldLabel>
            </Field>
          </FieldGroup>

          <div className="flex flex-col gap-3 rounded-lg border p-3">
            <span className="text-sm font-medium">
              Biến thể ({variants.length})
            </span>
            {variants.map((variant, idx) => (
              <div
                key={variant.id}
                className="grid gap-2 rounded-md border bg-muted/20 p-3 sm:grid-cols-3"
              >
                <div className="sm:col-span-3 flex items-center justify-between text-xs">
                  <span className="font-mono font-semibold">{variant.sku}</span>
                </div>
                <Field>
                  <FieldLabel htmlFor={`ev-name-${variant.id}`}>
                    Tên biến thể
                  </FieldLabel>
                  <Input
                    id={`ev-name-${variant.id}`}
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
                  <FieldLabel htmlFor={`ev-barcode-${variant.id}`}>
                    Barcode
                  </FieldLabel>
                  <Input
                    id={`ev-barcode-${variant.id}`}
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
                  <FieldLabel htmlFor={`ev-unit-${variant.id}`}>ĐVT</FieldLabel>
                  <Input
                    id={`ev-unit-${variant.id}`}
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
                  <FieldLabel htmlFor={`ev-cost-${variant.id}`}>
                    Giá vốn
                  </FieldLabel>
                  <Input
                    id={`ev-cost-${variant.id}`}
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
                  <FieldLabel htmlFor={`ev-sale-${variant.id}`}>
                    Giá bán
                  </FieldLabel>
                  <Input
                    id={`ev-sale-${variant.id}`}
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
                  <FieldLabel htmlFor={`ev-min-${variant.id}`}>
                    Tồn tối thiểu
                  </FieldLabel>
                  <Input
                    id={`ev-min-${variant.id}`}
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
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Đóng
            </Button>
            <Button type="submit" disabled={saving}>
              <SaveIcon data-icon="inline-start" />
              {saving ? "Đang lưu..." : "Lưu thay đổi"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
