import type {
  BuyTicketBody,
  BuyTicketResponse,
  CancelOrderResponse,
  OrderStatusResponse,
  PaymentRequest,
  PaymentResponse,
  TicketAvailabilityResponse,
} from "@repo/types/tickets";

export async function fetchAvailability(
  apiUrl: string,
  eventId: string,
): Promise<TicketAvailabilityResponse> {
  const res = await fetch(`${apiUrl}/api/tickets/${eventId}/availability`);
  if (!res.ok) throw new Error(`Availability fetch failed: ${res.status}`);
  return res.json() as Promise<TicketAvailabilityResponse>;
}

type BuyResult =
  | { ok: true; data: BuyTicketResponse }
  | { ok: false; soldOut: boolean; message: string };

export async function buyTicket(
  apiUrl: string,
  eventId: string,
  body: BuyTicketBody,
): Promise<BuyResult> {
  const res = await fetch(`${apiUrl}/api/tickets/${eventId}/buy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.status === 409) {
    return { ok: false, soldOut: true, message: "Ausverkauft" };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "Unbekannter Fehler");
    return { ok: false, soldOut: false, message: text };
  }

  const data = (await res.json()) as BuyTicketResponse;
  return { ok: true, data };
}

type PayResult =
  | { ok: true; data: PaymentResponse }
  | { ok: false; expired: boolean; message: string };

/**
 * Bestaetigt die (simulierte) Zahlung: published via Pay-Route den
 * `BuyTicketEvent` (ADR-028). Kartendaten sind reine Fake-Daten, sie werden
 * serverseitig nur validiert und verworfen.
 */
export async function payOrder(
  apiUrl: string,
  orderId: string,
  payment: PaymentRequest,
): Promise<PayResult> {
  const res = await fetch(`${apiUrl}/api/orders/${orderId}/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payment),
  });

  if (!res.ok) {
    // 410 sagt der Server explizit: die Deadline ist verstrichen (ADR-033).
    // Das war frueher ein Rateschluss aus 404 — der bedeutet jetzt wieder das,
    // was er sagt: zu dieser orderId gibt es keine Order.
    if (res.status === 410) {
      return { ok: false, expired: true, message: "Reservierung abgelaufen" };
    }
    if (res.status === 404) {
      return {
        ok: false,
        expired: false,
        message: "Reservierung nicht gefunden",
      };
    }
    if (res.status === 409) {
      return {
        ok: false,
        expired: false,
        message: "Order bereits abgeschlossen",
      };
    }
    const text = await res.text().catch(() => "Zahlung fehlgeschlagen");
    return { ok: false, expired: false, message: text };
  }

  const data = (await res.json()) as PaymentResponse;
  return { ok: true, data };
}

/**
 * Gibt eine noch nicht bezahlte Reservierung frei (Checkout-Abbruch/Timeout).
 * Idempotent — ein Fehler hier ist nicht fatal, der Reaper (Phase 6) raeumt
 * verwaiste Reservierungen ohnehin nach.
 */
export async function cancelOrder(
  apiUrl: string,
  orderId: string,
): Promise<CancelOrderResponse | null> {
  const res = await fetch(`${apiUrl}/api/orders/${orderId}/cancel`, {
    method: "POST",
  });
  if (!res.ok) return null;
  return res.json() as Promise<CancelOrderResponse>;
}

/**
 * Liest den finalen Order-Status ausschliesslich aus Redis (`pending` aus der
 * API, `completed`/`failed` aus dem Worker). `null`, wenn (noch) kein Record
 * existiert (`404`).
 */
export async function fetchOrderStatus(
  apiUrl: string,
  orderId: string,
): Promise<OrderStatusResponse | null> {
  const res = await fetch(`${apiUrl}/api/orders/${orderId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Order status fetch failed: ${res.status}`);
  return res.json() as Promise<OrderStatusResponse>;
}
