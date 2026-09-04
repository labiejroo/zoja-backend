import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";

import { CreateReservationDto } from "./dto/create-reservation.dto.js";
import { ReservationsService, type CreateReservationResult } from "./reservations.service.js";

/**
 * Globalny prefiks `api` ustawia configureApp(), więc pełna ścieżka to
 * POST /api/reservations — ta sama konwencja co w HealthController.
 */
@Controller("reservations")
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateReservationDto): Promise<CreateReservationResult> {
    return this.reservationsService.create(dto);
  }
}
