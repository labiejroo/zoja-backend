import { InvokeCommand, LambdaClient, type InvokeCommandOutput } from "@aws-sdk/client-lambda";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { TypedConfigService } from "../config/configuration.js";
import { describeError } from "./mail-errors.js";
import type { MailEvent } from "./mail-events.js";

/**
 * Minimalny kształt klienta, jakiego potrzebuje dispatcher.
 *
 * Zawężenie do jednej metody nie jest ozdobnikiem: dzięki niemu test podstawia
 * zwykły obiekt z mockiem, zamiast udawać cały LambdaClient z SDK.
 */
export interface MailInvoker {
  send(command: InvokeCommand): Promise<InvokeCommandOutput>;
}

export const MAIL_INVOKER = Symbol("MAIL_INVOKER");

/** Wynik próby wysyłki — na tyle ogólny, żeby nie zdradzał niczego o treści. */
export type MailDispatchOutcome = "disabled" | "sent" | "failed";

/**
 * WYSYŁKA MAILI ODBYWA SIĘ POZA TĄ LAMBDĄ.
 *
 * API Lambda siedzi w VPC bez NAT Gateway, więc nie ma trasy do publicznych
 * endpointów AWS. Zamiast dokładać NAT (stały koszt) albo endpoint SES,
 * przerzucamy wysyłkę do osobnej funkcji stojącej poza VPC.
 *
 * Rozdział ma jednak drugi, ważniejszy powód: uprawnienia. To Mail Lambda
 * dostaje ses:SendEmail, a API Lambda nie dostaje go nigdy. Gdyby ktoś znalazł
 * dziurę w publicznym API, nie zyska tym samym możliwości wysyłania maili
 * z naszej domeny.
 */
@Injectable()
export class MailDispatcherService {
  private readonly logger = new Logger(MailDispatcherService.name);
  private readonly enabled: boolean;
  private readonly functionName: string;

  constructor(
    /**
     * ConfigService jako TYP RUNTIME, nie alias.
     *
     * TypedConfigService jest aliasem typu, wiec po kompilacji nie zostaje po
     * nim zaden token - emitDecoratorMetadata zapisuje wtedy Object, a Nest
     * konczy z UnknownDependenciesException dopiero przy starcie aplikacji.
     * Aliasu uzywamy wylacznie do odczytu, juz po wstrzyknieciu.
     */
    config: ConfigService,
    @Inject(MAIL_INVOKER) private readonly lambda: MailInvoker,
  ) {
    const typed = config as unknown as TypedConfigService;
    this.enabled = typed.get("EMAIL_ENABLED", { infer: true });
    this.functionName = typed.get("MAIL_LAMBDA_FUNCTION_NAME", { infer: true });
  }

  /**
   * Wysyła zdarzenie i NIGDY nie rzuca.
   *
   * To jest cała umowa tej metody. Rezerwacja zapisana w bazie jest faktem;
   * nieudany mail jest kłopotem z powiadomieniem. Gdyby wyjątek stąd wyleciał
   * do kontrolera, gość zobaczyłby błąd mimo zapisanej wizyty i spróbowałby
   * jeszcze raz — trafiając w zajęty termin, który sam przed chwilą zajął.
   *
   * TODO (etap E-MAIL B): tabela wychodzących zdarzeń i ponawianie. Dziś
   * nieudany mail przepada i zostaje po nim wyłącznie wpis w CloudWatch.
   */
  async dispatch(event: MailEvent): Promise<MailDispatchOutcome> {
    if (!this.enabled) {
      // Sam typ zdarzenia i identyfikator. Nigdy adresu, imienia ani tokenu.
      this.logger.log(`Maile wyłączone — pomijam ${event.type} (${event.reservationId})`);
      return "disabled";
    }

    try {
      const response = await this.lambda.send(
        new InvokeCommand({
          FunctionName: this.functionName,
          // RequestResponse, nie Event: na tym etapie wolimy poczekać i mieć
          // w logu jednoznaczną informację, czy mail wyszedł. Przy Event
          // dostalibyśmy 202 także wtedy, gdy funkcja po chwili wybucha.
          InvocationType: "RequestResponse",
          Payload: Buffer.from(JSON.stringify(event), "utf8"),
        }),
      );

      // Wyjątek WEWNĄTRZ Mail Lambdy nie jest błędem wywołania — SDK zwraca
      // wtedy 200 z ustawionym FunctionError. Bez tego sprawdzenia uznalibyśmy
      // za wysłany każdy mail, który wysypał się po drugiej stronie.
      if (response.FunctionError) {
        this.logger.error(
          `Mail Lambda zgłosiła błąd dla ${event.type} (${event.reservationId}): ${response.FunctionError}`,
        );
        return "failed";
      }

      this.logger.log(`Wysłano ${event.type} (${event.reservationId})`);
      return "sent";
    } catch (error: unknown) {
      /**
       * Logujemy KOMUNIKAT, nie payload i nie cały obiekt błędu.
       *
       * Payload zawiera adres gościa, a przy prośbie o wizytę także jawny token
       * decyzji. CloudWatch Logs czyta się szerzej niż bazę, więc token, który
       * tam trafi, trzeba uznać za spalony.
       */
      this.logger.error(
        `Nie udało się wysłać ${event.type} (${event.reservationId}): ` +
          describeError(error),
      );
      return "failed";
    }
  }
}

/**
 * Klient tworzony raz na środowisko wykonawcze — tak samo jak pula połączeń
 * w lambda.ts. Region bierze się z AWS_REGION, którą runtime ustawia sam.
 */
export function createLambdaInvoker(): MailInvoker {
  return new LambdaClient({});
}
