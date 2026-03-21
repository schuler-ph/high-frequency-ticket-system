export const ticketRedisKeys = (eventId: string) => ({
  total: `tickets:event:${eventId}:total`,
  available: `tickets:event:${eventId}:available`,
  reservation: (orderId: string) =>
    `tickets:event:${eventId}:reservation:${orderId}`,
});
