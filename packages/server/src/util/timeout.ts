// Wraps a promise with a deadline. On timeout the returned promise
// rejects with a TimeoutError carrying the elapsed budget so callers
// can log it without guessing. Callers are expected to handle the
// rejection and degrade gracefully — domain-memory never propagates
// a timeout error to the user, only to the local log.

export class TimeoutError extends Error {
  constructor(public readonly timeoutMs: number, label?: string) {
    super(`${label ?? 'operation'} exceeded ${timeoutMs}ms budget`);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label?: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(timeoutMs, label));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const DEFAULT_SEARCH_TIMEOUT_MS = 2_000;
export const DEFAULT_DRIFT_TIMEOUT_MS = 2_000;
