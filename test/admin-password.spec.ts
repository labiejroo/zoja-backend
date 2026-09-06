import { describe, expect, it } from "vitest";

import {
  buildClearedSessionCookie,
  buildSessionCookie,
  readSessionCookie,
  SESSION_COOKIE,
} from "../src/admin-auth/cookie.js";
import { hashPassword, SCRYPT_PARAMS, verifyPassword } from "../src/admin-auth/password.js";

const PASSWORD = "prawidlowe-haslo-gospodarzy-2026";

describe("Hasło gospodarzy — scrypt", () => {
  it("przyjmuje poprawne hasło", async () => {
    const stored = await hashPassword(PASSWORD);

    await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(true);
  });

  it("odrzuca błędne hasło", async () => {
    const stored = await hashPassword(PASSWORD);

    await expect(verifyPassword("zupelnie-inne-haslo", stored)).resolves.toBe(false);
  });

  it("odrzuca hasło różniące się jednym znakiem", async () => {
    const stored = await hashPassword(PASSWORD);

    await expect(verifyPassword(`${PASSWORD}x`, stored)).resolves.toBe(false);
    await expect(verifyPassword(PASSWORD.slice(0, -1), stored)).resolves.toBe(false);
  });

  it("rozróżnia wielkość liter i spacje na końcu", async () => {
    const stored = await hashPassword(PASSWORD);

    await expect(verifyPassword(PASSWORD.toUpperCase(), stored)).resolves.toBe(false);
    // Spacja MOŻE być częścią hasła — DTO celowo go nie przycina.
    await expect(verifyPassword(`${PASSWORD} `, stored)).resolves.toBe(false);
  });

  it("ma format scrypt-v1 z trzema częściami", async () => {
    const stored = await hashPassword(PASSWORD);
    const parts = stored.split("$");

    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("scrypt-v1");
    expect(parts[1]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parts[2]).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("koduje sól 16 bajtów i klucz o zadanej długości", async () => {
    const [, salt, hash] = (await hashPassword(PASSWORD)).split("$");

    expect(Buffer.from(salt, "base64url")).toHaveLength(16);
    expect(Buffer.from(hash, "base64url")).toHaveLength(SCRYPT_PARAMS.keyLength);
  });

  it("sól jest losowa — ten sam tekst daje inny hash", async () => {
    const first = await hashPassword(PASSWORD);
    const second = await hashPassword(PASSWORD);

    expect(first).not.toBe(second);
    expect(first.split("$")[1]).not.toBe(second.split("$")[1]);

    // Oba muszą jednak weryfikować to samo hasło.
    await expect(verifyPassword(PASSWORD, first)).resolves.toBe(true);
    await expect(verifyPassword(PASSWORD, second)).resolves.toBe(true);
  });

  it("hash z inną solą nie pasuje do cudzego hasha", async () => {
    const [, saltA] = (await hashPassword(PASSWORD)).split("$");
    const [, , hashB] = (await hashPassword(PASSWORD)).split("$");

    // Sól z jednego, hash z drugiego — poprawny format, niepoprawna para.
    await expect(verifyPassword(PASSWORD, `scrypt-v1$${saltA}$${hashB}`)).resolves.toBe(false);
  });

  /**
   * Zniekształcony hash to błąd KONFIGURACJI, nie próba włamania. Ma dawać
   * to samo `false` co złe hasło, a nie wyjątek: różnica między 500 a 401
   * podpowiadałaby atakującemu, że trafił w coś nietypowego.
   */
  describe("uszkodzony hash nigdy nie rzuca", () => {
    const malformed = [
      ["pusty", ""],
      ["bez prefiksu", "$sol$hash"],
      ["obca wersja", "scrypt-v2$c29sZG91Ymxl$aGFzaA"],
      ["dwie części", "scrypt-v1$tylkosol"],
      ["cztery części", "scrypt-v1$a$b$c"],
      ["za krótka sól", "scrypt-v1$YWJj$aGFzaA"],
      ["śmieci", "zupelnie-nie-hash"],
      ["sam prefiks", "scrypt-v1"],
    ] as const;

    malformed.forEach(([label, stored]) => {
      it(`${label} daje false, nie wyjątek`, async () => {
        await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(false);
      });
    });
  });
});

describe("Ciasteczko sesji", () => {
  it("ma wszystkie atrybuty chroniące sesję", () => {
    const cookie = buildSessionCookie("token-abc", { maxAgeSeconds: 86400 });

    expect(cookie).toContain(`${SESSION_COOKIE}=token-abc`);
    expect(cookie).toContain("Path=/api/admin");
    expect(cookie).toContain("Max-Age=86400");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
  });

  it("nie ustawia Domain — ciasteczko jest host-only", () => {
    // Z atrybutem Domain ciasteczko zjechałoby na wszystkie subdomeny.
    expect(buildSessionCookie("t", { maxAgeSeconds: 60 })).not.toContain("Domain");
  });

  it("kasowanie używa TYCH SAMYCH atrybutów co ustawianie", () => {
    const cleared = buildClearedSessionCookie();

    // Przy innej ścieżce przeglądarka utworzyłaby drugie, puste ciasteczko,
    // a oryginalna sesja żyłaby dalej.
    expect(cleared).toContain(`${SESSION_COOKIE}=;`);
    expect(cleared).toContain("Path=/api/admin");
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("HttpOnly");
    expect(cleared).toContain("Secure");
    expect(cleared).toContain("SameSite=Strict");
  });

  it("czyta wartość z nagłówka Cookie", () => {
    expect(readSessionCookie(`${SESSION_COOKIE}=wartosc`)).toBe("wartosc");
    expect(readSessionCookie(`inne=1; ${SESSION_COOKIE}=wartosc; jeszcze=2`)).toBe("wartosc");
    expect(readSessionCookie(`inne=1;${SESSION_COOKIE}=wartosc`)).toBe("wartosc");
  });

  it("zwraca undefined, gdy ciasteczka nie ma", () => {
    expect(readSessionCookie(undefined)).toBeUndefined();
    expect(readSessionCookie("")).toBeUndefined();
    expect(readSessionCookie("inne=1; jeszcze=2")).toBeUndefined();
    expect(readSessionCookie(`${SESSION_COOKIE}=`)).toBeUndefined();
  });

  it("nie daje się zmylić nazwą, która tylko zawiera naszą", () => {
    expect(readSessionCookie(`nie_${SESSION_COOKIE}=obce`)).toBeUndefined();
    expect(readSessionCookie(`${SESSION_COOKIE}_stare=obce`)).toBeUndefined();
  });
});
