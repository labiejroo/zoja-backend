import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { QueryFailedError } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import { AdminReservationsService } from "../src/admin/admin-reservations.service.js";
import type { UpdateReservationDto } from "../src/admin/dto/update-reservation.dto.js";
import { ReservationStatus } from "../src/reservations/reservation.enums.js";

const FUTURE_SATURDAY = "2099-09-05";
const FUTURE_SUNDAY = "2099-09-06";

function slotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "slot-1",
    dateStart: FUTURE_SATURDAY,
    dateEnd: FUTURE_SUNDAY,
    isWeekend: true,
    isBlocked: false,
    blockedReason: null,
    ...overrides,
  };
}

function reservationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "res-1",
    slotId: "slot-1",
    status: ReservationStatus.PENDING,
    guestName: "Babcia Krysia",
    guestEmail: "krysia@example.com",
    arrivalDay: "saturday",
    notes: "Przyjedziemy autem.",
    isPrivate: false,
    createdAt: new Date("2099-01-01"),
    updatedAt: new Date("2099-01-01"),
    ...overrides,
  };
}

function uniqueViolation(constraint: string): QueryFailedError {
  const error = new QueryFailedError("UPDATE", [], new Error("duplicate key"));
  (error as unknown as { driverError: unknown }).driverError = { code: "23505", constraint };
  return error;
}

interface SetupOptions {
  reservation?: Record<string, unknown> | null;
  slots?: (Record<string, unknown> | null)[];
  save?: (entity: Record<string, unknown>) => unknown;
}

function setup(options: SetupOptions = {}) {
  const reservationRecord =
    options.reservation === undefined ? reservationRow() : options.reservation;

  const insertQb = {
    insert: () => insertQb,
    into: () => insertQb,
    values: () => insertQb,
    orIgnore: () => insertQb,
    execute: vi.fn().mockResolvedValue({}),
  };

  const slotFindOne = vi.fn();
  const slotResults = options.slots ?? [slotRow()];
  slotResults.forEach((result) => slotFindOne.mockResolvedValueOnce(result));
  // Po wyczerpaniu kolejki oddajemy slot bazowy — część testów woła findOne
  // wielokrotnie (odczyt, przeniesienie, ponowny odczyt po zapisie).
  slotFindOne.mockResolvedValue(slotRow());

  const slots = {
    findOne: slotFindOne,
    createQueryBuilder: () => insertQb,
  };

  const reservations = {
    findOne: vi.fn().mockResolvedValue(reservationRecord),
    save: vi.fn(options.save ?? ((entity: Record<string, unknown>) => entity)),
    remove: vi.fn().mockResolvedValue(undefined),
  };

  const service = new AdminReservationsService(reservations as never, slots as never);
  return { service, reservations, slots, insertQb };
}

describe("AdminReservationsService — przejścia statusów", () => {
  const cases: {
    action: "confirm" | "reject" | "cancel";
    from: ReservationStatus;
    expected: ReservationStatus | "conflict";
  }[] = [
    { action: "confirm", from: ReservationStatus.PENDING, expected: ReservationStatus.CONFIRMED },
    { action: "confirm", from: ReservationStatus.CONFIRMED, expected: ReservationStatus.CONFIRMED },
    { action: "confirm", from: ReservationStatus.REJECTED, expected: "conflict" },
    { action: "confirm", from: ReservationStatus.CANCELLED, expected: "conflict" },

    { action: "reject", from: ReservationStatus.PENDING, expected: ReservationStatus.REJECTED },
    { action: "reject", from: ReservationStatus.REJECTED, expected: ReservationStatus.REJECTED },
    { action: "reject", from: ReservationStatus.CONFIRMED, expected: "conflict" },
    { action: "reject", from: ReservationStatus.CANCELLED, expected: "conflict" },

    { action: "cancel", from: ReservationStatus.PENDING, expected: ReservationStatus.CANCELLED },
    { action: "cancel", from: ReservationStatus.CONFIRMED, expected: ReservationStatus.CANCELLED },
    { action: "cancel", from: ReservationStatus.CANCELLED, expected: ReservationStatus.CANCELLED },
    { action: "cancel", from: ReservationStatus.REJECTED, expected: "conflict" },
  ];

  it.each(cases)("$action z $from", async ({ action, from, expected }) => {
    const { service } = setup({ reservation: reservationRow({ status: from }) });

    if (expected === "conflict") {
      await expect(service[action]("res-1")).rejects.toBeInstanceOf(ConflictException);
      return;
    }

    const result = await service[action]("res-1");
    expect(result.status).toBe(expected);
  });

  it("powtórzone potwierdzenie nie zapisuje niczego drugi raz", async () => {
    const { service, reservations } = setup({
      reservation: reservationRow({ status: ReservationStatus.CONFIRMED }),
    });

    await service.confirm("res-1");

    // Idempotencja ma być bezczynna, a nie „zapisz tę samą wartość jeszcze raz”.
    expect(reservations.save).not.toHaveBeenCalled();
  });

  it("odmowa odrzucenia potwierdzonej wizyty podpowiada anulowanie", async () => {
    const { service } = setup({
      reservation: reservationRow({ status: ReservationStatus.CONFIRMED }),
    });

    await expect(service.reject("res-1")).rejects.toThrow(/anulować/);
  });

  it("zwraca 404 dla nieznanej rezerwacji", async () => {
    const { service } = setup({ reservation: null });

    await expect(service.confirm("res-1")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("AdminReservationsService.update", () => {
  it("odrzuca pusty obiekt zmian", async () => {
    const { service } = setup();

    await expect(service.update("res-1", {} as UpdateReservationDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("zapisuje dane gościa przekazane przez DTO", async () => {
    const { service } = setup();

    const result = await service.update("res-1", {
      guestName: "Wujek Andrzej",
      guestEmail: "andrzej@example.com",
      notes: null,
      isPrivate: true,
    } as UpdateReservationDto);

    expect(result.guestName).toBe("Wujek Andrzej");
    expect(result.guestEmail).toBe("andrzej@example.com");
    expect(result.notes).toBeNull();
    expect(result.isPrivate).toBe(true);
  });

  it("przepuszcza jawny null w arrivalDay", async () => {
    const { service } = setup();

    const result = await service.update("res-1", {
      arrivalDay: null,
    } as UpdateReservationDto);

    expect(result.arrivalDay).toBeNull();
  });

  it("wymaga obu dat przy zmianie terminu", async () => {
    const onlyStart = setup();
    await expect(
      onlyStart.service.update("res-1", { dateStart: "2099-10-03" } as UpdateReservationDto),
    ).rejects.toBeInstanceOf(BadRequestException);

    const onlyEnd = setup();
    await expect(
      onlyEnd.service.update("res-1", { dateEnd: "2099-10-04" } as UpdateReservationDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("przenosi rezerwację na inny termin", async () => {
    const { service } = setup({
      slots: [slotRow(), slotRow({ id: "slot-2", dateStart: "2099-10-03", dateEnd: "2099-10-04" })],
    });

    const result = await service.update("res-1", {
      dateStart: "2099-10-03",
      dateEnd: "2099-10-04",
    } as UpdateReservationDto);

    expect(result.slot.id).toBe("slot-2");
  });

  it("odmawia przeniesienia na termin zablokowany", async () => {
    const { service } = setup({
      slots: [slotRow(), slotRow({ id: "slot-2", dateStart: "2099-10-03", dateEnd: "2099-10-04", isBlocked: true })],
    });

    await expect(
      service.update("res-1", {
        dateStart: "2099-10-03",
        dateEnd: "2099-10-04",
      } as UpdateReservationDto),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("odmawia przeniesienia aktywnej rezerwacji na termin miniony", async () => {
    const { service } = setup();

    await expect(
      service.update("res-1", {
        dateStart: "2020-01-04",
        dateEnd: "2020-01-05",
      } as UpdateReservationDto),
    ).rejects.toThrow(/minął/);
  });

  it("zamienia kolizję aktywnej rezerwacji na czytelny konflikt", async () => {
    const { service } = setup({
      save: () => {
        throw uniqueViolation("uq_reservations_active_slot");
      },
    });

    const error = await service
      .update("res-1", { guestName: "Ktoś" } as UpdateReservationDto)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    const body = JSON.stringify((error as ConflictException).getResponse());
    expect(body).toContain("zajęty");
    // Klient nie ma prawa zobaczyć wnętrza bazy.
    expect(body).not.toContain("23505");
    expect(body).not.toContain("uq_reservations_active_slot");
  });

  it("nie przebiera innego naruszenia unikalności za zajęty termin", async () => {
    const { service } = setup({
      save: () => {
        throw uniqueViolation("jakis_inny_indeks");
      },
    });

    await expect(
      service.update("res-1", { guestName: "Ktoś" } as UpdateReservationDto),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });
});

describe("AdminReservationsService.remove", () => {
  it("usuwa rezerwację i zostawia termin nietknięty", async () => {
    const { service, reservations, slots } = setup();

    await service.remove("res-1");

    expect(reservations.remove).toHaveBeenCalledTimes(1);
    // Termin ma przetrwać: mógł zostać wystawiony świadomie.
    expect(slots.findOne).not.toHaveBeenCalled();
  });

  it("zwraca 404, gdy rezerwacji nie ma", async () => {
    const { service } = setup({ reservation: null });

    await expect(service.remove("res-1")).rejects.toBeInstanceOf(NotFoundException);
  });
});
