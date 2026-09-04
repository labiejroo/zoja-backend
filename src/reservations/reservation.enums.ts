/**
 * JEDNO ŹRÓDŁO PRAWDY dla wartości słownikowych rezerwacji.
 *
 * Trzymamy je osobno od encji, bo korzystają z nich trzy miejsca: encja,
 * migracja (jako typy enum w PostgreSQL) i przyszła warstwa DTO. Magiczne
 * stringi rozsypane po kodzie są tu wyjątkowo kosztowne — literówka w statusie
 * nie wywala się przy kompilacji, tylko cicho przestaje blokować termin.
 */

/**
 * Cykl życia prośby o wizytę.
 *
 * PENDING   — czeka na decyzję rodziców, BLOKUJE termin
 * CONFIRMED — zaakceptowana, BLOKUJE termin
 * REJECTED  — odrzucona, rekord zostaje w historii, ZWALNIA termin
 * CANCELLED — odwołana, rekord zostaje w historii, ZWALNIA termin
 *
 * Rekordów nie kasujemy przy odmowie ani odwołaniu — historia kto i kiedy
 * prosił o termin jest częścią wartości tej aplikacji.
 */
export enum ReservationStatus {
  PENDING = "PENDING",
  CONFIRMED = "CONFIRMED",
  REJECTED = "REJECTED",
  CANCELLED = "CANCELLED",
}

/**
 * Statusy, które czynią termin zajętym.
 *
 * Ta lista NIE jest tylko wygodą dla kodu — jej odpowiednik jest zapisany
 * w warunku częściowego unikalnego indeksu w bazie. Zmiana tutaj bez zmiany
 * indeksu rozjedzie regułę aplikacyjną z regułą, której faktycznie pilnuje
 * PostgreSQL. Patrz migracja CreateVisitSlotsAndReservations.
 */
export const ACTIVE_RESERVATION_STATUSES: readonly ReservationStatus[] = [
  ReservationStatus.PENDING,
  ReservationStatus.CONFIRMED,
];

/** Czy rezerwacja o tym statusie blokuje termin. */
export function blocksSlot(status: ReservationStatus): boolean {
  return ACTIVE_RESERVATION_STATUSES.includes(status);
}

/**
 * Dzień przyjazdu. Wartości celowo małymi literami — taki sam kształt ma
 * kontrakt po stronie frontendu (`ArrivalDay` w src/types/reservation.ts).
 *
 * Brak wartości (NULL w bazie) znaczy „jeszcze nie wiem”. Gość rezerwuje cały
 * weekend, więc ta informacja jest wyłącznie organizacyjna i wolno jej brakować.
 */
export enum ArrivalDay {
  SATURDAY = "saturday",
  SUNDAY = "sunday",
}
