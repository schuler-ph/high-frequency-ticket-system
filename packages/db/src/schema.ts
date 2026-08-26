import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  integer,
  index,
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

export const tickets = pgTable(
  "tickets",
  {
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
  },
  (table) => [
    // Der Duplikat-Zweig von `buy_ticket` (ON CONFLICT auf orders → Ticket per
    // `WHERE order_id = p_order_id` zurueckgeben) scannte ohne Index sequenziell
    // ueber ~1 Mio Zeilen; ein Fremdschluessel legt in PostgreSQL keinen an.
    // In Baseline E ohne Wirkung (0 Redeliveries), unter Retry-Druck relevant.
    index("tickets_order_id_idx").on(table.orderId),
  ],
);

export const drizzleSqlMigrations = pgTable("drizzle_sql_migrations", {
  tag: text("tag").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
