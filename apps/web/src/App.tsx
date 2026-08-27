import { Navigate, Route, Routes } from "react-router";
import { CheckoutPage } from "./pages/CheckoutPage";
import { TicketPage } from "./pages/TicketPage";

/**
 * Die beiden Routen der App. Unbekannte Pfade landen auf dem Angebot — es
 * gibt keine weitere Navigation, ein 404-Screen waere nur Zierde.
 */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<TicketPage />} />
      <Route path="/checkout/:orderId" element={<CheckoutPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
