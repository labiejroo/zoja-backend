import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { isWeekendRange, todayInWarsaw } from "../common/calendar-date.js";
import { assertDateRange } from "../common/date-range.js";
import { isUniqueViolation } from "../common/db-errors.js";
import { Reservation } from "../reservations/reservation.entity.js";
import { ACTIVE_RESERVATION_STATUSES } from "../reservations/reservation.enums.js";
import { VisitSlot } from "../visits/visit-slot.entity.js";
import type { CreateVisitSlotDto } from "./dto/create-visit-slot.dto.js";
import type { UpdateVisitSlotDto } from "./dto/update-visit-slot.dto.js";
import { toAdminReservation, type AdminReservationView } from "./admin-reservations.service.js";

/** Termin widziany przez gospodarzy — z pełną historią rezerwacji. */
export interface AdminVisitSlotView {
  id: string;
  dateStart: string;
  dateEnd: string;
  isWeekend: boolean;
  isBlocked: boolean;
  blockedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  reservations: AdminReservationView[];
}

/** Nazwa unikalnego indeksu na zakresie dat terminu — z pierwszej migracji. */
const SLOT_RANGE_CONSTRAINT = "uq_visit_slots_range";

function toAdminSlot(slot: VisitSlot): AdminVisitSlotView {
  return {
    id: slot.id,
    dateStart: slot.dateStart,
    dateEnd: slot.dateEnd,
    isWeekend: slot.isWeekend,
    isBlocked: slot.isBlocked,
    blockedReason: slot.blockedReason,
    createdAt: slot.createdAt,
    updatedAt: slot.updatedAt,
    reservations: (slot.reservations ?? []).map(toAdminReservation),
  };
}

@Injectable()
export class AdminVisitSlotsService {
  private readonly logger = new Logger(AdminVisitSlotsService.name);

  constructor(
    @InjectRepository(VisitSlot)
    private readonly slots: Repository<VisitSlot>,
    @InjectRepository(Reservation)
    private readonly reservations: Repository<Reservation>,
  ) {}

  private async findOr404(id: string): Promise<VisitSlot> {
    const slot = await this.slots.findOne({ where: { id } });
    if (!slot) throw new NotFoundException("Nie znaleźliśmy tego terminu.");
    return slot;
  }

  /**
   * Pełny obraz terminów w zakresie — także historia.
   *
   * W przeciwieństwie do widoku publicznego dociągamy WSZYSTKIE rezerwacje,
   * łącznie z odrzuconymi i odwołanymi. Gospodarze muszą widzieć, kto już
   * pytał o ten termin i co się z tą prośbą stało.
   */
  async findInRange(from: string, to: string): Promise<AdminVisitSlotView[]> {
    assertDateRange(from, to);

    const slots = await this.slots
      .createQueryBuilder("slot")
      .leftJoinAndSelect("slot.reservations", "reservation")
      // Zakresy nachodzące na okno, nie tylko zaczynające się w nim.
      .where("slot.dateStart <= :to AND slot.dateEnd >= :from", { from, to })
      .orderBy("slot.dateStart", "ASC")
      // Najnowsza prośba na górze — to ona zwykle wymaga decyzji.
      .addOrderBy("reservation.createdAt", "DESC")
      .getMany();

    return slots.map(toAdminSlot);
  }

  async create(dto: CreateVisitSlotDto): Promise<AdminVisitSlotView> {
    const { dateStart, dateEnd } = dto;

    if (dateEnd < dateStart) {
      throw new ConflictException("Data końcowa nie może być wcześniejsza niż początkowa.");
    }

    if (dateEnd < todayInWarsaw()) {
      throw new ConflictException("Nie można wystawić terminu, który już minął.");
    }

    const isBlocked = dto.isBlocked ?? false;

    const slot = this.slots.create({
      dateStart,
      dateEnd,
      // Liczone serwerowo — DTO celowo tego pola nie przyjmuje.
      isWeekend: isWeekendRange(dateStart, dateEnd),
      isBlocked,
      // Powód ma sens wyłącznie przy blokadzie; przy wolnym terminie to śmieć.
      blockedReason: isBlocked ? (dto.blockedReason ?? null) : null,
    });

    try {
      const saved = await this.slots.save(slot);
      this.logger.log(`Utworzono termin ${saved.id} (${dateStart} - ${dateEnd})`);
      return toAdminSlot(saved);
    } catch (error: unknown) {
      // POST nie służy do nadpisywania. Istniejący termin edytuje się PATCH-em,
      // inaczej łatwo o ciche skasowanie cudzej blokady.
      if (isUniqueViolation(error, SLOT_RANGE_CONSTRAINT)) {
        throw new ConflictException("Termin o tym zakresie dat już istnieje.");
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateVisitSlotDto): Promise<AdminVisitSlotView> {
    const slot = await this.findOr404(id);

    if (dto.isBlocked === true) {
      const active = await this.reservations.count({
        where: ACTIVE_RESERVATION_STATUSES.map((status) => ({ slotId: id, status })),
      });

      // Blokada nad żywą rezerwacją zostawiłaby gościa z obietnicą, której
      // kalendarz już nie pokazuje. Najpierw decyzja, potem blokada.
      if (active > 0) {
        throw new ConflictException("Nie można zablokować terminu z aktywną rezerwacją.");
      }
    }

    if (dto.isBlocked !== undefined) slot.isBlocked = dto.isBlocked;
    if (dto.blockedReason !== undefined) slot.blockedReason = dto.blockedReason ?? null;

    // Odblokowanie czyści powód. Zostawiony tekst pokazywałby się przy
    // następnej blokadzie jako uzasadnienie, którego nikt nie wpisał.
    if (slot.isBlocked === false) slot.blockedReason = null;

    const saved = await this.slots.save(slot);
    this.logger.log(`Zaktualizowano termin ${saved.id} (isBlocked=${saved.isBlocked})`);
    return toAdminSlot(saved);
  }

  /**
   * Usunięcie terminu bez historii.
   *
   * Klucz obcy rezerwacji ma ON DELETE RESTRICT, więc baza i tak by tego nie
   * przepuściła — ale komunikat z PostgreSQL nie nadaje się na ekran. Pytamy
   * więc wcześniej i tłumaczymy odmowę na zdanie po ludzku.
   */
  async remove(id: string): Promise<void> {
    await this.findOr404(id);

    const history = await this.reservations.count({ where: { slotId: id } });
    if (history > 0) {
      throw new ConflictException("Nie można usunąć terminu, który posiada historię rezerwacji.");
    }

    await this.slots.delete({ id });
    this.logger.log(`Usunięto termin ${id}`);
  }
}
