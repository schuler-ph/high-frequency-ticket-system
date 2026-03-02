import React from "react";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 text-zinc-950 overflow-hidden relative selection:bg-yellow-400 selection:text-zinc-950 font-sans">
      {/* Grid Pattern overlay for texture */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#e4e4e7_1px,transparent_1px),linear-gradient(to_bottom,#e4e4e7_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-30 pointer-events-none"></div>

      <div className="relative z-10 w-full max-w-7xl mx-auto px-6 py-12 flex flex-col justify-center items-center text-center">
        {/* Badge */}
        <div className="mb-8 inline-flex items-center gap-2 px-5 py-2 rounded-full border-2 border-zinc-950 bg-white shadow-[4px_4px_0px_0px_rgba(24,24,27,1)] hover:shadow-[2px_2px_0px_0px_rgba(24,24,27,1)] hover:translate-x-[2px] hover:translate-y-[2px] transition-all cursor-default">
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 border border-zinc-950 animate-pulse"></span>
          <span className="text-sm font-bold uppercase tracking-wide text-zinc-950">
            Live Ticket Sale
          </span>
        </div>

        {/* Hero Title */}
        <h1 className="text-6xl md:text-8xl lg:text-9xl font-black tracking-tighter mb-6 text-zinc-950 uppercase leading-none drop-shadow-sm">
          Frequency
          <br />
          <span className="text-yellow-400 drop-shadow-[4px_4px_0_rgba(24,24,27,1)]">
            Festival 20XX
          </span>
        </h1>

        <p className="text-lg md:text-2xl text-zinc-700 mb-12 max-w-2xl mx-auto font-medium leading-relaxed">
          The ultimate music experience awaits. Secure your General Admission
          passes before they sell out.
        </p>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row gap-6 items-center">
          <button className="group relative px-10 py-5 font-black uppercase text-xl text-zinc-950 bg-yellow-400 border-4 border-zinc-950 shadow-[8px_8px_0px_0px_rgba(24,24,27,1)] hover:shadow-[4px_4px_0px_0px_rgba(24,24,27,1)] hover:translate-x-[4px] hover:translate-y-[4px] transition-all duration-200 active:shadow-none active:translate-x-[8px] active:translate-y-[8px]">
            <span className="relative flex items-center gap-3">
              Buy Tickets
              <svg
                className="w-6 h-6 group-hover:translate-x-1 transition-transform stroke-[3]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
            </span>
          </button>

          <button className="px-8 py-5 font-bold uppercase text-lg text-zinc-950 bg-white border-4 border-zinc-950 shadow-[8px_8px_0px_0px_rgba(24,24,27,1)] hover:bg-zinc-100 hover:shadow-[4px_4px_0px_0px_rgba(24,24,27,1)] hover:translate-x-[4px] hover:translate-y-[4px] transition-all duration-200 active:shadow-none active:translate-x-[8px] active:translate-y-[8px]">
            View Lineup
          </button>
        </div>

        {/* Stats Brutalism Cards */}
        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-5xl">
          {/* Card 1 */}
          <div className="p-8 bg-white border-4 border-zinc-950 shadow-[8px_8px_0px_0px_rgba(24,24,27,1)] flex flex-col items-center justify-center transform hover:-translate-y-1 transition-transform duration-300">
            <span className="text-zinc-500 text-sm font-black uppercase tracking-widest mb-2">
              Available
            </span>
            <span className="text-5xl font-mono font-black text-zinc-950">
              843,291
            </span>
          </div>

          {/* Card 2 */}
          <div className="p-8 bg-yellow-400 border-4 border-zinc-950 shadow-[8px_8px_0px_0px_rgba(24,24,27,1)] flex flex-col items-center justify-center transform hover:-translate-y-1 transition-transform duration-300">
            <span className="text-zinc-900 text-sm font-black uppercase tracking-widest mb-2">
              Queue Status
            </span>
            <span className="text-2xl font-black uppercase text-zinc-950 flex items-center gap-3 mt-2">
              <span className="w-3 h-3 bg-zinc-950 rounded-full inline-block animate-ping"></span>
              Fast Processing
            </span>
          </div>

          {/* Card 3 */}
          <div className="p-8 bg-white border-4 border-zinc-950 shadow-[8px_8px_0px_0px_rgba(24,24,27,1)] flex flex-col items-center justify-center transform hover:-translate-y-1 transition-transform duration-300">
            <span className="text-zinc-500 text-sm font-black uppercase tracking-widest mb-2">
              Server Load
            </span>
            <span className="text-5xl font-mono font-black text-zinc-950">
              50k <span className="text-xl text-zinc-500">req/s</span>
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
