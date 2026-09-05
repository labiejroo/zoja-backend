import type { MailReservationSummary } from "../mail/mail-events.js";
import type { Reservation } from "./reservation.entity.js";

/** Zakres terminu — tyle z VisitSlot potrzebuje mail i ani pola więcej. */
export interface MailSlotDates {
  dateStart: string;
  dateEnd: string;
}

/**
 * Encja → payload maila. Jedno miejsce, w którym przekłada się jedno na drugie.
 *
 * To także ALLOWLISTA, dokładnie w tym samym duchu co publiczny kształt
 * terminu: pola wypisujemy po kolei, zamiast rozlewać encję. Rozlanie
 * przepuściłoby dziś `adminNote` (prywatna notatka rodziców) i `decisionTokenHash`
 * przez granicę usług do payloadu wywołania Mail Lambdy, a jutro każdą nową
 * kolumnę — bez niczyjej decyzji.
 */
export function toMailSummary(
  reservation: Reservation,
  slot: MailSlotDates,
): MailReservationSummary {
  return {
    reservationId: reservation.id,
    guestName: reservation.guestName,
    guestEmail: reservation.guestEmail,
    dateStart: slot.dateStart,
    dateEnd: slot.dateEnd,
    arrivalDay: reservation.arrivalDay,
    notes: reservation.notes,
  };
}
