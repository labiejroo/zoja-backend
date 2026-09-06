import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AdminAuthModule } from "../admin-auth/admin-auth.module.js";
import { MailModule } from "../mail/mail.module.js";
import { Reservation } from "../reservations/reservation.entity.js";
import { VisitSlot } from "../visits/visit-slot.entity.js";
import { AdminReservationsController } from "./admin-reservations.controller.js";
import { AdminReservationsService } from "./admin-reservations.service.js";
import { AdminVisitSlotsController } from "./admin-visit-slots.controller.js";
import { AdminVisitSlotsService } from "./admin-visit-slots.service.js";

/**
 * Operacje gospodarzy. Dwa kontrolery i dwa serwisy zamiast jednego wielkiego:
 * rezerwacje i terminy mają różne reguły i różny cykl życia, a wspólny plik
 * bardzo szybko przestałby się mieścić w głowie.
 *
 * forFeature rejestruje repozytoria na ISTNIEJĄCYM połączeniu z DatabaseModule.
 * Żadnego nowego DataSource — pula połączeń do RDS ma pozostać jedna.
 * Schemat bazy się nie zmienia: żadnych nowych encji ani migracji.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Reservation, VisitSlot]), MailModule, AdminAuthModule],
  controllers: [AdminReservationsController, AdminVisitSlotsController],
  providers: [AdminReservationsService, AdminVisitSlotsService],
})
export class AdminModule {}
