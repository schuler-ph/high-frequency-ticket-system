import http from "k6/http";
import { check } from "k6";

export const BASE_URL = __ENV.BASE_URL || "http://localhost:10002";
// Default: Frequency Festival 20XX Main Sale (1M tickets, matches local seed)
export const EVENT_ID =
  __ENV.EVENT_ID || "00000000-0000-4000-8000-000000000000";

const FIRST_NAMES = [
  "Anna",
  "Max",
  "Julia",
  "Felix",
  "Sophie",
  "Lukas",
  "Laura",
  "Tobias",
  "Lea",
  "Simon",
  "Emma",
  "Jonas",
  "Lena",
  "Philipp",
  "Mia",
  "Florian",
];
const LAST_NAMES = [
  "Müller",
  "Schmidt",
  "Schwarz",
  "Gruber",
  "Huber",
  "Wagner",
  "Bauer",
  "Maier",
  "Fischer",
  "Weber",
  "Schneider",
  "Meyer",
  "Wolf",
  "Steiner",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function checkAvailability() {
  const res = http.get(`${BASE_URL}/api/tickets/${EVENT_ID}/availability`, {
    tags: { endpoint: "availability" },
  });
  check(res, {
    "availability 200": (r) => r.status === 200,
  });
}

export function buyTicket() {
  const body = JSON.stringify({
    firstName: pick(FIRST_NAMES),
    lastName: pick(LAST_NAMES),
  });
  const res = http.post(`${BASE_URL}/api/tickets/${EVENT_ID}/buy`, body, {
    headers: { "Content-Type": "application/json" },
    tags: { endpoint: "buy" },
    // 202 = queued, 409 = sold out, 425 = sale not open yet — all expected,
    // none of them are infrastructure failures.
    responseCallback: http.expectedStatuses(202, 409, 425),
  });
  check(res, {
    "buy queued, sold-out, or too-early": (r) =>
      r.status === 202 || r.status === 409 || r.status === 425,
  });
}

// 60% availability checks, 40% buy attempts per iteration
export function ticketSaleIteration() {
  if (Math.random() < 0.4) {
    buyTicket();
  } else {
    checkAvailability();
  }
}
