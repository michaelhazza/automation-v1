# LAEL-P1-1 implementation plan

**Source brief:** session brief Task 2 — `server/services/llmRouter.ts:845-855`
**Spec:** `tasks/live-agent-execution-log-spec.md` § 4.5, § 5.3, § 5.7
**Architect agent:** invoked but timed out before producing output. Plan derived inline from spec + brief + reconnaissance.

## Decisions (with rationale)

1. **Atomicity — wrap both terminal upserts in `db.transaction(async (tx) => { ... })`.**
   Spec §4.5 requires the payload row and ledger row to commit together. Current ledger upserts are not transactional. Wrapping both is the cleanest way to satisfy the "payload exists iff terminal row exists" invariant. Pattern already used at `llmRouter.ts:448` for the idempotency check.

2. **Failure-path payload write — yes, with synthetic response.**
   `agent_run_llm_payloads.response` is `jsonb NOT NULL`. The brief explicitly says "ONLY for paths that called the provider" — i.e. write payload on failure when `llm.requested` was emitted. Use synthetic shape `{ error: <classifiedStatus>, errorMessage: <callError> }` so the spec invariant holds and the timeline carries fidelity.

3. **Pre-dispatch terminals (`budget_blocked`, `rate_limited`, `provider_not_configured` from `getProviderAdapter`) — emit nothing.**
   These never reach the emit site; `llmRequestedEmitted` stays `false`; both events skipped naturally.

4. **`provider_not_configured` thrown by `providerAdapter.call()` itself — emit both events.**
   `llm.requested` was emitted just before the call. Pairing invariant requires `llm.completed`. The brief's note ("never emit for provider_not_configured") is an approximation; the binding rule is "never emit completed without requested."

5. **Provisional-row id threading.**
   Closure-scoped `let llmRequestId: string | null = null` set after the idempotency-tx returns, sourced from `idempotencyResult.provisionalRowId`. Used as both the event payload's `llmRequestId` and the FK on `agent_run_llm_payloads`.

6. **LAEL gate — `ctx.sourceType === 'agent_run' && ctx.runId && llmRequestId`.**
   Non-agent callers (skill-analyzer, system, config assistant) emit no LAEL events and write no payload row. Spec §4.5 / §5.7: payload table can hold non-agent rows, but P1 UI doesn't surface them — safer to skip the write entirely for now.

7. **`toolPolicies = {}` for P1.**
   Tool-level `payloadPersistencePolicy` declarations are a separate follow-up; default `'full'` is correct for now.

8. **`payloadPreviewTokens = params.estimatedContextTokens ?? 0`.**
   Already in scope; no extra computation.

9. **`maxBytes = env.AGENT_EXECUTION_LOG_MAX_PAYLOAD_BYTES`.**
   Env var defined in `server/lib/env.ts:134`, default 1 048 576 (1 MB).

10. **`sourceService: 'llmRouter'`.**
    Already in `AgentExecutionSourceService` union (`shared/types/agentExecutionLog.ts`).

11. **`durationMs` for `llm.completed` — use `Date.now() - llmCallStartedAt` where `llmCallStartedAt` is captured at the emit site of `llm.requested`.**
    This measures elapsed time between requested and completed events, not provider latency (which `providerLatencyMs` already records on the ledger). Both signals are useful.

12. **`llm.completed` emission timing — after the terminal-write transaction commits.**
    `tryEmitAgentEvent` is fire-and-forget; the appendEvent service retries critical events internally with one inline retry (spec §4.1). Emitting from the post-tx position keeps the emit out of the tx critical path.

13. **`response` shape passed to `buildPayloadRow` for success path.**
    Convert `ProviderResponse` to a `Record<string, unknown>` via spread — `{ ...providerResponse }` — since `buildPayloadRow.input.response` expects that type.

## Edits — file: `server/services/llmRouter.ts`

| # | Lines | Change |
|---|---|---|
| 1 | 24-31 (imports) | Add `import { tryEmitAgentEvent } from './agentExecutionEventEmitter.js';`, `import { buildPayloadRow } from './agentRunPayloadWriter.js';`, ensure `agentRunLlmPayloads` is imported from `../db/schema/index.js`. |
| 2 | After line ~582 (post `idempotencyResult.cached` check) | Capture `let llmRequestId: string | null = idempotencyResult.provisionalRowId ?? null;`, `let llmRequestedEmitted = false;`, `let llmCallStartedAt = 0;`. |
| 3 | Lines 845-855 (TODO marker) | Replace TODO comment with `llm.requested` emit (gated on agent-run + ctx.runId + llmRequestId). Set `llmRequestedEmitted = true; llmCallStartedAt = Date.now();`. |
| 4 | Lines 1071-1150 (failure-path upsert) | Wrap in `await db.transaction(async (tx) => { ... })`. Inside: existing upsert (now `tx.insert`), then if `llmRequestedEmitted && ctx.sourceType === 'agent_run' && ctx.runId && llmRequestId && successInsertedRows.length > 0`, build payload with synthetic `response: { error: callStatus, errorMessage: callError }` and `tx.insert(agentRunLlmPayloads).values(...)`. |
| 5 | After failure-path tx | If `llmRequestedEmitted`, emit `llm.completed` with `status=callStatus`, durationMs=Date.now()-llmCallStartedAt, costWithMarginCents=0, tokens=0,0. |
| 6 | Lines 1270-1367 (success-path upsert) | Wrap in `await db.transaction(async (tx) => { ... })`. Inside: existing upsert, then if gates pass, build payload from real provider response and insert. |
| 7 | After success-path tx (before line 1484 in-flight cleanup) | If `llmRequestedEmitted`, emit `llm.completed` with `status='success'`, real tokens, real cost, durationMs. |

## Test plan

- `npx tsc --noEmit` (server-side): zero new errors. (Pre-existing client-side errors from absent `node_modules/react` are environmental and unchanged.)
- Inspect the diff: `llm.requested` and `llm.completed` emissions are paired in every code path that entered the provider loop, and skipped in every pre-dispatch terminal path.
- `bash scripts/verify-no-direct-adapter-calls.sh` — sanity that we didn't accidentally bypass the router.
- Pure-test integration is hard without a running DB; rely on type-checking + a careful re-read of the diff. The brief's manual smoke (run an agent + observe the LAEL timeline) is the operator's verification step.

## Out of scope (per brief)

`memory.retrieved`, `rule.evaluated`, `skill.invoked`, `skill.completed`, `handoff.decided` — LAEL-P1-2.
