# Load-Test Report — `2026-08-18T19-09-19-323Z-a05409f`

## 1. Run Identity & Configuration

- **Git:** `a05409f09f7030c1cc4b9890d2c2262cf54cd573` (main)
- **Host:** darwin/arm64, 11 CPUs
- **Seeded capacity:** 1 000 000
- **Configuration (load harness / orchestrator env):**
  - `BASE_URL` = `http://sut.lan:10002`
  - `CANCEL_RATE` = `0.08`
  - `CHECKOUT_PENDING_TIMEOUT_SECONDS` = `60`
  - `CHECKOUT_SHARE` = `0.4`
  - `DATABASE_POOL_MAX` = `50`
  - `DISABLE_REQUEST_LOGGING` = `true`
  - `HTS_ENV_PROFILE` = `browse-and-buy-full-speed`
  - `K6_RUNNER` = `ssh`
  - `LOAD_PROFILE` = `browse-and-buy-full-speed`
  - `LOG_LEVEL` = `warn`
  - `NODE_ENV` = `production`
  - `PAY_RATE` = `0.88`
  - `PUBSUB_FLOW_CONTROL_MAX_MESSAGES` = `500`
  - `REDIS_FINAL_ORDER_TTL_SECONDS` = `86400`
  - `REDIS_WORKER_PROCESSED_TTL_SECONDS` = `86400`
  - `SALE_OPENS_IN_SECONDS` = `60`
  - `SEED_CAPACITY` = `1000000`
  - `THINK_TIME_KIND` = `none`
  - `THINK_TIME_MAX` = `0`
  - `THINK_TIME_MEAN` = `0`
  - `THINK_TIME_MIN` = `0`
  - `THINK_TIME_SIGMA` = `0`
  - `WORKER_INVENTORY_CYCLE_INTERVAL_SECONDS` = `60`
  - `WORKER_RESERVATION_REAPER_BATCH_SIZE` = `10000`
- **Effective `api` configuration (reported by the service):**
  - `disable_request_logging` = `true`
  - `log_level` = `warn`
  - `node_env` = `production`
- **Effective `worker` configuration (reported by the service):**
  - `database_pool_max` = `50`
  - `disable_request_logging` = `true`
  - `log_level` = `warn`
  - `node_env` = `production`
  - `pubsub_flow_control_max_messages` = `500`
  - `worker_inventory_cycle_interval_seconds` = `60`
  - `worker_reservation_reaper_batch_size` = `10000`

## 2. Executive Verdict

- **Benchmark validity:** ❌ `invalid`
- **System result:** ✅ `pass`
- **Performance:** ❌ `fail`

## 3. Benchmark Validity

- Dropped-iteration rate 5.18% indicates load-generator saturation; capacity cannot be claimed.

## 3a. Performance (k6 thresholds)

- http_req_duration p(95)<500 breached in phase-a (observed 876.0995).

## 4. Offered vs. Executed Load

| Phase | Iterations | Dropped | Scheduled | Executed % | VUs max |
| ----- | ---------- | ------- | --------- | ---------- | ------- |
| phase-a | 6 477 044 | 356 526 | 6 833 570 | 94.78% | 10 000 |
| phase-b | 59 225 | 776 | 60 001 | 98.71% | 960 |
| **total** | 6 536 269 | 357 302 | 6 893 571 | 94.82% | |

- **Phase A stop reason:** `sold-out` (available at stop: 0)

- **Transport errors (phase-a):** 1 492 585 — availability 36 725, buy 1 455 860
- **Transport errors (phase-b):** 23 804 — buy 23 804

## 5. Order Counters (run-scoped deltas)

| Counter | Before | After | Δ Run |
| ------- | ------ | ----- | ----- |
| checkoutsCancelled | 0 | 91 055 | 91 055 |
| ordersAccepted | 0 | 1 136 706 | 1 136 706 |
| ordersCompleted | 0 | 1 000 000 | 1 000 000 |
| ordersFailed | 0 | 0 | 0 |
| paymentsConfirmed | 0 | 1 000 000 | 1 000 000 |
| publishRollbacks | 0 | 0 | 0 |
| reservationsCreated | 0 | 1 136 706 | 1 136 706 |
| workerCompensations | 0 | 0 | 0 |
| workerDuplicateDeliveries | 0 | 0 | 0 |
| workerIdempotencyHits | 0 | 0 | 0 |
| workerRedeliveries | 0 | 0 | 0 |

## 6. Worker Drain

- **Status:** `complete`
- **Pending at end:** 0
- **Drain duration:** 15.0s

## 7. E2E Latency & Histogram Coverage

- **Observations:** 1 000 000
- **Mean:** 0.217s (Δsum/Δcount)
- **p50 / p95 / p99:** 0.250s / 1.000s / 1.000s
- **Above-largest-bucket fraction:** 0.00% (largest finite bucket 10.000s)

## 8. Correctness Invariants

| Invariant | Expected | Actual | Result |
| --------- | -------- | ------ | ------ |
| published == completed + failed | 1 000 000 | 1 000 000 | ✅ |
| dbOrders == completed + failed | 1 000 000 | 1 000 000 | ✅ |
| dbTickets == completed | 1 000 000 | 1 000 000 | ✅ |
| pendingOrders == 0 | 0 | 0 | ✅ |
| available + dbTickets + activeReservations == totalCapacity | 1 000 000 | 1 000 000 | ✅ |
| sellout: sold == totalCapacity | 1 000 000 | 1 000 000 | ✅ |
| sellout: reaper released at least one expired claim | 1 | 1 | ✅ |

## 9. Redis / PostgreSQL Consistency

- **Drift (final):** 0
- **Drift (min):** 0
- **Capacity accounting:** available 0 + tickets 1 000 000 + active 0 vs. capacity 1 000 000 → delta 0 (positive = oversell)
- **Redis:** available 0, active reservations 0, keys 2 045 654, used memory 567 680 344 bytes
- **PostgreSQL:** orders 1 000 000, tickets 1 000 000, pending 0, sold_count 1 000 000

## 10. Rule-Based Recommendations

- **performance-gate-breached:** A k6 performance gate was breached; the run is not a latency-clean reference even where benchmark and system pass.
  - evidence: `http_req_duration p(95)<500 breached in phase-a (observed 876.0995).`
- **generator-saturated:** Load generator dropped scheduled iterations; do not claim the target RPS as backend capacity.
  - evidence: `droppedShare=0.051831191700208785`

_Renderer v3. Regenerated deterministically from artifacts; no wall-clock timestamp embedded._
