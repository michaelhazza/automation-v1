// ---------------------------------------------------------------------------
// Per-run cost API response shape — Hermes Tier 1 Phase A.
//
// Spec: tasks/hermes-audit-tier-1-spec.md §5.4, §8.1, §8.2.
//
// `GET /api/runs/:runId/cost` returns this shape. The first three fields
// are backwards-compatible with the pre-Phase-A response (sourced from
// `cost_aggregates`). The four new fields are computed directly from the
// `llm_requests_all` view so runs older than `LLM_LEDGER_RETENTION_MONTHS`
// still report accurately after the nightly archive job moves their rows
// into `llm_requests_archive` (see §5.4 "Read source").
//
// Backwards-compat contract: the four new fields are ALWAYS present in
// the server response — never elided. The server substitutes zero
// defaults when the underlying query returns no rows, so client
// consumers that read them never observe `undefined`.
// ---------------------------------------------------------------------------

export interface CallSiteBreakdownEntry {
  costCents:    number;
  requestCount: number;
}

export interface RunCostResponse {
  entityId:       string;  // runId
  totalCostCents: number;  // from cost_aggregates — existing semantics (includes failed-call cost)
  requestCount:   number;  // from cost_aggregates — existing semantics
  llmCallCount:   number;  // COUNT(*) WHERE status IN ('success','partial')
  totalTokensIn:  number;  // SUM(tokens_in)  WHERE status IN ('success','partial')
  totalTokensOut: number;  // SUM(tokens_out) WHERE status IN ('success','partial')
  callSiteBreakdown: {
    app:    CallSiteBreakdownEntry;
    worker: CallSiteBreakdownEntry;
  };
}
