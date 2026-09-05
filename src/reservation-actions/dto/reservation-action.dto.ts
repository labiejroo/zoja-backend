import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

/**
 * Ciało wszystkich trzech tras reservation-actions.
 *
 * Jedno pole i twardy limit długości. Token, który tworzymy, ma 43 znaki
 * (32 bajty w base64url); limit 128 zostawia zapas na ewentualną zmianę
 * kodowania, a jednocześnie odcina próby wysłania kilobajtowego wejścia do
 * funkcji hashującej.
 *
 * Świadomie NIE walidujemy tu wzorca znaków. Token niepasujący do formatu
 * i tak nie znajdzie rezerwacji, a osobny komunikat walidacyjny zdradzałby,
 * jak token wygląda — z odpowiedzi ma płynąć jedna informacja: nie działa.
 */
export class ReservationActionDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  token!: string;
}
