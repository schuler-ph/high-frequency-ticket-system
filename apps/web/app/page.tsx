import Link from "next/link";

const previews = [
  {
    href: "/preview/1",
    number: "01",
    label: "Countdown",
    description: "Vorverkauf — Verkauf öffnet bald",
    accent: "text-zinc-500",
  },
  {
    href: "/preview/2",
    number: "02",
    label: "Aktiver Verkauf",
    description: "Tickets verfügbar, Kauf möglich",
    accent: "text-[#FFE600]",
  },
  {
    href: "/preview/3",
    number: "03",
    label: "Ausverkauft",
    description: "Alle Pässe vergeben",
    accent: "text-red-500",
  },
];

export default function PreviewIndex() {
  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-zinc-600 mb-8">
          Frequency Festival 20XX — Design-Auswahl
        </p>
        <div className="flex flex-col gap-px bg-zinc-800">
          {previews.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className="group flex items-center justify-between px-8 py-6 bg-zinc-950 hover:bg-zinc-900 transition-colors duration-100"
            >
              <div className="flex items-center gap-6">
                <span className={`font-mono font-black text-2xl ${p.accent}`}>
                  {p.number}
                </span>
                <div>
                  <p className="font-black uppercase tracking-tight text-white text-lg">
                    {p.label}
                  </p>
                  <p className="font-mono text-xs text-zinc-600 mt-0.5">
                    {p.description}
                  </p>
                </div>
              </div>
              <span className="font-mono text-zinc-700 group-hover:text-zinc-400 transition-colors text-xl">
                →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
