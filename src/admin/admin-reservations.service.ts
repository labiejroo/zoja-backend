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
import { MailDispatcherService } from "../mail/mail-dispatcher.service.js";
import { MailEventType } from "../mail/mail-events.js";
import { toMailSummary } from "../reservations/reservation-mail.js";
import { Reservation } from "../reservations/reservation.entity.js";
import { blocksSlot, ArrivalDay, ReservationStatus } from "../reservations/reservation.enums.js";
import { VisitSlot } from "../visits/visit-slot.entity.js";
import { findOrCreateSlot } from "../visits/visit-slot.helpers.js";
import type { CreateAdminReservationDto } from "./dto/create-admin-reservation.dto.js";
import type { UpdateReservationDto } from "./dto/update-reservation.dto.js";

/**
 * Rezerwacja widziana przez gospodarzy — pełne dane.
 *
 * To OSOBNA allowlista niż publiczna. Kuszące jest jedno wspólne mapowanie
 * z flagą "czy admin", ale wtedy jedna pomyłka w warunku wypuszcza e-maile
 * gości na stronę. Dwa niezależne kształty nie mają jak się pomylić.
 *
 * Pól tokenu decyzji NIE MA TU CELOWO. Panel gospodarzy ich nie potrzebuje —
 * decyzję podejmuje przyciskiem, nie linkiem — a wypuszczenie hasha na zewnątrz
 * oddawałoby połowę poświadczenia.
 */
export interface AdminReservationView {
  id: string;
  status: ReservationStatus;
  guestName: string;
  guestEmail: string;
  arrivalDay: ArrivalDay | null;
  notes: string | null;
  /** Prywatna notatka rodziców. Publicznie nie wychodzi nigdy. */
  adminNote: string | null;
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
    adminNote: reservation.adminNote,
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

/**
 * CO GOŚĆ WIDZI W SWOJEJ REZERWACJI.
 *
 * Ta lista decyduje, czy edycja w panelu wywoła maila. Zmiana czegokolwiek
 * spoza niej — notatki wewnętrznej, ukrycia nazwiska w kalendarzu — jest
 * sprawą wyłącznie gospodarzy i nie ma powodu zawracać nią głowy gościowi.
 */
interface GuestVisibleSnapshot {
  dateStart: string;
  dateEnd: string;
  guestName: string;
  guestEmail: string;
  arrivalDay: ArrivalDay | null;
  notes: string | null;
}

function guestVisibleSnapshot(reservation: Reservation, slot: VisitSlot): GuestVisibleSnapshot {
  return {
    dateStart: slot.dateStart,
    dateEnd: slot.dateEnd,
    guestName: reservation.guestName,
    guestEmail: reservation.guestEmail,
    arrivalDay: reservation.arrivalDay,
    notes: reservation.notes,
  };
}

/** Status po zmianie → zdarzenie mailowe. Brak wpisu znaczy: nie powiadamiamy. */
const DECISION_MAIL_EVENT = {
  [ReservationStatus.CONFIRMED]: MailEventType.GUEST_CONFIRMED,
  [ReservationStatus.REJECTED]: MailEventType.GUEST_REJECTED,
  [ReservationStatus.CANCELLED]: MailEventType.GUEST_CANCELLED,
} as const;

@Injectable()
export class AdminReservationsService {
  private readonly logger = new Logger(AdminReservationsService.name);

  constructor(
    @InjectRepository(Reservation)
    private readonly reservations: Repository<Reservation>,
    @InjectRepository(VisitSlot)
    private readonly slots: Repository<VisitSlot>,
    private readonly mail: MailDispatcherService,
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

  /**
   * Wizyta zakładana wprost przez gospodarzy.
   *
   * Powstaje od razu jako CONFIRMED: nie ma tu prośby, na którą ktoś miałby
   * odpowiedzieć. Rodzice ustalili termin sami, więc stan PENDING byłby
   * fikcją czekającą na decyzję, która już zapadła.
   *
   * Z tego samego powodu NIE POWSTAJE TOKEN DECYZJI. Nie ma czego zatwierdzać,
   * a każdy czynny token to jeden link więcej, który mógłby kiedyś zadziałać.
   *
   * Constraintu NIE omijamy dlatego, że żądanie przyszło z panelu. Termin
   * zajęty przez czyjąś aktywną rezerwację zostaje zajęty także dla
   * gospodarzy — inaczej cichy nadpis skasowałby komuś potwierdzoną wizytę.
   */
  async create(dto: CreateAdminReservationDto): Promise<AdminReservationWithSlot> {
    const { dateStart, dateEnd } = dto;

    if (dateEnd < dateStart) {
      throw new BadRequestException("Data końcowa nie może być wcześniejsza niż początkowa.");
    }

    if (dateEnd < todayInWarsaw()) {
      throw new ConflictException("Ten termin już minął.");
    }

    const slot = await findOrCreateSlot(this.slots, dateStart, dateEnd);

    if (slot.isBlocked) {
      throw new ConflictException("Ten termin jest obecnie niedostępny.");
    }

    const reservation = this.reservations.create({
      slotId: slot.id,
      status: ReservationStatus.CONFIRMED,
      guestName: dto.guestName,
      guestEmail: dto.guestEmail,
      arrivalDay: dto.arrivalDay ?? null,
      notes: null,
      adminNote: dto.adminNote ?? null,
      isPrivate: dto.isPrivate ?? false,
      decisionTokenHash: null,
      decisionTokenExpiresAt: null,
    });

    const saved = await this.saveGuardingActiveSlot(reservation);
    this.logger.log(`Gospodarze utworzyli wizytę ${saved.id} na terminie ${slot.id} (CONFIRMED)`);

    // Gość dowiaduje się, że wizyta jest już w kalendarzu. Bez linków decyzji:
    // nie ma tu nic do rozstrzygnięcia.
    await this.mail.dispatch({
      type: MailEventType.ADMIN_CREATED_RESERVATION,
      ...toMailSummary(saved, slot),
    });

    return withSlot(saved, slot);
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

    // Zdjęcie stanu PRZED zmianami. Porównujemy wartości, a nie obecność pól
    // w żądaniu: panel wysyła cały formularz, więc sama obecność guestName
    // nie znaczy jeszcze, że imię się zmieniło.
    const before = guestVisibleSnapshot(reservation, slot);

    if (dto.dateStart !== undefined && dto.dateEnd !== undefined) {
      slot = await this.moveToSlot(reservation, dto.dateStart, dto.dateEnd, slot);
    }

    if (dto.guestName !== undefined) reservation.guestName = dto.guestName;
    if (dto.guestEmail !== undefined) reservation.guestEmail = dto.guestEmail;
    if (dto.arrivalDay !== undefined) reservation.arrivalDay = dto.arrivalDay ?? null;
    if (dto.notes !== undefined) reservation.notes = dto.notes ?? null;
    if (dto.adminNote !== undefined) reservation.adminNote = dto.adminNote ?? null;
    if (dto.isPrivate !== undefined) reservation.isPrivate = dto.isPrivate;

    const saved = await this.saveGuardingActiveSlot(reservation);
    this.logger.log(`Zaktualizowano rezerwację ${saved.id} na terminie ${slot.id}`);

    const after = guestVisibleSnapshot(saved, slot);
    const guestVisibleChanged = (Object.keys(before) as (keyof GuestVisibleSnapshot)[]).some(
      (field) => before[field] !== after[field],
    );

    /**
     * Mail idzie na adres PO zmianie.
     *
     * Jeżeli poprawiono literówkę w adresie, wiadomość ma trafić tam, gdzie
     * gość ją przeczyta — a nie pod adres, który właśnie uznano za błędny.
     * toMailSummary bierze dane z zapisanej encji, więc dzieje się to samo
     * z siebie; ta uwaga jest po to, żeby nikt tego przez pomyłkę nie odwrócił.
     */
    if (guestVisibleChanged) {
      await this.mail.dispatch({
        type: MailEventType.GUEST_RESERVATION_UPDATED,
        ...toMailSummary(saved, slot),
      });
    }

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
   *
   * Wyjście następuje PRZED zapisem i przed mailem, więc powtórka nie wysyła
   * gościowi drugiego powiadomienia o tej samej decyzji.
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

    /**
     * DECYZJA W PANELU UNIEWAŻNIA LINK Z MAILA.
     *
     * Rodzice mogli dostać maila, a potem wejść w ?zoja i kliknąć tam. Gdyby
     * token przeżył, stary link w skrzynce nadal działałby na rezerwacji,
     * o której już zdecydowano — a przy przekazanej dalej wiadomości mógłby
     * kliknąć ktoś zupełnie inny.
     *
     * Kasujemy w TYM SAMYM zapisie co zmianę statusu, żeby nie dało się
     * zostawić bazy w stanie: status zmieniony, link nadal czynny.
     */
    reservation.decisionTokenHash = null;
    reservation.decisionTokenExpiresAt = null;

    const saved = await this.saveGuardingActiveSlot(reservation);
    this.logger.log(`Rezerwacja ${saved.id}: status ${to}`);

    const slot = await this.slotOf(saved);
    const mailEvent = DECISION_MAIL_EVENT[to as keyof typeof DECISION_MAIL_EVENT];

    if (mailEvent) {
      await this.mail.dispatch({ type: mailEvent, ...toMailSummary(saved, slot) });
    }

    return withSlot(saved, slot);
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
