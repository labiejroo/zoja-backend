import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import { Reservation } from "../reservations/reservation.entity.js";

/**
 * TERMIN — opcja przyjazdu, którą gospodarze wystawiają gościom.
 *
 * DLACZEGO TO OSOBNA ENCJA
 * Termin istnieje NIEZALEŻNIE od tego, czy ktoś o niego poprosił. To rozłączenie
 * jest sednem modelu: gdyby wszystko siedziało w jednej tabeli, „wolny weekend”
 * musiałby być reprezentowany przez brak wiersza, a wtedy nie da się ani
 * zablokować terminu, ani zachować historii odrzuconych próśb, ani odróżnić
 * terminu nieistniejącego od wolnego.
 *
 *   termin istnieje + nie jest zablokowany + brak aktywnej rezerwacji
 *   = termin wolny
 *
 * ZAKRES DAT
 * Odwzorowuje to, co frontend już robi: weekend to sobota (`dateStart`) plus
 * niedziela (`dateEnd`), a gospodarze mogą wystawić termin o dowolnym zakresie
 * (Wigilia, długi weekend, dzień roboczy) — wtedy `isWeekend` jest false.
 */
@Entity({ name: "visit_slots" })
// Dwa terminy o identycznym zakresie dat byłyby nie do rozróżnienia dla gościa
// i rozdwoiłyby regułę zajętości. Baza tego nie dopuszcza.
@Index("uq_visit_slots_range", ["dateStart", "dateEnd"], { unique: true })
export class VisitSlot {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /**
   * Typ `date`, nie `timestamptz` — termin to doba, nie moment. TypeORM mapuje
   * `date` na string "YYYY-MM-DD", czyli dokładnie ten kształt, którym operuje
   * już frontend. Brak strefy czasowej jest tu zaletą: sobota jest sobotą
   * niezależnie od tego, skąd gość otwiera stronę.
   */
  @Column({ name: "date_start", type: "date" })
  dateStart!: string;

  @Column({ name: "date_end", type: "date" })
  dateEnd!: string;

  /** Zwykły weekend (sobota + niedziela) czy termin o nietypowym zakresie. */
  @Column({ name: "is_weekend", type: "boolean", default: true })
  isWeekend!: boolean;

  /**
   * BLOKADA JAKO CECHA TERMINU, NIE STATUS REZERWACJI.
   *
   * Blokada nie jest niczyją prośbą o wizytę — nie ma gościa, e-maila ani
   * decyzji do podjęcia. Trzymanie jej jako statusu rezerwacji wymuszałoby
   * wiersze z pustym `guest_name` i `guest_email`, czyli rezerwacje, które
   * rezerwacjami nie są.
   */
  @Column({ name: "is_blocked", type: "boolean", default: false })
  isBlocked!: boolean;

  /** Powód pokazywany gościom przy zablokowanym terminie. */
  @Column({ name: "blocked_reason", type: "text", nullable: true })
  blockedReason!: string | null;

  /**
   * Wszystkie prośby o ten termin — także historyczne. W danym momencie co
   * najwyżej JEDNA z nich może być aktywna; pilnuje tego częściowy unikalny
   * indeks opisany przy encji Reservation.
   */
  @OneToMany(() => Reservation, (reservation) => reservation.slot)
  reservations!: Reservation[];

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
