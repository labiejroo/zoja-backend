import { BadRequestException, ConflictException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { QueryFailedError, Repository } from "typeorm";

import { isWeekendRange, todayInWarsaw } from "../common/calendar-date.js";
import { VisitSlot } from "../visits/visit-slot.entity.js";
import type { CreateReservationDto } from "./dto/create-reservation.dto.js";
import { Reservation } from "./reservation.entity.js";
import { ReservationStatus } from "./reservation.enums.js";

/** Nazwa częściowego unikalnego indeksu z migracji — patrz reservation.entity.ts. */
const ACTIVE_SLOT_CONSTRAINT = "uq_reservations_active_slot";

/** Kod SQLSTATE dla naruszenia unikalności w PostgreSQL. */
const UNIQUE_VIOLATION = "23505";

export interface CreateReservationResult {
  id: string;
  status: ReservationStatus;
  slot: { id: string; dateStart: string; dateEnd: string };
  message: string;
}

/**
 * Rozpoznaje naruszenie KONKRETNEGO ograniczenia unikalności.
 *
 * Sprawdzamy nazwę constraintu, a nie sam kod 23505. W tabeli istnieje więcej
 * niż jeden unikalny indeks, więc zamiana każdego 23505 na „termin zajęty”
 * kłamałaby przy zupełnie innym konflikcie.
 */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!(error instanceof QueryFailedError)) return false;

  const driverError = error.driverError as { code?: string; constraint?: string } | undefined;
  return driverError?.code === UNIQUE_VIOLATION && driverError.constraint === constraint;
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

    const slot = await this.findOrCreateSlot(dateStart, dateEnd);

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

  /**
   * TERMINY MATERIALIZUJĄ SIĘ NA ŻĄDANIE.
   *
   * Nie pregenerujemy weekendów. Brak wiersza w visit_slots znaczy po prostu
   * „zwykły wolny termin”, a kalendarz i tak powstaje po stronie frontendu.
   * Wiersz pojawia się dopiero wtedy, gdy termin przestaje być zwyczajny:
   * ktoś go rezerwuje albo gospodarze go blokują.
   */
  private async findOrCreateSlot(dateStart: string, dateEnd: string): Promise<VisitSlot> {
    const existing = await this.slots.findOne({ where: { dateStart, dateEnd } });
    if (existing) return existing;

    /**
     * Dwa równoległe żądania mogą zobaczyć „slotu nie ma” i oba spróbować go
     * utworzyć. Unikalny indeks na (date_start, date_end) i tak przepuści
     * tylko jedno, więc zamiast łapać wyjątek mówimy bazie wprost: przy
     * konflikcie nic nie rób. Po insercie i tak odczytujemy wiersz — nasz
     * albo cudzy, to bez znaczenia.
     *
     * Świadomie NIE używamy tu repository.upsert(): generuje ON CONFLICT DO
     * UPDATE, co nadpisałoby isBlocked ustawione wcześniej przez gospodarzy.
     */
    await this.slots
      .createQueryBuilder()
      .insert()
      .into(VisitSlot)
      .values({
        dateStart,
        dateEnd,
        isWeekend: isWeekendRange(dateStart, dateEnd),
        isBlocked: false,
        blockedReason: null,
      })
      .orIgnore()
      .execute();

    const slot = await this.slots.findOne({ where: { dateStart, dateEnd } });
    if (!slot) {
      // Nie powinno się zdarzyć: albo wstawiliśmy my, albo ktoś równolegle.
      throw new ConflictException("Nie udało się przygotować tego terminu. Spróbuj ponownie.");
    }
    return slot;
  }
}
