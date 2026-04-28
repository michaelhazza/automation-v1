# Pre-Test Backend Hardening — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-04-28-pre-test-backend-hardening-spec.md`
**Build slug:** `pre-test-backend-hardening`
**Branch:** `claude/pre-test-backend-hardening` (cut from `origin/main`)
**Pair spec (concurrent, separate branch):** `docs/superpowers/specs/2026-04-28-pre-test-brief-and-ux-spec.md`
**Classification:** Major (8 items, 3 architectural, multiple service domains)
**Plan author:** architect agent
**Plan date:** 2026-04-28

---

## Contents

- Frame of mind for the executor
- Architecture notes
- File inventory
- Contracts (cross-cutting)
- Sequencing — chunk graph
- Phase 0 — Baseline gate run
- Chunk 1 — §1.4 N3: org-scoped `conversations_unique_scope` index
- Chunk 2 — §1.5 S2: `PULSE_CURSOR_SECRET` one-shot fallback warning
- Chunk 3 — §1.6 N1: `artefactId` UUID-shape validation
- Chunk 4 — §1.7 #5: wire `incidentIngestorThrottle` into `incidentIngestor`
- Chunk 5 — §1.2 REQ W1-44: pre-dispatch connection resolution
- Chunk 6 — §1.3 Codex iter 2 #4: supervised `invoke_automation` dispatch on approval
- Chunk 7 — §1.1 LAEL-P1-1: `llm.requested` / `llm.completed` emission + payload writer
- Chunk 8 — §1.8 S6: idempotent approve/reject race tests for `reviewService`
- Risks & mitigations
- Programme-end verification
- Executor notes
- Definition of Done (programme level)

---

## Frame of mind for the executor

The spec is closed and declarative. Every contract is named, every failure mode is named, every MUST is a contract not a recommendation. The architect's job here was decomposition, dependency wiring, and executor guardrails — NOT design. If you find yourself making a design judgment the spec doesn't address, that signals the spec is wrong; flag it for the user rather than infer.

You will execute eight chunks, one per spec item, in the strict order specified in §2 below. Chunks 1.4, 1.5, 1.6, 1.7 are mechanical. Chunks 1.2 and 1.3 are surgical and carry a hard `1.2 → 1.3` forward dependency. Chunk 1.1 is the largest (terminal-tx integration + observability emission). Chunk 1.8 is pure test addition.

No chunk may expand its scope. If implementation surfaces a need for a primitive not named in the chunk's `Files` list, **stop, log to `tasks/todo.md`, and ship the chunk against its stated scope only** (spec §0.3).

---

## Architecture notes

### 1. No new primitives beyond those named in the spec

Per spec §0.3, each chunk's primitive count is fixed:

| Chunk | New primitive(s) introduced | Justification |
|---|---|---|
| 1.1 | NONE | `llmInflightRegistry`, `agentRunPayloadWriter.buildPayloadRow`, `agentExecutionEventEmitter.tryEmitAgentEvent`, the migration-0192 denormalised FK, and the existing terminal-tx pattern in `llmRouter` already exist. The chunk threads existing primitives. |
| 1.2 | exactly one pure helper `resolveRequiredConnections` | Step-type-aware decision is small enough to inline but isolating it as a pure function makes it exhaustively testable without hitting the dispatcher. |
| 1.3 | exactly one pure helper `resolveApprovalDispatchAction` | Same justification — step-type branching as a pure predicate is testable in isolation. |
| 1.4 | one migration `0240_conversations_org_scoped_unique` (and its `.down.sql`) | Schema fix; no helper required. |
| 1.5 | NONE | Module-level boolean flag is an inline state change, not a primitive. |
| 1.6 | one local helper `requireUuid` inside `briefArtefactValidatorPure.ts` | Mirrors the existing `requireString` shape in the same file; **not** promoted to a shared helper (spec §1.6 Consistency forward-look). |
| 1.7 | NONE | Wires existing `checkThrottle` into existing `ingestInline`. |
| 1.8 | NONE | Pure test addition; no production code change. |

**Rule for the executor:** if a chunk's implementation surfaces a need for a helper not in the table above, STOP. Log to `tasks/todo.md` and ship only what the spec names.

### 2. Why no design decisions live in this plan

The spec carries every design decision: ordering invariants in §1.1, retry-state continuation in §1.3, time-source contract in §1.7, async-worker exclusion in §1.7, hook-presence contract in §1.8, idempotency contract in §1.3 step 4, etc. The plan's only job is to surface those MUSTs verbatim in each chunk's Approach section so the executor cannot miss them.

### 3. Pattern selections

- **Single responsibility** — each new helper has one job (`resolveRequiredConnections`, `resolveApprovalDispatchAction`, `requireUuid`). No helper takes more than the inputs the spec names.
- **Composition over inheritance** — chunks 1.2 and 1.3 add a pure predicate consumed inline by the dispatcher / approval handler. No new abstractions.
- **Explicit consistency contracts** — chunk 1.1 makes the ledger-canonical / payload-best-effort split visible via `payloadInsertStatus` on the `llm.completed` event. This is the spec's contract, not the architect's choice.

No other patterns apply. Most chunks are mechanical wiring.

---

## File inventory

Every file this plan touches, mapped to the chunk that touches it. **The pair-spec column files are forbidden territory for this branch** — every edit must stay inside the "This spec" column of the spec's §0.4 matrix.

### Files this plan modifies

| File | Chunk | Operation |
|---|---|---|
| `server/services/llmRouter.ts` | 1.1 | MODIFY — emission call sites + payload-row insertion at TODO scaffold near line 845 |
| `server/services/agentRunPayloadWriter.ts` | 1.1 | READ-ONLY consumer (`buildPayloadRow` already exported) |
| `server/services/agentExecutionEventEmitter.ts` | 1.1 | READ-ONLY consumer (`tryEmitAgentEvent` already exported) |
| `server/db/schema/agentRunLlmPayloads.ts` | 1.1 | READ-ONLY (existing schema; `runId` already denormalised in migration 0192) |
| `server/services/__tests__/llmRouterPayloadEmissionPure.test.ts` | 1.1 | NEW — pure test for `shouldEmitLaelLifecycle` |
| `server/services/__tests__/llmRouterLaelIntegration.test.ts` | 1.1 | NEW — carved-out integration test |
| `server/services/invokeAutomationStepService.ts` | 1.2 | MODIFY — pre-dispatch resolver call before `assertSingleWebhook` near line 188 |
| `server/services/automationConnectionMappingService.ts` | 1.2 | READ-ONLY consumer (`listMappings` already exported) |
| `server/services/__tests__/resolveRequiredConnectionsPure.test.ts` | 1.2 | NEW — pure tests for the resolver |
| `server/services/workflowEngineService.ts` | 1.3 | MODIFY — expose `dispatchInvokeAutomationInternal` so the approval handler can re-enter it (or call directly if already exported) |
| `server/services/workflowRunService.ts` | 1.3 | MODIFY — `decideApproval` step-type branch using `resolveApprovalDispatchAction` |
| `server/services/__tests__/decideApprovalStepTypePure.test.ts` | 1.3 | NEW — pure test for the predicate |
| `server/services/__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts` | 1.3 | NEW — carved-out integration test |
| `migrations/0240_conversations_org_scoped_unique.sql` | 1.4 | NEW |
| `migrations/0240_conversations_org_scoped_unique.down.sql` | 1.4 | NEW |
| `server/db/schema/conversations.ts` | 1.4 | MODIFY — index columns at line 27 |
| `server/services/clientPulseHighRiskService.ts` | 1.5 | MODIFY — `getCursorSecret` near lines 158-170 |
| `server/services/briefArtefactValidatorPure.ts` | 1.6 | MODIFY — add `requireUuid` helper, swap call site in `validateBase` near line 147 |
| `server/services/__tests__/briefArtefactValidatorPure.test.ts` | 1.6 | MODIFY — extend with three new cases |
| `server/services/incidentIngestor.ts` | 1.7 | MODIFY — wire `checkThrottle` into `ingestInline` |
| `server/services/__tests__/incidentIngestorThrottle.integration.test.ts` | 1.7 | NEW — carved-out integration test |
| `server/services/__tests__/reviewServiceIdempotency.test.ts` | 1.8 | NEW — carved-out integration test |
| `server/services/reviewService.ts` | 1.8 | READ-ONLY (exercise existing approve/reject paths near lines 83-183 and 274-395; **DO NOT modify the service**) |
| `tasks/todo.md` | per chunk | MODIFY — tick off the corresponding deferred-item line as each chunk lands |
| `tasks/builds/pre-test-backend-hardening/progress.md` | per chunk | UPDATE — append session-end notes after each chunk |

### Files this branch MUST NOT edit (pair-spec territory)

These appear in the pair spec's §0.4 column. Any edit on this branch is a coordination violation:

- `server/routes/conversations.ts` — DR2 (pair spec §1.1)
- `server/services/briefConversationWriter.ts` — S8 (pair spec §1.2)
- `server/services/briefConversationService.ts` — DR2 (pair spec §1.1)
- `server/lib/postCommitEmitter.ts` — S8 (NEW in pair spec §1.2)
- `server/middleware/postCommitEmitter.ts` — S8 (NEW in pair spec §1.2)
- `server/index.ts` — S8 (one-line registration in pair spec §1.2)
- `server/routes/briefs.ts` — N7 (pair spec §1.3)
- `server/services/briefCreationService.ts` — N7 (pair spec §1.3)
- `client/src/pages/BriefDetailPage.tsx` — N7 (pair spec §1.3)
- `client/src/pages/DashboardPage.tsx` — S3 (pair spec §1.4)
- `client/src/pages/ClientPulseDashboardPage.tsx` — S3 (pair spec §1.4)

If a chunk surfaces an apparent need to edit one of these files, **STOP** and consult the user — that's a cross-spec coordination question, not an in-spec scope question.

### Migration slot reservation

- **Migration `0240`** is reserved for chunk 1.4 by this spec. The pair spec reserves zero migration slots. The current migration head is `0239` (verified: `migrations/0239_system_incidents_last_triage_job_id.sql`). If any chunk in this plan surfaces a need for a second migration, it MUST claim `0241` and update the §0.4 matrix in writing before allocating.

---

## Contracts (cross-cutting, drawn verbatim from the spec)

### `shouldEmitLaelLifecycle` (chunk 1.1, pure)

```ts
function shouldEmitLaelLifecycle(ctx, terminalStatus): boolean
// returns true iff
//   ctx.sourceType === 'agent_run'
//   && ctx.runId
//   && terminalStatus !== 'budget_blocked'
//   && terminalStatus !== 'rate_limited'
//   && terminalStatus !== 'provider_not_configured'
```

### `llm.requested` event payload (chunk 1.1)

```ts
{
  runId: ctx.runId,
  organisationId: ctx.organisationId,
  subaccountId: ctx.subaccountId ?? null,
  eventType: 'llm.requested',
  tier: 'critical',
  payload: { provider, model, ledgerRowId, callSite: ctx.callSite },
  linkedEntity: { kind: 'llm_request', id: ledgerRowId },
}
```

### `llm.completed` event payload (chunk 1.1)

```ts
{
  eventType: 'llm.completed',
  tier: 'critical',
  payload: {
    ledgerRowId,
    terminalStatus,
    latencyMs,
    costCents,
    tokensIn,
    tokensOut,
    payloadRowId,
    payloadInsertStatus: 'ok' | 'failed',
  },
}
```

`payloadInsertStatus === 'ok'` ↔ payload row visible post-commit; `payloadInsertStatus === 'failed'` ↔ no `agent_run_llm_payloads` row visible post-commit for that `(run_id, ledgerRowId)` pair.

### `resolveRequiredConnections` (chunk 1.2, pure)

```ts
type ResolutionResult =
  | { ok: true; resolved: Record<string, string> }
  | { ok: false; missing: string[] };

function resolveRequiredConnections(args: {
  automation: { requiredConnections: string[] | null },
  subaccountId: string,
  mappings: Array<{ connectionKey: string; connectionId: string }>,
}): ResolutionResult;
```

When `ok: false`, `missing` is in the order keys appear in `automation.requiredConnections` (spec §1.2 Output-ordering contract).

### `AutomationStepError` shape on missing connection (chunk 1.2)

```ts
{
  code: 'automation_missing_connection',
  type: 'configuration',
  status: 'missing_connection',
  message: `Automation '${automation.id}' is missing required connections: ${result.missing.join(', ')}`,
  context: { automationId: automation.id, missingKeys: result.missing },
}
```

### `resolveApprovalDispatchAction` (chunk 1.3, pure)

```ts
function resolveApprovalDispatchAction(
  stepRun: { stepKind: 'invoke_automation' | 'agent_call' | 'prompt' | 'action_call' },
  decision: 'approve' | 'reject',
): 'complete_with_existing_output' | 'redispatch';
// reject → 'complete_with_existing_output'
// approve & invoke_automation → 'redispatch'
// approve & {agent_call, prompt, action_call} → 'complete_with_existing_output'
```

### `dispatchInvokeAutomationInternal` re-entry signature (chunk 1.3)

```ts
await dispatchInvokeAutomationInternal({
  runId,
  stepRun,
  automationId: stepRun.stepDefinition.automationId,
  fromApprovalResume: true,  // tracing flag — emits dispatch_source: 'approval_resume'
});
```

### `requireUuid` (chunk 1.6, pure helper inside `briefArtefactValidatorPure.ts`)

```ts
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(
  errors: ValidationError[],
  fieldName: string,
  value: unknown,
): void;
// '' → error 'is required'; non-string → error 'is required'; non-UUID-shape → error 'must be a UUID'.
```

### `ingestInline` throttled return shape (chunk 1.7)

```ts
{ status: 'throttled', fingerprint }
// NOT success: false — throttled is a success-not-failure outcome under the
// "suppression is success" pattern (spec §1.7 Approach step 3).
```

---

## Sequencing — chunk graph

The spec's §2 lists the recommended order. This plan binds that order, with one MUST in the dependency edges:

```
Phase 0 — Baseline
   |
   v
Chunk 1 (§1.4 N3 — migration)                      [no upstream]
   |
   v
Chunk 2 (§1.5 S2 — one-shot warning)  ─┐
Chunk 3 (§1.6 N1 — UUID validator)    ─┼─ small fixes; can be sequenced in any order amongst themselves
Chunk 4 (§1.7 #5 — throttle wiring)   ─┘
   |
   v
Chunk 5 (§1.2 REQ W1-44 — pre-dispatch connection resolution)
   |
   |    (HARD ORDERING — MUST land before Chunk 6; see Why box below)
   v
Chunk 6 (§1.3 Codex iter 2 #4 — supervised dispatch)
   |
   v
Chunk 7 (§1.1 LAEL-P1-1 — emission + payload writer)
   |
   v
Chunk 8 (§1.8 S6 — idempotency race tests)
   |
   v
spec-conformance × 8 → pr-reviewer × 8 → §4 happy-path sweep → final gate pass at PR-finalisation
```

**Why Chunk 5 → Chunk 6 (i.e. §1.2 → §1.3) is a MUST, not a recommendation.** The approval-resume path in chunk 6 re-enters the same dispatcher hardened in chunk 5. Landing chunk 6 first means the resume path lacks the `automation_missing_connection` guard during testing. Symptom: a webhook fires against an automation with missing connections, fails downstream with a confusing error, and the bug looks like an approval-resume bug when it is actually a missing-connection bug. The same surface gets debugged twice. **Order is enforced.** The executor's chunk-completion flow MUST refuse to start chunk 6 until chunk 5 is committed and verified.

The other edges (Chunk 1 first, then small fixes, then Chunks 5 and 6, then Chunk 7, then Chunk 8) follow §2's recommendation but are not MUSTs — they minimise rework but shipping any of them out of order would not produce double-debugging, only minor rebase friction.

---

## Phase 0 — Baseline gate run

**Run before Chunk 1 begins.** Single pass. Captures the violation set inherited from `origin/main`. The branch is freshly cut, so violations are expected to be near-zero, but capturing the baseline gives the final pass a reference.

Commands:

```bash
npx tsc --noEmit
bash scripts/run-all-unit-tests.sh
```

If either reports a failure, capture the output verbatim into `tasks/builds/pre-test-backend-hardening/progress.md` under a `## Phase 0 baseline` heading. Pre-existing failures that would block or interact with the planned work go into a separate "Pre-existing baseline fixes" chunk inserted before Chunk 1 — but on a clean cut from `origin/main` no such chunk is anticipated. Pre-existing failures unrelated to the planned work go into a "Known baseline violations" note in `progress.md` and are ignored for the rest of the build.

**Phase 0 is the first of TWO gate runs in this plan. The second is the final pass at programme end.**

---

## Chunk 1 — §1.4 N3: org-scoped `conversations_unique_scope` index

**Scope.** Replace the existing `conversations_unique_scope` index `(scope_type, scope_id)` with `(organisation_id, scope_type, scope_id)` so the uniqueness invariant holds formally per-org. Spec §1.4.

**Files to create or modify.**
- CREATE `migrations/0240_conversations_org_scoped_unique.sql` (verbatim from spec §1.4 Approach step 1)
- CREATE `migrations/0240_conversations_org_scoped_unique.down.sql` (verbatim from spec §1.4 Approach step 2)
- MODIFY `server/db/schema/conversations.ts` line 27 — change `uniqueScopePerEntity: uniqueIndex('conversations_unique_scope').on(table.scopeType, table.scopeId)` to `.on(table.organisationId, table.scopeType, table.scopeId)`.

**Contracts.** Migration up = `DROP INDEX IF EXISTS … CREATE UNIQUE INDEX IF NOT EXISTS … ON conversations (organisation_id, scope_type, scope_id)`. Down inverts.

**Approach (spec MUSTs verbatim).**
- "The new index is strictly more permissive than the old one for existing rows (every `(scope_type, scope_id)` pair is still unique under `(organisation_id, scope_type, scope_id)`)." → no data backfill.
- Concurrency window note from spec §1.4: the `DROP INDEX … CREATE UNIQUE INDEX …` pair is NOT wrapped in `CONCURRENTLY`; acceptable because pre-production with bounded `conversations` write volume.
- Idempotent: `DROP INDEX IF EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS`.

**Tests.** No new unit tests required (spec §1.4 Tests). Existing `briefMessageHandlerPure.test.ts` must still pass — it does not depend on the index but exercises the writer paths that produce conversations. **Posture: pure (no carve-out integration test in this chunk).**

**Verification commands.**
- `npx tsc --noEmit`
- `npm run db:generate` — verify zero diff (schema matches DB state after migration applied locally)
- Manual: `\d+ conversations` in psql shows the index with the new column ordering
- Targeted: `npx tsx server/services/__tests__/briefMessageHandlerPure.test.ts`

**Acceptance criteria (verbatim from spec §1.4).**
- `npm run migrate` applies 0240 cleanly on a fresh DB and on a DB that already has the old index.
- `npm run db:generate` produces no diff after the schema edit.
- `\d+ conversations` shows exactly one `conversations_unique_scope` index with column ordering `(organisation_id, scope_type, scope_id)`.
- Inserting two `conversations` rows in different orgs with identical `(scope_type, scope_id)` succeeds.
- Inserting two `conversations` rows in the same org with identical `(scope_type, scope_id)` fails with a unique-constraint error.
- **§4 happy-path invariant:** boot the server with the new index applied, exercise one Brief follow-up flow that writes a `conversations` row; zero new `warn` or `error` log entries that did not exist before this branch.

**Dependencies.** None (this is the first chunk).

---

## Chunk 2 — §1.5 S2: `PULSE_CURSOR_SECRET` one-shot fallback warning

**Scope.** When `PULSE_CURSOR_SECRET` is unset, log the fallback warning exactly once per process lifetime instead of every request. Spec §1.5.

**Files to create or modify.**
- MODIFY `server/services/clientPulseHighRiskService.ts` — `getCursorSecret(orgId)` near lines 158-170 (verified line 167 currently uses `console.warn`).

**Contracts.** Module-level `let cursorSecretFallbackWarned = false;` flag; first miss flips to `true` and emits via `logger.warn('clientpulse_cursor_secret_fallback', { … })`. Subsequent misses are silent.

**Approach (spec MUSTs verbatim).**
- Use `logger`, not `console.warn` — match codebase convention. The spec is explicit: "Do not introduce a parallel console-logging path."
- No `_resetForTesting` export. The spec is explicit: "If a future test needs to assert 'first call warns', it can reload the module via `vi.resetModules()` / Node's module-cache reset; do not pollute the production export surface."
- Existing fallback secret is still computed and returned — only the log frequency changes.

**Tests.** No new test required (single-warn-per-process is structurally enforced by the module-level flag). Optional: extend an existing test for `clientPulseHighRiskService` with a sanity check that `getCursorSecret(orgId)` returns the same value on repeat calls. **Posture: pure-function only — no integration test in this chunk.**

**Verification commands.**
- `npx tsc --noEmit`
- Manual: boot the server with `PULSE_CURSOR_SECRET` unset, hit `/api/clientpulse/high-risk` twice, confirm exactly one log entry. (Manual verification is sufficient per spec §1.5 Definition of Done.)

**Acceptance criteria (verbatim from spec §1.5).**
- 1000 `/api/clientpulse/high-risk` requests with `PULSE_CURSOR_SECRET` unset → exactly one `clientpulse_cursor_secret_fallback` log entry.
- Same scenario with `PULSE_CURSOR_SECRET` set → zero log entries.
- The fallback secret is still computed and returned.
- **§4 happy-path invariant:** with `PULSE_CURSOR_SECRET` set, exercise one `/api/clientpulse/high-risk` request; zero new `warn` or `error` entries.

**Dependencies.** Chunk 1 (sequencing only — no functional dependency). `logger` import (verify import block; add `import { logger } from '../lib/logger.js';` if absent).

---

## Chunk 3 — §1.6 N1: `artefactId` UUID-shape validation

**Scope.** Add a UUID-shape regex check so malformed artefact IDs are rejected at the validation boundary. Spec §1.6.

**Files to create or modify.**
- MODIFY `server/services/briefArtefactValidatorPure.ts`:
  - Add `UUID_REGEX` constant and `requireUuid` helper, modelled after the existing `requireString` (existing file's helper near line 82).
  - Replace the `requireString(errors, 'artefactId', obj['artefactId'])` call in `validateBase` (line 147) with `requireUuid(errors, 'artefactId', obj['artefactId'])`.
- MODIFY `server/services/__tests__/briefArtefactValidatorPure.test.ts` — extend with three new cases.

**Contracts.** See `requireUuid` signature in the Contracts section above.

**Approach (spec MUSTs verbatim).**
- Regex accepts UUID v1–v8 (or arbitrary hex with canonical hyphenation). The spec is explicit: "**Do not** tighten to v4-only — the codebase has no contract requiring v4 specifically."
- Leave all other `requireString` calls unchanged — the spec is artefactId-specific per the deferred note.
- Consistency forward-look (per spec §1.6): `requireUuid` is intentionally introduced inside `briefArtefactValidatorPure.ts` only — DO NOT promote to a shared validation helper (out of scope per §0.3).

**Tests (pure-function only — chunk sits outside the §0.2 carve-out).**
- Empty string artefactId → error containing "required".
- Non-UUID string artefactId (`'banana'`) → error containing "UUID".
- Valid UUID artefactId (`'01234567-89ab-cdef-0123-456789abcdef'`) → no error on the artefactId field.
- (Optional) uppercase variant verifies case-insensitivity.

**Verification commands.**
- `npx tsc --noEmit`
- `npx tsx server/services/__tests__/briefArtefactValidatorPure.test.ts`

**Acceptance criteria (verbatim from spec §1.6).**
- `validateBase({ artefactId: '' })` produces a validation error.
- `validateBase({ artefactId: 'not-a-uuid' })` produces a validation error.
- `validateBase({ artefactId: '01234567-89ab-cdef-0123-456789abcdef' })` does not produce a validation error for the artefactId field.
- `validateBase({ artefactId: '01234567-89AB-CDEF-0123-456789ABCDEF' })` (uppercase) does not produce a validation error.
- All existing tests in `briefArtefactValidatorPure.test.ts` still pass.
- **§4 happy-path invariant:** exercise one Brief artefact write with a valid UUID; zero new `warn` or `error` entries.

**Dependencies.** Chunks 1 and 2 (sequencing only).

---

## Chunk 4 — §1.7 #5: wire `incidentIngestorThrottle` into `incidentIngestor`

**Scope.** Wire the existing throttle module into `ingestInline` (synchronous path only — async-worker path is excluded by contract). Spec §1.7.

**Files to create or modify.**
- MODIFY `server/services/incidentIngestor.ts` — add the `checkThrottle` call at the top of `ingestInline`, after fingerprint computation but before the DB upsert. Extend the return-shape discriminated union with `{ status: 'throttled', fingerprint }`.
- READ-ONLY consume `server/services/incidentIngestorThrottle.ts` (`checkThrottle`, `getThrottledCount` already exported).
- CREATE `server/services/__tests__/incidentIngestorThrottle.integration.test.ts`.

**Contracts.** `ingestInline` return shape gains `'throttled'` discriminant. See Contracts section above for the exact shape.

**Approach (spec MUSTs verbatim).**
- **Async-worker exclusion contract (MUST hold, spec §1.7 step 1):** "the async-worker ingestion path MUST NOT call `checkThrottle`. Adding a second throttling layer there would (a) double-count fingerprints across the two paths producing inconsistent drop behaviour, (b) interact non-deterministically with pg-boss's own backpressure, and (c) make `getThrottledCount()` unreliable as a signal." A future "let's add defence in depth" refactor that wires the throttle into the async-worker path violates this contract.
- **Time-source contract (MUST hold, spec §1.7 step 4):** "`incidentIngestorThrottle` MUST derive the current time exclusively from `Date.now()` — a single, mockable source. It MUST NOT read `performance.now()`, cache timestamps across calls, use a monotonic-clock primitive, or introduce any alternative time source." Pin the time source in code with a single `Date.now()` call site at the top of the throttle check.
- Throttled returns carry `status: 'throttled'`, NOT `success: false`. Returning `success: false` would trigger retries from callers — wrong.
- No new throttle config knob — the 1-second window is hard-coded in `incidentIngestorThrottle.ts`.
- Add an inline code comment at the `ingestInline` call site: `// Throttle is intentionally wired only into ingestInline. The async-worker path uses pg-boss for backpressure. Adding a second throttle layer there violates spec §1.7 (2026-04-28 pre-test backend hardening).`

**Tests (carved-out integration test — chunk sits inside §0.2 carve-out).**
- **Burst dedup:** 1000 sequential `ingestInline(sameFingerprint)` calls with mocked DB upsert; assert 1 DB call, 999 throttled returns, `getThrottledCount()` increases by 999.
- **Cross-fingerprint independence:** 100 calls each for fingerprints A and B; assert 200 DB calls total.
- **Throttle window expiry:** call once, advance fake clock past 1 second, call again; assert 2 DB calls.
- **Test-time determinism — required, not optional (spec §1.7):** All three cases MUST control time deterministically using `node:test`'s `mock.timers` (or the codebase's existing fake-clock harness). DO NOT rely on actual elapsed wall-clock time.

**Verification commands.**
- `npx tsc --noEmit`
- `npx tsx server/services/__tests__/incidentIngestorThrottle.integration.test.ts`
- `npx tsx server/services/__tests__/incidentIngestorThrottle.test.ts` (existing — confirm it still passes)

**Acceptance criteria (verbatim from spec §1.7).**
- 1000 calls for the same fingerprint within 1 second result in 1 DB upsert + 999 throttled returns; `getThrottledCount()` increases by 999.
- 1000 calls for different fingerprints within 1 second produce 2 DB upserts (no cross-fingerprint blocking — note: spec wording uses "two different fingerprints"; the test uses 100+100 to assert 200 DB calls).
- Same fingerprint with >1s gap produces 2 DB upserts.
- Throttled returns carry `status: 'throttled'`, NOT `success: false`.
- Existing async-worker path is unchanged (no throttle call there).
- **§4 happy-path invariant:** exercise one new-fingerprint `ingestInline` call; zero new `warn` or `error` entries (debug-level throttle log is allowed; the spec uses `logger.debug` not `logger.warn`).

**Dependencies.** Chunks 1, 2, 3 (sequencing only).

---

## Chunk 5 — §1.2 REQ W1-44: pre-dispatch connection resolution

**Scope.** When dispatching an `invoke_automation` step, verify every entry in the automation's `requiredConnections` field is mapped for the calling subaccount BEFORE firing the webhook. Spec §1.2.

**This chunk MUST land before Chunk 6 (§1.3).** See "Why Chunk 5 → Chunk 6 is a MUST" in the Sequencing section.

**Files to create or modify.**
- MODIFY `server/services/invokeAutomationStepService.ts` — call site at line ~188 immediately after the automation row is loaded and before `assertSingleWebhook`.
- READ-ONLY consume `server/services/automationConnectionMappingService.ts` (`listMappings(organisationId, subaccountId)` already exported).
- CREATE `server/services/__tests__/resolveRequiredConnectionsPure.test.ts`.

**Contracts.** See `resolveRequiredConnections` and `AutomationStepError` in the Contracts section above.

**Approach (spec MUSTs verbatim).**
- **Purity contract (MUST hold, spec §1.2 step 1):** "the helper MUST be deterministic and side-effect-free — no I/O, no module-level state writes, no reliance on closures over mutable state. Identical inputs MUST produce identical outputs."
- **Output-ordering contract (MUST hold, spec §1.2 step 1):** "when `ok: false`, the `missing` array MUST be returned in deterministic order — preserve the order in which keys appear in `automation.requiredConnections`. … This guarantees stable error messages."
- **Empty / null short-circuit (spec §1.2 step 3):** "If `automation.requiredConnections` is `null` or `[]`, treat as `ok: true` and skip the mapping query — short-circuit to avoid the DB round-trip."
- The error code `automation_missing_connection` and `status: 'missing_connection'` match the §5.7/§5.10 vocabulary in the riley-observations spec.
- Engine connection is loaded separately via the existing engine-resolution path; this item does NOT touch that flow.

**Tests (pure-function only — chunk sits outside the §0.2 carve-out).**
Table-driven tests for `resolveRequiredConnections`:
- empty/null requiredConnections + any mappings → `ok: true, resolved: {}`
- one required, present → `ok: true`
- one required, absent → `ok: false, missing: [key]`
- multiple required, partial overlap → `ok: false, missing: [diff]` — assert exact order matches input order
- mapping with empty `connectionId` for a required key → treated as missing
- mapping with extra unrelated keys → ignored

**Verification commands.**
- `npx tsc --noEmit`
- `npx tsx server/services/__tests__/resolveRequiredConnectionsPure.test.ts`

**Acceptance criteria (verbatim from spec §1.2).**
- An `invoke_automation` step against an automation with `requiredConnections: ['ghl', 'slack']` fails with `automation_missing_connection` and `missingKeys: ['slack']` if the subaccount has only the GHL mapping.
- The same step succeeds normally when both mappings are present.
- An automation with `requiredConnections: null` or `[]` skips the mapping query (verified by spy on `listMappings`).
- The error code `automation_missing_connection` matches the §5.7 vocabulary in the spec; the `status: 'missing_connection'` value matches §5.10.
- The pure helper is fully tested.
- **§4 happy-path invariant:** exercise one `invoke_automation` step against an automation with `requiredConnections: null`; zero new `warn` or `error` entries (the `listMappings` query is skipped).

**Dependencies.** Chunks 1, 2, 3, 4 (sequencing). `automationConnectionMappingService.listMappings` already exported (PR #196 audit-remediation work).

---

## Chunk 6 — §1.3 Codex iter 2 #4: supervised `invoke_automation` dispatch on approval

**Scope.** When `decideApproval` lands an `approve` decision on a step with `stepKind === 'invoke_automation'`, route through the dispatch path (which fires the webhook) rather than calling `completeStepRun` with empty output. Spec §1.3.

**This chunk MUST follow Chunk 5 (§1.2).** Landing it first leaves the resume path without the `automation_missing_connection` guard during testing.

**Files to create or modify.**
- MODIFY `server/services/workflowEngineService.ts` — locate the existing `'invoke_automation'` branch in the tick loop; ensure its dispatch path (`dispatchInvokeAutomationInternal` or equivalent helper) is callable from the approval-resume handler. If the helper is currently an inline closure, hoist it to a module-scope function with a stable signature — but **do not introduce a new abstraction beyond hoisting** (spec §0.3).
- MODIFY `server/services/workflowRunService.ts` — `decideApproval` adds the step-type-aware branch at the post-decision-write point.
- CREATE `server/services/__tests__/decideApprovalStepTypePure.test.ts`.
- CREATE `server/services/__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts`.

**Contracts.** See `resolveApprovalDispatchAction` and `dispatchInvokeAutomationInternal` re-entry signature in the Contracts section above.

**Approach (spec MUSTs verbatim).**

1. **Step-type-aware predicate.** Extract `resolveApprovalDispatchAction(stepRun, decision)`:
   - `decision === 'reject'` → always `'complete_with_existing_output'`.
   - `decision === 'approve' && stepKind === 'invoke_automation'` → `'redispatch'`.
   - `decision === 'approve'` for any other stepKind → `'complete_with_existing_output'`.

2. **Out-of-scope step types (spec §1.3 step 1):** "the original spec note flagged that `agent_call` / `prompt` / `action_call` may have the same gap class. This spec deliberately limits scope to `invoke_automation` because it is the only case where the step has produced NO output during the supervised pause. … If implementation surfaces evidence that any of the other three also lack output, **stop and write a follow-up spec** rather than expanding scope inline."

3. **Retry-state continuation invariant (MUST hold, spec §1.3 step 3):** "`fromApprovalResume === true` MUST preserve the original attempt's retry state without incrementing it, decrementing it, or resetting it. The dispatcher MUST treat the approval-resume call as a continuation of the original attempt (the one that produced the supervised pause), not a new attempt." Concretely:
   - If the original attempt had `retryAttempt: 1` when it paused, the resume starts at `retryAttempt: 1`.
   - If the original attempt never recorded a retry counter, the resume starts the counter at `1` for the current attempt.
   - If partial retry state exists, the resume MUST reuse the persisted counter value — DO NOT re-derive from the supervised-pause record.

4. **Idempotency contract — MUST invariant, not verification instruction (spec §1.3 step 4):** "A `stepRun` MUST NOT dispatch more than once for the same approval decision, regardless of how many times `decideApproval` is invoked concurrently." Dispatch (`dispatchInvokeAutomationInternal`) MUST occur strictly **after** the decision row commit AND only on the code path that successfully wrote the unique decision row (the "winner" branch). Dispatch MUST NOT occur:
   - Before the decision row write,
   - Outside the post-commit boundary of the winning code path,
   - In the unique-violation catch path,
   - In a fire-and-forget side-task that races the commit.
   Concurrent callers that hit the unique-violation branch return the cached decision result and DO NOT re-enter dispatch.

5. **Failure-handling symmetry (MUST hold, spec §1.3 step 6):** "Approval-resume dispatch failures — synchronous errors before retry logic, transient errors during retry, terminal failures, and `automation_missing_connection` from §1.2 — MUST follow the same retry, terminal-state, and error-classification rules as initial dispatch. No special-case error handling is introduced for the resume path." The only resume-specific behaviour is the `dispatch_source: 'approval_resume'` tracing tag and the retry-state continuation rule.

6. **Re-read + invalidation guard.** The new `dispatchInvokeAutomationInternal` re-entry sits inside the existing tick-loop dispatch path which already calls `assertValidTransition` at its terminal write boundaries — no new guard needed. Verify this assumption holds by tracing one happy path through the dispatcher manually before shipping.

**Tests.**

Pure tests (`decideApprovalStepTypePure.test.ts`) — exhaustive matrix on `resolveApprovalDispatchAction(stepRun, decision)`:
- `decision='reject'` × 4 stepKinds → all `'complete_with_existing_output'`.
- `decision='approve' × stepKind='invoke_automation'` → `'redispatch'`.
- `decision='approve' × stepKind='agent_call' | 'prompt' | 'action_call'` → `'complete_with_existing_output'`.

Carved-out integration test (`workflowEngineApprovalResumeDispatch.integration.test.ts` — chunk sits inside §0.2 carve-out for crash-resume parity):
- Contrived `invoke_automation` step through `decideApproval('approve')` against a fake webhook endpoint that records dispatch attempts; assert exactly one dispatch happens, terminal status is `completed`.
- **Concurrent double-approve test** (per spec §1.3 acceptance criteria): a `decideApproval('approve')` race against a supervised `invoke_automation` step asserts exactly one webhook fires (call-count assertion, not just terminal-status assertion).

Manual smoke (allowed under §0.2): in dev DB, create one supervised `invoke_automation` step, hit the approval endpoint, verify the webhook fires (check the receiving automation engine's logs). **This is one of the two manual smokes called out in the programme-end checklist.**

**Verification commands.**
- `npx tsc --noEmit`
- `npx tsx server/services/__tests__/decideApprovalStepTypePure.test.ts`
- `npx tsx server/services/__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts`

**Acceptance criteria (verbatim from spec §1.3).**
- A `Workflow run` with a supervised `invoke_automation` step that is approved fires the webhook.
- The same step's terminal status reflects the dispatch outcome — `completed` on webhook 2xx, `failed` on webhook timeout, `missing_connection` if the §1.2 guard fires (this is the inheritance from chunk 5). NOT `completed` with empty `outputJson` purely from the approval.
- A `reject` decision on the same step type completes with no webhook fired and the step terminal status is `rejected`.
- A double-approve via `Promise.all([decideApproval(id, 'approve'), decideApproval(id, 'approve')])` against a real DB results in exactly **one** webhook dispatch, asserted by direct call-count on the test webhook receiver.
- Approval of an `agent_call` / `prompt` / `action_call` step continues to complete with the supervised-output payload.
- The tracing timeline shows `dispatch_source: 'approval_resume'` on the second dispatch event.
- **§4 happy-path invariant:** exercise one approve-and-dispatch flow with a healthy `invoke_automation` step; zero new `warn` or `error` entries.

**Dependencies.** **Chunk 5 (§1.2) MUST have shipped before this chunk starts.** No exception. Chunks 1, 2, 3, 4 also upstream by sequencing.

---

## Chunk 7 — §1.1 LAEL-P1-1: `llm.requested` / `llm.completed` emission + payload writer

**Scope.** Close the observability gap that leaves the Live Agent Execution Log timeline blank between `prompt.assembled` and `run.completed`. Every LLM call inside an agent run emits `llm.requested` before dispatch and `llm.completed` in the terminal-tx finally block; the redacted payload row is persisted in `agent_run_llm_payloads` with `run_id` populated. Spec §1.1.

**Files to create or modify.**
- MODIFY `server/services/llmRouter.ts` — TODO scaffold near line 845 plus emission call sites and payload-row insertion in the existing terminal-tx pattern.
- READ-ONLY consume `server/services/agentRunPayloadWriter.ts` (`buildPayloadRow` already exported).
- READ-ONLY consume `server/services/agentExecutionEventEmitter.ts` (`tryEmitAgentEvent` already exported).
- READ-ONLY `server/db/schema/agentRunLlmPayloads.ts` (existing; `runId` column denormalised in migration 0192).
- CREATE `server/services/__tests__/llmRouterPayloadEmissionPure.test.ts`.
- CREATE `server/services/__tests__/llmRouterLaelIntegration.test.ts`.

**Contracts.** See `shouldEmitLaelLifecycle`, `llm.requested` payload, `llm.completed` payload in the Contracts section above.

**Approach (spec MUSTs verbatim).**

1. **Provisional ledger-id plumbing (spec §1.1 step 1).** "The idempotency-check transaction in `llmRouter` already creates a `'started'` ledger row before dispatch. Thread that row's `id` from the tx-completion handler up to the dispatch-site closure so the emit calls can reference it as `ledgerRowId`. No new state — the value already exists at line ~830 in the existing flow; this is a closure capture."

2. **`llm.requested` emission** immediately before `providerAdapter.call(...)`, guarded by `if (ctx.sourceType === 'agent_run' && ctx.runId)` — non-agent calls (Slack, Whisper, system maintenance) MUST NOT emit.

3. **Payload row insert (terminal tx).** Inside the existing terminal-write transaction, call `buildPayloadRow({ systemPrompt, messages, toolDefinitions, response, toolPolicies, maxBytes })` and insert into `agent_run_llm_payloads` with `run_id = ctx.runId`. The migration-0192 FK is denormalised, so if the ledger-write tx rolls back for any reason, the payload row goes with it.

4. **Consistency model — MUST hold (spec §1.1 step 3):** "payload is best-effort, ledger is canonical." Payload-insert failure is caught and does NOT roll back the ledger tx. The `llm.completed` event MUST carry an explicit `payloadInsertStatus: 'ok' | 'failed'` field. **There is no other state.** Wrap the insert in `try { … } catch (err) { logger.warn('lael_payload_insert_failed', { runId, ledgerRowId, error }); payloadInsertStatus = 'failed'; }` so insert failure logs and continues. Document the consistency contract inline at the catch site so future readers don't try to "fix" the swallowed exception.

5. **`llm.completed` emission.** In the same `finally` block that writes the terminal ledger row, call `tryEmitAgentEvent` with `eventType: 'llm.completed'`, `tier: 'critical'`, payload `{ ledgerRowId, terminalStatus, latencyMs, costCents, tokensIn, tokensOut, payloadRowId, payloadInsertStatus }`. Same guard as step 2.

6. **Pre-dispatch terminal states (spec §1.1 step 5).** When the terminal status is one of `'budget_blocked' | 'rate_limited' | 'provider_not_configured'`, the adapter was never called. **Skip both `llm.requested` and `llm.completed` emission AND the payload row insert** — there is nothing to record. The ledger row still writes (existing behaviour).

7. **Pure gating predicate (spec §1.1 step 6).** Extract `shouldEmitLaelLifecycle(ctx, terminalStatus): boolean`. Unit-test exhaustively: matrix of source-type × runId-present × terminalStatus.

8. **Ordering invariant (MUST hold, spec §1.1 acceptance):** "`llm.requested.sequence_number < llm.completed.sequence_number` for every `(run_id, ledgerRowId)` pair. Both events MUST be emitted through the same `agentExecutionEventService` sequencing context for the request — i.e., the same run-scoped sequence allocator — so monotonic ordering holds even under concurrent activity on the same run. Crossing sequencing contexts … is forbidden."

9. **Pairing-completeness invariant (MUST hold, spec §1.1 acceptance):** "for every emitted `llm.requested` event, exactly one corresponding `llm.completed` event MUST be emitted for the same `(run_id, ledgerRowId)` pair. … the terminal-tx `finally` block is the structural mechanism that guarantees this." If a future change splits the emit calls across functions, the `finally` guarantee MUST be preserved.

10. **Uniqueness invariant (MUST hold, spec §1.1 acceptance):** "`llm.completed` MUST NOT be emitted more than once for the same `(run_id, ledgerRowId)` pair. … If multiple emit attempts occur, the second and subsequent attempts MUST be idempotent no-ops at the emit boundary."

11. **Ledger / payload consistency contract (MUST hold, spec §1.1 acceptance):** "When the payload insert fails, `llm.completed.payloadInsertStatus === 'failed'` AND `payloadRowId === null` AND **no `agent_run_llm_payloads` row is visible post-commit for that `(run_id, ledgerRowId)` pair** — the catch path MUST guarantee the row is not partially inserted." If the underlying driver creates ambiguity, the catch handler MUST treat that row as failed AND a follow-up DELETE on the contested key MUST run inside the same tx so the post-commit invariant holds.

**Tests.**

Pure tests (`llmRouterPayloadEmissionPure.test.ts`) — exhaustive matrix on `shouldEmitLaelLifecycle(ctx, terminalStatus)` covering 4 source types × 2 runId states × 5 terminal statuses = 40 cases.

Carved-out integration test (`llmRouterLaelIntegration.test.ts` — chunk sits inside §0.2 carve-out): exercises one happy-path agent-run call through a real `llmRouter` invocation against a fake provider adapter, asserts both events and the payload row appear with matching `ledgerRowId`. Uses the existing test-DB harness.

**Manual smoke (one of the two manual smokes called out in the programme-end checklist):** force a contrived ledger-side rollback in a test environment to verify both rows go together via the migration-0192 FK. Note in `tasks/builds/pre-test-backend-hardening/progress.md`.

**Verification commands.**
- `npx tsc --noEmit`
- `npx tsx server/services/__tests__/llmRouterPayloadEmissionPure.test.ts`
- `npx tsx server/services/__tests__/llmRouterLaelIntegration.test.ts`

**Acceptance criteria (verbatim from spec §1.1).**
- Successful agent-run LLM call produces, in order: `prompt.assembled` → `llm.requested` → `llm.completed` → next iteration / `run.completed`. Verifiable via `agent_execution_events WHERE run_id = $1 ORDER BY sequence_number`.
- Ordering invariant holds: `llm.requested.sequence_number < llm.completed.sequence_number` for every `(run_id, ledgerRowId)` pair.
- Pairing-completeness invariant holds: every `llm.requested` has exactly one corresponding `llm.completed`.
- Uniqueness invariant holds: `llm.completed` MUST NOT be emitted more than once for the same `(run_id, ledgerRowId)` pair.
- A failed-mid-flight agent-run LLM call (provider error) produces `llm.requested` → `llm.completed` (with `terminalStatus: 'failed'`) and the corresponding `agent_run_llm_payloads` row.
- A `budget_blocked` agent-run LLM call produces NEITHER event AND NO `agent_run_llm_payloads` row. The ledger row still records `budget_blocked`.
- A non-agent-run LLM call (Slack, Whisper) emits NO LAEL events and writes NO payload row.
- `agent_run_llm_payloads.run_id` is non-null for every payload row inserted by this code path.
- Ledger / payload consistency contract holds (see Approach step 11).
- **§4 happy-path invariant:** exercise one successful agent-run LLM call; zero new `warn` or `error` entries beyond the existing ledger writes (the new `lael_payload_insert_failed` log is `warn` but only fires on failure — happy path is silent).

**Dependencies.** Chunks 1, 2, 3, 4, 5, 6 (sequencing per spec §2). Migration 0192 (already shipped) provides `agent_run_llm_payloads.run_id`.

---

## Chunk 8 — §1.8 S6: idempotent approve/reject race tests for `reviewService`

**Scope.** Add the missing runtime test coverage for the `idempotent_race` branch of `reviewService.approve` / `reviewService.reject`. **No production code change** — this chunk is pure test addition. Spec §1.8.

**Files to create or modify.**
- CREATE `server/services/__tests__/reviewServiceIdempotency.test.ts`.
- READ-ONLY exercise `server/services/reviewService.ts` (existing approve/reject paths near lines 83-183 and 274-395). **DO NOT modify the service.**

**Contracts.** Test asserts the existing `idempotent_race` discriminant value by name; test fails noisily if the string ever changes.

**Approach (spec MUSTs verbatim).**

1. **Use existing carve-out integration-test pattern.** "Test runs against a real DB connection (the dev/test Postgres) with a per-test transaction-rollback wrapper to keep it isolated."

2. **Concurrency primitive — determinism is required (spec §1.8 step 4):** "`Promise.all([approve(id), approve(id)])` against a real DB exercises the actual claim+verify race, but is non-deterministic on its own. **Rule:** if the natural `Promise.all` approach fails to surface the race deterministically across 3 consecutive CI runs (or shows any flake at all on first commit), promote to the existing `__testHooks` seam pattern from `ruleAutoDeprecateJob.ts:86` — inject a synchronous pause between claim and commit so the test deterministically exposes the race window. The `__testHooks` fallback is NOT optional fail-soft polish; it's the documented escape hatch when natural concurrency is non-deterministic. Try natural first (it's simpler); switch on first sign of flake — do not 'wait and see' across a series of CI runs."

3. **Hook-presence contract (MUST hold, spec §1.8 step 4):** "once a test promotes to the `__testHooks` path, the test MUST fail loudly if the hook is unavailable at runtime. DO NOT silently fall back to natural-concurrency `Promise.all` — that would let the test pass while losing determinism." Concretely: assert the hook export is defined at test-setup time (`assert.ok(reviewService.__testHooks?.delayBetweenClaimAndCommit, '…')`) and bail before any test body runs if it's missing.

4. **Three test cases.**
   - **Concurrent double-approve:** create one `pending` review item; fire two `approve(itemId)` calls in parallel via `Promise.all`; assert exactly one returns `proceed` (the winner) and the other returns `idempotent_race` (the loser). Both calls return `success: true`. Verify exactly one row in the audit table.
   - **Concurrent double-reject:** same shape with `reject(itemId)`; assert one `proceed` + one `idempotent_race` + one audit row.
   - **Concurrent approve+reject:** fire one `approve` and one `reject` in parallel on a `pending` item; assert one wins (status reflects the winner), the other returns `409 ITEM_CONFLICT` (the existing "approve-after-rejected / reject-after-approved" branch — different from `idempotent_race`).

5. **Use existing test utilities** (`node:test` + `node:assert`, no new harness). Match the pattern in `derivedDataMissingLog.test.ts` and the `incidentIngestorThrottle.integration.test.ts` from chunk 4.

**Tests.** This entire chunk IS the test addition. No further tests needed.

**Verification commands.**
- `npx tsc --noEmit`
- `npx tsx server/services/__tests__/reviewServiceIdempotency.test.ts` — run 5 times in a row to confirm zero flakiness (per spec §1.8 Definition of Done).

**Acceptance criteria (verbatim from spec §1.8).**
- Test file exists, compiles, all three cases pass.
- Each test creates and tears down its own review item (no test pollution).
- The `idempotent_race` discriminant value is asserted by name.
- Audit table assertions confirm exactly one audit row per resolved item, regardless of how many concurrent attempts ran.
- All three cases pass on first run AND after 5 reruns (no flakiness).
- **§4 happy-path invariant:** the test itself does not interact with happy paths in production; the invariant is satisfied by Chunks 1–7 already.

**Dependencies.** All earlier chunks (sequencing only). `reviewService.approve` / `.reject` exist with the documented `idempotent_race` branch (verified — grep on `idempotent_race` returns `server/services/reviewService.ts`).

**Note for the executor (flagged by architect).** The spec claims `server/services/__tests__/reviewServicePure.test.ts` "references the contract." Grep on `idempotent_race` only matches `reviewService.ts` itself, not the pure test. The contract exists at the service-source level; the spec's claim is slightly imprecise. This is not a blocker — the chunk adds the test that closes that gap. No action needed beyond the chunk's stated scope.

---

## Risks & mitigations

### R1 — A chunk silently expands scope by introducing an unnamed helper

**Risk.** §0.3 forbids new primitives beyond those named in each chunk. The temptation under implementation pressure is to "just refactor a small thing" and introduce, say, a new `getActiveConnectionsForSubaccount` shared helper while doing chunk 5. That violates §0.3 and degrades the architecture-review surface.

**Mitigation.** Each chunk's Approach lists the exact new primitives permitted (see Architecture Notes table 1). The executor MUST reject any pull from the implementation toward a helper not in that list. If the need is real, **stop the chunk, log to `tasks/todo.md`, and ship the chunk as-stated only**.

### R2 — Chunk 5 → Chunk 6 (§1.2 → §1.3) ordering violated

**Risk.** Landing chunk 6 before chunk 5 leaves the approval-resume path without the missing-connection guard, producing the double-debugging scenario the spec calls out.

**Mitigation.** This plan encodes the ordering as a hard MUST (sequencing section), not a recommendation. The executor's chunk-completion flow MUST refuse to start chunk 6 until chunk 5 is committed and verified.

### R3 — Pair-spec collision

**Risk.** A concurrent branch is editing pair-spec files. A mistaken edit on this branch to one of the pair-spec column files (e.g. `server/routes/conversations.ts`, `server/services/briefConversationWriter.ts`) introduces a merge conflict that breaks both branches.

**Mitigation.** The "Files this branch MUST NOT edit" subsection in the file inventory above lists every pair-spec column file. Each chunk's scope is limited to the "Files to create or modify" list — the executor MUST cross-check against the forbidden list before any commit. If a chunk surfaces an apparent need to touch a forbidden file, **stop and consult the user** — that's a cross-spec coordination question.

### R4 — Migration slot collision

**Risk.** Both branches running concurrently could both claim slot 0240 if either grows a second migration mid-stream.

**Mitigation.** The pair spec reserves zero migration slots. If this plan grows a second migration during implementation, claim 0241 and update the §0.4 matrix. The pair spec authors have been told the same. Verified at plan time: the current head is 0239; no other in-flight branch is allocating in this range.

### R5 — Happy-path log noise from an instrumentation chunk

**Risk.** Chunk 7 (§1.1) introduces new emission and a new `logger.warn('lael_payload_insert_failed', …)` log. If the catch path triggers on a happy path, the §4 happy-path invariant fails.

**Mitigation.** The catch path only fires on payload-insert failure. The carved-out integration test asserts both events and the payload row appear on a successful call. The §4 sweep is the structural check: after chunk 7, exercise one successful agent run and confirm zero new `warn`/`error` entries (the catch never fires on a happy path). If a happy-path call ever produces a `lael_payload_insert_failed`, that's a bug — fix the bug, do not silence the log.

### R6 — Flaky idempotency-race test (chunk 8)

**Risk.** `Promise.all([approve, approve])` is non-deterministic on its own — interleaving depends on connection-pool scheduling and CI load.

**Mitigation.** Spec §1.8 step 4 requires an immediate promotion to the `__testHooks` seam at the first sign of flake. The plan's chunk-8 verification step is "run 5 times in a row." If any run shows the loser branch returning anything other than `idempotent_race`, the executor switches to the hook-based pattern from `ruleAutoDeprecateJob.ts:86`. The hook-presence contract (MUST hold) prevents silent fall-back.

### R7 — `decideApproval` dispatch placed outside the post-commit "winner" branch

**Risk.** §1.3 step 4 requires dispatch to occur strictly after the decision row commit AND only on the winner code path. A naive implementation could call `dispatchInvokeAutomationInternal` before or in parallel with the commit, breaking the idempotency contract.

**Mitigation.** The chunk's Approach surfaces the contract verbatim and requires the implementer to verify by reading the existing `decideApproval` flow before adding the dispatch call. The carved-out integration test's double-approve case asserts call-count = 1, which catches any placement that races the commit. If the existing flow doesn't structurally support post-commit dispatch on the winner path, restructure call-site placement (no new state) — and if that turns out to require a new primitive, **stop and write a follow-up spec** per §0.3.

### R8 — Async-worker double-throttling regression (chunk 4)

**Risk.** A future "defence in depth" refactor wires `checkThrottle` into the async-worker path, violating the async-worker exclusion contract.

**Mitigation.** The chunk's Approach surfaces the contract verbatim. The chunk requires an inline code comment at the `ingestInline` call site that reads:

> Throttle is intentionally wired only into `ingestInline`. The async-worker path uses pg-boss for backpressure. Adding a second throttle layer there violates spec §1.7 (2026-04-28 pre-test backend hardening) — see spec §1.7 step 1 "Async-worker exclusion contract."

This makes the contract visible to anyone who later reads the file.

---

## Programme-end verification

This is the SECOND of two gate runs in the plan. It runs after all eight chunks AND spec-conformance complete. Any fixes spec-conformance applies are part of what the final pass validates.

### Order of operations at programme end

1. **Spec-conformance (per chunk).** Run `spec-conformance` against each of the 8 chunks individually so the spec-vs-code divergence (if any) is reported per chunk. The agent auto-detects the spec from the build slug. Fix any `NON_CONFORMANT` findings in the corresponding chunk's surface before proceeding.

2. **`pr-reviewer` (per chunk).** Run `pr-reviewer` against each chunk's diff. Address findings before merging.

3. **§4 happy-path no-new-warnings sweep across all touched surfaces.** This is the structural invariant from spec §4: "No new warnings or error logs introduced on happy-path execution." Walk through:
   - Chunk 7 (§1.1) — exercise one successful agent run; tail server logs; confirm zero new `warn` or `error` entries.
   - Chunk 5 (§1.2) — exercise one successful `invoke_automation` dispatch (with `requiredConnections: null`); same check.
   - Chunk 6 (§1.3) — exercise one approve-and-dispatch flow; same check.
   - Chunk 1 (§1.4) — boot the server with the new index applied; exercise one Brief follow-up; same check.
   - Chunk 2 (§1.5) — exercise one `clientpulse` request with `PULSE_CURSOR_SECRET` set; same check.
   - Chunk 3 (§1.6) — exercise one Brief artefact write with a valid UUID; same check.
   - Chunk 4 (§1.7) — exercise one new-fingerprint `ingestInline`; same check (the `incident_ingest_throttled` log is `debug`-level, not `warn`).
   - Chunk 8 (§1.8) — N/A (test-only chunk).
   Any new `warn` or `error` entry is a bug. Fix the bug, do not silence the log.

4. **Manual smoke checklists.**
   - **Chunk 7 (§1.1) — tx-rollback case.** Force a contrived ledger-side rollback in a test environment. Confirm both ledger row and payload row roll back together (migration-0192 FK enforces this). Note in `tasks/builds/pre-test-backend-hardening/progress.md`.
   - **Chunk 6 (§1.3) — webhook-fires-on-approval case.** In dev DB, create one supervised `invoke_automation` step, hit the approval endpoint, verify the webhook fires (check the receiving automation engine's logs). Note in `progress.md`.

5. **Final gate run — `npm run test:gates`.** This is the single allowed mid/post-baseline gate run. Per CLAUDE.md gate-cadence rule and spec §2 pre-merge gates: `npm run test:gates` is the merge-gate, run only at PR-finalisation. If it surfaces failures, those are the final fixes before the PR is opened.

---

## Executor notes

**Gate scripts run TWICE TOTAL per this plan: once during Phase 0 baseline (and any pre-existing-violation fixes) and once during Programme-end verification after all chunks AND spec-conformance. Running them between chunks, after individual fixes, or as 'regression sanity checks' is forbidden — it adds wall-clock cost without adding signal.**

Per-chunk verification commands are limited to:
- `npx tsc --noEmit` (fast typecheck)
- the specific targeted tests added in that chunk (one or two `npx tsx` invocations)
- nothing else

**Forbidden mid-build, in any form:**
- `scripts/verify-*.sh` of any kind
- `npm run test:gates`
- "Run verify-X to confirm no regression"
- Whole-repo lint or full test-suite passes between chunks
- Any gate run framed as "sanity check" / "regression check" / "quick re-verify"

If a chunk's correctness depends on a gate-level invariant, write a targeted unit test for that invariant inside the chunk. Do not lean on the gate script.

**Per-chunk acceptance MUST include the §4 happy-path invariant.** Each chunk's acceptance section above carries a "**§4 happy-path invariant**" line. Treat it as a structural requirement, not a verification step — exercise the relevant happy path and confirm zero new `warn`/`error` log entries before marking the chunk done.

**MUST clauses in each chunk's Approach are contracts, not verification instructions.** The spec uses "MUST" deliberately for ordering invariants in §1.1, retry-state continuation in §1.3, time-source contract in §1.7, hook-presence contract in §1.8, async-worker exclusion in §1.7, idempotency contract in §1.3 step 4, and others. If a refactor would violate a MUST, that refactor violates the spec — escalate, do not silently rewrite.

**No-new-primitives boundary.** If implementation surfaces a need for a primitive not named in the chunk's Files list, STOP, log to `tasks/todo.md`, and ship the chunk against its stated scope only (spec §0.3).

**Pair-spec coordination.** Do NOT edit any file in the "Files this branch MUST NOT edit" list. Merge conflicts on `tasks/todo.md` are expected and resolve by retaining both completion marks.

**Tracking.** As each chunk lands:
1. Tick the corresponding line in spec §5's tracking table (commit SHA).
2. Tick the corresponding line in `tasks/todo.md` (per spec §5 "Backlog tickoff checklist").
3. Append a note to `tasks/builds/pre-test-backend-hardening/progress.md` with the chunk's outcome and any deviations.

**KNOWLEDGE.md.** Per spec §4 Definition of Done item 6, capture any non-obvious patterns surfaced by chunks 7 (§1.1), 6 (§1.3), or 8 (§1.8) — the architectural / integration-test items. Three candidate captures:
- Chunk 7 — the ledger-canonical / payload-best-effort consistency contract and the `payloadInsertStatus` marker that makes it observable.
- Chunk 6 — the post-commit-winner-branch placement rule for dispatch on approval-resume.
- Chunk 8 — the `__testHooks` seam promotion rule and the hook-presence assertion that prevents silent fall-back.

Capture only what is non-obvious; do not paraphrase the spec.

---

## Definition of Done (programme level — verbatim from spec §4)

The plan is complete when ALL of the following hold:

1. Each chunk's per-item Definition of Done is met.
2. `tasks/todo.md` reflects every closed item with a `[x]` mark and a one-line resolution note pointing at the commit SHA or PR number.
3. The branch passes the spec §2 pre-merge gates (`npx tsc --noEmit`, `bash scripts/run-all-unit-tests.sh`, `npm run migrate` clean apply, the carved-out integration tests in §1.1 / §1.7 / §1.8 green).
4. The PR description summarises which items shipped and links to the relevant `tasks/todo.md` lines.
5. `tasks/builds/pre-test-backend-hardening/progress.md` carries the final session-end summary.
6. KNOWLEDGE.md is updated with any non-obvious patterns surfaced by §1.1, §1.3, or §1.8.
7. **No new warnings or error logs introduced on happy-path execution** — verified by the §4 sweep in the Programme-end verification section.
8. `npm run test:gates` passes at PR-finalisation.
