import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { Reservation } from "../reservations/reservation.entity.js";
import { VisitSlot } from "./visit-slot.entity.js";
import { VisitSlotsController } from "./visit-slots.controller.js";
import { VisitSlotsService } from "./visit-slots.service.js";

@Module({
  imports: [TypeOrmModule.forFeature([VisitSlot, Reservation])],
  controllers: [VisitSlotsController],
  providers: [VisitSlotsService],
})
export class VisitSlotsModule {}
