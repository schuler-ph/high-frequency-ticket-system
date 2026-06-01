import { z } from "zod";

const schema = z.object({
  apiUrl: z.string().url(),
  eventId: z.string().uuid(),
});

export const env = schema.parse({
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
  eventId: process.env.NEXT_PUBLIC_EVENT_ID,
});
