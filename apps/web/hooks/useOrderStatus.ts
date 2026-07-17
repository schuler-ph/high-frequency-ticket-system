"use client";

import { useEffect, useState } from "react";
import type { OrderStatusResponse } from "@repo/types/tickets";
import { fetchOrderStatus } from "../lib/api";
import { env } from "../lib/env";

interface OrderStatusState {
  status: OrderStatusResponse | null;
  error: string | null;
}

/**
 * Pollt `GET /api/orders/:orderId`, bis die Order final ist
 * (`completed`/`failed`), und stoppt danach. Ein leichter Jitter auf dem
 * Intervall verteilt gleichzeitige Tracker etwas — die vollstaendige
 * Backoff-/Long-Polling-Strategie ist Phase 6.
 */
export function useOrderStatus(
  orderId: string,
  intervalMs = 2000,
): OrderStatusState {
  const [state, setState] = useState<OrderStatusState>({
    status: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const status = await fetchOrderStatus(env.apiUrl, orderId);
        if (cancelled) return;
        setState({ status, error: null });
        if (status !== null && status.status !== "pending") return; // final → stop
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : "Verbindungsfehler",
        }));
      }
      const jitter = Math.floor(Math.random() * 400);
      timer = setTimeout(() => void poll(), intervalMs + jitter);
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [orderId, intervalMs]);

  return state;
}
