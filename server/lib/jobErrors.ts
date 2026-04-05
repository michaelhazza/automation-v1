// ---------------------------------------------------------------------------
// Job error classification and utility helpers for pg-boss workers
// ---------------------------------------------------------------------------

/** HTTP status codes that should NOT be retried — fail immediately to DLQ */
const NON_RETRYABLE_CODES = new Set([
  400, // validation error
  401, // auth error
  403, // permission error
  404, // missing entity
  409, // conflict / duplicate
  422, // unprocessable
]);

/** Check if an error is non-retryable (application-level, not transient) */
export function isNonRetryable(err: unknown): boolean {
  if (err && typeof err === 'object' && 'statusCode' in err) {
    return NON_RETRYABLE_CODES.has((err as { statusCode: number }).statusCode);
  }
  return false;
}

/** Check if error is a handler timeout (retryable, but log explicitly for visibility) */
export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('timed out after');
}

/** Type-safe retry count accessor — avoids (job as any).retrycount */
export function getRetryCount(job: { retrycount?: number } & Record<string, unknown>): number {
  return job.retrycount ?? 0;
}

/** Wrap a handler with a timeout — prevents hung LLM calls from starving workers */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Job handler timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/** Safe-serialize payload for logging — prevents log bloat from large LLM contexts */
export function safeSerialize(payload: unknown, maxBytes = 5000): unknown {
  try {
    const str = JSON.stringify(payload);
    if (str.length <= maxBytes) return payload;
    return { _truncated: true, _originalSize: str.length, _preview: str.slice(0, maxBytes) };
  } catch {
    return { _error: 'unserializable' };
  }
}
