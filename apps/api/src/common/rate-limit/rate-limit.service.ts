import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ERROR_CODES } from "@smart-pos/shared";
import { RedisService } from "../../redis/redis.service";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const ATOMIC_INCR_WITH_TTL_LUA = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("TTL", KEYS[1])
return { current, ttl }
`;

@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  async consume(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const client = this.redis.getClient();
    if (client.status === "wait") {
      await client.connect();
    }

    const raw = (await client.eval(
      ATOMIC_INCR_WITH_TTL_LUA,
      1,
      key,
      String(windowSeconds),
    )) as [number, number];

    const current = Number(raw[0] ?? 1);
    const ttl = Math.max(1, Number(raw[1] ?? windowSeconds));
    const allowed = current <= limit;

    return {
      allowed,
      remaining: Math.max(0, limit - current),
      retryAfterSeconds: allowed ? 0 : ttl,
    };
  }

  async enforceOrThrow(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    try {
      const result = await this.consume(key, limit, windowSeconds);
      if (!result.allowed) {
        throw new HttpException(
          {
            code: ERROR_CODES.AUTH_RATE_LIMITED,
            message: "Quá nhiều lần thử thất bại. Vui lòng thử lại sau.",
            details: { retryAfterSeconds: result.retryAfterSeconds },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      // Fail closed on brute-force-sensitive auth limits if Redis cannot be reached
      throw new HttpException(
        {
          code: ERROR_CODES.AUTH_RATE_LIMITED,
          message: "Rate limiter unavailable",
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
