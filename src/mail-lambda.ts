import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";

import { describeError } from "./mail/mail-errors.js";
import { parseMailEvent, type MailEvent } from "./mail/mail-events.js";
import { renderEmail, type MailTemplateConfig } from "./mail/mail-templates.js";

/**
 * MAIL LAMBDA — jedyne miejsce w systemie, które wysyła pocztę.
 *
 * CZEGO TU NIE MA I DLACZEGO
 * Ani TypeORM, ani połączenia z RDS, ani pobierania sekretu bazy, ani
 * AppModule. Ta funkcja nie ma powodu znać bazy, więc jej nie zna — i dzięki
 * temu może stać POZA VPC. To nie jest drobiazg architektoniczny: gdyby
 * siedziała w VPC razem z API, potrzebowałaby NAT Gateway albo endpointu do
 * SES, żeby w ogóle dosięgnąć usługi. Wystawienie jej poza sieć prywatną
 * kosztuje zero i nie wymaga żadnej z tych rzeczy.
 *
 * Druga korzyść jest po stronie uprawnień. Tylko ta funkcja dostaje
 * ses:SendEmail. API Lambda, wystawiona publicznie przez API Gateway, nie ma
 * tego uprawnienia w ogóle.
 *
 * Handler: dist/mail-lambda.handler
 */

export interface MailLambdaResult {
  ok: boolean;
  type: string;
  reservationId: string;
  messageId?: string;
}

/**
 * Klient poza handlerem — powstaje raz na środowisko wykonawcze i przeżywa
 * kolejne wywołania razem z otwartym połączeniem HTTPS.
 */
const ses = new SESv2Client({});

/** Brak zmiennej i pusta zmienna to ten sam stan: nieskonfigurowane. */
function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Brak wymaganej zmiennej środowiskowej: ${name}.`);
  }
  return value;
}

/**
 * Skrzynki rodziców. Rozdzielone przecinkiem, bo zmienne środowiskowe Lambdy
 * są płaskimi stringami — JSON w env dawałby drugi format do pilnowania.
 */
function readParentRecipients(): string[] {
  return requireEnv("PARENT_NOTIFICATION_EMAILS")
    .split(",")
    .map((address) => address.trim())
    .filter((address) => address.length > 0);
}

function readTemplateConfig(): MailTemplateConfig {
  const parentRecipients = readParentRecipients();
  if (parentRecipients.length === 0) {
    throw new Error("PARENT_NOTIFICATION_EMAILS nie zawiera żadnego adresu.");
  }

  return {
    actionPageUrl: requireEnv("ACTION_PAGE_URL"),
    parentRecipients,
  };
}

/**
 * Sprawdzenie ma sens tylko dla zdarzeń, które idą do rodziców — reszta trafia
 * na adres gościa z payloadu i nie dotyka tej listy.
 */
async function send(event: MailEvent): Promise<string | undefined> {
  const message = renderEmail(event, readTemplateConfig());

  if (message.to.length === 0) {
    throw new Error("Wiadomość nie ma adresata.");
  }

  const response = await ses.send(
    new SendEmailCommand({
      FromEmailAddress: requireEnv("SES_FROM_EMAIL"),
      Destination: { ToAddresses: message.to },
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: "UTF-8" },
          Body: {
            // Obie wersje w jednej wiadomości. Klient poczty wybiera tę, którą
            // umie pokazać; filtry antyspamowe patrzą przychylniej na maila,
            // który ma alternatywę tekstową.
            Text: { Data: message.text, Charset: "UTF-8" },
            Html: { Data: message.html, Charset: "UTF-8" },
          },
        },
      },
    }),
  );

  return response.MessageId;
}

/**
 * CO WOLNO ZAPISAĆ W LOGU
 *
 * Typ zdarzenia, identyfikator rezerwacji, wynik i MessageId z SES. Nic więcej.
 * Adres gościa, jego imię, treść wiadomości i token decyzji do CloudWatch nie
 * trafiają — logi czyta się szerzej niż bazę, a token, który tam wyląduje,
 * trzeba uznać za spalony.
 */
export const handler = async (event: unknown): Promise<MailLambdaResult> => {
  const mailEvent = parseMailEvent(event);

  try {
    const messageId = await send(mailEvent);

    console.log(
      `Wysłano ${mailEvent.type} dla rezerwacji ${mailEvent.reservationId}` +
        (messageId ? ` (MessageId ${messageId})` : ""),
    );

    return {
      ok: true,
      type: mailEvent.type,
      reservationId: mailEvent.reservationId,
      messageId,
    };
  } catch (error: unknown) {
    console.error(
      `Nie udało się wysłać ${mailEvent.type} dla rezerwacji ${mailEvent.reservationId}: ` +
        describeError(error),
    );

    // Rzucamy dalej, żeby wywołanie było widocznie nieudane — MailDispatcher
    // po drugiej stronie rozpozna to po polu FunctionError i zapisze w logu.
    throw new Error("Wysyłka wiadomości nie powiodła się.", { cause: error });
  }
};
