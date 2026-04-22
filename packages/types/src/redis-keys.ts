export const ticketRedisKeys = (eventId: string) => ({
  total: `tickets:event:${eventId}:total`,
  available: `tickets:event:${eventId}:available`,
  reservation: (orderId: string) =>
    `tickets:event:${eventId}:reservation:${orderId}`,
  processing: (orderId: string) =>
    `tickets:event:${eventId}:processing:${orderId}`,
  processed: (orderId: string) =>
    `tickets:event:${eventId}:processed:${orderId}`,
});

export const orderRedisKeys = {
  pending: (orderId: string) => `orders:${orderId}:pending`,
};
