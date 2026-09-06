import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { TypedConfigService } from "../config/configuration.js";
import { AdminAuthSecretService } from "./admin-auth-secret.service.js";
import { issueSession, verifySession, type AdminSessionPayload } from "./admin-session.js";
import { verifyPassword } from "./password.js";

/**
 * Logika logowania gospodarzy.
 *
 * Serwis celowo nie wie nic o HTTP: nie buduje ciasteczek, nie zna kodów
 * odpowiedzi, nie dotyka obiektu Response. Dostaje hasło, oddaje token albo
 * null. Dzięki temu da się go przetestować bez udawania Expressa, a decyzja
 * „401 czy 200” zostaje w jednym miejscu — w kontrolerze.
 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);
  private readonly ttlSeconds: number;

  constructor(
    config: ConfigService,
    private readonly secrets: AdminAuthSecretService,
  ) {
    const typed = config as unknown as TypedConfigService;
    this.ttlSeconds = typed.get("ADMIN_SESSION_TTL_SECONDS", { infer: true });
  }

  get sessionTtlSeconds(): number {
    return this.ttlSeconds;
  }

  /**
   * Sprawdza hasło i wydaje sesję. Zwraca null przy niepowodzeniu.
   *
   * Log zawiera wyłącznie wynik. Ani hasła, ani hasha, ani nawet długości
   * hasła — długość też jest informacją, jeśli ktoś czyta logi po włamaniu.
   */
  async login(password: string): Promise<string | null> {
    const secret = await this.secrets.load();

    const matches = await verifyPassword(password, secret.passwordHash);

    if (!matches) {
      this.logger.warn("Odrzucono próbę logowania do panelu gospodarzy.");
      return null;
    }

    this.logger.log("Zalogowano do panelu gospodarzy.");

    return issueSession(secret.sessionSecret, this.ttlSeconds);
  }

  /** Weryfikacja sesji z ciasteczka. null = nieważna, bez rozróżniania powodu. */
  async verify(token: string | undefined): Promise<AdminSessionPayload | null> {
    if (!token) return null;

    const secret = await this.secrets.load();

    return verifySession(token, secret.sessionSecret);
  }
}
