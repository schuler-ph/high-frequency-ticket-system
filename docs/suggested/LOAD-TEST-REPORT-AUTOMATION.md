# Automating Load-Test Reports

## Purpose

This guide describes how the first local spike report was reconstructed, which commands were used, where manual interpretation was necessary, and how to replace that work with a deterministic Node.js reporting pipeline.

The intended result is a repeatable command such as:

```text
pnpm spike:report
```

It should always create:

1. immutable raw evidence;
2. a machine-readable derived result;
3. a Markdown report;
4. an explicit validity verdict;
5. a non-zero exit code only **after** all evidence has been written.

The report generator should not try to be an AI. It should calculate facts, apply versioned rules, and label anything that cannot be proven as `inconclusive`.

## Existing foundation

The repository already has most of the execution layer:

- `scripts/local/reset-seed.mjs` resets PostgreSQL, Redis, and Pub/Sub;
- `scripts/local/run-spike.mjs` orchestrates sale unlock, phase A, reactive sold-out detection, and phase B;
- `load-tests/spike-phase-a.js` defines warm-up, ramp-up, and sustained load;
- `load-tests/spike-phase-b.js` defines cool-down;
- `load-tests/lib/scenario-helpers.js` contains shared requests and expected statuses;
- k6 writes live time series to Prometheus through remote write;
- API and worker metrics are scraped every five seconds;
- PostgreSQL and Redis contain authoritative post-run state.

The missing layer is an evidence collector and deterministic analyzer around this orchestrator.

## What was done manually for Baseline A

The report in `docs/reports/baseline-a-2026-07-14/LOAD-TEST-REPORT-2026-07-14.md` was not produced from screenshots alone. Screenshots were used to identify suspicious panels, then every important claim was cross-checked against raw sources.

### 1. Read the executable configuration

The following were inspected before interpreting numbers:

- k6 executor, stages, traffic mix, VU limits, thresholds, and expected statuses;
- worker flow-control and DB-pool settings;
- the one-second payment simulation;
- Prometheus histogram buckets;
- reconciliation formula and reservation TTL;
- Grafana PromQL expressions;
- Redis key lifecycle;
- PostgreSQL `buy_ticket` implementation.

This prevented several incorrect conclusions. In particular, the one-second payment simulation happens in the worker **after** HTTP 202, so it cannot directly explain `POST /buy` HTTP latency.

### 2. Query Prometheus directly

Small Python programs using only the standard library called the Prometheus HTTP API. The core pattern was:

```python
import json
import urllib.parse
import urllib.request

query = 'sum(orders_accepted_total{job="api"})'
url = "http://localhost:10007/api/v1/query?" + urllib.parse.urlencode(
    {"query": query}
)
result = json.load(urllib.request.urlopen(url, timeout=5))
```

Instant queries retrieved final counters and state:

```promql
sum(orders_accepted_total{job="api"})
sum(orders_completed_total{job="worker"})
sum(orders_failed_total{job="worker"})
sum(reservations_created_total{job="api"})
sum(publish_rollbacks_total{job="api"})
sum(worker_redeliveries_total{job="worker"})
sum(worker_idempotency_hits_total{job="worker"})
sum(worker_compensations_total{job="worker"})
redis_db_drift_tickets{job="worker"}
```

Range/subquery expressions retrieved peaks:

```promql
max_over_time(
  (sum(rate(http_request_duration_seconds_count{job="api"}[1m])))[30m:5s]
)

max_over_time(
  (sum(rate(orders_completed_total{job="worker"}[1m])))[30m:5s]
)
```

Histogram counters were queried directly instead of trusting a clipped Grafana quantile:

```promql
sum by (le) (order_e2e_latency_seconds_bucket{job="worker"})
sum by (status) (order_e2e_latency_seconds_count{job="worker"})
sum by (status) (order_e2e_latency_seconds_sum{job="worker"})
```

That showed that only 14,117 of 420,951 orders were in the largest finite `<=30s` bucket. The remaining observations were in `+Inf`, proving that Grafana's flat `30s` p50/p95/p99 was histogram saturation rather than a measured 30-second quantile.

### 3. Query application status totals

Prometheus application metrics were grouped by route and response status:

```promql
sum by (route, status_code) (
  http_request_duration_seconds_count{job="api"}
)

sum by (route, status_code) (
  http_request_duration_seconds_sum{job="api"}
)
```

This established that the API had recorded HTTP 202 and 200 responses, but no 409 or 5xx series. Therefore k6's transport/check failures could not be described as application 5xx responses.

### 4. Verify PostgreSQL final state and timing

The report used read-only SQL through the local container:

```sql
SELECT
  total_capacity,
  sold_count,
  (SELECT count(*) FROM orders),
  (SELECT count(*) FROM tickets),
  (SELECT count(*) FROM orders WHERE status = 'pending'),
  (SELECT count(*) FROM orders WHERE status = 'completed')
FROM events
WHERE id = $event_id;
```

Drain duration was reconstructed from persisted timestamps:

```sql
SELECT
  min(created_at),
  max(created_at),
  max(updated_at),
  extract(epoch FROM max(updated_at) - min(created_at))
FROM orders;
```

Relation and database sizes were captured with `pg_database_size` and `pg_total_relation_size`.

### 5. Verify Redis final state and footprint

Read-only Redis commands captured:

- total and available counters via `MGET`;
- remaining reservation count via `SCAN` after the run;
- total key count via `DBSIZE`;
- memory and keyspace statistics via `INFO memory` and `INFO keyspace`.

`SCAN` was acceptable as a one-off post-run diagnostic, but it should not become the normal runtime accounting mechanism. It is O(keyspace), which is exactly the scaling issue identified by the test.

### 6. Inspect Pub/Sub emulator metadata

The emulator's subscription endpoint was queried to verify that the subscription existed and to capture its acknowledgement configuration. The emulator does not expose authoritative Prometheus queue-depth metrics, so queue depth had to be derived from application counters.

### 7. Reconcile independent sources

The final correctness claim was accepted only because these sources agreed:

```text
API accepted counter
= worker completed + failed counters
= PostgreSQL orders
= PostgreSQL tickets for successful orders
= initial Redis available - final Redis available
```

For Baseline A, all accepted orders eventually completed and every source converged to 420,951.

## What should not be automated as guesswork

A script can reliably calculate symptoms. It cannot prove an uninstrumented root cause.

The automated report should distinguish three classes:

| Class        | Example                                              | Allowed wording                                          |
| ------------ | ---------------------------------------------------- | -------------------------------------------------------- |
| Observation  | worker completed 481 orders/s                        | “Observed worker throughput was 481/s.”                  |
| Derived fact | 500 in-flight / 1s delay = 500/s first-order ceiling | “Configured first-order ceiling is approximately 500/s.” |
| Hypothesis   | PostgreSQL hot-row contention limited throughput     | “Inconclusive; DB lock-wait instrumentation is missing.” |

It must never silently convert a plausible hypothesis into a finding.

Examples of unsafe shortcuts:

- interpreting Grafana legend `Total` as a counter total;
- treating `No data` as zero without checking target health and metric semantics;
- blaming worker payment latency for API response latency;
- claiming a DB bottleneck without pool-wait, query-duration, or lock-wait evidence;
- using current absolute Prometheus counters without subtracting a run baseline;
- assuming the seed capacity from documentation instead of capturing actual state.

## Proposed command model

Use three commands with separate responsibilities:

```text
pnpm spike:report
pnpm spike:analyze -- <run-directory>
pnpm spike:compare -- <baseline-directory> <candidate-directory>
```

### `spike:report`

Runs the complete workflow:

1. preflight;
2. create run manifest;
3. reset/seed;
4. collect baseline snapshots;
5. run phase A and phase B;
6. wait for worker drain or timeout;
7. collect final snapshots and Prometheus ranges;
8. derive metrics and validate invariants;
9. render report;
10. return the policy exit code.

### `spike:analyze`

Recomputes `derived.json` and `report.md` exclusively from an existing artifact directory. It must perform no network or database access. This makes report logic testable and allows historical reports to be regenerated after template improvements.

### `spike:compare`

Compares two `derived.json` files. It should report absolute and percentage changes, but reject comparisons when profiles, capacities, Git state, host class, or validity flags are incompatible.

## Proposed repository structure

```text
scripts/load-test/
  run-and-report.mjs
  analyze-run.mjs
  compare-runs.mjs
  lib/
    config.mjs
    processes.mjs
    openmetrics.mjs
    prometheus.mjs
    snapshots.mjs
    drain.mjs
    derive.mjs
    validate.mjs
    render-markdown.mjs
load-tests/
  report-policy.json
  report-queries.json
artifacts/load-tests/
  <run-id>/
    manifest.json
    k6/
      phase-a-summary.json
      phase-a.log
      phase-b-summary.json
      phase-b.log
    metrics/
      api-before.prom
      worker-before.prom
      api-after.prom
      worker-after.prom
      prometheus/*.json
    state/
      before.json
      after.json
    derived.json
    report.md
```

`artifacts/load-tests/` should normally be gitignored. A selected, reviewed baseline report can be copied into `docs/`.

## Run manifest

Every report must begin with a manifest. Example shape:

```json
{
  "schemaVersion": 1,
  "runId": "2026-07-15T10-30-00Z-a1b2c3d",
  "git": {
    "commit": "a1b2c3d...",
    "branch": "main",
    "dirty": false
  },
  "host": {
    "platform": "darwin",
    "arch": "arm64",
    "cpuCount": 10,
    "memoryBytes": 34359738368
  },
  "profile": {
    "phaseA": "load-tests/spike-phase-a.js",
    "phaseB": "load-tests/spike-phase-b.js",
    "eventId": "00000000-0000-4000-8000-000000000000"
  },
  "configuration": {
    "flowControlMaxMessages": 500,
    "databasePoolMax": 20,
    "reservationTtlSeconds": 120
  },
  "timestamps": {
    "seededAt": null,
    "workloadStartedAt": null,
    "phaseAEndedAt": null,
    "workloadEndedAt": null,
    "drainEndedAt": null
  }
}
```

Record actual seeded capacity and unlock time from Redis/PostgreSQL after seeding. Do not derive them from source comments.

Do not write secrets such as `DATABASE_URL`, passwords, tokens, or complete process environments into artifacts. Store only an allowlist of non-sensitive settings.

## Collection workflow

### Step 1: preflight

Fail before modifying state unless all of the following are true:

- Node, pnpm, k6, and the configured container CLI exist;
- PostgreSQL, Redis, Pub/Sub, Prometheus, and Grafana containers are running;
- API and worker health endpoints respond;
- API and worker Prometheus targets have `up == 1`;
- Prometheus remote-write receiver is reachable;
- the report directory can be created;
- no previous test process is active;
- numeric environment variables are finite, positive, and within safety bounds.

Record tool versions and container image IDs. This makes two runs comparable without an AI reading shell history.

### Step 2: seed and baseline

Run the existing reset script, then capture:

- PostgreSQL event capacity, sold count, order count, and ticket count;
- Redis total, available, opensAt, key count, memory, and reservation count;
- direct API `/metrics` and worker `/metrics` text;
- Prometheus target health;
- process configuration allowlist.

Direct `/metrics` snapshots are important because service counters survive database resets. The analyzer should calculate counter deltas as:

$$
\Delta C = C_{after} - C_{before}
$$

This is more deterministic than treating an absolute process counter as a run count.

If a counter resets because the process restarted, mark the run inconclusive unless reset handling is explicit.

### Step 3: run k6 with run identity and JSON summaries

Pass a unique run tag to every phase:

```text
--tag test_run_id=<run-id>
```

Persist a separate k6 summary for each phase. The simplest implementation is the k6 CLI summary export option or a phase-local `handleSummary` that writes JSON into `RUN_DIR`.

The summary must retain at least:

- iterations;
- dropped iterations;
- HTTP requests;
- duration average, median, p90, p95, p99, and max;
- failed-request rate;
- check failures;
- VU max;
- threshold results;
- phase exit reason and code.

Add custom k6 counters in `scenario-helpers.js` for:

- endpoint + status (`200`, `202`, `409`, `425`, `5xx`, `status=0`);
- transport `error_code`;
- accepted, sold-out, and too-early outcomes;
- orchestration poll requests, tagged separately from generated traffic.

Without this, a failed check cannot reliably be assigned to an HTTP status or transport error.

### Step 4: preserve exit semantics

k6 uses exit code 99 when thresholds fail. That is a test result, not a collector crash.

The orchestrator should:

1. record the k6 exit code;
2. continue drain and evidence collection;
3. generate the report;
4. only then return the final policy exit code.

Similarly, a graceful SIGINT used for reactive sold-out must be recorded as an expected phase termination, not confused with a crash.

### Step 5: drain detection

After generated traffic stops, poll direct metrics every few seconds:

$$
\text{pending} = \Delta accepted - \Delta completed - \Delta failed
$$

Drain is complete only when:

- pending is zero;
- the result is stable for several consecutive polls;
- PostgreSQL counts no pending orders;
- optional final drift is within policy.

Use a configurable timeout. On timeout, still produce a report with `drain.status = "timeout"`, current pending count, and elapsed drain time.

Do not wait forever and do not discard a failed run's evidence.

### Step 6: collect time-series evidence

Use `/api/v1/query_range` with exact manifest timestamps and a fixed step. Save every raw Prometheus response before deriving values.

Recommended query catalog:

#### API

- total and route RPS;
- route p50/p95/p99;
- response count by route/status;
- 5xx, 409, and 425 rates.

#### Worker

- completed and failed rate;
- E2E histogram buckets, count, and sum;
- redelivery, idempotency, and compensation deltas.

#### Consistency

- drift minimum, maximum, and final value;
- reservation and rollback rates;
- accepted minus finalized backlog over time.

#### Health

- `up` for API and worker;
- scrape gaps;
- process restart indicators when available.

Keep the PromQL in a versioned JSON catalog. The renderer should not parse Grafana dashboard JSON, because dashboards contain presentation-specific reductions that caused several Baseline A misreadings.

### Step 7: final state snapshots

Capture authoritative state after drain or timeout:

#### PostgreSQL

- event capacity and sold count;
- orders grouped by status;
- ticket count;
- min/max creation and update timestamps;
- relation and database sizes.

#### Redis

- total and available;
- active reservation count;
- processed/order key counts where affordable;
- `DBSIZE`;
- used and peak memory;
- keyspace expiry statistics.

#### Pub/Sub

- subscription metadata;
- real queue depth/oldest age when an exporter exists;
- otherwise explicitly record `queueDepthSource = "application-counter-proxy"`.

## Deterministic calculations

All calculations should live in pure functions and be unit tested.

### Executed and dropped share

For an arrival-rate executor:

$$
\text{scheduled} = \text{iterations} + \text{droppedIterations}
$$

$$
\text{executedShare} = \frac{\text{iterations}}{\text{scheduled}}
$$

$$
\text{droppedShare} = \frac{\text{droppedIterations}}{\text{scheduled}}
$$

For a reactive profile, do not invent a fixed intended count beyond the period actually run. `iterations + dropped` is the authoritative scheduled count.

### Required VUs estimate

Use Little's Law only as a clearly labeled estimate:

$$
\text{requiredVUs} \approx \text{targetRPS} \times \text{meanIterationSeconds}
$$

This estimate explains generator saturation but is not a measured backend limit.

### Worker throughput

Calculate both:

- Prometheus completion rate during the drain;
- persisted successful orders divided by first-to-last DB completion span.

If they differ materially, mark the throughput result as inconsistent rather than choosing the more attractive value.

### E2E average

Using histogram deltas:

$$
\text{meanE2E} = \frac{\Delta histogramSum}{\Delta histogramCount}
$$

### Histogram saturation

Let $B_{max}$ be the largest finite bucket, $N_{max}$ its cumulative count, and $N$ the `+Inf` count.

$$
\text{fractionAboveMaxBucket} = 1 - \frac{N_{max}}{N}
$$

If the requested quantile rank is above $N_{max}$, render it as `> B_max`, not as exactly $B_{max}$.

### Final correctness invariants

At completed drain, evaluate:

```text
accepted = completed + failed
DB orders = completed + failed
DB tickets = completed
pending orders = 0
initial available - accepted + compensated/rolledBack = final available
```

The exact availability formula must follow current business semantics and be versioned with the analyzer. Do not hardcode a formula that ignores terminal compensation or sold-out attempts.

### Drift explanation

The script may calculate the identity:

$$
\text{drift} = \text{redisAvailable} -
(\text{capacity} - \text{soldCount} - \text{activeReservations})
$$

It may flag a TTL risk when all of these are true:

- queue/E2E latency exceeds reservation TTL;
- active reservations fall while pending remains positive;
- drift becomes negative.

It should report “reservation lifetime mismatch detected.” It should not claim SCAN latency caused the drift unless reconcile duration is instrumented.

## Validity rules

A report needs two independent verdicts.

### Benchmark validity

Possible values:

- `valid`: load profile delivered within policy and evidence is complete;
- `degraded`: test ran, but dropped iterations or scrape gaps exceed warning limits;
- `invalid`: generator saturation, missing baseline, process restart, or corrupted artifacts prevents capacity claims.

Suggested local policy:

```json
{
  "maxDroppedIterationRateForValidRun": 0.001,
  "maxScrapeGapSeconds": 15,
  "requireApiAndWorkerUp": true,
  "requireCounterBaselines": true,
  "requireDrainForCorrectnessVerdict": true
}
```

### System result

Possible values:

- `pass`;
- `fail`;
- `inconclusive`.

A benchmark can be invalid for a capacity claim while still providing useful correctness evidence. Baseline A is the example: invalid as proof of 50k RPS, but strong evidence that all HTTP-202 orders eventually completed.

## Handling `No data`

Use this decision table:

1. If the Prometheus target was down, report `missing due to scrape failure`.
2. If the target was up and a labeled counter never existed, use zero only when the metric catalog defines absence as zero.
3. If arithmetic combines optional series, zero-fill each operand explicitly.
4. If a gauge should always exist but is absent, report an instrumentation defect.
5. Never render all of the above as the same `No data` state.

This logic can be encoded in query metadata:

```json
{
  "id": "workerRedeliveries",
  "promql": "sum(worker_redeliveries_total{job=\"worker\"})",
  "absence": "zero-if-target-up",
  "source": "worker"
}
```

## Report template

The renderer should always generate the same sections:

1. run identity and configuration;
2. executive verdict;
3. benchmark validity;
4. offered versus executed load;
5. API performance by endpoint;
6. worker throughput and drain;
7. E2E latency and histogram coverage;
8. correctness invariants;
9. Redis/PostgreSQL consistency;
10. reliability events;
11. storage footprint;
12. missing instrumentation;
13. rule-based recommendations;
14. comparison compatibility metadata;
15. links to raw artifacts.

Recommendations should come from explicit rules. Examples:

```text
IF droppedRate > policy.maxDroppedRate
THEN “Load generator saturated; do not claim target RPS.”

IF fractionAboveLargestE2eBucket > 0.05
THEN “Extend E2E histogram buckets; reported upper quantiles are censored.”

IF acceptedDelta != completedDelta + failedDelta AND drainCompleted
THEN “Accepted/finalized invariant failed.”

IF meanE2eSeconds > reservationTtlSeconds AND minDrift < 0
THEN “Reservation lifetime is shorter than observed queue lifetime.”

IF workerThroughput is within 10% of maxMessages/paymentDelay
THEN “Observed throughput is consistent with configured flow-control ceiling.”
```

Every recommendation should include evidence IDs, not prose-only reasoning.

## Testing the report generator

The expensive load test must not be required to test reporting code.

### Unit tests

Test pure functions with fixtures for:

- counter delta and reset detection;
- dropped-rate calculations;
- histogram mean and saturation;
- absent-series handling;
- invariant evaluation;
- drain timeout;
- recommendation rules;
- Markdown escaping and stable ordering.

### Golden-file tests

Store a small anonymized artifact fixture representing Baseline A. Run `spike:analyze` and compare generated `derived.json` and `report.md` with approved golden files.

### Fault-injection fixtures

Include cases for:

- k6 threshold exit 99;
- graceful SIGINT;
- missing worker scrape;
- counter reset mid-run;
- no failed-order series;
- drain timeout;
- histogram quantile above largest bucket;
- PostgreSQL/Prometheus count disagreement;
- Prometheus returning a warning or partial result.

### Idempotence

Running `spike:analyze` twice over the same artifacts must produce byte-identical output except for an optional renderer-version field. Do not embed “generated now” timestamps in derived reports; use the manifest's timestamps.

## Integration plan

Implement in small steps:

1. **Artifact contract:** manifest, directory layout, redaction rules, and fixture tests.
2. **k6 summaries:** phase JSON, custom status/error counters, run tag, and logs.
3. **Baseline/final snapshots:** direct OpenMetrics, PostgreSQL, Redis, and config allowlist.
4. **Drain monitor:** pending formula, stability polls, timeout evidence.
5. **Prometheus collector:** query catalog and raw response persistence.
6. **Pure analyzer:** calculations, saturation detection, invariants, and validity.
7. **Markdown renderer:** deterministic report and evidence references.
8. **Comparison command:** compatibility checks and deltas.
9. **Optional CI:** run only a small smoke profile in CI; retain full local/cloud artifacts outside normal quality gates.

Do not build one large script. The orchestrator performs side effects; the analyzer and renderer should be pure and independently testable.

## Minimum viable automation

The smallest useful first version does not need every dashboard metric. It should automate the facts that required the most manual work:

- run ID, Git SHA, configuration, and timestamps;
- k6 summaries and dropped-rate validity;
- before/after API and worker counters;
- drain duration and pending count;
- E2E histogram count/sum/buckets with saturation detection;
- PostgreSQL order/ticket counts;
- Redis total/available/key count/memory;
- drift min/final;
- invariant verdicts;
- generated Markdown.

That MVP would reproduce the core of Baseline A without screenshots and without an AI agent. Grafana remains useful for live observation and presentation, but it should no longer be the source from which report facts are manually transcribed.
