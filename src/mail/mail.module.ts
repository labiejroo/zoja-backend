import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { createLambdaInvoker, MailDispatcherService, MAIL_INVOKER } from "./mail-dispatcher.service.js";

/**
 * Warstwa powiadomień. Świadomie NIE jest @Global(): moduły, które wysyłają
 * maile, importują ją jawnie, więc z listy importów widać, kto powiadamia,
 * a kto nie.
 *
 * Klient Lambdy powstaje TYLKO przy włączonych mailach. Przy wyłączonych
 * dispatcher i tak wychodzi wcześniej, a zimny start nie płaci za budowanie
 * klienta, z którego nikt nie skorzysta.
 */
@Module({
  providers: [
    {
      provide: MAIL_INVOKER,
      useFactory: (config: ConfigService) =>
        config.get<boolean>("EMAIL_ENABLED") ? createLambdaInvoker() : DISABLED_INVOKER,
      inject: [ConfigService],
    },
    MailDispatcherService,
  ],
  exports: [MailDispatcherService],
})
export class MailModule {}

/**
 * Zaślepka na czas wyłączonych maili. Rzuca, zamiast po cichu udawać sukces —
 * gdyby dispatcher kiedyś zgubił sprawdzenie flagi, chcemy zobaczyć to w logu,
 * a nie odkryć po miesiącu, że maile nie wychodzą.
 */
const DISABLED_INVOKER = {
  send: () => {
    throw new Error("Wysyłka maili jest wyłączona (EMAIL_ENABLED=false).");
  },
};
