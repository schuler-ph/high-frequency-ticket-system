import { Navigate, useNavigate, useParams } from "react-router";
import { useState } from "react";
import type { OrderStatusResponse } from "@repo/types/tickets";
import { OfferHeadline } from "../components/OfferHeadline";
import { PageChrome, panel, secondaryBtn } from "../components/PageChrome";
import { PaymentForm } from "../components/PaymentForm";
import { Spinner } from "../components/Spinner";
import { StatusChip, type ChipTone } from "../components/StatusChip";
import {
  formatRemaining,
  useCheckoutDeadline,
} from "../hooks/useCheckoutDeadline";
import { useOrderStatus } from "../hooks/useOrderStatus";
import { cancelOrder } from "../lib/api";
import { env } from "../lib/env";
import { OFFER } from "../lib/offer";

/**
 * Checkout einer konkreten Reservierung.
 *
 * Die `orderId` steht in der URL und nicht im React-State: die Seite ist damit
 * reload-fest und teilbar, und Restzeit, Status wie Name kommen bei jedem
 * Aufruf frisch aus `GET /api/orders/:orderId` (Redis-Read-Model). Ein
 * `orderId` ist eine nicht ratbare UUID; wer die URL kennt, sieht den
 * Checkout — Zahlungsformular, Countdown und die unveraenderlichen Daten der
 * Reservierung in der Zusammenfassung rechts.
 */
export function CheckoutPage() {
  // React Router typisiert Parameter als optional; die Route
  // `/checkout/:orderId` garantiert den Wert, der Fallback ist nur Typ-Hygiene.
  const { orderId } = useParams<"orderId">();
  if (orderId === undefined) {
    return <Navigate to="/" replace />;
  }
  return <Checkout orderId={orderId} />;
}

function Checkout({ orderId }: { orderId: string }) {
  const navigate = useNavigate();
  const { status, error, loaded } = useOrderStatus(orderId);
  // Lokal gesetzt, sobald `POST /pay` bestaetigt hat. Oeffentlich bleibt die
  // Order bis zur Worker-Finalisierung `pending`, deshalb kann der Status
  // allein nicht zwischen "bitte zahlen" und "wird verarbeitet" unterscheiden.
  const [paid, setPaid] = useState(false);
  // Der Server hat einen Zahlversuch als abgelaufen abgelehnt. Der naechste
  // Poll bestaetigt das als `expired`; bis dahin zeigen wir es schon an.
  const [rejectedAsExpired, setRejectedAsExpired] = useState(false);

  const pending = status?.status === "pending" ? status : null;
  const { remainingMs, elapsed } = useCheckoutDeadline(
    pending?.expiresAt ?? null,
    pending?.serverTime ?? null,
  );

  const expired = status?.status === "expired" || rejectedAsExpired;

  function leaveCheckout() {
    void navigate("/");
  }

  // Abbruch: Reservierung freigeben (idempotent, fire-and-forget — ADR-028)
  // und zurueck zur Angebotsseite.
  function handleCancel() {
    void cancelOrder(env.apiUrl, orderId);
    leaveCheckout();
  }

  if (!loaded) {
    return (
      <CheckoutLayout
        orderId={orderId}
        status={null}
        chip={{ tone: "blue", label: "Wird geladen" }}
      >
        <div className="flex items-center gap-3 py-6 text-slate-500">
          <Spinner className="h-5 w-5 text-[#14395e]" />
          <span className="text-sm">Reservierung wird geladen…</span>
        </div>
      </CheckoutLayout>
    );
  }

  // Kein Record: die orderId ist unbekannt oder ihr Grabstein ist abgelaufen.
  // Seit ADR-033 ist das kein Rateschluss mehr — ein Ablauf liefert `expired`.
  if (status === null) {
    return (
      <CheckoutLayout
        orderId={orderId}
        status={null}
        chip={{ tone: "slate", label: "Unbekannt" }}
      >
        <Outcome
          tone="red"
          title="Reservierung nicht gefunden"
          body="Zu dieser Bestellnummer gibt es keine Reservierung."
        />
        <BackButton onClick={leaveCheckout} label="Zurück zum Angebot" />
      </CheckoutLayout>
    );
  }

  if (expired) {
    return (
      <CheckoutLayout
        orderId={orderId}
        status={status}
        chip={{ tone: "red", label: "Abgelaufen" }}
      >
        <Outcome
          tone="red"
          title="Reservierung abgelaufen"
          body="Das Checkout-Fenster ist verstrichen und der Platz wurde wieder freigegeben. Du kannst es erneut versuchen, solange noch Tickets verfügbar sind."
        />
        <BackButton onClick={leaveCheckout} label="Zurück zum Angebot" />
      </CheckoutLayout>
    );
  }

  if (status.status === "completed") {
    return (
      <CheckoutLayout
        orderId={orderId}
        status={status}
        chip={{ tone: "green", label: "Bestätigt" }}
      >
        <Outcome
          tone="green"
          title="Ticket gesichert"
          body="Dein General-Admission-Pass ist bestätigt. Wir sehen uns in St. Pölten."
        />
        <BackButton onClick={leaveCheckout} label="Neues Ticket" />
      </CheckoutLayout>
    );
  }

  if (status.status === "failed") {
    return (
      <CheckoutLayout
        orderId={orderId}
        status={status}
        chip={{ tone: "red", label: "Fehlgeschlagen" }}
      >
        <Outcome
          tone="red"
          title="Kauf fehlgeschlagen"
          body={status.failureReason}
        />
        <BackButton onClick={leaveCheckout} label="Zurück zum Angebot" />
      </CheckoutLayout>
    );
  }

  if (paid) {
    return (
      <CheckoutLayout
        orderId={orderId}
        status={status}
        chip={{ tone: "amber", label: "Wird verarbeitet" }}
      >
        <div className="flex items-start gap-4">
          <Spinner className="mt-0.5 h-9 w-9 shrink-0 text-[#14395e]" />
          <div>
            <h3 className="text-lg font-bold text-[#14395e]">
              Zahlung bestätigt
            </h3>
            <p className="mt-0.5 text-sm text-slate-500">
              Deine Bestellung ist in der Warteschlange und wird gerade
              finalisiert.
            </p>
          </div>
        </div>
        {error !== null && (
          <p className="mt-3 text-xs text-amber-600">
            Verbindung instabil — erneuter Versuch…
          </p>
        )}
      </CheckoutLayout>
    );
  }

  // Ab hier ist `status` ein `pending`; `paid` ist noch nicht gesetzt.
  return (
    <CheckoutLayout
      orderId={orderId}
      status={status}
      chip={{ tone: elapsed ? "red" : "amber", label: "Reserviert" }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-[#14395e]">
            Dein Platz ist reserviert
          </h3>
          <p className="mt-0.5 text-sm text-slate-500">
            Schließe die Zahlung ab, bevor die Zeit abläuft — danach geht der
            Platz zurück in den Verkauf.
          </p>
        </div>
        <CountdownBadge remainingMs={remainingMs} elapsed={elapsed} />
      </div>

      <div className="mt-5 border-t border-slate-100 pt-5">
        <h4 className="mb-4 text-base font-bold text-slate-900">Bezahlung</h4>
        <PaymentForm
          apiUrl={env.apiUrl}
          orderId={orderId}
          cardHolder={`${status.firstName} ${status.lastName}`}
          onPaid={() => setPaid(true)}
          onCancel={handleCancel}
          onExpired={() => setRejectedAsExpired(true)}
        />
      </div>
    </CheckoutLayout>
  );
}

function CountdownBadge({
  remainingMs,
  elapsed,
}: {
  remainingMs: number;
  elapsed: boolean;
}) {
  // Unter 30 Sekunden optisch warnen.
  const urgent = remainingMs <= 30_000;
  const tone = elapsed || urgent ? "text-red-600" : "text-[#14395e]";

  return (
    <div className="shrink-0 text-left sm:text-right">
      <div className="text-xs text-slate-500">Verbleibende Zeit</div>
      <div
        className={`font-mono text-3xl font-bold tabular-nums ${tone}`}
        role="timer"
        aria-live="off"
      >
        {formatRemaining(remainingMs)}
      </div>
    </div>
  );
}

function BackButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button onClick={onClick} className={`${secondaryBtn} mt-5`}>
      ← {label}
    </button>
  );
}

function Outcome({
  tone,
  title,
  body,
}: {
  tone: "green" | "red";
  title: string;
  body: string;
}) {
  const ring =
    tone === "green"
      ? "bg-emerald-50 text-emerald-600 ring-emerald-600/20"
      : "bg-red-50 text-red-600 ring-red-600/20";

  return (
    <div className="flex items-start gap-4">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ${ring}`}
      >
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none">
          {tone === "green" ? (
            <path
              d="m5 13 4 4 10-10"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          )}
        </svg>
      </div>
      <div>
        <h3 className="text-lg font-bold text-[#14395e]">{title}</h3>
        <p className="mt-0.5 text-sm text-slate-500">{body}</p>
      </div>
    </div>
  );
}

/**
 * Zweispaltiges Checkout-Layout: links der Ablauf (Countdown, Formular oder
 * Endzustand), rechts die Zusammenfassung mit den unveraenderlichen Daten der
 * Bestellung. Auf schmalen Viewports stapelt es sich, die Zusammenfassung
 * kommt unter den Ablauf.
 */
function CheckoutLayout({
  orderId,
  status,
  chip,
  children,
}: {
  orderId: string;
  status: OrderStatusResponse | null;
  chip: { tone: ChipTone; label: string };
  children: React.ReactNode;
}) {
  return (
    <PageChrome>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section className={panel}>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
            <h2 className="text-xl font-bold text-[#1a4e80]">Checkout</h2>
            <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
          </div>
          <div className="px-5 py-5 sm:px-6">{children}</div>
        </section>

        <OrderSummary orderId={orderId} status={status} />
      </div>
    </PageChrome>
  );
}

function OrderSummary({
  orderId,
  status,
}: {
  orderId: string;
  status: OrderStatusResponse | null;
}) {
  const pending = status?.status === "pending" ? status : null;
  const ticketId = status?.status === "completed" ? status.ticketId : null;
  const expiresAt =
    status?.status === "pending" || status?.status === "expired"
      ? status.expiresAt
      : null;

  return (
    <aside className={`${panel} lg:sticky lg:top-4`}>
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-bold text-[#1a4e80]">Deine Bestellung</h2>
      </div>

      <div className="px-5 py-5">
        <OfferHeadline compact />

        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-sm">
          <div>
            <div className="font-medium text-slate-900">
              1 × {OFFER.ticketType}
            </div>
            <div className="text-xs text-slate-500">
              Personalisiert · nicht übertragbar
            </div>
          </div>
          <div className="font-semibold tabular-nums text-slate-900">
            {OFFER.price}
          </div>
        </div>

        <dl className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4">
          {pending !== null && (
            <SummaryRow label="Ticketinhaber">
              <span className="font-medium text-slate-900">
                {pending.firstName} {pending.lastName}
              </span>
            </SummaryRow>
          )}
          <SummaryRow label="Bestellnummer">
            <span className="font-mono text-xs break-all text-slate-700 select-all">
              {orderId}
            </span>
          </SummaryRow>
          {expiresAt !== null && (
            <SummaryRow
              label={
                status?.status === "expired"
                  ? "Abgelaufen um"
                  : "Reserviert bis"
              }
            >
              <span className="tabular-nums text-slate-700">
                {formatClock(expiresAt)}
              </span>
            </SummaryRow>
          )}
          {ticketId !== null && (
            <SummaryRow label="Ticket-Referenz">
              <span className="font-mono text-xs break-all text-slate-700 select-all">
                {ticketId ?? "—"}
              </span>
            </SummaryRow>
          )}
        </dl>

        <div className="mt-4 flex items-baseline justify-between border-t border-slate-200 pt-4">
          <span className="text-sm font-semibold text-slate-900">Gesamt</span>
          <span className="text-xl font-bold tabular-nums text-[#14395e]">
            {OFFER.price}
          </span>
        </div>
        <p className="mt-1 text-right text-xs text-slate-400">
          inkl. USt., keine Gebühren
        </p>
      </div>
    </aside>
  );
}

function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** Uhrzeit (hh:mm:ss) einer Epoch-ms-Deadline in lokaler Zeit. */
function formatClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString("de-AT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
