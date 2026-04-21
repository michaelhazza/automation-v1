// ---------------------------------------------------------------------------
// ReconciliationRequiredError — thrown by `llmRouter.routeCall` when a retry
// under the same `idempotencyKey` finds a provisional `'started'` row in
// `llm_requests`. This is the signal that a prior attempt called the
// provider (which has billed) but the DB write of the terminal ledger row
// failed — and a second dispatch would double-bill.
//
// See `tasks/llm-inflight-deferred-items-brief.md` §1 for the financial-
// risk context. The minimal-viable design ships a typed error + the
// caller decides how to handle it. Auto-retry inside the router is
// explicitly rejected: it would re-introduce the exact double-dispatch
// window this entire mechanism exists to prevent.
//
// Caller migration path:
//   - Before: `routeCall` throws generic Error on DB write failure; retry
//     is the caller's responsibility.
//   - After:  `routeCall` may throw ReconciliationRequiredError on a
//     retry after an in-flight provisional row. The caller inspects
//     `err.code === 'RECONCILIATION_REQUIRED'` and chooses what to do —
//     e.g. surface a banner to the operator, poll for the original
//     attempt's completion, or fail the agent run with a clear reason.
// ---------------------------------------------------------------------------

export class ReconciliationRequiredError extends Error {
  readonly code = 'RECONCILIATION_REQUIRED' as const;
  readonly statusCode = 409 as const;
  readonly idempotencyKey: string;
  /**
   * Optional runtimeKey hint — always `null` when the error is thrown from
   * the `'started'`-row idempotency-check path because the `llm_requests`
   * row stores only the `idempotencyKey`, not the in-memory registry's
   * `runtimeKey` (those are per-attempt identifiers scoped to one process).
   *
   * Callers that want to show a "there is a live call for this key — check
   * the In-Flight tab" banner should use `idempotencyKey` to query
   * `GET /api/admin/llm-pnl/in-flight` (the snapshot endpoint filters
   * results client-side by idempotencyKey). Future work could thread the
   * registry's runtimeKey here by looking up the live entry during the
   * error construction, but that would tie this error to the registry's
   * lifetime and make the typed surface more fragile — the brief §1
   * explicitly leaves this field nullable for that reason.
   */
  readonly existingRuntimeKey: string | null;

  constructor(args: {
    idempotencyKey:      string;
    existingRuntimeKey?: string | null;
    message?:            string;
  }) {
    super(args.message ?? (
      `LLM call for idempotency key "${args.idempotencyKey}" is already in `
      + `flight (provisional 'started' row exists). The prior attempt has `
      + `already dispatched to the provider; a retry under the same key would `
      + `double-bill. Caller must reconcile — do not auto-retry inside the router.`
    ));
    this.name = 'ReconciliationRequiredError';
    this.idempotencyKey = args.idempotencyKey;
    this.existingRuntimeKey = args.existingRuntimeKey ?? null;
  }
}

export function isReconciliationRequiredError(err: unknown): err is ReconciliationRequiredError {
  return err instanceof ReconciliationRequiredError;
}
