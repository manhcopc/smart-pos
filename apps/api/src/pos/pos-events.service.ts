import {
  Injectable,
  type MessageEvent,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PosStockStreamEvent } from "@smart-pos/shared";
import Redis from "ioredis";
import {
  filter,
  interval,
  map,
  merge,
  type Observable,
  Subject,
} from "rxjs";
import { AppEnv } from "../config/env";
import { BullMqJobsService } from "../jobs/bullmq-jobs.service";
import { RedisService } from "../redis/redis.service";

const STOCK_CHANNEL = "smartpos:pos:stock_events";
const HEARTBEAT_INTERVAL_MS = 25_000;

interface InternalStockEnvelope {
  tenantId: string;
  event: PosStockStreamEvent;
}

@Injectable()
export class PosEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly stream$ = new Subject<InternalStockEnvelope>();
  private subscriber: Redis | null = null;

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService<AppEnv, true>,
    @Optional() private readonly bullMqJobs?: BullMqJobsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.SKIP_DB_CONNECT === "true") {
      return;
    }

    try {
      const redisUrl = this.configService.get("REDIS_URL", { infer: true });
      const sub = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
      });
      await sub.connect();
      await sub.subscribe(STOCK_CHANNEL);
      sub.on("message", (channel, payload) => {
        if (channel !== STOCK_CHANNEL) return;
        try {
          const parsed = JSON.parse(payload) as InternalStockEnvelope;
          if (parsed?.tenantId && parsed?.event) {
            this.stream$.next(parsed);
          }
        } catch {
          // Ignore malformed pubsub messages cleanly.
        }
      });
      this.subscriber = sub;
    } catch {
      // Fall back to in-process Subject emission if Redis subscriber cannot connect.
      this.subscriber = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber && this.subscriber.status !== "end") {
      await this.subscriber.quit().catch(() => {
        this.subscriber?.disconnect();
      });
    }
    this.stream$.complete();
  }

  async publishStockUpdate(
    tenantId: string,
    branchId: string,
    items: Array<{ variantId: string; onHand: string; available: string }>,
  ): Promise<void> {
    if (items.length === 0) return;

    const envelope: InternalStockEnvelope = {
      tenantId,
      event: {
        type: "STOCK_UPDATED",
        branchId,
        timestamp: new Date().toISOString(),
        items,
      },
    };

    if (this.bullMqJobs) {
      await this.bullMqJobs
        .enqueueWebhookDelivery({
          tenantId,
          eventType: "STOCK_UPDATED",
          payload: {
            event: "STOCK_UPDATED",
            tenantId,
            branchId,
            timestamp: envelope.event.timestamp,
            items,
          },
        })
        .catch(() => undefined);
    }

    if (this.subscriber) {
      try {
        const pub = this.redisService.getClient();
        if (pub.status === "wait") {
          await pub.connect();
        }
        await pub.publish(STOCK_CHANNEL, JSON.stringify(envelope));
        return;
      } catch {
        // Fallback directly to local subscribers.
      }
    }

    this.stream$.next(envelope);
  }

  streamForTenant(
    tenantId: string,
    branchId?: string,
  ): Observable<MessageEvent> {
    const stockUpdates$ = this.stream$.pipe(
      filter(
        (envelope) =>
          envelope.tenantId === tenantId &&
          (!branchId || envelope.event.branchId === branchId),
      ),
      map((envelope) => ({
        type: envelope.event.type,
        data: envelope.event,
      })),
    );

    const heartbeats$ = interval(HEARTBEAT_INTERVAL_MS).pipe(
      map(() => ({
        type: "HEARTBEAT",
        data: {
          type: "HEARTBEAT",
          timestamp: new Date().toISOString(),
        } satisfies PosStockStreamEvent,
      })),
    );

    return merge(stockUpdates$, heartbeats$);
  }
}
