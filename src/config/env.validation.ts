import { plainToInstance, Transform } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsString, Max, Min, validateSync } from "class-validator";

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
