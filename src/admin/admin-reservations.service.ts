import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { todayInWarsaw } from "../common/calendar-date.js";
import { ACTIVE_SLOT_CONSTRAINT, isUniqueViolation } from "../common/db-errors.js";
import { Reservation } from "../reservations/reservation.entity.js";
import { blocksSlot, ArrivalDay, ReservationStatus } from "../reservations/reservation.enums.js";
import { VisitSlot } from "../visits/visit-slot.entity.js";
import { findOrCreateSlot } from "../visits/visit-slot.helpers.js";
import type { UpdateReservationDto } from "./dto/update-reservation.dto.js";

/**
 * Rezerwacja widziana przez gospodarzy — pełne dane.
 *
 * To OSOBNA allowlista niż publiczna. Kuszące jest jedno wspólne mapowanie
 * z flagą "czy admin", ale wtedy jedna pomyłka w warunku wypuszcza e-maile
 * gości na stronę. Dwa niezależne kształty nie mają jak się pomylić.
 */
export interface AdminReservationView {
  id: string;
  status: ReservationStatus;
  guestName: string;
  guestEmail: string;
  arrivalDay: ArrivalDay | null;
  notes: string | null;
  isPrivate: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminReservationWithSlot extends AdminReservationView {
  slot: {
    id: string;
    dateStart: string;
    dateEnd: string;
    isWeekend: boolean;
    isBlocked: boolean;
    blockedReason: string | null;
  };
}

export function toAdminReservation(reservation: Reservation): AdminReservationView {
  return {
    id: reservation.id,
    status: reservation.status,
    guestName: reservation.guestName,
    guestEmail: reservation.guestEmail,
    arrivalDay: reservation.arrivalDay,
    notes: reservation.notes,
    isPrivate: reservation.isPrivate,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
  };
}

function withSlot(reservation: Reservation, slot: VisitSlot): AdminReservationWithSlot {
  return {
    ...toAdminReservation(reservation),
    slot: {
      id: slot.id,
      dateStart: slot.dateStart,
      dateEnd: slot.dateEnd,
      isWeekend: slot.isWeekend,
      isBlocked: slot.isBlocked,
      blockedReason: slot.blockedReason,
    },
  };
}

@Injectable()
export class AdminReservationsService {
  private readonly logger = new Logger(AdminReservationsService.name);

  constructor(
    @InjectRepository(Reservation)
    private readonly reservations: Repository<Reservation>,
    @InjectRepository(VisitSlot)
    private readonly slots: Repository<VisitSlot>,
  ) {}

  private async findOr404(id: string): Promise<Reservation> {
    const reservation = await this.reservations.findOne({ where: { id } });
    if (!reservation) throw new NotFoundException("Nie znaleźliśmy tej rezerwacji.");
    return reservation;
  }

  private async slotOf(reservation: Reservation): Promise<VisitSlot> {
    const slot = await this.slots.findOne({ where: { id: reservation.slotId } });
    if (!slot) throw new NotFoundException("Nie znaleźliśmy terminu tej rezerwacji.");
    return slot;
  }

  async update(id: string, dto: UpdateReservationDto): Promise<AdminReservationWithSlot> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException("Nie podano żadnych zmian.");
    }

    // Obie daty albo żadna: "nowy początek przy starym końcu" prawie zawsze
    // znaczy pomyłkę, a nie świadomie wybrany zakres.
    const movingStart = dto.dateStart !== undefined;
    const movingEnd = dto.dateEnd !== undefined;
    if (movingStart !== movingEnd) {
      throw new BadRequestException("Przy zmianie terminu podaj obie daty: dateStart i dateEnd.");
    }

    const reservation = await this.findOr404(id);
    let slot = await this.slotOf(reservation);

    if (dto.dateStart !== undefined && dto.dateEnd !== undefined) {
      slot = await this.moveToSlot(reservation, dto.dateStart, dto.dateEnd, slot);
    }

    if (dto.guestName !== undefined) reservation.guestName = dto.guestName;
    if (dto.guestEmail !== undefined) reservation.guestEmail = dto.guestEmail;
    if (dto.arrivalDay !== undefined) reservation.arrivalDay = dto.arrivalDay ?? null;
    if (dto.notes !== undefined) reservation.notes = dto.notes ?? null;
    if (dto.isPrivate !== undefined) reservation.isPrivate = dto.isPrivate;

    const saved = await this.saveGuardingActiveSlot(reservation);
    this.logger.log(`Zaktualizowano rezerwację ${saved.id} na terminie ${slot.id}`);

    // TODO: send guest email after reservation edit
    return withSlot(saved, slot);
  }

  /**
   * Przeniesienie rezerwacji na inny termin.
   *
   * Slot docelowy materializuje się tak samo jak przy rezerwacji gościa —
   * wspólnym helperem, więc reguła "brak wiersza = wolny termin" obowiązuje
   * po obu stronach aplikacji.
   */
  private async moveToSlot(
    reservation: Reservation,
    dateStart: string,
    dateEnd: string,
    current: VisitSlot,
  ): Promise<VisitSlot> {
    if (dateEnd < dateStart) {
      throw new BadRequestException("Data końcowa nie może być wcześniejsza niż początkowa.");
    }

    if (dateStart === current.dateStart && dateEnd === current.dateEnd) {
      return current;
    }

    // Aktywnej rezerwacji nie przenosimy w przeszłość. Historyczną (odrzuconą,
    // odwołaną) wolno — porządkowanie archiwum nikomu nie obiecuje wizyty.
    if (blocksSlot(reservation.status) && dateEnd < todayInWarsaw()) {
      throw new ConflictException("Ten termin już minął.");
    }

    const target = await findOrCreateSlot(this.slots, dateStart, dateEnd);

    if (target.isBlocked) {
      throw new ConflictException("Ten termin jest obecnie niedostępny.");
    }

    reservation.slotId = target.id;
    return target;
  }

  /**
   * Zapis z tłumaczeniem odmowy bazy na czytelny komunikat.
   *
   * Kolizję dwóch aktywnych rezerwacji na jednym terminie rozstrzyga częściowy
   * unikalny indeks, a nie sprawdzenie w kodzie — między odczytem a zapisem
   * mieści się drugie żądanie. Sprawdzamy NAZWĘ constraintu, żeby nie przebrać
   * innego naruszenia unikalności za zajęty termin.
   */
  private async saveGuardingActiveSlot(reservation: Reservation): Promise<Reservation> {
    try {
      return await this.reservations.save(reservation);
    } catch (error: unknown) {
      if (isUniqueViolation(error, ACTIVE_SLOT_CONSTRAINT)) {
        throw new ConflictException("Ten termin jest już zajęty.");
      }
      throw error;
    }
  }

  /**
   * Wspólny kształt przejścia statusu.
   *
   * Stan docelowy powtórzony u siebie jest IDEMPOTENTNY: drugie kliknięcie
   * w ten sam przycisk (albo podwójnie wysłane żądanie) ma zwrócić 200
   * i aktualny stan, a nie błąd. Panel gospodarzy bywa otwarty na telefonie
   * przy niepewnym zasięgu — powtórka jest tam normalna, nie wyjątkowa.
   */
  private async transition(
    id: string,
    to: ReservationStatus,
    allowedFrom: ReservationStatus[],
    refusal: string,
  ): Promise<AdminReservationWithSlot> {
    const reservation = await this.findOr404(id);

    if (reservation.status === to) {
      return withSlot(reservation, await this.slotOf(reservation));
    }

    if (!allowedFrom.includes(reservation.status)) {
      throw new ConflictException(refusal);
    }

    reservation.status = to;
    const saved = await this.saveGuardingActiveSlot(reservation);
    this.logger.log(`Rezerwacja ${saved.id}: status ${to}`);

    // TODO: send guest email after admin decision
    return withSlot(saved, await this.slotOf(saved));
  }

  confirm(id: string): Promise<AdminReservationWithSlot> {
    // Z historii nie wracamy: potwierdzenie odrzuconej albo odwołanej prośby
    // obiecałoby gościowi wizytę, o której dawno przestał myśleć.
    return this.transition(
      id,
      ReservationStatus.CONFIRMED,
      [ReservationStatus.PENDING],
      "Tej rezerwacji nie można już potwierdzić.",
    );
  }

  reject(id: string): Promise<AdminReservationWithSlot> {
    return this.transition(
      id,
      ReservationStatus.REJECTED,
      [ReservationStatus.PENDING],
      "Potwierdzonej rezerwacji nie można odrzucić. Możesz ją anulować.",
    );
  }

  cancel(id: string): Promise<AdminReservationWithSlot> {
    // Anulować wolno i prośbę, i potwierdzoną wizytę — plany się zmieniają.
    // Odrzuconej już nie: ona nigdy nie była umówiona.
    return this.transition(
      id,
      ReservationStatus.CANCELLED,
      [ReservationStatus.PENDING, ReservationStatus.CONFIRMED],
      "Odrzuconej rezerwacji nie można anulować.",
    );
  }

  /**
   * Trwałe usunięcie. Termin ZOSTAJE — mógł zostać wystawiony świadomie albo
   * mieć jeszcze inne rezerwacje w historii. Kasowanie go przy okazji byłoby
   * efektem ubocznym, którego nikt tu nie zamawiał.
   */
  async remove(id: string): Promise<void> {
    const reservation = await this.findOr404(id);
    await this.reservations.remove(reservation);
    this.logger.log(`Usunięto rezerwację ${id}`);
  }
}
