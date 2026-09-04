import { BadRequestException, ConflictException } from "@nestjs/common";
import { QueryFailedError } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import type { CreateReservationDto } from "../src/reservations/dto/create-reservation.dto.js";
import { ReservationStatus } from "../src/reservations/reservation.enums.js";
import { ReservationsService } from "../src/reservations/reservations.service.js";

/** Daleka przyszłość — testy nie mogą zestarzeć się razem z kalendarzem. */
const FUTURE_SATURDAY = "2099-09-05";
const FUTURE_SUNDAY = "2099-09-06";

const input = {
  dateStart: FUTURE_SATURDAY,
  dateEnd: FUTURE_SUNDAY,
  guestName: "Babcia Krysia",
  guestEmail: "krysia@example.com",
  arrivalDay: null,
  notes: null,
} as CreateReservationDto;

const slotRow = {
  id: "slot-1",
  dateStart: FUTURE_SATURDAY,
  dateEnd: FUTURE_SUNDAY,
  isBlocked: false,
};

/** Naruszenie unikalności tak, jak zwraca je sterownik pg przez TypeORM. */
function uniqueViolation(constraint: string): QueryFailedError {
  const error = new QueryFailedError("INSERT", [], new Error("duplicate key"));
  (error as unknown as { driverError: unknown }).driverError = { code: "23505", constraint };
  return error;
}

function setup(overrides: { slotFindOne?: unknown[]; save?: () => unknown } = {}) {
  const insertQb = {
    insert: () => insertQb,
    into: () => insertQb,
    values: () => insertQb,
    orIgnore: () => insertQb,
    execute: vi.fn().mockResolvedValue({}),
  };

  const findOneResults = overrides.slotFindOne ?? [slotRow];
  const slotFindOne = vi.fn();
  findOneResults.forEach((result) => slotFindOne.mockResolvedValueOnce(result));

  const slots = { findOne: slotFindOne, createQueryBuilder: () => insertQb };

  const created: Record<string, unknown>[] = [];
  const reservations = {
    create: vi.fn((entity: Record<string, unknown>) => {
      created.push(entity);
      return entity;
    }),
    save: vi.fn(overrides.save ?? ((entity: Record<string, unknown>) => ({ ...entity, id: "res-1" }))),
  };

  const service = new ReservationsService(
    reservations as never,
    slots as never,
  );

  return { service, slots, reservations, insertQb, created };
}

describe("ReservationsService.create", () => {
  it("tworzy rezerwację PENDING na istniejącym terminie", async () => {
    const { service, created, insertQb } = setup();

    const result = await service.create(input);

    expect(result.status).toBe(ReservationStatus.PENDING);
    expect(result.id).toBe("res-1");
    expect(result.slot).toEqual({
      id: "slot-1",
      dateStart: FUTURE_SATURDAY,
      dateEnd: FUTURE_SUNDAY,
    });
    // Termin już istniał, więc nie próbujemy go wstawiać.
    expect(insertQb.execute).not.toHaveBeenCalled();
    expect(created[0].slotId).toBe("slot-1");
  });

  it("materializuje termin, gdy jeszcze nie istnieje", async () => {
    // Pierwszy odczyt: pusto. Po INSERT ... ON CONFLICT DO NOTHING: wiersz jest.
    const { service, insertQb } = setup({ slotFindOne: [null, slotRow] });

    await service.create(input);

    expect(insertQb.execute).toHaveBeenCalledTimes(1);
  });

  it("przy wyścigu o termin korzysta z wiersza wstawionego przez kogoś innego", async () => {
    // ON CONFLICT DO NOTHING nic nie wstawia, ale ponowny odczyt zwraca cudzy wiersz.
    const { service } = setup({ slotFindOne: [null, { ...slotRow, id: "slot-obcy" }] });

    const result = await service.create(input);

    expect(result.slot.id).toBe("slot-obcy");
  });

  it("domyślnie ustawia isPrivate na false, gdy pole nie przyszło", async () => {
    const { service, created } = setup();

    await service.create(input);

    expect(created[0].isPrivate).toBe(false);
  });

  it("zachowuje isPrivate = true, gdy gość ukrywa swoją obecność", async () => {
    const { service, created } = setup();

    await service.create({ ...input, isPrivate: true } as CreateReservationDto);

    expect(created[0].isPrivate).toBe(true);
  });

  it("odrzuca zakres, w którym koniec jest przed początkiem", async () => {
    const { service } = setup();

    await expect(
      service.create({ ...input, dateStart: FUTURE_SUNDAY, dateEnd: FUTURE_SATURDAY }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("odrzuca termin, który już minął", async () => {
    const { service } = setup();

    await expect(
      service.create({ ...input, dateStart: "2020-01-04", dateEnd: "2020-01-05" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("odmawia rezerwacji zablokowanego terminu i nic nie zapisuje", async () => {
    const { service, reservations } = setup({
      slotFindOne: [{ ...slotRow, isBlocked: true }],
    });

    await expect(service.create(input)).rejects.toBeInstanceOf(ConflictException);
    expect(reservations.save).not.toHaveBeenCalled();
  });

  it("zamienia naruszenie uq_reservations_active_slot na 409", async () => {
    const failing = () => {
      throw uniqueViolation("uq_reservations_active_slot");
    };

    // Osobny serwis na każdą asercję: mock findOne jest jednorazowy, więc
    // dwa wywołania create() na jednej instancji trafiłyby w pustą kolejkę.
    await expect(setup({ save: failing }).service.create(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(setup({ save: failing }).service.create(input)).rejects.toThrow(
      "Ten termin jest już zajęty",
    );
  });

  it("nie przebiera innych naruszeń unikalności za zajęty termin", async () => {
    const { service } = setup({
      save: () => {
        throw uniqueViolation("jakis_inny_indeks");
      },
    });

    // Obcy constraint ma polecieć dalej, a nie skłamać o zajętości terminu.
    await expect(service.create(input)).rejects.toBeInstanceOf(QueryFailedError);
  });

  it("nie ujawnia klientowi szczegółów PostgreSQL", async () => {
    const { service } = setup({
      save: () => {
        throw uniqueViolation("uq_reservations_active_slot");
      },
    });

    const error = await service.create(input).catch((caught: unknown) => caught);
    const serialized = JSON.stringify((error as ConflictException).getResponse());

    expect(serialized).not.toContain("23505");
    expect(serialized).not.toContain("uq_reservations_active_slot");
    expect(serialized).not.toContain("duplicate key");
  });
});
