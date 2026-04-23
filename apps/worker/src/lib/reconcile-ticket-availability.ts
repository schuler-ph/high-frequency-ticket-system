import type { EventInventorySnapshot } from "@repo/db";
import { ticketRedisKeys } from "@repo/types/redis-keys";

export type { EventInventorySnapshot } from "@repo/db";

export type ReconcileRedisClient = {
  scan: (
    cursor: string,
    matchToken: "MATCH",
    pattern: string,
    countToken: "COUNT",
    count: number,
  ) => Promise<[string, string[]]>;
  mset: (values: Record<string, string>) => Promise<unknown>;
};

export type ReconcileTicketAvailabilityDeps = {
  getEventInventorySnapshots: () => Promise<EventInventorySnapshot[]>;
  redis: ReconcileRedisClient;
  scanCount?: number;
};

const DEFAULT_SCAN_COUNT = 100;

export const calculateAvailableTickets = (
  totalCapacity: number,
  soldCount: number,
  activeReservations: number,
): number => Math.max(totalCapacity - soldCount - activeReservations, 0);

export async function countActiveReservations(
  redis: ReconcileRedisClient,
  eventId: string,
  scanCount = DEFAULT_SCAN_COUNT,
): Promise<number> {
  const keys = ticketRedisKeys(eventId);
  const pattern = `${keys.reservation("")}*`;
  let cursor = "0";
  let activeReservations = 0;

  do {
    const [nextCursor, reservationKeys] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      scanCount,
    );

    activeReservations += reservationKeys.length;
    cursor = nextCursor;
  } while (cursor !== "0");

  return activeReservations;
}

export async function reconcileTicketAvailability(
  deps: ReconcileTicketAvailabilityDeps,
): Promise<void> {
  const eventSnapshots = await deps.getEventInventorySnapshots();

  for (const snapshot of eventSnapshots) {
    const activeReservations = await countActiveReservations(
      deps.redis,
      snapshot.eventId,
      deps.scanCount,
    );
    const available = calculateAvailableTickets(
      snapshot.totalCapacity,
      snapshot.soldCount,
      activeReservations,
    );
    const keys = ticketRedisKeys(snapshot.eventId);

    await deps.redis.mset({
      [keys.total]: String(snapshot.totalCapacity),
      [keys.available]: String(available),
    });
  }
}
