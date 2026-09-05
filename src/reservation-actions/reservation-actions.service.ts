import { GoneException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { MailDispatcherService } from "../mail/mail-dispatcher.service.js";
import { MailEventType } from "../mail/mail-events.js";
import {
  hashDecisionToken,
  isDecisionTokenExpired,
} from "../reservations/decision-token.js";
import { toMailSummary } from "../reservations/reservation-mail.js";
import { Reservation } from "../reservations/reservation.entity.js";
import { ArrivalDay, ReservationStatus } from "../reservations/reservation.enums.js";

/**
 * Co strona decyzyjna dostaje przed podjęciem decyzji.
 *
 * Trzecia niezależna allowlista w tym projekcie — obok publicznej i tej dla
 * gospodarzy. Wygląda podobnie do widoku admina i celowo nie jest z nim
 * współdzielona: `adminNote` i `isPrivate` to rzeczy, których rodzice nie
 * ustalają na tym ekranie, a token trzymany w rękach nie może dawać wglądu
 * w prywatne notatki.
 *
 * `guestEmail` przepuszczamy świadomie. Ten adres jest już w treści maila,
 * który ten sam token przyniósł — pokazanie go na stronie nie ujawnia niczego
 * nowego, a pozwala rozróżnić dwie prośby od osób o tym samym imieniu.
 */
export interface ReservationActionPreview {
  reservationId: string;
  guestName: string;
  guestEmail: string;
  dateStart: string;
  dateEnd: string;
  arrivalDay: ArrivalDay | null;
  notes: string | null;
  status: ReservationStatus.PENDING;
}

export interface ReservationDecisionResult {
  status: ReservationStatus.CONFIRMED | ReservationStatus.REJECTED;
  message: string;
}

/**
 * JEDEN KOMUNIKAT NA WSZYSTKIE NIEPOWODZENIA.
 *
 * Token nieistniejący, token już zużyty i rezerwacja w innym stanie dają
 * dokładnie tę samą odpowiedź. Rozróżnianie ich byłoby uprzejme wobec rodziców
 * i uprzejme wobec kogoś, kto zgaduje tokeny — a ten drugi dowiadywałby się
 * z odpowiedzi, że trafił w istniejącą rezerwację.
 */
const INVALID_TOKEN_MESSAGE = "Ten link jest nieprawidłowy lub został już wykorzystany.";
const EXPIRED_TOKEN_MESSAGE = "Ten link wygasł. Decyzję możesz podjąć w panelu gospodarzy.";

/**
 * DECYZJA Z MAILA — osobny obszar odpowiedzialności.
 *
 * Nie mieszamy tego z AdminController, mimo że skutek bywa ten sam. Tamte trasy
 * są panelem gospodarzy i kiedyś staną za logowaniem; te są publiczne z samej
 * natury — poświadczeniem jest token z maila, więc nigdy nie mogą trafić za
 * ten sam guard. Jeden kontroler dla obu znaczyłby, że każda przyszła zmiana
 * autoryzacji dotyka obu naraz.
 *
 * BEZ AKCJI NA GET. Trasy są wyłącznie POST-ami, bo skanery odnośników
 * w klientach pocztowych otwierają linki z wiadomości bez udziału człowieka.
 * Link w mailu prowadzi tylko do strony; status zmienia dopiero świadome
 * kliknięcie przycisku na tej stronie.
 */
@Injectable()
export class ReservationActionsService {
  private readonly logger = new Logger(ReservationActionsService.name);

  constructor(
    @InjectRepository(Reservation)
    private readonly reservations: Repository<Reservation>,
    private readonly mail: MailDispatcherService,
  ) {}

  /**
   * Odnajduje rezerwację po tokenie albo odmawia.
   *
   * Szukamy po HASHU, nie po tokenie: w bazie tokenu jawnego nie ma. Zapytanie
   * trafia w częściowy indeks unikalny, więc jest to jedno przeszukanie indeksu,
   * a nie skan tabeli.
   */
  private async loadByToken(token: string): Promise<Reservation> {
    const reservation = await this.reservations.findOne({
      where: { decisionTokenHash: hashDecisionToken(token) },
      relations: { slot: true },
    });

    if (!reservation) {
      throw new NotFoundException(INVALID_TOKEN_MESSAGE);
    }

    // 410 Gone, nie 404: link BYŁ prawidłowy, tylko stracił ważność. Ta różnica
    // jest jedyną, jaką ujawniamy — i ujawniamy ją komuś, kto token miał,
    // a więc dostał maila. Dzięki temu strona może powiedzieć, co dalej.
    if (isDecisionTokenExpired(reservation.decisionTokenExpiresAt)) {
      throw new GoneException(EXPIRED_TOKEN_MESSAGE);
    }

    // Nie powinno się zdarzyć — każda decyzja kasuje token — ale gdyby token
    // przetrwał zmianę statusu, ma być tak samo bezużyteczny jak nieistniejący.
    if (reservation.status !== ReservationStatus.PENDING) {
      throw new NotFoundException(INVALID_TOKEN_MESSAGE);
    }

    return reservation;
  }

  /** READ ONLY. Otwarcie strony niczego nie zmienia. */
  async preview(token: string): Promise<ReservationActionPreview> {
    const reservation = await this.loadByToken(token);

    return {
      reservationId: reservation.id,
      guestName: reservation.guestName,
      guestEmail: reservation.guestEmail,
      dateStart: reservation.slot.dateStart,
      dateEnd: reservation.slot.dateEnd,
      arrivalDay: reservation.arrivalDay,
      notes: reservation.notes,
      status: ReservationStatus.PENDING,
    };
  }

  confirm(token: string): Promise<ReservationDecisionResult> {
    return this.decide(
      token,
      ReservationStatus.CONFIRMED,
      MailEventType.GUEST_CONFIRMED,
      "Rezerwacja została potwierdzona.",
    );
  }

  reject(token: string): Promise<ReservationDecisionResult> {
    return this.decide(
      token,
      ReservationStatus.REJECTED,
      MailEventType.GUEST_REJECTED,
      "Rezerwacja została odrzucona.",
    );
  }

  /**
   * Wspólny kształt obu decyzji.
   *
   * TOKEN KASUJEMY W TYM SAMYM ZAPISIE co zmianę statusu. Nie osobnym UPDATE-em
   * po fakcie: gdyby drugi zapis się nie powiódł, w bazie zostałby czynny token
   * do rezerwacji, o której już zdecydowano. Jeden save to jedna transakcja
   * i jeden wynik — albo decyzja i unieważnienie linku, albo nic.
   *
   * Stąd też bierze się „drugi raz nie działa”: po zapisie hash jest NULL, więc
   * kolejne wywołanie z tym samym tokenem nie znajduje już żadnego wiersza
   * i dostaje 404 z neutralnym komunikatem.
   */
  private async decide(
    token: string,
    status: ReservationStatus.CONFIRMED | ReservationStatus.REJECTED,
    mailEvent: typeof MailEventType.GUEST_CONFIRMED | typeof MailEventType.GUEST_REJECTED,
    message: string,
  ): Promise<ReservationDecisionResult> {
    const reservation = await this.loadByToken(token);
    const slot = reservation.slot;

    reservation.status = status;
    reservation.decisionTokenHash = null;
    reservation.decisionTokenExpiresAt = null;

    const saved = await this.reservations.save(reservation);
    this.logger.log(`Decyzja z maila dla rezerwacji ${saved.id}: ${status}`);

    // Mail idzie po zapisie i nie może go cofnąć — dispatcher nigdy nie rzuca.
    await this.mail.dispatch({ type: mailEvent, ...toMailSummary(saved, slot) });

    return { status, message };
  }
}
