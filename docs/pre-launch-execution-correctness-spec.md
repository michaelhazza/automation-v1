# Pre-Launch Execution-Path Correctness — Spec

**Source:** `docs/pre-launch-hardening-mini-spec.md` § Chunk 5
**Invariants:** `docs/pre-launch-hardening-invariants.md` (commit SHA: `cf2ecbd06fa8b61a4ed092b931dd0c54a9a66ad2`)
**Implementation order:** `1 → {2, 4, 6} → 5 → 3` (Chunk 5 lands after Chunk 2 — depends on the schema decision for C4a-6-RETSHAPE)
**Status:** draft, ready for user review

---

## Table of contents

1. Goal + non-goals
2. Items closed
3. Items NOT closed
4. Key decisions
5. Files touched
6. Implementation Guardrails
7. Test plan
8. Done criteria
9. Rollback notes
10. Deferred Items
11. Review Residuals
12. Coverage Check

---

## 1. Goal + non-goals

### Goal

Make the dispatcher and execution loops resist race conditions and contract gaps that surface only under sustained testing — close the 5 truly-open execution-path correctness items before the testing round runs.

After Chunk 5 lands:

- Dispatcher boundaries re-check invalidation after every awaited I/O (invariant 3.1).
- Multi-webhook resolutions are rejected at dispatch (invariant 3.3 / W1-43 rule 4).
- `errorMessage` is threaded into memory extraction on normal-path failed runs (invariant 3.6).
- `runResultStatus = 'partial'` is decoupled from summary presence (invariant 3.5 + 6.3).
- Skill error envelope shape is one of two documented options with 100% adherence (invariant 2.4).

### Non-goals

- Adding new step types or new dispatcher branches.
- Changing the §5.7 error vocabulary beyond what W1-38's resolution already accomplished (verified closed; see § 2.1).
- Reworking the tick loop's scheduler / queue semantics. Chunk 5 stays inside the existing loop shape.
- Anything in mini-spec § "Out of scope" (LAEL-P1-1, TEST-HARNESS, etc.).

---

## 2. Items closed

### 2.1 Already-closed items — verified state on 2026-04-26

| Mini-spec ID | todo.md line | Verbatim snippet | Verified state |
|---|---|---|---|
| `W1-44` | 649 | "REQ W1-44 — Pre-dispatch connection resolution not implemented" | `server/services/invokeAutomationStepService.ts:128` resolves `automation.requiredConnections`; missing keys fail with `code: 'automation_missing_connection'` at dispatch (lines 130–155). **CLOSED.** |
| `W1-38` | 651 | "REQ W1-38 engine-not-found — dispatcher emits `automation_execution_error`, not in §5.7 vocabulary (ambiguous)" | `grep -rE "automation_execution_error" server/` → no matches. The engine-not-found case now emits `automation_not_found` (line 95) and the engine-load-failed case emits `automation_composition_invalid` (line 162). The ambiguous code is gone. **CLOSED.** |

### 2.2 Truly-open items — closed by this spec

| Mini-spec ID | todo.md line | Verbatim snippet | Resolution |
|---|---|---|---|
| `C4b-INVAL-RACE` | 667 | "Inline-dispatch step handlers do not re-check invalidation after awaiting external I/O" (Codex iter 3 finding #7) | Add a re-read + invalidation-check wrapper around every `*Internal` helper call that follows an `await` on external I/O in `workflowEngineService.ts`. Single helper `withInvalidationGuard(stepRunId, work)` wraps the late-write to discard if `status === 'invalidated'`. See § 4 for scope decision. |
| `W1-43` | 648 | "REQ W1-43 — Dispatcher §5.10a rule 4 defence-in-depth not implemented" | Add a pure-function assertion inside `resolveDispatch` (`server/services/invokeAutomationStepService.ts`) that verifies the automation row conforms to the single-webhook contract: exactly one non-empty `webhookPath`, no alternative webhook fields. Emits `automation_composition_invalid` on violation. |
| `HERMES-S1` | 92–105 | "§6.8 errorMessage gap on normal-path failed runs" — `agentExecutionService.ts:1350-1368` passes `errorMessage: null` into `extractRunInsights` even when `derivedRunResultStatus === 'failed'` | Thread `errorMessage` from `preFinalizeMetadata` (already in scope at line 1370) into `extractRunInsights` when the derived status is `failed`. The current code at line ~1659 explicitly says `errorMessage: null as string | null,` with a "future refactor could surface" comment — that's the resolution. |
| `H3-PARTIAL-COUPLING` | 152–171 | "H3 — `runResultStatus='partial'` coupling to summary presence" — `computeRunResultStatus` line 572 demotes `completed` → `partial` when `!hasSummary` | Per architect decision: pick option (a) separate `hasSummary` flag, OR (b) side-channel `summaryMissing=true`, OR (c) monitor-and-revisit. § 4 below recommends (b) — keep `runResultStatus` purely about task outcome; surface `summaryMissing` as a side-channel field on the run row. |
| `C4a-6-RETSHAPE` | 337 | "REQ #C4a-6 — Return-shape contract for delegation errors" — spec §4.3 mandates `{ code, message, context }`; ~40 skills return `error: <string>` | **DEPENDS ON CHUNK 2 ARCHITECT OUTPUT.** The Chunk 2 architect resolves whether to grandfather the flat-string pattern or migrate to the nested envelope (per invariant 2.4). § 4 below documents both branches; the spec ships against whichever Chunk 2 picks. |

---

## 3. Items NOT closed

| What | Why deferred | Where it lives |
|---|---|---|
| Adding new step types or step-run statuses | Out of scope; `shared/runStatus.ts` sets are closed per invariant 6.5 | Future spec if needed |
| Reworking the tick loop's scheduler | Out of scope; existing loop shape is preserved | Post-launch performance work |
| LAEL-P1-1, TEST-HARNESS, INC-IDEMPOT, etc. | Mini-spec § "Build-during-testing watchlist" — earn value when traffic exists | Built during testing round |
| Other execution-path issues not cited by mini-spec | Out of scope | Separate audit-runner pass |

---

## 4. Key decisions

### 4.1 C4b-INVAL-RACE — single helper vs per-call-site (resolved inline)

**Decision: single helper `withInvalidationGuard`.**

Mini-spec poses: "scope of the invalidation re-check wrapper (one helper or per-call-site)". The single-helper approach wins because:

- DRY across the 4 internal-helper call sites (`action_call`, `agent_call`, `prompt`, `invoke_automation`).
- Mirrors the public `completeStepRun` / `completeStepRunFromReview` pattern (already centralised).
- Easier to test (one pure-function unit covers the race).
- New step types added later automatically inherit the protection.

Helper shape (in `server/services/workflowEngineService.ts`):

```typescript
async function withInvalidationGuard<T>(
  stepRunId: string,
  externalWork: () => Promise<T>,
): Promise<T | { discarded: true; reason: 'invalidated' }> {
  const result = await externalWork();
  const [sr] = await db.select().from(workflowStepRuns).where(eq(workflowStepRuns.id, stepRunId)).limit(1);
  if (sr?.status === 'invalidated') {
    return { discarded: true, reason: 'invalidated' };
  }
  return result;
}
```

Call sites: each `*Internal` helper that performs an `await` on external I/O (action_call's tool dispatch, agent_call's sub-run trigger, prompt's LLM call, invoke_automation's webhook) wraps the I/O in `withInvalidationGuard(stepRun.id, ...)`. If the result is `{ discarded: true }`, the late-write skips and the outer step state stays `invalidated`.

### 4.2 H3-PARTIAL-COUPLING — chosen option (resolved inline)

**Decision: option (b) side-channel `summaryMissing=true`.**

Three options from `tasks/todo.md:162-170`:
- (a) Separate `hasSummary` flag column on `agent_runs` — schema change; risks invariant 2.6 (schema landings under Chunk 2).
- (b) Side-channel `summaryMissing=true` — no schema change; informational field only; preserves `runResultStatus` semantics.
- (c) Monitor-and-revisit — kicks the can; conflicts with invariant 3.5 ("summary failure must not demote a successful run").

(b) wins because:

- No schema change; ships in the implementation PR without coordinating with Chunk 2.
- Invariant 3.5 is closed (success runs without summaries no longer get demoted to partial).
- The side-channel field can be a key on `runMetadata` JSONB or returned only in the response shape — no DDL.

`computeRunResultStatus` signature changes to:

```typescript
export function computeRunResultStatus(
  finalStatus: string,
  hasError: boolean,
  hadUncertainty: boolean,
): 'success' | 'partial' | 'failed';
// hasSummary parameter removed; partial reachable ONLY from per-step aggregation per invariant 6.3
```

Callers that need to surface "summary missing" do so via a separate field on the response/extraction shape.

### 4.3 C4a-6-RETSHAPE — Chunk 5 owns this decision (recommendation: Branch A grandfather)

**Ownership resolution.** The cross-spec consistency sweep (Task 6.6) surfaced unowned-decision drift between Chunks 2 / 3 / 5: each chunk pointed at another for the C4a-6-RETSHAPE decision. The Chunk 2 architect output covered schema decisions and renames; C4a-6-RETSHAPE is an execution-path concern and lives in Chunk 5. This spec now owns it.

**Recommendation: Branch A — grandfather the flat-string pattern.** Rationale:

- Pre-launch posture (`docs/spec-context.md § Architecture defaults`): rapid_evolution, prefer existing primitives, no introduce-then-defer.
- Migrating ~40 skill handlers from `error: '<code-string>'` to `error: { code, message, context }` is high-effort low-value pre-launch — every handler ships pre-launch with a minor refactor for no direct testing-round benefit.
- The 3 delegation skills (`spawn_sub_agents`, `reassign_task`, third per `tasks/todo.md:337`) bring their return shapes back to align with the legacy flat-string pattern. The amendment to `docs/hierarchical-delegation-dev-spec.md` §4.3 documents the legacy pattern as canonical for v1.
- Branch B (migrate) becomes a Phase-2 spec when explicit operator value emerges (e.g., LLM-facing serialisation needs richer error context). Trigger documented in § 10 Deferred Items.

User can override at PR review (§ Review Residuals captures this as a HITL question — recommendation flagged but not enforced).

Branches documented for completeness:

**Branch A — grandfather the flat-string pattern (RECOMMENDED):**
- No code change to ~40 existing skill handlers.
- Spec § 4.3 of `docs/hierarchical-delegation-dev-spec.md` is amended to acknowledge the legacy pattern.
- Three delegation skills (`spawn_sub_agents`, `reassign_task`, third per spec) bring their return shape into alignment with the legacy flat-string pattern.

**Branch B — migrate all skills to nested envelope (alternative):**
- All ~40 skill handlers refactor `error: '<code-string>'` to `error: { code: '<code-string>', message: '...', context: {...} }`.
- LLM-facing serialisation, agent prompt parsing, `executeWithActionAudit` audit log all updated.
- Bigger code change; bigger payoff (consistent error envelope across the platform).

Implementation PR ships against Branch A by default; if user picks Branch B at review, implementation PR scope expands.

### 4.4 W1-43 rule 4 implementation (resolved inline)

**Decision: pure-function assertion in `resolveDispatch`.**

The current code at line 162 already validates "engine assigned" → `automation_composition_invalid`. Add a sibling check before that branch:

```typescript
function assertSingleWebhook(automation: AutomationRow): null | AutomationStepError {
  const webhookFields = [
    automation.webhookPath,
    // ...any future multi-webhook fields the spec rejects
  ].filter((v) => v != null && v !== '');
  if (webhookFields.length !== 1) {
    return {
      code: 'automation_composition_invalid',
      type: 'execution',
      message: `Automation '${automation.id}' must have exactly one outbound webhook; found ${webhookFields.length}.`,
      retryable: false,
    };
  }
  return null;
}
```

Today the schema enforces single-webhook implicitly via the `webhookPath` text column shape. The assertion catches mutated / migrated rows where the contract was violated by a non-schema path.

---

## 5. Files touched

### Modified

| File | Change |
|---|---|
| `server/services/workflowEngineService.ts` | Add `withInvalidationGuard` helper. Wrap each `*Internal` helper's external-I/O await with the guard. |
| `server/services/invokeAutomationStepService.ts` | Add `assertSingleWebhook` pure helper. Call before engine-load (current line 162). |
| `server/services/agentExecutionService.ts` | Thread `errorMessage` from `preFinalizeMetadata` into `extractRunInsights` call (current line ~1659). Replace `errorMessage: null as string | null,` with `errorMessage: derivedRunResultStatus === 'failed' ? extractErrorMessage(preFinalizeMetadata) : null,`. |
| `server/services/agentExecutionServicePure.ts` | Refactor `computeRunResultStatus` per § 4.2: remove `hasSummary` parameter; partial reachable only from per-step aggregation. Update callers in `agentExecutionService.ts`. |
| Spec doc `docs/hierarchical-delegation-dev-spec.md` | (Branch A only — if Chunk 2 picks grandfather) §4.3 amendment to acknowledge legacy flat-string pattern. |
| ~40 skill handlers in `server/services/skillExecutor.ts` and the skill modules it dispatches to | (Branch B only — if Chunk 2 picks migrate) refactor each `error: '<code-string>'` return to nested envelope. Enumerate during implementation. |

### Created

| File | Purpose |
|---|---|
| `server/services/__tests__/invalidationRaceP​ure.test.ts` (or co-located) | Pure simulation test for C4b: concurrent invalidate + dispatch result; asserts late writer hard-discards. |
| `server/services/__tests__/assertSingleWebhookPure.test.ts` | Pure test for W1-43: zero / one / multiple webhook fields. |
| `server/services/__tests__/computeRunResultStatusPure.test.ts` (or extension) | Pure test for H3 + invariant 6.3: all-completed → success; any-error → failed/partial; cancelled / skipped aggregation; summary absence does NOT demote. |
| `server/services/__tests__/extractRunInsightsErrorMessagePure.test.ts` | Pure test for HERMES-S1: failed-without-throw runs receive threaded errorMessage. |

### Untouched (verification-only — no code change)

- `server/services/invokeAutomationStepService.ts` lines 95 (engine-not-found), 128–155 (required-connection check), 162–168 (engine-load) — verified correct per § 2.1.
- `shared/runStatus.ts` — sets are closed per invariant 6.5; no changes here.

---

## 6. Implementation Guardrails

### MUST reuse

- `failure() + FailureReason enum` (`shared/iee/failure.ts`) for any new error path (per `accepted_primitives`).
- `shared/runStatus.ts` `TERMINAL_RUN_STATUSES` / `IN_FLIGHT_RUN_STATUSES` / `AWAITING_RUN_STATUSES` — single source of truth (invariant 6.5).
- `agentExecutionEventService` for any new event emission.
- Existing `*Internal` helper shape in `workflowEngineService.ts` — wrap, don't replace.

### MUST NOT introduce

- New step types or new run statuses without a `runStatus.ts` update + spec amendment (invariant 6.5).
- A new "WorkflowEngineFramework" or "DispatcherBase" abstraction. The single-helper approach in § 4.1 is the framework.
- New `error_code` strings outside §5.7 vocabulary (invariant 3.4).
- Vitest / Jest / Playwright / Supertest. Pure tests only (per `convention_rejections`).
- A schema column for H3 — the side-channel option (b) deliberately avoids DDL (§ 4.2).

### Known fragile areas

- **`withInvalidationGuard` re-read cost.** Each external-I/O await now incurs an extra SELECT on `workflow_step_runs`. The query is indexed by primary key; cost is negligible. Confirm at implementation time by EXPLAIN.
- **`computeRunResultStatus` signature change.** `hasSummary` parameter removed. Audit every caller; the typecheck will surface them. Implementation PR includes the call-site updates.
- **Branch B (skill error envelope migrate).** ~40 skills return error strings. Audit each; LLM-facing serialisation may need updates. The spec calls out this risk in § Review Residuals.

---

## 7. Test plan

### Pure unit tests (4 files per § 5)

1. **C4b invalidation race** — set up: stepRun in `running`, simulate concurrent invalidation (mock the SELECT to return `status: 'invalidated'` after the await), assert late write returns `{ discarded: true, reason: 'invalidated' }` and the row stays `invalidated`.
2. **W1-43 single-webhook assertion** — three cases: zero webhooks (returns error), one webhook (returns null), two webhooks (returns error with `automation_composition_invalid`).
3. **H3 + invariant 6.3 aggregation** — all-completed → success; any-error → failed; cancelled aggregation; skipped aggregation; partial reachable only via per-step mix; summary absence does NOT demote.
4. **HERMES-S1 errorMessage threading** — failed run with `preFinalizeMetadata.errorMessage='X'` → `extractRunInsights` receives `errorMessage: 'X'`. Failed run with no errorMessage → null. Success run → null regardless.

### Static gates

- `verify-rls-contract-compliance.sh` → must pass (no direct `db` use changes).
- TypeScript build → must pass (signature change for `computeRunResultStatus` surfaces all callers).
- Sanity grep before commit: `grep -rE "automation_execution_error" server/` → must remain zero (W1-38 closed).

### Branch A vs Branch B test deltas

If Chunk 2 picks **Branch B** (migrate skill error envelope):
- Add a fixture-based test that iterates the registered skill handlers and asserts every error return matches the nested `{ code, message, context }` shape.

If Chunk 2 picks **Branch A** (grandfather):
- No additional test; `docs/hierarchical-delegation-dev-spec.md` §4.3 amendment is the deliverable.

---

## 8. Done criteria

- [ ] `withInvalidationGuard` helper present in `workflowEngineService.ts`; all 4 internal-helper external-I/O awaits wrapped.
- [ ] `assertSingleWebhook` present in `invokeAutomationStepService.ts`; called before engine-load; emits `automation_composition_invalid` on violation.
- [ ] `agentExecutionService.ts` line ~1659 threads `errorMessage` from `preFinalizeMetadata` for failed-without-throw runs.
- [ ] `computeRunResultStatus` no longer accepts `hasSummary`; partial reachable only via per-step aggregation; all callers updated.
- [ ] C4a-6-RETSHAPE: implementation matches whichever branch (A or B) Chunk 2 architect picked.
- [ ] 4 pure unit tests per § 5 land green.
- [ ] `tasks/todo.md` annotated for all 7 cited items per § 8.
- [ ] PR body links the spec; test plan checked off.

---

## 9. Rollback notes

- `withInvalidationGuard` — additive helper; rollback via `git revert`. Internal helpers fall back to no re-check.
- `assertSingleWebhook` — additive; rollback restores pre-check behaviour (schema still enforces single-webhook implicitly).
- HERMES-S1 errorMessage threading — single-line diff at line 1659; rollback restores `errorMessage: null`.
- H3 `computeRunResultStatus` signature change — bigger blast radius (every caller). Rollback restores `hasSummary` parameter; partial-from-no-summary returns. Acceptable because pre-Chunk-5 state is the current production state.
- C4a-6-RETSHAPE Branch A: spec doc revert. Branch B: ~40 file revert; bigger lift.

No DB migrations involved.

---

## 10. Deferred Items

None for Chunk 5.

The 5 truly-open items in § 2.2 are all closed; the 2 verified-closed items in § 2.1 require no spec action; the C4a-6-RETSHAPE branching is documented in § 4.3 but blocks on Chunk 2.

---

## 11. Review Residuals

_(Populated by user adjudication at PR review. `spec-reviewer` agent skipped per `tasks/builds/pre-launch-hardening-specs/progress.md § Workflow deviations`.)_

### HITL decisions (user must answer)

- **C4a-6-RETSHAPE branch.** Confirm Chunk 2 architect picked Branch A (grandfather flat-string) or Branch B (migrate to nested envelope). Implementation cannot start the C4a-6-RETSHAPE work until this is locked.

### Directional uncertainties (explicitly accepted tradeoffs)

- **H3 option choice.** § 4.2 picks option (b) side-channel. Trade-off: rejected option (a) schema-flag (cleaner long-term but introduces DDL during a chunk that explicitly avoids schema work) and option (c) monitor-and-revisit (kicks the can; conflicts with invariant 3.5). Accepted; if option (a) is preferred, the spec is amended and Chunk 2 picks up the schema column.
- **C4b single-helper scope.** § 4.1 picks single helper over per-call-site. Trade-off: rejected per-call-site as noisier and harder to audit. Accepted.

---

## 12. Coverage Check

### Mini-spec Items (verbatim)

- [x] `C4b-INVAL-RACE` — re-check invalidation after I/O in `workflowEngineService.ts` tick switch — **addressed in § 2.2 + § 4.1 (single helper)**.
- [x] `W1-43` — dispatcher §5.10a rule 4 defence-in-depth in `invokeAutomationStepService.ts:165-166` — **addressed in § 2.2 + § 4.4 (assertSingleWebhook)**.
- [x] `W1-44` — pre-dispatch `required_connections` resolution; fail at dispatch — **addressed in § 2.1 (verified closed)**.
- [x] `W1-38` — add `automation_execution_error` to §5.7 error vocabulary (spec + code align) — **addressed in § 2.1 (verified closed; ambiguous code removed)**.
- [x] `HERMES-S1` — thread `errorMessage` from `preFinalizeMetadata` into `agentExecutionService.ts:1350-1368` — **addressed in § 2.2 + § 5 modified files**.
- [x] `H3-PARTIAL-COUPLING` — decouple `runResultStatus='partial'` from summary presence — **addressed in § 2.2 + § 4.2 (option b side-channel)**.
- [x] `C4a-6-RETSHAPE` — skill handler error envelope: spec mandates `{code, message, context}`; ~40 skills return flat string — **addressed in § 2.2 + § 4.3 (branching depends on Chunk 2 architect)**.

### Mini-spec Key decisions (verbatim)

- [x] **C4a-6-RETSHAPE: grandfather or migrate. Either way, spec must reflect reality** — **addressed in § 4.3 (both branches documented; routed to user via § Review Residuals)**.
- [x] **C4b: scope of the invalidation re-check wrapper (one helper or per-call-site)** — **addressed in § 4.1 (single helper picked with rationale)**.

### Final assertion

- [x] **No item from mini-spec § "Chunk 5 — Execution-Path Correctness" is implicitly skipped.** Every cited item appears in either § 2.1 (verified closed) or § 2.2 (closed by this spec). Both Key decisions are addressed in § 4.

### Mini-spec done criteria — mapped to this spec's § 8

- [x] "Race-condition test for C4b passes (concurrent invalidate + dispatch result)" — § 7 test 1.
- [x] "W1-43/44 enforced at dispatcher boundary with tests" — § 7 test 2 (W1-43); W1-44 already verified closed.
- [x] "HERMES-S1 verified by failed-run-without-throw test extracting memory" — § 7 test 4.
- [x] "Skill error envelope contract is one of two documented options and 100% adherent" — § 4.3 (both branches) + § 7 (Branch B fixture if migrating).
