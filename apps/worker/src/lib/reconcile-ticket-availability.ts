import type { EventInventorySnapshot } from "@repo/db";
import { ticketRedisKeys } from "@repo/types/redis-keys";
import type { RedisClient } from "@repo/types/redis-client";

export type { EventInventorySnapshot } from "@repo/db";

export type ReconcileRedisClient = Pick<
  RedisClient,
  "get" | "mset" | "incrby" | "zcard" | "zcount"
>;

export type ReconcileTicketAvailabilityDeps = {
  getEventInventorySnapshots: () => Promise<EventInventorySnapshot[]>;
  // Schreibt den aggregierten `COUNT(tickets)`-Verkaufsstand als Snapshot nach
  // `events.sold_count` zurueck (Backlog #7). Optional: fehlt der Dep, laeuft
  // Reconcile unveraendert, nur ohne Materialisierung.
  persistSoldCounts?: (
    snapshots: readonly EventInventorySnapshot[],
  ) => Promise<void>;
  redis: ReconcileRedisClient;
  // Reservierungen, deren Erstellungszeit (ZSet-Score) aelter als dieser
  // Schwellwert ist, gelten als Stale-Kandidaten fuer den Reaper (Phase 6).
  // Sie werden nur gezaehlt/gemeldet, NIE automatisch zurueckgebucht.
  staleReservationThresholdMs?: number;
  now?: () => number;
  onEventReconciled?: (
    eventId: string,
    redisAvailable: number,
    computedAvailable: number,
  ) => void;
  onReservationLedgerMeasured?: (
    eventId: string,
    activeReservations: number,
    staleReservations: number,
  ) => void;
};

const DEFAULT_STALE_RESERVATION_THRESHOLD_MS = 900_000;

/**
 * Erwarteter `available`-Stand aus DB- und Ledger-Sicht — **bewusst
 * ungeklammert**. Ein negativer Wert ist keine Rechen-Anomalie, sondern das
 * Ueberzeichnungs-Signal: es existieren mehr Ansprueche (verkauft + im Ledger
 * gehalten) als Kapazitaet. Baseline C endete mit Erwartungswert −389; die
 * fruehere `Math.max(…, 0)`-Klammer hier machte den Drift-Gauge genau dafuer
 * blind (Gauge zeigte 0, waehrend der Report korrekt +389 auswies — Report §5).
 * Geklammert wird erst am Redis-**Write** (`clampForRedisWrite`), denn ein
 * negativer Counter darf nie geschrieben werden.
 */
export const calculateExpectedAvailable = (
  totalCapacity: number,
  soldCount: number,
  activeReservations: number,
): number => totalCapacity - soldCount - activeReservations;

/** Redis-`available` ist ein Bestand und darf nie negativ geschrieben werden. */
export const clampForRedisWrite = (expectedAvailable: number): number =>
  Math.max(expectedAvailable, 0);

/**
 * Zaehlt aktive (akzeptiert, noch nicht finalisierte) Reservierungen als
 * ZSet-Kardinalitaet — O(1) statt eines Keyspace-`SCAN` (ADR-026). Jeder
 * Ledger-Eintrag ist ein Inventar-Anspruch, unabhaengig vom Alter; Ablauf
 * fuehrt nie zu automatischer Rueckbuchung von `available`.
 */
export async function countActiveReservations(
  redis: ReconcileRedisClient,
  eventId: string,
): Promise<number> {
  return redis.zcard(ticketRedisKeys(eventId).reservations);
}

/**
 * Zaehlt Ledger-Eintraege, deren Score (Erstellungszeit) aelter als
 * `olderThanMs` ist — Stale-Kandidaten fuer den Reaper. Reine Observability,
 * loest keine Kompensation aus.
 */
export async function countStaleReservations(
  redis: ReconcileRedisClient,
  eventId: string,
  olderThanMs: number,
): Promise<number> {
  return redis.zcount(ticketRedisKeys(eventId).reservations, 0, olderThanMs);
}

export async function reconcileTicketAvailability(
  deps: ReconcileTicketAvailabilityDeps,
): Promise<void> {
  const now = deps.now ?? Date.now;
  const staleThresholdMs =
    deps.staleReservationThresholdMs ?? DEFAULT_STALE_RESERVATION_THRESHOLD_MS;

  // Leseordnung: **Ledger VOR der DB** — die Reihenfolge traegt die
  // Korrektheit. Redis und PostgreSQL lassen sich nicht in eine Transaktion
  // fassen; eine Order, die zwischen den beiden Reads finalisiert (Worker macht
  // DB-Insert, dann `ZREM`), wird je nach Ordnung verschieden gezaehlt:
  //
  //   DB zuerst (der Baseline-C-Bug): bei der DB-Messung noch nicht verkauft,
  //   bei der Ledger-Messung schon entfernt → zaehlt NIRGENDS → `expected`
  //   zu hoch → die Delta-Korrektur ERFINDET Inventar. So entstanden 389
  //   Ansprueche ueber Kapazitaet (~65 pro Lauf bei 2.507 Orders/s, Report §5).
  //
  //   Ledger zuerst (jetzt): im Ledger noch gezaehlt UND in der DB schon
  //   verkauft → zaehlt DOPPELT → `expected` zu niedrig → die Korrektur
  //   ENTFERNT Inventar. Konservativ (kein Oversell-Risiko), und die naechste
  //   ruhige Runde gleicht es wieder aus.
  //
  // Der erste Snapshot liefert nur die Event-Ids (sein soldCount wird bewusst
  // verworfen); nach der Ledger-Messung liest der zweite Snapshot die
  // massgeblichen soldCounts. Kostet eine zusaetzliche COUNT-Aggregation pro
  // Reconcile-Lauf (alle 10–60 s, nie auf dem Hot Path) — der Preis fuer die
  // richtige Fehlerrichtung.
  const preliminarySnapshots = await deps.getEventInventorySnapshots();

  const ledgerByEvent = new Map<
    string,
    { activeReservations: number; staleReservations: number }
  >();
  for (const snapshot of preliminarySnapshots) {
    const activeReservations = await countActiveReservations(
      deps.redis,
      snapshot.eventId,
    );
    const staleReservations = await countStaleReservations(
      deps.redis,
      snapshot.eventId,
      now() - staleThresholdMs,
    );
    ledgerByEvent.set(snapshot.eventId, {
      activeReservations,
      staleReservations,
    });
    deps.onReservationLedgerMeasured?.(
      snapshot.eventId,
      activeReservations,
      staleReservations,
    );
  }

  const eventSnapshots = await deps.getEventInventorySnapshots();

  for (const snapshot of eventSnapshots) {
    const keys = ticketRedisKeys(snapshot.eventId);
    // Ein Event, das erst zwischen den beiden Snapshots entstand, hat keine
    // Vorab-Messung — dann jetzt messen. Fuer ein soeben angelegtes Event kann
    // keine Order zwischen den Reads finalisiert haben.
    const activeReservations =
      ledgerByEvent.get(snapshot.eventId)?.activeReservations ??
      (await countActiveReservations(deps.redis, snapshot.eventId));

    const expectedAvailable = calculateExpectedAvailable(
      snapshot.totalCapacity,
      snapshot.soldCount,
      activeReservations,
    );
    const writeTarget = clampForRedisWrite(expectedAvailable);

    const redisRaw = await deps.redis.get(keys.available);

    if (redisRaw === null) {
      // Bootstrap: Key fehlt (z. B. leeres Redis nach Restart) → absolut
      // initialisieren; hier kann kein paralleler Kauf verloren gehen. Die
      // Metrik sieht den ungeklammerten Erwartungswert.
      deps.onEventReconciled?.(
        snapshot.eventId,
        writeTarget,
        expectedAvailable,
      );
      await deps.redis.mset({
        [keys.total]: String(snapshot.totalCapacity),
        [keys.available]: String(writeTarget),
      });
      continue;
    }

    const redisAvailable = parseInt(redisRaw, 10);
    // Ungeklammert an die Metrik: bei Ueberzeichnung ist `expectedAvailable`
    // negativ und `redis_db_drift_tickets` zeigt den Ueberhang positiv an,
    // statt ihn zu verschlucken.
    deps.onEventReconciled?.(
      snapshot.eventId,
      redisAvailable,
      expectedAvailable,
    );

    await deps.redis.mset({
      [keys.total]: String(snapshot.totalCapacity),
    });

    // Delta-Korrektur statt absolutem Ueberschreiben: Reservierungen (DECRs),
    // die zwischen Messung und Korrektur passieren, gehen nicht verloren.
    // Korrigiert wird auf den GEKLAMMERTEN Zielwert — `available` unter 0 zu
    // druecken wuerde nur einen negativen Bestand schreiben, den kein Kaeufer
    // je sieht; die Ueberzeichnung selbst berichtet die Metrik oben.
    const correction = redisAvailable - writeTarget;
    if (correction !== 0) {
      await deps.redis.incrby(keys.available, -correction);
    }
  }

  // Aggregierten Verkaufsstand als durable Snapshot zurueckschreiben, nachdem
  // Redis korrigiert wurde. Erst am Ende, damit ein Fehler beim Persistieren
  // die Redis-Korrektur nicht verhindert. Bewusst der ZWEITE (frischere)
  // Snapshot.
  await deps.persistSoldCounts?.(eventSnapshots);
}
