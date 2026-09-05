import { describe, expect, it, vi } from "vitest";

import { AdminReservationsService } from "../src/admin/admin-reservations.service.js";
import { hashDecisionToken } from "../src/reservations/decision-token.js";
import { ReservationStatus } from "../src/reservations/reservation.enums.js";
import { ReservationsService } from "../src/reservations/reservations.service.js";
import { mailSpy } from "./helpers/mail.js";

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

function insertQueryBuilder() {
  const qb = {
    insert: () => qb,
    into: () => qb,
    values: () => qb,
    orIgnore: () => qb,
    execute: vi.fn().mockResolvedValue({}),
  };
  return qb;
}

/** Wspólne repozytoria dla obu serwisów — zapamiętują to, co im podano. */
function repositories(options: { slot?: Record<string, unknown>; reservation?: unknown } = {}) {
  const slots = {
    findOne: vi.fn().mockResolvedValue(options.slot ?? slotRow()),
    createQueryBuilder: () => insertQueryBuilder(),
  };

  const created: Record<string, unknown>[] = [];
  const saved: Record<string, unknown>[] = [];

  const reservations = {
    findOne: vi.fn().mockResolvedValue(options.reservation ?? null),
    create: vi.fn((entity: Record<string, unknown>) => {
      created.push(entity);
      return { id: "res-new", createdAt: new Date(), updatedAt: new Date(), ...entity };
    }),
    save: vi.fn((entity: Record<string, unknown>) => {
      saved.push({ ...entity });
      return entity;
    }),
    remove: vi.fn(),
  };

  return { slots, reservations, created, saved };
}

const publicPayload = {
  dateStart: FUTURE_SATURDAY,
  dateEnd: FUTURE_SUNDAY,
  guestName: "Babcia Krysia",
  guestEmail: "krysia@example.com",
  arrivalDay: null,
  notes: "Przyjedziemy autem.",
  isPrivate: false,
};

describe("Publiczny POST /api/reservations — token i maile", () => {
  it("zapisuje HASH tokenu, a nie token jawny", async () => {
    const repo = repositories();
    const mail = mailSpy();
    const service = new ReservationsService(
      repo.reservations as never,
      repo.slots as never,
      mail.service,
    );

    await service.create(publicPayload as never);

    const entity = repo.created[0];
    expect(entity.decisionTokenHash).toMatch(/^[0-9a-f]{64}$/);

    // Token jawny poszedł do maila do rodziców — i ma NIE być tym, co w bazie.
    const parentEvent = mail.events.find(
      (event) => event.type === "RESERVATION_REQUESTED_PARENT",
    ) as { decisionToken: string };

    expect(entity.decisionTokenHash).not.toBe(parentEvent.decisionToken);
    expect(entity.decisionTokenHash).toBe(hashDecisionToken(parentEvent.decisionToken));
  });

  it("nie zapisuje nigdzie tokenu jawnego", async () => {
    const repo = repositories();
    const mail = mailSpy();
    const service = new ReservationsService(
      repo.reservations as never,
      repo.slots as never,
      mail.service,
    );

    await service.create(publicPayload as never);

    const parentEvent = mail.events.find(
      (event) => event.type === "RESERVATION_REQUESTED_PARENT",
    ) as { decisionToken: string };

    // Ani w obiekcie budowanym, ani w tym, co poszło do save().
    expect(JSON.stringify(repo.created)).not.toContain(parentEvent.decisionToken);
    expect(JSON.stringify(repo.saved)).not.toContain(parentEvent.decisionToken);
  });

  it("ustawia datę ważności na 7 dni do przodu", async () => {
    const repo = repositories();
    const mail = mailSpy();
    const service = new ReservationsService(
      repo.reservations as never,
      repo.slots as never,
      mail.service,
    );

    const before = Date.now();
    await service.create(publicPayload as never);
    const after = Date.now();

    const expiresAt = repo.created[0].decisionTokenExpiresAt as Date;
    const sevenDays = 7 * 86_400_000;

    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + sevenDays);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + sevenDays);
  });

  it("wysyła dwa maile: prośbę do rodziców i potwierdzenie do gościa", async () => {
    const repo = repositories();
    const mail = mailSpy();
    const service = new ReservationsService(
      repo.reservations as never,
      repo.slots as never,
      mail.service,
    );

    await service.create(publicPayload as never);

    expect(mail.typesSent()).toEqual([
      "RESERVATION_REQUESTED_PARENT",
      "GUEST_REQUEST_RECEIVED",
    ]);
  });

  it("mail do gościa NIE zawiera tokenu decyzji", async () => {
    const repo = repositories();
    const mail = mailSpy();
    const service = new ReservationsService(
      repo.reservations as never,
      repo.slots as never,
      mail.service,
    );

    await service.create(publicPayload as never);

    const guestEvent = mail.events.find((event) => event.type === "GUEST_REQUEST_RECEIVED");
    expect(guestEvent).not.toHaveProperty("decisionToken");

    const parentEvent = mail.events.find(
      (event) => event.type === "RESERVATION_REQUESTED_PARENT",
    ) as { decisionToken: string };
    expect(JSON.stringify(guestEvent)).not.toContain(parentEvent.decisionToken);
  });

  it("odpowiedź dla gościa nie zawiera tokenu ani hasha", async () => {
    const repo = repositories();
    const mail = mailSpy();
    const service = new ReservationsService(
      repo.reservations as never,
      repo.slots as never,
      mail.service,
    );

    const result = await service.create(publicPayload as never);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("decisionToken");
    expect(serialized).not.toContain(repo.created[0].decisionTokenHash as string);
  });

  it("nieudany mail nie cofa zapisanej rezerwacji", async () => {
    const repo = repositories();
    const mail = mailSpy("failed");
    const service = new ReservationsService(
      repo.reservations as never,
      repo.slots as never,
      mail.service,
    );

    const result = await service.create(publicPayload as never);

    // Rezerwacja jest faktem. Brak powiadomienia jest kłopotem z mailem.
    expect(result.status).toBe(ReservationStatus.PENDING);
    expect(repo.reservations.save).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/admin/reservations — bez tokenu decyzji", () => {
  it("nie tworzy tokenu, bo nie ma czego zatwierdzać", async () => {
    const repo = repositories();
    const mail = mailSpy();
    const service = new AdminReservationsService(
      repo.reservations as never,
      repo.slots as never,
      mail.service,
    );

    await service.create({
      dateStart: FUTURE_SATURDAY,
      dateEnd: FUTURE_SUNDAY,
      guestName: "Chrzestna Hania",
      guestEmail: "hania@example.com",
    } as never);

    expect(repo.created[0].status).toBe(ReservationStatus.CONFIRMED);
    expect(repo.created[0].decisionTokenHash).toBeNull();
    expect(repo.created[0].decisionTokenExpiresAt).toBeNull();
  });

  it("informuje gościa o wpisanej wizycie, bez linków decyzji", async () => {
    const repo = repositories();
    const mail = mailSpy();
    const service = new AdminReservationsService(
      repo.reservations as never,
      repo.slots as never,
      mail.service,
    );

    await service.create({
      dateStart: FUTURE_SATURDAY,
      dateEnd: FUTURE_SUNDAY,
      guestName: "Chrzestna Hania",
      guestEmail: "hania@example.com",
      adminNote: "Ustalone telefonicznie.",
    } as never);

    expect(mail.typesSent()).toEqual(["ADMIN_CREATED_RESERVATION"]);
    expect(mail.events[0]).not.toHaveProperty("decisionToken");
    // Notatka wewnętrzna zostaje u rodziców.
    expect(JSON.stringify(mail.events[0])).not.toContain("Ustalone telefonicznie");
  });
});

/** Rezerwacja PENDING z czynnym tokenem, gotowa do decyzji w panelu. */
function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "res-1",
    slotId: "slot-1",
    status: ReservationStatus.PENDING,
    guestName: "Babcia Krysia",
    guestEmail: "krysia@example.com",
    arrivalDay: null,
    notes: null,
    adminNote: null,
    isPrivate: false,
    decisionTokenHash: "b".repeat(64),
    decisionTokenExpiresAt: new Date("2099-09-01T00:00:00Z"),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function adminSetup(reservation: Record<string, unknown>) {
  const repo = repositories({ reservation });
  const mail = mailSpy();
  const service = new AdminReservationsService(
    repo.reservations as never,
    repo.slots as never,
    mail.service,
  );
  return { service, repo, mail, reservation };
}

describe("Decyzja w panelu ?zoja unieważnia link z maila", () => {
  const cases = [
    { action: "confirm", from: ReservationStatus.PENDING, event: "GUEST_CONFIRMED" },
    { action: "reject", from: ReservationStatus.PENDING, event: "GUEST_REJECTED" },
    { action: "cancel", from: ReservationStatus.CONFIRMED, event: "GUEST_CANCELLED" },
  ] as const;

  cases.forEach(({ action, from, event }) => {
    it(`${action} kasuje hash i datę ważności tokenu`, async () => {
      const { service, reservation } = adminSetup(pendingRow({ status: from }));

      await service[action]("res-1");

      expect(reservation.decisionTokenHash).toBeNull();
      expect(reservation.decisionTokenExpiresAt).toBeNull();
    });

    it(`${action} wysyła gościowi ${event}`, async () => {
      const { service, mail } = adminSetup(pendingRow({ status: from }));

      await service[action]("res-1");

      expect(mail.typesSent()).toEqual([event]);
    });

    it(`powtórzone ${action} nie wysyła drugiego maila`, async () => {
      const { service, mail } = adminSetup(pendingRow({ status: from }));

      await service[action]("res-1");
      mail.dispatch.mockClear();

      // Drugie kliknięcie w ten sam przycisk — stan docelowy jest już osiągnięty.
      await service[action]("res-1");

      expect(mail.dispatch).not.toHaveBeenCalled();
    });
  });

  it("powtórzona decyzja nie zapisuje niczego ponownie", async () => {
    const { service, repo } = adminSetup(pendingRow());

    await service.confirm("res-1");
    await service.confirm("res-1");

    expect(repo.reservations.save).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /api/admin/reservations/:id — kiedy mail, a kiedy nie", () => {
  const guestVisible = [
    { label: "zmiana imienia", dto: { guestName: "Babcia Krysia i dziadek" } },
    { label: "zmiana adresu", dto: { guestEmail: "nowy@example.com" } },
    { label: "zmiana dnia przyjazdu", dto: { arrivalDay: "sunday" } },
    { label: "zmiana wiadomości gościa", dto: { notes: "Przyjedziemy pociągiem." } },
  ];

  guestVisible.forEach(({ label, dto }) => {
    it(`${label} wysyła GUEST_RESERVATION_UPDATED`, async () => {
      const { service, mail } = adminSetup(pendingRow());

      await service.update("res-1", dto as never);

      expect(mail.typesSent()).toEqual(["GUEST_RESERVATION_UPDATED"]);
    });
  });

  it("zmiana samej notatki wewnętrznej NIE wysyła maila", async () => {
    const { service, mail } = adminSetup(pendingRow());

    await service.update("res-1", { adminNote: "Dzwonili wieczorem." } as never);

    // To sprawa wyłącznie gospodarzy — gość nie ma powodu o niej wiedzieć.
    expect(mail.dispatch).not.toHaveBeenCalled();
  });

  it("zmiana samego ukrycia w kalendarzu NIE wysyła maila", async () => {
    const { service, mail } = adminSetup(pendingRow());

    await service.update("res-1", { isPrivate: true } as never);

    expect(mail.dispatch).not.toHaveBeenCalled();
  });

  it("przysłanie tej samej wartości nie liczy się jako zmiana", async () => {
    const { service, mail } = adminSetup(pendingRow());

    // Panel wysyła cały formularz, więc obecność pola nie znaczy jeszcze zmiany.
    await service.update("res-1", { guestName: "Babcia Krysia" } as never);

    expect(mail.dispatch).not.toHaveBeenCalled();
  });

  it("po zmianie adresu mail idzie na NOWY adres", async () => {
    const { service, mail } = adminSetup(pendingRow());

    await service.update("res-1", { guestEmail: "nowy@example.com" } as never);

    expect(mail.events[0]).toMatchObject({ guestEmail: "nowy@example.com" });
    expect(JSON.stringify(mail.events[0])).not.toContain("krysia@example.com");
  });

  it("edycja NIE kasuje tokenu — prośba nadal czeka na decyzję", async () => {
    const { service, reservation } = adminSetup(pendingRow());

    await service.update("res-1", { notes: "Przyjedziemy pociągiem." } as never);

    // Poprawienie literówki nie jest decyzją, więc link z maila ma dalej działać.
    expect(reservation.decisionTokenHash).toBe("b".repeat(64));
  });

  it("mail o zmianie nie zawiera notatki gospodarzy", async () => {
    const { service, mail } = adminSetup(pendingRow({ adminNote: "Prywatna notatka." }));

    await service.update("res-1", { guestName: "Babcia Krysia i dziadek" } as never);

    expect(JSON.stringify(mail.events[0])).not.toContain("Prywatna notatka");
  });
});
