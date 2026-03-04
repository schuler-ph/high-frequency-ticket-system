import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.iso.datetime(),
  uptime: z.number().optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const healthSchema = {
  response: {
    200: healthResponseSchema,
  },
};
