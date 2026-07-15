export const ticketRedisKeys = (eventId: string) => ({
  total: `tickets:event:${eventId}:total`,
  available: `tickets:event:${eventId}:available`,
  // Unix-Ms-Timestamp, ab dem Reservierungen fuer dieses Event erlaubt sind.
  // Fehlt der Key oder ist er "0", gilt das Event als sofort offen.
  opensAt: `tickets:event:${eventId}:opensAt`,
  // ZSet-Ledger der akzeptierten, noch nicht finalisierten Reservierungen:
  // Score = Erstellungszeit (Unix-Ms), Member = orderId. Jeder Eintrag ist ein
  // aktiver Inventar-Anspruch — bewusst OHNE TTL, damit Warteschlangen-Latenz
  // keine Reservierung "ablaufen" laesst (ADR-026). Entfernt wird ein Eintrag
  // nur durch Worker-Finalisierung (Erfolg) oder Kompensation (terminaler
  // Fehler). Alter/Ablauf ist lediglich ein Stale-Kandidat fuer den Reaper
  // (Phase 6), niemals eine automatische Rueckbuchung von `available`.
  reservations: `tickets:event:${eventId}:reservations`,
  processed: (orderId: string) =>
    `tickets:event:${eventId}:processed:${orderId}`,
});

export const orderRedisKeys = {
  entry: (orderId: string) => `orders:${orderId}`,
};
