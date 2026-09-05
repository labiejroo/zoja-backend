import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * PRYWATNA NOTATKA GOSPODARZY przy rezerwacji.
 *
 * Osobna migracja, bo poprzednia została już wykonana na produkcyjnym RDS —
 * dopisanie kolumny do zastosowanej migracji nie zmieniłoby niczego w bazie,
 * a rozjechałoby kod z rzeczywistym schematem.
 *
 * Kolumna jest NULL-owalna i bez wartości domyślnej: brak notatki to NULL,
 * nie pusty string. Pusty string udawałby, że ktoś coś napisał.
 */
export class AddAdminNoteToReservations1788555600000 implements MigrationInterface {
  name = "AddAdminNoteToReservations1788555600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "reservations"
        ADD COLUMN "admin_note" text NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "reservations"
        DROP COLUMN "admin_note"
    `);
  }
}
