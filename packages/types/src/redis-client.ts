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
  scan(
    cursor: string,
    matchToken: "MATCH",
    pattern: string,
    countToken: "COUNT",
    count: number,
  ): Promise<[string, string[]]>;
  mset(values: Record<string, string>): Promise<unknown>;
};
