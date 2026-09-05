import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { MailModule } from "../mail/mail.module.js";
import { Reservation } from "../reservations/reservation.entity.js";
import { ReservationActionsController } from "./reservation-actions.controller.js";
import { ReservationActionsService } from "./reservation-actions.service.js";

/**
 * Decyzje podejmowane z linku w mailu.
 *
 * Osobny moduł, a nie kilka tras dołożonych do AdminModule. Te dwa obszary mają
 * różne poświadczenia — tam kiedyś stanie logowanie gospodarzy, tutaj zawsze
 * będzie decydował token z wiadomości — więc trzymanie ich razem oznaczałoby,
 * że każda zmiana autoryzacji dotyka obu naraz.
 *
 * Wystarczy repozytorium rezerwacji: terminu nie tworzymy ani nie przenosimy,
 * a daty do wyświetlenia dociągamy relacją.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Reservation]), MailModule],
  controllers: [ReservationActionsController],
  providers: [ReservationActionsService],
})
export class ReservationActionsModule {}
