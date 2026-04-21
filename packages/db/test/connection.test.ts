import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { env } from "@repo/env";
import * as schema from "../src/schema.js";
import { events, orders, tickets } from "../src/schema.js";

const DATABASE_URL = env.DATABASE_URL;

void describe("database integration", () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool, { schema });

  after(async () => {
    await pool.end();
  });

  void it("should connect and execute a raw query", async () => {
    const result = await db.execute(sql`SELECT 1 as ok`);
    assert.equal(result.rows[0]?.ok, 1);
  });

  void it("should have the events table", async () => {
    const result = await db.select().from(events).limit(0);
    assert.ok(Array.isArray(result));
  });

  void it("should have the tickets table", async () => {
    const result = await db.select().from(tickets).limit(0);
    assert.ok(Array.isArray(result));
  });

  void it("should insert and read back an event", async () => {
    const [inserted] = await db
      .insert(events)
      .values({
        name: "Integration Test Event",
        totalCapacity: 100,
      })
      .returning();

    assert.ok(inserted);
    assert.equal(inserted.name, "Integration Test Event");
    assert.equal(inserted.totalCapacity, 100);
    assert.equal(inserted.soldCount, 0);
    assert.ok(inserted.id);
    assert.ok(inserted.createdAt);

    const [order] = await db
      .insert(orders)
      .values({
        eventId: inserted.id,
      })
      .returning();

    assert.ok(order);
    assert.equal(order.eventId, inserted.id);

    // insert a ticket for this event
    const [ticket] = await db
      .insert(tickets)
      .values({
        eventId: inserted.id,
        orderId: order.id,
        firstName: "Test",
        lastName: "User",
      })
      .returning();

    assert.ok(ticket);
    assert.equal(ticket.eventId, inserted.id);
    assert.equal(ticket.orderId, order.id);
    assert.equal(ticket.status, "valid");

    // cleanup
    await db.delete(tickets).where(sql`${tickets.id} = ${ticket.id}`);
    await db.delete(orders).where(sql`${orders.id} = ${order.id}`);
    await db.delete(events).where(sql`${events.id} = ${inserted.id}`);
  });

  void it("buy_ticket should raise P0001 when event does not exist", async () => {
    const missingEventId = randomUUID();
    const orderId = randomUUID();

    await assert.rejects(
      async () => {
        await db.execute(
          sql`SELECT buy_ticket(${missingEventId}, ${orderId}, ${"Missing"}, ${"Event"})`,
        );
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

  void it("buy_ticket should be idempotent for duplicate orderId", async () => {
    const [insertedEvent] = await db
      .insert(events)
      .values({
        name: "Idempotent Order Event",
        totalCapacity: 10,
      })
      .returning();

    assert.ok(insertedEvent);
    const orderId = randomUUID();

    const firstCall = await db.execute(
      sql`SELECT buy_ticket(${insertedEvent.id}, ${orderId}, ${"First"}, ${"Buyer"}) AS ticket_id`,
    );
    const secondCall = await db.execute(
      sql`SELECT buy_ticket(${insertedEvent.id}, ${orderId}, ${"First"}, ${"Buyer"}) AS ticket_id`,
    );

    assert.ok(firstCall.rows[0]?.ticket_id);
    assert.equal(secondCall.rows[0]?.ticket_id, null);

    const [eventAfter] = await db
      .select({ soldCount: events.soldCount })
      .from(events)
      .where(eq(events.id, insertedEvent.id));

    assert.equal(eventAfter?.soldCount, 1);

    const ticketsForEvent = await db
      .select({
        id: tickets.id,
        orderId: tickets.orderId,
      })
      .from(tickets)
      .where(eq(tickets.eventId, insertedEvent.id));

    assert.equal(ticketsForEvent.length, 1);
    assert.equal(ticketsForEvent[0]?.orderId, orderId);

    const [persistedOrder] = await db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(eq(orders.id, orderId));

    assert.equal(persistedOrder?.id, orderId);
    assert.equal(persistedOrder?.status, "completed");

    await db.delete(tickets).where(eq(tickets.eventId, insertedEvent.id));
    await db.delete(orders).where(eq(orders.id, orderId));
    await db.delete(events).where(eq(events.id, insertedEvent.id));
  });
});
