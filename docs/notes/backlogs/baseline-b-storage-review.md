# Beobachtung fuer das Storage-Review (Phase 6)

Offene Evidenznotiz fuer das Storage-Review aus Baseline B.

## Datenbasis aus Baseline B fuer das Storage-Review

> - [ ] **Datenbasis aus Baseline B in das Storage-Review einspeisen:** Redis hielt nach dem Lauf **1.777.916 Keys / 505 MB** fuer 867.575 Orders (~582 Byte/Order), PostgreSQL 246 MB; zusaetzlich standen **43.066** Ledger-Reservierungen als Phantom-Ansprueche offen (die modellierten ~4 % Abbrecher ohne Cancel — erwartetes ADR-027-Verhalten und genau die Zielmenge des Reaper-Todos).
