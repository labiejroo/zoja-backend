import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { toAdminReservation } from "../src/admin/admin-reservations.service.js";
import {
  createDecisionToken,
  DECISION_TOKEN_HASH_LENGTH,
  DECISION_TOKEN_TTL_DAYS,
  hashDecisionToken,
  isDecisionTokenExpired,
} from "../src/reservations/decision-token.js";
import { ReservationStatus } from "../src/reservations/reservation.enums.js";
import { toMailSummary } from "../src/reservations/reservation-mail.js";
import { VisitSlotsService } from "../src/visits/visit-slots.service.js";

const DAY = 86_400_000;

describe("Token decyzji — generowanie i hashowanie", () => {
  it("zwraca hash SHA-256 o długości 64 znaków w lowercase hex", () => {
    const token = createDecisionToken();

    expect(token.hash).toHaveLength(DECISION_TOKEN_HASH_LENGTH);
    expect(token.hash).toHaveLength(64);
    expect(token.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hash jest faktycznie SHA-256 tokenu jawnego", () => {
    const token = createDecisionToken();

    expect(token.hash).toBe(createHash("sha256").update(token.raw, "utf8").digest("hex"));
    expect(hashDecisionToken(token.raw)).toBe(token.hash);
  });

  it("token jawny jest bezpieczny w URL-u i ma pełne 256 bitów entropii", () => {
    const token = createDecisionToken();

    // base64url z 32 bajtów daje 43 znaki bez wypełnienia.
    expect(token.raw).toHaveLength(43);
    expect(token.raw).toMatch(/^[A-Za-z0-9_-]+$/);
    // encodeURIComponent nie ma czego zmienić — link w mailu nie zostanie zepsuty.
    expect(encodeURIComponent(token.raw)).toBe(token.raw);
  });

  it("dwa kolejne tokeny są różne", () => {
    const first = createDecisionToken();
    const second = createDecisionToken();

    expect(first.raw).not.toBe(second.raw);
    expect(first.hash).not.toBe(second.hash);
  });

  it("hash nie pozwala odtworzyć tokenu — nie zawiera go jako fragmentu", () => {
    const token = createDecisionToken();

    expect(token.hash).not.toContain(token.raw);
    expect(token.raw).not.toContain(token.hash);
  });

  it("wygasa dokładnie 7 dni po utworzeniu", () => {
    const now = new Date("2031-01-04T10:00:00Z");
    const token = createDecisionToken(now);

    expect(DECISION_TOKEN_TTL_DAYS).toBe(7);
    expect(token.expiresAt.getTime() - now.getTime()).toBe(7 * DAY);
  });

  it("rozpoznaje token wygasły, czynny i bezterminowy", () => {
    const now = new Date("2031-01-11T10:00:00Z");

    expect(isDecisionTokenExpired(new Date(now.getTime() - 1), now)).toBe(true);
    expect(isDecisionTokenExpired(new Date(now.getTime() + DAY), now)).toBe(false);
    expect(isDecisionTokenExpired(null, now)).toBe(false);
  });

  it("moment wygaśnięcia liczy się już jako wygasły", () => {
    const now = new Date("2031-01-11T10:00:00Z");

    // Granica należy do stanu „wygasł”: sekunda po terminie i sam termin mają
    // działać tak samo, żeby nie zostawiać jednosekundowej szczeliny.
    expect(isDecisionTokenExpired(new Date(now.getTime()), now)).toBe(true);
  });
});

/**
 * Kolumny tokenu są w encji, więc każde miejsce, które rozlewa encję zamiast
 * budować kształt polami, wypuści je na zewnątrz. Te testy pilnują trzech
 * granic, przez które rezerwacja opuszcza serwer.
 */
describe("Token decyzji nie wychodzi poza serwer", () => {
  const reservationRow = {
    id: "res-1",
    slotId: "slot-1",
    status: ReservationStatus.PENDING,
    guestName: "Babcia Krysia",
    guestEmail: "krysia@example.com",
    arrivalDay: "saturday",
    notes: "Przyjedziemy autem.",
    adminNote: "Dzwonili, ustalone telefonicznie.",
    isPrivate: false,
    decisionTokenHash: "a".repeat(64),
    decisionTokenExpiresAt: new Date("2031-01-11T10:00:00Z"),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("widok gospodarzy nie zawiera hasha ani daty ważności", () => {
    const view = toAdminReservation(reservationRow as never);

    expect(Object.keys(view)).not.toContain("decisionTokenHash");
    expect(Object.keys(view)).not.toContain("decisionTokenExpiresAt");
    expect(JSON.stringify(view)).not.toContain("a".repeat(64));
  });

  it("payload maila nie zawiera hasha ani daty ważności", () => {
    const summary = toMailSummary(reservationRow as never, {
      dateStart: "2031-01-04",
      dateEnd: "2031-01-05",
    });

    expect(Object.keys(summary)).not.toContain("decisionTokenHash");
    expect(Object.keys(summary)).not.toContain("decisionTokenExpiresAt");
    // Przy okazji: prywatna notatka rodziców też nie ma czego szukać w mailu.
    expect(JSON.stringify(summary)).not.toContain("Dzwonili");
  });

  it("kontrakt publiczny nie zawiera hasha ani daty ważności", async () => {
    const qb = {
      leftJoinAndSelect: () => qb,
      where: () => qb,
      orderBy: () => qb,
      getMany: async () => [
        {
          id: "slot-1",
          dateStart: "2031-01-04",
          dateEnd: "2031-01-05",
          isWeekend: true,
          isBlocked: false,
          blockedReason: null,
          reservations: [reservationRow],
        },
      ],
    };

    const service = new VisitSlotsService({ createQueryBuilder: () => qb } as never);
    const [slot] = await service.findInRange("2031-01-01", "2031-01-31");

    const serialized = JSON.stringify(slot);
    expect(serialized).not.toContain("decisionToken");
    expect(serialized).not.toContain("a".repeat(64));
    // PENDING nie ujawnia nawet imienia — to sprawdza osobny test, tu tylko
    // upewniamy się, że nie doszło nic ponad status.
    expect(slot.reservation).toEqual({ status: ReservationStatus.PENDING });
  });
});
