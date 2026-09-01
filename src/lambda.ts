import "reflect-metadata";

import { configure as configureServerlessExpress } from "@codegenie/serverless-express";
import { NestFactory } from "@nestjs/core";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from "aws-lambda";

import { AppModule } from "./app.module.js";
import { configureApp } from "./app.setup.js";

type ProxyHandler = (
  event: APIGatewayProxyEventV2,
  context: Context,
) => Promise<APIGatewayProxyResultV2>;

/**
 * Cache w zakresie MODUŁU, nie funkcji.
 *
 * Kod na tym poziomie wykonuje się raz na środowisko wykonawcze. Przy ciepłym
 * wywołaniu graf DI Nesta i pula połączeń TypeORM są już gotowe — nie budujemy
 * ich ponownie i nie otwieramy nowych połączeń do RDS. To jest główny mechanizm
 * chroniący bazę przed lawiną połączeń przy skoku ruchu.
 *
 * Cache'ujemy PROMISE, nie wynik: gdyby dwa wywołania trafiły w to samo zimne
 * środowisko, obydwa poczekają na ten sam bootstrap zamiast robić go dwa razy.
 */
let bootstrapPromise: Promise<ProxyHandler> | undefined;

async function bootstrap(): Promise<ProxyHandler> {
  const app = await NestFactory.create(AppModule, {
    // W Lambdzie logi i tak idą do CloudWatch przez stdout.
    logger: ["error", "warn", "log"],
  });

  configureApp(app);

  // Świadomie NIE wywołujemy app.listen() — w Lambdzie nie ma czego nasłuchiwać.
  // init() buduje kontener DI i inicjalizuje moduły, w tym połączenie z bazą.
  await app.init();

  return configureServerlessExpress({
    app: app.getHttpAdapter().getInstance(),
  }) as unknown as ProxyHandler;
}

/**
 * Handler dla API Gateway HTTP API (payload v2).
 *
 * Zwracamy obietnicę zamiast korzystać z parametru `callback`, dzięki czemu
 * runtime kończy wywołanie w momencie rozwiązania promise'a. Przy takim
 * podejściu `context.callbackWaitsForEmptyEventLoop` nie ma znaczenia —
 * to ustawienie dotyczy handlerów w stylu callback, gdzie otwarta pula
 * połączeń potrafi zablokować zakończenie wywołania.
 */
export const handler: ProxyHandler = async (event, context) => {
  bootstrapPromise ??= bootstrap();
  const proxy = await bootstrapPromise;
  return proxy(event, context);
};
