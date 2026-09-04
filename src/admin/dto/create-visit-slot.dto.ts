import { Transform } from "class-transformer";
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from "class-validator";

import { ISO_DATE_PATTERN } from "../../common/calendar-date.js";

/**
 * Ręczne wystawienie terminu przez gospodarzy — także takiego, którego gość
 * nigdy by nie wybrał: Wigilia, długi weekend, dzień roboczy.
 *
 * `isWeekend` celowo NIE jest przyjmowane z żądania. Wpływa na to, jak termin
 * jest prezentowany, więc liczymy je serwerowo z zakresu dat.
 */
export class CreateVisitSlotDto {
  @Matches(ISO_DATE_PATTERN, { message: "dateStart musi mieć format YYYY-MM-DD." })
  dateStart!: string;

  @Matches(ISO_DATE_PATTERN, { message: "dateEnd musi mieć format YYYY-MM-DD." })
  dateEnd!: string;

  /** Brak pola = termin wolny. Wartość domyślną ustala serwis. */
  @IsOptional()
  @IsBoolean()
  isBlocked?: boolean;

  @Transform(({ value }) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  blockedReason?: string | null;
}
