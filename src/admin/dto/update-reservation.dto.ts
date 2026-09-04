import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

import { ISO_DATE_PATTERN } from "../../common/calendar-date.js";
import { ArrivalDay } from "../../reservations/reservation.enums.js";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

/**
 * Edycja rezerwacji przez gospodarzy.
 *
 * Wszystkie pola opcjonalne — to PATCH, nie PUT. Status celowo NIE jest tu
 * edytowalny: przejścia między stanami mają własne endpointy, bo każde ma
 * własne reguły (czego nie wolno reaktywować, co jest idempotentne) i docelowo
 * własnego maila. Gdyby status dało się ustawić „z ręki”, te reguły dałoby się
 * ominąć jednym PATCH-em.
 */
export class UpdateReservationDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: "Napiszcie, kto przyjedzie." })
  @MaxLength(80)
  guestName?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: "Ten adres wygląda na niepełny." })
  @MaxLength(255)
  guestEmail?: string;

  /** `null` = „jeszcze nie wiem”, tak samo jak w formularzu gościa. */
  @IsOptional()
  @IsEnum(ArrivalDay, { message: "arrivalDay musi być 'saturday', 'sunday' albo null." })
  arrivalDay?: ArrivalDay | null;

  /** Pusty tekst po przycięciu zapisujemy jako NULL, nie jako "". */
  @Transform(({ value }) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  /**
   * Przeniesienie na inny termin. Obie daty albo żadna — serwis odrzuca
   * podanie tylko jednej, bo „nowy początek przy starym końcu” prawie zawsze
   * znaczy pomyłkę, a nie świadomy zakres.
   */
  @IsOptional()
  @Matches(ISO_DATE_PATTERN, { message: "dateStart musi mieć format YYYY-MM-DD." })
  dateStart?: string;

  @IsOptional()
  @Matches(ISO_DATE_PATTERN, { message: "dateEnd musi mieć format YYYY-MM-DD." })
  dateEnd?: string;
}
