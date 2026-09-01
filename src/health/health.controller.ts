import { Controller, Get } from "@nestjs/common";

import { HealthService, type HealthResult } from "./health.service.js";

/**
 * Globalny prefiks `api` jest ustawiany przy starcie aplikacji,
 * więc pełna ścieżka to GET /api/health.
 */
@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  check(): Promise<HealthResult> {
    return this.healthService.check();
  }
}
