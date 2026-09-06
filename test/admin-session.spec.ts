import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  issueSession,
  verifySession,
  SESSION_PURPOSE,
  SESSION_VERSION,
  type AdminSessionPayload,
} from "../src/admin-auth/admin-session.js";

const SECRET = "klucz-hmac-o-dostatecznej-dlugosci-do-testow-1234567890";
const OTHER_SECRET = "zupelnie-inny-klucz-hmac-do-testow-0987654321-abcdefgh";
const TTL = 86_400;

const NOW = new Date("2026-09-05T12:00:00Z");

function decode(token: string): AdminSessionPayload {
  return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
}

/** Buduje token z dowolnym payloadem, podpisany podanym kluczem. */
function forge(payload: Record<string, unknown>, secret = SECRET): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

describe("Token sesji — wydawanie", () => {
  it("ma dwie części rozdzielone kropką", () => {
    const token = issueSession(SECRET, TTL, NOW);

    expect(token.split(".")).toHaveLength(2);
    token.split(".").forEach((part) => expect(part).toMatch(/^[A-Za-z0-9_-]+$/));
  });

  it("payload zawiera wersję, cel i znaczniki czasu", () => {
    const payload = decode(issueSession(SECRET, TTL, NOW));

    expect(payload.v).toBe(SESSION_VERSION);
    expect(payload.purpose).toBe(SESSION_PURPOSE);
    expect(payload.iat).toBe(Math.floor(NOW.getTime() / 1000));
    expect(payload.exp).toBe(Math.floor(NOW.getTime() / 1000) + TTL);
  });

  /**
   * Payload jest zakodowany, a NIE zaszyfrowany — każdy, kto ma ciasteczko,
   * odczyta go w dwie sekundy. Dlatego nie może być tam niczego wrażliwego.
   */
  it("payload nie zawiera niczego prywatnego", () => {
    const token = issueSession(SECRET, TTL, NOW);
    const payload = decode(token);

    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "purpose", "v"]);
    expect(token).not.toContain(SECRET);
    expect(JSON.stringify(payload)).not.toContain(SECRET);
  });
});

describe("Token sesji — weryfikacja", () => {
  it("przyjmuje świeżo wydany token", () => {
    const token = issueSession(SECRET, TTL, NOW);

    expect(verifySession(token, SECRET, NOW)).not.toBeNull();
  });

  it("odrzuca token podpisany innym kluczem", () => {
    const token = issueSession(OTHER_SECRET, TTL, NOW);

    expect(verifySession(token, SECRET, NOW)).toBeNull();
  });

  it("odrzuca token z podmienionym podpisem", () => {
    const [payload] = issueSession(SECRET, TTL, NOW).split(".");

    expect(verifySession(`${payload}.podrobionypodpis`, SECRET, NOW)).toBeNull();
  });

  it("odrzuca token wygasły", () => {
    const token = issueSession(SECRET, 60, NOW);
    const later = new Date(NOW.getTime() + 61_000);

    expect(verifySession(token, SECRET, later)).toBeNull();
  });

  it("odrzuca token dokładnie w momencie wygaśnięcia", () => {
    const token = issueSession(SECRET, 60, NOW);

    // Granica należy do stanu wygasłego — bez jednosekundowej szczeliny.
    expect(verifySession(token, SECRET, new Date(NOW.getTime() + 60_000))).toBeNull();
  });

  /**
   * SEDNO PODPISU: przedłużenie ważności wymaga przeliczenia HMAC, a tego bez
   * klucza zrobić się nie da. Podmiana samego exp psuje podpis.
   */
  it("odrzuca token z ręcznie przedłużonym exp", () => {
    const token = issueSession(SECRET, 60, NOW);
    const payload = decode(token);

    const tampered = Buffer.from(
      JSON.stringify({ ...payload, exp: payload.exp + 100_000 }),
      "utf8",
    ).toString("base64url");

    // Stary podpis przy nowym payloadzie.
    expect(verifySession(`${tampered}.${token.split(".")[1]}`, SECRET, NOW)).toBeNull();
  });

  it("odrzuca token z przedłużonym exp NAWET gdy podpis przeliczono innym kluczem", () => {
    const base = decode(issueSession(SECRET, 60, NOW));
    const forged = forge({ ...base, exp: base.exp + 100_000 }, OTHER_SECRET);

    expect(verifySession(forged, SECRET, NOW)).toBeNull();
  });

  it("odrzuca obcą wersję", () => {
    const base = decode(issueSession(SECRET, TTL, NOW));

    expect(verifySession(forge({ ...base, v: 2 }), SECRET, NOW)).toBeNull();
  });

  it("odrzuca obcy purpose", () => {
    const base = decode(issueSession(SECRET, TTL, NOW));

    // Token wydany do czegoś innego nie ma otwierać panelu gospodarzy.
    expect(verifySession(forge({ ...base, purpose: "cos-innego" }), SECRET, NOW)).toBeNull();
  });

  it("odrzuca token z iat z przyszłości", () => {
    const current = Math.floor(NOW.getTime() / 1000);
    const forged = forge({
      v: SESSION_VERSION,
      purpose: SESSION_PURPOSE,
      iat: current + 3600,
      exp: current + 7200,
    });

    expect(verifySession(forged, SECRET, NOW)).toBeNull();
  });

  it("odrzuca token starszy niż górny limit wieku", () => {
    const current = Math.floor(NOW.getTime() / 1000);
    // Wydany 30 dni temu, ale z exp w przyszłości — np. po odjeździe zegara.
    const forged = forge({
      v: SESSION_VERSION,
      purpose: SESSION_PURPOSE,
      iat: current - 30 * 24 * 3600,
      exp: current + 3600,
    });

    expect(verifySession(forged, SECRET, NOW)).toBeNull();
  });

  describe("zniekształcone wejście daje null, nie wyjątek", () => {
    const cases = [
      ["undefined", undefined],
      ["pusty string", ""],
      ["bez kropki", "samtekstbezkropki"],
      ["trzy części", "a.b.c"],
      ["pusty payload", ".podpis"],
      ["pusty podpis", "cGF5bG9hZA."],
      ["payload nie-JSON", forge({} as Record<string, unknown>).replace(/^[^.]+/, "bm90LWpzb24")],
      ["śmieci", "!@#$.%^&*"],
    ] as const;

    cases.forEach(([label, token]) => {
      it(label, () => {
        expect(verifySession(token as string | undefined, SECRET, NOW)).toBeNull();
      });
    });
  });

  it("payload niebędący obiektem jest odrzucany", () => {
    const encoded = Buffer.from(JSON.stringify("napis"), "utf8").toString("base64url");
    const signature = createHmac("sha256", SECRET).update(encoded).digest("base64url");

    // Podpis poprawny, treść bezsensowna — i tak null.
    expect(verifySession(`${encoded}.${signature}`, SECRET, NOW)).toBeNull();
  });
});
