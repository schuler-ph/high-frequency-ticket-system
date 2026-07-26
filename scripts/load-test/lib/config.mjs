/**
 * Load the versioned report policy and PromQL query catalog.
 *
 * These JSON files live under `load-tests/` and are versioned deliberately: a
 * threshold or query change is a report-logic change reviewed alongside the
 * golden fixtures (automation doc, "Proposed repository structure").
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { arch, cpus, platform, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

/** @returns {object} */
export const loadPolicy = () =>
  JSON.parse(
    readFileSync(join(REPO_ROOT, "load-tests", "report-policy.json"), "utf8"),
  );

/** @returns {object} */
export const loadQueries = () =>
  JSON.parse(
    readFileSync(join(REPO_ROOT, "load-tests", "report-queries.json"), "utf8"),
  );

/**
 * Resolve the current Git commit/branch and whether the working tree is dirty.
 * A dirty tree makes a capacity run non-reproducible (see compare
 * compatibility rules), so it is recorded rather than hidden.
 *
 * @returns {{ commit: string, branch: string, dirty: boolean }}
 */
export const getGitInfo = () => {
  const run = (args) =>
    execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  try {
    return {
      commit: run(["rev-parse", "HEAD"]),
      branch: run(["rev-parse", "--abbrev-ref", "HEAD"]),
      dirty: run(["status", "--porcelain"]).length > 0,
    };
  } catch {
    return { commit: "unknown", branch: "unknown", dirty: false };
  }
};

/** @returns {{ platform: string, arch: string, cpuCount: number, memoryBytes: number }} */
export const getHostInfo = () => ({
  platform: platform(),
  arch: arch(),
  cpuCount: cpus().length,
  memoryBytes: totalmem(),
});

/**
 * A minimal preflight gate. Fails fast BEFORE any state is mutated when a hard
 * prerequisite is missing (automation doc, step 1). This MVP checks tool
 * availability and container state; the full target-health matrix in the doc
 * is a follow-up.
 *
 * @param {{ requiredCommands?: string[], requiredContainers?: string[] }} [opts]
 * @returns {{ ok: boolean, problems: string[] }}
 */
export const preflight = (opts = {}) => {
  const requiredCommands = opts.requiredCommands ?? ["node", "pnpm", "k6"];
  const requiredContainers = opts.requiredContainers ?? [
    "hts-postgres",
    "hts-redis",
    "hts-pubsub",
  ];
  const problems = [];

  for (const command of requiredCommands) {
    try {
      execFileSync(command, ["--version"], { stdio: "ignore" });
    } catch {
      problems.push(`Required command not found on PATH: ${command}`);
    }
  }

  try {
    const states = execFileSync(
      "docker",
      ["inspect", "-f", "{{.State.Running}}", ...requiredContainers],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .map((line) => line.trim().toLowerCase());
    requiredContainers.forEach((name, index) => {
      if (states[index] !== "true") {
        problems.push(`Container not running: ${name}`);
      }
    });
  } catch {
    problems.push(
      "Could not verify container state (docker inspect failed); run `docker compose up -d`.",
    );
  }

  return { ok: problems.length === 0, problems };
};

/**
 * Second preflight stage: are the services under test actually reachable?
 *
 * Containers running is not enough — API and worker are host processes started
 * separately (`start:loadtest`). Without this check the orchestrator seeded
 * first and only then discovered the services were down, aborting with a bare
 * `fetch failed` *after* it had already truncated the database and wiped the
 * Prometheus TSDB. That contradicts the promise of step 1 ("fail before
 * mutating any state"), so reachability is verified up front and reported with
 * the command needed to fix it.
 *
 * Kept separate from `preflight()` so that stays synchronous and dependency-free.
 *
 * @param {Array<{ name: string, url: string, hint?: string }>} endpoints
 * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ ok: boolean, problems: string[] }>}
 */
export const checkEndpoints = async (endpoints, opts = {}) => {
  const timeoutMs = opts.timeoutMs ?? 3000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const problems = [];

  for (const { name, url, hint } of endpoints) {
    try {
      const res = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        problems.push(
          `${name} answered ${res.status} at ${url}${hint ? ` — ${hint}` : ""}`,
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      problems.push(
        `${name} unreachable at ${url} (${reason})${hint ? ` — ${hint}` : ""}`,
      );
    }
  }

  return { ok: problems.length === 0, problems };
};

export { REPO_ROOT };
