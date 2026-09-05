import {
  MailEventType,
  type MailArrivalDay,
  type MailEvent,
  type MailReservationSummary,
} from "./mail-events.js";

/**
 * SZABLONY MAILI — czysty tekst i prosty HTML, bez silnika szablonów.
 *
 * Maili jest siedem i wszystkie są krótkie. MJML czy React Email dołożyłyby tu
 * kilkanaście megabajtów zależności i krok kompilacji do funkcji, której cała
 * praca to sklejenie pięciu zdań. Wracamy do tego, gdy maile zrobią się
 * naprawdę graficzne — nie wcześniej.
 *
 * Każdy mail ma OBIE wersje. Część klientów (i filtry antyspamowe) traktuje
 * wiadomość zawierającą wyłącznie HTML gorzej, a czytniki ekranu i tryb
 * tekstowy po prostu jej nie pokażą.
 */

export interface MailTemplateConfig {
  /** Adres strony decyzyjnej na froncie, np. https://.../decision */
  actionPageUrl: string;
  /** Skrzynki rodziców. Tylko one dostają powiadomienie o nowej prośbie. */
  parentRecipients: string[];
}

export interface RenderedEmail {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

/**
 * Escapowanie encji HTML.
 *
 * Do maila wchodzą teksty wpisane przez gościa: imię i wiadomość. Bez tego
 * nawias ostry w treści rozbiłby układ wiadomości, a w gorszym wypadku
 * przemycił znacznik do skrzynki rodziców. Wersja tekstowa escapowania nie
 * potrzebuje — tam nic nie jest interpretowane.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const DATE_FORMATTER = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * "2031-01-04" → "4 stycznia 2031".
 *
 * Datę kalendarzową czytamy jako północ UTC i w tej samej strefie formatujemy,
 * więc przesunięcie stref nie ma jak przesunąć dnia. Ta sama konwencja co
 * w common/calendar-date.ts.
 */
function formatDate(date: string): string {
  return DATE_FORMATTER.format(new Date(`${date}T00:00:00Z`));
}

function formatRange(dateStart: string, dateEnd: string): string {
  if (dateStart === dateEnd) return formatDate(dateStart);
  return `${formatDate(dateStart)} – ${formatDate(dateEnd)}`;
}

function formatArrival(arrivalDay: MailArrivalDay | null): string {
  if (arrivalDay === "saturday") return "sobota";
  if (arrivalDay === "sunday") return "niedziela";
  return "jeszcze nieustalony";
}

/**
 * Link do STRONY, nie do akcji.
 *
 * Token siedzi we FRAGMENCIE URL-a (po #), a nie w query stringu. Fragment nie
 * jest wysyłany w żądaniu HTTP, więc nie trafia do logów CloudFrontu, do
 * nagłówka Referer ani do historii serwera — zna go wyłącznie przeglądarka
 * rodziców.
 *
 * Sam link niczego nie rozstrzyga. Skanery antywirusowe w klientach pocztowych
 * rutynowo otwierają odnośniki z wiadomości; gdyby decyzja zapadała przez GET,
 * skaner potrafiłby potwierdzić wizytę, zanim ktokolwiek maila przeczyta.
 * Dlatego strona tylko pokazuje prośbę, a status zmienia dopiero POST po
 * świadomym kliknięciu.
 */
function decisionLink(
  config: MailTemplateConfig,
  action: "confirm" | "reject",
  token: string,
): string {
  return `${config.actionPageUrl}#action=${action}&token=${encodeURIComponent(token)}`;
}

/** Wiersz "Etykieta: wartość"; wiadomość gościa pomijamy, gdy jej nie ma. */
function detailLines(summary: MailReservationSummary): string[] {
  const lines = [
    `Kto przyjeżdża: ${summary.guestName}`,
    `Termin: ${formatRange(summary.dateStart, summary.dateEnd)}`,
    `Dzień przyjazdu: ${formatArrival(summary.arrivalDay)}`,
  ];
  if (summary.notes) lines.push(`Wiadomość od gościa: ${summary.notes}`);
  return lines;
}

function detailsHtml(summary: MailReservationSummary): string {
  const rows = detailLines(summary)
    .map((line) => {
      const [label, ...rest] = line.split(": ");
      return (
        `<tr><td style="padding:4px 12px 4px 0;color:#6b625b;">${escapeHtml(label)}</td>` +
        `<td style="padding:4px 0;color:#3d332c;">${escapeHtml(rest.join(": "))}</td></tr>`
      );
    })
    .join("");

  return `<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.5;">${rows}</table>`;
}

/**
 * Wspólna oprawa wiadomości. Style są inline, bo klienty pocztowe (przede
 * wszystkim Gmail) usuwają blok style z nagłówka dokumentu.
 */
function layout(heading: string, bodyHtml: string): string {
  return [
    `<div style="margin:0;padding:24px;background:#faf7f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#3d332c;">`,
    `<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #ece5df;border-radius:16px;padding:24px;">`,
    `<h1 style="margin:0 0 16px;font-size:20px;font-weight:600;line-height:1.25;">${escapeHtml(heading)}</h1>`,
    bodyHtml,
    `<p style="margin:24px 0 0;font-size:12px;color:#8a807a;">Wiadomość wysłana automatycznie przez stronę odwiedzin u Zoi.</p>`,
    `</div></div>`,
  ].join("");
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;">${escapeHtml(text)}</p>`;
}

function button(href: string, label: string, background: string): string {
  return (
    `<a href="${escapeHtml(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:12px 20px;` +
    `border-radius:12px;background:${background};color:#ffffff;font-size:15px;font-weight:600;` +
    `text-decoration:none;">${escapeHtml(label)}</a>`
  );
}

/** Wersja tekstowa: te same informacje, bez żadnego znacznika. */
function textBody(intro: string[], summary: MailReservationSummary, outro: string[] = []): string {
  return [
    ...intro,
    "",
    ...detailLines(summary),
    ...(outro.length > 0 ? ["", ...outro] : []),
  ].join("\n");
}

/**
 * Buduje gotową wiadomość dla zdarzenia.
 *
 * switch jest wyczerpujący — dopisanie eventu do unii bez szablonu tutaj nie
 * przejdzie kompilacji, więc nie da się wysłać pustego maila przez zapomnienie.
 */
export function renderEmail(event: MailEvent, config: MailTemplateConfig): RenderedEmail {
  switch (event.type) {
    case MailEventType.RESERVATION_REQUESTED_PARENT: {
      const confirmUrl = decisionLink(config, "confirm", event.decisionToken);
      const rejectUrl = decisionLink(config, "reject", event.decisionToken);
      const privacy = event.isPrivate
        ? "Gość poprosił, żeby nie pokazywać publicznie, kto przyjeżdża."
        : "Gość zgodził się, żeby jego imię było widoczne w kalendarzu.";

      return {
        to: config.parentRecipients,
        subject: `Prośba o odwiedziny: ${formatRange(event.dateStart, event.dateEnd)}`,
        text: textBody(["Ktoś prosi o termin odwiedzin u Zoi."], event, [
          privacy,
          "",
          "Potwierdź:",
          confirmUrl,
          "",
          "Odrzuć:",
          rejectUrl,
          "",
          "Linki otwierają stronę z prośbą. Nic się nie zmieni, dopóki nie klikniecie",
          "przycisku na tej stronie. Linki działają przez 7 dni.",
        ]),
        html: layout(
          "Ktoś prosi o odwiedziny",
          [
            detailsHtml(event),
            `<p style="margin:16px 0 12px;font-size:14px;color:#6b625b;">${escapeHtml(privacy)}</p>`,
            `<div style="margin:16px 0 4px;">`,
            button(confirmUrl, "Potwierdź", "#4a7c59"),
            button(rejectUrl, "Odrzuć", "#8a807a"),
            `</div>`,
            `<p style="margin:8px 0 0;font-size:13px;color:#8a807a;line-height:1.5;">Linki otwierają stronę z prośbą — nic się nie zmieni, dopóki nie klikniecie przycisku na tej stronie. Linki działają przez 7 dni.</p>`,
          ].join(""),
        ),
      };
    }

    case MailEventType.GUEST_REQUEST_RECEIVED:
      return {
        to: [event.guestEmail],
        subject: `Mamy Twoją prośbę o odwiedziny: ${formatRange(event.dateStart, event.dateEnd)}`,
        text: textBody(
          [
            `Cześć ${event.guestName},`,
            "",
            "dostaliśmy Twoją prośbę o odwiedziny u Zoi. Czeka teraz na decyzję rodziców.",
          ],
          event,
          ["Damy znać mailem, gdy tylko podejmą decyzję."],
        ),
        html: layout(
          "Mamy Twoją prośbę",
          [
            paragraph(`Cześć ${event.guestName},`),
            paragraph(
              "dostaliśmy Twoją prośbę o odwiedziny u Zoi. Czeka teraz na decyzję rodziców.",
            ),
            detailsHtml(event),
            paragraph("Damy znać mailem, gdy tylko podejmą decyzję."),
          ].join(""),
        ),
      };

    case MailEventType.GUEST_CONFIRMED:
      return {
        to: [event.guestEmail],
        subject: `Odwiedziny potwierdzone: ${formatRange(event.dateStart, event.dateEnd)}`,
        text: textBody(
          [
            `Cześć ${event.guestName},`,
            "",
            "rodzice Zoi potwierdzili Twoje odwiedziny. Do zobaczenia!",
          ],
          event,
        ),
        html: layout(
          "Odwiedziny potwierdzone",
          [
            paragraph(`Cześć ${event.guestName},`),
            paragraph("rodzice Zoi potwierdzili Twoje odwiedziny. Do zobaczenia!"),
            detailsHtml(event),
          ].join(""),
        ),
      };

    case MailEventType.GUEST_REJECTED:
      return {
        to: [event.guestEmail],
        subject: `Ten termin niestety nie wyszedł: ${formatRange(event.dateStart, event.dateEnd)}`,
        text: textBody(
          [
            `Cześć ${event.guestName},`,
            "",
            "niestety ten termin nie wyszedł. Zajrzyj na stronę — inne weekendy są wolne.",
          ],
          event,
        ),
        html: layout(
          "Ten termin nie wyszedł",
          [
            paragraph(`Cześć ${event.guestName},`),
            paragraph(
              "niestety ten termin nie wyszedł. Zajrzyj na stronę — inne weekendy są wolne.",
            ),
            detailsHtml(event),
          ].join(""),
        ),
      };

    case MailEventType.GUEST_CANCELLED:
      return {
        to: [event.guestEmail],
        subject: `Odwiedziny odwołane: ${formatRange(event.dateStart, event.dateEnd)}`,
        text: textBody(
          [
            `Cześć ${event.guestName},`,
            "",
            "te odwiedziny zostały odwołane. Jeśli chcesz, wybierz na stronie inny termin.",
          ],
          event,
        ),
        html: layout(
          "Odwiedziny odwołane",
          [
            paragraph(`Cześć ${event.guestName},`),
            paragraph(
              "te odwiedziny zostały odwołane. Jeśli chcesz, wybierz na stronie inny termin.",
            ),
            detailsHtml(event),
          ].join(""),
        ),
      };

    case MailEventType.GUEST_RESERVATION_UPDATED:
      return {
        to: [event.guestEmail],
        subject: `Zmiana w odwiedzinach: ${formatRange(event.dateStart, event.dateEnd)}`,
        text: textBody(
          [
            `Cześć ${event.guestName},`,
            "",
            "rodzice Zoi zmienili szczegóły Twoich odwiedzin. Aktualnie wygląda to tak:",
          ],
          event,
        ),
        html: layout(
          "Zmiana w odwiedzinach",
          [
            paragraph(`Cześć ${event.guestName},`),
            paragraph("rodzice Zoi zmienili szczegóły Twoich odwiedzin. Aktualnie wygląda to tak:"),
            detailsHtml(event),
          ].join(""),
        ),
      };

    case MailEventType.ADMIN_CREATED_RESERVATION:
      return {
        to: [event.guestEmail],
        subject: `Odwiedziny zapisane: ${formatRange(event.dateStart, event.dateEnd)}`,
        text: textBody(
          [
            `Cześć ${event.guestName},`,
            "",
            "rodzice Zoi zapisali Twoje odwiedziny w kalendarzu. Termin jest już potwierdzony.",
          ],
          event,
        ),
        html: layout(
          "Odwiedziny zapisane",
          [
            paragraph(`Cześć ${event.guestName},`),
            paragraph(
              "rodzice Zoi zapisali Twoje odwiedziny w kalendarzu. Termin jest już potwierdzony.",
            ),
            detailsHtml(event),
          ].join(""),
        ),
      };
  }
}
