import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";

import { ReservationActionDto } from "./dto/reservation-action.dto.js";
import {
  ReservationActionsService,
  type ReservationActionPreview,
  type ReservationDecisionResult,
} from "./reservation-actions.service.js";

/**
 * Decyzja rodziców podjęta z linku w mailu.
 *
 * WSZYSTKO JEST POST-em, ŁĄCZNIE Z PODGLĄDEM.
 *
 * Przy `preview` wygląda to na nadużycie metody — operacja jest przecież tylko
 * odczytem. Powód jest praktyczny: token nie może znaleźć się w URL-u. W query
 * stringu trafiłby do logów CloudFrontu, do nagłówka Referer i do historii
 * przeglądarki, a stamtąd nie da się go już wycofać. W ciele żądania nie trafia
 * nigdzie.
 *
 * Przy `confirm` i `reject` powód jest inny i mocniejszy: skanery odnośników
 * w klientach pocztowych i w bramkach antyspamowych otwierają linki
 * z wiadomości samodzielnie, zanim człowiek ją przeczyta. Gdyby decyzja
 * zapadała na GET, taki skaner potwierdzałby wizyty za rodziców. Link z maila
 * prowadzi więc wyłącznie do strony, a strona wysyła POST dopiero po kliknięciu.
 *
 * Trasy są publiczne z natury: poświadczeniem jest sam token, nie sesja.
 */
@Controller("reservation-actions")
export class ReservationActionsController {
  constructor(private readonly service: ReservationActionsService) {}

  /** 200, nie 201 — nic tu nie powstaje. */
  @Post("preview")
  @HttpCode(HttpStatus.OK)
  preview(@Body() dto: ReservationActionDto): Promise<ReservationActionPreview> {
    return this.service.preview(dto.token);
  }

  @Post("confirm")
  @HttpCode(HttpStatus.OK)
  confirm(@Body() dto: ReservationActionDto): Promise<ReservationDecisionResult> {
    return this.service.confirm(dto.token);
  }

  @Post("reject")
  @HttpCode(HttpStatus.OK)
  reject(@Body() dto: ReservationActionDto): Promise<ReservationDecisionResult> {
    return this.service.reject(dto.token);
  }
}
