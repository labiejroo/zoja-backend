import "reflect-metadata";

import type { DataSource } from "typeorm";

import { ensureDatabasePassword } from "./database/database-secret.js";

export interface MigrationResult {
  ok: boolean;
  appliedCount: number;
  applied: string[];
}

/**
 * Handler Lambdy migracyjnej — ten sam artefakt co API, inna funkcja AWS.
 *
 * DLACZEGO OSOBNA LAMBDA, A NIE ENDPOINT
 * Produkcyjny RDS ma `Public access = No`, więc TypeORM CLI z laptopa nie ma
 * do niego trasy. Standardowy runner GitHuba też nie. Zamiast otwierać bazę na
 * świat albo wystawiać publiczne /api/migrate, wchodzimy do bazy z wnętrza VPC:
 * ta funkcja siedzi w tej samej sieci i w grupie zoja-lambda-sg.
 *
 * Funkcja NIE MA wyzwalacza API Gateway. Uruchamia się ją ręcznie przez
 * `aws lambda invoke` albo z zaufanego CI/CD.
 */

async function getDataSource(): Promise<DataSource> {
  await ensureDatabasePassword();

  // data-source.ts waliduje env już podczas importu,
  // dlatego import musi nastąpić dopiero po zapewnieniu DB_PASSWORD.
  const { AppDataSource } = await import("./database/data-source.js");

  // Ciepłe wywołanie zastaje już zainicjalizowany DataSource.
  if (AppDataSource.isInitialized) {
    return AppDataSource;
  }

  return AppDataSource.initialize();
}

export const handler = async (): Promise<MigrationResult> => {
  try {
    const dataSource = await getDataSource();

    // "all" = wszystkie migracje w jednej transakcji. Albo przejdą wszystkie,
    // albo żadna — nie zostajemy z bazą w połowie stanu.
    const executed = await dataSource.runMigrations({ transaction: "all" });
    const applied = executed.map((migration) => migration.name);

    if (applied.length === 0) {
      console.log("Brak migracji do zastosowania — baza jest aktualna.");
    } else {
      console.log(`Zastosowano migracji: ${applied.length}`, applied);
    }

    // Zwracamy wyłącznie nazwy migracji. Żadnych parametrów połączenia.
    return { ok: true, appliedCount: applied.length, applied };
  } catch (error: unknown) {
    // Pełny stack zostaje w CloudWatch — może zawierać host i użytkownika bazy.
    console.error(
      "Migracje nie powiodły się:",
      error instanceof Error ? error.stack : String(error),
    );

    // Rzucamy dalej z ogólnym komunikatem, żeby wywołanie Lambdy było
    // widocznie nieudane, ale bez wycieku szczegółów do odpowiedzi.
    throw new Error("Uruchomienie migracji nie powiodło się. Szczegóły w CloudWatch Logs.", {
      cause: error,
    });
  }
};
