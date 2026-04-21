import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  integer,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "completed",
  "failed",
]);

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  totalCapacity: integer("total_capacity").notNull(),
  soldCount: integer("sold_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .references(() => events.id)
    .notNull(),
  status: orderStatusEnum("status").notNull().default("pending"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const tickets = pgTable("tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .references(() => events.id)
    .notNull(),
  orderId: uuid("order_id")
    .references(() => orders.id)
    .notNull(),
  firstName: varchar("first_name", { length: 255 }).notNull(),
  lastName: varchar("last_name", { length: 255 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("valid"), // valid, cancelled
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
