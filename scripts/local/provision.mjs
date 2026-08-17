#!/usr/bin/env node
/**
 * Idempotente Provisionierung: Schema, Topic, Subscription.
 *
 * Muss vor den Services laufen — der Worker scheitert beim Boot hart, wenn die
 * Subscription fehlt (RUNBOOK §3, Falle 1). Loescht nichts und ist deshalb
 * gefahrlos wiederholbar, auch waehrend API und Worker laufen.
 */
import {
  applySchema,
  checkContainers,
  provisionPubSub,
  runEntrypoint,
} from "./lib/stack-steps.mjs";

const log = (message) => console.log(`[local:provision] ${message}`);

runEntrypoint("local:provision", async () => {
  log("Validating local infrastructure...");
  checkContainers();

  applySchema(log);
  const subscription = await provisionPubSub(log);

  log("Completed successfully.");
  log(`Active Pub/Sub subscription: ${subscription}`);
});
