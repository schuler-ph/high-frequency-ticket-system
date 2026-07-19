import http from "k6/http";
import { check, sleep } from "k6";

export const BASE_URL = __ENV.BASE_URL || "http://localhost:10002";
// Default: Frequency Festival 20XX Main Sale (1M tickets, matches local seed)
export const EVENT_ID =
  __ENV.EVENT_ID || "00000000-0000-4000-8000-000000000000";

// Optionaler GET /orders/:orderId-Poll nach dem Pay (Default: aus). Der Poll
// misst die Zeit bis der Worker die Order persistiert hat, treibt aber die
// VU-Zahl und den Availability-/Orders-Read-Load nach oben. Fuer einen reinen
// Durchsatz-/Kapazitaetslauf reicht `buy`→`pay`; die Persistenz ist ueber die
// Worker-Metriken und den Drain-Monitor ohnehin sichtbar.
const CHECKOUT_POLL = (__ENV.CHECKOUT_POLL || "false") === "true";
const POLL_MAX_ATTEMPTS = Number(__ENV.CHECKOUT_POLL_MAX_ATTEMPTS || 10);
const POLL_INTERVAL_SECONDS = Number(__ENV.CHECKOUT_POLL_INTERVAL || 1);

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

// SIMULATION: Fake-Zahlungsdaten (Testnummer 4242…). Die Pay-Route validiert
// nur das Format und published dann den BuyTicketEvent — keine echten
// Kartendaten, keine Persistenz (ADR-013/ADR-028).
const FAKE_PAYMENT = JSON.stringify({
  cardHolder: "Load Test",
  cardNumber: "4242 4242 4242 4242",
  expiry: "12/30",
  cvc: "123",
});

const JSON_HEADERS = { "Content-Type": "application/json" };

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

/**
 * Schritt 1 des Checkouts: reserviert ein Ticket (`POST /buy`). Liefert die
 * `orderId` zurueck, wenn reserviert wurde (`202`), sonst `null` (Sold-Out
 * `409` / Too-Early `425` — beides erwartete Responses, keine Infra-Fehler).
 */
export function buyTicket() {
  const body = JSON.stringify({
    firstName: pick(FIRST_NAMES),
    lastName: pick(LAST_NAMES),
  });
  const res = http.post(`${BASE_URL}/api/tickets/${EVENT_ID}/buy`, body, {
    headers: JSON_HEADERS,
    tags: { endpoint: "buy" },
    // 202 = reserviert, 409 = sold out, 425 = sale not open yet — all expected,
    // none of them are infrastructure failures.
    responseCallback: http.expectedStatuses(202, 409, 425),
  });
  check(res, {
    "buy reserved, sold-out, or too-early": (r) =>
      r.status === 202 || r.status === 409 || r.status === 425,
  });

  if (res.status !== 202) return null;
  try {
    return res.json("orderId");
  } catch {
    return null;
  }
}

/**
 * Schritt 2 des Checkouts: bestaetigt die (simulierte) Zahlung
 * (`POST /orders/:orderId/pay`). Das ist die Route, die den BuyTicketEvent an
 * Pub/Sub published — erst danach persistiert der Worker. Liefert `true` bei
 * `200`. `404`/`409` sind erwartete Fach-Responses (keine Reservierung /
 * bereits finalisiert), kein Infra-Fehler.
 */
export function payOrder(orderId) {
  const res = http.post(`${BASE_URL}/api/orders/${orderId}/pay`, FAKE_PAYMENT, {
    headers: JSON_HEADERS,
    tags: { endpoint: "pay" },
    responseCallback: http.expectedStatuses(200, 404, 409),
  });
  check(res, {
    "pay confirmed (200)": (r) => r.status === 200,
  });
  return res.status === 200;
}

/**
 * Gibt eine Reservierung wieder frei (`POST /orders/:orderId/cancel`), z.B. bei
 * simuliertem Checkout-Abbruch. Idempotent (`200`). Erst in der
 * Abandonment-Modellierung (Folge-Todo) verzweigt die Iteration hierhin.
 */
export function cancelOrder(orderId) {
  const res = http.post(`${BASE_URL}/api/orders/${orderId}/cancel`, null, {
    tags: { endpoint: "cancel" },
    responseCallback: http.expectedStatuses(200, 409),
  });
  check(res, {
    "cancel handled (200)": (r) => r.status === 200,
  });
  return res.status === 200;
}

/**
 * Optionaler Schritt 3: pollt `GET /orders/:orderId` bis der Worker die Order
 * finalisiert hat (`completed`/`failed`) oder das Attempt-Limit erreicht ist.
 */
export function pollOrderStatus(orderId) {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
    const res = http.get(`${BASE_URL}/api/orders/${orderId}`, {
      tags: { endpoint: "orders" },
      responseCallback: http.expectedStatuses(200, 404),
    });
    if (res.status === 200) {
      let status;
      try {
        status = res.json("status");
      } catch {
        status = undefined;
      }
      if (status === "completed" || status === "failed") return status;
    }
    if (POLL_INTERVAL_SECONDS > 0) sleep(POLL_INTERVAL_SECONDS);
  }
  return null;
}

/**
 * Voller Checkout-Funnel einer Iteration: reservieren → bezahlen → optional
 * auf Persistenz warten. Seit dem Reserve/Pay/Publish-Split (ADR-028) ist der
 * Pay-Schritt zwingend, damit ueberhaupt etwas published/persistiert wird.
 */
export function runCheckout() {
  const orderId = buyTicket();
  if (!orderId) return;

  const paid = payOrder(orderId);
  if (!paid) return;

  if (CHECKOUT_POLL) {
    pollOrderStatus(orderId);
  }
}

// 60% availability checks, 40% full checkout funnel (buy → pay → optional poll)
export function ticketSaleIteration() {
  if (Math.random() < 0.4) {
    runCheckout();
  } else {
    checkAvailability();
  }
}
