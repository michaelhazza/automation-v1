# Pre-Test Integration Harness — Progress

**Spec:** `docs/superpowers/specs/2026-04-28-pre-test-integration-harness-spec.md`
**Branch:** `claude/review-todo-items-S9JrI` (will rename / split per merge planning)
**Started:** 2026-04-28
**Last updated:** 2026-04-28

---

## Status: implementation complete, ready for `pr-reviewer`

All six §1 items implemented in a single session. Decisions for §1.5 and §1.6
both **Option A** (the spec's stated default).

---

## §5 Tracking — final

| Item | Status | Notes |
|------|--------|-------|
| §1.1 fake-webhook receiver | implemented | `server/services/__tests__/fixtures/fakeWebhookReceiver.ts` + self-test in `__tests__/`. Body-fully-read invariant; header normalisation (lowercase keys, multi-value joined); `setDropConnection` records call before destroying socket. |
| §1.2 fake-provider adapter | implemented | `server/services/__tests__/fixtures/fakeProviderAdapter.ts` + self-test. Provider registry extended with `registerProviderAdapter(key, adapter) → restore()` (prior-state capture, idempotent restore). Self-test covers same-key sequential AND parallel non-interference. |
| §1.3 LAEL test conversion | implemented | Three real assertions: happy-path emission with sequence + atomicity invariants, `budget_blocked` silence, non-agent-run silence. `assertNoRowsForRunId` cleanup helper inline (per §1.3 step 4a) with scope-safety pre-flight check. |
| §1.4 approval-resume test conversion | implemented | Three real assertions with HTTP-layer + DB-layer dual assertions. Test 2 asserts `receiver.callCount === 1` AND `workflow_step_runs.attempt === 1` (DB-side uniqueness proxy for the spec's "dispatch_source = 'approval_resume'" — see Decision below). HMAC fail-loud-on-missing-header. |
| §1.5 Gap D decision | **Option A** (default) | Failure-path payload row inserted in its own `db.transaction`; `buildPayloadRow` accepts `Record<string, unknown> \| null`; partial responses persisted whenever structurally valid; usage-without-content edge case covered. Pure tests cover all four cases. Migration 0241 makes `agent_run_llm_payloads.response` nullable. |
| §1.6 Gap B decision | **Option A** (default) | `AutomationStepError.type` widened with `'configuration'`; optional `status` (typed `string`, vocabulary enforced via `KNOWN_AUTOMATION_STEP_ERROR_STATUSES` tuple) + `context` fields. Pure test asserts shape + vocabulary discipline. |

---

## Files added / modified

### Added
- `migrations/0241_agent_run_llm_payloads_response_nullable.sql` (+ `.down.sql`)
- `server/services/__tests__/fixtures/fakeWebhookReceiver.ts`
- `server/services/__tests__/fixtures/__tests__/fakeWebhookReceiver.test.ts`
- `server/services/__tests__/fixtures/fakeProviderAdapter.ts`
- `server/services/__tests__/fixtures/__tests__/fakeProviderAdapter.test.ts`
- `server/services/__tests__/agentRunPayloadWriterFailurePathPure.test.ts`
- `server/services/__tests__/invokeAutomationStepErrorShapePure.test.ts`

### Modified
- `server/db/schema/agentRunLlmPayloads.ts` — `response` column now nullable
- `server/lib/workflow/types.ts` — `AutomationStepError` widened + new fields + `KNOWN_AUTOMATION_STEP_ERROR_STATUSES`
- `server/services/agentRunPayloadWriter.ts` — `buildPayloadRow` accepts `null` response
- `server/services/invokeAutomationStepService.ts` — missing-connection error populates structured shape
- `server/services/llmRouter.ts` — failure-path branch inserts payload row + emits `payloadInsertStatus` accordingly
- `server/services/providers/registry.ts` — added `registerProviderAdapter(key, adapter) → restore()`
- `server/services/__tests__/llmRouterLaelIntegration.test.ts` — three stubs replaced with real assertions
- `server/services/__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts` — three stubs replaced with real assertions
- `docs/superpowers/specs/2026-04-28-pre-test-integration-harness-spec.md` — §5 Tracking table updated

---

## Decision log

### §1.5 — Option A chosen

Default. Persisted failure-path payload row matches the predecessor spec's
§1.1 acceptance criterion. `buildPayloadRow` accepts `null` (no usable
output) or a partial response; null reserved exclusively for "no parseable
provider output". Partial responses are byte-preserved through the pipeline.
Usage-without-content edge case (content-policy refusal that consumes input
tokens but emits no output) preserves provider-reported `tokensIn` /
`tokensOut` so cost accounting stays accurate.

Migration 0241 makes `agent_run_llm_payloads.response` nullable. The spec
§0.3 scope-discipline rule is preserved: this is a constraint relaxation,
not a new abstraction or primitive.

### §1.6 — Option A chosen

Default. `AutomationStepError.type` widened to `'validation' | 'execution'
| 'timeout' | 'external' | 'unknown' | 'configuration'`. Optional `status`
+ `context` fields added. Closed vocabulary enforced via the
`KNOWN_AUTOMATION_STEP_ERROR_STATUSES` tuple co-located with the type
definition; status field stays typed `string` for now (literal-union
tightening deferred to the first follow-up that consolidates consumer
handling). Existing call sites keep their behaviour for non-`'configuration'`
errors (the new fields are optional).

### §1.4 — DB-side dispatch audit channel

The spec language references "exactly one row in the dispatch audit channel
for this stepRunId with `dispatch_source = 'approval_resume'`" with the
caveat "locate during implementation; candidates are `agent_execution_events`
with the dispatch event_type, or a `workflow_dispatch_log`-style table".

**Reality at implementation time:** no dedicated dispatch audit table
exists; `dispatch_source: 'approval_resume'` lives only in a `logger.info`
call inside `workflowEngineService.resumeInvokeAutomationStep`. The closest
DB-side proxy that persists supervised `invoke_automation` dispatches is
`workflow_step_runs` itself — `attempt` increments on each dispatch attempt
and `status` records the terminal outcome.

**Decision:** Test 2 asserts `workflow_step_runs.attempt === 1` AND
exactly one terminal `status='completed'` row for the `stepRunId` as the
DB-side uniqueness check. Test 3 asserts the symmetric negative invariant
(`attempt === 1`, `status='failed'`, no dispatch happened). This satisfies
the spec's intent of "dual-layer (HTTP + DB) assertion" without introducing
a new dispatch audit table (out of §0.3 scope). If a dedicated dispatch
audit table is added later, the test can be tightened to assert against it.

---

## Pre-merge gates

- `npx tsc --noEmit` — passing (only pre-existing client-side errors in
  `ClarificationInbox.tsx` + `SkillAnalyzerExecuteStep.tsx`, unrelated to
  this branch)
- Pure tests — added; not run in this session per the user's
  no-test-execution-during-dev preference (typecheck only)
- Integration tests — written but require a real test DB to execute; gated
  on `DATABASE_URL` per the established pattern from `triageDurability.integration.test.ts`
- `npm run test:gates` — to be run by the user pre-merge per CLAUDE.md
  gate-cadence rule

---

## Next steps

1. `pr-reviewer` agent (independent code review) — to be invoked next.
2. (Optional) `dual-reviewer` if user explicitly requests Codex pass.
3. Fresh-DB integration smoke at PR-finalisation time to validate the
   migration 0241 + fake-harness flow against a clean test DB.
4. KNOWLEDGE.md update (fake-harness pattern is reusable beyond LAEL +
   approval-resume) — pending after `pr-reviewer` rounds settle.
