"use client";

import { useEffect, useState } from "react";

const SALE_DATE = new Date("2026-06-01T10:00:00");

function useCountdown() {
  const [diff, setDiff] = useState(SALE_DATE.getTime() - Date.now());

  useEffect(() => {
    const id = setInterval(
      () => setDiff(SALE_DATE.getTime() - Date.now()),
      1000,
    );
    return () => clearInterval(id);
  }, []);

  const ms = Math.max(0, diff);
  return {
    days: Math.floor(ms / 86400000),
    hours: Math.floor((ms % 86400000) / 3600000),
    minutes: Math.floor((ms % 3600000) / 60000),
    seconds: Math.floor((ms % 60000) / 1000),
  };
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

export default function CountdownPage() {
  const { days, hours, minutes, seconds } = useCountdown();

  return (
    <main className="min-h-screen bg-zinc-950 text-white overflow-hidden relative flex flex-col items-center justify-center">
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#FFE600]" />

      <div className="relative z-10 w-full max-w-5xl mx-auto px-8 flex flex-col items-start gap-7">
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
            1.000.000
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
          Verkauf öffnet am 01.06.2026 · 10:00 Uhr
        </span>
      </div>
    </main>
  );
}
