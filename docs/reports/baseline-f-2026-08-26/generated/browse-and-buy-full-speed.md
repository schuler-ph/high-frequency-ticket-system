# Load-Test Report — `2026-08-26T10-18-42-094Z-6e2687b`

## 1. Run Identity & Configuration

- **Git:** `6e2687bf67c07bff4b9d0bf40823276c66cf3879` (main)
- **Host:** darwin/arm64, 11 CPUs
- **Seeded capacity:** 1 000 000
- **Configuration (load harness / orchestrator env):**
  - `BASE_URL` = `http://10.0.0.1:10002`
  - `CANCEL_RATE` = `0.08`
  - `CHECKOUT_PENDING_TIMEOUT_SECONDS` = `60`
  - `CHECKOUT_SHARE` = `0.4`
  - `DATABASE_POOL_CONNECTION_TIMEOUT_MS` = `5000`
  - `DATABASE_POOL_MAX` = `50`
  - `DISABLE_REQUEST_LOGGING` = `true`
  - `HTS_ENV_PROFILE` = `browse-and-buy-full-speed`
  - `K6_COOLDOWN_MAX_VUS` = `5000`
  - `K6_COOLDOWN_RATE` = `1000`
  - `K6_MAX_VUS` = `16000`
  - `K6_RUNNER` = `ssh`
  - `K6_TARGET_RATE` = `10000`
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
  - `WORKER_RESERVATION_REAPER_INTERVAL_SECONDS` = `60`
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
  - `worker_reservation_reaper_interval_seconds` = `60`

## 2. Executive Verdict

- **Benchmark validity:** ⚠️ `degraded`
- **System result:** ✅ `pass`
- **Performance:** ✅ `pass`

## 3. Benchmark Validity

- Dropped-iteration rate 0.36% exceeds the valid-run warning limit.

## 3a. Performance (k6 thresholds)

- All performance gates held in every phase.

## 4. Offered vs. Executed Load

| Phase     | Iterations | Dropped | Scheduled | Executed % | VUs max |
| --------- | ---------- | ------- | --------- | ---------- | ------- |
| phase-a   | 5 843 678  | 21 389  | 5 865 067 | 99.64%     | 5 777   |
| phase-b   | 60 000     | 0       | 60 000    | 100.00%    | 200     |
| **total** | 5 903 678  | 21 389  | 5 925 067 | 99.64%     |         |

- **Phase A stop reason:** `sold-out` (available at stop: 0)

- **Transport errors (phase-a):** 43 — availability 26, buy 17
- **Transport errors (phase-b):** 0

## 5. Order Counters (run-scoped deltas)

| Counter                   | Before | After     | Δ Run     |
| ------------------------- | ------ | --------- | --------- |
| checkoutsCancelled        | 0      | 91 580    | 91 580    |
| ordersAccepted            | 0      | 1 136 945 | 1 136 945 |
| ordersCompleted           | 0      | 1 000 000 | 1 000 000 |
| ordersFailed              | 0      | 0         | 0         |
| paymentsConfirmed         | 0      | 1 000 000 | 1 000 000 |
| publishRollbacks          | 0      | 0         | 0         |
| reservationsCreated       | 0      | 1 136 945 | 1 136 945 |
| workerCompensations       | 0      | 0         | 0         |
| workerDuplicateDeliveries | 0      | 0         | 0         |
| workerIdempotencyHits     | 0      | 0         | 0         |
| workerRedeliveries        | 0      | 0         | 0         |

## 6. Worker Drain

- **Status:** `complete`
- **Pending at end:** 0
- **Drain duration:** 15.0s

## 7. E2E Latency & Histogram Coverage

- **Observations:** 1 000 000
- **Mean:** 0.104s (Δsum/Δcount)
- **p50 / p95 / p99:** 0.100s / 0.250s / 1.000s
- **Above-largest-bucket fraction:** 0.00% (largest finite bucket 10.000s)

## 8. Correctness Invariants

| Invariant                                                   | Expected  | Actual    | Result |
| ----------------------------------------------------------- | --------- | --------- | ------ |
| published == completed + failed                             | 1 000 000 | 1 000 000 | ✅     |
| dbOrders == completed + failed                              | 1 000 000 | 1 000 000 | ✅     |
| dbTickets == completed                                      | 1 000 000 | 1 000 000 | ✅     |
| pendingOrders == 0                                          | 0         | 0         | ✅     |
| available + dbTickets + activeReservations == totalCapacity | 1 000 000 | 1 000 000 | ✅     |
| sellout: sold == totalCapacity                              | 1 000 000 | 1 000 000 | ✅     |
| sellout: reaper released at least one expired claim         | 1         | 1         | ✅     |

## 9. Redis / PostgreSQL Consistency

- **Drift (final):** 0
- **Drift (min):** 0
- **Capacity accounting:** available 0 + tickets 1 000 000 + active 0 vs. capacity 1 000 000 → delta 0 (positive = oversell)
- **Redis:** available 0, active reservations 0, keys 2 045 368, used memory 567 595 608 bytes
- **PostgreSQL:** orders 1 000 000, tickets 1 000 000, pending 0, sold_count 1 000 000

## 10. Rule-Based Recommendations

- **generator-saturated:** Load generator dropped scheduled iterations; do not claim the target RPS as backend capacity.
  - evidence: `droppedShare=0.003609916984904981`

_Renderer v3. Regenerated deterministically from artifacts; no wall-clock timestamp embedded._
