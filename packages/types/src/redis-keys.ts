export const ticketRedisKeys = (eventId: string) => ({
  total: `tickets:event:${eventId}:total`,
  available: `tickets:event:${eventId}:available`,
  // Unix-Ms-Timestamp, ab dem Reservierungen fuer dieses Event erlaubt sind.
  // Fehlt der Key oder ist er "0", gilt das Event als sofort offen.
  opensAt: `tickets:event:${eventId}:opensAt`,
  reservation: (orderId: string) =>
    `tickets:event:${eventId}:reservation:${orderId}`,
  processed: (orderId: string) =>
    `tickets:event:${eventId}:processed:${orderId}`,
});

export const orderRedisKeys = {
  entry: (orderId: string) => `orders:${orderId}`,
};
