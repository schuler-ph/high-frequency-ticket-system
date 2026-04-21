import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { env } from "@repo/env";
import { events, orders, tickets } from "../src/schema.js";
import { executeBuyTicket, markOrderFailed } from "../src/order-processing.js";

void describe("order processing actions", () => {
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  const database = drizzle(pool);

  after(async () => {
    await pool.end();
  });

  void it("executeBuyTicket persists ticket and completes the order", async () => {
    const [event] = await database
      .insert(events)
      .values({
        name: "Order Processing Event",
        totalCapacity: 5,
      })
      .returning();

    assert.ok(event);

    const orderId = randomUUID();

    const ticketId = await executeBuyTicket({
      orderId,
      eventId: event.id,
      firstName: "Ada",
      lastName: "Lovelace",
    });

    assert.ok(ticketId);

    const [storedOrder] = await database
      .select({
        status: orders.status,
        failureReason: orders.failureReason,
      })
      .from(orders)
      .where(eq(orders.id, orderId));

    assert.equal(storedOrder?.status, "completed");
    assert.equal(storedOrder?.failureReason, null);

    const [storedTicket] = await database
      .select({
        id: tickets.id,
        orderId: tickets.orderId,
        eventId: tickets.eventId,
      })
      .from(tickets)
      .where(eq(tickets.id, ticketId!));

    assert.equal(storedTicket?.id, ticketId);
    assert.equal(storedTicket?.orderId, orderId);
    assert.equal(storedTicket?.eventId, event.id);

    await database.delete(tickets).where(eq(tickets.id, ticketId!));
    await database.delete(orders).where(eq(orders.id, orderId));
    await database.delete(events).where(eq(events.id, event.id));
  });

  void it("markOrderFailed marks an existing order as failed", async () => {
    const [event] = await database
      .insert(events)
      .values({
        name: "Failed Order Event",
        totalCapacity: 5,
      })
      .returning();

    assert.ok(event);

    const [order] = await database
      .insert(orders)
      .values({
        eventId: event.id,
      })
      .returning();

    assert.ok(order);

    const result = await markOrderFailed(order.id, "payment declined");

    assert.equal(result, "updated");

    const [storedOrder] = await database
      .select({
        status: orders.status,
        failureReason: orders.failureReason,
      })
      .from(orders)
      .where(eq(orders.id, order.id));

    assert.equal(storedOrder?.status, "failed");
    assert.equal(storedOrder?.failureReason, "payment declined");

    await database.delete(orders).where(eq(orders.id, order.id));
    await database.delete(events).where(eq(events.id, event.id));
  });

  void it("markOrderFailed returns missing for unknown orders", async () => {
    const result = await markOrderFailed(randomUUID(), "missing order");

    assert.equal(result, "missing");
  });

  void it("executeBuyTicket raises P0001 when event does not exist", async () => {
    await assert.rejects(
      async () => {
        await executeBuyTicket({
          orderId: randomUUID(),
          eventId: randomUUID(),
          firstName: "Missing",
          lastName: "Event",
        });
      },
      (error: unknown) => {
        if (!error || typeof error !== "object") {
          return false;
        }

        const directCode =
          "code" in error && typeof error.code === "string"
            ? error.code
            : undefined;

        const causeCode =
          "cause" in error &&
          error.cause &&
          typeof error.cause === "object" &&
          "code" in error.cause &&
          typeof error.cause.code === "string"
            ? error.cause.code
            : undefined;

        return directCode === "P0001" || causeCode === "P0001";
      },
    );
  });
});
