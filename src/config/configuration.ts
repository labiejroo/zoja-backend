import { type ConfigService } from "@nestjs/config";

import type { DatabaseEnv } from "../database/typeorm.options.js";
import type { EnvironmentVariables } from "./env.validation.js";

export type TypedConfigService = ConfigService<EnvironmentVariables, true>;

/**
 * Wyciąga z ConfigService dokładnie te pola, których potrzebuje warstwa bazy.
 * Dzięki temu `buildTypeOrmOptions` nie musi nic wiedzieć o Nescie i da się
 * jej użyć także ze skryptu CLI.
 */
export function readDatabaseEnv(config: TypedConfigService): DatabaseEnv {
  return {
    DB_HOST: config.get("DB_HOST", { infer: true }),
    DB_PORT: config.get("DB_PORT", { infer: true }),
    DB_NAME: config.get("DB_NAME", { infer: true }),
    DB_USER: config.get("DB_USER", { infer: true }),
    DB_PASSWORD: config.get("DB_PASSWORD", { infer: true }),
    DB_SSL: config.get("DB_SSL", { infer: true }),
    DB_POOL_MAX: config.get("DB_POOL_MAX", { infer: true }),
    DB_LOGGING: config.get("DB_LOGGING", { infer: true }),
  };
}
