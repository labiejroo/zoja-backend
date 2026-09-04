import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { describe, expect, it } from "vitest";

import { CreateReservationDto } from "../src/reservations/dto/create-reservation.dto.js";
import { ArrivalDay } from "../src/reservations/reservation.enums.js";

const valid = {
  dateStart: "2099-09-05",
  dateEnd: "2099-09-06",
  guestName: "Babcia Krysia",
  guestEmail: "krysia@example.com",
  arrivalDay: "saturday",
  notes: "Przyjedziemy autem.",
};

/** Odtwarza to, co robi globalny ValidationPipe: transform, potem walidacja. */
function build(payload: Record<string, unknown>): {
  dto: CreateReservationDto;
  errors: string[];
} {
  const dto = plainToInstance(CreateReservationDto, payload);
  const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, errors: errors.map((error) => error.property) };
}

describe("CreateReservationDto — normalizacja", () => {
  it("przycina guestName i normalizuje guestEmail do małych liter", () => {
    const { dto, errors } = build({
      ...valid,
      guestName: "  Babcia Krysia  ",
      guestEmail: "  Krysia@Example.COM ",
    });

    expect(errors).toEqual([]);
    expect(dto.guestName).toBe("Babcia Krysia");
    expect(dto.guestEmail).toBe("krysia@example.com");
  });

  it("zamienia notes złożone z samych spacji na null", () => {
    const { dto, errors } = build({ ...valid, notes: "    " });

    expect(errors).toEqual([]);
    expect(dto.notes).toBeNull();
  });

  it("przepuszcza brak arrivalDay oraz jawny null", () => {
    expect(build({ ...valid, arrivalDay: null }).errors).toEqual([]);

    const { arrivalDay: _omitted, ...withoutArrival } = valid;
    expect(build(withoutArrival).errors).toEqual([]);
  });

  it("przyjmuje turnstileToken, ale nie jest on wymagany", () => {
    expect(build({ ...valid, turnstileToken: "0.abc" }).errors).toEqual([]);
    expect(build(valid).errors).toEqual([]);
  });
});

describe("CreateReservationDto — walidacja", () => {
  it("odrzuca datę w formacie innym niż YYYY-MM-DD", () => {
    expect(build({ ...valid, dateStart: "05.09.2099" }).errors).toContain("dateStart");
    // Timestamp też nie jest datą kalendarzową.
    expect(build({ ...valid, dateEnd: "2099-09-06T00:00:00Z" }).errors).toContain("dateEnd");
  });

  it("odrzuca niepoprawny e-mail", () => {
    expect(build({ ...valid, guestEmail: "krysia@" }).errors).toContain("guestEmail");
  });

  it("odrzuca pusty guestName oraz dłuższy niż 80 znaków", () => {
    expect(build({ ...valid, guestName: "   " }).errors).toContain("guestName");
    expect(build({ ...valid, guestName: "x".repeat(81) }).errors).toContain("guestName");
  });

  it("odrzuca notes dłuższe niż 400 znaków", () => {
    expect(build({ ...valid, notes: "x".repeat(401) }).errors).toContain("notes");
  });

  it("odrzuca arrivalDay spoza słownika", () => {
    expect(build({ ...valid, arrivalDay: "monday" }).errors).toContain("arrivalDay");
  });

  it("odrzuca pole spoza kontraktu — forbidNonWhitelisted", () => {
    // Stary checkbox zgody nie może wrócić tylnymi drzwiami.
    expect(build({ ...valid, consent: true }).errors).toContain("consent");
  });

  it("akceptuje poprawne arrivalDay ze słownika", () => {
    const { dto, errors } = build({ ...valid, arrivalDay: ArrivalDay.SUNDAY });
    expect(errors).toEqual([]);
    expect(dto.arrivalDay).toBe("sunday");
  });
});
