import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";

import { AdminAuthService } from "./admin-auth.service.js";
import { readSessionCookie } from "./cookie.js";

/**
 * STRAŻNIK PANELU GOSPODARZY.
 *
 * Do tej pory /api/admin/* było otwarte dla każdego, kto znał adres.
 * Parametr ?zoja nigdy nie był zabezpieczeniem — jest przełącznikiem tego,
 * co widać na ekranie, a każdy może go sobie dopisać. Prawdziwą kontrolą
 * jest ten guard i podpisane ciasteczko, którego JavaScript nie odczyta.
 *
 * Guard NIE PRZEKIEROWUJE. Zwraca 401 z JSON-em, bo po drugiej stronie jest
 * fetch z panelu, a nie nawigacja przeglądarki — odpowiedź 302 na żądanie
 * XHR kończy się tym, że frontend dostaje HTML strony logowania tam, gdzie
 * spodziewał się listy rezerwacji.
 */
@Injectable()
export class AdminSessionGuard implements CanActivate {
  private readonly logger = new Logger(AdminSessionGuard.name);

  constructor(private readonly auth: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      method?: string;
      url?: string;
    }>();

    const header = request.headers.cookie;
    const token = readSessionCookie(typeof header === "string" ? header : undefined);

    const session = await this.auth.verify(token);

    if (!session) {
      // Log bez ciasteczka, bez tokenu i bez treści żądania. Sama informacja,
      // że ktoś próbował — metoda i ścieżka wystarczą do diagnozy.
      this.logger.warn(
        `Odrzucono żądanie bez ważnej sesji: ${request.method ?? "?"} ${request.url ?? "?"}`,
      );

      // Jeden komunikat na wszystkie przypadki: brak ciasteczka, zły podpis,
      // wygasła sesja. Rozróżnianie ich podpowiadałoby, jak blisko był ten,
      // kto próbuje.
      throw new UnauthorizedException("Zaloguj się w trybie gospodarzy.");
    }

    return true;
  }
}
