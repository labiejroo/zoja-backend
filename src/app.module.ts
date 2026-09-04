import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { validateEnv } from "./config/env.validation.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { ReservationsModule } from "./reservations/reservations.module.js";
import { VisitSlotsModule } from "./visits/visit-slots.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Walidacja przy starcie: brak DB_PASSWORD wywala zimny start,
      // zamiast produkować błędy przy każdym żądaniu.
      validate: validateEnv,
      // W Lambdzie pliku .env nie ma — zmienne wstrzykuje usługa.
      envFilePath: [".env"],
      cache: true,
    }),
    DatabaseModule,
    HealthModule,
    VisitSlotsModule,
    ReservationsModule,
    // Tu dojdzie AdminModule — patrz README w src/admin.
  ],
})
export class AppModule {}
