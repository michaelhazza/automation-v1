/**
 * Single emit point for structured failures across the Reporting Agent
 * workflow. Spec v3.4 §8.4 / T13.
 *
 * Rules:
 *  - Every failure persisted to agent_runs / execution_runs / execution_steps
 *    MUST be constructed via `failure()`. Inline `{ failureReason: ... }`
 *    literals are banned outside this file (lint rule + zod check at
 *    persistence boundary).
 *  - The helper enriches `metadata` with `runId` and `correlationId` from
 *    the AsyncLocalStorage trace context when available (T15 invariant).
 *  - Callers pass the high-level reason (FailureReason enum) plus a
 *    sub-detail string. Free-form `failureReason` strings are impossible by
 *    construction.
 */

import {
  FailureObject,
  FailureObjectSchema,
  FailureReason,
} from './failureReason.js';

/**
 * Optional ambient trace context. The server defines this via instrumentation;
 * the worker reads it from its own logger context. Both populate it via the
 * `withTraceContext()` shim below so the helper has a single read path.
 */
export interface TraceContext {
  runId?: string;
  correlationId?: string;
}

let ambientTraceContextProvider: () => TraceContext | undefined = () => undefined;

/**
 * Wire up an ambient trace context provider. Called once at server / worker
 * bootstrap with a function that reads from AsyncLocalStorage / context.
 */
export function setTraceContextProvider(provider: () => TraceContext | undefined): void {
  ambientTraceContextProvider = provider;
}

/**
 * Construct a structured failure object. Single emit point for the entire
 * workflow. Always validates against `FailureObjectSchema` so a malformed
 * failure cannot escape this function.
 *
 * @param reason  High-level failure reason from the FailureReason enum.
 * @param detail  Free-form sub-reason string (e.g. 'login_failed_selector_missing').
 *                Bounded to 200 chars.
 * @param metadata Optional metadata. Will be merged with the ambient trace
 *                 context (`runId`, `correlationId`) if present.
 */
export function failure(
  reason: FailureReason,
  detail: string,
  metadata?: Record<string, unknown>,
): FailureObject {
  const trace = ambientTraceContextProvider();
  const enriched: Record<string, unknown> = {
    ...(metadata ?? {}),
  };
  if (trace?.runId && enriched.runId === undefined) enriched.runId = trace.runId;
  if (trace?.correlationId && enriched.correlationId === undefined) {
    enriched.correlationId = trace.correlationId;
  }
  const obj: FailureObject = {
    failureReason: reason,
    failureDetail: detail.slice(0, 200),
    metadata: Object.keys(enriched).length > 0 ? enriched : undefined,
  };
  // Validate by construction. Throws if a future caller tries to pass an
  // invalid enum value via type-cast.
  return FailureObjectSchema.parse(obj);
}

/**
 * Throwable error wrapper for `failure()`. Used inside async code paths
 * where throwing is the natural control flow. Catchers unwrap via
 * `isFailureError(err)` + `err.failure`.
 */
export class FailureError extends Error {
  readonly _tag = 'FailureError' as const;
  readonly failure: FailureObject;
  constructor(failureObj: FailureObject) {
    super(`${failureObj.failureReason}:${failureObj.failureDetail}`);
    this.failure = failureObj;
  }
}

export function throwFailure(
  reason: FailureReason,
  detail: string,
  metadata?: Record<string, unknown>,
): never {
  throw new FailureError(failure(reason, detail, metadata));
}

export function isFailureError(err: unknown): err is FailureError {
  return err instanceof FailureError;
}
