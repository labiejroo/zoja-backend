import { ConflictException } from "@nestjs/common";
import type { Repository } from "typeorm";

import { isWeekendRange } from "../common/calendar-date.js";
import { VisitSlot } from "./visit-slot.entity.js";

/**
 * TERMINY MATERIALIZUJĄ SIĘ NA ŻĄDANIE.
 *
 * Nie pregenerujemy weekendów — brak wiersza w visit_slots znaczy po prostu
 * „zwykły wolny termin”. Wiersz pojawia się dopiero, gdy termin przestaje być
 * zwyczajny: ktoś go rezerwuje albo gospodarze go blokują.
 *
 * WYŚCIG O UTWORZENIE
 * Dwa równoległe żądania mogą zobaczyć „slotu nie ma” i oba spróbować go
 * utworzyć. Unikalny indeks na (date_start, date_end) i tak przepuści tylko
 * jedno, więc zamiast łapać wyjątek mówimy bazie wprost: przy konflikcie nic
 * nie rób. Po insercie odczytujemy wiersz — nasz albo cudzy, bez znaczenia.
 *
 * Świadomie NIE repository.upsert(): generuje ON CONFLICT DO UPDATE, co
 * nadpisałoby is_blocked ustawione wcześniej przez gospodarzy.
 *
 * Funkcja, a nie metoda serwisu, bo korzystają z niej dwa moduły: publiczne
 * tworzenie rezerwacji i przenoszenie rezerwacji przez panel gospodarzy.
 */
export async function findOrCreateSlot(
  slots: Repository<VisitSlot>,
  dateStart: string,
  dateEnd: string,
): Promise<VisitSlot> {
  const existing = await slots.findOne({ where: { dateStart, dateEnd } });
  if (existing) return existing;

  await slots
    .createQueryBuilder()
    .insert()
    .into(VisitSlot)
    .values({
      dateStart,
      dateEnd,
      // Liczone serwerowo — klient nie decyduje, czy termin jest weekendem.
      isWeekend: isWeekendRange(dateStart, dateEnd),
      isBlocked: false,
      blockedReason: null,
    })
    .orIgnore()
    .execute();

  const slot = await slots.findOne({ where: { dateStart, dateEnd } });
  if (!slot) {
    // Nie powinno się zdarzyć: albo wstawiliśmy my, albo ktoś równolegle.
    throw new ConflictException("Nie udało się przygotować tego terminu. Spróbuj ponownie.");
  }
  return slot;
}
