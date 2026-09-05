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

const trimToNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Wizyta zakładana wprost przez gospodarzy — na przykład umówiona przez
 * telefon.
 *
 * ZAKRES PÓL WYNIKA Z FORMULARZA, nie z wyobraźni. AdminCreateForm zbiera
 * dziś zakres dat, kto przyjeżdża, e-mail i notatkę wewnętrzną; te pola są
 * wymagane albo opcjonalne dokładnie tak, jak tam. `arrivalDay` i `isPrivate`
 * są opcjonalne, bo formularz ich nie pokazuje, a rozsądne wartości domyślne
 * (nie wiadomo / nie ukrywaj) da się później zmienić PATCH-em.
 *
 * `status` NIE jest przyjmowany. Wizyta założona przez rodziców jest z
 * definicji potwierdzona — nie ma tu prośby, na którą ktoś miałby odpowiedzieć.
 * `notes` też nie: to wiadomość gościa, a tej przy wpisie ręcznym nie ma.
 */
export class CreateAdminReservationDto {
  @Matches(ISO_DATE_PATTERN, { message: "dateStart musi mieć format YYYY-MM-DD." })
  dateStart!: string;

  @Matches(ISO_DATE_PATTERN, { message: "dateEnd musi mieć format YYYY-MM-DD." })
  dateEnd!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: "Napiszcie, kto przyjedzie." })
  @MaxLength(80)
  guestName!: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: "Ten adres wygląda na niepełny." })
  @MaxLength(255)
  guestEmail!: string;

  /** NULL = „jeszcze nie wiadomo”, tak samo jak przy rezerwacji gościa. */
  @IsOptional()
  @IsEnum(ArrivalDay, { message: "arrivalDay musi być 'saturday', 'sunday' albo null." })
  arrivalDay?: ArrivalDay | null;

  /** Prywatna notatka rodziców — w formularzu pole „notatka wewnętrzna”. */
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminNote?: string | null;

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;
}
