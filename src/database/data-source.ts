import "reflect-metadata";

import { config as loadDotenv } from "dotenv";
import { DataSource } from "typeorm";

import { validateEnv } from "../config/env.validation.js";
import { buildTypeOrmOptions } from "./typeorm.options.js";

/**
 * DataSource używany poza kontekstem Nesta:
 *   - przez TypeORM CLI (generowanie i uruchamianie migracji lokalnie),
 *   - przez Lambdę migracyjną (migration-lambda.ts).
 *
 * Aplikacja HTTP korzysta z tych samych opcji, ale przez DatabaseModule —
 * wspólnym mianownikiem jest buildTypeOrmOptions().
 */

// Lokalnie wczytuje .env. W Lambdzie pliku nie ma, więc to no-op:
// tam zmienne wstrzykuje sama usługa Lambda.
loadDotenv();

const env = validateEnv(process.env as Record<string, unknown>);

export const AppDataSource = new DataSource(buildTypeOrmOptions(env));

export default AppDataSource;
