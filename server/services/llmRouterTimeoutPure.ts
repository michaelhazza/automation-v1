// ---------------------------------------------------------------------------
// Pure-logic extraction of the provider-timeout guard used by llmRouter.
//
// Split out of llmRouter.ts so tests can exercise the abort-propagation
// contract without booting the env-dependent router module. Per the repo's
// testing convention (docs/testing-conventions.md), *Pure.ts files must not
// import from db, env, or any service layer — the file below holds only
// Web-standard primitives (AbortController, AbortSignal, setTimeout).
//
// Why this exists:
//   The earlier Promise.race-based timeout rejected the outer promise but
//   left the underlying fetch running. That orphaned fetch caused provider-
//   side double-billing whenever the retry loop fired a second call while
//   the first was still in flight — and no LLM provider currently supports
//   request-level idempotency headers, so the duplicate spend couldn't be
//   mitigated at the HTTP layer either.
//
//   callWithTimeout creates an internal AbortController, merges it with the
//   caller's signal via AbortSignal.any(), and passes the merged signal
//   into the adapter factory. When the timer fires, the fetch is genuinely
//   cancelled — no second concurrent call, no silent provider spend.
// ---------------------------------------------------------------------------

export class ProviderTimeoutError extends Error {
  readonly code = 'PROVIDER_TIMEOUT';
  readonly statusCode = 504;
  readonly timeoutMs: number;
  readonly label: string;

  constructor(timeoutMs: number, label: string) {
    super(`Provider call timed out after ${timeoutMs}ms (${label})`);
    this.name = 'ProviderTimeoutError';
    this.timeoutMs = timeoutMs;
    this.label = label;
  }
}

export async function callWithTimeout<T>(
  label: string,
  ms: number,
  callerSignal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    timeoutController.abort(new ProviderTimeoutError(ms, label));
  }, ms);

  const signals: AbortSignal[] = [timeoutController.signal];
  if (callerSignal) signals.push(callerSignal);
  const merged = signals.length === 1 ? signals[0] : AbortSignal.any(signals);

  try {
    return await run(merged);
  } catch (err) {
    if (
      timeoutController.signal.aborted &&
      timeoutController.signal.reason instanceof ProviderTimeoutError
    ) {
      throw timeoutController.signal.reason;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
