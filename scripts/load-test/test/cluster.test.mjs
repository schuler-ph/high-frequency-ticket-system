import { test } from "node:test";
import assert from "node:assert/strict";

import { assessCluster, readDeployments } from "../lib/cluster.mjs";

const healthy = {
  deployments: [
    { name: "api", desired: 3, ready: 3, updated: 3, profile: "smoke-test" },
    { name: "worker", desired: 1, ready: 1, updated: 1, profile: "smoke-test" },
  ],
  targetsUp: { api: 3, worker: 1 },
  expectedProfile: "smoke-test",
};

test("a fully ready and fully scraped cluster passes the preflight", () => {
  assert.deepEqual(assessCluster(healthy), []);
});

// Abnahmekriterium aus Phase 5.3: ein Probelauf bricht im Preflight sauber ab,
// wenn ein API-Pod fehlt — bevor Datenbank, Redis und TSDB geleert werden.
test("a missing API pod stops the preflight", () => {
  const problems = assessCluster({
    ...healthy,
    deployments: [
      { name: "api", desired: 3, ready: 2, updated: 3, profile: "smoke-test" },
      healthy.deployments[1],
    ],
    targetsUp: { api: 2, worker: 1 },
  });
  assert.equal(problems.length, 2);
  assert.match(problems[0], /^api: 2\/3 pods ready/);
  assert.match(problems[1], /^api: Prometheus scrapes 2 of 3 pods/);
});

// Ready, aber nicht gescrapt: der Pod nimmt Last an, seine Zaehler fehlen im
// Report. Genau diese stille Untererfassung soll der Preflight verhindern.
test("a ready pod that Prometheus does not scrape stops the preflight", () => {
  const problems = assessCluster({ ...healthy, targetsUp: { api: 3, worker: 0 } });
  assert.deepEqual(problems, [
    "worker: Prometheus scrapes 0 of 1 pods — check localhost:10007/targets.",
  ]);
});

// Das Profil steuert Dinge, die k6 nie sieht (Checkout-Deadline, Reaper-Takt,
// Pool-Groesse). Pods auf `dev` unter einer human-pace-Last messen ein anderes
// System, als der Report behauptet.
test("pods on another profile than the run stop the preflight", () => {
  const problems = assessCluster({ ...healthy, expectedProfile: "browse-and-buy-human-pace" });
  assert.equal(problems.length, 2);
  assert.match(
    problems[0],
    /^api: pods run profile "smoke-test", the run uses "browse-and-buy-human-pace" — `HFTS_ENV=browse-and-buy-human-pace pnpm k8s:profile`/,
  );
});

// Mitten im Rollout sind alle Replicas bereit, aber noch nicht alle auf dem
// neuen Template — gemessen wuerde ein Mischbetrieb aus zwei Profilen.
test("a rollout in progress stops the preflight", () => {
  const problems = assessCluster({
    ...healthy,
    deployments: [
      { name: "api", desired: 3, ready: 3, updated: 2, profile: "smoke-test" },
      healthy.deployments[1],
    ],
  });
  assert.deepEqual(problems, [
    "api: 3/3 pods ready, 2/3 on the current template — `kubectl get pods -l app=api`.",
  ]);
});

test("a deployment scaled to zero is reported once", () => {
  const problems = assessCluster({
    deployments: [{ name: "worker", desired: 0, ready: 0, updated: 0, profile: "smoke-test" }],
    targetsUp: {},
    expectedProfile: "smoke-test",
  });
  assert.deepEqual(problems, ["worker: scaled to 0 replicas — nothing to measure."]);
});

const apiDeployment = {
  metadata: { name: "api" },
  spec: {
    replicas: 3,
    template: {
      spec: {
        containers: [{ envFrom: [{ configMapRef: { name: "hfts-config-abc" } }] }],
      },
    },
  },
  status: { readyReplicas: 3, updatedReplicas: 3 },
};

const workerDeployment = {
  metadata: { name: "worker" },
  spec: {
    replicas: 1,
    template: {
      spec: {
        containers: [
          {
            env: [{ name: "HFTS_ENV", value: "smoke-test" }],
            envFrom: [{ configMapRef: { name: "hfts-config-abc" } }],
          },
        ],
      },
    },
  },
  // Ohne bereiten Pod fehlen readyReplicas und updatedReplicas im Status ganz.
  status: {},
};

test("readDeployments reads replicas and the profile each pod template runs", () => {
  const calls = [];
  const exec = (command, args) => {
    calls.push([command, ...args]);
    if (args.includes("configmap")) {
      return JSON.stringify({ data: { HFTS_ENV: "dev" } });
    }
    return JSON.stringify({ kind: "List", items: [apiDeployment, workerDeployment] });
  };
  assert.deepEqual(readDeployments("kind-hfts", ["api", "worker"], exec), [
    { name: "api", desired: 3, ready: 3, updated: 3, profile: "dev" },
    // Ein explizites env schlaegt die ConfigMap, wie im Container auch.
    { name: "worker", desired: 1, ready: 0, updated: 0, profile: "smoke-test" },
  ]);
  assert.deepEqual(calls, [
    ["kubectl", "--context", "kind-hfts", "get", "deployment", "api", "worker", "-o", "json"],
    ["kubectl", "--context", "kind-hfts", "get", "configmap", "hfts-config-abc", "-o", "json"],
  ]);
});
