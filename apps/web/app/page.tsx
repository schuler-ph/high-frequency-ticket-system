"use client";

import { useEffect, useState } from "react";
import { Toast } from "../components/Toast";
import { useTicketAvailability } from "../hooks/useTicketAvailability";
import { buyTicket } from "../lib/api";
import { env } from "../lib/env";

type Phase = "loading" | "upcoming" | "open" | "soldout";

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

const shell =
  "min-h-screen bg-zinc-950 text-white overflow-hidden relative flex flex-col items-center justify-center";
const content =
  "relative z-10 w-full max-w-5xl mx-auto px-10 md:px-16 py-20 flex flex-col items-start gap-10";

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
      <main className={shell}>
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#FFE600]" />
        <span className="font-mono text-xs uppercase tracking-[0.3em] text-zinc-600">
          {error ?? "Laden…"}
        </span>
      </main>
    );
  }

  if (phase === "upcoming") {
    return <UpcomingView opensAt={opensAt!} now={now} total={total} />;
  }

  if (phase === "soldout") {
    return <SoldOutView total={total} />;
  }

  return <ActiveSaleView available={available} loading={loading} />;
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="w-20 h-20 md:w-24 md:h-24 border border-zinc-700 flex items-center justify-center">
        <span className="font-mono font-black text-3xl md:text-4xl text-[#FFE600]">
          {String(value).padStart(2, "0")}
        </span>
      </div>
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">
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
    dateStyle: "short",
    timeStyle: "short",
  });

  return (
    <main className={shell}>
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#FFE600]" />

      <div className={content}>
        <div className="flex items-center gap-3">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
          <span className="font-mono text-xs uppercase tracking-[0.3em] text-zinc-500">
            St. Pölten, Österreich — 01. Juni 2026
          </span>
        </div>

        <h1
          className="font-black uppercase leading-none tracking-tighter"
          style={{ fontSize: "clamp(3rem, 11vw, 10rem)" }}
        >
          <span className="block text-white">Frequency</span>
          <span className="block text-[#FFE600]">Festival</span>
        </h1>

        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
            Gesamtanzahl
          </span>
          <span className="font-mono font-black text-4xl text-white tabular-nums">
            {formatCount(total)}
          </span>
        </div>

        <div className="flex gap-3 md:gap-4 items-end">
          <CountdownUnit value={days} label="Tage" />
          <CountdownUnit value={hours} label="Std" />
          <CountdownUnit value={minutes} label="Min" />
          <CountdownUnit value={seconds} label="Sek" />
        </div>

        <button
          disabled
          className="px-10 py-4 bg-zinc-900 text-zinc-700 font-black uppercase tracking-wide text-lg cursor-not-allowed border border-zinc-800"
        >
          Ticket kaufen
        </button>
      </div>

      <div className="absolute bottom-0 left-0 right-0 border-t border-zinc-800 px-8 py-4 flex justify-between items-center">
        <span className="font-mono text-xs text-zinc-700 uppercase tracking-widest">
          Frequency Festival 20XX
        </span>
        <span className="font-mono text-xs text-zinc-600 uppercase tracking-widest">
          Verkauf öffnet am {opensDate} Uhr
        </span>
      </div>
    </main>
  );
}

type FormState = "idle" | "form" | "loading";

interface ToastState {
  type: "success" | "error";
  message: string;
}

function ActiveSaleView({
  available,
  loading,
}: {
  available: number | null;
  loading: boolean;
}) {
  const [formState, setFormState] = useState<FormState>("idle");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);

  async function handleBuy(e: React.FormEvent) {
    e.preventDefault();
    setFormState("loading");
    const result = await buyTicket(env.apiUrl, env.eventId, {
      firstName,
      lastName,
    });
    if (result.ok) {
      const orderId = result.data.orderId;
      setToast({
        type: "success",
        message: orderId
          ? `In Warteschlange — Order ${orderId.slice(0, 8)}…`
          : "In Warteschlange",
      });
      setFormState("idle");
      setFirstName("");
      setLastName("");
    } else {
      setToast({ type: "error", message: result.message });
      setFormState("idle");
    }
  }

  const displayCount = loading ? "—" : formatCount(available);

  return (
    <main className={shell}>
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}

      <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#FFE600]" />

      <div className={content}>
        <div className="flex items-center gap-3">
          <span className="w-1.5 h-1.5 rounded-full bg-[#FFE600] animate-pulse" />
          <span className="font-mono text-xs uppercase tracking-[0.3em] text-zinc-400">
            St. Pölten, Österreich — August 20XX
          </span>
        </div>

        <h1
          className="font-black uppercase leading-none tracking-tighter"
          style={{ fontSize: "clamp(3rem, 11vw, 10rem)" }}
        >
          <span className="block text-white">Frequency</span>
          <span className="block text-[#FFE600]">Festival</span>
        </h1>

        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
            Noch verfügbar
          </span>
          <span className="font-mono font-black text-4xl text-white tabular-nums">
            {displayCount}
          </span>
        </div>

        {formState === "form" ? (
          <form
            onSubmit={(e) => void handleBuy(e)}
            className="flex flex-col gap-3 w-full max-w-md"
          >
            <input
              type="text"
              placeholder="Vorname"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              className="px-4 py-3 bg-zinc-900 border border-zinc-700 text-white font-mono placeholder:text-zinc-600 focus:outline-none focus:border-[#FFE600]"
            />
            <input
              type="text"
              placeholder="Nachname"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              className="px-4 py-3 bg-zinc-900 border border-zinc-700 text-white font-mono placeholder:text-zinc-600 focus:outline-none focus:border-[#FFE600]"
            />
            <div className="flex gap-3">
              <button
                type="submit"
                className="flex-1 px-8 py-5 bg-[#FFE600] text-zinc-950 font-black uppercase tracking-wide text-xl hover:bg-yellow-300 active:translate-y-px transition-all duration-100"
              >
                Jetzt kaufen →
              </button>
              <button
                type="button"
                onClick={() => setFormState("idle")}
                className="px-5 py-5 border border-zinc-700 text-zinc-400 font-mono text-sm uppercase tracking-wide hover:border-zinc-500 transition-colors"
              >
                Abbrechen
              </button>
            </div>
          </form>
        ) : formState === "loading" ? (
          <button
            disabled
            className="flex items-center justify-between gap-10 px-8 py-5 bg-zinc-700 text-zinc-400 font-black uppercase tracking-wide text-xl min-w-72 cursor-not-allowed"
          >
            Einen Moment…
            <span className="text-2xl animate-spin">⟳</span>
          </button>
        ) : (
          <button
            onClick={() => setFormState("form")}
            className="group flex items-center justify-between gap-10 px-8 py-5 bg-[#FFE600] text-zinc-950 font-black uppercase tracking-wide text-xl hover:bg-yellow-300 active:translate-y-px transition-all duration-100 min-w-72"
          >
            Ticket kaufen
            <span className="text-2xl group-hover:translate-x-1 transition-transform duration-100">
              →
            </span>
          </button>
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 border-t border-zinc-800 px-8 py-4 flex justify-between items-center">
        <span className="font-mono text-xs text-zinc-700 uppercase tracking-widest">
          Frequency Festival 20XX
        </span>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#FFE600] animate-ping" />
          <span className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
            Verkauf läuft
          </span>
        </div>
      </div>
    </main>
  );
}

function SoldOutView({ total }: { total: number | null }) {
  return (
    <main className={shell}>
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-zinc-800" />

      <div className={content}>
        <div className="flex items-center gap-3">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
          <span className="font-mono text-xs uppercase tracking-[0.3em] text-zinc-600">
            St. Pölten, Österreich — August 20XX
          </span>
        </div>

        <h1
          className="font-black uppercase leading-none tracking-tighter"
          style={{ fontSize: "clamp(3rem, 11vw, 10rem)" }}
        >
          <span className="block text-zinc-700">Frequency</span>
          <span className="block text-zinc-600">Festival</span>
        </h1>

        <div className="flex flex-col gap-1">
          <span className="font-black uppercase text-2xl md:text-3xl text-red-500 tracking-tight">
            Ausverkauft
          </span>
          <span className="font-mono text-sm text-zinc-600 mt-1">
            Alle {formatCount(total)} General Admission Pässe wurden vergeben.
          </span>
        </div>

        <button
          disabled
          className="flex items-center gap-10 px-8 py-5 bg-zinc-900 border border-zinc-800 text-zinc-700 font-black uppercase tracking-wide text-xl cursor-not-allowed line-through decoration-zinc-700 min-w-72"
        >
          Ticket kaufen
        </button>
      </div>

      <div className="absolute bottom-0 left-0 right-0 border-t border-zinc-800 px-8 py-4 flex justify-between items-center">
        <span className="font-mono text-xs text-zinc-700 uppercase tracking-widest">
          Frequency Festival 20XX
        </span>
        <span className="font-mono text-xs text-zinc-700 uppercase tracking-widest">
          Ausverkauft
        </span>
      </div>
    </main>
  );
}
