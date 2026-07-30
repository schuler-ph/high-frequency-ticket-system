export const ticketRedisKeys = (eventId: string) => ({
  total: `tickets:event:${eventId}:total`,
  available: `tickets:event:${eventId}:available`,
  // Unix-Ms-Timestamp, ab dem Reservierungen fuer dieses Event erlaubt sind.
  // Fehlt der Key oder ist er "0", gilt das Event als sofort offen.
  opensAt: `tickets:event:${eventId}:opensAt`,
  // ZSet-Ledger der akzeptierten, noch nicht finalisierten Reservierungen:
  // Score = Eligibility Deadline (Unix-Ms), Member = orderId. Jeder Eintrag ist
  // ein aktiver Inventar-Anspruch — bewusst OHNE TTL. Vor der Deadline darf
  // nichts freigegeben werden; danach entscheidet der Reaper atomar anhand des
  // konkreten Checkout-Status. Worker-Finalisierung/Kompensation und
  // Cancel/Pay-Rollback entfernen denselben Eintrag idempotent (ADR-031).
  reservations: `tickets:event:${eventId}:reservations`,
  processed: (orderId: string) =>
    `tickets:event:${eventId}:processed:${orderId}`,
});

export const orderRedisKeys = {
  entry: (orderId: string) => `orders:${orderId}`,
};
