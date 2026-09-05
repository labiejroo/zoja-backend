import { plainToInstance, Transform } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  ValidateIf,
  validateSync,
} from "class-validator";

/**
 * Zmienna środowiskowa "false" jest niepustym stringiem, więc zwykła konwersja
 * na boolean dałaby `true`. Porównujemy jawnie.
 */
const toBoolean = ({ value }: { value: unknown }): boolean =>
  value === true || value === "true" || value === "1";

export class EnvironmentVariables {
  @IsIn(["development", "test", "production"])
  NODE_ENV: string = "development";

  @Transform(({ value }) => Number(value ?? 3000))
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @IsNotEmpty()
  DB_HOST!: string;

  @Transform(({ value }) => Number(value ?? 5432))
  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT: number = 5432;

  @IsString()
  @IsNotEmpty()
  DB_NAME!: string;

  @IsString()
  @IsNotEmpty()
  DB_USER!: string;

  @IsString()
  @IsNotEmpty()
  DB_PASSWORD!: string;

  @Transform(toBoolean)
  @IsBoolean()
  DB_SSL: boolean = false;

  /** Maksymalna liczba połączeń NA JEDNO środowisko wykonawcze. Patrz README. */
  @Transform(({ value }) => Number(value ?? 2))
  @IsInt()
  @Min(1)
  @Max(20)
  DB_POOL_MAX: number = 2;

  @Transform(toBoolean)
  @IsBoolean()
  DB_LOGGING: boolean = false;

  /**
   * WYŁĄCZNIK WYSYŁKI MAILI.
   *
   * Domyślnie false i to jest stan docelowy do czasu, aż SES wyjdzie z trybu
   * piaskownicy. Przy false MailDispatcherService nie robi NIC — nie rzuca
   * błędu, nie próbuje wywołać Mail Lambdy, nie opóźnia odpowiedzi. Rezerwacje
   * działają normalnie, tylko bez powiadomień.
   *
   * Flaga jest po to, żeby cały tor mailowy dało się wdrożyć na produkcję
   * martwy, a włączyć jedną zmienną środowiskową — bez ponownego deployu kodu.
   */
  @Transform(toBoolean)
  @IsBoolean()
  EMAIL_ENABLED: boolean = false;

  /**
   * Nazwa funkcji Mail Lambda. Nie zapisujemy jej na sztywno w kodzie, bo
   * nazwa należy do infrastruktury, a ta bywa inna na kolejnych środowiskach.
   *
   * Wymagana TYLKO przy EMAIL_ENABLED=true. Gdyby była wymagana zawsze,
   * uruchomienie API bez maili wymagałoby ustawiania zmiennej, która do niczego
   * nie służy; gdyby nie była wymagana nigdy, włączenie maili kończyłoby się
   * cichym błędem przy pierwszej rezerwacji zamiast głośnym na starcie.
   */
  @ValidateIf((env: EnvironmentVariables) => env.EMAIL_ENABLED)
  @IsString()
  @IsNotEmpty()
  MAIL_LAMBDA_FUNCTION_NAME: string = "";
}

/**
 * Walidacja przy starcie aplikacji — lepiej wywalić się głośno na zimnym starcie
 * niż odpowiadać błędami przy każdym żądaniu.
 *
 * UWAGA: komunikat zawiera wyłącznie NAZWY pól. Wartości nigdy nie trafiają do
 * logów, bo wśród nich jest DB_PASSWORD.
 */
export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    exposeDefaultValues: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const fields = [...new Set(errors.map((error) => error.property))].sort().join(", ");
    throw new Error(
      `Konfiguracja środowiska jest niekompletna lub nieprawidłowa. Sprawdź: ${fields}. ` +
        `Wzór wartości znajdziesz w .env.example.`,
    );
  }

  return validated;
}
