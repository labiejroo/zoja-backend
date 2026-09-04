import type { DataSourceOptions, EntitySchema, MixedList } from "typeorm";

import { CreateVisitSlotsAndReservations1788517800000 } from "../migrations/1788517800000-CreateVisitSlotsAndReservations.js";
import { Reservation } from "../reservations/reservation.entity.js";
import { VisitSlot } from "../visits/visit-slot.entity.js";

/**
 * Podzbiór konfiguracji potrzebny do zbudowania połączenia. Celowo nie zależymy
 * tu od ConfigService ani od `process.env`, żeby ta funkcja była wołalna
 * zarówno z Nesta, jak i z gołego skryptu CLI.
 */
export interface DatabaseEnv {
  DB_HOST: string;
  DB_PORT: number;
  DB_NAME: string;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_SSL: boolean;
  DB_POOL_MAX: number;
  DB_LOGGING: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * REJESTR ENCJI — dopisuj tutaj, importując klasę jawnie.
 *
 * Świadomie nie używamy globów w rodzaju `dist/**\/*.entity.js`. Projekt jest
 * modułem ESM, a w tym trybie globy TypeORM bywają zawodne: na Windows ścieżka
 * budowana przez `path.join` ma odwrotne ukośniki, których matcher nie rozumie,
 * a ładowanie odbywa się przez dynamiczny `import()` wrażliwy na rozszerzenie.
 * Jawna lista jest o jedną linijkę droższa przy dodaniu encji i o wieczór tańsza
 * przy debugowaniu „EntityMetadataNotFound" na produkcji.
 */
export const ENTITIES: MixedList<string | (new () => any) | EntitySchema<any>> = [
  VisitSlot,
  Reservation,
];

/** REJESTR MIGRACJI — ta sama zasada co przy encjach. */
export const MIGRATIONS: MixedList<string | (new () => any)> = [
  CreateVisitSlotsAndReservations1788517800000,
];

/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * JEDNO ŹRÓDŁO PRAWDY dla konfiguracji bazy.
 *
 * Korzystają z niej dwie ścieżki:
 *   1. aplikacja Nest         — database.module.ts (forRootAsync)
 *   2. migracje i TypeORM CLI — data-source.ts
 *
 * Gdyby każda budowała opcje osobno, łatwo o sytuację, w której migracje jadą
 * na innym SSL, innym schemacie albo innej bazie niż aplikacja — a taki błąd
 * ujawnia się dopiero na produkcji.
 */
export function buildTypeOrmOptions(env: DatabaseEnv): DataSourceOptions {
  return {
    type: "postgres",
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    username: env.DB_USER,
    password: env.DB_PASSWORD,

    // RDS używa certyfikatu z własnego CA Amazona. `rejectUnauthorized: false`
    // szyfruje połączenie, ale nie weryfikuje łańcucha zaufania. Docelowo warto
    // dołożyć bundle rds-ca i przełączyć na pełną weryfikację — TODO w README.
    ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,

    // Schemat zmieniają wyłącznie migracje. Nigdy nie włączamy synchronize.
    synchronize: false,
    // Migracje odpala osobna Lambda, nie start aplikacji.
    migrationsRun: false,

    entities: ENTITIES,
    migrations: MIGRATIONS,
    migrationsTableName: "zoja_migrations",

    logging: env.DB_LOGGING ? ["query", "error"] : ["error"],

    // Ustawienia puli `pg`. Rozmiar puli jest jednym z dwóch czynników
    // ograniczających obciążenie RDS — drugim jest współbieżność Lambdy.
    // Faktyczny sufit to w przybliżeniu:
    //     liczba równoległych środowisk wykonawczych × DB_POOL_MAX
    // Oba trzeba kontrolować; szczegóły w README.
    extra: {
      max: env.DB_POOL_MAX,
      // Health check ma zawieść szybko, a nie wisieć do limitu API Gateway.
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      keepAlive: true,
    },
  };
}
