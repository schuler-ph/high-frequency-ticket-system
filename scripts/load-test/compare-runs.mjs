#!/usr/bin/env node
/**
 * `spike:compare` — compare two derived.json files and print a comparison
 * report. Pure with respect to the outside world: it only reads the two local
 * artifact files (automation doc, "spike:compare").
 *
 * Usage:
 *   node scripts/load-test/compare-runs.mjs <baseline-dir-or-derived.json> <candidate-dir-or-derived.json>
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compareRuns, renderComparison } from "./lib/compare.mjs";

/** Accept either a run directory or a direct derived.json path. */
const readDerived = (pathArg) => {
  const path =
    existsSync(pathArg) && statSync(pathArg).isDirectory()
      ? join(pathArg, "derived.json")
      : pathArg;
  if (!existsSync(path)) {
    throw new Error(`derived.json not found at ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
};

const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  // Tolerate a `--` separator (pnpm run script -- <args>).
  const [baselineArg, candidateArg] = process.argv
    .slice(2)
    .filter((arg) => arg !== "--");
  if (!baselineArg || !candidateArg) {
    console.error(
      "Usage: node scripts/load-test/compare-runs.mjs <baseline> <candidate>",
    );
    process.exit(2);
  }
  const baseline = readDerived(baselineArg);
  const candidate = readDerived(candidateArg);
  const comparison = compareRuns(baseline, candidate);
  process.stdout.write(
    renderComparison(comparison, {
      baselineId: baseline.runId,
      candidateId: candidate.runId,
    }),
  );
  // Exit non-zero when the comparison is not a valid capacity comparison, so
  // this can gate a CI check without misreading an incompatible delta.
  process.exit(comparison.compatible ? 0 : 3);
}
