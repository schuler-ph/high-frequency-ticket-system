# ADR-012: Guest Checkout (Keine Authentifizierung)

- **Datum:** 2026-02-25
- **Kontext:** Authentifizierung (OAuth, NextAuth) lenkt vom Kern-Szenario (High-Concurrency, Async Writes) ab und erhöht die Komplexität des Beispielprojekts.
- **Entscheidung:** Keine E-Mail/Passwort- oder Social-Login Authentifizierung. Es wird ein Guest-Checkout implementiert.
- **Begründung:** Die zu personalisierenden Käuferdaten (Vorname, Adresse, etc.) werden direkt im POST-Request beim Ticket-Kauf mitgeliefert. Das Frontend generiert eine lokale Request/Session-UUID um per Polling abfragen zu können, ob das asynchrone Ticket erfolgreich generiert wurde. Der Scope bleibt somit streng fokussiert auf System-Performance.
- **Alternativen:** Vollständige Auth via Supabase/NextAuth (zu viel Feature-Creep).
