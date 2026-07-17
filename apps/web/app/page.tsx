"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PaymentModal } from "../components/PaymentModal";
import { SiteHeader } from "../components/SiteHeader";
import { Spinner } from "../components/Spinner";
import { StatusChip, type ChipTone } from "../components/StatusChip";
import { Toast } from "../components/Toast";
import { useOrderStatus } from "../hooks/useOrderStatus";
import { useTicketAvailability } from "../hooks/useTicketAvailability";
import { buyTicket, cancelOrder } from "../lib/api";
import { env } from "../lib/env";
import { randomName } from "../lib/names";

type Phase = "loading" | "upcoming" | "open" | "soldout" | "tracking";

const PRICE = "€ 199,00";
const VENUE = "Green Park St. Pölten";
const DATES = { from: "20.08.2026", to: "22.08.2026" };

const panel = "rounded-md bg-white shadow-sm ring-1 ring-slate-200";
const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-md bg-[#f5a623] px-6 py-2.5 font-semibold text-white transition-colors hover:bg-[#e0951c] active:bg-[#cf8916] disabled:cursor-not-allowed disabled:bg-slate-300";
const secondaryBtn =
  "inline-flex items-center justify-center rounded-md border border-slate-300 px-5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50";
const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-[#14395e] focus:ring-2 focus:ring-[#14395e]/20 focus:outline-none";

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

function Stars({ value = 4 }: { value?: number }) {
  const stars = "★★★★★";
  return (
    <span aria-label={`${value} von 5 Sternen`}>
      <span className="text-[#f5a623]">{stars.slice(0, value)}</span>
      <span className="text-white/30">{stars.slice(value)}</span>
    </span>
  );
}

function Breadcrumb() {
  return (
    <div className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-5xl px-4 py-2 text-sm text-slate-500">
        <span className="text-[#1a4e80]">Start</span>
        <span className="mx-1.5 text-slate-300">›</span>
        <span className="text-[#1a4e80]">Festivals</span>
        <span className="mx-1.5 text-slate-300">›</span>
        <span className="text-slate-700">Frequency Festival 20XX</span>
      </div>
    </div>
  );
}

function HeroBanner() {
  return (
    <div className={`${panel} overflow-hidden`}>
      <div className="flex items-center gap-5 bg-gradient-to-r from-[#2b0a4a] via-[#6d1f8c] to-[#f5a623] px-5 py-7 sm:px-8">
        <div className="hidden h-20 w-20 shrink-0 items-center justify-center rounded-md bg-black/30 ring-1 ring-white/25 sm:flex">
          <span className="text-4xl font-black text-[#f5a623]">F</span>
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Frequency Festival 20XX
          </h1>
          <div className="mt-2 flex items-center gap-2 text-sm text-white/90">
            <Stars value={4} />
            <span>4,1 Sterne · St. Pölten, Österreich</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Gemeinsames Marktplatz-Chrome: Navy-Header, Breadcrumb, Hero + Inhalt. */
function PageChrome({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#ebedf0]">
      <SiteHeader />
      <Breadcrumb />
      <main className="mx-auto max-w-5xl px-4 py-5">
        <HeroBanner />
        {children}
      </main>
    </div>
  );
}

function SectionPanel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`mt-4 ${panel}`}>
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
        <h2 className="text-xl font-bold text-[#1a4e80]">{title}</h2>
        {action}
      </div>
      <div className="px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}

/** Datum-Spalte im Angebots-Row-Stil (von–bis). */
function DateColumn() {
  return (
    <div className="shrink-0 text-center text-sm sm:w-24">
      <div className="font-semibold text-[#14395e]">{DATES.from}</div>
      <div className="text-xs text-slate-400">bis</div>
      <div className="font-semibold text-[#14395e]">{DATES.to}</div>
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
      <PageChrome>
        <SectionPanel title="Tickets">
          <div className="flex items-center gap-3 py-6 text-slate-500">
            <Spinner className="h-5 w-5 text-[#14395e]" />
            <span className="text-sm">
              {error ?? "Angebote werden geladen…"}
            </span>
          </div>
        </SectionPanel>
      </PageChrome>
    );
  }

  if (phase === "upcoming") {
    return <UpcomingView opensAt={opensAt!} now={now} total={total} />;
  }

  if (phase === "soldout") {
    return <SoldOutView total={total} />;
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

/** Kopfzeile eines Angebots-Rows: Datum + Titel/Ort + Venue. */
function OfferHeadline() {
  return (
    <div className="flex items-start gap-4">
      <DateColumn />
      <div className="min-w-0">
        <div className="text-xs text-slate-500">
          Frequency 20XX · 3-Tages-Festivalpass
        </div>
        <div className="text-2xl font-bold tracking-tight text-[#14395e]">
          ST. PÖLTEN
        </div>
        <div className="text-sm text-slate-500">{VENUE} · 12:00 Uhr</div>
      </div>
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
  const countdown =
    days > 0
      ? `${days}d ${hours}h ${minutes}m`
      : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  return (
    <PageChrome>
      <SectionPanel
        title="Tickets"
        action={<StatusChip tone="blue">Demnächst</StatusChip>}
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <OfferHeadline />
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <div className="text-sm text-slate-500">
              Verkaufsstart: {opensDate} Uhr
            </div>
            <div className="font-mono text-lg font-bold tabular-nums text-[#14395e]">
              {countdown}
            </div>
            <button disabled className={primaryBtn}>
              Kaufen
            </button>
          </div>
        </div>
        <p className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-400">
          {formatCount(total)} General-Admission-Pässe · Verkauf noch nicht
          gestartet
        </p>
      </SectionPanel>
    </PageChrome>
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
  // Autofill mit einem zufaelligen (fiktiven) Namen — die Felder bleiben
  // editierbar.
  const initialName = useState(randomName)[0];
  const [firstName, setFirstName] = useState(initialName.firstName);
  const [lastName, setLastName] = useState(initialName.lastName);
  const [reserving, setReserving] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  // Gesetzt, sobald `POST /buy` reserviert hat → Payment-Modal ist offen.
  const [checkoutOrderId, setCheckoutOrderId] = useState<string | null>(null);

  const pct =
    total && total > 0 && available !== null
      ? Math.max(0, Math.min(100, (available / total) * 100))
      : null;

  async function handleBuy(e: React.FormEvent) {
    e.preventDefault();
    setReserving(true);
    const result = await buyTicket(env.apiUrl, env.eventId, {
      firstName,
      lastName,
    });
    setReserving(false);
    if (result.ok && result.data.orderId) {
      setCheckoutOrderId(result.data.orderId);
    } else if (result.ok) {
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
    resetCheckout();
    onPaid(orderId);
  }

  // Modal-Abbruch/Timeout: Reservierung freigeben (idempotent, fire-and-forget
  // — ADR-028). UI resettet sofort, das Release laeuft im Hintergrund.
  function handleCancelCheckout() {
    const orderId = checkoutOrderId;
    resetCheckout();
    if (orderId) void cancelOrder(env.apiUrl, orderId);
  }

  return (
    <PageChrome>
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

      <SectionPanel
        title="Tickets"
        action={
          <StatusChip tone="green" pulse>
            Verkauf läuft
          </StatusChip>
        }
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <OfferHeadline />
          <div className="shrink-0 text-left sm:text-right">
            <div className="text-xs text-slate-500">Preis pro Pass</div>
            <div className="text-2xl font-bold text-[#14395e]">{PRICE}</div>
          </div>
        </div>

        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Verfügbarkeit</span>
            <span className="tabular-nums">
              {loading ? "—" : formatCount(available)} von {formatCount(total)}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
              style={{ width: pct === null ? "0%" : `${pct}%` }}
            />
          </div>
        </div>

        <form
          onSubmit={(e) => void handleBuy(e)}
          className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-end"
        >
          <div className="flex flex-1 flex-col gap-1">
            <label
              htmlFor="firstName"
              className="text-xs font-medium text-slate-500"
            >
              Vorname
            </label>
            <input
              id="firstName"
              type="text"
              placeholder="Vorname"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              className={inputClass}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label
              htmlFor="lastName"
              className="text-xs font-medium text-slate-500"
            >
              Nachname
            </label>
            <input
              id="lastName"
              type="text"
              placeholder="Nachname"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              className={inputClass}
            />
          </div>
          <button
            type="submit"
            disabled={reserving}
            className={`${primaryBtn} sm:w-40`}
          >
            {reserving ? (
              <>
                <Spinner className="h-5 w-5" />
                Reserviere…
              </>
            ) : (
              "Kaufen"
            )}
          </button>
        </form>
      </SectionPanel>
    </PageChrome>
  );
}

function SoldOutView({ total }: { total: number | null }) {
  return (
    <PageChrome>
      <SectionPanel
        title="Tickets"
        action={<StatusChip tone="red">Ausverkauft</StatusChip>}
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <OfferHeadline />
          <button disabled className={primaryBtn}>
            Ausverkauft
          </button>
        </div>
        <p className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-400">
          Alle {formatCount(total)} General-Admission-Pässe wurden vergeben.
        </p>
      </SectionPanel>
    </PageChrome>
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

  const chipTone: ChipTone =
    state === "completed" ? "green" : state === "failed" ? "red" : "amber";
  const chipLabel =
    state === "completed"
      ? "Bestätigt"
      : state === "failed"
        ? "Fehlgeschlagen"
        : "Wird verarbeitet";

  return (
    <PageChrome>
      <SectionPanel
        title="Deine Bestellung"
        action={
          <StatusChip tone={chipTone} pulse={state === "pending"}>
            {chipLabel}
          </StatusChip>
        }
      >
        {state === "completed" ? (
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-600/20">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none">
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
              <h3 className="text-lg font-bold text-[#14395e]">
                Ticket gesichert
              </h3>
              <p className="mt-0.5 text-sm text-slate-500">
                Dein General-Admission-Pass ist bestätigt. Wir sehen uns in St.
                Pölten.
              </p>
            </div>
          </div>
        ) : state === "failed" ? (
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-600/20">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-bold text-[#14395e]">
                Kauf fehlgeschlagen
              </h3>
              <p className="mt-0.5 text-sm text-slate-500">
                {status?.status === "failed"
                  ? status.failureReason
                  : "Die Bestellung konnte nicht abgeschlossen werden."}
              </p>
            </div>
          </div>
        ) : (
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
        )}

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
              {status?.status === "completed" && status.ticketId
                ? status.ticketId
                : "—"}
            </dd>
          </div>
        </dl>

        {error && state === "pending" && (
          <p className="mt-3 text-xs text-amber-600">
            Verbindung instabil — erneuter Versuch…
          </p>
        )}

        <button onClick={onReset} className={`${secondaryBtn} mt-5`}>
          ← Neues Ticket
        </button>
      </SectionPanel>
    </PageChrome>
  );
}
