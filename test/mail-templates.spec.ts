import { describe, expect, it } from "vitest";

import { MailEventType, type MailEvent } from "../src/mail/mail-events.js";
import { escapeHtml, renderEmail } from "../src/mail/mail-templates.js";

const CONFIG = {
  actionPageUrl: "https://przyklad.example/decision",
  parentRecipients: ["mama@example.com", "tata@example.com"],
};

const RAW_TOKEN = "abc-DEF_123";

const summary = {
  reservationId: "res-1",
  guestName: "Babcia Krysia",
  guestEmail: "krysia@example.com",
  dateStart: "2031-01-04",
  dateEnd: "2031-01-05",
  arrivalDay: "saturday" as const,
  notes: "Przyjedziemy autem.",
};

const parentEvent: MailEvent = {
  type: MailEventType.RESERVATION_REQUESTED_PARENT,
  ...summary,
  isPrivate: false,
  decisionToken: RAW_TOKEN,
};

/** Wszystkie zdarzenia adresowane do gościa — token nie ma prawa być w żadnym. */
const guestEvents: MailEvent[] = [
  { type: MailEventType.GUEST_REQUEST_RECEIVED, ...summary },
  { type: MailEventType.GUEST_CONFIRMED, ...summary },
  { type: MailEventType.GUEST_REJECTED, ...summary },
  { type: MailEventType.GUEST_CANCELLED, ...summary },
  { type: MailEventType.GUEST_RESERVATION_UPDATED, ...summary },
  { type: MailEventType.ADMIN_CREATED_RESERVATION, ...summary },
];

describe("Szablony maili — kształt wspólny", () => {
  [parentEvent, ...guestEvents].forEach((event) => {
    it(`${event.type} ma temat, wersję tekstową i HTML`, () => {
      const mail = renderEmail(event, CONFIG);

      expect(mail.subject.length).toBeGreaterThan(0);
      expect(mail.text.length).toBeGreaterThan(0);
      expect(mail.html).toContain("<div");
      expect(mail.to.length).toBeGreaterThan(0);
    });

    it(`${event.type} podaje termin po polsku w obu wersjach`, () => {
      const mail = renderEmail(event, CONFIG);

      expect(mail.text).toContain("4 stycznia 2031");
      expect(mail.html).toContain("4 stycznia 2031");
      // Data kalendarzowa nie przesuwa się przez strefę czasową.
      expect(mail.text).not.toContain("3 stycznia");
    });
  });
});

describe("Mail do rodziców — linki decyzji", () => {
  it("idzie do rodziców, nie do gościa", () => {
    const mail = renderEmail(parentEvent, CONFIG);

    expect(mail.to).toEqual(["mama@example.com", "tata@example.com"]);
    expect(mail.to).not.toContain("krysia@example.com");
  });

  it("umieszcza token we FRAGMENCIE URL-a, nie w query stringu", () => {
    const mail = renderEmail(parentEvent, CONFIG);

    expect(mail.text).toContain(
      "https://przyklad.example/decision#action=confirm&token=abc-DEF_123",
    );
    expect(mail.text).toContain(
      "https://przyklad.example/decision#action=reject&token=abc-DEF_123",
    );

    // Fragment nie jest wysyłany w żądaniu HTTP — token nie trafi do logów
    // CloudFrontu ani do nagłówka Referer. Query string by trafił.
    expect(mail.text).not.toContain("decision?action=");
    expect(mail.text).not.toContain("?token=");
  });

  it("koduje token, gdyby kiedyś zawierał znak specjalny", () => {
    const mail = renderEmail(
      { ...parentEvent, decisionToken: "a+b/c=d e" },
      CONFIG,
    );

    expect(mail.text).toContain(`token=${encodeURIComponent("a+b/c=d e")}`);
    expect(mail.text).not.toContain("token=a+b/c=d e");
  });

  it("oba przyciski prowadzą do tej samej strony, różnią się akcją", () => {
    const mail = renderEmail(parentEvent, CONFIG);

    expect(mail.html).toContain("action=confirm");
    expect(mail.html).toContain("action=reject");
    expect(mail.html).toContain("Potwierdź");
    expect(mail.html).toContain("Odrzuć");
  });

  it("mówi wprost, że kliknięcie linku niczego jeszcze nie zmienia", () => {
    const mail = renderEmail(parentEvent, CONFIG);

    expect(mail.text).toContain("Linki otwierają stronę");
    expect(mail.html).toContain("Linki otwierają stronę");
  });

  it("informuje, czy gość prosił o ukrycie w kalendarzu", () => {
    const hidden = renderEmail({ ...parentEvent, isPrivate: true }, CONFIG);
    const shown = renderEmail({ ...parentEvent, isPrivate: false }, CONFIG);

    expect(hidden.text).toContain("nie pokazywać publicznie");
    expect(shown.text).toContain("widoczne w kalendarzu");
  });
});

describe("Maile do gościa nie niosą tokenu", () => {
  guestEvents.forEach((event) => {
    it(`${event.type} idzie na adres gościa i nie zawiera tokenu`, () => {
      const mail = renderEmail(event, CONFIG);

      expect(mail.to).toEqual(["krysia@example.com"]);
      expect(mail.text).not.toContain(RAW_TOKEN);
      expect(mail.html).not.toContain(RAW_TOKEN);
      expect(mail.text).not.toContain("action=confirm");
      expect(mail.html).not.toContain("action=confirm");
    });
  });
});

describe("Escapowanie treści od gościa", () => {
  it("zamienia znaki składniowe HTML na encje", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });

  it("imię gościa nie może wstrzyknąć znacznika do maila rodziców", () => {
    const mail = renderEmail(
      { ...parentEvent, guestName: `<img src=x onerror="alert(1)">` },
      CONFIG,
    );

    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
    // Wersja tekstowa niczego nie interpretuje, więc zostaje jak wpisano.
    expect(mail.text).toContain("<img");
  });

  it("wiadomość gościa też jest escapowana", () => {
    const mail = renderEmail(
      { ...parentEvent, notes: `</td></tr></table><b>przejęte</b>` },
      CONFIG,
    );

    expect(mail.html).not.toContain("<b>przejęte</b>");
    expect(mail.html).toContain("&lt;b&gt;");
  });

  it("adres strony w atrybucie href jest escapowany", () => {
    const mail = renderEmail(parentEvent, {
      ...CONFIG,
      actionPageUrl: `https://przyklad.example/decision"onmouseover="x`,
    });

    expect(mail.html).not.toContain(`"onmouseover="x`);
    expect(mail.html).toContain("&quot;onmouseover=");
  });
});

describe("Szczegóły rezerwacji w treści", () => {
  it("pomija wiersz wiadomości, gdy gość nic nie napisał", () => {
    const mail = renderEmail({ ...parentEvent, notes: null }, CONFIG);

    expect(mail.text).not.toContain("Wiadomość od gościa");
    expect(mail.html).not.toContain("Wiadomość od gościa");
  });

  it("pokazuje wiersz wiadomości, gdy gość coś napisał", () => {
    const mail = renderEmail(parentEvent, CONFIG);

    expect(mail.text).toContain("Wiadomość od gościa: Przyjedziemy autem.");
  });

  it("nieustalony dzień przyjazdu opisuje słowami, nie pustką", () => {
    const mail = renderEmail({ ...parentEvent, arrivalDay: null }, CONFIG);

    expect(mail.text).toContain("Dzień przyjazdu: jeszcze nieustalony");
  });

  it("termin jednodniowy podaje jedną datę, nie zakres do samej siebie", () => {
    const mail = renderEmail(
      { ...parentEvent, dateStart: "2031-01-04", dateEnd: "2031-01-04" },
      CONFIG,
    );

    expect(mail.text).toContain("Termin: 4 stycznia 2031");
    expect(mail.text).not.toContain("4 stycznia 2031 – 4 stycznia 2031");
  });
});
