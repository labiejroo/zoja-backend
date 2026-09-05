import { createHash, randomBytes } from "node:crypto";

/**
 * TOKEN DECYZJI — jawny w mailu, hashowany w bazie.
 *
 * Link „Potwierdź” z maila musi dawać moc podjęcia decyzji bez logowania, więc
 * sam token JEST poświadczeniem. Stąd dwie zasady, których pilnuje ten plik:
 *
 *   1. token pochodzi z CSPRNG, nie z Math.random ani z id rezerwacji;
 *   2. w bazie ląduje wyłącznie skrót, nigdy oryginał.
 *
 * Dzięki temu kopia bazy (zrzut, backup, log zapytań) nie zawiera niczego, czym
 * dałoby się kliknąć w cudzym imieniu.
 */

/**
 * 32 bajty entropii, czyli 256 bitów. Zgadywanie takiego tokenu jest poza
 * zasięgiem kogokolwiek, a base64url mieści go w 43 znakach bezpiecznych
 * w URL-u — bez procentowego kodowania, które psułoby link w kliencie poczty.
 */
const TOKEN_BYTES = 32;

/** Ile czasu rodzice mają na decyzję z maila. */
export const DECISION_TOKEN_TTL_DAYS = 7;

const MILLIS_PER_DAY = 86_400_000;

/** Długość SHA-256 zapisanego szesnastkowo — tyle samo ma kolumna w bazie. */
export const DECISION_TOKEN_HASH_LENGTH = 64;

export interface DecisionToken {
  /** Trafia WYŁĄCZNIE do treści maila. Nigdy do bazy, logów ani odpowiedzi. */
  raw: string;
  /** To zapisujemy przy rezerwacji. */
  hash: string;
  expiresAt: Date;
}

/** SHA-256 w lowercase hex. Ta sama funkcja przy zapisie i przy wyszukiwaniu. */
export function hashDecisionToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function createDecisionToken(now: Date = new Date()): DecisionToken {
  const raw = randomBytes(TOKEN_BYTES).toString("base64url");

  return {
    raw,
    hash: hashDecisionToken(raw),
    expiresAt: new Date(now.getTime() + DECISION_TOKEN_TTL_DAYS * MILLIS_PER_DAY),
  };
}

/** Brak daty ważności traktujemy jak token bezterminowy — takich nie tworzymy. */
export function isDecisionTokenExpired(expiresAt: Date | null, now: Date = new Date()): boolean {
  if (expiresAt === null) return false;
  return expiresAt.getTime() <= now.getTime();
}
