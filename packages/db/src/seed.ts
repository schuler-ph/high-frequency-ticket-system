import { db, events } from "@repo/db";

const EVENT_ID = "00000000-0000-4000-8000-000000000000";

const seed = async () => {
  await db
    .insert(events)
    .values({
      id: EVENT_ID,
      name: "Frequency Festival 20XX",
      totalCapacity: 1_000_000,
      soldCount: 0,
    })
    .onConflictDoNothing();

  console.log("Seed complete", { eventId: EVENT_ID });
};

await seed();
