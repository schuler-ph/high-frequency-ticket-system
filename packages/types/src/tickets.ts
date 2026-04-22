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
});

export type TicketAvailabilityResponse = z.infer<
  typeof ticketAvailabilityResponseSchema
>;

export const ticketResetResponseSchema = z.object({
  message: z.string(),
});

export type TicketResetResponse = z.infer<typeof ticketResetResponseSchema>;
