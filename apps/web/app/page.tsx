import React from "react";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white overflow-hidden relative selection:bg-fuchsia-500 selection:text-white">
      {/* Background gradients */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-fuchsia-600 rounded-full mix-blend-multiply filter blur-[128px] opacity-40 animate-pulse duration-1000"></div>
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-blue-600 rounded-full mix-blend-multiply filter blur-[128px] opacity-40 animate-pulse duration-1000 delay-500"></div>

      <div className="relative z-10 container mx-auto px-6 py-24 min-h-screen flex flex-col justify-center items-center text-center">
        {/* Badge */}
        <div className="mb-8 inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-md">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)] animate-pulse"></span>
          <span className="text-sm font-medium text-slate-300">
            Live Ticket Sale
          </span>
        </div>

        {/* Hero Title */}
        <h1 className="text-6xl md:text-8xl lg:text-9xl font-black tracking-tighter mb-6 bg-clip-text text-transparent bg-gradient-to-br from-white via-slate-200 to-slate-500">
          FREQUENCY
          <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-500 via-purple-500 to-cyan-500 filter drop-shadow-[0_0_2rem_rgba(217,70,239,0.5)]">
            FESTIVAL 20XX
          </span>
        </h1>

        <p className="text-lg md:text-2xl text-slate-400 mb-12 max-w-2xl mx-auto font-light leading-relaxed">
          The ultimate music experience awaits. Secure your General Admission
          passes before they sell out.
        </p>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row gap-6 items-center">
          <button className="group relative px-8 py-4 font-bold text-white rounded-full bg-gradient-to-r from-fuchsia-600 to-blue-600 hover:from-fuchsia-500 hover:to-blue-500 shadow-[0_0_30px_rgba(217,70,239,0.4)] hover:shadow-[0_0_50px_rgba(217,70,239,0.7)] transition-all duration-300 ease-out hover:scale-105 active:scale-95">
            <span className="relative flex items-center gap-2">
              Purchase Tickets
              <svg
                className="w-5 h-5 group-hover:translate-x-1 transition-transform"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
            </span>
          </button>

          <button className="px-8 py-4 font-medium text-slate-300 rounded-full border border-slate-700 bg-slate-800/30 backdrop-blur-md hover:bg-slate-700/50 hover:text-white transition-all duration-300">
            View Lineup
          </button>
        </div>

        {/* Stats Glass Card */}
        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
          <div className="p-6 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md flex flex-col items-center justify-center transform hover:-translate-y-2 transition-transform duration-300 hover:border-fuchsia-500/30">
            <span className="text-fuchsia-400 text-sm font-semibold uppercase tracking-wider mb-2">
              Available
            </span>
            <span className="text-4xl font-mono font-bold text-white">
              843,291
            </span>
          </div>
          <div className="p-6 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md flex flex-col items-center justify-center transform hover:-translate-y-2 transition-transform duration-300 hover:border-emerald-500/30 relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full duration-1000 transition-transform"></div>
            <span className="text-emerald-400 text-sm font-semibold uppercase tracking-wider mb-2">
              Queue Status
            </span>
            <span className="text-xl font-medium text-white flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full inline-block shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse"></span>
              Fast Processing
            </span>
          </div>
          <div className="p-6 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md flex flex-col items-center justify-center transform hover:-translate-y-2 transition-transform duration-300 hover:border-cyan-500/30">
            <span className="text-cyan-400 text-sm font-semibold uppercase tracking-wider mb-2">
              Server Load
            </span>
            <span className="text-4xl font-mono font-bold text-white">
              50k <span className="text-lg text-cyan-500/50">req/s</span>
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
