import { db, orders } from "@repo/db";
import { eq, sql } from "drizzle-orm";

export type FailedOrderUpdateResult = "updated" | "missing";

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
