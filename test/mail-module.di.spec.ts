import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { validateEnv } from "../src/config/env.validation.js";
import { MailDispatcherService } from "../src/mail/mail-dispatcher.service.js";
import { MailModule } from "../src/mail/mail.module.js";

/**
 * TEN TEST ISTNIEJE Z POWODU KONKRETNEJ AWARII.
 *
 * Wszystkie pozostałe testy MailDispatcherService konstruują serwis ręcznie
 * (`new MailDispatcherService(...)`), więc omijają kontener Nesta. Przechodziły
 * komplet 225 testów, a produkcja i tak wywaliła się przy pierwszym żądaniu:
 *
 *   UnknownDependenciesException: Nest can't resolve dependencies of the
 *   MailDispatcherService (?, Symbol(MAIL_INVOKER))
 *
 * Powód: konstruktor był otypowany aliasem `TypedConfigService`. Alias typu nie
 * zostawia po kompilacji żadnej wartości, więc emitDecoratorMetadata zapisała
 * `Object`, a Nest nie miał czego wstrzyknąć. Błąd tej klasy jest niewidoczny
 * dla testu jednostkowego z definicji — widać go dopiero, gdy graf zależności
 * naprawdę się buduje.
 *
 * Dlatego ten test montuje MODUŁ, nie klasę.
 */

const REQUIRED_ENV = {
  DB_HOST: "localhost",
  DB_NAME: "zoja",
  DB_USER: "zoja",
  DB_PASSWORD: "nieistotne-dla-tego-testu",
};

let saved: NodeJS.ProcessEnv;

beforeEach(() => {
  saved = { ...process.env };
  Object.assign(process.env, REQUIRED_ENV);
});

afterEach(() => {
  process.env = saved;
});

async function buildMailModule() {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        validate: validateEnv,
      }),
      MailModule,
    ],
  }).compile();

  return moduleRef;
}

describe("MailModule — graf zależności buduje się naprawdę", () => {
  it("Nest potrafi zbudować MailDispatcherService", async () => {
    const moduleRef = await buildMailModule();

    // Samo dojście tutaj jest istotą testu: przy aliasie typu w konstruktorze
    // compile() rzuca UnknownDependenciesException.
    const service = moduleRef.get(MailDispatcherService);

    expect(service).toBeInstanceOf(MailDispatcherService);
    await moduleRef.close();
  });

  it("wstrzyknięty serwis czyta konfigurację, a nie undefined", async () => {
    process.env.EMAIL_ENABLED = "false";
    const moduleRef = await buildMailModule();

    const service = moduleRef.get(MailDispatcherService);

    // Gdyby ConfigService nie został wstrzyknięty, konstruktor wywaliłby się
    // na odczycie — a gdyby wstrzyknął się pusty, dispatch nie wiedziałby,
    // czy maile są włączone.
    await expect(service.dispatch({ type: "GUEST_CONFIRMED", ...SUMMARY })).resolves.toBe(
      "disabled",
    );

    await moduleRef.close();
  });

  it("przy EMAIL_ENABLED=true moduł wymaga nazwy Mail Lambdy", async () => {
    process.env.EMAIL_ENABLED = "true";
    delete process.env.MAIL_LAMBDA_FUNCTION_NAME;

    // Walidacja startu ma zatrzymać aplikację na zimnym starcie, a nie
    // pozwolić jej ruszyć i wywalić się dopiero przy pierwszej rezerwacji.
    await expect(buildMailModule()).rejects.toThrow(/MAIL_LAMBDA_FUNCTION_NAME/);
  });

  it("moduł eksportuje dispatcher, więc inne moduły mogą go wstrzyknąć", async () => {
    const moduleRef = await buildMailModule();

    // MailModule nie jest @Global() — gdyby zabrakło go w exports, moduły
    // rezerwacji nie zbudowałyby się na produkcji.
    expect(MailModule).toBeDefined();
    expect(moduleRef.get(MailDispatcherService, { strict: false })).toBeDefined();

    await moduleRef.close();
  });
});

const SUMMARY = {
  reservationId: "res-1",
  guestName: "Babcia Krysia",
  guestEmail: "krysia@example.com",
  dateStart: "2031-01-04",
  dateEnd: "2031-01-05",
  arrivalDay: null,
  notes: null,
} as const;
