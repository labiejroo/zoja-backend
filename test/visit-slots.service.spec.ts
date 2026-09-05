import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { ReservationStatus } from "../src/reservations/reservation.enums.js";
import { VisitSlotsService } from "../src/visits/visit-slots.service.js";

/** Pełny wiersz encji — celowo z polami, które NIE mają prawa wyjść na zewnątrz. */
function slotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "slot-1",
    dateStart: "2099-09-05",
    dateEnd: "2099-09-06",
    isWeekend: true,
    isBlocked: false,
    blockedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    reservations: [],
    ...overrides,
  };
}

function reservationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "res-1",
    slotId: "slot-1",
    status: ReservationStatus.CONFIRMED,
    guestName: "Babcia Krysia",
    guestEmail: "krysia@example.com",
    arrivalDay: "saturday",
    notes: "Przyjedziemy autem.",
    adminNote: "Dzwonili, ustalone telefonicznie.",
    isPrivate: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setup(rows: unknown[]) {
  const qb = {
    leftJoinAndSelect: () => qb,
    where: () => qb,
    orderBy: () => qb,
    getMany: vi.fn().mockResolvedValue(rows),
  };
  const slots = { createQueryBuilder: () => qb };
  return { service: new VisitSlotsService(slots as never), qb };
}

describe("VisitSlotsService — kontrakt publiczny", () => {
  it("zwraca termin bez rezerwacji jako reservation: null", async () => {
    const { service } = setup([slotRow()]);

    const [slot] = await service.findInRange("2099-09-01", "2099-09-30");

    expect(slot).toEqual({
      id: "slot-1",
      dateStart: "2099-09-05",
      dateEnd: "2099-09-06",
      isWeekend: true,
      isBlocked: false,
      blockedReason: null,
      reservation: null,
    });
  });

  it("zwraca zablokowany termin razem z powodem", async () => {
    const { service } = setup([
      slotRow({ isBlocked: true, blockedReason: "Wizyta kontrolna w poradni." }),
    ]);

    const [slot] = await service.findInRange("2099-09-01", "2099-09-30");

    expect(slot.isBlocked).toBe(true);
    expect(slot.blockedReason).toBe("Wizyta kontrolna w poradni.");
  });
});

describe("VisitSlotsService — prywatność", () => {
  it("dla PENDING nie ujawnia, kto poprosił o termin", async () => {
    const { service } = setup([
      slotRow({ reservations: [reservationRow({ status: ReservationStatus.PENDING })] }),
    ]);

    const [slot] = await service.findInRange("2099-09-01", "2099-09-30");

    expect(slot.reservation).toEqual({ status: "PENDING" });
    expect(slot.reservation).not.toHaveProperty("guestName");
  });

  it("dla CONFIRMED bez ukrycia pokazuje guestName", async () => {
    const { service } = setup([
      slotRow({ reservations: [reservationRow({ isPrivate: false })] }),
    ]);

    const [slot] = await service.findInRange("2099-09-01", "2099-09-30");

    expect(slot.reservation).toEqual({ status: "CONFIRMED", guestName: "Babcia Krysia" });
  });

  it("dla CONFIRMED z isPrivate ukrywa guestName", async () => {
    const { service } = setup([
      slotRow({ reservations: [reservationRow({ isPrivate: true })] }),
    ]);

    const [slot] = await service.findInRange("2099-09-01", "2099-09-30");

    expect(slot.reservation).toEqual({ status: "CONFIRMED" });
    expect(slot.reservation).not.toHaveProperty("guestName");
  });

  it("nigdy nie wypuszcza e-maila, notatek, isPrivate ani znaczników czasu", async () => {
    const { service } = setup([
      slotRow({ reservations: [reservationRow()] }),
      slotRow({ id: "slot-2", reservations: [reservationRow({ isPrivate: true })] }),
    ]);

    const result = await service.findInRange("2099-09-01", "2099-09-30");
    const serialized = JSON.stringify(result);

    // Allowlista działa tylko wtedy, gdy naprawdę nic nie przecieka.
    expect(serialized).not.toContain("krysia@example.com");
    // Prywatna notatka rodzicow nie ma prawa opuscic panelu.
    expect(serialized).not.toContain("Dzwonili");
    expect(serialized).not.toContain("adminNote");
    expect(serialized).not.toContain("Przyjedziemy autem");
    expect(serialized).not.toContain("isPrivate");
    expect(serialized).not.toContain("createdAt");
    expect(serialized).not.toContain("updatedAt");
    expect(serialized).not.toContain("slotId");
  });

  it("nie traktuje historii jako aktywnej rezerwacji terminu", async () => {
    // Zapytanie dociąga wyłącznie PENDING/CONFIRMED, więc odrzucone i odwołane
    // w ogóle tu nie docierają — termin wygląda na wolny.
    const { service } = setup([slotRow({ reservations: [] })]);

    const [slot] = await service.findInRange("2099-09-01", "2099-09-30");

    expect(slot.reservation).toBeNull();
  });
});

describe("VisitSlotsService — zakres", () => {
  it("odrzuca zakres odwrócony", async () => {
    const { service } = setup([]);

    await expect(service.findInRange("2099-09-30", "2099-09-01")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("odrzuca zakres dłuższy niż 366 dni", async () => {
    const { service } = setup([]);

    await expect(service.findInRange("2099-01-01", "2100-01-05")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("przepuszcza zakres mieszczący się w limicie", async () => {
    const { service, qb } = setup([]);

    await expect(service.findInRange("2099-01-01", "2099-12-31")).resolves.toEqual([]);
    expect(qb.getMany).toHaveBeenCalledTimes(1);
  });
});
