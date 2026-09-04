import { Matches } from "class-validator";

import { ISO_DATE_PATTERN } from "../../common/calendar-date.js";

/** Parametry GET /api/visit-slots. Oba wymagane — nie chcemy zapytań bez zakresu. */
export class ListVisitSlotsQueryDto {
  @Matches(ISO_DATE_PATTERN, { message: "from musi mieć format YYYY-MM-DD." })
  from!: string;

  @Matches(ISO_DATE_PATTERN, { message: "to musi mieć format YYYY-MM-DD." })
  to!: string;
}
