import { BadRequestException, ConflictException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { todayInWarsaw } from "../common/calendar-date.js";
import { ACTIVE_SLOT_CONSTRAINT, isUniqueViolation } from "../common/db-errors.js";
import { MailDispatcherService } from "../mail/mail-dispatcher.service.js";
import { MailEventType } from "../mail/mail-events.js";
import { VisitSlot } from "../visits/visit-slot.entity.js";
import { findOrCreateSlot } from "../visits/visit-slot.helpers.js";
import { createDecisionToken } from "./decision-token.js";
import type { CreateReservationDto } from "./dto/create-reservation.dto.js";
import { toMailSummary } from "./reservation-mail.js";
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
    private readonly mail: MailDispatcherService,
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

    /**
     * TOKEN DECYZJI POWSTAJE TYLKO TUTAJ.
     *
     * Bo tylko tutaj powstaje coś, o czym trzeba zdecydować. Wizyta wpisana
     * przez gospodarzy jest od razu potwierdzona i tokenu nie dostaje — nie ma
     * czego zatwierdzać, a każdy czynny token w bazie to jeden link więcej,
     * który mógłby kiedyś zadziałać wbrew intencji.
     *
     * W bazie ląduje wyłącznie `hash`. Jawny `raw` istnieje przez chwilę
     * w pamięci tej metody i wychodzi jedynie do payloadu maila do rodziców.
     */
    const decisionToken = createDecisionToken();

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
      decisionTokenHash: decisionToken.hash,
      decisionTokenExpiresAt: decisionToken.expiresAt,
    });

    let saved: Reservation;

    try {
      saved = await this.reservations.save(reservation);
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

    // Logujemy wyłącznie identyfikatory. Nigdy e-maila, notatek ani tokenu.
    this.logger.log(`Utworzono rezerwację ${saved.id} dla terminu ${slot.id} (PENDING)`);

    await this.notifyAboutRequest(saved, slot, decisionToken.raw);

    /**
     * ODPOWIEDŹ NIE ZAWIERA TOKENU ANI JEGO HASHA.
     *
     * To nie jest przeoczenie do naprawienia „dla wygody frontendu”. Token jest
     * poświadczeniem rodziców; gość, który właśnie wysłał prośbę, dostawszy go
     * w odpowiedzi mógłby sam sobie tę wizytę potwierdzić.
     */
    return {
      id: saved.id,
      status: saved.status,
      slot: { id: slot.id, dateStart: slot.dateStart, dateEnd: slot.dateEnd },
      message:
        "Twoja prośba o wizytę została wysłana i oczekuje na potwierdzenie przez rodziców Zoi.",
    };
  }

  /**
   * Dwa maile, dwa różne grona odbiorców.
   *
   * Rodzice dostają prośbę z linkami do decyzji, gość — potwierdzenie, że
   * zgłoszenie dotarło. Wysyłamy je osobno, bo mają rozłączną listę adresatów
   * i mogą nie powieść się niezależnie: brak potwierdzenia dla gościa nie
   * powinien odbierać rodzicom możliwości podjęcia decyzji.
   *
   * Żaden z tych błędów nie unieważnia zapisanej rezerwacji — dispatcher
   * z założenia nie rzuca.
   */
  private async notifyAboutRequest(
    saved: Reservation,
    slot: VisitSlot,
    decisionToken: string,
  ): Promise<void> {
    const summary = toMailSummary(saved, slot);

    await this.mail.dispatch({
      type: MailEventType.RESERVATION_REQUESTED_PARENT,
      ...summary,
      isPrivate: saved.isPrivate,
      decisionToken,
    });

    // Gość NIE dostaje tokenu. Ten mail jest wyłącznie potwierdzeniem odbioru.
    await this.mail.dispatch({
      type: MailEventType.GUEST_REQUEST_RECEIVED,
      ...summary,
    });
  }
}
