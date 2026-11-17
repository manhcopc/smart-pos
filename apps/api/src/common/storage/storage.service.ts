import crypto from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ERROR_CODES,
  type PresignedUploadResponse,
  type PresignProductImageInput,
} from "@smart-pos/shared";
import { AppEnv } from "../../config/env";

const PRESIGN_EXPIRES_IN_SECONDS = 300;
const CONTENT_TYPE_EXTENSION: Record<
  PresignProductImageInput["contentType"],
  string
> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

@Injectable()
export class StorageService {
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private readonly publicBaseUrl?: string;

  constructor(private readonly configService: ConfigService<AppEnv, true>) {
    const endpoint = this.configService.get("S3_ENDPOINT", { infer: true });
    const region = this.configService.get("S3_REGION", { infer: true });
    const accessKeyId = this.configService.get("S3_ACCESS_KEY_ID", {
      infer: true,
    });
    const secretAccessKey = this.configService.get("S3_SECRET_ACCESS_KEY", {
      infer: true,
    });
    this.bucket = this.configService.get("S3_BUCKET", { infer: true });
    this.publicBaseUrl = this.configService.get("S3_PUBLIC_BASE_URL", {
      infer: true,
    });

    if (accessKeyId && secretAccessKey) {
      this.client = new S3Client({
        region: region ?? "auto",
        ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
    } else {
      this.client = null;
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async presignProductImageUpload(
    tenantId: string,
    input: PresignProductImageInput,
  ): Promise<PresignedUploadResponse> {
    if (!this.client) {
      throw new ServiceUnavailableException({
        code: ERROR_CODES.STORAGE_NOT_CONFIGURED,
        message:
          "Object Storage (Cloudflare R2 / S3) chưa được cấu hình trên máy chủ",
      });
    }

    const ext = CONTENT_TYPE_EXTENSION[input.contentType];
    const key = `tenants/${tenantId}/products/${crypto.randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: input.contentType,
      ContentLength: input.fileSizeBytes,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: PRESIGN_EXPIRES_IN_SECONDS,
    });

    const endpoint = this.configService.get("S3_ENDPOINT", { infer: true });
    const fallbackBase = endpoint
      ? `${endpoint.replace(/\/+$/, "")}/${this.bucket}`
      : `https://${this.bucket}.s3.amazonaws.com`;
    const publicUrl = `${this.publicBaseUrl ?? fallbackBase}/${key}`;

    return {
      uploadUrl,
      publicUrl,
      key,
      expiresInSeconds: PRESIGN_EXPIRES_IN_SECONDS,
    };
  }
}
