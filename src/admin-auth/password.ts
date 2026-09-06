import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>;

/**
 * HASŁO GOSPODARZY — scrypt z biblioteki standardowej.
 *
 * DLACZEGO NIE bcrypt ANI argon2
 * Obie wymagają kompilacji natywnej albo binarki prebuilt dopasowanej do
 * runtime Lambdy. To dodatkowe kilkanaście megabajtów w artefakcie i realne
 * ryzyko, że po podbiciu wersji Node paczka przestanie się ładować na
 * produkcji. scrypt jest w `node:crypto` od zawsze, jest funkcją KDF
 * zaprojektowaną do haseł (kosztowną pamięciowo, więc odporną na układy ASIC)
 * i nie kosztuje ani jednej zależności.
 *
 * JEDNO HASŁO, NIE KONTA
 * Ta aplikacja ma dwoje gospodarzy i jedno wspólne hasło. Nie budujemy kont,
 * bo nie ma czego rozróżniać: każdy, kto zna hasło, ma pełne uprawnienia
 * i tak samo się nazywa w logu — „gospodarz”.
 */

/**
 * Parametry v1 zapisane w formacie hasha, a nie tylko w kodzie.
 *
 * Prefiks `scrypt-v1` istnieje po to, żeby dało się je kiedyś podnieść bez
 * unieważniania istniejącego hasła: nowy hash dostanie `scrypt-v2`, a stary
 * nadal będzie się dawał zweryfikować starymi parametrami. Bez wersji
 * w formacie jedyną drogą do zmiany kosztu jest reset hasła.
 */
export const SCRYPT_PARAMS = {
  N: 16_384,
  r: 8,
  p: 1,
  keyLength: 64,
} as const;

const SALT_BYTES = 16;
const PREFIX = "scrypt-v1";

/**
 * Domyślny limit pamięci scrypta w Node (32 MB) jest MNIEJSZY niż to, czego
 * wymaga N=16384, r=8 (128 * N * r = 16 MB na blok roboczy plus narzut).
 * Bez podniesienia limitu funkcja rzuca ERR_CRYPTO_INVALID_SCRYPT_PARAMS.
 */
const MAX_MEMORY = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return scrypt(password, salt, SCRYPT_PARAMS.keyLength, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: MAX_MEMORY,
  });
}

/** Buduje `scrypt-v1$<salt>$<hash>`. Sól losowa na każde wywołanie. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt);

  return `${PREFIX}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/**
 * Weryfikacja hasła.
 *
 * NIGDY NIE RZUCA. Zniekształcony hash, obca wersja, nie-base64 — wszystko
 * kończy się `false`. Wyjątek propagowany stąd do kontrolera zamieniłby błąd
 * konfiguracji w 500, a różnica między 500 a 401 podpowiada atakującemu, że
 * trafił w coś nietypowego. Z zewnątrz ma być widoczna jedna odpowiedź:
 * nie udało się zalogować.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");

  if (parts.length !== 3 || parts[0] !== PREFIX) return false;

  const [, saltPart, hashPart] = parts;

  let salt: Buffer;
  let expected: Buffer;

  try {
    salt = Buffer.from(saltPart, "base64url");
    expected = Buffer.from(hashPart, "base64url");
  } catch {
    return false;
  }

  // Buffer.from nie rzuca przy śmieciowym wejściu — po prostu zwraca krótszy
  // bufor. Dlatego sprawdzamy długości jawnie, zamiast ufać brakowi wyjątku.
  if (salt.length !== SALT_BYTES || expected.length !== SCRYPT_PARAMS.keyLength) {
    return false;
  }

  let actual: Buffer;
  try {
    actual = await derive(password, salt);
  } catch {
    return false;
  }

  /**
   * timingSafeEqual, nie ===.
   *
   * Porównanie stringów wychodzi na pierwszej różniącej się bajcie, więc czas
   * odpowiedzi zdradza, ile początkowych bajtów zgadło się poprawnie. Przy
   * hashu to atak raczej teoretyczny, ale kosztuje jedną linijkę, a jego brak
   * jest dokładnie tym rodzajem drobiazgu, który potem trudno wytłumaczyć.
   */
  return timingSafeEqual(actual, expected);
}
