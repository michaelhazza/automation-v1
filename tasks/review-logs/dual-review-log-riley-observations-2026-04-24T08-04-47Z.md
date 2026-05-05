# Dual Review Log — riley-observations

**Files reviewed:** Riley Wave 1 logic-bearing files on branch `claude/start-riley-architect-pipeline-7ElHp`:
- `server/services/invokeAutomationStepService.ts`
- `server/services/invokeAutomationStepPure.ts`
- `server/services/workflowEngineService.ts` (invoke_automation case at lines 1522-1568)
- `server/lib/workflow/validator.ts`
- `server/lib/workflow/invokeAutomationSchemaValidator.ts`
- `server/lib/workflow/renderer.ts`
- `server/lib/workflow/types.ts`
- `server/lib/tracing.ts`
- `migrations/0222_rename_automations_columns.sql` + down migration
- `server/services/workspaceHealth/workspaceHealthFindings.ts`

**Iterations run:** 3 / 3 (terminated on zero accepts in iter 3)
**Timestamp:** 2026-04-24T08:04:47Z
**Commit at finish:** 6245afac

---

## Iteration 1

Codex raised 3 findings.

[ACCEPT] server/services/invokeAutomationStepService.ts:260 — Outbound HMAC is not verifiable and does not provide a stable idempotency token
  Reason: The service signs `stepRunId` via `webhookService.signOutboundRequest(...)` and sends only the resulting `X-Webhook-Signature`, but the body is `outcome.body` (the raw input mapping — no id). Receiver cannot recompute the HMAC. Retries are indistinguishable, so a timeout/5xx retry can trigger duplicate side effects. Fix: add `X-Automation-Step-Run-Id: <stepRunId>` header so signed material is recoverable AND the stepRunId serves as a stable idempotency key across retries (matches the existing queueService signing convention where the signed executionId is transmitted alongside the signature).

[REJECT] server/services/invokeAutomationStepService.ts:211 — `review_required` path emits no telemetry
  Reason: Spec §5.9 explicitly enumerates exactly 10 `completed`-event status values, and explicitly states "the `completed` event fires for every resolved-or-failed dispatch attempt." A `review_required` state is a pre-dispatch pause, not a dispatch attempt — gate-pause telemetry lives at the Workflow step-run layer via `WorkflowStepReviewService.requireApproval`, which is the infrastructure `workflowEngineService.ts:1547` correctly routes into. Adding a new status code to the completed event would be a spec change, not a conformance fix.

[REJECT] migrations/0222_rename_automations_columns.sql:7 — Non-concurrent DROP/CREATE INDEX blocks writes on live data
  Reason: This is a pre-production codebase (per `docs/spec-context.md` framing). `automations` is a small metadata table, not a high-volume transactional one. All 200+ migrations in the project use non-concurrent index operations — `CREATE INDEX CONCURRENTLY` is never used. Adopting it here would break the project convention AND require restructuring the Drizzle transactional migration wrapper. The rebuild here is a safety precaution around partial-index WHERE clauses that reference renamed columns; it is intentional and correctly scoped.

## Iteration 2

Codex verified the iter 1 HMAC fix landed correctly (confirmed at invokeAutomationStepService.ts:278-279: "the service still signs stepRunId, and now sends that exact signed material in a header, so downstream receivers can recompute the HMAC and use the same value as a stable idempotency key"). Raised 3 new findings.

[REJECT/DEFER] server/services/workflowEngineService.ts:1547 — Review-gated invoke_automation steps never dispatch after approval
  Reason: Real correctness issue but pre-existing and architectural. The approval machinery (`WorkflowRunService.decideApproval` at `workflowRunService.ts:581`) calls `completeStepRun` with `stepRun.outputJson ?? {}` — it never re-dispatches the approved step. The same shape applies to Sprint 4 P3.1 supervised-mode gates for `agent_call`/`prompt`/`action_call` (line 967-977). Fixing correctly requires architect-level redesign of `decideApproval` + the step-run state machine + the tick loop (a cross-cutting multi-service change). Routed to `tasks/todo.md ## Deferred from dual-reviewer review — riley-observations (2026-04-24)`.

[ACCEPT] server/lib/workflow/validator.ts:398 — invoke_automation inputMapping/outputMapping not walked by template-ref validator
  Reason: Rule-7 template-reference validation loop only reads `prompt`, `decisionPrompt`, `agentInputs`, and `actionInputs`. For the new `invoke_automation` step type, `inputMapping` values are template expressions per §5.4 (same namespace rules as `agentInputs`) but are not validated at authoring time — bad `{{ steps.* }}` refs can publish and only fail at runtime. Fix: add `inputMapping` values to `refSources`. **Excluded `outputMapping` from the fix** — its values use a `response` namespace added at runtime by `projectOutputMapping`, but `parsePath` does not recognise `response` as an allowed prefix, so running outputMapping values through `extractReferences` would produce false positives. A proper fix for outputMapping requires extending `parsePath` to accept a local `response` namespace contextually — out of scope for a dual-reviewer surgical fix.

[REJECT (partial — comment updated)] server/services/invokeAutomationStepPure.ts:146 — webhookPath guard does not enforce "single path segment"
  Reason: The suggested tightening (reject any `/` or `?` or `#`) would break every existing automation — all test fixtures and the entire production shape use multi-segment paths like `/webhook/abc`. The actual spec §5.10a rule 4 is narrowly about rejecting "more than one outbound webhook for the step (e.g. an Automation row that has been mutated to embed a list of webhook targets)" — the comma-separated case the current code already handles. Only the misleading code comment was updated ("single non-empty path segment" → "reject any webhookPath that would produce more than one outbound webhook ... multi-segment paths like /webhook/abc remain valid").

## Iteration 3

Codex raised 1 finding.

[REJECT/DEFER] server/services/workflowEngineService.ts:1532 — Late invoke_automation completions ignore invalidation
  Reason: Real correctness issue but pre-existing cross-cutting pattern. The `*Internal` helpers (`completeStepRunInternal` / `failStepRunInternal`) are used widely — `action_call` (line 1325-1378), `conditional` (line 1037), `agent_call`, `prompt`, `replay` (line 2297), and `decision` (line 2966+). NONE of these re-check invalidation after awaiting external I/O before calling the internal helpers. The public `completeStepRun` / `completeStepRunFromReview` entries DO re-check, but they are not used by the tick-switch's inline dispatches. Fixing just `invoke_automation` would be inconsistent — the fix needs to be applied systematically across every tick-switch site that awaits external I/O before writing terminal status, ideally by routing them through the public entries or adding a shared re-read+discard helper. That is a cross-cutting architectural change with its own correctness tests. Routed to `tasks/todo.md ## Deferred from dual-reviewer review — riley-observations (2026-04-24)`.

Zero findings accepted this iteration → loop terminates.

---

## Changes Made

- `server/services/invokeAutomationStepService.ts` — Added `X-Automation-Step-Run-Id` header alongside `X-Webhook-Signature` so receivers can recompute HMAC (signed material is `stepRunId`) and use the same value as a stable retry-idempotency key.
- `server/lib/workflow/validator.ts` — Extended Rule-7 template-reference validation loop to include `invoke_automation.inputMapping` values so bad `{{ steps.* }}` refs are caught at authoring time. Documented why `outputMapping` is intentionally excluded (its `response` namespace is not in `parsePath`'s allowed-prefix list at authoring time).
- `server/services/invokeAutomationStepPure.ts` — Clarified the `webhookPath` guard comment to match the actual spec §5.10a rule 4 scope (reject multi-webhook fan-out; multi-segment paths like `/webhook/abc` remain valid).
- `tasks/todo.md` — Added `## Deferred from dual-reviewer review — riley-observations (2026-04-24)` section with two architectural deferrals (review-gated dispatch resumption; late-completion invalidation race) — both pre-existing cross-cutting patterns, both correctly out of scope for a dual-reviewer surgical pass.

## Rejected Recommendations

- **review_required missing telemetry (iter 1)** — spec §5.9 enumerates exactly 10 `completed` status values, none for gates; gate telemetry is the Workflow step-run layer's responsibility.
- **Non-concurrent 0222 DROP/CREATE INDEX (iter 1)** — pre-production codebase, all 200+ migrations use non-concurrent index operations; changing convention here would be inconsistent.
- **Review-gated step dispatch after approval (iter 2)** — deferred to backlog; pre-existing architectural shape across `decideApproval` + step-run state machine + tick loop; same shape applies to Sprint 4 P3.1 supervised mode for other step types.
- **webhookPath rejected non-path-segment values (iter 2)** — would break all existing multi-segment automations; spec only requires rejecting multi-webhook fan-out, which the current check correctly handles.
- **Invalidation re-check after awaited I/O (iter 3)** — deferred to backlog; pre-existing cross-cutting pattern used by `action_call`, `agent_call`, `prompt`, `conditional`, `replay`, `decision`; fixing just `invoke_automation` would be inconsistent.

---

**Verdict:** PR ready. Two accepted fixes applied (HMAC idempotency header + inputMapping authoring-time validation + webhookPath comment clarity). Two architectural findings deferred to `tasks/todo.md` for follow-up work outside the dual-reviewer scope. Three findings rejected outright (spec-conformance of telemetry shape, migration convention, false-positive path-segment check). All three iterations terminated cleanly; iter 3 produced zero accepts so the loop exits per the dual-reviewer termination rule.
