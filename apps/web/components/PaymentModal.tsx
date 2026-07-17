"use client";

import { useEffect, useState } from "react";
import type { PaymentRequest } from "@repo/types/tickets";
import { payOrder } from "../lib/api";
import { fakePayment } from "../lib/payment";
import { Spinner } from "./Spinner";
import { StatusChip } from "./StatusChip";

interface PaymentModalProps {
  apiUrl: string;
  orderId: string;
  /** Name aus dem Kauf-Formular — Karteninhaber wird damit vorbefuellt. */
  cardHolder: string;
  onPaid: (orderId: string) => void;
  onClose: () => void;
}

type Status = "form" | "challenge" | "processing";

const labelClass =
  "text-xs font-semibold uppercase tracking-wide text-slate-400";
const fieldClass =
  "w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 focus:outline-none";
const primaryBtn =
  "flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-blue-700 active:bg-blue-800";
const secondaryBtn =
  "rounded-lg border border-slate-300 px-5 py-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50";

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Bezahlung"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="text-base font-bold text-slate-900">Bezahlung</span>
            <StatusChip tone="slate">Simulation</StatusChip>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Schließen"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {busy ? (
          <div className="flex flex-col items-center gap-4 px-6 py-16">
            <Spinner className="h-10 w-10 text-blue-600" />
            <span className="text-sm text-slate-500">
              Zahlung wird verarbeitet…
            </span>
          </div>
        ) : status === "challenge" ? (
          <form
            onSubmit={(e) => void handleConfirmOtp(e)}
            className="flex flex-col gap-4 px-6 py-6"
          >
            <div className="flex items-center gap-3 rounded-lg bg-blue-50 px-4 py-3 ring-1 ring-blue-600/10">
              <span className="text-xl">🔒</span>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-slate-900">
                  3-D Secure — Ihre Bank
                </span>
                <span className="text-xs text-slate-500">
                  Code an •••• 84 gesendet
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-500">
              Code zur Simulation:{" "}
              <span className="font-mono font-semibold text-blue-600">
                {sentCode}
              </span>
            </p>

            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 ring-1 ring-red-600/10">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
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

            <div className="mt-1 flex gap-3">
              <button type="submit" className={primaryBtn}>
                Bestätigen
              </button>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStatus("form");
                }}
                className={secondaryBtn}
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
            <p className="text-xs text-slate-500">
              Testdaten — keine echte Zahlung. Bestellung{" "}
              <span className="font-mono text-slate-700">
                {orderId.slice(0, 8)}…
              </span>
            </p>

            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 ring-1 ring-red-600/10">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
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

            <div className="flex flex-col gap-1.5">
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
              <div className="flex flex-1 flex-col gap-1.5">
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
              <div className="flex w-24 flex-col gap-1.5">
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

            <div className="mt-1 flex gap-3">
              <button type="submit" className={primaryBtn}>
                {PRICE_LABEL} bezahlen
              </button>
              <button type="button" onClick={onClose} className={secondaryBtn}>
                Abbrechen
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const PRICE_LABEL = "€ 199,00";
