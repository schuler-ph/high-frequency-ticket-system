import type { ReactNode } from "react";
import { SiteHeader } from "./SiteHeader";

/**
 * Gemeinsames Marktplatz-Chrome und die wiederkehrenden Utility-Klassen.
 * Liegt hier, seit der Checkout eine eigene Route ist und dieselbe Huelle
 * braucht wie die Startseite — vorher lebten beide nur in `app/page.tsx`.
 * Kein CSS ausserhalb von Tailwind.
 */

export const panel = "rounded-md bg-white shadow-sm ring-1 ring-slate-200";
export const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-md bg-[#f5a623] px-6 py-2.5 font-semibold text-white transition-colors hover:bg-[#e0951c] active:bg-[#cf8916] disabled:cursor-not-allowed disabled:bg-slate-300";
export const secondaryBtn =
  "inline-flex items-center justify-center rounded-md border border-slate-300 px-5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50";
export const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-[#14395e] focus:ring-2 focus:ring-[#14395e]/20 focus:outline-none";

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

export function PageChrome({ children }: { children: ReactNode }) {
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

export function SectionPanel({
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
