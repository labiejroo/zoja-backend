import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { VisitSlot } from "../visits/visit-slot.entity.js";
import { Reservation } from "./reservation.entity.js";
import { ReservationsController } from "./reservations.controller.js";
import { ReservationsService } from "./reservations.service.js";

/**
 * forFeature rejestruje repozytoria na istniejącym połączeniu z DatabaseModule.
 * Żadnego nowego DataSource — pula połączeń do RDS ma pozostać jedna.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Reservation, VisitSlot])],
  controllers: [ReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
