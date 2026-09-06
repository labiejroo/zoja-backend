import { IsNotEmpty, IsString, MaxLength } from "class-validator";

/**
 * Ciało POST /api/admin/auth/login.
 *
 * ŚWIADOMIE BEZ @Transform(trim).
 *
 * Wszystkie pozostałe DTO w tym projekcie przycinają białe znaki, bo tam
 * pomyłka użytkownika jest kosztowniejsza niż dosłowność. Tutaj jest
 * odwrotnie: spacja na końcu MOŻE być częścią hasła, a ciche jej obcięcie
 * sprawiłoby, że poprawne hasło z menedżera haseł przestaje działać bez
 * żadnego komunikatu.
 *
 * Limit 256 znaków odcina próby wysłania kilobajtowego wejścia do funkcji
 * KDF — scrypt jest z założenia kosztowny, więc długie wejście jest tanim
 * sposobem na obciążenie Lambdy.
 */
export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password!: string;
}
