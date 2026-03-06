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

export const buyTicketResponseSchema = z.object({
  message: z.string(),
  orderId: z.uuid().optional(),
});

export type BuyTicketResponse = z.infer<typeof buyTicketResponseSchema>;

export const ticketAvailabilityResponseSchema = z.object({
  available: z.string().nullable(),
  total: z.string().nullable(),
});

export type TicketAvailabilityResponse = z.infer<
  typeof ticketAvailabilityResponseSchema
>;

export const ticketResetResponseSchema = z.object({
  message: z.string(),
});

export type TicketResetResponse = z.infer<typeof ticketResetResponseSchema>;
