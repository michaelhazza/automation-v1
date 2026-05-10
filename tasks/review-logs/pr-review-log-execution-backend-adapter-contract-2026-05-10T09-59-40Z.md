# PR Review Log — execution-backend-adapter-contract (Round 3)

**Branch:** `claude/sandbox-execution-provider-DLfjn`
**HEAD commit at review:** `7e168c3c` (dual-reviewer log update on top of fix `44ac0cab`)
**Reviewed at:** 2026-05-10T09:59:40Z
**Reviewer:** pr-reviewer (round 3 — post-dual-reviewer re-review per playbook §8.5)
**Round-2 log:** `tasks/review-logs/pr-review-log-execution-backend-adapter-contract-2026-05-10T09-40-37Z.md`
**Dual-review log:** `tasks/review-logs/dual-review-log-execution-backend-adapter-contract-2026-05-10T09-53-20Z.md`

**Verdict:** APPROVED (0 blocking, 1 strong, 2 non-blocking)

## Diff scope

`91a8b09a..7e168c3c -- server/` — three files:
- `server/services/executionBackends/types.ts` (BackendFinalisationInput shape change — parentRun nullable)
- `server/services/executionBackends/_ieeShared.ts` (handle nullable parentRun)
- `server/services/agentRunFinalizationService.ts` (orchestrator passes null instead of returning early)

## Verification of the three review questions

**1. Contract shift to `parentRun: { ... } | null` is type-safe across all 5 adapters.** Only the two delegated adapters (`iee_browser`, `iee_dev`) implement `finalise()`. The api/headless/claude-code adapters declare `'in_process'` / `'subprocess'` capabilities and have no `finalise()` slot — registry Rule 2 only requires the delegated lifecycle methods when `capabilities.includes('delegated')`. Both IEE adapters are thin forwarders to `ieeFinalise`, so the contract widening propagates cleanly. No adapter needed editing beyond `_ieeShared.ts`.

**2. The fix actually closes the orphan-event-emit regression.** Confirmed end-to-end:
- `worker/src/persistence/runs.ts::retryUnemittedEvents()` re-emits any terminal `iee_runs` row with `event_emitted_at IS NULL`.
- `_ieeShared.ts:308-319` now stamps `eventEmittedAt = now()` whenever `parentRun === null` (orphan case), gated on `if (!ieeRun.eventEmittedAt)` for idempotency.
- Stamp is scoped by `(ieeRuns.id, ieeRuns.organisationId)` — multi-tenant isolation preserved.
- Path returns `{ finalised: false, parentTerminalStatus: parentRun?.status ?? '' }` with no `postCommit`, so no spurious websocket events fire.

**3. No regression of round-1 fixes or earlier reviews.** Round-3 diff is surgical — three files. None of the earlier review areas (cycle prevention assertions, registry capability gating, idempotency-key generation, TERMINAL_SET membership, run-result-status write semantics) is altered.

## Strong recommendation

**S-1 — Add an integration test that exercises the orphan-stamp path.** The mock adapter test in `contractPure.test.ts` only exercises the happy path with non-null `parentRun`. The regression Codex caught had to be inferred from a comparison against legacy code; there is no pure or DB test that would have failed. **Defer to backlog (EBAC-PR3-S1).**

Suggested Given/When/Then:
- **Given** an `iee_runs` row in status `'completed'` with `event_emitted_at = NULL` whose `agent_run_id` references a deleted `agent_runs` row,
- **When** `finaliseAgentRunFromBackend({ backendId: 'iee_browser', backendTaskId: <ieeRunId> })` runs,
- **Then** function returns `false`, row's `event_emitted_at` is non-null, no `agent_runs` UPDATE attempted, no websocket emission fires.

## Non-blocking

**NB-1.** Duplicated `parentRun?.status ?? ''` shape at `_ieeShared.ts:300, 318` could hoist to a local `const noParentResult` if a third user appears.

**NB-2.** Comment at `agentRunFinalizationService.ts:178` ("Standalone backend task") is slightly misleading now — the same `parentRun: null` is also produced when `agentRunId` is set but parent row is gone. Cosmetic.

**Round-3 NB items (NB-1, NB-2) and the round-1 holdovers (NB#1 nullable agentRunId typing, NB#2 claudeCode backendTaskId spec drift) are all carry-forward backlog.**

## Verdict

**Verdict:** APPROVED (0 blocking, 1 strong, 2 non-blocking)

Dual-reviewer fix is clean, surgical, and complete. Orphan-event-emit regression is fully closed via the new conditional `eventEmittedAt` stamp with idempotency gating. No earlier review findings regressed. Strong S-1 (orphan integration test) deferred to backlog as **EBAC-PR3-S1**.
