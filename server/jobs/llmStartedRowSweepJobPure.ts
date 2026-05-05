// ---------------------------------------------------------------------------
// Pure cutoff math for `maintenance:llm-started-row-sweep`.
//
// Deferred-items brief §1: the sweep reaps `status = 'started'` rows whose
// `created_at` is older than `PROVIDER_CALL_TIMEOUT_MS + 60_000` ms. The 60s
// buffer past `providerTimeoutMs` deliberately telescopes with the
// in-memory in-flight registry's sweep (30s past timeout): the registry
// reaps first, the DB row reaps second.
//
// Extracted for testability — the impure job body in
// `llmStartedRowSweepJob.ts` calls this with `new Date()` + the env value.
// ---------------------------------------------------------------------------

/** Buffer (ms) past providerTimeoutMs before a `'started'` row is reapable. */
export const STARTED_ROW_SWEEP_BUFFER_MS = 60_000;

export function computeStartedRowSweepCutoff(params: {
  nowMs:              number;
  providerTimeoutMs:  number;
}): Date {
  const ttlMs  = params.providerTimeoutMs + STARTED_ROW_SWEEP_BUFFER_MS;
  return new Date(params.nowMs - ttlMs);
}
