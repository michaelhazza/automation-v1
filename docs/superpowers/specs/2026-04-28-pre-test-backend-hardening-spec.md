# Pre-Test Backend Hardening — Spec

**Created:** 2026-04-28
**Status:** draft (ready for spec-reviewer)
**Source backlog:** `tasks/todo.md` (Tier 1+2 audit triage, 2026-04-28 session)
**Pair spec:** `docs/superpowers/specs/2026-04-28-pre-test-brief-and-ux-spec.md`
**Concurrency:** designed to run on a separate branch from the pair spec; file-disjoint by construction (see §0.4).

---

## Contents

- [§0 Why this spec exists](#0-why-this-spec-exists)
  - [§0.1 Framing assumptions](#01-framing-assumptions)
  - [§0.2 Testing posture](#02-testing-posture)
  - [§0.3 No new primitives unless named](#03-no-new-primitives-unless-named)
  - [§0.4 Concurrency contract with pair spec](#04-concurrency-contract-with-pair-spec)
- [§1 Items](#1-items)
  - [§1.1 LAEL-P1-1 — `llm.requested` / `llm.completed` emission + payload writer](#11-lael-p1-1--llmrequested--llmcompleted-emission--payload-writer)
  - [§1.2 REQ W1-44 — Pre-dispatch connection resolution in `invokeAutomationStepService`](#12-req-w1-44--pre-dispatch-connection-resolution-in-invokeautomationstepservice)
  - [§1.3 Codex iter 2 #4 — Supervised `invoke_automation` dispatch on approval](#13-codex-iter-2-4--supervised-invoke_automation-dispatch-on-approval)
  - [§1.4 N3 — Org-scoped `conversations_unique_scope` index](#14-n3--org-scoped-conversations_unique_scope-index)
  - [§1.5 S2 — `PULSE_CURSOR_SECRET` one-shot fallback warning](#15-s2--pulse_cursor_secret-one-shot-fallback-warning)
  - [§1.6 N1 — `artefactId` UUID-shape validation](#16-n1--artefactid-uuid-shape-validation)
  - [§1.7 #5 — Wire `incidentIngestorThrottle` into `incidentIngestor`](#17-5--wire-incidentingestorthrottle-into-incidentingestor)
  - [§1.8 S6 — Idempotent approve/reject race tests for `reviewService`](#18-s6--idempotent-approvereject-race-tests-for-reviewservice)
- [§2 Sequencing](#2-sequencing)
- [§3 Out of scope](#3-out-of-scope)
- [§4 Definition of Done](#4-definition-of-done)
- [§5 Tracking](#5-tracking)

---

## §0 Why this spec exists

The product is pre-production and has not yet been through a structured testing round. A 2026-04-28 audit of `tasks/todo.md` triaged ~20 deferred items against the lens "what would corrupt or weaken the signal from a first major testing pass?" Most identified items had already shipped (B10, all P3-C* RLS items, migrations 0228/0229, DR1, DR3); the residual set splits cleanly between "backend observability + plumbing + safety" (this spec) and "Universal Brief follow-up + dashboard error UX" (the pair spec).

This spec consolidates eight items that share four properties:
1. **Server-side only** (no client edits beyond test fixtures), keeping the change surface inspectable.
2. **File-disjoint from the pair spec** — the matrix in §0.4 enumerates every file touched here and confirms zero overlap.
3. **Testing-relevant** — each item either (a) makes a missing observability surface light up, (b) closes a gap that would surface as a misleading bug during testing, or (c) hardens a path that load/concurrency testing will exercise.
4. **Bounded scope** — the architectural items (LAEL-P1-1, Codex iter 2 #4) carry constrained file lists; smaller items are mechanical.

### §0.1 Framing assumptions

Imported from `docs/spec-context.md`:

- **Pre-production.** Backwards compatibility shims, feature flags, and migration windows are not required. Drop deprecated patterns directly.
- **Rapid evolution.** Prefer simple, deterministic implementations over abstractions designed for hypothetical reuse.
- **No feature flags.** Conditional behaviour goes via env vars only when the env-var requirement is itself the spec.
- **Prefer existing primitives.** Anything that needs `withAdminConnection`, `withOrgTx`, `getOrgScopedDb`, `withPrincipalContext`, the existing `assertValidTransition` guard, or any pre-existing helper MUST use it rather than introduce a parallel abstraction.

### §0.2 Testing posture

Per `docs/spec-context.md` and consistent with the audit-remediation-followups spec:

- **Pure-function unit tests** (`*Pure.ts` + `*.test.ts`) are the default for new logic in this spec.
- **Targeted integration tests** are permitted only inside the existing carve-out for hot-path concerns: RLS, idempotency / concurrency control, crash-resume parity. Items §1.7 and §1.8 sit inside that carve-out.
- **No new test harnesses or mocking frameworks.** Use `node:test` + `node:assert` plus `mock.method` for spies (matches existing convention in `server/lib/__tests__/derivedDataMissingLog.test.ts`).
- **Manual smoke step is acceptable** where automated coverage would require multi-process orchestration. §1.3 may call out a manual smoke for the supervised-mode webhook fire path.

### §0.3 No new primitives unless named

No item in §1 may introduce a new abstraction, helper module, primitive, or system-level pattern unless that primitive is **explicitly named in the item's Files list and Approach section**. This rule mirrors the audit-remediation-followups spec's §0.2 and prevents accidental mini-frameworks.

Concrete consequences:
- §1.1 LAEL-P1-1 introduces no new primitive — `llmInflightRegistry`, `agentRunPayloadWriter.buildPayloadRow`, `agentExecutionEventEmitter.tryEmitAgentEvent`, the migration-0192 denormalised FK, and the existing terminal-tx pattern in `llmRouter` already exist.
- §1.2 REQ W1-44 names exactly one new pure helper `resolveRequiredConnections({ automation, subaccountId, mappings }) → ResolutionResult`. No further helpers may emerge.
- §1.3 Codex iter 2 #4 names exactly one new code path: a step-type-aware branch inside `decideApproval` (or a sibling `dispatchApprovedStep` function in the same file). No new state-machine primitive, no new approval-result discriminated union beyond what exists today.
- §1.4 N3 introduces one migration (0240). No schema-design primitive.
- §1.5–§1.7 are pure mechanical fixes — no helpers permitted.
- §1.8 S6 reuses the existing test convention; no new fixture framework.

If implementation surfaces a need for a primitive not named in the item's Files list, **stop, log to `tasks/todo.md`, and ship the item against its stated scope only**.

### §0.4 Concurrency contract with pair spec

This spec runs concurrently with `docs/superpowers/specs/2026-04-28-pre-test-brief-and-ux-spec.md` on a separate branch. The file matrix below is exhaustive — each session must constrain edits to its own column.

| File | This spec | Pair spec |
|------|-----------|-----------|
| `server/services/llmRouter.ts` | §1.1 | — |
| `server/services/agentRunPayloadWriter.ts` | §1.1 | — |
| `server/services/agentExecutionEventEmitter.ts` | §1.1 | — |
| `server/services/invokeAutomationStepService.ts` | §1.2 | — |
| `server/services/automationConnectionMappingService.ts` (read-only consume) | §1.2 | — |
| `server/services/workflowEngineService.ts` | §1.3 | — |
| `server/services/workflowRunService.ts` | §1.3 | — |
| `migrations/0240_conversations_org_scoped_unique.sql` (NEW) | §1.4 | — |
| `migrations/0240_conversations_org_scoped_unique.down.sql` (NEW) | §1.4 | — |
| `server/db/schema/conversations.ts` | §1.4 | — |
| `server/services/clientPulseHighRiskService.ts` | §1.5 | — |
| `server/services/briefArtefactValidatorPure.ts` | §1.6 | — |
| `server/services/incidentIngestor.ts` | §1.7 | — |
| `server/services/__tests__/incidentIngestorThrottle.integration.test.ts` (NEW) | §1.7 | — |
| `server/services/__tests__/reviewServiceIdempotency.test.ts` (NEW) | §1.8 | — |
| `server/routes/conversations.ts` | — | DR2 |
| `server/services/briefConversationWriter.ts` | — | S8 |
| `server/lib/postCommitEmitter.ts` (NEW, named in pair spec) | — | S8 |
| `server/routes/briefs.ts` | — | N7 |
| `server/services/briefCreationService.ts` | — | N7 |
| `client/src/pages/BriefDetailPage.tsx` | — | N7 |
| `client/src/pages/DashboardPage.tsx` | — | S3 |
| `client/src/pages/ClientPulseDashboardPage.tsx` | — | S3 |

**Migration coordination.** This spec reserves migration slots `0240` (the next slot, used by §1.4). The pair spec reserves zero migration slots. If any spec needs a second migration during implementation, it MUST claim `0241` and add a written entry to its §0.4 matrix before allocating.

**`tasks/todo.md` coordination.** Each spec ticks off its own deferred-item entries. Merge-time conflicts on `tasks/todo.md` are expected; resolve by retaining both sets of completion marks.

---

## §1 Items

### §1.1 LAEL-P1-1 — `llm.requested` / `llm.completed` emission + payload writer

**Source.** `tasks/todo.md` § "Live Agent Execution Log — deferred items" → LAEL-P1-1. Spec: `tasks/live-agent-execution-log-spec.md` §4.5, §5.3, §5.7.

**Files.**
- `server/services/llmRouter.ts` (TODO scaffold at line 845; emission call sites + payload-row insertion).
- `server/services/agentRunPayloadWriter.ts` (existing — `buildPayloadRow({ systemPrompt, messages, toolDefinitions, response, toolPolicies, maxBytes })` already exported; consumed only).
- `server/services/agentExecutionEventEmitter.ts` (existing — `tryEmitAgentEvent` already exported; consumed only).
- `server/db/schema/agentRunLlmPayloads.ts` (existing; `runId` column denormalised in migration 0192).
- `server/services/__tests__/llmRouterPayloadEmissionPure.test.ts` (NEW — pure tests for the gating predicate).

**Goal.** Close the observability gap that leaves the Live Agent Execution Log timeline blank between `prompt.assembled` and `run.completed`. After this lands, every LLM call inside an agent run emits a `llm.requested` event before dispatch and a `llm.completed` event in the terminal-tx finally block, and the redacted payload row is persisted in `agent_run_llm_payloads` with `run_id` populated from `ctx.runId`.

**Approach.**
1. **Provisional ledger-id plumbing.** The idempotency-check transaction in `llmRouter` already creates a `'started'` ledger row before dispatch. Thread that row's `id` from the tx-completion handler up to the dispatch-site closure so the emit calls can reference it as `ledgerRowId`. No new state — the value already exists at line ~830 in the existing flow; this is a closure capture.
2. **`llm.requested` emission.** Immediately before `providerAdapter.call(...)`, call:
   ```ts
   await tryEmitAgentEvent({
     runId: ctx.runId,
     organisationId: ctx.organisationId,
     subaccountId: ctx.subaccountId ?? null,
     eventType: 'llm.requested',
     tier: 'critical',
     payload: { provider, model, ledgerRowId, callSite: ctx.callSite },
     linkedEntity: { kind: 'llm_request', id: ledgerRowId },
   });
   ```
   Guard the call with `if (ctx.sourceType === 'agent_run' && ctx.runId)` — non-agent calls (Slack, Whisper, system maintenance) MUST NOT emit.
3. **Payload row insert (terminal tx).** Inside the existing terminal-write transaction (success / failure / `budget_blocked` / etc.), call `buildPayloadRow({ systemPrompt, messages, toolDefinitions, response, toolPolicies, maxBytes })` and insert into `agent_run_llm_payloads` with `run_id = ctx.runId`. The migration-0192 FK is denormalised, so a tx rollback drops both the ledger row and the payload row together.
4. **`llm.completed` emission.** In the same `finally` block that writes the terminal ledger row, call `tryEmitAgentEvent` with `eventType: 'llm.completed'`, `tier: 'critical'`, payload `{ ledgerRowId, terminalStatus, latencyMs, costCents, tokensIn, tokensOut, payloadRowId }`. Same guard as step 2.
5. **Pre-dispatch terminal states.** When the terminal status is one of `'budget_blocked' | 'rate_limited' | 'provider_not_configured'`, the adapter was never called. **Skip both `llm.requested` and `llm.completed` emission AND the payload row insert** — there is nothing to record. The ledger row still writes (existing behaviour); only the LAEL emission and payload insert are skipped.
6. **Pure gating predicate.** Extract a pure function `shouldEmitLaelLifecycle(ctx, terminalStatus): boolean` into `llmRouter.ts` (or a sibling `*Pure.ts` if the file's pure-test discipline requires it). Returns `true` iff `ctx.sourceType === 'agent_run' && ctx.runId && terminalStatus !== 'budget_blocked' && terminalStatus !== 'rate_limited' && terminalStatus !== 'provider_not_configured'`. Unit-test exhaustively (matrix of source-type × runId-present × terminalStatus).

**Acceptance criteria.**
- A successful agent-run LLM call produces, in order: `prompt.assembled` → `llm.requested` → `llm.completed` → (next iteration / `run.completed`) — verifiable by querying `agent_execution_events WHERE run_id = $1 ORDER BY sequence_number`.
- A failed-mid-flight agent-run LLM call (provider error) produces `llm.requested` → `llm.completed` (with `terminalStatus: 'failed'` in the payload) and the corresponding `agent_run_llm_payloads` row.
- A `budget_blocked` agent-run LLM call produces NEITHER `llm.requested` NOR `llm.completed`, and NO `agent_run_llm_payloads` row. The ledger row still records `budget_blocked`.
- A non-agent-run LLM call (Slack, Whisper) emits NO LAEL events and writes NO payload row, regardless of terminal status.
- `agent_run_llm_payloads.run_id` is non-null for every payload row inserted by this code path.
- Tx rollback (e.g. ledger insert fails after payload row inserted) drops both rows — verified by manual smoke (force a contrived rollback in a test environment).

**Tests.**
- `server/services/__tests__/llmRouterPayloadEmissionPure.test.ts` — exhaustive matrix on `shouldEmitLaelLifecycle(ctx, terminalStatus)` covering 4 source types × 2 runId states × 5 terminal statuses = 40 cases. Pure-function discipline.
- **Carved-out integration test** (allowed under §0.2): `server/services/__tests__/llmRouterLaelIntegration.test.ts` exercises one happy-path agent-run call through a real `llmRouter` invocation against a fake provider adapter, asserts both events and the payload row appear with matching `ledgerRowId`. Uses the existing test-DB harness from `pgboss-zod-hardening-spec` integration tests.

**Dependencies.** Migration 0192 (already shipped) provides `agent_run_llm_payloads.run_id`. No new dependencies.

**Risk.** Medium. The terminal-tx integration is the highest-risk surface: a bug in payload insertion that throws inside the tx will roll back the ledger row, which currently never happens. Mitigation: payload insertion is wrapped in a `try { … } catch (err) { logger.warn('lael_payload_insert_failed', …); }` so insert failure logs and continues; the tx still commits the ledger row. **This is a documented exception to the "rollback together" guarantee** — accept it because dropping a ledger row over a missing payload row would be worse. Document this exception inline at the catch site.

**Definition of Done.** All acceptance criteria pass; pure tests added and green; one integration test added and green; manual smoke for tx-rollback case completed and noted in `tasks/builds/<slug>/progress.md`; `tasks/todo.md § Live Agent Execution Log — deferred items § LAEL-P1-1` ticked off.

---

### §1.2 REQ W1-44 — Pre-dispatch connection resolution in `invokeAutomationStepService`

**Source.** `tasks/todo.md` § "Deferred from spec-conformance review — riley-observations wave 1 (2026-04-24)" → REQ W1-44. Spec: `docs/riley-observations-dev-spec.md` §5.8 (credential resolution and scoping).

**Files.**
- `server/services/invokeAutomationStepService.ts` — call site for the new pre-dispatch check (insert before the `webhookErr` assertion at line ~188).
- `server/services/automationConnectionMappingService.ts` — read-only consumer (`listMappings(organisationId, subaccountId)` already exported per the audit-remediation work).
- `server/services/__tests__/resolveRequiredConnectionsPure.test.ts` (NEW).

**Goal.** When dispatching an `invoke_automation` step, verify every entry in the automation's `requiredConnections` field is mapped for the calling subaccount BEFORE firing the webhook. If any required connection is missing, fail the step with `automation_missing_connection` and a structured error payload listing the missing keys.

**Approach.**
1. **New pure helper** `resolveRequiredConnections({ automation, subaccountId, mappings }) → ResolutionResult`:
   ```ts
   type ResolutionResult =
     | { ok: true; resolved: Record<string, string> }
     | { ok: false; missing: string[] };
   ```
   `automation.requiredConnections` is `string[]` (or `null`). `mappings` is `Array<{ connectionKey: string; connectionId: string }>`. The function returns `ok: true` with a `resolved` map iff every required key has a non-empty `connectionId` in `mappings`; otherwise `ok: false` with the missing keys.
2. **Call site.** In `invokeAutomationStepService` immediately after the automation row is loaded and before `assertSingleWebhook` (line ~188), call `automationConnectionMappingService.listMappings(automation.organisationId, step.subaccountId)`, pass the result through `resolveRequiredConnections`, and on `ok: false`:
   ```ts
   const error: AutomationStepError = {
     code: 'automation_missing_connection',
     type: 'configuration',
     status: 'missing_connection',
     message: `Automation '${automation.id}' is missing required connections: ${result.missing.join(', ')}`,
     context: { automationId: automation.id, missingKeys: result.missing },
   };
   recordTracingEvent({ ..., error });
   return { status: 'missing_connection', error, gateLevel: resolveGateLevel(step, automation), retryAttempt: 1, latencyMs: 0 };
   ```
3. **Empty / null `requiredConnections`.** If `automation.requiredConnections` is `null` or `[]`, treat as `ok: true` and skip the mapping query — short-circuit to avoid the DB round-trip.
4. **Engine connection.** The automation's engine connection is loaded separately via the existing engine-resolution path; this item does NOT touch that flow. Engine-not-found continues to surface as `automation_execution_error` (a separate deferred item — REQ W1-38).

**Acceptance criteria.**
- An `invoke_automation` step against an automation with `requiredConnections: ['ghl', 'slack']` fails with `automation_missing_connection` and `missingKeys: ['slack']` if the subaccount has only the GHL mapping.
- The same step succeeds normally when both mappings are present.
- An automation with `requiredConnections: null` or `[]` skips the mapping query (verified by spy on `listMappings`).
- The error code `automation_missing_connection` matches the §5.7 vocabulary in the spec; the `status: 'missing_connection'` value matches §5.10.
- The pure helper is fully tested; the integration with the dispatcher is exercised by an existing or newly-added thin behavioural test against `invokeAutomationStepService`.

**Tests.**
- `server/services/__tests__/resolveRequiredConnectionsPure.test.ts` — table-driven tests:
  - empty/null requiredConnections + any mappings → `ok: true, resolved: {}`
  - one required, present → `ok: true`
  - one required, absent → `ok: false, missing: [key]`
  - multiple required, partial overlap → `ok: false, missing: [diff]`
  - mapping with empty `connectionId` for a required key → treated as missing
  - mapping with extra unrelated keys → ignored

**Dependencies.** `automationConnectionMappingService.listMappings` is already exported (audit-remediation work in PR #196); no upstream blocker.

**Risk.** Low. The added DB round-trip is a single indexed lookup per dispatch; the short-circuit on empty `requiredConnections` keeps the existing happy path unchanged for automations without declared connections.

**Definition of Done.** All acceptance criteria pass; pure tests added and green; the dispatcher's `automation_missing_connection` path verified manually against a contrived automation row in dev DB; `tasks/todo.md § REQ W1-44` ticked off.

---

### §1.3 Codex iter 2 #4 — Supervised `invoke_automation` dispatch on approval

**Source.** `tasks/todo.md` § "Deferred from dual-reviewer review — riley-observations (2026-04-24)" → Codex iter 2 finding #4. The bug: a supervised `invoke_automation` step that is approved via `decideApproval` calls `completeStepRun` with `stepRun.outputJson ?? {}` and the webhook is never dispatched.

**Files.**
- `server/services/workflowEngineService.ts` — the tick switch and the `dispatchInvokeAutomationInternal` (or equivalent) helper. Locate the existing `'invoke_automation'` branch in the tick loop; reuse its dispatch path from the approval-resume handler.
- `server/services/workflowRunService.ts` — `decideApproval` function. The current path completes the step on approve; this spec adds a step-type-aware branch that defers completion to the dispatch helper for `invoke_automation`.
- `server/services/__tests__/decideApprovalStepTypePure.test.ts` (NEW — pure tests for the branching predicate).

**Goal.** When `decideApproval` lands an `approve` decision on a step with `stepKind === 'invoke_automation'`, route through the dispatch path (which fires the webhook) rather than calling `completeStepRun` with empty output. The step's terminal status is then determined by the dispatch outcome (success / `automation_missing_connection` / `automation_execution_error` / etc.), not by approval alone.

**Approach.**
1. **Extract the step-type-aware dispatch decision into a pure helper** `resolveApprovalDispatchAction(stepRun, decision) → 'complete_with_existing_output' | 'redispatch'`:
   - `decision === 'reject'` → always `'complete_with_existing_output'` (existing behaviour, no change).
   - `decision === 'approve' && stepRun.stepKind === 'invoke_automation'` → `'redispatch'`.
   - `decision === 'approve'` for any other stepKind → `'complete_with_existing_output'` (existing behaviour for `agent_call`, `prompt`, `action_call` — these complete with the approved output payload, which they have already produced inside the supervised pause).
   - **Open question for the architect pass:** the original spec note flagged that `agent_call` / `prompt` / `action_call` may have the same gap class. This spec deliberately limits scope to `invoke_automation` because it is the only case where the step has produced NO output during the supervised pause (the webhook was never fired). The other step types call the LLM / action / agent BEFORE the supervised pause and have meaningful output to commit. If implementation surfaces evidence that any of the other three also lack output, **stop and write a follow-up spec** (per §0.3) rather than expanding scope inline.
2. **Branching in `decideApproval`.** After the existing approval write to the audit table:
   ```ts
   const action = resolveApprovalDispatchAction(stepRun, decision);
   if (action === 'redispatch') {
     // Re-enter the dispatch path. Reuses the existing `'invoke_automation'`
     // branch in the tick loop's switch — call its inline helper directly so
     // the webhook fires, retries are honoured, and terminal status flows
     // back through the same `completeStepRunInternal` / `failStepRun`
     // boundary the tick loop uses.
     await dispatchInvokeAutomationInternal({
       runId, stepRun, automationId: stepRun.stepDefinition.automationId,
       fromApprovalResume: true,
     });
   } else {
     await completeStepRun({ runId, stepRunId, outputJson: stepRun.outputJson ?? {} });
   }
   ```
3. **`fromApprovalResume: true` flag.** Pass through to `dispatchInvokeAutomationInternal` so the dispatcher knows it's a re-entry and (a) does not re-decrement retry counters that the supervised pause already preserved, (b) emits a tracing event tagged `dispatch_source: 'approval_resume'` so timeline observers can distinguish first-attempt dispatches from approval-resume dispatches.
4. **Idempotency.** If `decideApproval` is called twice for the same step (concurrent approvals via two browser tabs, or a UI retry), the second call MUST return the existing decision result without re-firing the webhook. The existing `decideApproval` idempotency guard (decision audit row uniqueness) already handles this; verify the flow does not regress by including a test in §1.8 (cross-spec — S6 covers reviewService; this verifies the workflow approval idempotency separately if not already covered).
5. **Re-read + invalidation guard.** The existing pattern from PR #211 (R3-2 `assertValidTransition`) wraps terminal writes. The new `dispatchInvokeAutomationInternal` re-entry sits inside the existing tick-loop dispatch path which already calls `assertValidTransition` at its terminal write boundaries — no new guard needed. Verify this assumption holds by tracing one happy path through the dispatcher manually before shipping.

**Acceptance criteria.**
- A `Workflow run` with a supervised `invoke_automation` step that is approved fires the webhook (verifiable by an outbound HTTP request to the configured automation endpoint or by a test-mode capture).
- The same step's terminal status reflects the dispatch outcome — `completed` on webhook 2xx, `failed` on webhook timeout, `missing_connection` if the new §1.2 guard fires, etc. NOT `completed` with empty `outputJson` purely from the approval.
- A `reject` decision on the same step type completes with no webhook fired and the step terminal status is `rejected` (existing behaviour preserved).
- A double-approve via two tabs results in exactly one webhook dispatch (idempotency preserved).
- Approval of an `agent_call` / `prompt` / `action_call` step continues to complete with the supervised-output payload — no regression in the other three step types.
- The tracing timeline shows `dispatch_source: 'approval_resume'` on the second dispatch event.

**Tests.**
- `server/services/__tests__/decideApprovalStepTypePure.test.ts` — exhaustive matrix on `resolveApprovalDispatchAction(stepRun, decision)`:
  - `decision='reject'` × 4 stepKinds → all `'complete_with_existing_output'`.
  - `decision='approve' × stepKind='invoke_automation'` → `'redispatch'`.
  - `decision='approve' × stepKind='agent_call' | 'prompt' | 'action_call'` → `'complete_with_existing_output'`.
- **Carved-out integration test** (allowed under §0.2): `server/services/__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts` exercises a contrived `invoke_automation` step through `decideApproval('approve')` against a fake webhook endpoint that records dispatch attempts; asserts exactly one dispatch happens, terminal status is `completed`.
- **Manual smoke** (allowed under §0.2): in dev DB, create one supervised `invoke_automation` step, hit the approval endpoint, verify the webhook fires (check the receiving automation engine's logs).

**Dependencies.** §1.2 (REQ W1-44) is logically related but not blocking — both can ship independently. If §1.2 has shipped, the approval-resume dispatch path inherits the `automation_missing_connection` behaviour automatically (defence-in-depth — the missing-connection check fires both on first dispatch and on approval-resume). Verify ordering in §2 Sequencing.

**Risk.** Medium-high. Architecture-touching: changes the contract of `decideApproval` for one step type. Mitigation: (a) the change is gated by an explicit step-type predicate in a pure helper (inspectable), (b) the other three step types are explicitly preserved by the predicate's table, (c) the integration test covers one happy path end-to-end before merge, (d) manual smoke confirms the webhook actually fires in dev DB.

**Definition of Done.** All acceptance criteria pass; pure tests added and green; integration test added and green; manual smoke completed and noted in `tasks/builds/<slug>/progress.md`; `tasks/todo.md § Codex iter 2 finding #4` ticked off; KNOWLEDGE.md entry captured if the implementation surfaces a non-obvious decision.

---

### §1.4 N3 — Org-scoped `conversations_unique_scope` index

**Source.** `tasks/todo.md` § "Deferred from pr-reviewer review — Universal Brief" → N3.

**Files.**
- `migrations/0240_conversations_org_scoped_unique.sql` (NEW).
- `migrations/0240_conversations_org_scoped_unique.down.sql` (NEW).
- `server/db/schema/conversations.ts` (Drizzle index definition update — keep schema in sync with the migration).

**Goal.** Replace the existing `conversations_unique_scope` index `(scope_type, scope_id)` with `(organisation_id, scope_type, scope_id)` so the uniqueness invariant holds formally per-org. UUID collision across orgs is improbable but the index semantically belongs org-scoped.

**Approach.**
1. **Up migration** (`0240_conversations_org_scoped_unique.sql`):
   ```sql
   -- 0240_conversations_org_scoped_unique.sql
   --
   -- Re-scope the conversations uniqueness index to (organisation_id, scope_type, scope_id).
   -- The original index (from migration 0194) was (scope_type, scope_id) and assumes UUIDs
   -- are globally unique. UUIDs are practically unique but the index semantically belongs
   -- org-scoped — see tasks/todo.md § N3 for context.
   --
   -- Idempotent: DROP INDEX IF EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS.
   --
   -- This change is safe to apply with no data backfill: the existing index already
   -- enforces (scope_type, scope_id) uniqueness, which is a strict subset of the new
   -- (organisation_id, scope_type, scope_id) uniqueness. Every existing row already
   -- satisfies the new index.

   DROP INDEX IF EXISTS conversations_unique_scope;
   CREATE UNIQUE INDEX IF NOT EXISTS conversations_unique_scope
     ON conversations (organisation_id, scope_type, scope_id);
   ```
2. **Down migration** (`0240_conversations_org_scoped_unique.down.sql`):
   ```sql
   -- 0240_conversations_org_scoped_unique.down.sql

   DROP INDEX IF EXISTS conversations_unique_scope;
   CREATE UNIQUE INDEX IF NOT EXISTS conversations_unique_scope
     ON conversations (scope_type, scope_id);
   ```
3. **Drizzle schema sync.** In `server/db/schema/conversations.ts`, update the index declaration to match. Pattern (locate the existing `uniqueIndex('conversations_unique_scope')` call):
   ```ts
   uniqueScopeIdx: uniqueIndex('conversations_unique_scope').on(
     table.organisationId, table.scopeType, table.scopeId
   ),
   ```
4. **No data migration required.** The new index is strictly more permissive than the old one for existing rows (every `(scope_type, scope_id)` pair is still unique under `(organisation_id, scope_type, scope_id)`).

**Acceptance criteria.**
- `npm run migrate` applies 0240 cleanly on a fresh DB and on a DB that already has the old index.
- `npm run db:generate` produces no diff after the schema edit (schema matches the applied DB state).
- `\d+ conversations` in psql shows exactly one `conversations_unique_scope` index, with the new column ordering `(organisation_id, scope_type, scope_id)`.
- Inserting two `conversations` rows in different orgs with identical `(scope_type, scope_id)` succeeds (previously would have failed under the old index).
- Inserting two `conversations` rows in the same org with identical `(scope_type, scope_id)` fails with a unique-constraint error (the invariant the index is meant to enforce).

**Tests.**
- No new unit tests required (the index is structural; behaviour is verified by the acceptance criteria via psql).
- The existing `briefMessageHandlerPure.test.ts` suite must still pass — it does not depend on the index but exercises the writer paths that produce conversations.

**Dependencies.** None; this is a self-contained schema fix.

**Risk.** Very low. Index swap is online-safe in PostgreSQL on a small table. `conversations` is bounded by user activity volume; rebuild time is negligible.

**Definition of Done.** Migration applies cleanly; Drizzle schema regenerates with no diff; `tasks/todo.md § N3` ticked off.

---

### §1.5 S2 — `PULSE_CURSOR_SECRET` one-shot fallback warning

**Source.** `tasks/todo.md` § "Deferred from pr-reviewer review — clientpulse-ui-simplification (2026-04-24)" → S2.

**Files.**
- `server/services/clientPulseHighRiskService.ts` — `getCursorSecret(orgId)` function at line ~158-170.

**Goal.** When `PULSE_CURSOR_SECRET` is unset, log the fallback warning exactly once per process lifetime instead of every request. Saturating logs during testing makes the warning useless and crowds out higher-signal entries.

**Approach.**
1. Add a module-level boolean flag `let cursorSecretFallbackWarned = false;` at the top of `clientPulseHighRiskService.ts` (below imports, above the first function).
2. In `getCursorSecret`, replace the per-call `console.warn` with:
   ```ts
   if (!cursorSecretFallbackWarned) {
     cursorSecretFallbackWarned = true;
     logger.warn('clientpulse_cursor_secret_fallback', {
       message: 'PULSE_CURSOR_SECRET is not set — using per-org fallback seed. Set PULSE_CURSOR_SECRET in production.',
       firstObservedAt: new Date().toISOString(),
     });
   }
   ```
3. **Use `logger`, not `console.warn`.** Match the codebase convention — `logger` is the structured-log primitive used elsewhere (e.g. `incidentIngestor.ts`, `derivedDataMissingLog.ts`). Do not introduce a parallel console-logging path.
4. **No reset for tests.** No `_resetForTesting` export needed — the warning is informational and a stale flag does not affect test correctness. If a future test needs to assert "first call warns", it can reload the module via `vi.resetModules()` / Node's module-cache reset; do not pollute the production export surface.

**Acceptance criteria.**
- Server boots, makes 1000 `/api/clientpulse/high-risk` requests with `PULSE_CURSOR_SECRET` unset → exactly one `clientpulse_cursor_secret_fallback` log entry appears.
- Same scenario with `PULSE_CURSOR_SECRET` set → zero log entries.
- The fallback secret is still computed and returned (existing behaviour preserved — only the log frequency changes).

**Tests.**
- No new test required (single-warn-per-process is structurally enforced by the module-level flag and verified manually by re-reading the logger-call site).
- Optional: extend an existing test for `clientPulseHighRiskService` with a sanity check that `getCursorSecret(orgId)` returns the same value on repeat calls.

**Dependencies.** `logger` import (already present in many sibling services; verify the file's import block). If `logger` is not yet imported in this file, add `import { logger } from '../lib/logger.js';` (the canonical path).

**Risk.** Very low. One-line behavioural change; no contract impact.

**Definition of Done.** Manual verification of the log-frequency drop; `tasks/todo.md § S2` ticked off.

---

### §1.6 N1 — `artefactId` UUID-shape validation

**Source.** `tasks/todo.md` § "Deferred from pr-reviewer review — Universal Brief" → N1.

**Files.**
- `server/services/briefArtefactValidatorPure.ts` — `validateBase` (line 146) and the existing `requireString` helper (line 82).
- `server/services/__tests__/briefArtefactValidatorPure.test.ts` (existing — extend with new cases).

**Goal.** `validateBase` currently calls `requireString(errors, 'artefactId', obj['artefactId'])`, which accepts the empty string `''` and any non-UUID string. Add a UUID-shape regex check so malformed artefact IDs are rejected at the validation boundary instead of producing cryptic downstream errors.

**Approach.**
1. **New helper `requireUuid(errors, fieldName, value)`** in the same module, modelled after `requireString`:
   ```ts
   const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

   function requireUuid(
     errors: ValidationError[],
     fieldName: string,
     value: unknown,
   ): void {
     if (typeof value !== 'string' || value.length === 0) {
       errors.push({ field: fieldName, message: `${fieldName} is required and must be a string` });
       return;
     }
     if (!UUID_REGEX.test(value)) {
       errors.push({ field: fieldName, message: `${fieldName} must be a UUID` });
     }
   }
   ```
   The function reuses the existing `ValidationError[]` accumulator pattern to match `requireString`'s shape.
2. **Call site swap.** Replace `requireString(errors, 'artefactId', obj['artefactId']);` in `validateBase` (line 147) with `requireUuid(errors, 'artefactId', obj['artefactId']);`. Leave all other `requireString` calls unchanged — the spec is artefactId-specific per the deferred note.
3. **Regex choice.** The pattern accepts any UUID v1–v8 (or arbitrary hex with the canonical hyphenation). This matches `crypto.randomUUID()` output (v4) without rejecting future variants. **Do not** tighten to v4-only — the codebase has no contract requiring v4 specifically.

**Acceptance criteria.**
- `validateBase({ artefactId: '' })` produces a validation error.
- `validateBase({ artefactId: 'not-a-uuid' })` produces a validation error.
- `validateBase({ artefactId: '01234567-89ab-cdef-0123-456789abcdef' })` does not produce a validation error for the artefactId field.
- `validateBase({ artefactId: '01234567-89AB-CDEF-0123-456789ABCDEF' })` (uppercase) does not produce a validation error (case-insensitive regex).
- All existing tests in `briefArtefactValidatorPure.test.ts` still pass.

**Tests.**
- Extend `briefArtefactValidatorPure.test.ts` with three new cases:
  1. Empty string artefactId → error containing "required".
  2. Non-UUID string artefactId (`'banana'`) → error containing "UUID".
  3. Valid UUID artefactId → no error on the artefactId field.

**Dependencies.** None.

**Risk.** Very low. Tightens an under-validated input boundary; no callers should be sending malformed UUIDs in production code.

**Definition of Done.** Tests pass; `tasks/todo.md § N1` ticked off.

---

### §1.7 #5 — Wire `incidentIngestorThrottle` into `incidentIngestor`

**Source.** `tasks/todo.md` § "Deferred from chatgpt-pr-review — PR #188 (2026-04-25)" → finding #5.

**Files.**
- `server/services/incidentIngestor.ts` — add the `checkThrottle` call at the top of the ingestion entry point.
- `server/services/incidentIngestorThrottle.ts` (existing — `checkThrottle(fingerprint)` and counters already exported; consumer-only).
- `server/services/__tests__/incidentIngestorThrottle.integration.test.ts` (NEW — verifies the wired-in behaviour at the ingestor boundary, NOT the throttle helper itself which is already unit-tested).

**Goal.** Tight-loop failure scenarios in the system can call `recordIncident` thousands of times per second on the same fingerprint. The DB upsert dedupes on fingerprint, but the throttle's job is to short-circuit BEFORE the DB call — preventing the DB from taking the hit at all. The `incidentIngestorThrottle.ts` module exists and is fully tested, but is not wired into the ingestor.

**Approach.**
1. **Identify the canonical entry point.** `incidentIngestor.ts` exposes `ingestInline(input)` (and possibly an async-worker variant). Wire the throttle into `ingestInline` only — the async-worker path enqueues onto pg-boss which has its own backpressure, and double-throttling there is wasted work.
2. **Call site.** At the top of `ingestInline`, after fingerprint computation but before the DB upsert (or however early the fingerprint is available — read the file and place the call as the first DB-bypassing branch):
   ```ts
   if (checkThrottle(fingerprint)) {
     logger.debug('incident_ingest_throttled', { fingerprint, reason: 'fingerprint_lastSeen_within_1s' });
     return { status: 'throttled', fingerprint };
   }
   ```
3. **Return-shape extension.** The current `ingestInline` return shape needs a `'throttled'` status discriminant. Match the existing discriminated-union style in the file (the spec previously documented `idempotent_race`, `suppressed`, etc. as similar success-not-failure outcomes per the "suppression is success" pattern from PR #218). DO NOT return `success: false` for a throttled call — that would trigger retries from callers.
4. **No new throttle config.** The 1-second window is hard-coded inside `incidentIngestorThrottle.ts` per its existing implementation. Do not add config knobs in this spec — if testing shows the window is wrong, surface a follow-up.
5. **Counter visibility.** `incidentIngestorThrottle.ts` already exposes `getThrottledCount()`. No new counter wiring required; the existing badge / metrics endpoint can read it when surfaced.

**Acceptance criteria.**
- Calling `ingestInline` 1000 times for the same fingerprint within 1 second results in: 1 DB upsert (the first), 999 throttled returns, `getThrottledCount()` increases by 999.
- Calling `ingestInline` for two different fingerprints within 1 second produces 2 DB upserts (no cross-fingerprint blocking).
- Calling `ingestInline` for the same fingerprint with >1 second gap produces 2 DB upserts.
- Throttled returns carry `status: 'throttled'`, NOT `success: false`.
- Existing async-worker path is unchanged (no throttle call there).

**Tests.**
- `server/services/__tests__/incidentIngestorThrottle.integration.test.ts` — three cases:
  1. **Burst dedup:** 1000 sequential `ingestInline(sameFingerprint)` calls with mocked DB upsert; assert 1 DB call, 999 throttled returns.
  2. **Cross-fingerprint independence:** 100 calls each for fingerprints A and B; assert 200 DB calls total.
  3. **Throttle window expiry:** call once, advance fake clock past 1 second, call again; assert 2 DB calls.
- The throttle module's existing unit tests (`incidentIngestorThrottle.test.ts`) cover the underlying `checkThrottle` semantics; this integration test verifies the WIRING into the ingestor.

**Dependencies.** None.

**Risk.** Low. The throttle module is well-tested; this spec only wires it in.

**Definition of Done.** Acceptance criteria pass; integration test added and green; `tasks/todo.md § PR #188 finding #5` ticked off.

---

### §1.8 S6 — Idempotent approve/reject race tests for `reviewService`

**Source.** `tasks/todo.md` § "Deferred from pr-reviewer review — clientpulse-ui-simplification (2026-04-24)" → S6.

**Files.**
- `server/services/__tests__/reviewServiceIdempotency.test.ts` (NEW).
- `server/services/reviewService.ts` (read-only — exercise the existing `approve` / `reject` paths at lines 83-183 and 274-395; do NOT modify the service).

**Goal.** The `idempotent_race` branch of `reviewService.approve` / `reviewService.reject` is documented in spec §6.2.1 GWTs but has no runtime test. A real testing round will exercise concurrent approval scenarios (two browser tabs, double-click, retry-on-network-blip); without coverage, regressions in the race path land silently. This item adds the test coverage; no production code changes.

**Approach.**
1. **Test scaffolding.** Use the existing carved-out integration-test pattern (`runtime_tests: pure_function_only` is the default; concurrency-control hot paths are explicitly exempted per `docs/spec-context.md`). Test runs against a real DB connection (the dev/test Postgres) with a per-test transaction-rollback wrapper to keep it isolated.
2. **Three test cases.**
   - **Concurrent double-approve:** create one `pending` review item; fire two `approve(itemId)` calls in parallel via `Promise.all`; assert exactly one returns `proceed` (the winner) and the other returns `idempotent_race` (the loser). Both calls return `success: true` per the "suppression is success" invariant. Verify exactly one row in the audit table.
   - **Concurrent double-reject:** same shape with `reject(itemId)`; assert one `proceed` + one `idempotent_race` + one audit row.
   - **Concurrent approve+reject:** fire one `approve` and one `reject` in parallel on a `pending` item; assert one wins (status reflects the winner), the other returns `409 ITEM_CONFLICT` (this is the existing "approve-after-rejected / reject-after-approved" branch — different from `idempotent_race`).
3. **Use existing test utilities.** `server/services/__tests__/` already has integration-test patterns (e.g. `incidentIngestorThrottle.integration.test.ts` planned in §1.7, `derivedDataMissingLog.test.ts`). Match those conventions: `node:test` + `node:assert`, no new harness.
4. **Concurrency primitive.** `Promise.all([approve(id), approve(id)])` against a real DB exercises the actual claim+verify race. If the test proves flaky on slow CI, a fallback is the existing `__testHooks` seam pattern from `ruleAutoDeprecateJob.ts:86` — inject a synchronous pause between claim and commit so the test deterministically exposes the race window. **Prefer the natural concurrency approach first**; only introduce the test hook if flakiness materialises.

**Acceptance criteria.**
- Test file exists, compiles, and all three cases pass.
- Each test creates and tears down its own review item (no test pollution).
- The `idempotent_race` discriminant value is asserted by name; the test fails noisily if `reviewService` ever changes that string.
- Audit table assertions confirm exactly one audit row per resolved item, regardless of how many concurrent attempts ran.

**Tests.** This entire item IS the test addition. No further tests needed.

**Dependencies.** `reviewService.approve` / `.reject` exist with the documented `idempotent_race` branch. Verified (see `server/services/__tests__/reviewServicePure.test.ts` which references the contract).

**Risk.** Very low. Pure test addition; no production code change.

**Definition of Done.** All three cases pass on first run AND after 5 reruns (no flakiness); `tasks/todo.md § S6` ticked off.

---

## §2 Sequencing

The eight items are largely independent but a recommended order minimises rework:

1. **§1.4 N3** (migration) — apply first. Cheapest, lowest risk, isolates the schema change from any later branch-state churn.
2. **§1.5 S2 + §1.6 N1 + §1.7 #5** (small fixes) — bundle into one commit each or one PR. All under 30 min effort.
3. **§1.2 REQ W1-44** (pre-dispatch connection resolution) — surgical addition to `invokeAutomationStepService`. Lands the new pure helper + its tests.
4. **§1.3 Codex iter 2 #4** (supervised dispatch) — depends on §1.2 only insofar as it gives the approval-resume path the new `automation_missing_connection` behaviour for free. If §1.2 hasn't shipped, §1.3 still works correctly; the missing-connection check just doesn't fire on the resume path until §1.2 lands.
5. **§1.1 LAEL-P1-1** (LLM emission + payload writer) — biggest item; ship last so the test infrastructure for the carved-out integration test is in place after the smaller items have proven the pattern.
6. **§1.8 S6** (idempotent race tests) — pure test addition; can run in parallel with any of the above. Recommended last so the test suite has the most-recent service behaviour to assert against.

**Branch.** Single feature branch (suggested name `claude/pre-test-backend-hardening`). Each §1.x ships as its own commit so review can proceed item-by-item. Final PR consolidates all eight commits.

**Pre-merge gates.**
- `npx tsc --noEmit` passes.
- `bash scripts/run-all-unit-tests.sh` passes.
- `npm run migrate` applies cleanly on a fresh DB.
- The carved-out integration tests in §1.1 / §1.7 / §1.8 pass.
- Manual smoke for §1.1 (tx rollback) and §1.3 (webhook fires on approval) completed.
- `npm run test:gates` is the merge-gate per the gate-cadence rule in CLAUDE.md — run only at PR-finalisation time.

---

## §3 Out of scope

Items deliberately excluded from this spec; route to follow-up work or separate specs as noted.

- **REQ #WB-1 — `agent_runs.handoff_source_run_id` never written.** Architectural; cross-cuts `parentRunId` semantics across multiple consumers. Defer to a dedicated delegation-graph hardening spec.
- **CHATGPT-PR211-F2b — write-side cached-context isolation enforcement.** Security posture upgrade; the existing logger already provides visibility during testing. Defer to a dedicated cached-context spec.
- **B2 / B2-ext — job idempotency standard.** Codebase-wide sweep; out of scope for a pre-test stabilisation pass.
- **REQ #43 — server cycle count ≤ 5.** Quality of life, not testing-blocking.
- **CHATGPT-PR211-F6 — extend `assertValidTransition` to remaining sites.** Defence-in-depth completion; not testing-blocking.
- **#R3.1 — service-layer `assertSystemAdminContext(ctx)`.** Cross-cutting principal-context model; routed to Phase 2 system-principal work per the original deferral.
- **All remaining LAEL items (P1-2, P2, P3, FUTURE-1..6).** This spec ships only LAEL-P1-1 (the most operationally valuable). Other LAEL items remain in `tasks/todo.md` for separate decisions.
- **Engine-not-found error code reconciliation (REQ W1-38).** Spec edit + code change; route to `spec-reviewer` per the original deferral.
- **Spec edits to `docs/riley-observations-dev-spec.md` or related specs.** This spec's scope is implementation only; spec edits go through `chatgpt-spec-review` separately.
- **Any item outside the explicit §1 list.** Per §0.3, scope expansion during implementation is forbidden — log to `tasks/todo.md` and continue.

---

## §4 Definition of Done

The spec is complete when ALL of the following hold:

1. Each §1.x item's per-item Definition of Done is met.
2. `tasks/todo.md` reflects every closed item with a `[x]` mark and a one-line resolution note pointing at the commit SHA or PR number.
3. The branch passes the §2 pre-merge gates.
4. The PR description summarises which items shipped and links to the relevant `tasks/todo.md` lines.
5. `tasks/builds/<slug>/progress.md` carries the final session-end summary.
6. `KNOWLEDGE.md` is updated with any non-obvious patterns surfaced by §1.1, §1.3, or §1.8 (the three architectural / integration-test items).

---

## §5 Tracking

Per-item status table — single source of truth. Update after each commit.

| Item | Status | Commit SHA | Notes |
|------|--------|------------|-------|
| §1.1 LAEL-P1-1 | pending | — | — |
| §1.2 REQ W1-44 | pending | — | — |
| §1.3 Codex iter 2 #4 | pending | — | — |
| §1.4 N3 | pending | — | — |
| §1.5 S2 | pending | — | — |
| §1.6 N1 | pending | — | — |
| §1.7 #5 | pending | — | — |
| §1.8 S6 | pending | — | — |

**Backlog tickoff checklist** — when each item closes, mark the corresponding line in `tasks/todo.md`:

- [ ] LAEL-P1-1 in `tasks/todo.md § Live Agent Execution Log — deferred items`
- [ ] REQ W1-44 in `tasks/todo.md § Deferred from spec-conformance review — riley-observations wave 1`
- [ ] Codex iter 2 finding #4 in `tasks/todo.md § Deferred from dual-reviewer review — riley-observations`
- [ ] N3 in `tasks/todo.md § Deferred from pr-reviewer review — Universal Brief`
- [ ] S2 in `tasks/todo.md § Deferred from pr-reviewer review — clientpulse-ui-simplification`
- [ ] N1 in `tasks/todo.md § Deferred from pr-reviewer review — Universal Brief`
- [ ] PR #188 finding #5 in `tasks/todo.md § Deferred from chatgpt-pr-review — PR #188`
- [ ] S6 in `tasks/todo.md § Deferred from pr-reviewer review — clientpulse-ui-simplification`


