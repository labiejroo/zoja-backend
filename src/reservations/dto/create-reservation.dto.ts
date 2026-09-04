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
import { ArrivalDay } from "../reservation.enums.js";

/** Przycina string, resztę przepuszcza bez zmian (walidator zgłosi zły typ). */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

/**
 * Ciało POST /api/reservations.
 *
 * Pola odwzorowują DOKŁADNIE formularz na frontendzie (BookingModal) — nic
 * ponad to. Globalny ValidationPipe działa z `whitelist` i `forbidNonWhitelisted`,
 * więc każde pole spoza tej listy kończy się odrzuceniem żądania, a nie cichym
 * pominięciem.
 *
 * Normalizacja siedzi w @Transform, czyli PRZED walidacją. Dzięki temu limity
 * długości liczą się od wartości, która faktycznie trafi do bazy, a nie od
 * tekstu z przypadkowymi spacjami na końcu.
 */
export class CreateReservationDto {
  @Matches(ISO_DATE_PATTERN, { message: "dateStart musi mieć format YYYY-MM-DD." })
  dateStart!: string;

  @Matches(ISO_DATE_PATTERN, { message: "dateEnd musi mieć format YYYY-MM-DD." })
  dateEnd!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: "Napiszcie, kto przyjedzie." })
  @MaxLength(80)
  guestName!: string;

  /**
   * Lowercase już tutaj: adres jest w praktyce identyfikatorem gościa, a
   * „Krysia@…” i „krysia@…” to ta sama skrzynka. Normalizacja przy zapisie
   * oszczędza duplikatów przy późniejszym wyszukiwaniu i wysyłce maili.
   */
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: "Ten adres wygląda na niepełny." })
  @MaxLength(255)
  guestEmail!: string;

  /**
   * `null` znaczy „jeszcze nie wiem” i jest w pełni poprawną odpowiedzią.
   * @IsOptional() przepuszcza zarówno brak pola, jak i jawny null.
   */
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

  /** Brak pola = false. Wartość domyślną ustala serwis, patrz komentarz tam. */
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;

  /**
   * Token Cloudflare Turnstile z formularza. Przyjmujemy go, żeby żądanie nie
   * odbiło się o `forbidNonWhitelisted`, ale NIE zapisujemy go w bazie i nie
   * logujemy — to poświadczenie jednorazowe.
   *
   * TODO: verify Turnstile token server-side before public production launch.
   */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  turnstileToken?: string;
}
