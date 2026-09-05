import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * TOKEN DECYZJI dla linków „Potwierdź” / „Odrzuć” z maila do rodziców.
 *
 * W bazie trzymamy wyłącznie SHA-256 tokenu w zapisie szesnastkowym — stąd
 * dokładnie varchar(64). Sam token jawny nie jest nigdzie zapisywany: powstaje
 * przy tworzeniu rezerwacji, trafia do treści maila i przestaje istnieć po
 * stronie serwera.
 *
 * Obie kolumny są NULL-owalne, bo brak tokenu jest normalnym stanem: wizyta
 * wpisana przez gospodarzy jest od razu potwierdzona, a po podjęciu decyzji
 * token kasujemy.
 */
export class AddDecisionTokenToReservations1788642000000 implements MigrationInterface {
  name = "AddDecisionTokenToReservations1788642000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "reservations"
        ADD COLUMN "decision_token_hash" varchar(64) NULL,
        ADD COLUMN "decision_token_expires_at" timestamptz NULL
    `);

    /**
     * INDEKS CZĘŚCIOWY — i unikalny, i szybki, przy jednym przebiegu.
     *
     * Szukanie rezerwacji po tokenie to jedyny sposób, w jaki ta kolumna jest
     * odpytywana, więc indeks jest tu potrzebny wprost. Unikalność dokłada
     * gwarancję, że jeden hash nigdy nie wskaże dwóch rezerwacji — a to
     * właśnie ta jednoznaczność decyduje, czyją wizytę potwierdza kliknięcie.
     *
     * Warunek WHERE jest konieczny: bez niego NULL-e nie kolidowałyby ze sobą
     * w PostgreSQL, ale indeks niepotrzebnie objąłby wszystkie rezerwacje bez
     * tokenu, czyli z czasem większość tabeli.
     */
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_reservations_decision_token_hash"
        ON "reservations" ("decision_token_hash")
        WHERE "decision_token_hash" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_reservations_decision_token_hash"`);
    await queryRunner.query(`
      ALTER TABLE "reservations"
        DROP COLUMN IF EXISTS "decision_token_expires_at",
        DROP COLUMN IF EXISTS "decision_token_hash"
    `);
  }
}
