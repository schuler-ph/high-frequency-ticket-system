"use client";

import { useEffect, useState } from "react";
import type { PaymentRequest } from "@repo/types/tickets";
import { payOrder } from "../lib/api";
import { fakePayment } from "../lib/payment";
import { Spinner } from "./Spinner";

interface PaymentModalProps {
  apiUrl: string;
  orderId: string;
  /** Name aus dem Kauf-Formular — Karteninhaber wird damit vorbefuellt. */
  cardHolder: string;
  onPaid: (orderId: string) => void;
  onClose: () => void;
}

type Status = "form" | "challenge" | "processing";

const fieldClass =
  "px-4 py-3 bg-zinc-900 border border-zinc-700 text-white font-mono placeholder:text-zinc-600 focus:outline-none focus:border-[#FFE600]";
const labelClass =
  "font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500";

/**
 * SIMULATION-Checkout: Nach der Redis-Reservierung (`POST /buy`) bestaetigt
 * dieses Modal die (Fake-)Zahlung und ruft die Pay-Route auf, die den
 * `BuyTicketEvent` published (ADR-028). Kein CSS ausserhalb von Tailwind.
 */
export function PaymentModal({
  apiUrl,
  orderId,
  cardHolder,
  onPaid,
  onClose,
}: PaymentModalProps) {
  const [payment, setPayment] = useState<PaymentRequest>(() =>
    fakePayment(cardHolder),
  );
  const [status, setStatus] = useState<Status>("form");
  const [error, setError] = useState<string | null>(null);
  // Simulierter 3DS-Code, den die "Bank" angeblich per SMS schickt. Der
  // OTP-Prompt wird damit vorbefuellt (reine UX-Simulation, serverseitig
  // ungeprueft — die Pay-Route kennt keine OTP).
  const sentCode = useState(() =>
    String(Math.floor(100000 + Math.random() * 900000)),
  )[0];
  const [otp, setOtp] = useState("");

  const busy = status === "processing";

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  function update(field: keyof PaymentRequest, value: string) {
    setPayment((prev) => ({ ...prev, [field]: value }));
  }

  // Schritt 1: Kartendaten bestaetigt → simulierte 3DS-Challenge anzeigen.
  // Es wird noch nicht bezahlt; die Pay-Route feuert erst nach dem OTP.
  function handleSubmitCard(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOtp(sentCode);
    setStatus("challenge");
  }

  // Schritt 2: OTP bestaetigt → jetzt POST /pay (published BuyTicketEvent).
  async function handleConfirmOtp(e: React.FormEvent) {
    e.preventDefault();
    setStatus("processing");
    setError(null);
    const result = await payOrder(apiUrl, orderId, payment);
    if (result.ok) {
      onPaid(orderId);
      return;
    }
    setError(result.message);
    setStatus("form");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Zahlung"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="w-full max-w-md border border-zinc-700 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-[3px] bg-[#FFE600]" />

        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <span className="font-mono text-xs uppercase tracking-[0.3em] text-zinc-400">
            Zahlung — Simulation
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Schließen"
            className="font-black text-zinc-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            ✕
          </button>
        </div>

        {busy ? (
          <div className="flex flex-col items-center gap-4 px-6 py-14">
            <Spinner className="h-10 w-10 text-[#FFE600]" />
            <span className="font-mono text-sm uppercase tracking-widest text-zinc-400">
              Zahlung wird verarbeitet…
            </span>
          </div>
        ) : status === "challenge" ? (
          <form
            onSubmit={(e) => void handleConfirmOtp(e)}
            className="flex flex-col gap-4 px-6 py-6"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🔒</span>
              <span className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-400">
                3-D Secure — Ihre Bank
              </span>
            </div>
            <p className="font-mono text-[11px] leading-relaxed text-zinc-500">
              Wir haben einen Bestätigungscode an die hinterlegte Nummer{" "}
              <span className="text-zinc-400">•••• 84</span> gesendet. Code zur
              Simulation: <span className="text-[#FFE600]">{sentCode}</span>
            </p>

            {error && (
              <div className="border border-red-500/40 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className={labelClass} htmlFor="otp">
                Bestätigungscode
              </label>
              <input
                id="otp"
                type="text"
                inputMode="numeric"
                autoFocus
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                required
                className={`${fieldClass} tracking-[0.4em]`}
              />
            </div>

            <div className="mt-2 flex gap-3">
              <button
                type="submit"
                className="flex-1 bg-[#FFE600] px-8 py-4 text-lg font-black uppercase tracking-wide text-zinc-950 transition-all duration-100 hover:bg-yellow-300 active:translate-y-px"
              >
                Bestätigen →
              </button>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStatus("form");
                }}
                className="border border-zinc-700 px-5 py-4 font-mono text-sm uppercase tracking-wide text-zinc-400 transition-colors hover:border-zinc-500"
              >
                Zurück
              </button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={(e) => void handleSubmitCard(e)}
            className="flex flex-col gap-4 px-6 py-6"
          >
            <p className="font-mono text-[11px] leading-relaxed text-zinc-500">
              Testdaten — keine echte Zahlung. Bestellung{" "}
              <span className="text-zinc-400">{orderId.slice(0, 8)}…</span>
            </p>

            {error && (
              <div className="border border-red-500/40 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className={labelClass} htmlFor="cardHolder">
                Karteninhaber
              </label>
              <input
                id="cardHolder"
                type="text"
                value={payment.cardHolder}
                onChange={(e) => update("cardHolder", e.target.value)}
                required
                className={fieldClass}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className={labelClass} htmlFor="cardNumber">
                Kartennummer
              </label>
              <input
                id="cardNumber"
                type="text"
                inputMode="numeric"
                value={payment.cardNumber}
                onChange={(e) => update("cardNumber", e.target.value)}
                required
                className={fieldClass}
              />
            </div>

            <div className="flex gap-4">
              <div className="flex flex-1 flex-col gap-1">
                <label className={labelClass} htmlFor="expiry">
                  Ablauf (MM/JJ)
                </label>
                <input
                  id="expiry"
                  type="text"
                  placeholder="MM/JJ"
                  value={payment.expiry}
                  onChange={(e) => update("expiry", e.target.value)}
                  required
                  className={fieldClass}
                />
              </div>
              <div className="flex w-24 flex-col gap-1">
                <label className={labelClass} htmlFor="cvc">
                  CVC
                </label>
                <input
                  id="cvc"
                  type="text"
                  inputMode="numeric"
                  value={payment.cvc}
                  onChange={(e) => update("cvc", e.target.value)}
                  required
                  className={fieldClass}
                />
              </div>
            </div>

            <div className="mt-2 flex gap-3">
              <button
                type="submit"
                className="flex-1 bg-[#FFE600] px-8 py-4 text-lg font-black uppercase tracking-wide text-zinc-950 transition-all duration-100 hover:bg-yellow-300 active:translate-y-px"
              >
                Bezahlen →
              </button>
              <button
                type="button"
                onClick={onClose}
                className="border border-zinc-700 px-5 py-4 font-mono text-sm uppercase tracking-wide text-zinc-400 transition-colors hover:border-zinc-500"
              >
                Abbrechen
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
