export default function SoldOutPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white overflow-hidden relative flex flex-col items-center justify-center">
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-zinc-800" />

      <div className="relative z-10 w-full max-w-5xl mx-auto px-8 flex flex-col items-start gap-7">
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
            Alle 1.000.000 General Admission Pässe wurden vergeben.
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
