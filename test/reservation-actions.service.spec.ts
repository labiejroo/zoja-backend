import { GoneException, NotFoundException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { describe, expect, it, vi } from "vitest";

import { ReservationActionsService } from "../src/reservation-actions/reservation-actions.service.js";
import { ReservationActionDto } from "../src/reservation-actions/dto/reservation-action.dto.js";
import { createDecisionToken, hashDecisionToken } from "../src/reservations/decision-token.js";
import { ReservationStatus } from "../src/reservations/reservation.enums.js";
import { mailSpy } from "./helpers/mail.js";

const SLOT = {
  id: "slot-1",
  dateStart: "2031-01-04",
  dateEnd: "2031-01-05",
  isWeekend: true,
  isBlocked: false,
  blockedReason: null,
};

function reservationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "res-1",
    slotId: SLOT.id,
    slot: SLOT,
    status: ReservationStatus.PENDING,
    guestName: "Babcia Krysia",
    guestEmail: "krysia@example.com",
    arrivalDay: "saturday",
    notes: "Przyjedziemy autem.",
    adminNote: "Prywatna notatka rodziców.",
    isPrivate: false,
    decisionTokenHash: null as string | null,
    decisionTokenExpiresAt: null as Date | null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Repozytorium in-memory szukające po hashu — dokładnie tak jak Postgres przez
 * częściowy indeks unikalny.
 *
 * To nie jest ozdobnik: wiersz jest MUTOWANY przez serwis, więc po decyzji jego
 * decisionTokenHash staje się null i to samo repozytorium przestaje go
 * odnajdywać. Dzięki temu „drugi raz nie działa” wychodzi z rzeczywistego stanu,
 * a nie z ustawionego z góry mocka zwracającego null.
 */
function setup(rows: ReturnType<typeof reservationRow>[]) {
  const reservations = {
    findOne: vi.fn(async ({ where }: { where: { decisionTokenHash: string } }) => {
      return rows.find((row) => row.decisionTokenHash === where.decisionTokenHash) ?? null;
    }),
    save: vi.fn(async (row: Record<string, unknown>) => row),
  };

  const mail = mailSpy();
  const service = new ReservationActionsService(reservations as never, mail.service);

  return { service, reservations, mail, rows };
}

/** Rezerwacja PENDING z czynnym tokenem — punkt wyjścia większości testów. */
function pendingWithToken() {
  const token = createDecisionToken();
  const row = reservationRow({
    decisionTokenHash: token.hash,
    decisionTokenExpiresAt: token.expiresAt,
  });
  return { token, row };
}

describe("POST /api/reservation-actions/preview", () => {
  it("zwraca dane prośby dla czynnego tokenu", async () => {
    const { token, row } = pendingWithToken();
    const { service } = setup([row]);

    const preview = await service.preview(token.raw);

    expect(preview).toEqual({
      reservationId: "res-1",
      guestName: "Babcia Krysia",
      guestEmail: "krysia@example.com",
      dateStart: "2031-01-04",
      dateEnd: "2031-01-05",
      arrivalDay: "saturday",
      notes: "Przyjedziemy autem.",
      status: ReservationStatus.PENDING,
    });
  });

  it("szuka po hashu, nie po tokenie jawnym", async () => {
    const { token, row } = pendingWithToken();
    const { service, reservations } = setup([row]);

    await service.preview(token.raw);

    const query = reservations.findOne.mock.calls[0][0] as { where: { decisionTokenHash: string } };
    expect(query.where.decisionTokenHash).toBe(hashDecisionToken(token.raw));
    expect(query.where.decisionTokenHash).not.toBe(token.raw);
  });

  it("nie ujawnia prywatnej notatki gospodarzy ani flagi ukrycia", async () => {
    const { token, row } = pendingWithToken();
    const { service } = setup([row]);

    const preview = await service.preview(token.raw);
    const keys = Object.keys(preview);

    expect(keys).not.toContain("adminNote");
    expect(keys).not.toContain("isPrivate");
    expect(keys).not.toContain("decisionTokenHash");
    expect(JSON.stringify(preview)).not.toContain("Prywatna notatka");
  });

  it("NICZEGO NIE ZMIENIA — sam podgląd nie zapisuje", async () => {
    const { token, row } = pendingWithToken();
    const { service, reservations, mail } = setup([row]);

    await service.preview(token.raw);

    expect(reservations.save).not.toHaveBeenCalled();
    expect(row.status).toBe(ReservationStatus.PENDING);
    expect(row.decisionTokenHash).not.toBeNull();
    expect(mail.dispatch).not.toHaveBeenCalled();
  });

  it("nieznany token daje 404 z neutralnym komunikatem", async () => {
    const { service } = setup([]);

    await expect(service.preview("token-ktorego-nie-ma")).rejects.toThrow(NotFoundException);
    await expect(service.preview("token-ktorego-nie-ma")).rejects.toThrow(
      "Ten link jest nieprawidłowy lub został już wykorzystany.",
    );
  });

  it("token wygasły daje 410 Gone, nie 404", async () => {
    const token = createDecisionToken();
    const row = reservationRow({
      decisionTokenHash: token.hash,
      decisionTokenExpiresAt: new Date(Date.now() - 1000),
    });
    const { service } = setup([row]);

    await expect(service.preview(token.raw)).rejects.toThrow(GoneException);
    await expect(service.preview(token.raw)).rejects.toThrow(
      "Ten link wygasł. Decyzję możesz podjąć w panelu gospodarzy.",
    );
  });

  it("rezerwacja w innym stanie niż PENDING jest tak samo nieważna jak brak tokenu", async () => {
    const token = createDecisionToken();
    const row = reservationRow({
      status: ReservationStatus.CANCELLED,
      decisionTokenHash: token.hash,
      decisionTokenExpiresAt: token.expiresAt,
    });
    const { service } = setup([row]);

    // Ten sam komunikat co przy nieistniejącym tokenie — odpowiedź nie zdradza,
    // że trafiono w istniejącą rezerwację.
    await expect(service.preview(token.raw)).rejects.toThrow(
      "Ten link jest nieprawidłowy lub został już wykorzystany.",
    );
  });
});

describe("POST /api/reservation-actions/confirm", () => {
  it("przenosi PENDING do CONFIRMED", async () => {
    const { token, row } = pendingWithToken();
    const { service } = setup([row]);

    const result = await service.confirm(token.raw);

    expect(result).toEqual({
      status: ReservationStatus.CONFIRMED,
      message: "Rezerwacja została potwierdzona.",
    });
    expect(row.status).toBe(ReservationStatus.CONFIRMED);
  });

  it("kasuje token w tym samym zapisie co zmianę statusu", async () => {
    const { token, row } = pendingWithToken();
    const { service, reservations } = setup([row]);

    await service.confirm(token.raw);

    expect(reservations.save).toHaveBeenCalledTimes(1);
    const saved = reservations.save.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.status).toBe(ReservationStatus.CONFIRMED);
    expect(saved.decisionTokenHash).toBeNull();
    expect(saved.decisionTokenExpiresAt).toBeNull();
  });

  it("drugie użycie tego samego linku nie działa", async () => {
    const { token, row } = pendingWithToken();
    const { service } = setup([row]);

    await service.confirm(token.raw);

    await expect(service.confirm(token.raw)).rejects.toThrow(
      "Ten link jest nieprawidłowy lub został już wykorzystany.",
    );
    // Status z pierwszej decyzji zostaje nietknięty.
    expect(row.status).toBe(ReservationStatus.CONFIRMED);
  });

  it("po potwierdzeniu link odrzucenia też przestaje działać", async () => {
    const { token, row } = pendingWithToken();
    const { service } = setup([row]);

    await service.confirm(token.raw);

    // Oba przyciski w mailu niosą TEN SAM token, więc unieważnienie po jednej
    // decyzji musi zamykać także drugą drogę.
    await expect(service.reject(token.raw)).rejects.toThrow(NotFoundException);
  });

  it("wysyła gościowi dokładnie jeden mail o potwierdzeniu", async () => {
    const { token, row } = pendingWithToken();
    const { service, mail } = setup([row]);

    await service.confirm(token.raw);

    expect(mail.typesSent()).toEqual(["GUEST_CONFIRMED"]);
    expect(mail.events[0]).toMatchObject({
      reservationId: "res-1",
      guestEmail: "krysia@example.com",
      dateStart: "2031-01-04",
      dateEnd: "2031-01-05",
    });
  });

  it("mail nie zawiera tokenu ani notatki gospodarzy", async () => {
    const { token, row } = pendingWithToken();
    const { service, mail } = setup([row]);

    await service.confirm(token.raw);

    const payload = JSON.stringify(mail.events[0]);
    expect(payload).not.toContain(token.raw);
    expect(payload).not.toContain(token.hash);
    expect(payload).not.toContain("Prywatna notatka");
  });
});

describe("POST /api/reservation-actions/reject", () => {
  it("przenosi PENDING do REJECTED i kasuje token", async () => {
    const { token, row } = pendingWithToken();
    const { service } = setup([row]);

    const result = await service.reject(token.raw);

    expect(result).toEqual({
      status: ReservationStatus.REJECTED,
      message: "Rezerwacja została odrzucona.",
    });
    expect(row.status).toBe(ReservationStatus.REJECTED);
    expect(row.decisionTokenHash).toBeNull();
    expect(row.decisionTokenExpiresAt).toBeNull();
  });

  it("drugie użycie tego samego linku nie działa", async () => {
    const { token, row } = pendingWithToken();
    const { service } = setup([row]);

    await service.reject(token.raw);

    await expect(service.reject(token.raw)).rejects.toThrow(NotFoundException);
    expect(row.status).toBe(ReservationStatus.REJECTED);
  });

  it("wysyła gościowi dokładnie jeden mail o odmowie", async () => {
    const { token, row } = pendingWithToken();
    const { service, mail } = setup([row]);

    await service.reject(token.raw);

    expect(mail.typesSent()).toEqual(["GUEST_REJECTED"]);
  });

  it("wygasły token nie pozwala odrzucić", async () => {
    const token = createDecisionToken();
    const row = reservationRow({
      decisionTokenHash: token.hash,
      decisionTokenExpiresAt: new Date(Date.now() - 1000),
    });
    const { service, mail } = setup([row]);

    await expect(service.reject(token.raw)).rejects.toThrow(GoneException);
    expect(row.status).toBe(ReservationStatus.PENDING);
    expect(mail.dispatch).not.toHaveBeenCalled();
  });
});

/** Odtwarza globalny ValidationPipe: transform, potem whitelist + forbidNonWhitelisted. */
function buildDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(ReservationActionDto, payload);
  const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, errors: errors.map((error) => error.property) };
}

describe("ReservationActionDto", () => {
  it("przyjmuje sam token", () => {
    const { dto, errors } = buildDto({ token: "abc123" });

    expect(errors).toEqual([]);
    expect(dto.token).toBe("abc123");
  });

  it("odrzuca pusty token", () => {
    expect(buildDto({ token: "   " }).errors).toContain("token");
  });

  it("odrzuca brak tokenu", () => {
    expect(buildDto({}).errors).toContain("token");
  });

  it("odrzuca token dłuższy niż limit", () => {
    expect(buildDto({ token: "a".repeat(129) }).errors).toContain("token");
  });

  it("odrzuca pola spoza kontraktu", () => {
    // Ciało nie ma jak przemycić statusu ani identyfikatora rezerwacji.
    expect(buildDto({ token: "abc", status: "CONFIRMED" }).errors).toContain("status");
    expect(buildDto({ token: "abc", reservationId: "res-1" }).errors).toContain("reservationId");
  });
});
