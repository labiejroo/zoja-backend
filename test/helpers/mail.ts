import { vi } from "vitest";

import type { MailDispatcherService, MailDispatchOutcome } from "../../src/mail/mail-dispatcher.service.js";
import type { MailEvent } from "../../src/mail/mail-events.js";

/**
 * Podstawka pod MailDispatcherService.
 *
 * Zbiera zdarzenia zamiast je wysyłać, więc test może sprawdzić nie tylko
 * „czy wysłano”, ale też CO — a to właśnie tam mieszczą się błędy, które
 * naprawdę bolą: mail na stary adres albo token w payloadzie, który nie
 * powinien go zawierać.
 */
export function mailSpy(outcome: MailDispatchOutcome = "sent") {
  const events: MailEvent[] = [];

  const dispatch = vi.fn(async (event: MailEvent): Promise<MailDispatchOutcome> => {
    events.push(event);
    return outcome;
  });

  return {
    events,
    dispatch,
    /** Rzutowanie zamiast pełnej instancji — serwisy używają wyłącznie dispatch. */
    service: { dispatch } as unknown as MailDispatcherService,
    typesSent: () => events.map((event) => event.type),
  };
}
