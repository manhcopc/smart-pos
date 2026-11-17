import { HttpStatus } from "@nestjs/common";
import { Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { HealthController } from "../health/health.controller";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

describe("HealthController", () => {
  it("returns ok on liveness probe", () => {
    const controller = new HealthController(
      { ping: vi.fn() } as unknown as PrismaService,
      { ping: vi.fn() } as unknown as RedisService,
    );

    const result = controller.live();
    expect(result.status).toBe("ok");
    expect(result.service).toBe("smart-pos-api");
  });

  it("returns 200 ready when postgres and redis are up", async () => {
    const controller = new HealthController(
      { ping: vi.fn().mockResolvedValue(true) } as unknown as PrismaService,
      { ping: vi.fn().mockResolvedValue(true) } as unknown as RedisService,
    );

    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status } as unknown as Response;

    await controller.ready(res);
    expect(status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ready",
        checks: { postgres: "up", redis: "up" },
      }),
    );
  });

  it("returns 503 degraded when a dependency is down", async () => {
    const controller = new HealthController(
      { ping: vi.fn().mockResolvedValue(true) } as unknown as PrismaService,
      { ping: vi.fn().mockResolvedValue(false) } as unknown as RedisService,
    );

    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status } as unknown as Response;

    await controller.ready(res);
    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "degraded",
        checks: { postgres: "up", redis: "down" },
      }),
    );
  });
});
