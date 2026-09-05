import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { QueryFailedError } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import { AdminVisitSlotsService } from "../src/admin/admin-visit-slots.service.js";
import type { CreateVisitSlotDto } from "../src/admin/dto/create-visit-slot.dto.js";
import type { UpdateVisitSlotDto } from "../src/admin/dto/update-visit-slot.dto.js";
import { ReservationStatus } from "../src/reservations/reservation.enums.js";

function slotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "slot-1",
    dateStart: "2099-09-05",
    dateEnd: "2099-09-06",
    isWeekend: true,
    isBlocked: false,
    blockedReason: null,
    createdAt: new Date("2099-01-01"),
    updatedAt: new Date("2099-01-01"),
    reservations: [],
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
    adminNote: "Dzwonili, ustalone telefonicznie.",
    isPrivate: false,
    createdAt: new Date("2099-01-01"),
    updatedAt: new Date("2099-01-01"),
    ...overrides,
  };
}

function uniqueViolation(constraint: string): QueryFailedError {
  const error = new QueryFailedError("INSERT", [], new Error("duplicate key"));
  (error as unknown as { driverError: unknown }).driverError = { code: "23505", constraint };
  return error;
}

interface SetupOptions {
  rows?: unknown[];
  slot?: Record<string, unknown> | null;
  reservationCount?: number;
  save?: (entity: Record<string, unknown>) => unknown;
}

function setup(options: SetupOptions = {}) {
  const qb = {
    leftJoinAndSelect: () => qb,
    where: () => qb,
    orderBy: () => qb,
    addOrderBy: () => qb,
    getMany: vi.fn().mockResolvedValue(options.rows ?? []),
  };

  const slots = {
    createQueryBuilder: () => qb,
    findOne: vi.fn().mockResolvedValue(options.slot === undefined ? slotRow() : options.slot),
    create: vi.fn((entity: Record<string, unknown>) => ({ id: "slot-new", ...entity })),
    save: vi.fn(options.save ?? ((entity: Record<string, unknown>) => entity)),
    delete: vi.fn().mockResolvedValue({ affected: 1 }),
  };

  const reservations = {
    count: vi.fn().mockResolvedValue(options.reservationCount ?? 0),
  };

  const service = new AdminVisitSlotsService(slots as never, reservations as never);
  return { service, slots, reservations, qb };
}

describe("AdminVisitSlotsService.findInRange", () => {
  it("pokazuje adminowi pełne dane rezerwacji, także historię", async () => {
    const { service } = setup({
      rows: [
        slotRow({
          reservations: [
            reservationRow({ id: "r1", status: ReservationStatus.CONFIRMED }),
            reservationRow({ id: "r2", status: ReservationStatus.REJECTED }),
            reservationRow({ id: "r3", status: ReservationStatus.CANCELLED }),
            reservationRow({ id: "r4", status: ReservationStatus.PENDING }),
          ],
        }),
      ],
    });

    const [slot] = await service.findInRange("2099-09-01", "2099-09-30");
    const statuses = slot.reservations.map((r) => r.status);

    expect(statuses).toEqual(["CONFIRMED", "REJECTED", "CANCELLED", "PENDING"]);

    // To, czego publiczny endpoint NIGDY nie oddaje, tutaj musi być widoczne.
    const first = slot.reservations[0];
    expect(first.guestEmail).toBe("krysia@example.com");
    expect(first.notes).toBe("Przyjedziemy autem.");
    expect(first.isPrivate).toBe(false);
    expect(first.adminNote).toBe("Dzwonili, ustalone telefonicznie.");
    expect(first.createdAt).toBeInstanceOf(Date);
  });

  it("zwraca metadane terminu razem z blokadą", async () => {
    const { service } = setup({
      rows: [slotRow({ isBlocked: true, blockedReason: "Wizyta kontrolna." })],
    });

    const [slot] = await service.findInRange("2099-09-01", "2099-09-30");

    expect(slot.isBlocked).toBe(true);
    expect(slot.blockedReason).toBe("Wizyta kontrolna.");
    expect(slot.reservations).toEqual([]);
  });

  it("waliduje zakres tak samo jak widok publiczny", async () => {
    const reversed = setup();
    await expect(reversed.service.findInRange("2099-09-30", "2099-09-01")).rejects.toBeInstanceOf(
      BadRequestException,
    );

    const tooLong = setup();
    await expect(tooLong.service.findInRange("2099-01-01", "2100-01-05")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe("AdminVisitSlotsService.create", () => {
  it("wylicza isWeekend serwerowo", async () => {
    const { service, slots } = setup();

    // 2099-09-05 to sobota, 2099-09-06 niedziela.
    await service.create({ dateStart: "2099-09-05", dateEnd: "2099-09-06" } as CreateVisitSlotDto);
    expect(slots.create.mock.calls[0][0]).toMatchObject({ isWeekend: true });

    const weekday = setup();
    await weekday.service.create({
      dateStart: "2099-09-08",
      dateEnd: "2099-09-08",
    } as CreateVisitSlotDto);
    expect(weekday.slots.create.mock.calls[0][0]).toMatchObject({ isWeekend: false });
  });

  it("nie zapisuje powodu przy terminie niezablokowanym", async () => {
    const { service, slots } = setup();

    await service.create({
      dateStart: "2099-09-05",
      dateEnd: "2099-09-06",
      blockedReason: "powód bez blokady",
    } as CreateVisitSlotDto);

    expect(slots.create.mock.calls[0][0]).toMatchObject({ isBlocked: false, blockedReason: null });
  });

  it("odrzuca termin zakończony w przeszłości", async () => {
    const { service } = setup();

    await expect(
      service.create({ dateStart: "2020-01-04", dateEnd: "2020-01-05" } as CreateVisitSlotDto),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("odrzuca odwrócony zakres", async () => {
    const { service } = setup();

    await expect(
      service.create({ dateStart: "2099-09-06", dateEnd: "2099-09-05" } as CreateVisitSlotDto),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("zamienia duplikat zakresu na czytelny konflikt", async () => {
    const { service } = setup({
      save: () => {
        throw uniqueViolation("uq_visit_slots_range");
      },
    });

    const error = await service
      .create({ dateStart: "2099-09-05", dateEnd: "2099-09-06" } as CreateVisitSlotDto)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect(JSON.stringify((error as ConflictException).getResponse())).not.toContain("23505");
  });
});

describe("AdminVisitSlotsService.update", () => {
  it("blokuje wolny termin razem z powodem", async () => {
    const { service } = setup();

    const result = await service.update("slot-1", {
      isBlocked: true,
      blockedReason: "Wizyta kontrolna.",
    } as UpdateVisitSlotDto);

    expect(result.isBlocked).toBe(true);
    expect(result.blockedReason).toBe("Wizyta kontrolna.");
  });

  it("odmawia blokady terminu z aktywną rezerwacją", async () => {
    const { service } = setup({ reservationCount: 1 });

    await expect(
      service.update("slot-1", { isBlocked: true } as UpdateVisitSlotDto),
    ).rejects.toThrow(/aktywną rezerwacją/);
  });

  it("odblokowanie czyści powód", async () => {
    const { service } = setup({
      slot: slotRow({ isBlocked: true, blockedReason: "Stary powód" }),
    });

    const result = await service.update("slot-1", { isBlocked: false } as UpdateVisitSlotDto);

    expect(result.isBlocked).toBe(false);
    // Zostawiony tekst pokazywałby się przy następnej blokadzie.
    expect(result.blockedReason).toBeNull();
  });

  it("zwraca 404 dla nieznanego terminu", async () => {
    const { service } = setup({ slot: null });

    await expect(
      service.update("slot-1", { isBlocked: true } as UpdateVisitSlotDto),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("AdminVisitSlotsService.remove", () => {
  it("usuwa termin bez historii", async () => {
    const { service, slots } = setup({ reservationCount: 0 });

    await service.remove("slot-1");

    expect(slots.delete).toHaveBeenCalledWith({ id: "slot-1" });
  });

  it("odmawia usunięcia terminu z historią rezerwacji", async () => {
    const { service, slots } = setup({ reservationCount: 1 });

    await expect(service.remove("slot-1")).rejects.toThrow(/historię rezerwacji/);
    expect(slots.delete).not.toHaveBeenCalled();
  });

  it("zwraca 404 dla nieznanego terminu", async () => {
    const { service } = setup({ slot: null });

    await expect(service.remove("slot-1")).rejects.toBeInstanceOf(NotFoundException);
  });
});
