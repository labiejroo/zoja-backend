import { ValidationPipe, type INestApplication } from "@nestjs/common";

/** Prefiks doklejany do każdej trasy. Musi zgadzać się ze ścieżką w CloudFront i API Gateway. */
export const GLOBAL_PREFIX = "api";

/**
 * Wspólna konfiguracja aplikacji dla obu entrypointów.
 *
 * main.ts i lambda.ts muszą zachowywać się identycznie — gdyby każdy ustawiał
 * pipe'y i prefiks osobno, prędzej czy później lokalnie działałoby coś, co na
 * produkcji zwraca 404 albo przepuszcza niezwalidowane dane.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(GLOBAL_PREFIX);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
}
