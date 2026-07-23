# Load-Test Report — `2026-07-14T00-00-00Z-baseline-a-fixture`

## 1. Run Identity & Configuration

- **Git:** `0000000` (main)
- **Host:** linux/x64, 8 CPUs
- **Seeded capacity:** 1 000
- **Configuration:**
  - `DATABASE_POOL_MAX` = `20`
  - `LOAD_PROFILE` = `capacity`
  - `PUBSUB_FLOW_CONTROL_MAX_MESSAGES` = `500`

## 2. Executive Verdict

- **Benchmark validity:** ❌ `invalid`
- **System result:** ✅ `pass`

## 3. Benchmark Validity

- Dropped-iteration rate 61.82% indicates load-generator saturation; capacity cannot be claimed.

## 4. Offered vs. Executed Load

| Phase | Iterations | Dropped | Scheduled | Executed % | VUs max |
| ----- | ---------- | ------- | --------- | ---------- | ------- |
| phase-a | 320 | 680 | 1 000 | 32.00% | 500 |
| phase-b | 100 | 0 | 100 | 100.00% | 50 |
| **total** | 420 | 680 | 1 100 | 38.18% | |

## 5. Order Counters (run-scoped deltas)

| Counter | Before | After | Δ Run |
| ------- | ------ | ----- | ----- |
| checkoutsCancelled | 0 | 0 | 0 |
| ordersAccepted | 0 | 1 000 | 1 000 |
| ordersCompleted | 0 | 1 000 | 1 000 |
| ordersFailed | 0 | 0 | 0 |
| publishRollbacks | 0 | 0 | 0 |
| reservationsCreated | 0 | 1 000 | 1 000 |
| workerCompensations | 0 | 0 | 0 |
| workerIdempotencyHits | 0 | 0 | 0 |
| workerRedeliveries | 0 | 0 | 0 |

## 6. Worker Drain

- **Status:** `complete`
- **Pending at end:** 0
- **Drain duration:** 406.0s

## 7. E2E Latency & Histogram Coverage

- **Observations:** 1 000
- **Mean:** 406.000s (Δsum/Δcount)
- **p50 / p95 / p99:** > 30.000s / > 30.000s / > 30.000s
- **Above-largest-bucket fraction:** 85.90% (largest finite bucket 30.000s)

## 8. Correctness Invariants

| Invariant | Expected | Actual | Result |
| --------- | -------- | ------ | ------ |
| accepted == completed + failed | 1 000 | 1 000 | ✅ |
| dbOrders == completed + failed | 1 000 | 1 000 | ✅ |
| dbTickets == completed | 1 000 | 1 000 | ✅ |
| pendingOrders == 0 | 0 | 0 | ✅ |

## 9. Redis / PostgreSQL Consistency

- **Drift (final):** 0
- **Drift (min):** 0
- **Redis:** available 0, active reservations 0, keys 42, used memory 1 048 576 bytes
- **PostgreSQL:** orders 1 000, tickets 1 000, pending 0, sold_count 1 000

## 10. Rule-Based Recommendations

- **generator-saturated:** Load generator dropped scheduled iterations; do not claim the target RPS as backend capacity.
  - evidence: `droppedShare=0.6181818181818182`
- **e2e-histogram-censored:** Extend the E2E histogram buckets; the reported upper quantiles are censored at the largest finite bucket.
  - evidence: `fractionAboveLargestFinite=0.859`

_Renderer v1. Regenerated deterministically from artifacts; no wall-clock timestamp embedded._
