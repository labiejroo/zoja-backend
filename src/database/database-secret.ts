import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

let client: SecretsManagerClient | undefined;

/**
 * Zapewnia dostępność DB_PASSWORD przed uruchomieniem konfiguracji Nesta/TypeORM.
 *
 * Tryb przejściowy:
 * - jeśli DB_PASSWORD już istnieje w env, niczego nie pobieramy;
 * - jeśli go nie ma, pobieramy sekret z AWS Secrets Manager.
 *
 * Dzięki temu możemy wdrożyć kod wcześniej niż sam Secrets Manager
 * i bezpiecznie migrować produkcję etapami.
 */
export async function ensureDatabasePassword(): Promise<void> {
  if (process.env.DB_PASSWORD) {
    return;
  }

  const secretId = process.env.DB_SECRET_ID;

  if (!secretId) {
    throw new Error(
      "Brak konfiguracji hasła bazy. Ustaw DB_PASSWORD lub DB_SECRET_ID.",
    );
  }

  client ??= new SecretsManagerClient({});

  const response = await client.send(
    new GetSecretValueCommand({
      SecretId: secretId,
    }),
  );

  if (!response.SecretString) {
    throw new Error("Sekret bazy nie zawiera SecretString.");
  }

  let secret: unknown;

  try {
    secret = JSON.parse(response.SecretString);
  } catch {
    throw new Error("Sekret bazy ma nieprawidłowy format JSON.");
  }

  if (
    typeof secret !== "object" ||
    secret === null ||
    !("password" in secret) ||
    typeof secret.password !== "string" ||
    secret.password.length === 0
  ) {
    throw new Error("Sekret bazy nie zawiera prawidłowego pola password.");
  }

  process.env.DB_PASSWORD = secret.password;
}