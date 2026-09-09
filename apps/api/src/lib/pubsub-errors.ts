/**
 * gRPC-Statuscodes, bei denen ein Pub/Sub-Fehler dauerhaft ist: die Ressource
 * existiert nicht (mehr) oder der Zugriff ist entzogen. Kein Retry der Welt
 * repariert das — der Prozess ist ab hier arbeitsunfaehig (ADR-044).
 *
 * Alles andere (UNAVAILABLE, DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED …) ist
 * transient; dort behaelt der Client sein eigenes Retry-Verhalten.
 */
const FATAL_GRPC_CODES = new Map<number, string>([
  [5, "NOT_FOUND"],
  [7, "PERMISSION_DENIED"],
  [16, "UNAUTHENTICATED"],
]);

/** Nennt den gRPC-Code, wenn der Fehler dauerhaft ist, sonst `null`. */
export const fatalPubSubCode = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null) return null;

  const { code } = error as { code?: unknown };
  if (typeof code !== "number") return null;

  return FATAL_GRPC_CODES.get(code) ?? null;
};
