import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

// Diagnose-Metriken (Stage 3). Die eingebauten k6-Metriken sind global; diese
// Counter machen (a) den Checkout-Funnel lastseitig sichtbar (Abbruchrate
// `1 − funnel_paid/funnel_reserved`), (b) die HTTP-Status-Verteilung je Endpoint
// und (c) Transportfehler (Requests ohne App-Response — genau die ~0,28 % aus
// Baseline A) je Endpoint + `error_code` auswertbar.
const funnelReserved = new Counter("funnel_reserved"); // buy → 202
const funnelPaid = new Counter("funnel_paid"); // pay → 200
const funnelCancelled = new Counter("funnel_cancelled"); // cancel → 200
const funnelSoldOut = new Counter("funnel_sold_out"); // buy → 409
const funnelTooEarly = new Counter("funnel_too_early"); // buy → 425
const funnelAbandoned = new Counter("funnel_abandoned"); // reserviert, nie bezahlt/storniert
// Zahlversuch, dessen Deadline lastseitig bereits verstrichen war, und die
// Ablehnung durch den Server. Die Differenz der beiden zeigt ein etwaiges
// Gnadenfenster — seit ADR-033 sollte sie 0 sein.
const funnelPayExpiredAttempt = new Counter("funnel_pay_expired_attempt");
const funnelPayRejected = new Counter("funnel_pay_rejected"); // getaggt nach { reason }
// Getaggt nach { endpoint, status } bzw. { endpoint, error_code }.
const requestsByStatus = new Counter("requests_by_status");
const transportErrors = new Counter("transport_errors");

/**
 * k6 taggt jedes `http_req_*`-Sample per Default zusaetzlich mit `url` und
 * `name`, wobei `name` ohne expliziten Wert auf die volle URL zurueckfaellt.
 * Die order-scoped Routen (`/orders/:orderId/...`) tragen eine UUID im Pfad —
 * damit wurde JEDE Bestellung zu einer eigenen Zeitreihe, mal ~10
 * `http_req_*`-Metriken. Ein Kapazitaetslauf erzeugte so Millionen Serien
 * (beobachtet: 3,2 Mio nach ~3,5 min), die die Metrics-Engine im Speicher des
 * Generators haelt — dieselbe Kardinalitaet, die in Baseline B Prometheus mit
 * 5,5 GiB gekillt hat. Ein ueberlasteter Generator misst nicht mehr das SUT,
 * sondern sich selbst.
 *
 * Gegenmassnahme, beide Haelften noetig:
 *  1. Die drei order-scoped Requests setzen einen statischen `name`-Tag.
 *  2. `url` faellt aus den System-Tags — sonst bliebe die rohe URL als zweiter
 *     hochkardinaler Tag stehen.
 *
 * Die Liste ersetzt den k6-Default vollstaendig, enthaelt also bewusst alle
 * uebrigen Default-Tags. `expected_response` muss drin bleiben: davon haengt
 * `http_req_failed` in Kombination mit den `responseCallback`s ab.
 */
export const SYSTEM_TAGS = [
  "proto",
  "subproto",
  "status",
  "method",
  "name",
  "group",
  "check",
  "error",
  "error_code",
  "tls_version",
  "scenario",
  "service",
  "expected_response",
];

/**
 * k6 laeuft in einer eigenen Runtime und sieht weder `@repo/env` noch die
 * Profil-Datei — es bekommt nur das Prozess-Env des Orchestrators. Damit fehlt
 * hier die Zod-Validierung, weshalb frueher jeder Wert einen `||`-Fallback
 * trug. Das war doppelt gefaehrlich: es verdeckte fehlende Werte, und `||`
 * verschluckt zusaetzlich jede explizite `0` (falsy), sodass ein bewusst
 * gesetztes `PAY_RATE=0` still zum Profil-Default wurde.
 *
 * Deshalb: harte Pflichtwerte mit Namensnennung (ADR-034).
 */
function requireEnv(name) {
  const value = __ENV[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} ist nicht gesetzt. Erwartet aus dem Env-Profil (config/env/<profil>.env). Aktuelles Profil: ${
        __ENV.HTS_ENV_PROFILE || "(keins)"
      }`,
    );
  }
  return value;
}

function requireEnvNumber(name) {
  const value = Number(requireEnv(name));
  if (!isFinite(value)) {
    throw new Error(`${name} ist keine Zahl: "${__ENV[name]}"`);
  }
  return value;
}

function requireEnvBoolean(name) {
  const value = requireEnv(name);
  if (value !== "true" && value !== "false") {
    throw new Error(
      `${name} muss "true" oder "false" sein, ist aber "${value}"`,
    );
  }
  return value === "true";
}

export const BASE_URL = requireEnv("BASE_URL");
export const EVENT_ID = requireEnv("EVENT_ID");

// Optionaler GET /orders/:orderId-Poll nach dem Pay. Der Poll misst die Zeit
// bis der Worker die Order persistiert hat, treibt aber die VU-Zahl und den
// Availability-/Orders-Read-Load nach oben. Fuer einen reinen
// Durchsatz-/Kapazitaetslauf reicht `buy`→`pay`; die Persistenz ist ueber die
// Worker-Metriken und den Drain-Monitor ohnehin sichtbar.
const CHECKOUT_POLL = requireEnvBoolean("CHECKOUT_POLL");
const POLL_MAX_ATTEMPTS = requireEnvNumber("CHECKOUT_POLL_MAX_ATTEMPTS");
const POLL_INTERVAL_SECONDS = requireEnvNumber("CHECKOUT_POLL_INTERVAL");

// Lastprofil (ADR-028/ADR-034). Da das Backend nach dem Reserve/Pay-Split KEINE
// kuenstliche Latenz mehr hat (Worker-Sleep raus, `/pay` ohne Server-Sleep),
// lebt die Checkout-Denkzeit als explizites `sleep()` hier im k6-Skript.
//
// Die frueher hier stehende Profil-Tabelle ist entfallen: sie war eine zweite
// Wahrheit neben der Profil-Datei und konnte von den Service-Werten abweichen —
// genau der Fall, in dem der Generator ein Funnel-Profil fuhr und die Services
// mit Default-Deadline liefen. `LOAD_PROFILE` ist jetzt nur noch ein Name fuers
// Manifest; die Zahlen kommen einzeln aus dem Env.
export const LOAD_PROFILE = requireEnv("LOAD_PROFILE");

const CHECKOUT_SHARE = requireEnvNumber("CHECKOUT_SHARE");
const PAY_RATE = requireEnvNumber("PAY_RATE");
const CANCEL_RATE = requireEnvNumber("CANCEL_RATE");
const CHECKOUT_ONLY = CHECKOUT_SHARE >= 1;

// "none" | "uniform" | "normal" — ohne Denkzeit laeuft `buy`→`pay`
// back-to-back und misst rohe Infrastruktur statt menschliches Timing.
const THINK_TIME_KIND = requireEnv("THINK_TIME_KIND");
const THINK_TIME_MIN = requireEnvNumber("THINK_TIME_MIN");
const THINK_TIME_MAX = requireEnvNumber("THINK_TIME_MAX");
const THINK_TIME_MEAN = requireEnvNumber("THINK_TIME_MEAN");
const THINK_TIME_SIGMA = requireEnvNumber("THINK_TIME_SIGMA");

if (!["none", "uniform", "normal"].includes(THINK_TIME_KIND)) {
  throw new Error(
    `THINK_TIME_KIND muss none, uniform oder normal sein, ist aber "${THINK_TIME_KIND}"`,
  );
}

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

/**
 * Zaehlt jede Response nach { endpoint, HTTP-Status } und — wenn k6 gar keine
 * App-Response bekam (Transportfehler: Status 0, `error_code` gesetzt) — nach
 * { endpoint, error_code }. So sind sowohl die Status-Verteilung als auch die
 * Requests ohne App-Response pro Stufe diagnostizierbar.
 */
function recordResponse(res, endpoint) {
  requestsByStatus.add(1, { endpoint, status: String(res.status) });
  if (res.error_code) {
    transportErrors.add(1, { endpoint, error_code: String(res.error_code) });
  }
}

export function checkAvailability() {
  const res = http.get(`${BASE_URL}/api/tickets/${EVENT_ID}/availability`, {
    tags: { endpoint: "availability" },
  });
  recordResponse(res, "availability");
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
  recordResponse(res, "buy");
  check(res, {
    "buy reserved, sold-out, or too-early": (r) =>
      r.status === 202 || r.status === 409 || r.status === 425,
  });

  if (res.status === 409) funnelSoldOut.add(1);
  if (res.status === 425) funnelTooEarly.add(1);
  if (res.status !== 202) return null;

  funnelReserved.add(1);
  try {
    const orderId = res.json("orderId");
    if (!orderId) return null;
    // `expiresAt`/`serverTime` seit Phase 4.10. Beide koennen fehlen, wenn ein
    // aelterer Stand getestet wird — dann faellt die Deadline-Auswertung weg.
    const expiresAt = res.json("expiresAt");
    const serverTime = res.json("serverTime");
    return {
      orderId,
      expiresAt: typeof expiresAt === "number" ? expiresAt : null,
      // Versatz zwischen Server- und Generator-Uhr, damit der Vergleich
      // "war ich zu spaet?" nicht von der lokalen Uhr abhaengt.
      clockSkewMs: typeof serverTime === "number" ? serverTime - Date.now() : 0,
    };
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
    tags: { endpoint: "pay", name: "orders_pay" },
    // 410 = Eligibility Deadline verstrichen (ADR-033). Wie 404/409 eine
    // erwartete Fach-Response, kein Infrastrukturfehler.
    responseCallback: http.expectedStatuses(200, 404, 409, 410),
  });
  recordResponse(res, "pay");
  check(res, {
    "pay confirmed (200)": (r) => r.status === 200,
  });
  if (res.status === 200) {
    funnelPaid.add(1);
    return true;
  }
  if (res.status === 410) funnelPayRejected.add(1, { reason: "expired" });
  if (res.status === 404) funnelPayRejected.add(1, { reason: "not-found" });
  if (res.status === 409) funnelPayRejected.add(1, { reason: "conflict" });
  return false;
}

/**
 * Gibt eine Reservierung wieder frei (`POST /orders/:orderId/cancel`), z.B. bei
 * simuliertem Checkout-Abbruch. Idempotent (`200`). Erst in der
 * Abandonment-Modellierung (Folge-Todo) verzweigt die Iteration hierhin.
 */
export function cancelOrder(orderId) {
  const res = http.post(`${BASE_URL}/api/orders/${orderId}/cancel`, null, {
    tags: { endpoint: "cancel", name: "orders_cancel" },
    responseCallback: http.expectedStatuses(200, 409),
  });
  recordResponse(res, "cancel");
  check(res, {
    "cancel handled (200)": (r) => r.status === 200,
  });
  if (res.status === 200) funnelCancelled.add(1);
  return res.status === 200;
}

/**
 * Optionaler Schritt 3: pollt `GET /orders/:orderId` bis der Worker die Order
 * finalisiert hat (`completed`/`failed`) oder das Attempt-Limit erreicht ist.
 */
export function pollOrderStatus(orderId) {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
    const res = http.get(`${BASE_URL}/api/orders/${orderId}`, {
      tags: { endpoint: "orders", name: "orders_get" },
      responseCallback: http.expectedStatuses(200, 404),
    });
    recordResponse(res, "orders");
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
 * Truncated Normal per Box-Muller — k6 hat kein `randn`.
 *
 * Bewusst Rejection Sampling statt Clamping: Clamping wuerde die gesamte Masse
 * ausserhalb der Grenzen auf genau `min`/`max` stapeln und damit kuenstliche
 * Spitzen erzeugen. Nach 8 vergeblichen Ziehungen faellt die Funktion auf den
 * geklemmten Mittelwert zurueck, damit sie garantiert terminiert.
 */
function truncatedNormal(mean, sigma, min, max) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const u1 = Math.random() || Number.MIN_VALUE;
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const value = mean + sigma * z;
    if (value >= min && value <= max) return value;
  }
  return Math.min(max, Math.max(min, mean));
}

/**
 * Simulierte Checkout-Denkzeit (Karteneingabe + 3DS). Bei `none` ein No-Op
 * (back-to-back); sonst eine randomisierte Pause, die die Reservierung sichtbar
 * laenger im Ledger haelt.
 */
function thinkTime() {
  if (THINK_TIME_KIND === "none") return;

  if (THINK_TIME_KIND === "normal") {
    sleep(
      truncatedNormal(
        THINK_TIME_MEAN,
        THINK_TIME_SIGMA,
        THINK_TIME_MIN,
        THINK_TIME_MAX,
      ),
    );
    return;
  }

  const span = Math.max(0, THINK_TIME_MAX - THINK_TIME_MIN);
  sleep(THINK_TIME_MIN + Math.random() * span);
}

/**
 * Voller Checkout-Funnel einer Iteration: reservieren → Denkzeit → verzweigen
 * (bezahlen / stornieren / abbrechen). Seit dem Reserve/Pay/Publish-Split
 * (ADR-028) ist der Pay-Schritt zwingend, damit ueberhaupt etwas
 * published/persistiert wird.
 */
export function runCheckout() {
  const reservation = buyTicket();
  if (!reservation) return;
  const orderId = reservation.orderId;

  // Karteneingabe/3DS-Denkzeit (profilabhaengig, siehe PROFILES).
  thinkTime();

  const roll = Math.random();
  if (roll < PAY_RATE) {
    // Zu-spaet-Zahler zahlen bewusst trotzdem: erst dieser Versuch erzeugt die
    // Ablehnung, die den Ablauf-Pfad unter Last belegt.
    if (
      reservation.expiresAt !== null &&
      Date.now() + reservation.clockSkewMs >= reservation.expiresAt
    ) {
      funnelPayExpiredAttempt.add(1);
    }
    const paid = payOrder(orderId);
    if (paid && CHECKOUT_POLL) pollOrderStatus(orderId);
  } else if (roll < PAY_RATE + CANCEL_RATE) {
    // Nutzer bricht das Modal bewusst ab → Reservierung wird freigegeben.
    cancelOrder(orderId);
  } else {
    // Abbruch OHNE Cancel — die Ledger-Reservierung bleibt als Phantom-Anspruch
    // stehen (Reaper-Kandidat, Phase 6). Nur lastseitig gezaehlt.
    funnelAbandoned.add(1);
  }
}

/**
 * Mischung aus Availability-Read und vollem Checkout-Funnel. Der Anteil kommt
 * aus dem Profil (`checkoutShare`): 0,4 fuer capacity/realism, 1 fuer checkout
 * (dann entfaellt der Read komplett) und bewusst klein fuer funnel.
 */
export function ticketSaleIteration() {
  if (CHECKOUT_ONLY || Math.random() < CHECKOUT_SHARE) {
    runCheckout();
  } else {
    checkAvailability();
  }
}
