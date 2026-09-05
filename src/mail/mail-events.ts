/**
 * KONTRAKT MIĘDZY API LAMBDĄ A MAIL LAMBDĄ.
 *
 * Ten plik jest jedynym miejscem, w którym obie funkcje się spotykają — poza
 * nim nie dzielą niczego. Mail Lambda nie zna TypeORM-u, nie widzi encji i nie
 * ma dostępu do bazy; dostaje wyłącznie to, co tu opisane.
 *
 * DLACZEGO NIE CAŁA ENCJA
 * Wysłanie `Reservation` byłoby wygodne i dokładnie dlatego złe: każda nowa
 * kolumna — także `decisionTokenHash` — automatycznie przechodziłaby przez
 * granicę usług i lądowała w payloadzie wywołania. Jawny payload na event
 * sprawia, że przechodzi tylko to, co ktoś świadomie dopisał.
 *
 * Plik celowo nie importuje niczego z NestJS ani z TypeORM — Mail Lambda ma
 * pozostać lekka i wolna od zależności aplikacji.
 */

export type MailArrivalDay = "saturday" | "sunday";

/**
 * Wspólny rdzeń: kto, kiedy, dokąd wysłać. Zbudowany polem po polu, więc jest
 * allowlistą tak samo jak publiczny kształt rezerwacji.
 */
export interface MailReservationSummary {
  reservationId: string;
  guestName: string;
  guestEmail: string;
  dateStart: string;
  dateEnd: string;
  arrivalDay: MailArrivalDay | null;
  notes: string | null;
}

export const MailEventType = {
  /** Do rodziców: ktoś prosi o termin. JEDYNY event z tokenem decyzji. */
  RESERVATION_REQUESTED_PARENT: "RESERVATION_REQUESTED_PARENT",
  /** Do gościa: mamy twoją prośbę, czeka na decyzję. */
  GUEST_REQUEST_RECEIVED: "GUEST_REQUEST_RECEIVED",
  GUEST_CONFIRMED: "GUEST_CONFIRMED",
  GUEST_REJECTED: "GUEST_REJECTED",
  GUEST_CANCELLED: "GUEST_CANCELLED",
  GUEST_RESERVATION_UPDATED: "GUEST_RESERVATION_UPDATED",
  /** Do gościa: gospodarze sami wpisali potwierdzoną wizytę. */
  ADMIN_CREATED_RESERVATION: "ADMIN_CREATED_RESERVATION",
} as const;

export type MailEventType = (typeof MailEventType)[keyof typeof MailEventType];

/**
 * Prośba o wizytę — powiadomienie dla rodziców.
 *
 * `decisionToken` to token JAWNY. Jest tu jedyny raz w całym systemie poza
 * treścią maila: w bazie leży wyłącznie jego hash. Dlatego payloadu tego
 * eventu nie wolno logować w całości — patrz MailDispatcherService.
 */
export interface ReservationRequestedParentEvent extends MailReservationSummary {
  type: typeof MailEventType.RESERVATION_REQUESTED_PARENT;
  /** Czy gość poprosił, żeby publicznie nie pokazywać, kto przyjeżdża. */
  isPrivate: boolean;
  decisionToken: string;
}

export interface GuestRequestReceivedEvent extends MailReservationSummary {
  type: typeof MailEventType.GUEST_REQUEST_RECEIVED;
}

export interface GuestConfirmedEvent extends MailReservationSummary {
  type: typeof MailEventType.GUEST_CONFIRMED;
}

export interface GuestRejectedEvent extends MailReservationSummary {
  type: typeof MailEventType.GUEST_REJECTED;
}

export interface GuestCancelledEvent extends MailReservationSummary {
  type: typeof MailEventType.GUEST_CANCELLED;
}

export interface GuestReservationUpdatedEvent extends MailReservationSummary {
  type: typeof MailEventType.GUEST_RESERVATION_UPDATED;
}

export interface AdminCreatedReservationEvent extends MailReservationSummary {
  type: typeof MailEventType.ADMIN_CREATED_RESERVATION;
}

/**
 * Unia rozróżniana po polu `type`. Dzięki niej dopisanie nowego eventu bez
 * dopisania szablonu nie skompiluje się — switch w mail-templates.ts jest
 * wyczerpujący.
 */
export type MailEvent =
  | ReservationRequestedParentEvent
  | GuestRequestReceivedEvent
  | GuestConfirmedEvent
  | GuestRejectedEvent
  | GuestCancelledEvent
  | GuestReservationUpdatedEvent
  | AdminCreatedReservationEvent;

const EVENT_TYPES = new Set<string>(Object.values(MailEventType));

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/**
 * Walidacja zdarzenia po stronie Mail Lambdy.
 *
 * Mail Lambda jest osobną funkcją AWS z własnym uprawnieniem do wysyłki maili,
 * więc nie zakłada, że wywołanie przyszło od naszego API — sprawdza kształt
 * sama. Świadomie ręcznie, bez class-validatora: dokładanie tam całego
 * łańcucha dekoratorów rozdęłoby funkcję, która ma robić jedną rzecz.
 *
 * Komunikat błędu podaje wyłącznie NAZWY brakujących pól. Wartości nie, bo
 * wśród nich są adres gościa i token.
 */
export function parseMailEvent(input: unknown): MailEvent {
  if (typeof input !== "object" || input === null) {
    throw new Error("Nieprawidłowy event: oczekiwano obiektu.");
  }

  const candidate = input as Record<string, unknown>;

  if (!isNonEmptyString(candidate.type) || !EVENT_TYPES.has(candidate.type)) {
    throw new Error("Nieprawidłowy event: nieznane pole type.");
  }

  const missing = (
    ["reservationId", "guestName", "guestEmail", "dateStart", "dateEnd"] as const
  ).filter((field) => !isNonEmptyString(candidate[field]));

  if (missing.length > 0) {
    throw new Error(`Nieprawidłowy event: brak pól ${missing.join(", ")}.`);
  }

  if (
    candidate.type === MailEventType.RESERVATION_REQUESTED_PARENT &&
    !isNonEmptyString(candidate.decisionToken)
  ) {
    throw new Error("Nieprawidłowy event: brak pól decisionToken.");
  }

  return candidate as unknown as MailEvent;
}
