import { describe, expect, it } from "vitest";

import { validateEnv } from "../src/config/env.validation.js";
import { describeError } from "../src/mail/mail-errors.js";
import { MailEventType, parseMailEvent } from "../src/mail/mail-events.js";

const BASE_ENV = {
  DB_HOST: "localhost",
  DB_NAME: "zoja",
  DB_USER: "zoja",
  DB_PASSWORD: "x",
};

const validEvent = {
  type: MailEventType.GUEST_CONFIRMED,
  reservationId: "res-1",
  guestName: "Babcia Krysia",
  guestEmail: "krysia@example.com",
  dateStart: "2031-01-04",
  dateEnd: "2031-01-05",
  arrivalDay: null,
  notes: null,
};

/**
 * Mail Lambda jest osobną funkcją z własnym uprawnieniem do wysyłki, więc nie
 * zakłada, że wywołanie przyszło od naszego API — sprawdza kształt sama.
 */
describe("parseMailEvent — Mail Lambda waliduje własne wejście", () => {
  it("przepuszcza poprawne zdarzenie", () => {
    expect(parseMailEvent(validEvent)).toEqual(validEvent);
  });

  it("odrzuca wejście, które nie jest obiektem", () => {
    expect(() => parseMailEvent(null)).toThrow("oczekiwano obiektu");
    expect(() => parseMailEvent("GUEST_CONFIRMED")).toThrow("oczekiwano obiektu");
  });

  it("odrzuca nieznany typ zdarzenia", () => {
    expect(() => parseMailEvent({ ...validEvent, type: "WYSLIJ_WSZYSTKO" })).toThrow(
      "nieznane pole type",
    );
  });

  it("odrzuca brak pól wymaganych i wymienia je po nazwie", () => {
    expect(() => parseMailEvent({ type: MailEventType.GUEST_CONFIRMED })).toThrow(
      /reservationId, guestName, guestEmail, dateStart, dateEnd/,
    );
  });

  it("wymaga tokenu tylko w zdarzeniu do rodziców", () => {
    const parentEvent = { ...validEvent, type: MailEventType.RESERVATION_REQUESTED_PARENT };

    expect(() => parseMailEvent(parentEvent)).toThrow("decisionToken");
    expect(() =>
      parseMailEvent({ ...parentEvent, isPrivate: false, decisionToken: "abc" }),
    ).not.toThrow();
  });

  it("komunikat błędu nie zdradza wartości pól", () => {
    let message = "";
    try {
      parseMailEvent({ ...validEvent, type: "NIEZNANY" });
    } catch (error) {
      message = (error as Error).message;
    }

    // Same nazwy pól — nigdy adres gościa ani token.
    expect(message).not.toContain("krysia@example.com");
    expect(message).not.toContain("Babcia Krysia");
  });
});

describe("describeError — co wolno zapisać w logu", () => {
  it("zwraca nazwę klasy błędu, nie jego komunikat", () => {
    const error = new Error("The following identities failed the check: krysia@example.com");
    error.name = "MessageRejected";

    // W piaskownicy SES komunikat odmowy zawiera ADRES ODBIORCY. Nazwa klasy
    // niesie tyle samo informacji diagnostycznej i żadnych danych osobowych.
    expect(describeError(error)).toBe("MessageRejected");
    expect(describeError(error)).not.toContain("krysia@example.com");
  });

  it("dokłada kod HTTP z metadanych SDK, gdy jest", () => {
    const error = Object.assign(new Error("odmowa"), {
      name: "AccessDeniedException",
      $metadata: { httpStatusCode: 403 },
    });

    expect(describeError(error)).toBe("AccessDeniedException (HTTP 403)");
  });

  it("radzi sobie z czymś, co nie jest błędem", () => {
    expect(describeError("cokolwiek")).toBe("nieznany błąd");
    expect(describeError(undefined)).toBe("nieznany błąd");
  });
});

describe("EMAIL_ENABLED — konfiguracja wysyłki", () => {
  it("domyślnie jest wyłączone", () => {
    expect(validateEnv({ ...BASE_ENV }).EMAIL_ENABLED).toBe(false);
  });

  it("włącza się wyłącznie jawną wartością true", () => {
    expect(
      validateEnv({ ...BASE_ENV, EMAIL_ENABLED: "true", MAIL_LAMBDA_FUNCTION_NAME: "zoja-mail" })
        .EMAIL_ENABLED,
    ).toBe(true);

    // Napis "false" jest niepustym stringiem — bez jawnego porównania
    // wypadłby jako true i włączyłby wysyłkę przez pomyłkę.
    expect(validateEnv({ ...BASE_ENV, EMAIL_ENABLED: "false" }).EMAIL_ENABLED).toBe(false);
    expect(validateEnv({ ...BASE_ENV, EMAIL_ENABLED: "yes" }).EMAIL_ENABLED).toBe(false);
  });

  it("przy włączonych mailach wymaga nazwy Mail Lambdy", () => {
    // Lepiej wywalić się głośno na zimnym starcie niż odkryć brak nazwy
    // dopiero przy pierwszej rezerwacji.
    expect(() => validateEnv({ ...BASE_ENV, EMAIL_ENABLED: "true" })).toThrow(
      /MAIL_LAMBDA_FUNCTION_NAME/,
    );
  });

  it("przy wyłączonych mailach nazwa Mail Lambdy jest zbędna", () => {
    expect(() => validateEnv({ ...BASE_ENV })).not.toThrow();
  });

  it("komunikat o brakach podaje tylko nazwy pól", () => {
    let message = "";
    try {
      validateEnv({ ...BASE_ENV, DB_PASSWORD: "", EMAIL_ENABLED: "true" });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("DB_PASSWORD");
    expect(message).toContain("MAIL_LAMBDA_FUNCTION_NAME");
    expect(message).not.toContain("localhost");
  });
});
