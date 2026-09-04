import { BadRequestException } from "@nestjs/common";

import { daysBetween } from "./calendar-date.js";

/**
 * Górny limit zakresu zapytania. Kalendarz gościa obejmuje najwyżej rok, a bez
 * limitu jedno żądanie mogłoby ściągnąć całą historię terminów.
 */
export const MAX_RANGE_DAYS = 366;

/**
 * Wspólna walidacja zakresu dla publicznego i administracyjnego odczytu.
 *
 * Trzymana osobno, żeby oba endpointy nie rozjechały się w limitach — inaczej
 * łatwo o sytuację, w której panel gospodarzy przepuszcza zapytanie, którego
 * strona gościa nie przepuszcza, albo odwrotnie.
 */
export function assertDateRange(from: string, to: string): void {
  if (to < from) {
    throw new BadRequestException("Parametr 'to' nie może być wcześniejszy niż 'from'.");
  }

  if (daysBetween(from, to) > MAX_RANGE_DAYS) {
    throw new BadRequestException(`Zakres nie może przekraczać ${MAX_RANGE_DAYS} dni.`);
  }
}
