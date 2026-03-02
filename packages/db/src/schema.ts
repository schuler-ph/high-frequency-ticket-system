import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  totalCapacity: integer("total_capacity").notNull(),
  soldCount: integer("sold_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tickets = pgTable("tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .references(() => events.id)
    .notNull(),
  firstName: varchar("first_name", { length: 255 }).notNull(),
  lastName: varchar("last_name", { length: 255 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("valid"), // valid, cancelled
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
