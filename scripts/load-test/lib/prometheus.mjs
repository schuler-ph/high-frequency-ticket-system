/**
 * Thin Prometheus HTTP API client for the measurement chain.
 *
 * Since Phase 5.3 the services under test run as several pods behind a
 * Service (ADR-047). A `/metrics` URL then answers from one arbitrary pod, so
 * every reading the report needs comes from Prometheus, which scrapes each pod
 * individually. Two rules follow from that:
 *
 * - A scalar reading must be aggregated in PromQL (`sum` for contributions,
 *   `max` for world state, `min` for "all up"). `instantQuery` refuses a
 *   multi-series answer instead of silently taking the first series.
 * - A before/after snapshot is the full instant vector of a job, rendered back
 *   into the text exposition format. The pure analysis keeps parsing `.prom`
 *   files; `sumSamples` and `getHistogram` already add up the pods' series.
 */

/** Prometheus `scrape_interval` from `k8s/overlays/local/prometheus.yml`. */
export const SCRAPE_INTERVAL_MS = 5_000;

const queryUrl = (baseUrl, promql) =>
  `${baseUrl}/api/v1/query?query=${encodeURIComponent(promql)}`;

/**
 * @param {string} baseUrl e.g. http://localhost:10007
 * @param {string} promql
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ raw: object, series: Array<{ labels: Record<string, string>, value: number }> }>}
 */
export const instantVector = async (baseUrl, promql, fetchImpl = fetch) => {
  const res = await fetchImpl(queryUrl(baseUrl, promql));
  if (!res.ok) {
    throw new Error(`Prometheus query failed (${res.status}): ${promql}`);
  }
  const raw = await res.json();
  if (raw?.status !== "success") {
    throw new Error(`Prometheus query failed (${raw?.error ?? "no status"}): ${promql}`);
  }
  const result = raw.data?.result ?? [];
  if (raw.data?.resultType === "scalar") {
    return { raw, series: [{ labels: {}, value: Number(result[1]) }] };
  }
  const series = result.map((entry) => ({
    labels: entry.metric ?? {},
    value: Number(entry.value?.[1]),
  }));
  return { raw, series };
};

/**
 * One aggregated value. Null when the query yields no series, distinct from a
 * measured 0. Throws when the query yields several series: picking one of them
 * would report a single pod as if it were the whole system.
 *
 * @param {string} baseUrl
 * @param {string} promql
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ raw: object, value: number | null }>}
 */
export const instantQuery = async (baseUrl, promql, fetchImpl = fetch) => {
  const { raw, series } = await instantVector(baseUrl, promql, fetchImpl);
  if (series.length === 0) return { raw, value: null };
  if (series.length > 1) {
    throw new Error(
      `Prometheus returned ${series.length} series for "${promql}"; aggregate it (sum/max/min) instead of reading one pod.`,
    );
  }
  const { value } = series[0];
  return { raw, value: Number.isFinite(value) ? value : null };
};

/**
 * Whether EVERY scrape target of a job reports `up == 1`. Null when the job
 * has no target at all, false as soon as one pod is down.
 *
 * @param {string} baseUrl
 * @param {string} job
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<boolean | null>}
 */
export const targetUp = async (baseUrl, job, fetchImpl = fetch) => {
  const { value } = await instantQuery(baseUrl, `min(up{job="${job}"})`, fetchImpl);
  if (value === null) return null;
  return value === 1;
};

/**
 * Number of targets of a job that Prometheus currently scrapes successfully.
 *
 * @param {string} baseUrl
 * @param {string} job
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<number>}
 */
export const countTargetsUp = async (baseUrl, job, fetchImpl = fetch) => {
  const { value } = await instantQuery(
    baseUrl,
    `count(up{job="${job}"} == 1)`,
    fetchImpl,
  );
  return value ?? 0;
};

const escapeLabelValue = (value) =>
  value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');

const formatSampleValue = (value) => {
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "+Inf";
  if (value === Number.NEGATIVE_INFINITY) return "-Inf";
  return String(value);
};

/**
 * Render an instant vector as text exposition, one line per series. The
 * metric name comes from `__name__`; every other label is kept.
 *
 * @param {Array<{ labels: Record<string, string>, value: number }>} series
 * @returns {string}
 */
export const vectorToExposition = (series) => {
  const lines = series
    .filter(({ labels }) => labels.__name__)
    .map(({ labels, value }) => {
      const { __name__: name, ...rest } = labels;
      const labelText = Object.keys(rest)
        .sort()
        .map((key) => `${key}="${escapeLabelValue(rest[key])}"`)
        .join(",");
      return `${name}${labelText ? `{${labelText}}` : ""} ${formatSampleValue(value)}`;
    })
    .sort();
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
};

/**
 * Snapshot every series of one scrape job across all its pods.
 *
 * `up` and Prometheus' own `scrape_*` series are dropped: they are facts about
 * the scrape, not about the service, and the service's own `/metrics` never
 * contained them. The `job` label goes too, because the file is per job;
 * `instance` stays, so the file still shows which pod reported what.
 *
 * @param {string} baseUrl
 * @param {string} job
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ text: string, instances: string[] }>}
 */
export const snapshotJob = async (baseUrl, job, fetchImpl = fetch) => {
  const { series } = await instantVector(
    baseUrl,
    `{job="${job}", __name__!="up", __name__!~"scrape_.*"}`,
    fetchImpl,
  );
  const instances = [
    ...new Set(series.map(({ labels }) => labels.instance).filter(Boolean)),
  ].sort();
  const withoutJob = series.map(({ labels: { job: _job, ...labels }, value }) => ({
    labels,
    value,
  }));
  return { text: vectorToExposition(withoutJob), instances };
};

/**
 * Wait until every target of the given jobs has been scraped after `sinceMs`.
 *
 * Needed right after the TSDB reset: until the next scrape Prometheus holds no
 * series at all, and a snapshot taken in that window would record an empty
 * baseline.
 *
 * @param {{ baseUrl: string, jobs: string[], sinceMs: number, timeoutMs?: number, pollIntervalMs?: number, sleep?: (ms: number) => Promise<void>, now?: () => number, fetchImpl?: typeof fetch }} opts
 * @returns {Promise<void>}
 */
export const waitForFreshScrape = async ({
  baseUrl,
  jobs,
  sinceMs,
  timeoutMs = 6 * SCRAPE_INTERVAL_MS,
  pollIntervalMs = 1_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  fetchImpl = fetch,
}) => {
  const selector = `up{job=~"${jobs.join("|")}"}`;
  const deadline = now() + timeoutMs;
  for (;;) {
    const { value: oldest } = await instantQuery(
      baseUrl,
      `min(timestamp(${selector}))`,
      fetchImpl,
    );
    if (oldest !== null && oldest * 1000 >= sinceMs) return;
    if (now() >= deadline) {
      throw new Error(
        `No fresh scrape of ${jobs.join(", ")} within ${timeoutMs} ms — is Prometheus scraping the pods?`,
      );
    }
    await sleep(pollIntervalMs);
  }
};

/**
 * Sum of a worker-side counter for one event across all pods. Null while no
 * pod exposes the series yet (prom-client publishes a labelled counter only
 * after its first increment).
 *
 * @param {string} baseUrl
 * @param {string} metric
 * @param {string} eventId
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<number | null>}
 */
export const readEventCounter = async (baseUrl, metric, eventId, fetchImpl = fetch) => {
  const { value } = await instantQuery(
    baseUrl,
    `sum(${metric}{job="worker", event_id="${eventId}"})`,
    fetchImpl,
  );
  return value;
};

/**
 * Size of the reservation ledger for one event. World state: every worker
 * reads the same Redis ZSet, so the pods agree and `max` picks that value
 * without multiplying it by the replica count.
 *
 * @param {string} baseUrl
 * @param {string} eventId
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<number | null>}
 */
export const readLedgerActive = async (baseUrl, eventId, fetchImpl = fetch) => {
  const { value } = await instantQuery(
    baseUrl,
    `max(reservation_ledger_active{job="worker", event_id="${eventId}"})`,
    fetchImpl,
  );
  return value;
};
