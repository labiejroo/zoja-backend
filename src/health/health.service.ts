import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";

export interface HealthResult {
  status: "ok";
  database: "connected";
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Health check, który naprawdę dotyka bazy.
   *
   * Zwykłe `{ status: "ok" }` potrafi świecić na zielono, gdy Lambda straciła
   * dostęp do RDS — a to jest dokładnie ta awaria, o której chcemy wiedzieć.
   */
  async check(): Promise<HealthResult> {
    try {
      await this.dataSource.query("SELECT 1");
      return { status: "ok", database: "connected" };
    } catch (error: unknown) {
      // Pełny błąd zostaje w CloudWatch: potrafi zawierać host, użytkownika
      // i nazwę bazy, więc nie ma prawa wyjść na zewnątrz.
      this.logger.error(
        "Health check: zapytanie kontrolne do bazy nie powiodło się",
        error instanceof Error ? error.stack : String(error),
      );

      // Na zewnątrz wychodzą dwa słowa i status 503.
      throw new ServiceUnavailableException({
        status: "error",
        database: "unavailable",
      });
    }
  }
}
