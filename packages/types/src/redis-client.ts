/**
 * Schmale strukturelle Sicht auf den ioredis-Client (`fastify.redis` aus
 * `@fastify/redis`). Zentrale Definition statt service-lokaler Typ-Schatten,
 * damit Signaturen nicht pro Datei driften (vgl. Redis-Key-Utility in
 * `redis-keys.ts`). Der echte ioredis-Client erfuellt dieses Interface
 * strukturell; Tests mocken nur die Methoden, die sie brauchen (`Pick<>`).
 */
export type RedisClient = {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    mode: "EX",
    seconds: number,
    condition?: "NX",
  ): Promise<"OK" | null>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  incrby(key: string, increment: number): Promise<number>;
  eval(
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
  defineCommand(
    name: string,
    definition: { lua: string; numberOfKeys?: number },
  ): void;
  // Sorted-Set-Operationen fuer den Reservation-Ledger (ADR-026): `zcard`
  // zaehlt aktive Reservierungen in O(1), `zcount` findet Stale-Kandidaten
  // nach Alter (Score = Erstellungszeit). Beide ersetzen den fruehreren
  // Keyspace-`SCAN` im Reconcile-Loop.
  zcard(key: string): Promise<number>;
  zcount(
    key: string,
    min: number | string,
    max: number | string,
  ): Promise<number>;
  mset(values: Record<string, string>): Promise<unknown>;
};
