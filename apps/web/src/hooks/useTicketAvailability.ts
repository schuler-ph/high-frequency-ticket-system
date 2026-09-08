import { useCallback, useEffect, useRef, useState } from "react";
import { MAIN_SALE_EVENT_ID } from "@repo/types/tickets";
import { fetchAvailability } from "../lib/api";

interface AvailabilityState {
  available: number | null;
  total: number | null;
  // Unix-Ms-Timestamp des Verkaufsstarts; `null` => sofort offen.
  opensAt: number | null;
  loading: boolean;
  error: string | null;
}

export function useTicketAvailability(intervalMs = 3000): AvailabilityState {
  const [state, setState] = useState<AvailabilityState>({
    available: null,
    total: null,
    opensAt: null,
    loading: true,
    error: null,
  });

  const isFirstFetch = useRef(true);

  const poll = useCallback(async () => {
    try {
      const data = await fetchAvailability(MAIN_SALE_EVENT_ID);
      setState({
        available: data.available,
        total: data.total,
        opensAt: data.opensAt,
        loading: false,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Verbindungsfehler";
      setState((prev) => ({
        ...prev,
        loading: false,
        error: isFirstFetch.current ? message : prev.error,
      }));
    } finally {
      isFirstFetch.current = false;
    }
  }, []);

  useEffect(() => {
    void poll();
    const id = setInterval(() => void poll(), intervalMs);
    return () => clearInterval(id);
  }, [poll, intervalMs]);

  return state;
}
