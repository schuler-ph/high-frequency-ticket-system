import { sql, eq } from "drizzle-orm";
import type { BuyTicketEvent } from "@repo/types/tickets";
import { db } from "./index.ts";
import { events, orders } from "./schema.ts";

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

export async function listEventInventorySnapshots(): Promise<
  EventInventorySnapshot[]
> {
  const result = await db
    .select({
      eventId: events.id,
      totalCapacity: events.totalCapacity,
      soldCount: events.soldCount,
    })
    .from(events);

  return result;
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
