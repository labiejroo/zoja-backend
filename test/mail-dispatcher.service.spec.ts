import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MailDispatcherService } from "../src/mail/mail-dispatcher.service.js";
import { MailEventType, type MailEvent } from "../src/mail/mail-events.js";

const RAW_TOKEN = "TAJNY-TOKEN-Z-MAILA-ktorego-nie-wolno-logowac";

const parentEvent: MailEvent = {
  type: MailEventType.RESERVATION_REQUESTED_PARENT,
  reservationId: "res-1",
  guestName: "Babcia Krysia",
  guestEmail: "krysia@example.com",
  dateStart: "2031-01-04",
  dateEnd: "2031-01-05",
  arrivalDay: "saturday",
  notes: "Przyjedziemy autem.",
  isPrivate: false,
  decisionToken: RAW_TOKEN,
};

function setup(options: {
  enabled?: boolean;
  send?: () => unknown;
} = {}) {
  const config = {
    get: (key: string) =>
      key === "EMAIL_ENABLED" ? (options.enabled ?? true) : "zoja-mail-lambda",
  };

  const send = vi.fn(async (_command: unknown): Promise<unknown> =>
    options.send ? options.send() : { StatusCode: 200 },
  );
  const service = new MailDispatcherService(config as never, { send } as never);

  return { service, send };
}

/** Przechwytuje wszystko, co serwis zapisuje w logu — niezależnie od poziomu. */
function captureLogs() {
  const lines: string[] = [];
  const record = (message: unknown) => {
    lines.push(String(message));
  };

  const spies = [
    vi.spyOn(Logger.prototype, "log").mockImplementation(record),
    vi.spyOn(Logger.prototype, "error").mockImplementation(record),
    vi.spyOn(Logger.prototype, "warn").mockImplementation(record),
  ];

  return { lines, restore: () => spies.forEach((spy) => spy.mockRestore()) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MailDispatcherService — feature flag", () => {
  it("przy EMAIL_ENABLED=false nie wywołuje Mail Lambdy", async () => {
    const { service, send } = setup({ enabled: false });

    const outcome = await service.dispatch(parentEvent);

    expect(outcome).toBe("disabled");
    expect(send).not.toHaveBeenCalled();
  });

  it("przy EMAIL_ENABLED=false nie rzuca — rezerwacja ma działać dalej", async () => {
    const { service } = setup({ enabled: false });

    await expect(service.dispatch(parentEvent)).resolves.toBe("disabled");
  });

  it("przy EMAIL_ENABLED=true wywołuje Mail Lambdę", async () => {
    const { service, send } = setup({ enabled: true });

    const outcome = await service.dispatch(parentEvent);

    expect(outcome).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("MailDispatcherService — wywołanie Lambdy", () => {
  it("wysyła nazwę funkcji z konfiguracji, nie zaszytą w kodzie", async () => {
    const { service, send } = setup();

    await service.dispatch(parentEvent);

    const command = send.mock.calls[0][0] as unknown as { input: Record<string, unknown> };
    expect(command.input.FunctionName).toBe("zoja-mail-lambda");
  });

  it("wywołuje synchronicznie, żeby poznać wynik wysyłki", async () => {
    const { service, send } = setup();

    await service.dispatch(parentEvent);

    const command = send.mock.calls[0][0] as unknown as { input: Record<string, unknown> };
    expect(command.input.InvocationType).toBe("RequestResponse");
  });

  it("przekazuje kompletny event jako payload", async () => {
    const { service, send } = setup();

    await service.dispatch(parentEvent);

    const command = send.mock.calls[0][0] as unknown as { input: { Payload: Uint8Array } };
    const payload = JSON.parse(Buffer.from(command.input.Payload).toString("utf8"));

    expect(payload).toEqual(parentEvent);
    // Token MUSI dotrzeć do Mail Lambdy — to jedyna droga, którą trafia do maila.
    expect(payload.decisionToken).toBe(RAW_TOKEN);
  });
});

describe("MailDispatcherService — błędy nie cofają rezerwacji", () => {
  it("wyjątek z SDK kończy się wynikiem failed, a nie rzuceniem", async () => {
    const { service } = setup({
      send: () => {
        throw new Error("ETIMEDOUT: brak trasy do endpointu Lambda");
      },
    });

    await expect(service.dispatch(parentEvent)).resolves.toBe("failed");
  });

  it("odrzucona obietnica też nie wychodzi na zewnątrz", async () => {
    const { service } = setup({ send: () => Promise.reject(new Error("AccessDenied")) });

    await expect(service.dispatch(parentEvent)).resolves.toBe("failed");
  });

  it("rozpoznaje FunctionError — 200 z błędem w środku to nie sukces", async () => {
    const { service } = setup({
      send: async () => ({ StatusCode: 200, FunctionError: "Unhandled" }),
    });

    // Bez tego sprawdzenia uznalibyśmy za wysłany każdy mail, który wysypał się
    // po drugiej stronie: SDK zwraca wtedy 200, bo samo WYWOŁANIE się udało.
    await expect(service.dispatch(parentEvent)).resolves.toBe("failed");
  });
});

describe("MailDispatcherService — co trafia do logów", () => {
  it("nie loguje tokenu przy powodzeniu", async () => {
    const logs = captureLogs();
    const { service } = setup();

    await service.dispatch(parentEvent);
    logs.restore();

    expect(logs.lines.join("\n")).not.toContain(RAW_TOKEN);
  });

  it("nie loguje tokenu ani adresu przy błędzie", async () => {
    const logs = captureLogs();
    const { service } = setup({
      send: () => {
        // Komunikat błędu z prawdziwego świata potrafi nieść payload.
        throw new Error(`Invoke failed for payload ${JSON.stringify(parentEvent)}`);
      },
    });

    await service.dispatch(parentEvent);
    logs.restore();

    const written = logs.lines.join("\n");
    expect(written).toContain("res-1");
    expect(written).toContain("RESERVATION_REQUESTED_PARENT");
    expect(written).not.toContain("krysia@example.com");
    expect(written).not.toContain("Babcia Krysia");
    expect(written).not.toContain(RAW_TOKEN);
  });

  it("nie loguje tokenu przy wyłączonych mailach", async () => {
    const logs = captureLogs();
    const { service } = setup({ enabled: false });

    await service.dispatch(parentEvent);
    logs.restore();

    const written = logs.lines.join("\n");
    expect(written).toContain("RESERVATION_REQUESTED_PARENT");
    expect(written).not.toContain(RAW_TOKEN);
    expect(written).not.toContain("krysia@example.com");
  });
});
