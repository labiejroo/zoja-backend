import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi, type Mock } from "vitest";
import { Test } from "@nestjs/testing";
import { getDataSourceToken } from "@nestjs/typeorm";
import { type DataSource } from "typeorm";

import { HealthService } from "../src/health/health.service.js";

/**
 * Testy jednostkowe — DataSource jest zamockowany.
 * Nic tutaj nie łączy się z prawdziwą bazą ani z AWS.
 */
describe("HealthService", () => {
  const createService = async (query: Mock): Promise<HealthService> => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: getDataSourceToken(), useValue: { query } as unknown as DataSource },
      ],
    }).compile();

    return moduleRef.get(HealthService);
  };

  it("wykonuje SELECT 1 i zwraca status ok, gdy baza odpowiada", async () => {
    const query = vi.fn().mockResolvedValue([{ "?column?": 1 }]);
    const service = await createService(query);

    await expect(service.check()).resolves.toEqual({
      status: "ok",
      database: "connected",
    });

    expect(query).toHaveBeenCalledWith("SELECT 1");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("zgłasza 503, gdy baza nie odpowiada", async () => {
    const query = vi.fn().mockRejectedValue(new Error("connection refused"));
    const service = await createService(query);

    await expect(service.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("nie ujawnia szczegółów błędu bazy w odpowiedzi", async () => {
    // Komunikat celowo zawiera dane, które nie mogą wyciec.
    const query = vi
      .fn()
      .mockRejectedValue(
        new Error('password authentication failed for user "zoja_admin" at host db.internal'),
      );
    const service = await createService(query);

    const raised = await service.check().catch((error: unknown) => error);
    const body = JSON.stringify((raised as ServiceUnavailableException).getResponse());

    expect(body).not.toContain("password");
    expect(body).not.toContain("zoja_admin");
    expect(body).not.toContain("db.internal");
    expect(body).toContain("unavailable");
  });
});
