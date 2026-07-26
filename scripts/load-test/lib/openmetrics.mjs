/**
 * Pure parser for the Prometheus/OpenMetrics text exposition format.
 *
 * The report collector snapshots each service's `/metrics` endpoint directly
 * (before and after the run) because service counters survive database resets
 * and are more deterministic than transcribing absolute Prometheus counters
 * (see docs/suggested/LOAD-TEST-REPORT-AUTOMATION.md, step 2). This module turns
 * that raw text into queryable samples; every function here is side-effect-free
 * and unit-tested without a running load test.
 */

/**
 * Parse an OpenMetrics/Prometheus exposition text body into flat samples.
 *
 * Comment lines (`# HELP`, `# TYPE`, ...) and blank lines are ignored. Each
 * remaining line is `metric_name{label="value",...} value [timestamp]`; the
 * optional trailing timestamp is discarded. Values `NaN`, `+Inf`, `-Inf` are
 * parsed to the corresponding JS numbers.
 *
 * @param {string} text
 * @returns {Array<{ name: string, labels: Record<string, string>, value: number }>}
 */
export const parseOpenMetrics = (text) => {
  if (typeof text !== "string" || text.length === 0) return [];

  const samples = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const braceStart = line.indexOf("{");
    let name;
    let labels = {};
    let rest;

    if (braceStart === -1) {
      // No labels: `name value [timestamp]`.
      const firstSpace = line.indexOf(" ");
      if (firstSpace === -1) continue;
      name = line.slice(0, firstSpace);
      rest = line.slice(firstSpace + 1).trim();
    } else {
      const braceEnd = line.indexOf("}", braceStart);
      if (braceEnd === -1) continue;
      name = line.slice(0, braceStart);
      labels = parseLabels(line.slice(braceStart + 1, braceEnd));
      rest = line.slice(braceEnd + 1).trim();
    }

    const valueToken = rest.split(/\s+/)[0];
    const value = parseSampleValue(valueToken);
    if (value === undefined) continue;

    samples.push({ name, labels, value });
  }

  return samples;
};

/**
 * Parse the inside of a `{...}` label set. Handles escaped quotes and
 * backslashes per the exposition format spec.
 *
 * @param {string} body
 * @returns {Record<string, string>}
 */
const parseLabels = (body) => {
  const labels = {};
  // Matches `key="value"` where value may contain escaped `\"` and `\\`.
  const labelPattern = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"\\])*)"/g;
  let match;
  while ((match = labelPattern.exec(body)) !== null) {
    const [, key, rawValue] = match;
    labels[key] = rawValue
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\\\/g, "\\");
  }
  return labels;
};

/**
 * @param {string | undefined} token
 * @returns {number | undefined}
 */
const parseSampleValue = (token) => {
  if (token === undefined || token.length === 0) return undefined;
  if (token === "NaN") return Number.NaN;
  if (token === "+Inf" || token === "Inf") return Number.POSITIVE_INFINITY;
  if (token === "-Inf") return Number.NEGATIVE_INFINITY;
  const value = Number(token);
  return Number.isNaN(value) ? undefined : value;
};

/**
 * @param {Record<string, string>} labels
 * @param {Record<string, string>} filter
 * @returns {boolean}
 */
const labelsMatch = (labels, filter) =>
  Object.entries(filter).every(([key, value]) => labels[key] === value);

/**
 * Sum every sample of `name` whose labels match `labelFilter`. Returns `null`
 * when no sample matches, so callers can distinguish "series absent" from
 * "series present and zero" (the No-data decision table in the automation doc).
 *
 * @param {ReturnType<typeof parseOpenMetrics>} samples
 * @param {string} name
 * @param {Record<string, string>} [labelFilter]
 * @returns {number | null}
 */
export const sumSamples = (samples, name, labelFilter = {}) => {
  let total = null;
  for (const sample of samples) {
    if (sample.name !== name) continue;
    if (!labelsMatch(sample.labels, labelFilter)) continue;
    total = (total ?? 0) + sample.value;
  }
  return total;
};

/**
 * Reconstruct a histogram from its `_bucket`/`_count`/`_sum` series, summing
 * across all label combinations that match `labelFilter` (e.g. every
 * `event_id`/`status`). Buckets are returned sorted by `le` ascending, with
 * `+Inf` last. Returns `null` when the histogram is absent.
 *
 * @param {ReturnType<typeof parseOpenMetrics>} samples
 * @param {string} name Base metric name, e.g. `order_e2e_latency_seconds`.
 * @param {Record<string, string>} [labelFilter]
 * @returns {{ buckets: Array<{ le: number, cumulativeCount: number }>, count: number | null, sum: number | null } | null}
 */
export const getHistogram = (samples, name, labelFilter = {}) => {
  const bucketByLe = new Map();
  for (const sample of samples) {
    if (sample.name !== `${name}_bucket`) continue;
    if (!labelsMatch(sample.labels, labelFilter)) continue;
    const leRaw = sample.labels.le;
    if (leRaw === undefined) continue;
    const le = parseSampleValue(leRaw);
    if (le === undefined) continue;
    bucketByLe.set(le, (bucketByLe.get(le) ?? 0) + sample.value);
  }

  const count = sumSamples(samples, `${name}_count`, labelFilter);
  const sum = sumSamples(samples, `${name}_sum`, labelFilter);

  if (bucketByLe.size === 0 && count === null && sum === null) return null;

  const buckets = [...bucketByLe.entries()]
    .map(([le, cumulativeCount]) => ({ le, cumulativeCount }))
    .sort((a, b) => a.le - b.le);

  return { buckets, count, sum };
};
