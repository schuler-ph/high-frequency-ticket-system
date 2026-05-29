export default function ActiveSalePage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white overflow-hidden relative flex flex-col items-center justify-center">
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#FFE600]" />

      <div className="relative z-10 w-full max-w-5xl mx-auto px-8 flex flex-col items-start gap-7">
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
            843.291
          </span>
        </div>

        <button className="group flex items-center justify-between gap-10 px-8 py-5 bg-[#FFE600] text-zinc-950 font-black uppercase tracking-wide text-xl hover:bg-yellow-300 active:translate-y-px transition-all duration-100 min-w-72">
          Ticket kaufen
          <span className="text-2xl group-hover:translate-x-1 transition-transform duration-100">
            →
          </span>
        </button>
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
