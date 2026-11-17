import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import type { AppEnv } from "../config/env";

export const REPORT_EXPORT_QUEUE_NAME = "smartpos-report-exports";
export const TRANSFER_EVENT_QUEUE_NAME = "smartpos-stock-transfers";
export const WEBHOOK_DELIVERY_QUEUE_NAME = "smartpos-webhook-deliveries";

export interface ReportExportJobPayload {
  tenantId: string;
  exportJobId: string;
}

export interface StockTransferJobPayload {
  tenantId: string;
  transferId: string;
  event: "DISPATCHED" | "RECEIVED" | "CANCELLED";
}

export interface WebhookDeliveryJobPayload {
  tenantId: string;
  eventType: string;
  endpointId?: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class BullMqJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BullMqJobsService.name);
  private readonly disabled: boolean;
  private readonly redisUrl: string;

  private queueConnection: IORedis | null = null;
  private workerConnection: IORedis | null = null;
  private reportExportQueue: Queue<ReportExportJobPayload> | null = null;
  private transferEventQueue: Queue<StockTransferJobPayload> | null = null;
  private webhookDeliveryQueue: Queue<WebhookDeliveryJobPayload> | null = null;
  private reportExportWorker: Worker<ReportExportJobPayload> | null = null;
  private transferEventWorker: Worker<StockTransferJobPayload> | null = null;
  private webhookDeliveryWorker: Worker<WebhookDeliveryJobPayload> | null = null;

  private reportExportProcessor:
    | ((payload: ReportExportJobPayload) => Promise<void>)
    | null = null;
  private transferEventProcessor:
    | ((payload: StockTransferJobPayload) => Promise<void>)
    | null = null;
  private webhookDeliveryProcessor:
    | ((payload: WebhookDeliveryJobPayload) => Promise<void>)
    | null = null;

  constructor(private readonly configService: ConfigService<AppEnv, true>) {
    this.disabled =
      process.env.SKIP_DB_CONNECT === "true" ||
      process.env.BULLMQ_DISABLED === "true";
    this.redisUrl = this.configService.get("REDIS_URL", { infer: true });
  }

  onModuleInit(): void {
    if (this.disabled) {
      return;
    }

    this.queueConnection = new IORedis(this.redisUrl, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    this.workerConnection = new IORedis(this.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    this.queueConnection.on("error", (err) => {
      this.logger.warn(`BullMQ queue Redis error: ${err.message}`);
    });
    this.workerConnection.on("error", (err) => {
      this.logger.warn(`BullMQ worker Redis error: ${err.message}`);
    });

    const defaultJobOptions = {
      attempts: 3,
      backoff: { type: "exponential" as const, delay: 1000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 500 },
    };

    this.reportExportQueue = new Queue<ReportExportJobPayload>(
      REPORT_EXPORT_QUEUE_NAME,
      { connection: this.queueConnection, defaultJobOptions },
    );

    this.transferEventQueue = new Queue<StockTransferJobPayload>(
      TRANSFER_EVENT_QUEUE_NAME,
      { connection: this.queueConnection, defaultJobOptions },
    );

    this.webhookDeliveryQueue = new Queue<WebhookDeliveryJobPayload>(
      WEBHOOK_DELIVERY_QUEUE_NAME,
      { connection: this.queueConnection, defaultJobOptions },
    );

    this.startWorkersIfReady();
  }

  registerReportExportProcessor(
    handler: (payload: ReportExportJobPayload) => Promise<void>,
  ): void {
    this.reportExportProcessor = handler;
    this.startWorkersIfReady();
  }

  registerTransferEventProcessor(
    handler: (payload: StockTransferJobPayload) => Promise<void>,
  ): void {
    this.transferEventProcessor = handler;
    this.startWorkersIfReady();
  }

  registerWebhookDeliveryProcessor(
    handler: (payload: WebhookDeliveryJobPayload) => Promise<void>,
  ): void {
    this.webhookDeliveryProcessor = handler;
    this.startWorkersIfReady();
  }

  async enqueueReportExport(payload: ReportExportJobPayload): Promise<void> {
    if (this.disabled || !this.reportExportQueue) {
      if (this.reportExportProcessor) {
        await this.reportExportProcessor(payload);
      }
      return;
    }

    await this.reportExportQueue.add("generate-report-xlsx", payload, {
      jobId: payload.exportJobId,
    });
  }

  async enqueueTransferEvent(payload: StockTransferJobPayload): Promise<void> {
    if (this.disabled || !this.transferEventQueue) {
      return;
    }

    await this.transferEventQueue.add(`transfer-${payload.event.toLowerCase()}`, payload);
  }

  async enqueueWebhookDelivery(payload: WebhookDeliveryJobPayload): Promise<void> {
    if (this.disabled || !this.webhookDeliveryQueue) {
      if (this.webhookDeliveryProcessor) {
        await this.webhookDeliveryProcessor(payload);
      }
      return;
    }

    await this.webhookDeliveryQueue.add(
      `webhook-${payload.eventType.toLowerCase()}`,
      payload,
    );
  }

  private startWorkersIfReady(): void {
    if (this.disabled || !this.workerConnection) {
      return;
    }

    if (this.reportExportProcessor && !this.reportExportWorker) {
      const processor = this.reportExportProcessor;
      this.reportExportWorker = new Worker<ReportExportJobPayload>(
        REPORT_EXPORT_QUEUE_NAME,
        async (job: Job<ReportExportJobPayload>) => {
          await processor(job.data);
        },
        {
          connection: this.workerConnection,
          concurrency: 2,
        },
      );
      this.reportExportWorker.on("failed", (job, err) => {
        this.logger.error(
          `Report export job ${job?.id ?? "unknown"} failed: ${err.message}`,
        );
      });
    }

    if (this.webhookDeliveryProcessor && !this.webhookDeliveryWorker) {
      const processor = this.webhookDeliveryProcessor;
      this.webhookDeliveryWorker = new Worker<WebhookDeliveryJobPayload>(
        WEBHOOK_DELIVERY_QUEUE_NAME,
        async (job: Job<WebhookDeliveryJobPayload>) => {
          await processor(job.data);
        },
        {
          connection: this.workerConnection,
          concurrency: 5,
        },
      );
      this.webhookDeliveryWorker.on("failed", (job, err) => {
        this.logger.error(
          `Webhook delivery job ${job?.id ?? "unknown"} failed: ${err.message}`,
        );
      });
    }

    if (!this.transferEventWorker) {
      this.transferEventWorker = new Worker<StockTransferJobPayload>(
        TRANSFER_EVENT_QUEUE_NAME,
        async (job: Job<StockTransferJobPayload>) => {
          if (this.transferEventProcessor) {
            await this.transferEventProcessor(job.data);
          } else {
            this.logger.log(
              `Processed stock transfer background event ${job.data.event} for ${job.data.transferId}`,
            );
          }
        },
        {
          connection: this.workerConnection,
          concurrency: 5,
        },
      );
      this.transferEventWorker.on("failed", (job, err) => {
        this.logger.error(
          `Transfer event job ${job?.id ?? "unknown"} failed: ${err.message}`,
        );
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([
      this.reportExportWorker?.close(),
      this.transferEventWorker?.close(),
      this.webhookDeliveryWorker?.close(),
      this.reportExportQueue?.close(),
      this.transferEventQueue?.close(),
      this.webhookDeliveryQueue?.close(),
    ]);

    await Promise.allSettled([
      this.workerConnection?.quit(),
      this.queueConnection?.quit(),
    ]);
  }
}
