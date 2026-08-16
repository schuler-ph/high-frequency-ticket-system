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

/**
 * `expiresAt` ist die Eligibility Deadline in Epoch-ms — derselbe Wert, den der
 * Ledger als ZSet-Score traegt. `serverTime` kommt bewusst mit: der Client
 * rechnet nur die Differenz `expiresAt - serverTime` weiter und ist damit
 * unabhaengig von einer falsch gehenden lokalen Uhr. Beide Felder sind optional,
 * weil das Schema — wie bei `orderId` — auch die Antworten ohne Reservierung
 * abdeckt.
 */
export const buyTicketResponseSchema = z.object({
  message: z.string(),
  orderId: z.uuid().optional(),
  expiresAt: z.number().int().positive().optional(),
  serverTime: z.number().int().positive().optional(),
});

export type BuyTicketResponse = z.infer<typeof buyTicketResponseSchema>;

/**
 * `expiresAt` liegt zusaetzlich im Record und nicht nur im ZSet-Score. Der
 * Score bleibt die Autoritaet fuer die Reaper-Auswahl; der Record traegt
 * denselben Wert, damit Status-Route und Checkout-Scripts die Deadline ohne
 * zweiten Key lesen koennen. Beide Werte entstehen aus derselben Berechnung im
 * Reserve-Pfad und duerfen nie auseinanderlaufen.
 */
export const pendingOrderCacheEntrySchema = z.object({
  orderId: z.uuid(),
  eventId: z.uuid(),
  status: z.literal("pending"),
  expiresAt: z.number().int().positive(),
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

const publishingOrderReservationSchema = pendingOrderReservationSchema.extend({
  status: z.literal("publishing"),
  queuedAt: z.number().int(),
});

export type PublishingOrderReservation = z.infer<
  typeof publishingOrderReservationSchema
>;

const paidOrderReservationSchema = publishingOrderReservationSchema.extend({
  status: z.literal("paid"),
});

export type PaidOrderReservation = z.infer<typeof paidOrderReservationSchema>;

/**
 * Interner Checkout-Zustandsautomat in Redis. `publishing` wird atomar vor dem
 * Pub/Sub-Aufruf geclaimt; `paid` markiert den bestaetigten Publish. Beide
 * Zustaende halten den Inventar-Anspruch und duerfen weder Cancel noch Reaper
 * freigeben (ADR-031).
 */
export const checkoutOrderReservationSchema = z.discriminatedUnion("status", [
  pendingOrderReservationSchema,
  publishingOrderReservationSchema,
  paidOrderReservationSchema,
]);

export type CheckoutOrderReservation = z.infer<
  typeof checkoutOrderReservationSchema
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

/**
 * Grabstein des Pending-Reapers: die Reservierung ist an ihrer Eligibility
 * Deadline verfallen und das Inventar wurde freigegeben. Der Record ersetzt das
 * frueher ersatzlose `DEL` und bekommt dieselbe Cleanup-TTL wie
 * `completed|failed`, damit ein Client den Ablauf noch lesen kann statt nur ein
 * nacktes 404 zu sehen (ADR-033).
 */
export const expiredOrderCacheEntrySchema = z.object({
  orderId: z.uuid(),
  eventId: z.uuid(),
  status: z.literal("expired"),
  expiresAt: z.number().int().positive(),
});

export type ExpiredOrderCacheEntry = z.infer<
  typeof expiredOrderCacheEntrySchema
>;

export const orderCacheEntrySchema = z.discriminatedUnion("status", [
  pendingOrderCacheEntrySchema,
  completedOrderCacheEntrySchema,
  failedOrderCacheEntrySchema,
  expiredOrderCacheEntrySchema,
]);

export type OrderCacheEntry = z.infer<typeof orderCacheEntrySchema>;

/**
 * Was der Worker als Abschluss schreibt. Der Reaper-Grabstein gehoert bewusst
 * NICHT dazu: `finalizeOrder` darf nur `completed|failed` erzeugen.
 */
export const finalOrderCacheEntrySchema = z.discriminatedUnion("status", [
  completedOrderCacheEntrySchema,
  failedOrderCacheEntrySchema,
]);

export type FinalOrderCacheEntry = z.infer<typeof finalOrderCacheEntrySchema>;

/**
 * Alle Zustaende, aus denen ein Checkout nicht mehr herauskommt — inklusive
 * Ablauf. Das ist die Menge, die die Status-Route hinter dem
 * Checkout-Zustandsautomaten noch antreffen kann.
 */
export const terminalOrderCacheEntrySchema = z.discriminatedUnion("status", [
  completedOrderCacheEntrySchema,
  failedOrderCacheEntrySchema,
  expiredOrderCacheEntrySchema,
]);

export type TerminalOrderCacheEntry = z.infer<
  typeof terminalOrderCacheEntrySchema
>;

/**
 * Der oeffentliche `pending`-Status traegt zusaetzlich zur Deadline die
 * Serverzeit des Reads. Damit kann das Frontend den Countdown bei jedem Poll
 * neu verankern, ohne der lokalen Uhr zu vertrauen.
 */
export const pendingOrderStatusResponseSchema =
  pendingOrderCacheEntrySchema.extend({
    serverTime: z.number().int().positive(),
  });

export type PendingOrderStatusResponse = z.infer<
  typeof pendingOrderStatusResponseSchema
>;

export const orderStatusResponseSchema = z.discriminatedUnion("status", [
  pendingOrderStatusResponseSchema,
  completedOrderCacheEntrySchema,
  failedOrderCacheEntrySchema,
  expiredOrderCacheEntrySchema,
]);

export type OrderStatusResponse = z.infer<typeof orderStatusResponseSchema>;

/**
 * Einheitliches HTTP-Fehler-Response-Schema, exakt in der Form, die der globale
 * Error-Handler (`apps/api/src/plugins/error-handler.ts`) fuer `AppError`s
 * sendet: `{ statusCode, error, message, reqId }`, wobei `error` der Name der
 * Fehlerklasse ist (z.B. `ConflictError`). Als Fabrik statt Copy-Paste, damit
 * jede Route ihre Fehler-Stati (409/425/404) im `response`-Schema deklarieren
 * kann und der Contract nur an einer Stelle definiert ist. Diese Schemas
 * dienen zugleich der Response-Serialisierung (fastify-type-provider-zod) und
 * als OpenAPI-Dokumentation der Fehlerantworten.
 */
export const httpErrorResponseSchema = <
  Code extends number,
  Name extends string,
>(
  statusCode: Code,
  errorName: Name,
) =>
  z.object({
    statusCode: z.literal(statusCode),
    error: z.literal(errorName),
    message: z.string().min(1),
    reqId: z.string().min(1),
  });

export const notFoundErrorResponseSchema = httpErrorResponseSchema(
  404,
  "NotFoundError",
);
export const conflictErrorResponseSchema = httpErrorResponseSchema(
  409,
  "ConflictError",
);
export const goneErrorResponseSchema = httpErrorResponseSchema(
  410,
  "GoneError",
);
export const tooEarlyErrorResponseSchema = httpErrorResponseSchema(
  425,
  "TooEarlyError",
);

// Bestehender Export-Name bleibt als Alias erhalten (Status-Route + Tests).
export const orderStatusNotFoundResponseSchema = notFoundErrorResponseSchema;

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
