import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * PIERWSZA MIGRACJA — podstawowy model wizyt.
 *
 * Tworzy dwie tabele i dwa typy wyliczeniowe:
 *
 *   visit_slots   — terminy wystawione przez gospodarzy
 *   reservations  — prośby gości o konkretny termin
 *
 * SQL piszemy tu ręcznie, zamiast polegać na generatorze TypeORM. Powód jest
 * konkretny: kluczowa reguła tej migracji — częściowy unikalny indeks — jest
 * konstrukcją PostgreSQL, którą chcemy widzieć dokładnie w tej formie, w jakiej
 * trafi do bazy. To ona, a nie kod aplikacji, gwarantuje brak podwójnych
 * rezerwacji.
 *
 * gen_random_uuid() jest wbudowane od PostgreSQL 13; RDS w tym projekcie stoi
 * na 18.x, więc nie potrzebujemy rozszerzenia pgcrypto.
 */
export class CreateVisitSlotsAndReservations1788517800000 implements MigrationInterface {
  name = "CreateVisitSlotsAndReservations1788517800000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "reservation_status" AS ENUM (
        'PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "arrival_day" AS ENUM ('saturday', 'sunday')
    `);

    await queryRunner.query(`
      CREATE TABLE "visit_slots" (
        "id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        "date_start"     date        NOT NULL,
        "date_end"       date        NOT NULL,
        "is_weekend"     boolean     NOT NULL DEFAULT true,
        "is_blocked"     boolean     NOT NULL DEFAULT false,
        "blocked_reason" text,
        "created_at"     timestamptz NOT NULL DEFAULT now(),
        "updated_at"     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_visit_slots_range" CHECK ("date_end" >= "date_start")
      )
    `);

    // Dwa terminy o tym samym zakresie byłyby nie do rozróżnienia dla gościa.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_visit_slots_range"
        ON "visit_slots" ("date_start", "date_end")
    `);

    await queryRunner.query(`
      CREATE TABLE "reservations" (
        "id"          uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
        "slot_id"     uuid                NOT NULL,
        "status"      "reservation_status" NOT NULL DEFAULT 'PENDING',
        "guest_name"  varchar(80)         NOT NULL,
        "guest_email" varchar(255)        NOT NULL,
        "arrival_day" "arrival_day",
        "notes"       text,
        "is_private"  boolean             NOT NULL DEFAULT false,
        "created_at"  timestamptz         NOT NULL DEFAULT now(),
        "updated_at"  timestamptz         NOT NULL DEFAULT now(),
        CONSTRAINT "fk_reservations_slot" FOREIGN KEY ("slot_id")
          REFERENCES "visit_slots" ("id")
          ON DELETE RESTRICT
          ON UPDATE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_reservations_slot" ON "reservations" ("slot_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_reservations_status" ON "reservations" ("status")
    `);

    /**
     * SEDNO TEJ MIGRACJI.
     *
     * Najwyżej jedna AKTYWNA rezerwacja na termin. Warunek WHERE zawęża
     * unikalność do statusów, które faktycznie blokują termin, więc historia
     * (REJECTED, CANCELLED) może zawierać dowolnie wiele wierszy dla tego
     * samego slotu.
     *
     * Lista statusów tutaj musi pozostać zgodna z ACTIVE_RESERVATION_STATUSES
     * w src/reservations/reservation.enums.ts.
     */
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_reservations_active_slot"
        ON "reservations" ("slot_id")
        WHERE "status" IN ('PENDING', 'CONFIRMED')
    `);
  }

  /**
   * Odwracamy dokładnie w odwrotnej kolejności: najpierw indeksy, potem tabela
   * zależna, potem tabela nadrzędna, na końcu typy. Typy enum trzeba skasować
   * jawnie — DROP TABLE ich nie zabiera i przy ponownym `up()` migracja
   * wywaliłaby się na „type already exists”.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_reservations_active_slot"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_reservations_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_reservations_slot"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "reservations"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "uq_visit_slots_range"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "visit_slots"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "arrival_day"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "reservation_status"`);
  }
}
