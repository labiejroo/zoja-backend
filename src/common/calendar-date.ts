/**
 * Daty kalendarzowe — bez bibliotek, bez stref w typie.
 *
 * Termin wizyty to DOBA, nie moment: sobota jest sobotą niezależnie od tego,
 * skąd gość otwiera stronę. Dlatego wszędzie operujemy stringiem "YYYY-MM-DD",
 * a nie obiektem Date z godziną.
 */

/** Jedyny akceptowany format daty w API. Celowo nie przyjmujemy timestampów. */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Strefa, w której żyje ta aplikacja i jej użytkownicy. */
const APP_TIME_ZONE = "Europe/Warsaw";

const WARSAW_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Dzisiejsza data widziana z Warszawy, jako "YYYY-MM-DD".
 *
 * DLACZEGO NIE new Date().toISOString().slice(0, 10)
 * Lambda działa w UTC. Między północą a drugą w nocy czasu polskiego UTC jest
 * jeszcze „wczoraj”, więc termin, który dla gościa właśnie się zaczął, przez
 * dwie godziny wyglądałby na przyszły. Reguła produktowa nie może zależeć od
 * tego, w jakiej strefie AWS uruchomił kontener.
 *
 * Składamy wynik z części zamiast ufać formatowi locale — `en-CA` daje dziś
 * ISO, ale to szczegół implementacji, na którym nie chcemy się opierać.
 */
export function todayInWarsaw(now: Date = new Date()): string {
  const parts = WARSAW_FORMATTER.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Data kalendarzowa jako punkt w UTC — wyłącznie do arytmetyki (dzień tygodnia,
 * różnica dni). Traktowanie „gołej” daty jako północy UTC jest tu bezpieczne,
 * bo obie porównywane wartości przechodzą przez tę samą konwencję.
 */
function toUtcDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** Liczba pełnych dni od `from` do `to`. Ujemna, gdy `to` jest wcześniej. */
export function daysBetween(from: string, to: string): number {
  const millis = toUtcDate(to).getTime() - toUtcDate(from).getTime();
  return Math.round(millis / 86_400_000);
}

/**
 * Czy zakres to zwykły weekend: sobota plus następująca po niej niedziela.
 *
 * Wyliczamy to po stronie serwera, zamiast ufać polu przysłanemu przez klienta.
 * `isWeekend` wpływa na to, jak termin jest prezentowany, więc nie może być
 * dowolnie ustawiane z zewnątrz.
 */
export function isWeekendRange(dateStart: string, dateEnd: string): boolean {
  const SATURDAY = 6;
  return toUtcDate(dateStart).getUTCDay() === SATURDAY && daysBetween(dateStart, dateEnd) === 1;
}
