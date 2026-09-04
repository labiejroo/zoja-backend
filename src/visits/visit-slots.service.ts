import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { assertDateRange } from "../common/date-range.js";
import { Reservation } from "../reservations/reservation.entity.js";
import {
  ACTIVE_RESERVATION_STATUSES,
  ReservationStatus,
} from "../reservations/reservation.enums.js";
import { VisitSlot } from "./visit-slot.entity.js";

/** Co o rezerwacji wolno zobaczyć KOMUKOLWIEK. */
export interface PublicReservation {
  status: ReservationStatus;
  /** Obecne wyłącznie dla CONFIRMED, gdy gość nie ukrył swojej obecności. */
  guestName?: string;
}

/** Publiczny kształt terminu. Budowany polami, nigdy przez rozlanie encji. */
export interface PublicVisitSlot {
  id: string;
  dateStart: string;
  dateEnd: string;
  isWeekend: boolean;
  isBlocked: boolean;
  blockedReason: string | null;
  reservation: PublicReservation | null;
}

/**
 * ALLOWLISTA, NIE DENYLISTA.
 *
 * Budujemy obiekt pole po polu, zamiast usuwać wrażliwe klucze z encji. Przy
 * odejmowaniu każde nowe pole w encji domyślnie wyciekłoby na zewnątrz; przy
 * dodawaniu domyślnie nie wychodzi nic. To jedyna różnica, która broni się
 * także za pół roku, gdy do Reservation dojdą kolumny tokenów.
 *
 * guestEmail, notes, isPrivate, createdAt i updatedAt nie mają tu prawa wstępu.
 */
function toPublicReservation(reservation: Reservation): PublicReservation {
  const revealName =
    reservation.status === ReservationStatus.CONFIRMED && !reservation.isPrivate;

  // PENDING to dopiero prośba, nie fakt — nie ogłaszamy publicznie, kto pyta.
  return revealName
    ? { status: reservation.status, guestName: reservation.guestName }
    : { status: reservation.status };
}

function toPublicSlot(slot: VisitSlot): PublicVisitSlot {
  // Baza gwarantuje najwyżej jedną aktywną rezerwację, a zapytanie dociąga
  // tylko aktywne — więc tablica ma zero albo jeden element.
  const active = slot.reservations?.[0];

  return {
    id: slot.id,
    dateStart: slot.dateStart,
    dateEnd: slot.dateEnd,
    isWeekend: slot.isWeekend,
    isBlocked: slot.isBlocked,
    blockedReason: slot.blockedReason,
    reservation: active ? toPublicReservation(active) : null,
  };
}

@Injectable()
export class VisitSlotsService {
  constructor(
    @InjectRepository(VisitSlot)
    private readonly slots: Repository<VisitSlot>,
  ) {}

  /**
   * Zwraca WYŁĄCZNIE terminy, które istnieją w bazie.
   *
   * Nie dogenerowujemy brakujących weekendów — kalendarz powstaje na
   * frontendzie, a brak wiersza znaczy „zwykły wolny termin”. Dzięki temu
   * odpowiedź jest krótka: przy dwunastu weekendach w oknie potrafi zawierać
   * trzy pozycje.
   */
  async findInRange(from: string, to: string): Promise<PublicVisitSlot[]> {
    assertDateRange(from, to);

    const slots = await this.slots
      .createQueryBuilder("slot")
      // Warunek w JOIN, nie w WHERE: termin bez aktywnej rezerwacji ma nadal
      // trafić do wyniku (może być zablokowany albo mieć samą historię).
      .leftJoinAndSelect("slot.reservations", "reservation", "reservation.status IN (:...active)", {
        active: [...ACTIVE_RESERVATION_STATUSES],
      })
      // Zakresy nachodzące na okno, nie tylko zaczynające się w nim.
      .where("slot.dateStart <= :to AND slot.dateEnd >= :from", { from, to })
      .orderBy("slot.dateStart", "ASC")
      .getMany();

    return slots.map(toPublicSlot);
  }
}
