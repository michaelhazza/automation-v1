# Spec Review Log — Iteration 5 (FINAL — lifetime cap)

**Spec:** `tasks/hermes-audit-tier-1-spec.md`
**Spec commit at iteration start:** `947111d` + iter 1-4 uncommitted edits
**Iteration:** 5 of 5 (lifetime cap)
**Timestamp:** 2026-04-21T04:20:00Z

## Codex findings (iteration 5)

### FINDING 5.1 — §1 / §7.9 still names `assertWithinRunBudget()` on LLM path; should be `assertWithinRunBudgetFromLedger()`
- Source: Codex P2
- Classification: mechanical (cross-reference drift from iteration-4 rename)
- Disposition: **auto-apply** — updated §1 Summary bullet + §7.9 done #1.

### FINDING 5.2 — §5.2.1 client import path — `shared/runStatus.ts` vs `client/src/lib/runStatus.ts`
- Source: Codex P2
- Classification: mechanical (under-specified import-site contract)
- Disposition: **auto-apply** — pinned canonical semantics in `shared/runStatus.ts` and the client-side import site at `client/src/lib/runStatus.ts`.

### FINDING 5.3 — §8.3 `HALF_LIFE_DAYS` exported under wrong module in the contracts block
- Source: Codex P2
- Classification: mechanical (module-ownership mismatch with §4.2 / §6.6)
- Disposition: **auto-apply** — moved `HALF_LIFE_DAYS` into a new `memoryEntryQualityServicePure` exports block; `workspaceMemoryServicePure` block now only contains decision-logic helpers.

### FINDING 5.4 — §6.3.1 write-once guard uses driver `rowCount`; Drizzle-idiomatic `.returning()` is preferred in this codebase
- Source: Codex P2
- Classification: mechanical (codebase-convention alignment)
- Disposition: **auto-apply** — rewrote the guard to `.returning({ id: agentRuns.id })` + `updated.length === 0` detection; documented codebase convention alignment (agentExecutionService / agentRunFinalizationService / agentBeliefService).

### FINDING 5.5 — §4.2 marks `workspaceMemoryServicePure.test.ts` as `New` but the file already exists
- Source: Codex P3
- Classification: mechanical (file-inventory drift — file exists today with recency-boost tests)
- Disposition: **auto-apply** — changed `New` → `Extend` in §4.2 inventory + §9.2 label.

### FINDING 5.6 — §1 line 33 "same testing substrate (`server/services/__tests__/`)" stale now that Phase A adds two non-server-test files
- Source: Codex P3
- Classification: mechanical (stale phrasing)
- Disposition: **auto-apply** — reworded to acknowledge the two explicit §9 deviations.

## Mechanical accepts this iteration

- [ACCEPT] §1 Summary + §7.9 done #1 — `assertWithinRunBudget` → `assertWithinRunBudgetFromLedger` on the LLM path.
- [ACCEPT] §5.2.1 — canonical vs client-import-site distinction for `isTerminalRunStatus`.
- [ACCEPT] §8.3 — `HALF_LIFE_DAYS` moved into a `memoryEntryQualityServicePure` contract block.
- [ACCEPT] §6.3.1 — `rowCount` → `.returning({ id })` with codebase-convention justification.
- [ACCEPT] §4.2 + §9.2 — `workspaceMemoryServicePure.test.ts` marked `Extend` (file exists today).
- [ACCEPT] §1 line 33 — testing-substrate claim reworded to acknowledge §9 deviations.

## Rejects this iteration

None.

## Iteration 5 Summary

- Mechanical findings accepted:  6
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- HITL checkpoint path:          none this iteration
- HITL status:                   none
- Spec commit after iteration:   947111d + iter 1/2/3 + iter-3 HITL + iter 4 mechanical + iter 5 mechanical (uncommitted)

## Stopping heuristic evaluation (post-iteration-5)

- **Condition 1 — Iteration cap reached.** N = MAX_ITERATIONS = 5. **TRIGGERED.**
- Condition 2 — Two consecutive mechanical-only rounds. Iterations 4 AND 5 were both mechanical-only (directional==0, ambiguous==0, reclassified==0). **Also triggered.** (Preferred exit condition — spec converged on current framing.)
- Loop exits.

**Final disposition:** Spec is mechanically tight. All Codex findings across five iterations have been adjudicated (mechanical auto-applied; directional HITL-resolved by the human). The spec is ready for implementation.
