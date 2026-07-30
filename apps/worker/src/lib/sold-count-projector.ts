import type { EventInventorySnapshot } from "@repo/db";

export type ProjectSoldCountsDeps = {
  /**
   * The snapshot of the cycle's single grouped `COUNT(tickets)` aggregation.
   * Passed in because the inventory auditor reads the same numbers — one
   * aggregation per cycle, not two like the old reconcile needed (ADR-031).
   */
  snapshots: readonly EventInventorySnapshot[];
  persistSoldCounts: (
    snapshots: readonly EventInventorySnapshot[],
  ) => Promise<void>;
};

/**
 * Materializes the aggregated ticket count into `events.sold_count`.
 *
 * `events.sold_count` is a derived read model, nothing more: it carries neither
 * admission nor correctness. Availability is decided by Redis alone, so a
 * lagging — or briefly failing — projection cannot oversell. That is what makes
 * it safe to run this at 60 s instead of 10 s, and to pause it during a capacity
 * profile and let it run once after the drain if the scan shows measurable I/O
 * interference.
 *
 * Deliberately no Redis dependency at all: the projector must not be able to
 * touch the inventory, not even by accident. The earlier per-ticket
 * `sold_count` update stays banned too — it re-introduces the `events` hot-row
 * serialization from ADR-011.
 */
export async function projectSoldCounts(
  deps: ProjectSoldCountsDeps,
): Promise<void> {
  await deps.persistSoldCounts(deps.snapshots);
}
