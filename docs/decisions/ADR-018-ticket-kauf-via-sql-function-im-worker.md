# ADR-018: Ticket-Kauf via SQL-Function im Worker

- **Datum:** 2026-03-12
- **Kontext:** Der Worker hat zuvor eine Drizzle-Transaktion mit `INSERT` und `UPDATE` ausgefuehrt. Die Logik soll atomar und nah an der DB bleiben.
- **Entscheidung:** Der Worker ruft eine PostgreSQL-Function `buy_ticket(event_id, first_name, last_name)` auf.
- **Begruendung:** Die DB kapselt die gesamte Write-Logik in einer atomaren Operation. Das reduziert Roundtrips und vereinfacht den Worker-Code.
- **Alternativen:** Drizzle-Transaktion im Worker (mehr ORM-Code, gleiche Semantik), separate Stored Procedures pro Schritt (mehr Komplexitaet).
- **Nachtrag (2026-07-18):** Die aktuelle Signatur ist `buy_ticket(event_id, order_id, first_name, last_name)`; die Function fuegt die Order direkt als `completed` ein und macht den Ticket-INSERT — **ohne** `sold_count`-`UPDATE` (Hot-Row entfernt, siehe ADR-011-Nachtrag, Migration 0009). Atomaritaet und DB-Kapselung bleiben unveraendert.
