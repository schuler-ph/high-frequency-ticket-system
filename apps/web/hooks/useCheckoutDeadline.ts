"use client";

import { useEffect, useRef, useState } from "react";

type CheckoutDeadline = {
  /** Verbleibende Millisekunden, nie negativ. */
  remainingMs: number;
  /** `true`, sobald die Deadline lokal erreicht ist. */
  elapsed: boolean;
};

/**
 * Rechnet die Restzeit eines Checkouts gegen die **Server**-Uhr.
 *
 * Der Server liefert zu jedem Read `expiresAt` und `serverTime`. Aus der
 * Differenz zur lokalen Uhr ergibt sich ein Versatz, der auf jede weitere
 * Sekunde angewendet wird — eine falsch gestellte Client-Uhr verschiebt den
 * Countdown damit nicht. Jeder neue Status-Poll verankert den Versatz neu.
 *
 * Der lokale Ablauf ist eine Anzeige, keine Entscheidung: verbindlich ist
 * allein die Deadline-Pruefung in `POST /pay` (ADR-033).
 */
export function useCheckoutDeadline(
  expiresAt: number | null,
  serverTime: number | null,
): CheckoutDeadline {
  const skewRef = useRef(0);
  const [now, setNow] = useState(() => Date.now());

  // Versatz nur als Seiteneffekt neu verankern, nie waehrend des Renders.
  useEffect(() => {
    if (serverTime === null) return;
    skewRef.current = serverTime - Date.now();
    setNow(Date.now());
  }, [serverTime]);

  useEffect(() => {
    if (expiresAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (expiresAt === null) {
    return { remainingMs: 0, elapsed: false };
  }

  const remainingMs = Math.max(0, expiresAt - (now + skewRef.current));
  return { remainingMs, elapsed: remainingMs === 0 };
}

/** `mm:ss` aus einer Restdauer in Millisekunden. */
export function formatRemaining(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
