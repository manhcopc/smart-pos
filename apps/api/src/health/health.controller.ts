import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get("live")
  @ApiOperation({ summary: "Process liveness probe" })
  @ApiResponse({ status: 200, description: "API process is alive" })
  live() {
    return {
      status: "ok",
      service: "smart-pos-api",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("ready")
  @ApiOperation({ summary: "Database and Redis readiness probe" })
  @ApiResponse({ status: 200, description: "All dependencies are reachable" })
  @ApiResponse({ status: 503, description: "One or more dependencies are down" })
  async ready(@Res() res: Response) {
    const [postgresUp, redisUp] = await Promise.all([
      this.prisma.ping(),
      this.redis.ping(),
    ]);

    const allUp = postgresUp && redisUp;
    const statusCode = allUp
      ? HttpStatus.OK
      : HttpStatus.SERVICE_UNAVAILABLE;

    res.status(statusCode).json({
      status: allUp ? "ready" : "degraded",
      checks: {
        postgres: postgresUp ? "up" : "down",
        redis: redisUp ? "up" : "down",
      },
      timestamp: new Date().toISOString(),
    });
  }
}
