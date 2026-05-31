import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const EVENT_ID = __ENV.EVENT_ID || 'freq-2025';

export const options = {
  scenarios: {
    spike_test: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: 5000,
      stages: [
        // Phase 1 – Warm-Up:       1.000 RPS, 2 min
        { target: 1000, duration: '2m' },
        // Phase 2 – Pre-Sale Hype: 10.000 RPS, 2 min
        { target: 10000, duration: '2m' },
        // Phase 3 – Sale Opening:  50.000 RPS, 3 min
        { target: 50000, duration: '3m' },
        // Phase 4 – Sustained:     50.000 RPS, 5 min
        { target: 50000, duration: '5m' },
        // Phase 5 – Sold Out:      20.000 RPS, 2 min
        { target: 20000, duration: '2m' },
        // Phase 6 – Cool Down:      1.000 RPS, 1 min
        { target: 1000, duration: '1m' },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  // TODO: Availability-Check + Ticket-Kauf implementieren (nächste Task)
  sleep(1);
}
