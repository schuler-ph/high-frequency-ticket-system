import { OFFER } from "../lib/offer";

/** Datum-Spalte im Angebots-Row-Stil (von–bis). */
export function DateColumn() {
  return (
    <div className="shrink-0 text-center text-sm sm:w-24">
      <div className="font-semibold text-[#14395e]">{OFFER.dates.from}</div>
      <div className="text-xs text-slate-400">bis</div>
      <div className="font-semibold text-[#14395e]">{OFFER.dates.to}</div>
    </div>
  );
}

/**
 * Kopfzeile eines Angebots-Rows: Datum + Titel/Ort + Venue. Auf der
 * Angebotsseite in voller Groesse, in der Checkout-Zusammenfassung kompakt.
 */
export function OfferHeadline({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-start gap-4">
      <DateColumn />
      <div className="min-w-0">
        <div className="text-xs text-slate-500">{OFFER.series}</div>
        <div
          className={`font-bold tracking-tight text-[#14395e] ${
            compact ? "text-xl" : "text-2xl"
          }`}
        >
          {OFFER.city}
        </div>
        <div className="text-sm text-slate-500">
          {OFFER.venue} · {OFFER.doors}
        </div>
      </div>
    </div>
  );
}
