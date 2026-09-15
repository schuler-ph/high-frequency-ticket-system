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

/**
 * Antwort der Readiness-Probe. Sie beantwortet eine andere Frage als
 * `/health`: nicht "hilft ein Neustart?", sondern "darf dieser Pod jetzt
 * Traffic bekommen?". Eine fehlende Abhaengigkeit — Redis, aus dem alle
 * API-Read-Modelle kommen — macht den Pod arbeitsunfaehig, aber nicht kaputt;
 * er erholt sich, sobald die Abhaengigkeit zurueck ist.
 *
 * Diese Trennung ist der Grund fuer ein eigenes Schema: waere die
 * Redis-Pruefung Teil von `/health`, wuerde ein Redis-Ausfall saemtliche Pods
 * in eine Neustart-Schleife schicken und aus einem Ausfall zwei machen.
 */
export const readyResponseSchema = z.object({
  status: z.literal("ready"),
  timestamp: z.iso.datetime(),
});

export type ReadyResponse = z.infer<typeof readyResponseSchema>;

export const notReadyResponseSchema = z.object({
  status: z.literal("not-ready"),
  timestamp: z.iso.datetime(),
  reason: z.string(),
});

export type NotReadyResponse = z.infer<typeof notReadyResponseSchema>;

export const readySchema = {
  response: {
    200: readyResponseSchema,
    503: notReadyResponseSchema,
  },
};
