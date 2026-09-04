import { Transform } from "class-transformer";
import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Edycja terminu ogranicza się do blokady.
 *
 * DAT NIE DA SIĘ TU ZMIENIĆ — świadomie. Zakres dat jest tożsamością terminu;
 * przesunięcie go przepisałoby historię rezerwacji, które już się do niego
 * odwołują. Gość dostałby potwierdzenie na jeden weekend, a w bazie widniałby
 * inny. Zmiana terminu rezerwacji odbywa się przez PATCH samej rezerwacji,
 * która wtedy przenosi się do innego slotu.
 */
export class UpdateVisitSlotDto {
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
