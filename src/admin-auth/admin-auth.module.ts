import { Module } from "@nestjs/common";

import { AdminAuthController } from "./admin-auth.controller.js";
import { AdminAuthService } from "./admin-auth.service.js";
import {
  AdminAuthSecretService,
  createSecretReader,
  ADMIN_SECRET_READER,
} from "./admin-auth-secret.service.js";
import { AdminSessionGuard } from "./admin-session.guard.js";

/**
 * Uwierzytelnianie gospodarzy.
 *
 * Moduł eksportuje guard i serwis, bo używa ich AdminModule — kontrolery
 * rezerwacji i terminów stoją za tym samym strażnikiem. Nie robimy go
 * @Global(): z listy importów AdminModule ma być widać, co go chroni.
 *
 * Klient Secrets Managera powstaje raz na środowisko wykonawcze i sięga do
 * ISTNIEJĄCEGO Interface VPC Endpointu, tego samego, przez który backend
 * pobiera hasło do bazy. Żadnego nowego zasobu sieciowego.
 */
@Module({
  providers: [
    {
      provide: ADMIN_SECRET_READER,
      useFactory: createSecretReader,
    },
    AdminAuthSecretService,
    AdminAuthService,
    AdminSessionGuard,
  ],
  controllers: [AdminAuthController],
  exports: [AdminAuthService, AdminSessionGuard],
})
export class AdminAuthModule {}
