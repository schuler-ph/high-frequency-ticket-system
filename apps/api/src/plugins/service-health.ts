import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

export interface ServiceHealth {
  /** Grund, falls der Service dauerhaft arbeitsunfaehig ist, sonst `null`. */
  readonly fatalReason: string | null;
  /** Einmaliger Uebergang nach "dauerhaft kaputt". Nicht rueckgaengig machbar. */
  markFatal(reason: string): void;
}

/**
 * Ein-Bit-Zustand "dieser Prozess ist dauerhaft arbeitsunfaehig", den
 * `/health` als 503 ausliefert (ADR-044).
 *
 * Er existiert fuer Fehler, die ein Prozess nicht selbst reparieren kann und
 * die sonst unsichtbar blieben: der Pub/Sub-Subscriber des Workers stirbt mit
 * `NOT_FOUND`, der Prozess laeuft weiter, beantwortet Health-Checks mit 200 —
 * und verarbeitet dauerhaft nichts. Genau dieser Fall ist am 2026-09-09
 * aufgetreten: 1.000 Nachrichten blieben unzugestellt, waehrend die Probe
 * gruen war.
 *
 * Bewusst nicht rueckgaengig machbar: die Ursachen sind Zustaende, aus denen
 * sich der Prozess nicht heraussanieren kann (Ressource geloescht, Rechte
 * entzogen). Der Neustart ist die Reparatur, und den ausloesen soll die
 * Liveness-Probe.
 */
export const serviceHealthPlugin: FastifyPluginAsync = async (fastify) => {
  let fatalReason: string | null = null;

  const serviceHealth: ServiceHealth = {
    get fatalReason() {
      return fatalReason;
    },
    markFatal(reason) {
      if (fatalReason !== null) return;
      fatalReason = reason;
      fastify.log.fatal(
        { reason },
        "Service is permanently unable to work; /health now reports 503",
      );
    },
  };

  fastify.decorate("serviceHealth", serviceHealth);
};

export default fp(serviceHealthPlugin, { name: "service-health" });

declare module "fastify" {
  export interface FastifyInstance {
    serviceHealth: ServiceHealth;
  }
}
