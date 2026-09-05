import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

import { VisitSlot } from "../visits/visit-slot.entity.js";
import { ArrivalDay, ReservationStatus } from "./reservation.enums.js";

/**
 * REZERWACJA — prośba konkretnej osoby o konkretny termin.
 *
 * Rezerwacja nie „jest” terminem. Jeden termin może mieć wiele rezerwacji
 * w historii (odrzucone, odwołane), ale najwyżej jedną aktywną naraz.
 *
 * Pola gościa odwzorowują dokładnie to, co gość wpisuje dziś w formularzu na
 * frontendzie (BookingModal). Świadomie nie dokładamy telefonu, nazwiska ani
 * liczby osób — czego formularz nie zbiera, tego baza nie przechowuje.
 */
@Entity({ name: "reservations" })
/**
 * OCHRONA PRZED PODWÓJNĄ REZERWACJĄ — NA POZIOMIE BAZY.
 *
 * Sprawdzenie „czy termin wolny?” w kodzie aplikacji nie wystarcza: między
 * odczytem a zapisem mieści się drugie żądanie, a Lambda bywa zwielokrotniona.
 * Klasyczny wyścig kończy się dwiema prośbami PENDING na ten sam termin.
 *
 * Częściowy unikalny indeks przenosi tę regułę tam, gdzie nie da się jej ominąć.
 * PostgreSQL odrzuci drugi INSERT niezależnie od tego, ile procesów działa
 * równolegle — bez jednego locka w kodzie aplikacji.
 *
 * Warunek WHERE obejmuje wyłącznie statusy aktywne, więc dowolna liczba
 * rezerwacji REJECTED i CANCELLED na ten sam termin jest w porządku i historia
 * zostaje nienaruszona.
 */
@Index("uq_reservations_active_slot", ["slotId"], {
  unique: true,
  where: `"status" IN ('PENDING', 'CONFIRMED')`,
})
export class Reservation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /**
   * ON DELETE RESTRICT, nie CASCADE — świadomie.
   * Skasowanie terminu nie może po cichu zabrać ze sobą historii próśb.
   * Jeśli ktoś kiedyś zechce usunąć termin z rezerwacjami, ma się o nie potknąć.
   */
  @ManyToOne(() => VisitSlot, (slot) => slot.reservations, {
    nullable: false,
    onDelete: "RESTRICT",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "slot_id" })
  slot!: VisitSlot;

  /** Klucz obcy wystawiony osobno — pozwala filtrować bez dociągania relacji. */
  @Column({ name: "slot_id", type: "uuid" })
  slotId!: string;

  @Column({
    type: "enum",
    enum: ReservationStatus,
    enumName: "reservation_status",
    default: ReservationStatus.PENDING,
  })
  status!: ReservationStatus;

  /** „Kto przyjedzie?” — dowolny opis, nie imię i nazwisko. Limit jak w formularzu. */
  @Column({ name: "guest_name", type: "varchar", length: 80 })
  guestName!: string;

  @Column({ name: "guest_email", type: "varchar", length: 255 })
  guestEmail!: string;

  /** NULL = „jeszcze nie wiem”. Gość rezerwuje cały weekend tak czy inaczej. */
  @Column({
    name: "arrival_day",
    type: "enum",
    enum: ArrivalDay,
    enumName: "arrival_day",
    nullable: true,
  })
  arrivalDay!: ArrivalDay | null;

  /** „Chcecie coś dodać?” — nieobowiązkowe, limit jak w formularzu. */
  @Column({ type: "text", nullable: true })
  notes!: string | null;

  /**
   * PRYWATNA NOTATKA GOSPODARZY.
   *
   * Osobne pole od `notes`, mimo że oba są tekstem. `notes` to wiadomość GOŚCIA
   * o wizycie; to jest notatka RODZICÓW o gościu. Trzymanie ich razem znaczyłoby,
   * że jedno nadpisuje drugie i że nie da się ich różnie chronić.
   *
   * Nie wychodzi publicznie NIGDY — ani przy CONFIRMED, ani przy isPrivate=false.
   * Pilnuje tego allowlista w VisitSlotsService.
   */
  @Column({ name: "admin_note", type: "text", nullable: true })
  adminNote!: string | null;

  /**
   * PRYWATNOŚĆ WIDOKU PUBLICZNEGO.
   *
   * false (domyślnie) — innym wolno pokazać, kto przyjeżdża
   * true             — inni widzą wyłącznie „Zajęte”
   *
   * Dotyczy WYŁĄCZNIE tego, czy publicznie ujawniamy `guestName`. E-mail i
   * notatki nie są publiczne nigdy, niezależnie od tej flagi.
   */
  @Column({ name: "is_private", type: "boolean", default: false })
  isPrivate!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  // TODO (etap e-mail): actionTokenHash + actionTokenExpiresAt.
  // Linki Potwierdź/Odrzuć nie mogą opierać się na samym id rezerwacji — to
  // dawałoby możliwość zgadywania. Do maila trafi token jawny, w bazie
  // wyląduje wyłącznie jego hash. Osobna migracja, osobny etap.
}
