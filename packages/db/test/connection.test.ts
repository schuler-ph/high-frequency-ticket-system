import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import { env } from "@repo/env";
import * as schema from "../src/schema.js";
import { events, tickets } from "../src/schema.js";

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

    // insert a ticket for this event
    const [ticket] = await db
      .insert(tickets)
      .values({
        eventId: inserted.id,
        firstName: "Test",
        lastName: "User",
      })
      .returning();

    assert.ok(ticket);
    assert.equal(ticket.eventId, inserted.id);
    assert.equal(ticket.status, "valid");

    // cleanup
    await db.delete(tickets).where(sql`${tickets.id} = ${ticket.id}`);
    await db.delete(events).where(sql`${events.id} = ${inserted.id}`);
  });
});
