import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AdminAuthController } from "../src/admin-auth/admin-auth.controller.js";
import { AdminAuthModule } from "../src/admin-auth/admin-auth.module.js";
import { AdminAuthSecretService } from "../src/admin-auth/admin-auth-secret.service.js";
import { AdminAuthService } from "../src/admin-auth/admin-auth.service.js";
import { AdminSessionGuard } from "../src/admin-auth/admin-session.guard.js";
import { AdminModule } from "../src/admin/admin.module.js";
import { AdminReservationsController } from "../src/admin/admin-reservations.controller.js";
import { AdminVisitSlotsController } from "../src/admin/admin-visit-slots.controller.js";
import { validateEnv } from "../src/config/env.validation.js";
import { Reservation } from "../src/reservations/reservation.entity.js";
import { VisitSlot } from "../src/visits/visit-slot.entity.js";

/**
 * TEN TEST ISTNIEJE Z POWODU KONKRETNEJ AWARII PRODUKCYJNEJ.
 *
 * Przy wdrożeniu warstwy mailowej wszystkie 225 testów przechodziło, a mimo to
 * API zwracało 500 na każde żądanie:
 *
 *   Nest can't resolve dependencies of the MailDispatcherService
 *
 * Powód: konstruktor był otypowany ALIASEM TYPU (TypedConfigService), po którym
 * nie zostaje w kompilacie żadna wartość, więc Nest nie miał czego wstrzyknąć.
 * Testy jednostkowe tego nie widziały, bo konstruowały serwisy przez `new`,
 * z pominięciem kontenera.
 *
 * Warstwa auth używa DOKŁADNIE TEGO SAMEGO wzorca w dwóch miejscach
 * (AdminAuthSecretService i AdminAuthService), więc ryzyko jest identyczne.
 * Dlatego ten test montuje MODUŁY, a nie klasy — i sprawdza także, czy
 * AdminModule potrafi się zbudować z guardem na kontrolerach.
 */

const REQUIRED_ENV = {
  DB_HOST: "localhost",
  DB_NAME: "zoja",
  DB_USER: "zoja",
  DB_PASSWORD: "nieistotne-dla-tego-testu",
  AWS_REGION: "eu-central-1",
};

let saved: NodeJS.ProcessEnv;

beforeEach(() => {
  saved = { ...process.env };
  Object.assign(process.env, REQUIRED_ENV);
});

afterEach(() => {
  process.env = saved;
});

const configModule = () =>
  ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: validateEnv });

describe("AdminAuthModule — graf zależności buduje się naprawdę", () => {
  it("Nest buduje serwis sekretu, serwis auth, guard i kontroler", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [configModule(), AdminAuthModule],
    }).compile();

    // Samo dojście tutaj jest istotą testu: przy aliasie typu w konstruktorze
    // compile() rzuca UnknownDependenciesException.
    expect(moduleRef.get(AdminAuthSecretService)).toBeInstanceOf(AdminAuthSecretService);
    expect(moduleRef.get(AdminAuthService)).toBeInstanceOf(AdminAuthService);
    expect(moduleRef.get(AdminSessionGuard)).toBeInstanceOf(AdminSessionGuard);
    expect(moduleRef.get(AdminAuthController)).toBeInstanceOf(AdminAuthController);

    await moduleRef.close();
  });

  it("wstrzyknięty serwis czyta konfigurację, a nie undefined", async () => {
    process.env.ADMIN_SESSION_TTL_SECONDS = "3600";

    const moduleRef = await Test.createTestingModule({
      imports: [configModule(), AdminAuthModule],
    }).compile();

    // Gdyby ConfigService nie został wstrzyknięty, konstruktor wywaliłby się
    // na odczycie; gdyby wstrzyknął się pusty, TTL byłby undefined.
    expect(moduleRef.get(AdminAuthService).sessionTtlSeconds).toBe(3600);

    await moduleRef.close();
  });

  it("domyślne TTL to doba", async () => {
    delete process.env.ADMIN_SESSION_TTL_SECONDS;

    const moduleRef = await Test.createTestingModule({
      imports: [configModule(), AdminAuthModule],
    }).compile();

    expect(moduleRef.get(AdminAuthService).sessionTtlSeconds).toBe(86_400);

    await moduleRef.close();
  });
});

describe("AdminModule — kontrolery panelu budują się z guardem", () => {
  /**
   * Repozytoria podmieniamy, żeby nie dotykać bazy. Reszta grafu — w tym
   * import AdminAuthModule i rozwiązanie AdminSessionGuard na obu kontrolerach
   * — buduje się naprawdę.
   */
  async function buildAdminModule() {
    return Test.createTestingModule({
      imports: [configModule(), AdminModule],
    })
      .overrideProvider(getRepositoryToken(Reservation))
      .useValue({})
      .overrideProvider(getRepositoryToken(VisitSlot))
      .useValue({})
      .compile();
  }

  it("AdminModule kompiluje się z AdminAuthModule w importach", async () => {
    const moduleRef = await buildAdminModule();

    expect(moduleRef.get(AdminReservationsController)).toBeInstanceOf(AdminReservationsController);
    expect(moduleRef.get(AdminVisitSlotsController)).toBeInstanceOf(AdminVisitSlotsController);

    await moduleRef.close();
  });

  /**
   * Guard musi być OSIĄGALNY z kontekstu AdminModule. Gdyby AdminAuthModule
   * przestał go eksportować, kontrolery nie zbudowałyby się na produkcji —
   * a lokalnie nic by tego nie pokazało.
   */
  it("AdminSessionGuard jest osiągalny z kontekstu AdminModule", async () => {
    const moduleRef = await buildAdminModule();

    expect(moduleRef.get(AdminSessionGuard, { strict: false })).toBeInstanceOf(AdminSessionGuard);

    await moduleRef.close();
  });
});
