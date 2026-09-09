import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.iso.datetime(),
  uptime: z.number().optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * Antwort, wenn der Service dauerhaft arbeitsunfaehig ist — etwa weil der
 * Pub/Sub-Subscriber des Workers gestorben ist. Eigener Statuscode (503),
 * damit eine Kubernetes-Probe darauf reagieren kann; `reason` nennt die
 * Ursache, damit sie im Probe-Log steht und nicht erst im Service-Log gesucht
 * werden muss (ADR-044).
 */
export const unhealthyResponseSchema = z.object({
  status: z.literal("unhealthy"),
  timestamp: z.iso.datetime(),
  uptime: z.number().optional(),
  reason: z.string(),
});

export type UnhealthyResponse = z.infer<typeof unhealthyResponseSchema>;

export const healthSchema = {
  response: {
    200: healthResponseSchema,
    503: unhealthyResponseSchema,
  },
};
