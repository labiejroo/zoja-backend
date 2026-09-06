import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";

import { AdminAuthService } from "./admin-auth.service.js";
import { buildClearedSessionCookie, buildSessionCookie, readSessionCookie } from "./cookie.js";
import { LoginDto } from "./dto/login.dto.js";

/** Minimalny kształt obiektów Expressa, jakiego potrzebuje ten kontroler. */
interface CookieRequest {
  headers: Record<string, string | string[] | undefined>;
}

interface CookieResponse {
  setHeader(name: string, value: string): void;
}

export interface AuthStateResponse {
  authenticated: boolean;
}

/**
 * Logowanie gospodarzy. Pełna ścieżka: /api/admin/auth/...
 *
 * TE TRZY TRASY SĄ CELOWO POZA AdminSessionGuard.
 * Gdyby guard obejmował także je, nie dałoby się zalogować bez sesji, którą
 * dopiero logowanie tworzy. Reszta /api/admin/* jest chroniona — patrz
 * AdminModule.
 *
 * Trasy przechodzą przez istniejące ANY /api/{proxy+} w API Gateway; nowych
 * tras w bramie nie potrzeba.
 */
@Controller("admin/auth")
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  /**
   * ODPOWIEDŹ NIE ZAWIERA TOKENU SESJI.
   *
   * Token wychodzi wyłącznie w nagłówku Set-Cookie, jako HttpOnly. Zwrócenie
   * go dodatkowo w JSON-ie oddałoby go JavaScriptowi strony i przekreśliło
   * cały sens flagi HttpOnly — wystarczyłby jeden udany XSS, żeby sesję
   * wynieść. Frontend nie musi znać wartości: przeglądarka dołączy ciasteczko
   * sama.
   */
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: CookieResponse) {
    const token = await this.auth.login(dto.password);

    if (!token) {
      // Jeden komunikat, bez podpowiedzi. Nie mówimy „złe hasło” ani niczego,
      // z czego wynikałoby, że reszta konfiguracji jest w porządku.
      // Ciasteczka NIE ustawiamy.
      throw new UnauthorizedException("Nie udało się zalogować.");
    }

    res.setHeader(
      "Set-Cookie",
      buildSessionCookie(token, { maxAgeSeconds: this.auth.sessionTtlSeconds }),
    );

    return { authenticated: true } satisfies AuthStateResponse;
  }

  /**
   * Ciche sprawdzenie sesji dla frontendu.
   *
   * ZAWSZE 200, nigdy 401 — także przy braku, wygaśnięciu i złym podpisie.
   * Ten endpoint odpowiada na pytanie „czy jestem zalogowany?”, a odpowiedź
   * „nie” jest normalnym wynikiem, nie błędem. Gdyby zwracał 401, każde wejście
   * na stronę gościa zostawiałoby w konsoli czerwony błąd, a frontend musiałby
   * odróżniać „nie zalogowany” od „coś padło”.
   */
  @Get("session")
  @HttpCode(HttpStatus.OK)
  async session(@Req() req: CookieRequest): Promise<AuthStateResponse> {
    const header = req.headers.cookie;
    const token = readSessionCookie(typeof header === "string" ? header : undefined);

    return { authenticated: (await this.auth.verify(token)) !== null };
  }

  /**
   * Wylogowanie — IDEMPOTENTNE.
   *
   * Działa także bez sesji i zawsze kończy się tak samo. Wylogowanie kogoś,
   * kto już jest wylogowany, nie jest błędem, a 401 w tym miejscu zostawiałby
   * użytkownika w stanie, z którego nie da się wyjść inaczej niż czyszczeniem
   * ciasteczek w przeglądarce.
   *
   * Kasujemy przez nadpisanie pustą wartością z Max-Age=0 i tymi samymi
   * atrybutami Path/Secure/SameSite — inaczej przeglądarka uzna to za inne
   * ciasteczko i oryginalna sesja przeżyje.
   */
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: CookieResponse): AuthStateResponse {
    res.setHeader("Set-Cookie", buildClearedSessionCookie());

    return { authenticated: false };
  }
}
