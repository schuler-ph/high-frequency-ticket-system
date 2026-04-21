import { sql, eq } from "drizzle-orm";
import type { BuyTicketEvent } from "@repo/types/tickets";
import { db } from "./index.js";
import { orders } from "./schema.js";

export type FailedOrderUpdateResult = "updated" | "missing";

export async function executeBuyTicket(
  payload: BuyTicketEvent,
): Promise<string | null> {
  const result = await db.execute<{ ticket_id: string | null }>(
    sql`SELECT buy_ticket(${payload.eventId}, ${payload.orderId}, ${payload.firstName}, ${payload.lastName}) AS ticket_id`,
  );

  return result.rows[0]?.ticket_id ?? null;
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