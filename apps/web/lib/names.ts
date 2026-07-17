/**
 * Winziger clientseitiger Namens-Generator fuer den Checkout — befuellt die
 * Vor-/Nachname-Inputs beim Betreten der `open`-Phase mit einem plausiblen
 * (fiktiven) Namen vor, damit der Kauf ohne Tipparbeit durchlaeuft. Bewusst
 * ohne externe Dependency; die Werte sind reine Demo-Daten und bleiben
 * editierbar.
 */

const FIRST_NAMES = [
  "Anna",
  "Lukas",
  "Lena",
  "Maximilian",
  "Sophie",
  "Felix",
  "Marie",
  "Jonas",
  "Emma",
  "Paul",
  "Laura",
  "David",
  "Sarah",
  "Simon",
  "Julia",
  "Tobias",
  "Hannah",
  "Elias",
  "Lea",
  "Florian",
] as const;

const LAST_NAMES = [
  "Gruber",
  "Huber",
  "Bauer",
  "Wagner",
  "Steiner",
  "Moser",
  "Mayer",
  "Berger",
  "Fuchs",
  "Leitner",
  "Wimmer",
  "Winkler",
  "Pichler",
  "Hofer",
  "Egger",
  "Brunner",
  "Lang",
  "Reiter",
  "Fischer",
  "Wolf",
] as const;

function pick(list: readonly string[]): string {
  return list[Math.floor(Math.random() * list.length)]!;
}

export interface GeneratedName {
  firstName: string;
  lastName: string;
}

/** Liefert einen zufaelligen Vor-/Nachnamen fuer den Checkout-Autofill. */
export function randomName(): GeneratedName {
  return {
    firstName: pick(FIRST_NAMES),
    lastName: pick(LAST_NAMES),
  };
}
