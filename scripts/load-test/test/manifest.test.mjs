import { test } from "node:test";
import assert from "node:assert/strict";

import {
  redactConfig,
  buildManifest,
  MANIFEST_SCHEMA_VERSION,
} from "../lib/manifest.mjs";
import { checkEndpoints } from "../lib/config.mjs";

test("redactConfig keeps only allowlisted, non-empty settings", () => {
  const out = redactConfig({
    NODE_ENV: "production",
    LOG_LEVEL: "warn",
    DATABASE_URL: "postgres://user:secret@host/db",
    REDIS_URL: "redis://host",
    PUBSUB_FLOW_CONTROL_MAX_MESSAGES: "2000",
    LOAD_PROFILE: "",
    SOME_TOKEN: "abc",
  });
  assert.deepEqual(out, {
    NODE_ENV: "production",
    LOG_LEVEL: "warn",
    PUBSUB_FLOW_CONTROL_MAX_MESSAGES: "2000",
  });
  assert.equal("DATABASE_URL" in out, false);
  assert.equal("SOME_TOKEN" in out, false);
});

test("buildManifest sets schema version and defaults all timestamp slots", () => {
  const m = buildManifest({ runId: "2026-07-23T00-00-00Z-abc1234" });
  assert.equal(m.schemaVersion, MANIFEST_SCHEMA_VERSION);
  assert.equal(m.runId, "2026-07-23T00-00-00Z-abc1234");
  assert.deepEqual(Object.keys(m.timestamps).sort(), [
    "drainEndedAt",
    "phaseAEndedAt",
    "seededAt",
    "workloadEndedAt",
    "workloadStartedAt",
  ]);
  assert.equal(m.timestamps.seededAt, null);
});

test("buildManifest passes through provided git / capacity", () => {
  const m = buildManifest({
    runId: "r1",
    git: { commit: "deadbeef", branch: "main", dirty: false },
    capacity: { totalCapacity: 1000000, opensAt: 0 },
  });
  assert.equal(m.git.commit, "deadbeef");
  assert.equal(m.capacity.totalCapacity, 1000000);
});

// --- Preflight-Stufe 2: Erreichbarkeit der Services ------------------------
// Regression: `spike:report` setzte erst die DB zurueck und scheiterte dann mit
// einem nackten `fetch failed`, weil laufende Container nichts darueber sagen,
// ob die Host-Prozesse API/Worker laufen.

test("checkEndpoints reports every unreachable service with its fix hint", async () => {
  const result = await checkEndpoints(
    [
      { name: "API", url: "http://localhost:1/metrics", hint: "start it" },
      { name: "Worker", url: "http://localhost:2/metrics" },
    ],
    { fetchImpl: async () => { throw new Error("connect ECONNREFUSED"); } },
  );

  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 2);
  assert.match(result.problems[0], /API unreachable/);
  assert.match(result.problems[0], /start it/);
  assert.match(result.problems[1], /Worker unreachable/);
});

test("checkEndpoints treats a non-2xx answer as a problem", async () => {
  const result = await checkEndpoints([{ name: "API", url: "http://x/metrics" }], {
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /answered 503/);
});

test("checkEndpoints passes when every service answers", async () => {
  const result = await checkEndpoints(
    [
      { name: "API", url: "http://x/metrics" },
      { name: "Worker", url: "http://y/metrics" },
    ],
    { fetchImpl: async () => ({ ok: true, status: 200 }) },
  );
  assert.deepEqual(result, { ok: true, problems: [] });
});
