import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { loadEnvProfile } from "./load-profile.ts";

/**
 * Die geladene Profil-Datei bestimmt die gesamte Konfiguration. Es gibt keine
 * `.env` mehr und keinen impliziten Fallback — welches Profil laeuft, steht in
 * `HTS_ENV_PROFILE` und ist damit auch im Report ablesbar.
 */
export const ENV_PROFILE = loadEnvProfile();

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]),
    REDIS_URL: z.url(),
    DATABASE_URL: z.url(),
    GOOGLE_CLOUD_PROJECT: z.string().min(1),
    PUBSUB_EMULATOR_HOST: z.string().min(1).optional(),
    PUBSUB_TOPIC_BUY_TICKET: z.string().min(1),
    PUBSUB_SUBSCRIPTION_BUY_TICKET: z.string().min(1),
    // Max. gleichzeitig zugestellte Pub/Sub-Nachrichten pro Worker-Instanz.
    // Seit dem Reserve/Pay-Split (ADR-028) gibt es keinen 1-s-Payment-Mock
    // mehr: der Worker persistiert direkt, daher deckelt dieser Wert die
    // gleichzeitig laufenden Persist-Operationen (Backpressure gegen den
    // DB-Pool), nicht mehr eine kuenstliche ~N-Kaeufe/s-Sleep-Rate.
    PUBSUB_FLOW_CONTROL_MAX_MESSAGES: z.coerce.number().int().positive(),
    // Max. PostgreSQL-Connections pro Prozess (node-postgres Pool).
    DATABASE_POOL_MAX: z.coerce.number().int().positive(),
    // Obere Schranke fuer das Warten auf eine freie Pool-Connection. Ohne sie
    // warten Acquirer unbegrenzt — am buy-only-Plateau von Baseline E bis zu
    // 3.760 gleichzeitig — und Pool-Saettigung erscheint als unbegrenzte
    // Latenz statt als Fehler. Mit Timeout wird sie ein transienter Fehler:
    // der Worker NACKt, Pub/Sub liefert erneut, `worker_redeliveries_total`
    // macht es sichtbar. Deutlich ueber der normalen Wartezeit im Rueckstau
    // (~0,7 s) waehlen, damit nur echte Saettigung ausloest.
    DATABASE_POOL_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive(),
    // Startup-Fail-Fast: obere Schranke, wie lange API/Worker beim Boot auf
    // eine erreichbare Infrastruktur warten, bevor sie mit einer klaren,
    // umsetzbaren Fehlermeldung abbrechen (statt eines opaquen Plugin-Timeouts).
    // Bewusst unter dem Fastify/avvio-Default (10 s) gehalten.
    REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive(),
    // Fachliches Checkout-Fenster. Der ZSet-Score traegt `now + timeout` als
    // Eligibility Deadline; der Pending-Key selbst hat KEIN TTL, damit der
    // Reaper seinen Zustand sicher pruefen kann (ADR-031).
    CHECKOUT_PENDING_TIMEOUT_SECONDS: z.coerce.number().int().positive(),
    WORKER_RESERVATION_REAPER_BATCH_SIZE: z.coerce.number().int().positive(),
    // Eigener Takt des Pending-Reapers (ADR-037): er braucht keinen
    // DB-Snapshot, nur die Event-Ids des letzten Inventory-Cycles, und darf
    // deshalb dichter laufen als der COUNT(tickets)-Zyklus. Bei kurzer
    // Checkout-Deadline (12 s im komprimierten human-pace-Profil) hielte ein
    // 60-s-Takt abgelaufene Ansprueche bis zum Fuenffachen der Deadline.
    WORKER_RESERVATION_REAPER_INTERVAL_SECONDS: z.coerce
      .number()
      .int()
      .positive(),
    REDIS_FINAL_ORDER_TTL_SECONDS: z.coerce.number().int().positive(),
    REDIS_WORKER_PROCESSED_TTL_SECONDS: z.coerce.number().int().positive(),
    // Read-only inventory cycle (ADR-031): one grouped ticket count is shared
    // by the sold-count projector and inventory auditor. There is deliberately
    // no peak mode — increasing the sampling frequency cannot improve
    // correctness and only adds DB load during the sale.
    WORKER_INVENTORY_CYCLE_INTERVAL_SECONDS: z.coerce.number().int().positive(),
    // Schaltet Fastifys automatisches Per-Request-Logging
    // (`incoming request`/`request completed`) ab. Bei 10k+ RPS ist genau das
    // — nicht die wenigen eigenen `log.info` — die versteckte Log-Last. In den
    // Lasttest-Profilen `true`, in dev/test/ci `false`.
    //
    // Bewusst KEIN `z.coerce.boolean()`: das macht jeden nicht-leeren String
    // (auch `"false"`) zu `true`. Stattdessen explizites Enum + Transform.
    DISABLE_REQUEST_LOGGING: z
      .enum(["true", "false"])
      .transform((value) => value === "true"),
  },

  /**
   * Prefix, den clientseitige Variablen tragen muessten. `VITE_` und nicht
   * `PUBLIC_`, weil Vite nur diesen Prefix ins Client-Bundle inlined
   * (ADR-039).
   *
   * Aktuell traegt ihn keine Variable: `apps/web` ist konfigurationsfrei. Die
   * API wird same origin unter `/api/...` angesprochen, die Event-Id ist eine
   * Konstante in `@repo/types`. Solange `client` leer ist, ist der Wert
   * folgenlos — er steht hier fuer den Fall, dass das Frontend doch einmal
   * eine oeffentliche Variable braucht.
   */
  clientPrefix: "VITE_",

  client: {},

  /**
   * What object holds the environment variables at runtime. This is usually
   * `process.env` or `import.meta.env`.
   */
  runtimeEnv: process.env,

  /**
   * By default, this library will feed the environment variables directly to
   * the Zod validator.
   */
  emptyStringAsUndefined: true,
});
