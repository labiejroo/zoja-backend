import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";

import { AdminSessionGuard } from "../admin-auth/admin-session.guard.js";
import {
  AdminReservationsService,
  type AdminReservationWithSlot,
} from "./admin-reservations.service.js";
import { CreateAdminReservationDto } from "./dto/create-admin-reservation.dto.js";
import { UpdateReservationDto } from "./dto/update-reservation.dto.js";

/**
 * Panel gospodarzy — operacje na rezerwacjach.
 *
 * Globalny prefiks `api` dokłada configureApp(), więc pełna ścieżka to
 * /api/admin/reservations/...
 *
 * UWAGA: te trasy nie mają jeszcze żadnej autoryzacji. To świadoma decyzja na
 * czas MVP (frontend odsłania panel parametrem ?zoja), ale znaczy też, że do
 * bazy nie wolno wpuścić prawdziwych danych osobowych, dopóki nie dojdzie
 * mechanizm logowania. Patrz README.
 */
@UseGuards(AdminSessionGuard)
@Controller("admin/reservations")
export class AdminReservationsController {
  constructor(private readonly service: AdminReservationsService) {}

  /**
   * Wizyta zakładana wprost przez gospodarzy — na przykład umówiona przez
   * telefon. Powstaje od razu jako CONFIRMED; statusu nie przyjmujemy z ciała
   * żądania, bo nie ma tu prośby, na którą ktoś miałby odpowiedzieć.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateAdminReservationDto): Promise<AdminReservationWithSlot> {
    return this.service.create(dto);
  }

  /** Identyfikatory walidujemy pipe'em — inaczej zły format leci do bazy. */
  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateReservationDto,
  ): Promise<AdminReservationWithSlot> {
    return this.service.update(id, dto);
  }

  @Post(":id/confirm")
  @HttpCode(HttpStatus.OK)
  confirm(@Param("id", ParseUUIDPipe) id: string): Promise<AdminReservationWithSlot> {
    return this.service.confirm(id);
  }

  @Post(":id/reject")
  @HttpCode(HttpStatus.OK)
  reject(@Param("id", ParseUUIDPipe) id: string): Promise<AdminReservationWithSlot> {
    return this.service.reject(id);
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  cancel(@Param("id", ParseUUIDPipe) id: string): Promise<AdminReservationWithSlot> {
    return this.service.cancel(id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.service.remove(id);
  }
}
