/**
 * Navy Marktplatz-Header im Stil einer Ticketboerse (fanSALE/eventim-Anmutung),
 * aber mit eigener Wortmarke — kein Klon fremder Logos. Suche und Nav-Buttons
 * sind bewusst rein dekorativ (dieser Demo-Shop verkauft nur den einen Pass).
 */
export function SiteHeader() {
  return (
    <header className="bg-[#14395e]">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:gap-5">
        <div className="flex shrink-0 items-baseline gap-2">
          <span className="text-2xl font-black tracking-tight">
            <span className="text-[#f5a623]">freq</span>
            <span className="text-white">PASS</span>
          </span>
          <span className="hidden text-[11px] leading-tight text-slate-300 md:block">
            Tickets von Fan zu Fan
          </span>
        </div>

        <div className="relative hidden flex-1 sm:block">
          <input
            type="text"
            placeholder="Event, Künstler, Ort angeben"
            aria-label="Suche"
            className="w-full rounded-md border border-white/10 bg-white px-4 py-2 pr-10 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none"
          />
          <svg
            className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="11"
              cy="11"
              r="7"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="m20 20-3-3"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <nav className="ml-auto flex items-center gap-2 sm:ml-0">
          <span className="rounded-md border border-white/25 px-3 py-1.5 text-sm font-medium text-white">
            Verkaufen
          </span>
          <span className="rounded-md border border-white/25 px-3 py-1.5 text-sm font-medium text-white">
            Login
          </span>
        </nav>
      </div>
    </header>
  );
}
