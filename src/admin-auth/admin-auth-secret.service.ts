import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { TypedConfigService } from "../config/configuration.js";

/**
 * Zawartość sekretu zoja/admin-auth.
 *
 * OSOBNY SEKRET OD zoja/database — świadomie. Wrzucenie obu do jednego
 * dokumentu byłoby wygodne i dokładnie dlatego złe: uprawnienie do odczytu
 * jest nadawane na ARN sekretu, więc wszystko w środku dzieli jedną politykę.
 * Kod, który potrzebuje hasła do bazy, dostawałby przy okazji hasło gospodarzy.
 *
 * passwordHash — format scrypt-v1$<sól>$<hash>, patrz password.ts.
 *                Hasła jawnego nie ma tu nigdy.
 * sessionSecret — klucz HMAC do podpisywania sesji, minimum 256 bitów.
 */
export interface AdminAuthSecret {
  passwordHash: string;
  sessionSecret: string;
}

/**
 * Minimalny kształt klienta, jakiego potrzebuje ten serwis. Zawężenie do jednej
 * metody pozwala testowi podstawić zwykły obiekt zamiast udawać cały
 * SecretsManagerClient z SDK.
 */
export interface SecretReader {
  send(command: GetSecretValueCommand): Promise<{ SecretString?: string }>;
}

export const ADMIN_SECRET_READER = Symbol("ADMIN_SECRET_READER");

/** Jak długo trzymamy sekret w pamięci środowiska wykonawczego. */
export const SECRET_CACHE_TTL_MS = 5 * 60 * 1000;

/** Minimalna długość klucza HMAC — 32 bajty w base64url to 43 znaki. */
const MIN_SESSION_SECRET_LENGTH = 32;

@Injectable()
export class AdminAuthSecretService {
  private readonly logger = new Logger(AdminAuthSecretService.name);
  private readonly secretId: string;

  /**
   * CACHE W PAMIĘCI ŚRODOWISKA WYKONAWCZEGO.
   *
   * Bez niego każde żądanie do panelu oznaczałoby wywołanie Secrets Managera:
   * dodatkowe 20-50 ms opóźnienia, wpis w CloudTrailu i pozycja na rachunku
   * przy każdym kliknięciu w liście rezerwacji.
   *
   * TTL zamiast cache na zawsze, bo „na zawsze” znaczy tu „do następnego
   * zimnego startu” — a to jest czas nieprzewidywalny. Po zmianie hasła
   * chcemy wiedzieć, kiedy najpóźniej zacznie obowiązywać: pięć minut.
   */
  private cached: { value: AdminAuthSecret; expiresAt: number } | undefined;

  constructor(
    // ConfigService jako typ RUNTIME. TypedConfigService jest aliasem typu
    // i nie zostawia po sobie tokenu DI — patrz MailDispatcherService.
    config: ConfigService,
    @Inject(ADMIN_SECRET_READER) private readonly secrets: SecretReader,
  ) {
    const typed = config as unknown as TypedConfigService;
    this.secretId = typed.get("ADMIN_AUTH_SECRET_ID", { infer: true });
  }

  /** Wymusza ponowne pobranie przy następnym użyciu. Używane w testach. */
  invalidate(): void {
    this.cached = undefined;
  }

  async load(now: number = Date.now()): Promise<AdminAuthSecret> {
    if (this.cached && this.cached.expiresAt > now) {
      return this.cached.value;
    }

    const response = await this.secrets.send(
      new GetSecretValueCommand({ SecretId: this.secretId }),
    );

    if (!response.SecretString) {
      throw new Error("Sekret logowania nie zawiera SecretString.");
    }

    const value = parseAdminAuthSecret(response.SecretString);

    this.cached = { value, expiresAt: now + SECRET_CACHE_TTL_MS };

    // Sam fakt odświeżenia. NIGDY zawartości: ani hasha, ani klucza sesji.
    this.logger.log("Odświeżono sekret logowania gospodarzy.");

    return value;
  }
}

/**
 * Walidacja kształtu sekretu.
 *
 * Komunikaty mówią WYŁĄCZNIE o brakującym polu. Nigdy o wartości — ten tekst
 * trafia do CloudWatch, a przy pomyłce w formacie łatwo byłoby wypisać tam
 * połowę klucza HMAC.
 */
export function parseAdminAuthSecret(raw: string): AdminAuthSecret {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Sekret logowania ma nieprawidłowy format JSON.");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Sekret logowania nie jest obiektem.");
  }

  const candidate = parsed as Record<string, unknown>;

  if (typeof candidate.passwordHash !== "string" || candidate.passwordHash.length === 0) {
    throw new Error("Sekret logowania nie zawiera pola passwordHash.");
  }

  if (typeof candidate.sessionSecret !== "string") {
    throw new Error("Sekret logowania nie zawiera pola sessionSecret.");
  }

  // Zbyt krótki klucz HMAC jest gorszy od braku klucza: wygląda na działający,
  // a podpis daje się złamać. Lepiej wywalić się głośno przy pierwszym logowaniu.
  if (candidate.sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error("Sekret logowania ma za krótkie pole sessionSecret.");
  }

  if (!candidate.passwordHash.startsWith("scrypt-v1$")) {
    throw new Error("Sekret logowania ma passwordHash w nieobsługiwanym formacie.");
  }

  return {
    passwordHash: candidate.passwordHash,
    sessionSecret: candidate.sessionSecret,
  };
}

/** Klient tworzony raz na środowisko wykonawcze, tak jak pula połączeń. */
export function createSecretReader(): SecretReader {
  return new SecretsManagerClient({});
}
