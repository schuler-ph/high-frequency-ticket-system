import type { EventInventorySnapshot } from "@repo/db";
import { ticketRedisKeys } from "@repo/types/redis-keys";
import type { RedisClient } from "@repo/types/redis-client";

export type { EventInventorySnapshot } from "@repo/db";

export type ReconcileRedisClient = Pick<
  RedisClient,
  "get" | "mset" | "incrby" | "zcard" | "zcount"
>;

export type ReconcileTicketAvailabilityDeps = {
  getEventInventorySnapshots: () => Promise<EventInventorySnapshot[]>;
  // Schreibt den aggregierten `COUNT(tickets)`-Verkaufsstand als Snapshot nach
  // `events.sold_count` zurueck (Backlog #7). Optional: fehlt der Dep, laeuft
  // Reconcile unveraendert, nur ohne Materialisierung.
  persistSoldCounts?: (
    snapshots: readonly EventInventorySnapshot[],
  ) => Promise<void>;
  redis: ReconcileRedisClient;
  // Reservierungen, deren Erstellungszeit (ZSet-Score) aelter als dieser
  // Schwellwert ist, gelten als Stale-Kandidaten fuer den Reaper (Phase 6).
  // Sie werden nur gezaehlt/gemeldet, NIE automatisch zurueckgebucht.
  staleReservationThresholdMs?: number;
  now?: () => number;
  onEventReconciled?: (
    eventId: string,
    redisAvailable: number,
    computedAvailable: number,
  ) => void;
  onReservationLedgerMeasured?: (
    eventId: string,
    activeReservations: number,
    staleReservations: number,
  ) => void;
};

const DEFAULT_STALE_RESERVATION_THRESHOLD_MS = 900_000;

export const calculateAvailableTickets = (
  totalCapacity: number,
  soldCount: number,
  activeReservations: number,
): number => Math.max(totalCapacity - soldCount - activeReservations, 0);

/**
 * Zaehlt aktive (akzeptiert, noch nicht finalisierte) Reservierungen als
 * ZSet-Kardinalitaet — O(1) statt eines Keyspace-`SCAN` (ADR-026). Jeder
 * Ledger-Eintrag ist ein Inventar-Anspruch, unabhaengig vom Alter; Ablauf
 * fuehrt nie zu automatischer Rueckbuchung von `available`.
 */
export async function countActiveReservations(
  redis: ReconcileRedisClient,
  eventId: string,
): Promise<number> {
  return redis.zcard(ticketRedisKeys(eventId).reservations);
}

/**
 * Zaehlt Ledger-Eintraege, deren Score (Erstellungszeit) aelter als
 * `olderThanMs` ist — Stale-Kandidaten fuer den Reaper. Reine Observability,
 * loest keine Kompensation aus.
 */
export async function countStaleReservations(
  redis: ReconcileRedisClient,
  eventId: string,
  olderThanMs: number,
): Promise<number> {
  return redis.zcount(ticketRedisKeys(eventId).reservations, 0, olderThanMs);
}

export async function reconcileTicketAvailability(
  deps: ReconcileTicketAvailabilityDeps,
): Promise<void> {
  const now = deps.now ?? Date.now;
  const staleThresholdMs =
    deps.staleReservationThresholdMs ?? DEFAULT_STALE_RESERVATION_THRESHOLD_MS;
  const eventSnapshots = await deps.getEventInventorySnapshots();

  for (const snapshot of eventSnapshots) {
    const keys = ticketRedisKeys(snapshot.eventId);
    const activeReservations = await countActiveReservations(
      deps.redis,
      snapshot.eventId,
    );
    const staleReservations = await countStaleReservations(
      deps.redis,
      snapshot.eventId,
      now() - staleThresholdMs,
    );
    deps.onReservationLedgerMeasured?.(
      snapshot.eventId,
      activeReservations,
      staleReservations,
    );
    const computed = calculateAvailableTickets(
      snapshot.totalCapacity,
      snapshot.soldCount,
      activeReservations,
    );

    const redisRaw = await deps.redis.get(keys.available);

    if (redisRaw === null) {
      // Bootstrap: Key fehlt (z. B. leeres Redis nach Restart) → absolut
      // initialisieren; hier kann kein paralleler Kauf verloren gehen.
      deps.onEventReconciled?.(snapshot.eventId, computed, computed);
      await deps.redis.mset({
        [keys.total]: String(snapshot.totalCapacity),
        [keys.available]: String(computed),
      });
      continue;
    }

    const redisAvailable = parseInt(redisRaw, 10);
    deps.onEventReconciled?.(snapshot.eventId, redisAvailable, computed);

    await deps.redis.mset({
      [keys.total]: String(snapshot.totalCapacity),
    });

    // Delta-Korrektur statt absolutem Ueberschreiben: Reservierungen (DECRs),
    // die zwischen Messung und Korrektur passieren, gehen nicht verloren.
    const drift = redisAvailable - computed;
    if (drift !== 0) {
      await deps.redis.incrby(keys.available, -drift);
    }
  }

  // Aggregierten Verkaufsstand als durable Snapshot zurueckschreiben, nachdem
  // Redis korrigiert wurde. Erst am Ende, damit ein Fehler beim Persistieren
  // die Redis-Korrektur nicht verhindert.
  await deps.persistSoldCounts?.(eventSnapshots);
}
