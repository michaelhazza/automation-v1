/**
 * Unified retry / backoff helper. Spec v3.4 §8.5 / T21.
 *
 * All external-call retries (Whisper, Slack, future integrations) go through
 * this single helper rather than ad-hoc per-integration loops. Per-integration
 * `isRetryable` predicates discriminate retryable vs terminal errors.
 *
 * Strategy: exponential backoff with full jitter. Honours `Retry-After` headers
 * when present (e.g. Slack 429). Logs each attempt with `{ label, attempt,
 * delayMs, correlationId, runId }` so retry behaviour is visible without
 * per-call instrumentation.
 *
 * Lint rule (added separately): no `setTimeout(..., 1000 * Math.pow(2, ...))`
 * style ad-hoc backoff outside this file.
 */

import { logger } from './logger.js';

export interface WithBackoffOptions<E = unknown> {
  /** Short label like 'whisper.transcribe' or 'slack.chat.post'. Used in logs. */
  label: string;
  /** Maximum number of attempts including the first. Default 3. */
  maxAttempts?: number;
  /** Base delay in milliseconds before the first retry. Default 500. */
  baseDelayMs?: number;
  /** Cap on backoff delay. Default 8000. */
  maxDelayMs?: number;
  /**
   * Predicate that returns true if the error is retryable. Mandatory — there
   * is no default. Each caller decides which errors should re-attempt and
   * which should fail immediately.
   */
  isRetryable: (err: E) => boolean;
  /**
   * Optional extractor for a `Retry-After`-style hint in seconds or
   * milliseconds. If returns a number, that delay is used instead of
   * exponential backoff for the next attempt.
   */
  retryAfterMs?: (err: E) => number | undefined;
  /** Optional callback fired on each retry attempt (after the failure). */
  onRetry?: (attempt: number, err: E) => void;
  /** Correlation context for log lines. Threaded into every attempt log. */
  correlationId: string;
  runId: string;
}

/**
 * Run `fn` with exponential-backoff-with-jitter retries. Throws the last
 * error after `maxAttempts`.
 */
export async function withBackoff<T, E = unknown>(
  fn: () => Promise<T>,
  opts: WithBackoffOptions<E>,
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 8000;
  let lastErr: E | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err as E;
      const isLast = attempt === maxAttempts;
      const retryable = opts.isRetryable(lastErr);
      logger.warn(`withBackoff.attempt_failed`, {
        label: opts.label,
        attempt,
        maxAttempts,
        retryable,
        isLast,
        correlationId: opts.correlationId,
        runId: opts.runId,
        err: serializeError(err),
      });
      if (isLast || !retryable) {
        throw err;
      }
      // Compute delay: respect explicit Retry-After if present, else
      // exponential backoff with full jitter capped at maxDelayMs.
      let delayMs: number;
      const hint = opts.retryAfterMs?.(lastErr);
      if (typeof hint === 'number' && hint >= 0) {
        delayMs = Math.min(hint, maxDelayMs);
      } else {
        const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
        delayMs = Math.floor(Math.random() * exp);
      }
      logger.debug(`withBackoff.retrying`, {
        label: opts.label,
        attempt,
        delayMs,
        correlationId: opts.correlationId,
        runId: opts.runId,
      });
      opts.onRetry?.(attempt, lastErr);
      await sleep(delayMs);
    }
  }
  // Unreachable in practice — the loop either returns or throws.
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message.slice(0, 500),
    };
  }
  // Plain object thrown as an error (e.g. service errors of the shape
  // { statusCode, code, message }). Preserve the well-known diagnostic
  // fields rather than collapsing to "[object Object]" via String(err).
  if (err !== null && typeof err === 'object') {
    const e = err as {
      statusCode?: unknown;
      status?: unknown;
      code?: unknown;
      errorCode?: unknown;
      message?: unknown;
      provider?: unknown;
    };
    const serialized: Record<string, unknown> = {};
    if (e.statusCode !== undefined) serialized.statusCode = e.statusCode;
    if (e.status !== undefined) serialized.status = e.status;
    if (e.code !== undefined) serialized.code = e.code;
    if (e.errorCode !== undefined) serialized.errorCode = e.errorCode;
    if (e.provider !== undefined) serialized.provider = e.provider;
    if (typeof e.message === 'string') {
      serialized.message = e.message.slice(0, 500);
    }
    // If none of the known fields were present, fall back to a JSON dump
    // so the caller at least sees the shape of the object.
    if (Object.keys(serialized).length === 0) {
      try {
        serialized.value = JSON.stringify(err).slice(0, 500);
      } catch {
        serialized.value = '[unserialisable object]';
      }
    }
    return serialized;
  }
  return { value: String(err).slice(0, 500) };
}
