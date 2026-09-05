/**
 * OPIS BŁĘDU BEZPIECZNY DO ZAPISANIA W LOGU.
 *
 * Kuszące jest zalogowanie `error.message` — i długo wydawało się nieszkodliwe.
 * Nie jest. Komunikaty błędów niosą kontekst żądania, a akurat w naszym
 * przypadku niosą go dosłownie: SES w trybie piaskownicy odmawia wysyłki
 * zdaniem „The following identities failed the check ... " zakończonym ADRESEM
 * ODBIORCY. Zapisanie takiego komunikatu wprost oznacza adres gościa
 * w CloudWatch Logs przy każdej nieudanej próbie.
 *
 * Nazwa klasy błędu takiego problemu nie ma. `AccessDeniedException`,
 * `MessageRejected`, `TimeoutError`, `ResourceNotFoundException` — to
 * identyfikatory typu, nie treść, a przy diagnozie niosą i tak najwięcej.
 * Kod HTTP z metadanych SDK dokłada resztę potrzebnego kontekstu.
 */

/** Kształt, jaki błędy AWS SDK v3 mają poza samym Error. */
interface AwsSdkError {
  $metadata?: { httpStatusCode?: number };
}

export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "nieznany błąd";

  const status = (error as unknown as AwsSdkError).$metadata?.httpStatusCode;

  return status ? `${error.name} (HTTP ${status})` : error.name;
}
