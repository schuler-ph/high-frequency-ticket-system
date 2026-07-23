/**
 * Load the versioned report policy and PromQL query catalog.
 *
 * These JSON files live under `load-tests/` and are versioned deliberately: a
 * threshold or query change is a report-logic change reviewed alongside the
 * golden fixtures (automation doc, "Proposed repository structure").
 */

import { readFileSync } from "node:fs";
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

export { REPO_ROOT };
