import { UnauthorizedException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { describe, expect, it, vi } from "vitest";

import { AdminAuthController } from "../src/admin-auth/admin-auth.controller.js";
import { parseAdminAuthSecret } from "../src/admin-auth/admin-auth-secret.service.js";
import { AdminAuthService } from "../src/admin-auth/admin-auth.service.js";
import { AdminSessionGuard } from "../src/admin-auth/admin-session.guard.js";
import { SESSION_COOKIE } from "../src/admin-auth/cookie.js";
import { LoginDto } from "../src/admin-auth/dto/login.dto.js";
import { hashPassword } from "../src/admin-auth/password.js";

const PASSWORD = "prawidlowe-haslo-gospodarzy";
const SESSION_SECRET = "klucz-hmac-o-dostatecznej-dlugosci-do-testow-1234567890";
const TTL = 86_400;

async function setup(overrides: { ttl?: number } = {}) {
  const passwordHash = await hashPassword(PASSWORD);

  const config = {
    get: (key: string) => (key === "ADMIN_SESSION_TTL_SECONDS" ? (overrides.ttl ?? TTL) : ""),
  };

  const secrets = {
    load: vi.fn().mockResolvedValue({ passwordHash, sessionSecret: SESSION_SECRET }),
  };

  const auth = new AdminAuthService(config as never, secrets as never);
  const controller = new AdminAuthController(auth);
  const guard = new AdminSessionGuard(auth);

  return { auth, controller, guard, secrets };
}

/** Zbiera nagłówki tak, jak zrobiłby to Express. */
function fakeResponse() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  };
}

function fakeContext(cookieHeader?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: cookieHeader ? { cookie: cookieHeader } : {},
        method: "GET",
        url: "/api/admin/visit-slots",
      }),
    }),
  };
}

describe("POST /api/admin/auth/login", () => {
  it("poprawne hasło zwraca authenticated: true", async () => {
    const { controller } = await setup();
    const res = fakeResponse();

    const result = await controller.login({ password: PASSWORD }, res as never);

    expect(result).toEqual({ authenticated: true });
  });

  it("ustawia ciasteczko z pełnym zestawem atrybutów", async () => {
    const { controller } = await setup();
    const res = fakeResponse();

    await controller.login({ password: PASSWORD }, res as never);
    const cookie = res.headers["Set-Cookie"];

    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/api/admin");
    expect(cookie).toContain("Max-Age=86400");
  });

  /**
   * Token wychodzi WYŁĄCZNIE w Set-Cookie. Zwrócenie go w JSON-ie oddałoby go
   * JavaScriptowi strony i przekreśliło sens flagi HttpOnly.
   */
  it("odpowiedź nie zawiera tokenu sesji", async () => {
    const { controller } = await setup();
    const res = fakeResponse();

    const result = await controller.login({ password: PASSWORD }, res as never);
    const token = res.headers["Set-Cookie"].split(";")[0].split("=")[1];

    expect(JSON.stringify(result)).not.toContain(token);
    expect(Object.keys(result)).toEqual(["authenticated"]);
  });

  it("błędne hasło daje 401 z neutralnym komunikatem", async () => {
    const { controller } = await setup();
    const res = fakeResponse();

    await expect(controller.login({ password: "zle-haslo" }, res as never)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(controller.login({ password: "zle-haslo" }, res as never)).rejects.toThrow(
      "Nie udało się zalogować.",
    );
  });

  it("błędne hasło NIE ustawia ciasteczka", async () => {
    const { controller } = await setup();
    const res = fakeResponse();

    await controller.login({ password: "zle-haslo" }, res as never).catch(() => undefined);

    expect(res.headers["Set-Cookie"]).toBeUndefined();
  });

  it("odpowiedź o niepowodzeniu nie zdradza, co było nie tak", async () => {
    const { controller } = await setup();
    const res = fakeResponse();

    const error = await controller
      .login({ password: "zle-haslo" }, res as never)
      .catch((caught: Error) => caught);

    const message = (error as Error).message;
    expect(message).not.toMatch(/hash|scrypt|hasł[oa] jest|nie istnieje/i);
  });
});

describe("GET /api/admin/auth/session", () => {
  it("bez ciasteczka zwraca 200 i authenticated: false", async () => {
    const { controller } = await setup();

    await expect(controller.session({ headers: {} })).resolves.toEqual({ authenticated: false });
  });

  it("z ważnym ciasteczkiem zwraca authenticated: true", async () => {
    const { controller } = await setup();
    const res = fakeResponse();
    await controller.login({ password: PASSWORD }, res as never);

    const cookie = res.headers["Set-Cookie"].split(";")[0];

    await expect(controller.session({ headers: { cookie } })).resolves.toEqual({
      authenticated: true,
    });
  });

  it("zniekształcone ciasteczko daje false, a nie błąd", async () => {
    const { controller } = await setup();

    await expect(
      controller.session({ headers: { cookie: `${SESSION_COOKIE}=cos.zepsutego` } }),
    ).resolves.toEqual({ authenticated: false });
  });

  it("wygasła sesja daje false, a nie 401", async () => {
    // Endpoint służy do CICHEGO sprawdzania — 401 zostawiałby czerwony błąd
    // w konsoli przy każdym wejściu gościa na stronę.
    const { controller } = await setup({ ttl: 60 });
    const res = fakeResponse();
    await controller.login({ password: PASSWORD }, res as never);
    const cookie = res.headers["Set-Cookie"].split(";")[0];

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 61_000));

    await expect(controller.session({ headers: { cookie } })).resolves.toEqual({
      authenticated: false,
    });

    vi.useRealTimers();
  });
});

describe("POST /api/admin/auth/logout", () => {
  it("kasuje ciasteczko tymi samymi atrybutami", async () => {
    const { controller } = await setup();
    const res = fakeResponse();

    const result = controller.logout(res as never);

    expect(result).toEqual({ authenticated: false });
    expect(res.headers["Set-Cookie"]).toContain(`${SESSION_COOKIE}=;`);
    expect(res.headers["Set-Cookie"]).toContain("Max-Age=0");
    expect(res.headers["Set-Cookie"]).toContain("Path=/api/admin");
    expect(res.headers["Set-Cookie"]).toContain("SameSite=Strict");
  });

  it("jest idempotentny — działa bez istniejącej sesji", async () => {
    const { controller } = await setup();

    expect(controller.logout(fakeResponse() as never)).toEqual({ authenticated: false });
    expect(controller.logout(fakeResponse() as never)).toEqual({ authenticated: false });
  });
});

describe("AdminSessionGuard", () => {
  it("przepuszcza żądanie z ważną sesją", async () => {
    const { controller, guard } = await setup();
    const res = fakeResponse();
    await controller.login({ password: PASSWORD }, res as never);
    const cookie = res.headers["Set-Cookie"].split(";")[0];

    await expect(guard.canActivate(fakeContext(cookie) as never)).resolves.toBe(true);
  });

  it("odrzuca żądanie bez ciasteczka", async () => {
    const { guard } = await setup();

    await expect(guard.canActivate(fakeContext() as never)).rejects.toThrow(UnauthorizedException);
  });

  it("odrzuca zły podpis", async () => {
    const { guard } = await setup();

    await expect(
      guard.canActivate(fakeContext(`${SESSION_COOKIE}=cGF5bG9hZA.zlypodpis`) as never),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("odrzuca wygasłą sesję", async () => {
    const { controller, guard } = await setup({ ttl: 60 });
    const res = fakeResponse();
    await controller.login({ password: PASSWORD }, res as never);
    const cookie = res.headers["Set-Cookie"].split(";")[0];

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 61_000));

    await expect(guard.canActivate(fakeContext(cookie) as never)).rejects.toThrow(
      UnauthorizedException,
    );

    vi.useRealTimers();
  });

  it("komunikat odmowy nie zdradza powodu", async () => {
    const { guard } = await setup();

    const error = await guard
      .canActivate(fakeContext() as never)
      .catch((caught: Error) => caught);

    expect((error as Error).message).toBe("Zaloguj się w trybie gospodarzy.");
  });
});

describe("Sekret zoja/admin-auth — walidacja formatu", () => {
  const valid = JSON.stringify({
    passwordHash: `scrypt-v1$${"a".repeat(22)}$${"b".repeat(86)}`,
    sessionSecret: SESSION_SECRET,
  });

  it("przyjmuje poprawny dokument", () => {
    expect(parseAdminAuthSecret(valid)).toMatchObject({ sessionSecret: SESSION_SECRET });
  });

  const broken: [string, string][] = [
    ["nie-JSON", "to nie jest json"],
    ["nie obiekt", '"napis"'],
    ["brak passwordHash", JSON.stringify({ sessionSecret: SESSION_SECRET })],
    ["brak sessionSecret", JSON.stringify({ passwordHash: "scrypt-v1$a$b" })],
    [
      "za krótki sessionSecret",
      JSON.stringify({ passwordHash: "scrypt-v1$a$b", sessionSecret: "krotki" }),
    ],
    [
      "passwordHash w obcym formacie",
      JSON.stringify({ passwordHash: "bcrypt$cos", sessionSecret: SESSION_SECRET }),
    ],
    [
      "hasło jawne zamiast hasha",
      JSON.stringify({ password: "tajne", sessionSecret: SESSION_SECRET }),
    ],
  ];

  broken.forEach(([label, raw]) => {
    it(`odrzuca: ${label}`, () => {
      expect(() => parseAdminAuthSecret(raw)).toThrow();
    });
  });

  it("komunikaty błędów nie zawierają wartości sekretu", () => {
    const error = (() => {
      try {
        parseAdminAuthSecret(JSON.stringify({ passwordHash: "zle", sessionSecret: SESSION_SECRET }));
      } catch (caught) {
        return caught as Error;
      }
      return null;
    })();

    expect(error?.message).not.toContain(SESSION_SECRET);
    expect(error?.message).not.toContain("zle");
  });
});

describe("LoginDto", () => {
  function build(payload: Record<string, unknown>) {
    const dto = plainToInstance(LoginDto, payload);
    const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
    return { dto, errors: errors.map((e) => e.property) };
  }

  it("przyjmuje hasło", () => {
    expect(build({ password: "tajne-haslo" }).errors).toEqual([]);
  });

  it("NIE przycina spacji — spacja może być częścią hasła", () => {
    expect(build({ password: " z odstepami " }).dto.password).toBe(" z odstepami ");
  });

  it("odrzuca brak hasła i puste hasło", () => {
    expect(build({}).errors).toContain("password");
    expect(build({ password: "" }).errors).toContain("password");
  });

  it("odrzuca hasło dłuższe niż limit", () => {
    expect(build({ password: "a".repeat(257) }).errors).toContain("password");
  });

  it("odrzuca pola spoza kontraktu", () => {
    expect(build({ password: "x", admin: true }).errors).toContain("admin");
  });
});
