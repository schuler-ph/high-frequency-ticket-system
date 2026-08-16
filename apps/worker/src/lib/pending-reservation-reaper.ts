import type { EventInventorySnapshot } from "@repo/db";
import { orderRedisKeys, ticketRedisKeys } from "@repo/types/redis-keys";
import type { RedisClient } from "@repo/types/redis-client";
import type { WorkerRedisScripts } from "./redis-scripts.ts";

export type ReaperSkipReason =
  | "already-released"
  | "not-due"
  | "missing-state"
  | "publishing"
  | "paid"
  | "invalid-state";

export type EventReaperResult = {
  eventId: string;
  candidates: number;
  processed: number;
  released: number;
  skipped: Record<ReaperSkipReason, number>;
  errors: number;
  oldestReleasedAgeSeconds: number;
};

export type PendingReservationReaperRedis = Pick<
  RedisClient,
  "zcount" | "zrangebyscore"
> &
  Pick<WorkerRedisScripts, "reapPendingReservation">;

export type ReapPendingReservationsDeps = {
  snapshots: readonly EventInventorySnapshot[];
  redis: PendingReservationReaperRedis;
  nowMs: number;
  batchSize: number;
  /** Cleanup-TTL des `expired`-Grabsteins — dieselbe wie fuer finale Orders. */
  expiredTtlSeconds: number;
  onEventReaped?: (result: EventReaperResult) => void;
  onError?: (eventId: string, orderId: string | null, error: unknown) => void;
};

const EMPTY_SKIPS = (): Record<ReaperSkipReason, number> => ({
  "already-released": 0,
  "not-due": 0,
  "missing-state": 0,
  publishing: 0,
  paid: 0,
  "invalid-state": 0,
});

const reasonForResult = (result: number): ReaperSkipReason => {
  switch (result) {
    case 0:
      return "already-released";
    case 2:
      return "not-due";
    case 3:
      return "missing-state";
    case 4:
      return "publishing";
    case 5:
      return "paid";
    default:
      return "invalid-state";
  }
};

/**
 * Releases due `pending` reservations identity-by-identity. Candidate discovery
 * is read-only; the Lua command performs the complete state check and release.
 * A missing/malformed or `publishing|paid` order is deliberately retained and
 * quarantined outside the due score range by the Lua script. It remains an
 * active inventory claim but cannot permanently starve later pending entries
 * at the batch boundary.
 */
export async function reapPendingReservations(
  deps: ReapPendingReservationsDeps,
): Promise<EventReaperResult[]> {
  const results: EventReaperResult[] = [];

  for (const snapshot of deps.snapshots) {
    const keys = ticketRedisKeys(snapshot.eventId);
    const result: EventReaperResult = {
      eventId: snapshot.eventId,
      candidates: 0,
      processed: 0,
      released: 0,
      skipped: EMPTY_SKIPS(),
      errors: 0,
      oldestReleasedAgeSeconds: 0,
    };

    try {
      result.candidates = await deps.redis.zcount(
        keys.reservations,
        0,
        deps.nowMs,
      );
      const rawCandidates = await deps.redis.zrangebyscore(
        keys.reservations,
        0,
        deps.nowMs,
        "WITHSCORES",
        "LIMIT",
        0,
        deps.batchSize,
      );

      for (let index = 0; index < rawCandidates.length; index += 2) {
        const orderId = rawCandidates[index];
        const deadlineRaw = rawCandidates[index + 1];
        if (orderId === undefined || deadlineRaw === undefined) {
          result.errors += 1;
          deps.onError?.(
            snapshot.eventId,
            orderId ?? null,
            new Error("Malformed ZRANGEBYSCORE WITHSCORES response"),
          );
          continue;
        }

        result.processed += 1;
        try {
          const releaseResult = await deps.redis.reapPendingReservation(
            keys.reservations,
            keys.available,
            orderRedisKeys.entry(orderId),
            orderId,
            deps.nowMs,
            deps.expiredTtlSeconds,
          );

          if (releaseResult === 1) {
            result.released += 1;
            result.oldestReleasedAgeSeconds = Math.max(
              result.oldestReleasedAgeSeconds,
              Math.max(0, deps.nowMs - Number(deadlineRaw)) / 1000,
            );
          } else {
            result.skipped[reasonForResult(releaseResult)] += 1;
          }
        } catch (error: unknown) {
          result.errors += 1;
          deps.onError?.(snapshot.eventId, orderId, error);
        }
      }
    } catch (error: unknown) {
      result.errors += 1;
      deps.onError?.(snapshot.eventId, null, error);
    }

    results.push(result);
    deps.onEventReaped?.(result);
  }

  return results;
}
