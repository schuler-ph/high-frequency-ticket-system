"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  PageChrome,
  SectionPanel,
  inputClass,
  primaryBtn,
} from "../components/PageChrome";
import { Spinner } from "../components/Spinner";
import { StatusChip } from "../components/StatusChip";
import { Toast } from "../components/Toast";
import { useTicketAvailability } from "../hooks/useTicketAvailability";
import { buyTicket } from "../lib/api";
import { env } from "../lib/env";
import { randomName } from "../lib/names";

type Phase = "loading" | "upcoming" | "open" | "soldout";

const PRICE = "€ 199,00";
const VENUE = "Green Park St. Pölten";
const DATES = { from: "20.08.2026", to: "22.08.2026" };

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

  const phase: Phase = (() => {
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

  return (
    <ActiveSaleView available={available} total={total} loading={loading} />
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
}: {
  available: number | null;
  total: number | null;
  loading: boolean;
}) {
  const router = useRouter();
  // Autofill mit einem zufaelligen (fiktiven) Namen — die Felder bleiben
  // editierbar.
  const initialName = useState(randomName)[0];
  const [firstName, setFirstName] = useState(initialName.firstName);
  const [lastName, setLastName] = useState(initialName.lastName);
  const [reserving, setReserving] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

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
    if (result.ok && result.data.orderId) {
      // Der Checkout lebt ab hier unter seiner eigenen URL: reload-fest,
      // teilbar, und Restzeit wie Status kommen dort frisch aus Redis.
      // `reserving` bleibt absichtlich gesetzt, damit der Button waehrend der
      // Navigation nicht kurz wieder klickbar wird.
      router.push(`/checkout/${result.data.orderId}`);
      return;
    }
    setReserving(false);
    if (result.ok) {
      setToast({ type: "error", message: "Keine Reservierung erhalten" });
    } else {
      setToast({ type: "error", message: result.message });
    }
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
