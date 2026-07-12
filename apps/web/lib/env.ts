import { z } from "zod";

const schema = z.object({
  apiUrl: z.url(),
  eventId: z.uuid(),
});

type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/**
 * Resolve and validate the public runtime env lazily. Parsing eagerly at module
 * load breaks the static prerender step (build time), where the
 * `NEXT_PUBLIC_*` vars are not set — so we only validate on first access, which
 * happens exclusively in client-side event handlers and effects.
 */
function loadEnv(): Env {
  if (cached === null) {
    cached = schema.parse({
      apiUrl: process.env.NEXT_PUBLIC_API_URL,
      eventId: process.env.NEXT_PUBLIC_EVENT_ID,
    });
  }
  return cached;
}

export const env: Env = {
  get apiUrl() {
    return loadEnv().apiUrl;
  },
  get eventId() {
    return loadEnv().eventId;
  },
};
