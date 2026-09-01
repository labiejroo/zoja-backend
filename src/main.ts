import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";
import { configureApp, GLOBAL_PREFIX } from "./app.setup.js";

/**
 * Lokalny serwer HTTP. W Lambdzie ten plik nie jest używany —
 * tam wejściem jest lambda.ts, które NIE wywołuje app.listen().
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  new Logger("Bootstrap").log(`Backend nasłuchuje na http://localhost:${port}/${GLOBAL_PREFIX}`);
}

void bootstrap();
