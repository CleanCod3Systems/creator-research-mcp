export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  /** Solo reintentar si esto devuelve true (ej. 429/5xx sí, 401/404 no). Default: siempre. */
  isRetryable?: (err: unknown) => boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Backoff exponencial simple para llamadas de red flaky (rate-limits, timeouts transitorios).
 * No reintenta errores que no van a cambiar con un retry (auth, 404, URL inválida) si
 * `isRetryable` los descarta explícitamente.
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

/** Heurística común: reintentar rate-limit/timeout/5xx, NO reintentar auth/404/URL inválida. */
export function isTransientHttpError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/\b(401|403|404)\b/.test(msg)) return false;
  if (/login|cookies|autenticaci[óo]n|no es una URL/i.test(msg)) return false;
  return (
    /\b(429|5\d\d)\b/.test(msg) || /timeout|timed out|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg)
  );
}
