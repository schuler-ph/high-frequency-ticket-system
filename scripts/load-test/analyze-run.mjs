#!/usr/bin/env node
/**
 * `spike:analyze` — recompute derived.json + report.md from an existing
 * artifact directory ONLY. Performs no network or database access, so report
 * logic is testable and historical runs can be re-rendered after template
 * changes (automation doc, "spike:analyze").
 *
 * Usage: node scripts/load-test/analyze-run.mjs <run-directory>
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { deriveReport } from "./lib/analyze.mjs";
import { renderReport } from "./lib/render-markdown.mjs";
import { loadPolicy } from "./lib/config.mjs";

/** Read + parse a JSON artifact, or return `fallback` when absent. */
const readJson = (path, fallback = null) => {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
};

/** Read a text artifact, or return "" when absent. */
const readText = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");

/**
 * Load every artifact file in a run directory into the plain objects that
 * {@link deriveReport} consumes. This is the only I/O the analyzer does — it
 * reads local files, never the network or a database.
 *
 * @param {string} runDir
 * @param {object} policy
 * @returns {object}
 */
export const analyzeRunDir = (runDir, policy) => {
  const manifest = readJson(join(runDir, "manifest.json"), {});
  return deriveReport({
    manifest,
    phaseA: readJson(join(runDir, "k6", "phase-a-summary.json")),
    phaseB: readJson(join(runDir, "k6", "phase-b-summary.json")),
    phaseAMeta: readJson(join(runDir, "k6", "phase-a-meta.json")),
    phaseBMeta: readJson(join(runDir, "k6", "phase-b-meta.json")),
    metricsBefore: {
      api: readText(join(runDir, "metrics", "api-before.prom")),
      worker: readText(join(runDir, "metrics", "worker-before.prom")),
    },
    metricsAfter: {
      api: readText(join(runDir, "metrics", "api-after.prom")),
      worker: readText(join(runDir, "metrics", "worker-after.prom")),
    },
    stateBefore: readJson(join(runDir, "state", "before.json")),
    stateAfter: readJson(join(runDir, "state", "after.json")),
    drain: readJson(join(runDir, "drain.json")),
    health: readJson(join(runDir, "health.json"), {}),
    policy,
  });
};

/**
 * Analyze a run directory and write derived.json + report.md into it.
 *
 * @param {string} runDir
 * @param {object} policy
 * @returns {{ derived: object, reportPath: string, derivedPath: string }}
 */
export const analyzeAndWrite = (runDir, policy) => {
  const derived = analyzeRunDir(runDir, policy);
  const markdown = renderReport(derived);

  const derivedPath = join(runDir, "derived.json");
  const reportPath = join(runDir, "report.md");
  writeFileSync(derivedPath, JSON.stringify(derived, null, 2) + "\n");
  writeFileSync(reportPath, markdown);

  return { derived, reportPath, derivedPath };
};

const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const runDir = process.argv[2];
  if (!runDir) {
    console.error("Usage: node scripts/load-test/analyze-run.mjs <run-dir>");
    process.exit(2);
  }
  const policy = loadPolicy();
  const { derived, reportPath, derivedPath } = analyzeAndWrite(runDir, policy);
  console.log(`[spike:analyze] Wrote ${derivedPath} and ${reportPath}`);
  console.log(
    `[spike:analyze] benchmark=${derived.validity.benchmark.verdict} system=${derived.validity.system.verdict}`,
  );
}
