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

export const buyTicketResponseSchema = z.object({
  message: z.string(),
  orderId: z.uuid().optional(),
});

export type BuyTicketResponse = z.infer<typeof buyTicketResponseSchema>;

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
