import { Test } from "@nestjs/testing";
import { describe, expect, it, vi } from "vitest";

import { HealthController } from "../src/health/health.controller.js";
import { HealthService } from "../src/health/health.service.js";

describe("HealthController", () => {
  it("oddaje wynik z HealthService bez modyfikacji", async () => {
    const check = vi.fn().mockResolvedValue({ status: "ok", database: "connected" });

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: { check } }],
    }).compile();

    const controller = moduleRef.get(HealthController);

    await expect(controller.check()).resolves.toEqual({
      status: "ok",
      database: "connected",
    });
    expect(check).toHaveBeenCalledTimes(1);
  });
});
