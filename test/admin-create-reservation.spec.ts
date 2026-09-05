import { ConflictException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { QueryFailedError } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import { AdminReservationsService } from "../src/admin/admin-reservations.service.js";
import { CreateAdminReservationDto } from "../src/admin/dto/create-admin-reservation.dto.js";
import { UpdateReservationDto } from "../src/admin/dto/update-reservation.dto.js";
import { ReservationStatus } from "../src/reservations/reservation.enums.js";
import { mailSpy } from "./helpers/mail.js";

const FUTURE_SATURDAY = "2099-09-05";
const FUTURE_SUNDAY = "2099-09-06";

const validCreate = {
  dateStart: FUTURE_SATURDAY,
  dateEnd: FUTURE_SUNDAY,
  guestName: "Chrzestna Hania",
  guestEmail: "hania@example.com",
};

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

function uniqueViolation(constraint: string): QueryFailedError {
  const error = new QueryFailedError("INSERT", [], new Error("duplicate key"));
  (error as unknown as { driverError: unknown }).driverError = { code: "23505", constraint };
  return error;
}

function setup(options: { slot?: Record<string, unknown>; save?: () => unknown } = {}) {
  const insertQb = {
    insert: () => insertQb,
    into: () => insertQb,
    values: () => insertQb,
    orIgnore: () => insertQb,
    execute: vi.fn().mockResolvedValue({}),
  };

  const slots = {
    findOne: vi.fn().mockResolvedValue(options.slot ?? slotRow()),
    createQueryBuilder: () => insertQb,
  };

  const created: Record<string, unknown>[] = [];
  const reservations = {
    findOne: vi.fn(),
    create: vi.fn((entity: Record<string, unknown>) => {
      created.push(entity);
      return { id: "res-new", createdAt: new Date(), updatedAt: new Date(), ...entity };
    }),
    save: vi.fn(options.save ?? ((entity: Record<string, unknown>) => entity)),
    remove: vi.fn(),
  };

  const mail = mailSpy();
  const service = new AdminReservationsService(reservations as never, slots as never, mail.service);
  return { service, slots, reservations, created, insertQb, mail };
}

/**
 * Odtwarza to, co robi globalny ValidationPipe: transform, potem walidacja
 * z whitelist i forbidNonWhitelisted. Bez tych dwóch opcji sam transformer
 * przepisałby na instancję także pola spoza kontraktu — to pipe je odrzuca.
 */
function buildCreate(payload: Record<string, unknown>) {
  const dto = plainToInstance(CreateAdminReservationDto, payload);
  const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, errors: errors.map((e) => e.property) };
}

describe("POST /api/admin/reservations — serwis", () => {
  it("tworzy wizytę od razu jako CONFIRMED, nigdy PENDING", async () => {
    const { service, created } = setup();

    const result = await service.create(validCreate as CreateAdminReservationDto);

    // Rodzice ustalili termin sami — nie ma prośby, na którą ktoś ma odpowiedzieć.
    expect(created[0].status).toBe(ReservationStatus.CONFIRMED);
    expect(created[0].status).not.toBe(ReservationStatus.PENDING);
    expect(result.status).toBe(ReservationStatus.CONFIRMED);
  });

  it("korzysta z istniejącego terminu, gdy już jest", async () => {
    const { service, insertQb } = setup();

    const result = await service.create(validCreate as CreateAdminReservationDto);

    expect(result.slot.id).toBe("slot-1");
    expect(insertQb.execute).not.toHaveBeenCalled();
  });

  it("zapisuje notatkę gospodarzy i nie miesza jej z notatką gościa", async () => {
    const { service, created } = setup();

    const result = await service.create({
      ...validCreate,
      adminNote: "Ustalone telefonicznie.",
    } as CreateAdminReservationDto);

    expect(created[0].adminNote).toBe("Ustalone telefonicznie.");
    // notes to wiadomość GOŚCIA — przy wpisie ręcznym jej nie ma.
    expect(created[0].notes).toBeNull();
    expect(result.adminNote).toBe("Ustalone telefonicznie.");
  });

  it("odmawia terminu zablokowanego", async () => {
    const { service, reservations } = setup({ slot: slotRow({ isBlocked: true }) });

    await expect(
      service.create(validCreate as CreateAdminReservationDto),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(reservations.save).not.toHaveBeenCalled();
  });

  it("odmawia terminu, który już minął", async () => {
    const { service } = setup();

    await expect(
      service.create({
        ...validCreate,
        dateStart: "2020-01-04",
        dateEnd: "2020-01-05",
      } as CreateAdminReservationDto),
    ).rejects.toThrow(/minął/);
  });

  it("nie omija constraintu tylko dlatego, że żądanie przyszło z panelu", async () => {
    const { service } = setup({
      save: () => {
        throw uniqueViolation("uq_reservations_active_slot");
      },
    });

    const error = await service
      .create(validCreate as CreateAdminReservationDto)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    const body = JSON.stringify((error as ConflictException).getResponse());
    expect(body).toContain("zajęty");
    expect(body).not.toContain("23505");
  });
});

describe("CreateAdminReservationDto", () => {
  it("przyjmuje minimalny poprawny zestaw pól", () => {
    expect(buildCreate(validCreate).errors).toEqual([]);
  });

  it("odrzuca próbę narzucenia statusu — ten ustala serwer", () => {
    // Gdyby panel mógł przysłać status, dałoby się utworzyć wizytę PENDING
    // z pominięciem całej ścieżki decyzji.
    expect(buildCreate({ ...validCreate, status: "PENDING" }).errors).toContain("status");
  });

  it("odrzuca notes — to wiadomość gościa, nie gospodarzy", () => {
    expect(buildCreate({ ...validCreate, notes: "cokolwiek" }).errors).toContain("notes");
  });

  it("przycina notatkę gospodarzy, a pustą zamienia na null", () => {
    expect(buildCreate({ ...validCreate, adminNote: "  ustalone  " }).dto.adminNote).toBe(
      "ustalone",
    );
    expect(buildCreate({ ...validCreate, adminNote: "   " }).dto.adminNote).toBeNull();
  });

  it("odrzuca notatkę dłuższą niż 1000 znaków", () => {
    expect(buildCreate({ ...validCreate, adminNote: "x".repeat(1001) }).errors).toContain(
      "adminNote",
    );
  });

  it("odrzuca braki i złe formaty", () => {
    expect(buildCreate({ ...validCreate, guestEmail: "hania@" }).errors).toContain("guestEmail");
    expect(buildCreate({ ...validCreate, guestName: "   " }).errors).toContain("guestName");
    expect(buildCreate({ ...validCreate, dateStart: "05.09.2099" }).errors).toContain("dateStart");
  });
});

describe("UpdateReservationDto — adminNote", () => {
  function buildUpdate(payload: Record<string, unknown>) {
    const dto = plainToInstance(UpdateReservationDto, payload);
    return { dto, errors: validateSync(dto).map((e) => e.property) };
  }

  it("przycina notatkę", () => {
    expect(buildUpdate({ adminNote: "  dzwonili  " }).dto.adminNote).toBe("dzwonili");
  });

  it("pustą notatkę zapisuje jako null, nie jako pusty tekst", () => {
    expect(buildUpdate({ adminNote: "   " }).dto.adminNote).toBeNull();
  });

  it("przepuszcza jawny null", () => {
    expect(buildUpdate({ adminNote: null }).errors).toEqual([]);
  });

  it("odrzuca notatkę dłuższą niż 1000 znaków", () => {
    expect(buildUpdate({ adminNote: "x".repeat(1001) }).errors).toContain("adminNote");
  });
});
