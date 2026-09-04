import { QueryFailedError } from "typeorm";

/** Nazwa częściowego unikalnego indeksu z pierwszej migracji. */
export const ACTIVE_SLOT_CONSTRAINT = "uq_reservations_active_slot";

/** Kod SQLSTATE dla naruszenia unikalności w PostgreSQL. */
const UNIQUE_VIOLATION = "23505";

/**
 * Rozpoznaje naruszenie KONKRETNEGO ograniczenia unikalności.
 *
 * Sprawdzamy nazwę constraintu, a nie sam kod 23505. W schemacie jest więcej
 * niż jeden unikalny indeks (choćby uq_visit_slots_range), więc zamiana każdego
 * 23505 na „termin zajęty” kłamałaby przy zupełnie innym konflikcie.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!(error instanceof QueryFailedError)) return false;

  const driverError = error.driverError as { code?: string; constraint?: string } | undefined;
  return driverError?.code === UNIQUE_VIOLATION && driverError.constraint === constraint;
}
