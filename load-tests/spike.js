import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
// Default: Frequency Festival 20XX Main Sale (1M tickets, matches local seed)
const EVENT_ID = __ENV.EVENT_ID || '00000000-0000-4000-8000-000000000000';

const FIRST_NAMES = [
  'Anna', 'Max', 'Julia', 'Felix', 'Sophie', 'Lukas', 'Laura', 'Tobias',
  'Lea', 'Simon', 'Emma', 'Jonas', 'Lena', 'Philipp', 'Mia', 'Florian',
];
const LAST_NAMES = [
  'Müller', 'Schmidt', 'Schwarz', 'Gruber', 'Huber', 'Wagner', 'Bauer',
  'Maier', 'Fischer', 'Weber', 'Schneider', 'Meyer', 'Wolf', 'Steiner',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

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
    // 409 sold-out responses are excluded via responseCallback on buy requests,
    // so this threshold only catches actual infrastructure errors
    http_req_failed: ['rate<0.05'],
  },
};

// 60% availability checks, 40% buy attempts per iteration
export default function () {
  if (Math.random() < 0.4) {
    buyTicket();
  } else {
    checkAvailability();
  }
}

function checkAvailability() {
  const res = http.get(
    `${BASE_URL}/api/tickets/${EVENT_ID}/availability`,
    { tags: { endpoint: 'availability' } },
  );
  check(res, {
    'availability 200': (r) => r.status === 200,
  });
}

function buyTicket() {
  const body = JSON.stringify({
    firstName: pick(FIRST_NAMES),
    lastName: pick(LAST_NAMES),
  });
  const res = http.post(
    `${BASE_URL}/api/tickets/${EVENT_ID}/buy`,
    body,
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'buy' },
      // 409 = sold out is expected behavior, not a failure
      responseCallback: http.expectedStatuses(202, 409),
    },
  );
  check(res, {
    'buy queued or sold-out': (r) => r.status === 202 || r.status === 409,
  });
}
