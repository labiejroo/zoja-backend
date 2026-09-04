import { describe, expect, it } from "vitest";

import {
  buildTypeOrmOptions,
  ENTITIES,
  MIGRATIONS,
  type DatabaseEnv,
} from "../src/database/typeorm.options.js";
import { CreateVisitSlotsAndReservations1788517800000 } from "../src/migrations/1788517800000-CreateVisitSlotsAndReservations.js";
import { Reservation } from "../src/reservations/reservation.entity.js";
import {
  ACTIVE_RESERVATION_STATUSES,
  blocksSlot,
  ReservationStatus,
} from "../src/reservations/reservation.enums.js";
import { VisitSlot } from "../src/visits/visit-slot.entity.js";

const env: DatabaseEnv = {
  DB_HOST: "localhost",
  DB_PORT: 5432,
  DB_NAME: "zoja",
  DB_USER: "postgres",
  DB_PASSWORD: "local-only",
  DB_SSL: false,
  DB_POOL_MAX: 2,
  DB_LOGGING: false,
};

// MixedList to unia tablicy i mapy — w tym projekcie zawsze używamy tablicy,
// więc zawężamy raz, zamiast rozstrzygać unię w każdym teście.
const entities = ENTITIES as unknown[];
const migrations = MIGRATIONS as unknown[];

describe("rejestr encji i migracji", () => {
  it("rejestruje encje jawnie, bez globów", () => {
    expect(entities).toContain(VisitSlot);
    expect(entities).toContain(Reservation);
    // Glob jako string oznaczałby powrót do ładowania po ścieżce — patrz
    // komentarz przy ENTITIES.
    expect(entities.every((entry) => typeof entry !== "string")).toBe(true);
  });

  it("rejestruje pierwszą migrację jawnie", () => {
    expect(migrations).toContain(CreateVisitSlotsAndReservations1788517800000);
    expect(migrations.every((entry) => typeof entry !== "string")).toBe(true);
  });
});

describe("buildTypeOrmOptions", () => {
  it("nigdy nie pozwala TypeORM ruszyć schematu samemu", () => {
    const options = buildTypeOrmOptions(env);

    // Te dwie wartości są zabezpieczeniem produkcji: schemat zmienia wyłącznie
    // Lambda migracyjna, nigdy start aplikacji API.
    expect(options.synchronize).toBe(false);
    expect(options.migrationsRun).toBe(false);
  });

  it("przekazuje rejestry encji i migracji do opcji", () => {
    const options = buildTypeOrmOptions(env);

    expect(options.entities).toBe(ENTITIES);
    expect(options.migrations).toBe(MIGRATIONS);
  });
});

describe("ReservationStatus", () => {
  it("blokuje termin tylko w statusach aktywnych", () => {
    expect(blocksSlot(ReservationStatus.PENDING)).toBe(true);
    expect(blocksSlot(ReservationStatus.CONFIRMED)).toBe(true);

    // Odrzucenie i odwołanie zwalniają termin, ale rekord zostaje w historii.
    expect(blocksSlot(ReservationStatus.REJECTED)).toBe(false);
    expect(blocksSlot(ReservationStatus.CANCELLED)).toBe(false);
  });

  it("trzyma listę aktywnych statusów zgodną z warunkiem indeksu w bazie", () => {
    // Gdyby ta lista rozjechała się z warunkiem WHERE częściowego unikalnego
    // indeksu, aplikacja i baza pilnowałyby dwóch różnych reguł zajętości.
    expect([...ACTIVE_RESERVATION_STATUSES].sort()).toEqual(["CONFIRMED", "PENDING"]);
  });
});
