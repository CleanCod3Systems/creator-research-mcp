export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  /** Only retry if this returns true (e.g. 429/5xx yes, 401/404 no). Default: always. */
  isRetryable?: (err: unknown) => boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simple exponential backoff for flaky network calls (rate limits, transient timeouts).
 * Does not retry errors that won't change on retry (auth, 404, invalid URL) when
 * `isRetryable` explicitly rules them out.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const canRetry = opts.isRetryable ? opts.isRetryable(err) : true;
      if (!canRetry || attempt === retries) throw err;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastErr;
}

/** Common heuristic: retry rate-limit/timeout/5xx, do NOT retry auth/404/invalid URL. */
export function isTransientHttpError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/\b(401|403|404)\b/.test(msg)) return false;
  if (/login|cookies|authentication|not a tweet url/i.test(msg)) return false;
  return (
    /\b(429|5\d\d)\b/.test(msg) || /timeout|timed out|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg)
  );
}
