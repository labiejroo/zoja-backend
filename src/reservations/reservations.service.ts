import { BadRequestException, ConflictException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { todayInWarsaw } from "../common/calendar-date.js";
import { ACTIVE_SLOT_CONSTRAINT, isUniqueViolation } from "../common/db-errors.js";
import { VisitSlot } from "../visits/visit-slot.entity.js";
import { findOrCreateSlot } from "../visits/visit-slot.helpers.js";
import type { CreateReservationDto } from "./dto/create-reservation.dto.js";
import { Reservation } from "./reservation.entity.js";
import { ReservationStatus } from "./reservation.enums.js";

export interface CreateReservationResult {
  id: string;
  status: ReservationStatus;
  slot: { id: string; dateStart: string; dateEnd: string };
  message: string;
}


@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    @InjectRepository(Reservation)
    private readonly reservations: Repository<Reservation>,
    @InjectRepository(VisitSlot)
    private readonly slots: Repository<VisitSlot>,
  ) {}

  async create(dto: CreateReservationDto): Promise<CreateReservationResult> {
    const { dateStart, dateEnd } = dto;

    if (dateEnd < dateStart) {
      throw new BadRequestException("Data końcowa nie może być wcześniejsza niż początkowa.");
    }

    // Termin, który już się skończył, jest konfliktem ze stanem świata, a nie
    // błędem składni żądania — stąd 409, nie 400. Porównanie liczymy względem
    // daty w Warszawie, nie w UTC Lambdy.
    if (dateEnd < todayInWarsaw()) {
      throw new ConflictException("Ten termin już minął.");
    }

    const slot = await findOrCreateSlot(this.slots, dateStart, dateEnd);

    if (slot.isBlocked) {
      throw new ConflictException("Ten termin jest obecnie niedostępny.");
    }

    const reservation = this.reservations.create({
      slotId: slot.id,
      status: ReservationStatus.PENDING,
      guestName: dto.guestName,
      guestEmail: dto.guestEmail,
      arrivalDay: dto.arrivalDay ?? null,
      notes: dto.notes ?? null,
      // Brak pola w żądaniu znaczy „nie ukrywaj”. Domyślną wartość ustalamy
      // tutaj, a nie inicjalizatorem w DTO: class-transformer nadpisuje
      // inicjalizatory wartością undefined dla kluczy nieobecnych w ciele.
      isPrivate: dto.isPrivate ?? false,
    });

    try {
      const saved = await this.reservations.save(reservation);

      // Logujemy wyłącznie identyfikatory. Nigdy e-maila, notatek ani tokenu.
      this.logger.log(`Utworzono rezerwację ${saved.id} dla terminu ${slot.id} (PENDING)`);

      return {
        id: saved.id,
        status: saved.status,
        slot: { id: slot.id, dateStart: slot.dateStart, dateEnd: slot.dateEnd },
        message:
          "Twoja prośba o wizytę została wysłana i oczekuje na potwierdzenie przez rodziców Zoi.",
      };
    } catch (error: unknown) {
      /**
       * WYŚCIG O TERMIN ROZSTRZYGA POSTGRESQL.
       *
       * Sprawdzenie „czy wolny?” wyżej nie wystarcza: między nim a zapisem
       * mieści się drugie żądanie, a Lambda bywa zwielokrotniona. Częściowy
       * unikalny indeks odrzuci drugą aktywną rezerwację niezależnie od liczby
       * procesów — my tylko tłumaczymy jego odmowę na czytelny komunikat.
       */
      if (isUniqueViolation(error, ACTIVE_SLOT_CONSTRAINT)) {
        throw new ConflictException("Ten termin jest już zajęty.");
      }
      throw error;
    }
  }

}
