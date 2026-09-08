import { useState } from "react";
import type { PaymentRequest } from "@repo/types/tickets";
import { payOrder } from "../lib/api";
import { OFFER } from "../lib/offer";
import { fakePayment } from "../lib/payment";
import { inputClass, primaryBtn, secondaryBtn } from "./PageChrome";
import { Spinner } from "./Spinner";

interface PaymentFormProps {
  orderId: string;
  /** Name der Reservierung — Karteninhaber wird damit vorbefuellt. */
  cardHolder: string;
  onPaid: (orderId: string) => void;
  /** „Abbrechen“: die Seite gibt die Reservierung frei und verlaesst den Checkout. */
  onCancel: () => void;
  /**
   * Der Server hat die Zahlung als abgelaufen abgelehnt (`410`). Das ist ein
   * Endzustand: zurueck ins Kartenformular zu fallen wuerde einen zweiten
   * Versuch anbieten, der nie gelingen kann.
   */
  onExpired: () => void;
}

type Status = "form" | "challenge" | "processing";

const labelClass =
  "text-xs font-semibold uppercase tracking-wide text-slate-400";

/**
 * SIMULATION-Checkout: Nach der Redis-Reservierung (`POST /buy`) bestaetigt
 * dieses Formular die (Fake-)Zahlung und ruft die Pay-Route auf, die den
 * `BuyTicketEvent` published (ADR-028). Es liegt inline in der Checkout-Seite
 * — kein Modal, kein Backdrop; die Seite ist ueber ihre URL erreichbar.
 */
export function PaymentForm({
  orderId,
  cardHolder,
  onPaid,
  onCancel,
  onExpired,
}: PaymentFormProps) {
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
    const result = await payOrder(orderId, payment);
    if (result.ok) {
      onPaid(orderId);
      return;
    }
    // Abgelaufen ist terminal — die Seite uebernimmt und zeigt den Endzustand.
    if (result.expired) {
      onExpired();
      return;
    }
    setError(result.message);
    setStatus("form");
  }

  if (status === "processing") {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <Spinner className="h-10 w-10 text-[#14395e]" />
        <span className="text-sm text-slate-500">
          Zahlung wird verarbeitet…
        </span>
      </div>
    );
  }

  if (status === "challenge") {
    return (
      <form
        onSubmit={(e) => void handleConfirmOtp(e)}
        className="flex flex-col gap-4"
      >
        <div className="flex items-center gap-3 rounded-md bg-[#14395e]/5 px-4 py-3 ring-1 ring-[#14395e]/10">
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
          <span className="font-mono font-semibold text-[#14395e]">
            {sentCode}
          </span>
        </p>

        {error && <ErrorBanner message={error} />}

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
            className={`${inputClass} tracking-[0.4em]`}
          />
        </div>

        <div className="mt-1 flex flex-col gap-3 sm:flex-row">
          <button type="submit" className={`${primaryBtn} flex-1 py-3`}>
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
    );
  }

  return (
    <form
      onSubmit={(e) => void handleSubmitCard(e)}
      className="flex flex-col gap-4"
    >
      {error && <ErrorBanner message={error} />}

      <div className="flex flex-col gap-1.5">
        <label className={labelClass} htmlFor="cardHolder">
          Karteninhaber
        </label>
        <input
          id="cardHolder"
          type="text"
          autoComplete="cc-name"
          value={payment.cardHolder}
          onChange={(e) => update("cardHolder", e.target.value)}
          required
          className={inputClass}
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
          autoComplete="cc-number"
          value={payment.cardNumber}
          onChange={(e) => update("cardNumber", e.target.value)}
          required
          className={`${inputClass} font-mono`}
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
            autoComplete="cc-exp"
            value={payment.expiry}
            onChange={(e) => update("expiry", e.target.value)}
            required
            className={`${inputClass} font-mono`}
          />
        </div>
        <div className="flex w-28 flex-col gap-1.5">
          <label className={labelClass} htmlFor="cvc">
            CVC
          </label>
          <input
            id="cvc"
            type="text"
            inputMode="numeric"
            autoComplete="cc-csc"
            value={payment.cvc}
            onChange={(e) => update("cvc", e.target.value)}
            required
            className={`${inputClass} font-mono`}
          />
        </div>
      </div>

      <div className="mt-1 flex flex-col gap-3 sm:flex-row">
        <button type="submit" className={`${primaryBtn} flex-1 py-3`}>
          {OFFER.price} bezahlen
        </button>
        <button type="button" onClick={onCancel} className={secondaryBtn}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 ring-1 ring-red-600/10">
      {message}
    </div>
  );
}
