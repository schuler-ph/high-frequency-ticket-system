import { z } from "zod";

export const buyTicketRequestSchema = z.object({
  eventId: z.uuid("Invalid event ID format"),
  firstName: z
    .string()
    .min(1, "First name is required")
    .max(255, "First name is too long"),
  lastName: z
    .string()
    .min(1, "Last name is required")
    .max(255, "Last name is too long"),
});

export type BuyTicketRequest = z.infer<typeof buyTicketRequestSchema>;

export const buyTicketEventSchema = buyTicketRequestSchema.extend({
  orderId: z.uuid("Invalid order ID format"),
  queuedAt: z.number().int(),
});

export type BuyTicketEvent = z.infer<typeof buyTicketEventSchema>;

export const buyTicketBodySchema = buyTicketRequestSchema.omit({
  eventId: true,
});

export type BuyTicketBody = z.infer<typeof buyTicketBodySchema>;

export const ticketEventIdSchema = z.object({
  eventId: z.uuid("Invalid event ID format"),
});

export type TicketEventId = z.infer<typeof ticketEventIdSchema>;

export const orderIdParamsSchema = z.object({
  orderId: z.uuid("Invalid order ID format"),
});

export type OrderIdParams = z.infer<typeof orderIdParamsSchema>;

export const buyTicketResponseSchema = z.object({
  message: z.string(),
  orderId: z.uuid().optional(),
});

export type BuyTicketResponse = z.infer<typeof buyTicketResponseSchema>;

export const pendingOrderCacheEntrySchema = z.object({
  orderId: z.uuid(),
  eventId: z.uuid(),
  status: z.literal("pending"),
});

export type PendingOrderCacheEntry = z.infer<
  typeof pendingOrderCacheEntrySchema
>;

/**
 * Was `POST /buy` als Reservierungs-Record unter `orders:{orderId}` schreibt:
 * der oeffentliche Pending-Status PLUS die Personalisierungsdaten, die
 * `POST /orders/:orderId/pay` beim Publish in den `BuyTicketEvent` uebernimmt
 * (nach dem Reserve/Pay-Split kennt die Pay-Route den Kaeufer sonst nicht mehr,
 * ADR-028). Die `GET /orders/:orderId`-Route parst denselben Key mit dem
 * schmaleren `orderStatusResponseSchema` und streift die Namen wieder ab — der
 * oeffentliche Status-Contract bleibt damit unveraendert.
 */
export const pendingOrderReservationSchema =
  pendingOrderCacheEntrySchema.extend(buyTicketBodySchema.shape);

export type PendingOrderReservation = z.infer<
  typeof pendingOrderReservationSchema
>;

export const completedOrderCacheEntrySchema = z.object({
  orderId: z.uuid(),
  eventId: z.uuid(),
  status: z.literal("completed"),
  ticketId: z.uuid().nullable(),
});

export type CompletedOrderCacheEntry = z.infer<
  typeof completedOrderCacheEntrySchema
>;

export const failedOrderCacheEntrySchema = z.object({
  orderId: z.uuid(),
  eventId: z.uuid(),
  status: z.literal("failed"),
  failureReason: z.string().min(1),
});

export type FailedOrderCacheEntry = z.infer<typeof failedOrderCacheEntrySchema>;

export const orderCacheEntrySchema = z.discriminatedUnion("status", [
  pendingOrderCacheEntrySchema,
  completedOrderCacheEntrySchema,
  failedOrderCacheEntrySchema,
]);

export type OrderCacheEntry = z.infer<typeof orderCacheEntrySchema>;

export const finalOrderCacheEntrySchema = z.discriminatedUnion("status", [
  completedOrderCacheEntrySchema,
  failedOrderCacheEntrySchema,
]);

export type FinalOrderCacheEntry = z.infer<typeof finalOrderCacheEntrySchema>;

export const orderStatusResponseSchema = orderCacheEntrySchema;

export type OrderStatusResponse = z.infer<typeof orderStatusResponseSchema>;

export const orderStatusNotFoundResponseSchema = z.object({
  statusCode: z.literal(404),
  error: z.literal("NotFoundError"),
  message: z.string().min(1),
  reqId: z.string().min(1),
});

export type OrderStatusNotFoundResponse = z.infer<
  typeof orderStatusNotFoundResponseSchema
>;

export const ticketAvailabilityResponseSchema = z.object({
  available: z.number().int().nullable(),
  total: z.number().int().nullable(),
  // Unix-Ms-Timestamp, ab dem der Verkauf startet. `null` => sofort offen.
  opensAt: z.number().int().nullable(),
});

export type TicketAvailabilityResponse = z.infer<
  typeof ticketAvailabilityResponseSchema
>;

export const ticketResetResponseSchema = z.object({
  message: z.string(),
});

export type TicketResetResponse = z.infer<typeof ticketResetResponseSchema>;

/**
 * SIMULATION ONLY — Fake/Dummy-Zahlungsdaten fuer den Checkout-Mock.
 *
 * Diese Felder werden NIEMALS persistiert und verlassen den Prozess nicht: die
 * Pay-Route validiert das Schema und published anschliessend nur den
 * `BuyTicketEvent` (ohne Zahlungsdaten). Es findet keine echte Zahlungs-
 * abwicklung statt (ADR-013/ADR-028). Die Validierung ist bewusst locker
 * (reine Formatpruefung), damit der Frontend-Mock nicht an einer Luhn-Pruefung
 * o. Ae. scheitert.
 */
export const paymentRequestSchema = z.object({
  cardHolder: z
    .string()
    .min(1, "Card holder is required")
    .max(255, "Card holder is too long"),
  // 12–19 Ziffern, optionale Gruppierungs-Leerzeichen — reine Fake-Nummer.
  cardNumber: z
    .string()
    .regex(/^[0-9 ]{12,23}$/, "Card number must be 12–19 digits"),
  // MM/YY
  expiry: z.string().regex(/^(0[1-9]|1[0-2])\/\d{2}$/, "Expiry must be MM/YY"),
  cvc: z.string().regex(/^\d{3,4}$/, "CVC must be 3–4 digits"),
});

export type PaymentRequest = z.infer<typeof paymentRequestSchema>;

export const paymentResponseSchema = z.object({
  confirmed: z.boolean(),
  orderId: z.uuid(),
});

export type PaymentResponse = z.infer<typeof paymentResponseSchema>;

/**
 * Antwort der Cancel-Route (`POST /orders/:orderId/cancel`). `cancelled` ist
 * `true`, wenn tatsaechlich eine aktive Reservierung freigegeben wurde, und
 * `false`, wenn nichts (mehr) zu stornieren war — die Route ist idempotent
 * (ADR-028).
 */
export const cancelOrderResponseSchema = z.object({
  cancelled: z.boolean(),
  orderId: z.uuid(),
});

export type CancelOrderResponse = z.infer<typeof cancelOrderResponseSchema>;
