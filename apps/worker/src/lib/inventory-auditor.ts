import type { EventInventorySnapshot } from "@repo/db";
import { ticketRedisKeys } from "@repo/types/redis-keys";
import type { RedisClient } from "@repo/types/redis-client";

export type { EventInventorySnapshot } from "@repo/db";

/**
 * Read-only Redis surface. The missing `mset`/`incrby`/`set` is the point of
 * this type: the auditor **cannot** write the inventory even by accident
 * (ADR-031). Every `available`-mutation lives in the atomic Lua scripts of the
 * reserve/release/finalize paths.
 */
export type InventoryAuditRedisClient = Pick<
  RedisClient,
  "get" | "zcard" | "zcount"
>;

export type EventInventoryAudit = {
  eventId: string;
  totalCapacity: number;
  /** `COUNT(tickets)` — the durable truth about sold tickets. */
  soldCount: number;
  /** Redis `available` counter, the live inventory authority during a sale. */
  available: number;
  activeReservations: number;
  staleReservations: number;
  /**
   * `available + soldCount + activeReservations - totalCapacity`. Signed on
   * purpose: positive = more claims than seats (oversell), negative = seats
   * lost. Never clamped — clamping is what made the old drift gauge blind to
   * exactly the overclaim it was supposed to surface (Baseline C, report §5).
   */
  capacityDelta: number;
};

export type AuditTicketInventoryDeps = {
  /**
   * The DB snapshot the sold-count projector already read this cycle. Passed in
   * rather than re-queried so a cycle costs exactly one `COUNT(tickets)`
   * aggregation (ADR-031) instead of the two the old reconcile needed.
   */
  snapshots: readonly EventInventorySnapshot[];
  redis: InventoryAuditRedisClient;
  /**
   * Ledger entries with a score at or below this bound count as stale. The
   * caller owns the meaning of the score, so the auditor does not have to know
   * whether it carries a creation time or an eligibility deadline.
   */
  staleScoreCeiling: number;
  onEventAudited?: (audit: EventInventoryAudit) => void;
};

/**
 * A Redis inventory key that should exist during a sale is missing. Deliberately
 * an error and never an automatic initialization: re-deriving `available` from
 * PostgreSQL is precisely the cross-system write that ADR-031 removes. The local
 * stack establishes the keys through reset/seed before the sale.
 */
export class InventoryAuditError extends Error {
  public readonly eventIds: readonly string[];

  constructor(eventIds: readonly string[]) {
    super(
      `Inventory audit failed: missing Redis availability key for event(s) ${eventIds.join(", ")}`,
    );
    this.name = "InventoryAuditError";
    this.eventIds = eventIds;
  }
}

/**
 * Counts active (accepted, not yet finalized) reservations as ZSet cardinality —
 * O(1) instead of a keyspace `SCAN` (ADR-026). Every ledger entry is an
 * inventory claim regardless of age.
 */
export async function countActiveReservations(
  redis: InventoryAuditRedisClient,
  eventId: string,
): Promise<number> {
  return redis.zcard(ticketRedisKeys(eventId).reservations);
}

/**
 * Counts ledger entries whose score is at or below `maxScore` — the reaper's
 * candidate set. Pure observability; releasing a claim is the reaper's job and
 * happens per `orderId`, never as a sum.
 */
export async function countStaleReservations(
  redis: InventoryAuditRedisClient,
  eventId: string,
  maxScore: number,
): Promise<number> {
  return redis.zcount(ticketRedisKeys(eventId).reservations, 0, maxScore);
}

/**
 * Measures the inventory of every known event and reports the signed capacity
 * delta. Replaces the measuring half of the old reconcile loop; the correcting
 * half is gone for good (ADR-031).
 *
 * Because nothing here writes, the read order no longer carries correctness. It
 * only decides the SIGN a concurrent transition produces: an order finalizing
 * between the `available` read and the `ZCARD` is counted twice (delta too low),
 * a reservation created in that window is counted in neither (delta too high).
 * Both are transient snapshot artefacts of two independently mutating systems —
 * a single spike is a diagnosis, not a repair instruction. Only after a
 * completed drain must `capacityDelta` be exactly 0; that is the invariant the
 * load-test verdict asserts.
 *
 * A missing `available` key aborts the run with {@link InventoryAuditError}
 * AFTER every healthy event has been reported, so one broken event never hides
 * the others' measurements.
 */
export async function auditTicketInventory(
  deps: AuditTicketInventoryDeps,
): Promise<EventInventoryAudit[]> {
  const audits: EventInventoryAudit[] = [];
  const missingKeyEventIds: string[] = [];

  for (const snapshot of deps.snapshots) {
    const keys = ticketRedisKeys(snapshot.eventId);
    const availableRaw = await deps.redis.get(keys.available);

    if (availableRaw === null) {
      missingKeyEventIds.push(snapshot.eventId);
      continue;
    }

    const available = parseInt(availableRaw, 10);
    const activeReservations = await countActiveReservations(
      deps.redis,
      snapshot.eventId,
    );
    const staleReservations = await countStaleReservations(
      deps.redis,
      snapshot.eventId,
      deps.staleScoreCeiling,
    );

    const audit: EventInventoryAudit = {
      eventId: snapshot.eventId,
      totalCapacity: snapshot.totalCapacity,
      soldCount: snapshot.soldCount,
      available,
      activeReservations,
      staleReservations,
      capacityDelta:
        available +
        snapshot.soldCount +
        activeReservations -
        snapshot.totalCapacity,
    };

    audits.push(audit);
    deps.onEventAudited?.(audit);
  }

  if (missingKeyEventIds.length > 0) {
    throw new InventoryAuditError(missingKeyEventIds);
  }

  return audits;
}
