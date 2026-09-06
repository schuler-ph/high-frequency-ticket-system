/**
 * Stammdaten des einen Angebots, das dieser Demo-Shop verkauft. Liegen hier,
 * weil Angebotsseite und Checkout-Zusammenfassung dieselben Werte zeigen — der
 * Preis ist reine Anzeige, die Pay-Route kennt keinen Betrag (ADR-013).
 */
export const OFFER = {
  series: "Frequency 20XX · 3-Tages-Festivalpass",
  city: "ST. PÖLTEN",
  venue: "Green Park St. Pölten",
  doors: "12:00 Uhr",
  dates: { from: "20.08.2026", to: "22.08.2026" },
  ticketType: "General-Admission-Pass",
  price: "€ 199,00",
} as const;
