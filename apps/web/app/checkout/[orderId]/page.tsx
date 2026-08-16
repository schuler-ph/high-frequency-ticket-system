"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import {
  PageChrome,
  SectionPanel,
  secondaryBtn,
} from "../../../components/PageChrome";
import { PaymentModal } from "../../../components/PaymentModal";
import { Spinner } from "../../../components/Spinner";
import { StatusChip, type ChipTone } from "../../../components/StatusChip";
import {
  formatRemaining,
  useCheckoutDeadline,
} from "../../../hooks/useCheckoutDeadline";
import { useOrderStatus } from "../../../hooks/useOrderStatus";
import { cancelOrder } from "../../../lib/api";
import { env } from "../../../lib/env";

/**
 * Checkout einer konkreten Reservierung.
 *
 * Die `orderId` steht in der URL und nicht im React-State: die Seite ist damit
 * reload-fest und teilbar, und Restzeit wie Status kommen bei jedem Aufruf
 * frisch aus `GET /api/orders/:orderId` (Redis-Read-Model). Ein `orderId` ist
 * eine nicht ratbare UUID, die URL enthaelt nichts Schuetzenswertes.
 */
export default function CheckoutPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = params.orderId;
  const router = useRouter();
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
    router.push("/");
  }

  // Modal-Abbruch: Reservierung freigeben (idempotent, fire-and-forget —
  // ADR-028) und zurueck zur Angebotsseite.
  function handleCancel() {
    void cancelOrder(env.apiUrl, orderId);
    leaveCheckout();
  }

  if (!loaded) {
    return (
      <CheckoutFrame chip={{ tone: "blue", label: "Wird geladen" }}>
        <div className="flex items-center gap-3 py-6 text-slate-500">
          <Spinner className="h-5 w-5 text-[#14395e]" />
          <span className="text-sm">Reservierung wird geladen…</span>
        </div>
      </CheckoutFrame>
    );
  }

  if (expired) {
    return (
      <CheckoutFrame
        orderId={orderId}
        chip={{ tone: "red", label: "Abgelaufen" }}
      >
        <Outcome
          tone="red"
          title="Reservierung abgelaufen"
          body="Das Checkout-Fenster ist verstrichen und der Platz wurde wieder freigegeben. Du kannst es erneut versuchen, solange noch Tickets verfügbar sind."
        />
        <button onClick={leaveCheckout} className={`${secondaryBtn} mt-5`}>
          ← Zurück zum Angebot
        </button>
      </CheckoutFrame>
    );
  }

  if (status?.status === "completed") {
    return (
      <CheckoutFrame
        orderId={orderId}
        chip={{ tone: "green", label: "Bestätigt" }}
        ticketId={status.ticketId}
      >
        <Outcome
          tone="green"
          title="Ticket gesichert"
          body="Dein General-Admission-Pass ist bestätigt. Wir sehen uns in St. Pölten."
        />
        <button onClick={leaveCheckout} className={`${secondaryBtn} mt-5`}>
          ← Neues Ticket
        </button>
      </CheckoutFrame>
    );
  }

  if (status?.status === "failed") {
    return (
      <CheckoutFrame
        orderId={orderId}
        chip={{ tone: "red", label: "Fehlgeschlagen" }}
      >
        <Outcome
          tone="red"
          title="Kauf fehlgeschlagen"
          body={status.failureReason}
        />
        <button onClick={leaveCheckout} className={`${secondaryBtn} mt-5`}>
          ← Zurück zum Angebot
        </button>
      </CheckoutFrame>
    );
  }

  // Kein Record: die orderId ist unbekannt oder ihr Grabstein ist abgelaufen.
  // Seit ADR-033 ist das kein Rateschluss mehr — ein Ablauf liefert `expired`.
  if (status === null) {
    return (
      <CheckoutFrame chip={{ tone: "slate", label: "Unbekannt" }}>
        <Outcome
          tone="red"
          title="Reservierung nicht gefunden"
          body="Zu dieser Bestellnummer gibt es keine Reservierung."
        />
        <button onClick={leaveCheckout} className={`${secondaryBtn} mt-5`}>
          ← Zurück zum Angebot
        </button>
      </CheckoutFrame>
    );
  }

  if (paid) {
    return (
      <CheckoutFrame
        orderId={orderId}
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
      </CheckoutFrame>
    );
  }

  return (
    <CheckoutFrame
      orderId={orderId}
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

      <PaymentModal
        apiUrl={env.apiUrl}
        orderId={orderId}
        cardHolder=""
        onPaid={() => setPaid(true)}
        onClose={handleCancel}
        onExpired={() => setRejectedAsExpired(true)}
      />
    </CheckoutFrame>
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

function CheckoutFrame({
  orderId,
  chip,
  ticketId,
  children,
}: {
  orderId?: string;
  chip: { tone: ChipTone; label: string };
  ticketId?: string | null;
  children: React.ReactNode;
}) {
  return (
    <PageChrome>
      <SectionPanel
        title="Deine Bestellung"
        action={<StatusChip tone={chip.tone}>{chip.label}</StatusChip>}
      >
        {children}

        {orderId !== undefined && (
          <dl className="mt-5 divide-y divide-slate-100 border-t border-slate-100">
            <div className="flex items-center justify-between py-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Bestellnummer
              </dt>
              <dd className="font-mono text-sm text-slate-700">
                {orderId.slice(0, 8)}…
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Ticket-Referenz
              </dt>
              <dd className="truncate font-mono text-sm text-slate-700">
                {ticketId ?? "—"}
              </dd>
            </div>
          </dl>
        )}
      </SectionPanel>
    </PageChrome>
  );
}
