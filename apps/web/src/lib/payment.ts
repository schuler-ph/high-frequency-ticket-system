import type { PaymentRequest } from "@repo/types/tickets";

/**
 * SIMULATION ONLY — erzeugt plausible **Fake**-Zahlungsdaten fuer den
 * Checkout-Mock. Es findet keine echte Zahlungsabwicklung statt; die Werte
 * werden serverseitig nur gegen `paymentRequestSchema` validiert und danach
 * verworfen (ADR-013/ADR-028). Keine echten Kartennummern, keine Persistenz.
 *
 * Die Kartennummer ist bewusst eine offensichtliche Testnummer im
 * 4242-Bereich (Stripe-Test-Konvention), damit sofort erkennbar ist, dass es
 * keine echten Daten sind.
 */
export function fakePayment(cardHolder: string): PaymentRequest {
  const digits = () => String(Math.floor(1000 + Math.random() * 9000));
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  const year = String(27 + Math.floor(Math.random() * 5));
  const cvc = String(Math.floor(100 + Math.random() * 900));

  return {
    cardHolder: cardHolder.trim() || "Test Holder",
    cardNumber: `4242 ${digits()} ${digits()} ${digits()}`,
    expiry: `${month}/${year}`,
    cvc,
  };
}
