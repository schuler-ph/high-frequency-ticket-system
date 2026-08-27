interface SpinnerProps {
  /** Tailwind-Groesse + Farbe (via `text-*`, der Spinner nutzt currentColor). */
  className?: string;
  label?: string;
}

/**
 * SVG-Spinner, der sauber um sein Zentrum rotiert — im Gegensatz zum frueheren
 * Glyph-Spinner (⟳), dessen optischer Mittelpunkt nicht der Box-Mittelpunkt ist
 * und der dadurch beim `animate-spin` eierte. Die viewBox ist auf (12,12)
 * zentriert, also dreht sich der Kreis exakt um seine Mitte. Farbe kommt aus
 * `currentColor`.
 */
export function Spinner({ className = "h-5 w-5", label }: SpinnerProps) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label={label ?? "Lädt"}
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        className="opacity-20"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        className="opacity-90"
      />
    </svg>
  );
}
