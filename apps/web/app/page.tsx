"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PaymentModal } from "../components/PaymentModal";
import { Spinner } from "../components/Spinner";
import { StatusChip } from "../components/StatusChip";
import { Toast } from "../components/Toast";
import { useOrderStatus } from "../hooks/useOrderStatus";
import { useTicketAvailability } from "../hooks/useTicketAvailability";
import { buyTicket, cancelOrder } from "../lib/api";
import { env } from "../lib/env";
import { randomName } from "../lib/names";

type Phase = "loading" | "upcoming" | "open" | "soldout" | "tracking";

const PRICE = "€ 199,00";

const pageShell =
  "min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6";
const card =
  "w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-xl shadow-slate-200/60 ring-1 ring-slate-200";
const primaryBtn =
  "flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-blue-700 active:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryBtn =
  "rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50";
const inputClass =
  "w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 focus:outline-none";

interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function splitDuration(ms: number): CountdownParts {
  const clamped = Math.max(0, ms);
  return {
    days: Math.floor(clamped / 86400000),
    hours: Math.floor((clamped % 86400000) / 3600000),
    minutes: Math.floor((clamped % 3600000) / 60000),
    seconds: Math.floor((clamped % 60000) / 1000),
  };
}

/** Tickt jede Sekunde und liefert den aktuellen Unix-Ms-Zeitstempel. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function formatCount(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("de-AT");
}

/** Gemeinsames Dashboard-Chrome: heller Card-Container + Header mit Chip. */
function Dashboard({ chip, children }: { chip: ReactNode; children: ReactNode }) {
  return (
    <main className={pageShell}>
      <div className={card}>
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5 sm:px-8">
          <div className="flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">
              Frequency Festival 20XX
            </span>
            <span className="mt-0.5 text-sm text-slate-400">
              St. Pölten, Österreich
            </span>
          </div>
          {chip}
        </header>
        <div className="px-6 py-7 sm:px-8">{children}</div>
      </div>
    </main>
  );
}

function AvailabilityMeter({
  available,
  total,
  loading,
}: {
  available: number | null;
  total: number | null;
  loading: boolean;
}) {
  const pct =
    total && total > 0 && available !== null
      ? Math.max(0, Math.min(100, (available / total) * 100))
      : null;

  return (
    <div className="rounded-xl bg-slate-50 p-5 ring-1 ring-slate-100">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Verfügbare Tickets
        </span>
        <span className="text-xs text-slate-400">von {formatCount(total)}</span>
      </div>
      <div className="mt-1 text-3xl font-bold tabular-nums text-slate-900">
        {loading ? "—" : formatCount(available)}
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-blue-600 transition-[width] duration-500"
          style={{ width: pct === null ? "0%" : `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function TicketPage() {
  const { available, total, opensAt, loading, error } = useTicketAvailability();
  const now = useNow();
  // Gesetzt, sobald eine Zahlung bestaetigt wurde → Single-Page schaltet auf
  // die Order-Tracking-Phase um (unabhaengig von der Verfuegbarkeit).
  const [trackingOrderId, setTrackingOrderId] = useState<string | null>(null);

  const phase: Phase = (() => {
    if (trackingOrderId !== null) return "tracking";
    if (loading) return "loading";
    if (opensAt !== null && now < opensAt) return "upcoming";
    if (available !== null && available <= 0) return "soldout";
    return "open";
  })();

  if (phase === "loading") {
    return (
      <main className={pageShell}>
        <div
          className={`${card} flex flex-col items-center gap-4 px-8 py-16 text-center`}
        >
          <Spinner className="h-8 w-8 text-blue-600" />
          <span className="text-sm text-slate-400">{error ?? "Lädt…"}</span>
        </div>
      </main>
    );
  }

  if (phase === "upcoming") {
    return <UpcomingView opensAt={opensAt!} now={now} total={total} />;
  }

  if (phase === "soldout") {
    return <SoldOutView available={available} total={total} />;
  }

  if (phase === "tracking") {
    return (
      <TrackingView
        orderId={trackingOrderId!}
        onReset={() => setTrackingOrderId(null)}
      />
    );
  }

  return (
    <ActiveSaleView
      available={available}
      total={total}
      loading={loading}
      onPaid={setTrackingOrderId}
    />
  );
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-slate-900 sm:h-20 sm:w-20">
        <span className="font-bold text-2xl tabular-nums text-white sm:text-3xl">
          {String(value).padStart(2, "0")}
        </span>
      </div>
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </span>
    </div>
  );
}

function UpcomingView({
  opensAt,
  now,
  total,
}: {
  opensAt: number;
  now: number;
  total: number | null;
}) {
  const { days, hours, minutes, seconds } = splitDuration(opensAt - now);
  const opensDate = new Date(opensAt).toLocaleString("de-AT", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <Dashboard chip={<StatusChip tone="blue">Demnächst</StatusChip>}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            General Admission Pass
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            3-Tage-Festivalticket · {formatCount(total)} Pässe verfügbar
          </p>
        </div>

        <div className="rounded-xl bg-slate-50 p-5 ring-1 ring-slate-100">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Verkauf startet in
          </span>
          <div className="mt-3 flex gap-3 sm:gap-4">
            <CountdownUnit value={days} label="Tage" />
            <CountdownUnit value={hours} label="Std" />
            <CountdownUnit value={minutes} label="Min" />
            <CountdownUnit value={seconds} label="Sek" />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            Verkaufsstart: {opensDate} Uhr
          </span>
          <button disabled className={primaryBtn}>
            Tickets kaufen
          </button>
        </div>
      </div>
    </Dashboard>
  );
}

interface ToastState {
  type: "success" | "error";
  message: string;
}

function ActiveSaleView({
  available,
  total,
  loading,
  onPaid,
}: {
  available: number | null;
  total: number | null;
  loading: boolean;
  onPaid: (orderId: string) => void;
}) {
  // Autofill mit einem zufaelligen (fiktiven) Namen beim Betreten der
  // `open`-Phase — die Felder bleiben editierbar.
  const initialName = useState(randomName)[0];
  const [firstName, setFirstName] = useState(initialName.firstName);
  const [lastName, setLastName] = useState(initialName.lastName);
  const [reserving, setReserving] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  // Gesetzt, sobald `POST /buy` reserviert hat → Payment-Modal ist offen.
  const [checkoutOrderId, setCheckoutOrderId] = useState<string | null>(null);

  async function handleBuy(e: React.FormEvent) {
    e.preventDefault();
    setReserving(true);
    const result = await buyTicket(env.apiUrl, env.eventId, {
      firstName,
      lastName,
    });
    setReserving(false);
    if (result.ok && result.data.orderId) {
      // Reserviert — Checkout geht im Payment-Modal weiter.
      setCheckoutOrderId(result.data.orderId);
    } else if (result.ok) {
      // Sollte nach dem Reserve/Pay-Split nie ohne orderId zurueckkommen.
      setToast({ type: "error", message: "Keine Reservierung erhalten" });
    } else {
      setToast({ type: "error", message: result.message });
    }
  }

  function resetCheckout() {
    setCheckoutOrderId(null);
    const next = randomName();
    setFirstName(next.firstName);
    setLastName(next.lastName);
  }

  function handlePaid(orderId: string) {
    // Checkout-Modal schliessen, Namen fuer einen etwaigen naechsten Kauf neu
    // wuerfeln und die Seite in die Tracking-Phase heben.
    resetCheckout();
    onPaid(orderId);
  }

  // Modal-Abbruch/Timeout: Reservierung freigeben, damit sie nicht als
  // Phantom-Anspruch im Ledger stehen bleibt (idempotent, fire-and-forget —
  // ADR-028). UI wird sofort zurueckgesetzt, das Release laeuft im Hintergrund.
  function handleCancelCheckout() {
    const orderId = checkoutOrderId;
    resetCheckout();
    if (orderId) void cancelOrder(env.apiUrl, orderId);
  }

  return (
    <>
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}

      {checkoutOrderId && (
        <PaymentModal
          apiUrl={env.apiUrl}
          orderId={checkoutOrderId}
          cardHolder={`${firstName} ${lastName}`.trim()}
          onPaid={handlePaid}
          onClose={handleCancelCheckout}
        />
      )}

      <Dashboard
        chip={
          <StatusChip tone="green" pulse>
            Verkauf läuft
          </StatusChip>
        }
      >
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              General Admission Pass
            </h1>
            <p className="mt-1 text-sm text-slate-500">3-Tage-Festivalticket</p>
          </div>

          <AvailabilityMeter
            available={available}
            total={total}
            loading={loading}
          />

          <div className="flex items-end justify-between">
            <div>
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Preis pro Pass
              </span>
              <span className="text-2xl font-bold text-slate-900">{PRICE}</span>
            </div>
          </div>

          <form onSubmit={(e) => void handleBuy(e)} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                aria-label="Vorname"
                placeholder="Vorname"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                className={inputClass}
              />
              <input
                type="text"
                aria-label="Nachname"
                placeholder="Nachname"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                className={inputClass}
              />
            </div>
            <button type="submit" disabled={reserving} className={primaryBtn}>
              {reserving ? (
                <>
                  <Spinner className="h-5 w-5" />
                  Reserviere…
                </>
              ) : (
                "Tickets kaufen"
              )}
            </button>
          </form>
        </div>
      </Dashboard>
    </>
  );
}

function SoldOutView({
  available,
  total,
}: {
  available: number | null;
  total: number | null;
}) {
  return (
    <Dashboard chip={<StatusChip tone="red">Ausverkauft</StatusChip>}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            General Admission Pass
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Alle {formatCount(total)} Pässe wurden vergeben.
          </p>
        </div>

        <AvailabilityMeter available={available} total={total} loading={false} />

        <button disabled className={primaryBtn}>
          Ausverkauft
        </button>
      </div>
    </Dashboard>
  );
}

function TrackingView({
  orderId,
  onReset,
}: {
  orderId: string;
  onReset: () => void;
}) {
  const { status, error } = useOrderStatus(orderId);
  const state = status?.status ?? "pending";

  const chip =
    state === "completed" ? (
      <StatusChip tone="green">Bestätigt</StatusChip>
    ) : state === "failed" ? (
      <StatusChip tone="red">Fehlgeschlagen</StatusChip>
    ) : (
      <StatusChip tone="amber" pulse>
        Wird verarbeitet
      </StatusChip>
    );

  return (
    <Dashboard chip={chip}>
      <div className="flex flex-col gap-6">
        {state === "completed" ? (
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-600/20">
              <svg
                className="h-6 w-6"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="m5 13 4 4 10-10"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Ticket gesichert
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Dein General-Admission-Pass ist bestätigt. Wir sehen uns in St.
                Pölten.
              </p>
            </div>
          </div>
        ) : state === "failed" ? (
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-600/20">
              <svg
                className="h-6 w-6"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Kauf fehlgeschlagen
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {status?.status === "failed"
                  ? status.failureReason
                  : "Die Bestellung konnte nicht abgeschlossen werden."}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-4">
            <Spinner className="mt-0.5 h-10 w-10 shrink-0 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Zahlung bestätigt
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Deine Bestellung ist in der Warteschlange und wird gerade
                finalisiert.
              </p>
            </div>
          </div>
        )}

        <dl className="divide-y divide-slate-100 rounded-xl bg-slate-50 px-5 ring-1 ring-slate-100">
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
              {status?.status === "completed" && status.ticketId
                ? status.ticketId
                : "—"}
            </dd>
          </div>
        </dl>

        {error && state === "pending" && (
          <span className="text-xs text-amber-600">
            Verbindung instabil — erneuter Versuch…
          </span>
        )}

        <button onClick={onReset} className={`${secondaryBtn} self-start`}>
          ← Neues Ticket
        </button>
      </div>
    </Dashboard>
  );
}
