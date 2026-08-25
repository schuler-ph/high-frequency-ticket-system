import { sql, eq, count } from "drizzle-orm";
import type { BuyTicketEvent } from "@repo/types/tickets";
import { db } from "./index.ts";
import { events, orders, tickets } from "./schema.ts";

export type FailedOrderUpdateResult = "updated" | "missing";

type EventRow = typeof events.$inferSelect;

export type EventInventorySnapshot = Pick<
  EventRow,
  "totalCapacity" | "soldCount"
> & {
  eventId: EventRow["id"];
};

export async function executeBuyTicket(
  payload: BuyTicketEvent,
): Promise<string | null> {
  const result = await db.execute<{ ticket_id: string | null }>(
    sql`SELECT buy_ticket(${payload.eventId}, ${payload.orderId}, ${payload.firstName}, ${payload.lastName}) AS ticket_id`,
  );

  return result.rows[0]?.ticket_id ?? null;
}

/**
 * Verkaufsstand pro Event als `COUNT(tickets)` statt aus der
 * `events.sold_count`-Spalte. Seit Backlog #7 aktualisiert `buy_ticket` die
 * Spalte nicht mehr (Hot-Row entfernt) — die durable Wahrheit ueber verkaufte
 * Tickets ist die `tickets`-Tabelle. Diese Aggregation laeuft nur im
 * Inventory-Zyklus (Default: alle 60 s), nie auf dem Write-Hot-Path, und nimmt
 * daher keinen Row-Lock der `events`-Row. Der Sold-count Projector schreibt den
 * Wert anschliessend via `persistEventSoldCounts` als Snapshot zurueck; der
 * read-only Auditor teilt denselben Snapshot (ADR-031).
 */
export async function listEventInventorySnapshots(): Promise<
  EventInventorySnapshot[]
> {
  const result = await db
    .select({
      eventId: events.id,
      totalCapacity: events.totalCapacity,
      soldCount: count(tickets.id),
    })
    .from(events)
    .leftJoin(tickets, eq(tickets.eventId, events.id))
    .groupBy(events.id, events.totalCapacity);

  return result;
}

/**
 * Schreibt die vom Projector aggregierten Verkaufsstaende als durable Snapshot
 * nach `events.sold_count` zurueck. Reine Materialisierung fuer direkte Reads
 * (z. B. Sold-Out-Erkennung im Lasttest); die Verfuegbarkeitsrechnung selbst
 * nutzt bereits den frischen `COUNT(tickets)`-Wert aus dem Snapshot. Nur der
 * Worker ruft das auf — kein Verstoss gegen die API-Async-Writes-Regel.
 */
export async function persistEventSoldCounts(
  snapshots: readonly EventInventorySnapshot[],
): Promise<void> {
  for (const snapshot of snapshots) {
    await db
      .update(events)
      .set({ soldCount: snapshot.soldCount })
      .where(eq(events.id, snapshot.eventId));
  }
}

/**
 * Anzahl der Backends, die aktuell auf einen PostgreSQL-Lock warten. Direkter
 * Indikator fuer Hot-Row-Kontention (z. B. der `sold_count`-UPDATE in
 * `buy_ticket`). Read-only Sample aus `pg_stat_activity`; die Query selbst
 * wartet nicht auf einen Lock und verfaelscht die Zaehlung daher nicht.
 */
export type WaitEventType = "Lock" | "LWLock";

export const OBSERVED_WAIT_EVENT_TYPES: readonly WaitEventType[] = [
  "Lock",
  "LWLock",
];

/**
 * Backends currently blocked, grouped by PostgreSQL wait-event class.
 *
 * `Lock` is heavyweight row/relation lock contention — the hot-row signal
 * ADR-026 introduced this for. `LWLock` was added in Phase 4.13: the foreign
 * keys of `orders`/`tickets` take `FOR KEY SHARE` on the same `events` row
 * twice per `buy_ticket`, which surfaces as MultiXact/SLRU pressure under
 * `LWLock`, not `Lock`. A measured `Lock = 0` alone is therefore no acquittal.
 * Types with no waiting backend are absent from the result; the caller fills
 * zeros so every series exists.
 */
export async function countWaitingBackendsByWaitEventType(): Promise<
  Array<{ waitEventType: WaitEventType; waiting: number }>
> {
  const result = await db.execute<{
    wait_event_type: WaitEventType;
    waiting: number;
  }>(
    sql`SELECT wait_event_type, count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type IN ('Lock', 'LWLock') GROUP BY wait_event_type`,
  );

  return result.rows.map((row) => ({
    waitEventType: row.wait_event_type,
    waiting: row.waiting,
  }));
}

export async function markOrderFailed(
  orderId: string,
  failureReason: string,
): Promise<FailedOrderUpdateResult> {
  const result = await db
    .update(orders)
    .set({
      status: "failed",
      failureReason,
      updatedAt: sql`NOW()`,
    })
    .where(eq(orders.id, orderId))
    .returning({ id: orders.id });

  return result.length > 0 ? "updated" : "missing";
}
