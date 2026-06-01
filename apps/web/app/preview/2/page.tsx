"use client";

import { useState } from "react";
import { Toast } from "../../../components/Toast";
import { useTicketAvailability } from "../../../hooks/useTicketAvailability";
import { buyTicket } from "../../../lib/api";
import { env } from "../../../lib/env";

type FormState = "idle" | "form" | "loading";

interface ToastState {
  type: "success" | "error";
  message: string;
}

export default function ActiveSalePage() {
  const { available, loading: availLoading } = useTicketAvailability();
  const [formState, setFormState] = useState<FormState>("idle");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);

  const isSoldOut = !availLoading && available !== null && available <= 0;

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

  const displayCount = availLoading
    ? "—"
    : (available?.toLocaleString("de-AT") ?? "—");

  return (
    <main className="min-h-screen bg-zinc-950 text-white overflow-hidden relative flex flex-col items-center justify-center">
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}

      <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#FFE600]" />

      <div className="relative z-10 w-full max-w-5xl mx-auto px-10 md:px-16 py-20 flex flex-col items-start gap-10">
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
        ) : isSoldOut ? (
          <button
            disabled
            className="flex items-center justify-between gap-10 px-8 py-5 bg-zinc-800 text-zinc-600 font-black uppercase tracking-wide text-xl min-w-72 cursor-not-allowed line-through"
          >
            Ausverkauft
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
