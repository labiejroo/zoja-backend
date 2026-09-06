/**
 * CIASTECZKO SESJI — budowane i czytane ręcznie.
 *
 * Nie dokładamy cookie-parsera. Potrzebujemy jednej nazwy z nagłówka Cookie
 * i jednego nagłówka Set-Cookie; biblioteka rozwiązywałaby problemy, których
 * tu nie ma (podpisywanie po swojemu, ciasteczka JSON, dekodowanie wielu
 * formatów), a każda zależność w Lambdzie to kolejna rzecz do aktualizowania.
 */

export const SESSION_COOKIE = "zoja_admin_session";

/**
 * PATH ZAWĘŻONY DO /api/admin.
 *
 * Przeglądarka dołącza ciasteczko wyłącznie do żądań na tę ścieżkę, więc nie
 * wysyła go przy każdym pobraniu strony ani przy publicznym /api/visit-slots.
 * Mniej miejsc, w których poświadczenie krąży, to mniej miejsc, z których
 * może wyciec — choćby do logów pośrednika.
 */
const PATH = "/api/admin";

export interface SessionCookieOptions {
  maxAgeSeconds: number;
}

/**
 * Atrybuty, na których naprawdę stoi bezpieczeństwo tej sesji:
 *
 *   HttpOnly          — JavaScript strony nie odczyta wartości. Nawet udany
 *                       XSS nie wyniesie sesji, bo document.cookie jej nie widzi.
 *   Secure            — wyłącznie po HTTPS.
 *   SameSite=Strict   — przeglądarka nie dołączy ciasteczka do żądania
 *                       zainicjowanego z obcej strony. To jest nasza ochrona
 *                       przed CSRF — patrz komentarz niżej.
 *   brak Domain       — ciasteczko jest host-only, należy do dokładnie tego
 *                       hosta, który je ustawił. Z atrybutem Domain zjechałoby
 *                       na wszystkie subdomeny.
 */
function attributes(maxAgeSeconds: number): string {
  return [
    `Path=${PATH}`,
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

export function buildSessionCookie(token: string, options: SessionCookieOptions): string {
  return `${SESSION_COOKIE}=${token}; ${attributes(options.maxAgeSeconds)}`;
}

/**
 * Kasowanie ciasteczka.
 *
 * Path, SameSite i Secure MUSZĄ być identyczne jak przy ustawianiu. Przeglądarka
 * dopasowuje ciasteczko do skasowania po nazwie ORAZ po ścieżce i domenie —
 * przy innej ścieżce zamiast usunięcia powstałoby drugie, puste ciasteczko,
 * a oryginalna sesja żyłaby dalej.
 */
export function buildClearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; ${attributes(0)}`;
}

/**
 * Wyciąga wartość ciasteczka z surowego nagłówka Cookie.
 *
 * Zwraca undefined przy braku nagłówka i przy braku naszej nazwy. Nazwy
 * porównujemy po przycięciu, bo separator w nagłówku to "; " — z odstępem,
 * którego nie ma w specyfikacji jako obowiązkowego.
 */
export function readSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;

    if (part.slice(0, separator).trim() !== SESSION_COOKIE) continue;

    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? value : undefined;
  }

  return undefined;
}

/**
 * O CSRF — DLACZEGO NIE MA OSOBNEGO TOKENU
 *
 * Panel i API stoją za tą samą dystrybucją CloudFront, czyli pod jednym
 * originem. Ciasteczko jest SameSite=Strict i host-only, więc przeglądarka nie
 * dołączy go do żądania wywołanego z jakiejkolwiek innej strony — a to jest
 * dokładnie ten wektor, przed którym broni token CSRF.
 *
 * Osobny token dokładałby stan do wymiany, którą trzeba by utrzymywać i która
 * ma własne tryby awarii (wygasły token, dwie karty, cofnięcie w historii),
 * nie zamykając przy tym żadnej dziury, której SameSite=Strict już nie zamyka.
 *
 * Ten rachunek przestaje się zgadzać, jeśli kiedykolwiek zejdziemy na
 * SameSite=Lax albo None — wtedy token CSRF staje się konieczny. Nie zmieniaj
 * tego atrybutu po to, żeby zadziałał development z localhosta.
 */
