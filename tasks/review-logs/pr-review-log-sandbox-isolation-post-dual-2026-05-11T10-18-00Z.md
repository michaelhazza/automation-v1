# PR Review Log — sandbox-isolation (post-dual-reviewer re-review)

**Branch:** claude/evolve-sandbox-isolation-brief-Q51hc
**Build slug:** sandbox-isolation
**HEAD at re-review:** 93b3f916 (post dual-reviewer 3 iterations APPROVED + 5 ACCEPT fixes)
**Prior approval:** pr-reviewer round 2 APPROVED at c5167bc5
**Round:** Re-review 1/3 (per playbook §8.5)
**Reviewer:** pr-reviewer (independent code review)
**Verdict:** APPROVED (0 blocking, 1 strong, 2 non-blocking)

---

## Verification — dual-reviewer fixes verified correct

- **Fix 1 — Bootstrap import gap** (`sandboxExecutionService.ts:31-32`). Side-effect imports placed at the sole consumer of `resolveSandboxProvider`. Inline-mode unaffected. Comment documents intent.
- **Fix 2 — `startedAt` never set** (`sandboxExecutionService.ts:198`, `:350`). Case 1 INSERT writes `startedAt: now`; Case 4 stale-lease reclaim refreshes. Case 6 pending→harvesting intentionally preserves original timestamp. Schema column matches.
- **Fix 3 — Step 2 fast-path** (`sandboxHarvestService.ts:204-237`). Canonical-vs-reconciliation split correctly differentiates. Canonical mode trusts stored value (including null); reconciliation requires non-null. Byte-cap pre-check covers stored values.
- **Fix 4 — Reconciliation step 1 cast** (`sandboxHarvestReconciliationJob.ts:198-208`). New STUCK_PRE_TERMINAL flip mirrors pre-existing RECOVERABLE_TERMINAL flip pattern. State machine constants confirm pending/running NOT in SANDBOX_EXECUTION_TERMINAL, so the prior cast was unsound — fix correct.

**Rejected item correctly deferred:** `_buildOutputFromRow` coercion to `provider_unavailable` for in-flight rows is same family as deferred B4 (sync provider). Surface area for async-start follow-up build.

---

## Strong Recommendations

### S1 — Add tests for the two new internal branches

Dual-reviewer's two largest behavioural fixes (step 2 canonical/reconciliation split + STUCK_PRE_TERMINAL flip) have no direct test coverage. Regression would be invisible until production.

**Test 1 — step 2 canonical/reconciliation branching:**
- Given `reconciliationAttempt === 0` + stored `outputJson === null` → step 2 returns `{ ok: true, parsed: null }` (trust the null)
- Given `reconciliationAttempt === 1` + stored `outputJson === null` → falls through to SDK stub, returns `output_validation_failed`

**Test 2 — STUCK_PRE_TERMINAL flip:**
- Given stuck `pending` past deadline → SQL UPDATE sets `status='harvesting'`, harvest invoked sees harvesting
- Given stuck `running` past deadline → same outcome
- Given stuck `harvesting` → no flip, harvest invoked directly

Files: `server/services/__tests__/sandboxHarvestService.step2.test.ts` and `server/jobs/__tests__/sandboxHarvestReconciliationJob.flip.test.ts`.

**Status:** ROUTED to tasks/todo.md backlog (non-blocking).

---

## Non-Blocking Improvements

- **N1** — Adjacent imports from same module in `sandboxExecutionService.ts:33-34` (cosmetic; pre-existing).
- **N2** — STUCK_PRE_TERMINAL flip in `reconcileExecution` bypasses `describeTransition` logging (consistency with pre-existing RECOVERABLE_TERMINAL pattern; defer to tasks/todo.md).

---

## Final note

Dual-reviewer fixes are surgical, well-commented, and trace cleanly. No regressions. Branch is in a stronger state than prior approval at `c5167bc5`. Re-review verdict matches dual-reviewer's verdict.

**APPROVED — close branch-level review pass. Proceed to doc-sync gate (Step 9) and Phase 2 handoff (Step 10).**
