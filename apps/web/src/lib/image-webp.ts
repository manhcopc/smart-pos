export interface CompressedWebPImage {
  blob: Blob;
  fileName: string;
  contentType: "image/webp" | "image/jpeg" | "image/png";
  sizeBytes: number;
}

/**
 * Compress and resize a product image client-side into WebP before uploading
 * via presigned Object Storage URL (R2/S3). Falls back safely if canvas is unavailable.
 */
export async function compressImageToWebP(
  file: File,
  options: { maxWidth?: number; quality?: number } = {},
): Promise<CompressedWebPImage> {
  const maxWidth = options.maxWidth ?? 1024;
  const quality = options.quality ?? 0.82;

  if (typeof document === "undefined" || typeof createImageBitmap !== "function") {
    const contentType =
      file.type === "image/png" || file.type === "image/jpeg"
        ? file.type
        : "image/webp";
    return {
      blob: file,
      fileName: file.name,
      contentType,
      sizeBytes: file.size,
    };
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale =
      bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return {
        blob: file,
        fileName: file.name,
        contentType: "image/webp",
        sizeBytes: file.size,
      };
    }

    ctx.drawImage(bitmap, 0, 0, width, height);

    const webpBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality),
    );
    if (!webpBlob) {
      return {
        blob: file,
        fileName: file.name,
        contentType: "image/jpeg",
        sizeBytes: file.size,
      };
    }

    const baseName = file.name.replace(/\.[^.]+$/, "");
    return {
      blob: webpBlob,
      fileName: `${baseName || "product"}.webp`,
      contentType: "image/webp",
      sizeBytes: webpBlob.size,
    };
  } finally {
    bitmap.close();
  }
}
