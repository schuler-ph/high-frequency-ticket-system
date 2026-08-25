-- Phase 4.13 (Baseline F, Haertung): zwei Punkte, die in Baseline E ohne
-- Wirkung waren und unter Retry-/Redelivery-Druck relevant werden.
--
-- 1. Index auf tickets(order_id). Der Fremdschluessel legt in PostgreSQL keinen
--    Index an, und bis hierher existierte im Schema kein einziges CREATE INDEX.
--    Der Duplikat-Zweig von buy_ticket (ON CONFLICT auf orders, dann Ticket per
--    `WHERE order_id = p_order_id` zurueckgeben) scannte damit sequenziell
--    ueber ~1 Mio Zeilen. Deklariert im Drizzle-Schema (src/schema.ts), hier
--    idempotent, damit die Datei nach `db:push` auch per `db:apply-sql` laeuft.
CREATE INDEX IF NOT EXISTS "tickets_order_id_idx" ON "tickets" USING btree ("order_id");--> statement-breakpoint
-- 2. Tote Ueberladung droppen. 0001 legte buy_ticket(uuid, text, text) an; seit
--    0004/0009 ruft der Worker buy_ticket(uuid, uuid, text, text). CREATE OR
--    REPLACE ersetzt bei abweichender Signatur nicht, sondern legt daneben —
--    die alte Variante stand also noch in jeder DB und enthielt genau den
--    sold_count-Hot-Row-Write, den 0009 entfernt hat.
DROP FUNCTION IF EXISTS buy_ticket(uuid, text, text);
