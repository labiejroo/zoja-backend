import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * SESJA GOSPODARZY — własny podpisany token, bez biblioteki JWT.
 *
 * DLACZEGO NIE JWT
 * Potrzebujemy jednego roszczenia: „ktoś znał hasło i było to mniej niż dobę
 * temu”. JWT dokłada do tego negocjację algorytmu — a to właśnie ona jest
 * źródłem klasycznej podatności `alg: none`, w której atakujący podmienia
 * nagłówek i podpis przestaje być sprawdzany. Tutaj algorytm jest jeden,
 * zapisany w kodzie, i nie da się go wskazać z zewnątrz.
 *
 * Format:
 *
 *     base64url(JSON payload) . base64url(HMAC-SHA256(payload))
 *
 * Podpisujemy TEKST zakodowany w base64url, nie odtworzony JSON. Gdyby podpis
 * liczyć z JSON-a po przetworzeniu, dwa różne zapisy tego samego obiektu
 * (inna kolejność kluczy, inne odstępy) dałyby ten sam podpis — a stąd już
 * blisko do przemycenia payloadu, który weryfikuje się inaczej, niż wygląda.
 */

export const SESSION_VERSION = 1;
export const SESSION_PURPOSE = "zoja-admin";

/**
 * Zawartość sesji. Świadomie nie ma tu ani adresu, ani nazwiska, ani niczego
 * o rezerwacjach: payload jest zakodowany, a nie zaszyfrowany, więc każdy, kto
 * ma ciasteczko, odczyta go w dwie sekundy. Jest tam wyłącznie to, co i tak
 * wynika z samego faktu posiadania sesji.
 */
export interface AdminSessionPayload {
  v: number;
  iat: number;
  exp: number;
  purpose: string;
}

/**
 * Górny limit na wiek sesji liczony od `iat`. Chroni przed tokenem z odległej
 * przyszłości: gdyby zegar maszyny podpisującej odjechał, `exp` mogłoby wypaść
 * za rok, a sesja przeżyłaby zmianę hasła o wiele miesięcy.
 */
const MAX_SESSION_AGE_SECONDS = 7 * 24 * 60 * 60;

/** Tolerancja na rozjazd zegarów między środowiskami wykonawczymi Lambdy. */
const CLOCK_SKEW_SECONDS = 60;

const nowSeconds = (now: Date = new Date()): number => Math.floor(now.getTime() / 1000);

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function issueSession(secret: string, ttlSeconds: number, now: Date = new Date()): string {
  const issuedAt = nowSeconds(now);

  const payload: AdminSessionPayload = {
    v: SESSION_VERSION,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    purpose: SESSION_PURPOSE,
  };

  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

  return `${encoded}.${sign(encoded, secret)}`;
}

/**
 * Weryfikacja — kolejność kroków ma znaczenie.
 *
 * PODPIS SPRAWDZAMY PRZED ODCZYTANIEM PAYLOADU. Kuszące jest zajrzeć najpierw
 * do `exp`, żeby szybko odrzucić wygasłe, ale wtedy podejmowalibyśmy decyzje
 * na podstawie danych, których nikt jeszcze nie uwierzytelnił. Dopóki HMAC się
 * nie zgadza, payload jest wyłącznie ciągiem bajtów od nieznajomego.
 *
 * Zwraca null zamiast rzucać: każdy powód odrzucenia — brak, zły format, zły
 * podpis, wygasła — daje z zewnątrz tę samą odpowiedź. Rozróżnianie ich
 * mówiłoby atakującemu, jak blisko był.
 */
export function verifySession(
  token: string | undefined,
  secret: string,
  now: Date = new Date(),
): AdminSessionPayload | null {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encoded, providedSignature] = parts;
  if (encoded.length === 0 || providedSignature.length === 0) return null;

  const expectedSignature = sign(encoded, secret);

  const provided = Buffer.from(providedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");

  // timingSafeEqual wymaga równych długości — inaczej rzuca. Różna długość
  // i tak znaczy zły podpis, więc odrzucamy bez porównywania bajtów.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  // Dopiero teraz payload jest nasz: podpis dowodzi, że nikt go nie tknął.
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof payload !== "object" || payload === null) return null;

  const candidate = payload as Record<string, unknown>;

  if (candidate.v !== SESSION_VERSION) return null;
  if (candidate.purpose !== SESSION_PURPOSE) return null;
  if (typeof candidate.iat !== "number" || !Number.isFinite(candidate.iat)) return null;
  if (typeof candidate.exp !== "number" || !Number.isFinite(candidate.exp)) return null;

  const current = nowSeconds(now);

  if (candidate.exp <= current) return null;
  if (candidate.iat > current + CLOCK_SKEW_SECONDS) return null;
  if (current - candidate.iat > MAX_SESSION_AGE_SECONDS) return null;

  return candidate as unknown as AdminSessionPayload;
}
