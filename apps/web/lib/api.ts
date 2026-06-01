import type {
  BuyTicketBody,
  BuyTicketResponse,
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
