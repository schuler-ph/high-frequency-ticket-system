import type { ReactNode } from "react";

export type ChipTone = "blue" | "green" | "amber" | "red" | "slate";

const tones: Record<ChipTone, { wrap: string; dot: string }> = {
  blue: {
    wrap: "bg-blue-50 text-blue-700 ring-blue-600/20",
    dot: "bg-blue-500",
  },
  green: {
    wrap: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    dot: "bg-emerald-500",
  },
  amber: {
    wrap: "bg-amber-50 text-amber-700 ring-amber-600/20",
    dot: "bg-amber-500",
  },
  red: { wrap: "bg-red-50 text-red-700 ring-red-600/20", dot: "bg-red-500" },
  slate: {
    wrap: "bg-slate-100 text-slate-600 ring-slate-500/20",
    dot: "bg-slate-400",
  },
};

/**
 * Kleiner Status-Pill mit farbigem Punkt — macht den Verkaufs- bzw.
 * Order-Status im Dashboard auf einen Blick lesbar.
 */
export function StatusChip({
  tone,
  children,
  pulse = false,
}: {
  tone: ChipTone;
  children: ReactNode;
  pulse?: boolean;
}) {
  const t = tones[tone];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${t.wrap}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${t.dot} ${pulse ? "animate-pulse" : ""}`}
      />
      {children}
    </span>
  );
}
