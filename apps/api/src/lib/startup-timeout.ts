/**
 * Bounds a startup dependency check (connecting to Redis, verifying a Pub/Sub
 * resource) so an unreachable dependency fails fast with an actionable message
 * instead of hanging until Fastify's generic ~10 s plugin timeout — the failure
 * mode that gives operators no hint about what is actually down.
 */
export class StartupTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StartupTimeoutError";
  }
}

export const withStartupTimeout = async <T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  message: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new StartupTimeoutError(message));
    }, timeoutMs);
    // Do not keep the process alive just for this watchdog.
    timer.unref();
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
