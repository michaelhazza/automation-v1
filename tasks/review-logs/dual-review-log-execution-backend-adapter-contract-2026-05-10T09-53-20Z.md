# Dual Review Log — execution-backend-adapter-contract

**Files reviewed:** branch `claude/sandbox-execution-provider-DLfjn` diff vs `main` (HEAD `91a8b09a`)
**Iterations run:** 2/3
**Timestamp:** 2026-05-10T09:53:20Z
**Build slug:** execution-backend-adapter-contract
**Spec:** `tasks/builds/execution-backend-adapter-contract/spec.md`
**Commit at finish:** `44ac0cab`

---

## Iteration 1

Codex command: `codex review --base main`

### Codex output (verbatim summary)

> The refactor regresses the missing-parent finalization path by no longer marking the backend terminal event as emitted, which can cause repeated retries for orphaned IEE rows. Other reviewed changes appear broadly consistent with the adapter refactor.
>
> Review comment:
>
> - [P2] Stamp terminal backend rows when parent is missing — `server/services/agentRunFinalizationService.ts:203-211`
>   When a terminal IEE row still points at an `agent_run` that no longer exists, this early return skips the adapter and never sets `iee_runs.event_emitted_at`. The worker retry sweep uses that column to decide which terminal events were not emitted, so this missing-parent case will be re-enqueued repeatedly instead of being acknowledged as the legacy finalizer did; stamp the terminal row before returning or let the adapter handle this branch.

### Adjudication

[ACCEPT] `server/services/agentRunFinalizationService.ts:203-211` — parent-missing branch does not stamp `iee_runs.event_emitted_at`, regressing legacy behaviour
  Reason: Verified against legacy `finaliseAgentRunFromIeeRun` (commit `f5940599^`): the legacy code explicitly stamped `eventEmittedAt` inside the `if (!parent)` branch with the comment "If parent is terminal but iee event is not marked, fall through so we can stamp the event emission". The new generic orchestrator returns early without that stamp. `worker/src/persistence/runs.ts::retryUnemittedEvents()` re-emits any terminal `iee_runs` row with `eventEmittedAt IS NULL`, so an orphaned row would loop indefinitely on every cleanup pass. The spec's "no observable behaviour change in V1" invariant requires preserving this defence. The fix is small (extend `parentRun` to nullable, push the stamping into the adapter where it belongs), matches the existing standalone-task pattern (`!ieeRun.agentRunId` branch already stamps and returns), and adds no new contract surface that downstream adapters would not have implemented anyway.

### Implementation

Three files changed:

1. `server/services/executionBackends/types.ts` — `BackendFinalisationInput.parentRun` is now `{ id, status, ... } | null`. JSDoc spells out the contract: adapters MUST handle `null` by stamping their own terminal-event column and returning `{ finalised: false, ... }`.
2. `server/services/agentRunFinalizationService.ts` — both no-parent branches (no `agentRunId` AND parent-row-missing) now call `adapter.finalise!({ tx, terminalState, parentRun: null })` instead of returning early or passing a sentinel `{ id: '', status: '' }`.
3. `server/services/executionBackends/_ieeShared.ts::ieeFinalise` — collapses the `!ieeRun.agentRunId` branch and the new `parentRun === null` branch into one early return that stamps `eventEmittedAt` if not already set, then returns `{ finalised: false, parentTerminalStatus: parentRun?.status ?? '' }`. `parentRun` is now read with `?.` everywhere it appears in the early return paths.

Verification:
- `npm run lint` — 0 errors (883 pre-existing warnings, none new)
- `npm run typecheck` — clean
- `npx vitest run server/services/executionBackends/__tests__/contractPure.test.ts` — 16/16 pass

---

## Iteration 2

Codex command: `codex review --uncommitted`

### Codex output (verbatim)

> The changes consistently update the finalisation contract to allow a null parent row and the IEE adapter handles that case by stamping eventEmittedAt without touching agent_runs. I did not identify any discrete correctness, security, or maintainability issue in the modified code.

### Adjudication

No findings raised. Loop terminates per Step 4 termination rule (zero findings = done).

---

## Changes Made

- `server/services/executionBackends/types.ts` — `BackendFinalisationInput.parentRun` nullable; contract documented in JSDoc.
- `server/services/agentRunFinalizationService.ts` — orchestrator hands parent-missing case to adapter via `parentRun: null` (preserves legacy `eventEmittedAt` stamping).
- `server/services/executionBackends/_ieeShared.ts` — `ieeFinalise` collapses no-parent branches into one early-return that stamps `iee_runs.event_emitted_at`.

## Rejected Recommendations

None — the only Codex finding (parent-missing event-emit regression) was accepted and fixed.

---

**Verdict:** APPROVED (2 iterations, 1 fix applied — orphan-row event-emit stamping restored)
