#!/usr/bin/env node
/**
 * Destruktiver Zustands-Reset unmittelbar vor einem Lauf.
 *
 * Der Zeitpunkt ist Teil der Semantik: `opensAt` wird als `Date.now() + N`
 * geschrieben und verfaellt, wenn danach noch Minuten vergehen. Deshalb gehoert
 * dieser Schritt an den Anfang des Laufs und NICHT ans Hochfahren des Stacks —
 * dort wuerde das Sale-Unlock-Gate schon offen sein, bevor k6 seine Warm-up-
 * Phase faehrt, die `425 Too Early` erwartet.
 *
 * Setzt eine bereits provisionierte Infrastruktur voraus (`pnpm provision`).
 */
import {
  checkContainers,
  purgeSubscription,
  resetDatabaseState,
  resetPrometheus,
  resetRedis,
  runEntrypoint,
} from "./lib/stack-steps.mjs";

const log = (message) => console.log(`[local:reset] ${message}`);

runEntrypoint("local:reset", async () => {
  log("Validating local infrastructure...");
  checkContainers();

  // Erst die Queue leeren, dann den Rest: eine Nachricht, die zwischen Truncate
  // und Purge zugestellt wird, wuerde sonst eine Order ohne Reservierung
  // erzeugen.
  await purgeSubscription(log);
  const events = resetDatabaseState(log);
  resetRedis(log);
  resetPrometheus(log);

  log("Completed successfully.");
  log(`Seeded events: ${events.map((event) => event.id).join(", ")}`);
});
