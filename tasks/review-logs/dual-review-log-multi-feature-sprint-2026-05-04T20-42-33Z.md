# Dual Review Log — multi-feature-sprint

**Files reviewed:** Branch diff against `main` (`156537bd...HEAD`) — 558 files, ~85k insertions covering Workflows v1 Phase 1+2, Agentic Commerce, GHL Module C OAuth, Subaccount Artefacts F1+F3 specs, Framework Standalone Repo, Spend Policy improvements.
**Iterations run:** 3/3
**Timestamp:** 2026-05-04T20:42:33Z
**Codex version:** v0.125.0 (gpt-5.5)
**Reviewer:** Claude Opus 4.7 (1M context) adjudicating
**Commit at finish:** 4ae23e09ed6da5e8b6b87eb1cc33bd190e0c567c

---

## Iteration 1

Codex processed the full 558-file diff (raw output ~244 KB, persisted at `_codex_iter1_full_2026-05-04T20-42-33Z.txt`). It drilled selectively into the spec / progress doc commits (`16cb227b`, `1f42c980`) — those are the only commits on this branch since the last merged feature commit `156537bd`. The merged feature code (Workflows v1, Agentic Commerce, GHL OAuth, Framework Standalone, Spend Policy) had already been through `pr-reviewer` and `chatgpt-pr-review` cycles before merge; Codex flagged nothing in those areas.

### Findings

**[ACCEPT] tasks/builds/subaccount-artefacts/progress.md:7** — "Mark unimplemented F1 chunks as pending"
- **Issue:** progress.md says backend chunks 1A–3C are DONE on this branch, but the referenced files (`migrations/0277_*.sql`, `server/workflows/baseline-artefacts-capture.workflow.ts`, `shared/constants/baselineArtefacts.ts`, etc.) are NOT present on `claude/evaluate-new-features-waqfY`. They were shipped on the separate F1 implementation branch `claude/stream-1-onboarding-scope` (commit `e15e2c58`). A future session reading this progress file on the wrong branch would assume the work is done and skip required backend chunks.
- **Reason:** Real cross-branch documentation drift. Verifiable: `ls migrations/0277*` returns "No such file" on this branch; `git show --stat e15e2c58` confirms the work lives elsewhere.
- **Fix:** Added an explicit "Branch scope note" at the top of the progress file naming the F1 implementation branch and warning readers on other branches not to re-implement.

**[ACCEPT] docs/baseline-capture-spec.md:214** — "Define the pending-to-ready transition"
- **Issue:** The §5.1 state machine declares `pending → (readiness met) → ready`, but no surface in §5.2 is permitted to write that transition (subscriber, cron, manual, admin reset are all forbidden writers; only `captureBaselineService` writes). §5.3 step 1's lock acquisition matches `WHERE status='ready'`, so the very first capture for a freshly-inserted `pending` row would affect zero rows and exit cleanly — auto-capture would never fire on first-ever capture.
- **Reason:** Real spec gap. Internally inconsistent — Codex correctly identified that the implementation guidance, if followed literally, would never trigger initial capture.
- **Fix:** (1) Removed the spurious `pending → ready` transition from the state machine; clarified that readiness is a pure read by `baselineReadinessService.evaluate`, and the `captureBaselineService` lock acquisition itself transitions `pending → capturing`. (2) Updated §5.3 step 1's SQL predicate to `WHERE status IN ('pending','ready')`. (3) Updated the §5.1 prose example to match.

**Decisions:** 2 ACCEPTED, 0 REJECTED. Iteration 1 lint+typecheck clean (0 errors).

---

## Iteration 2

After iter-1 fixes, Codex re-reviewed and found two new spec defects exposed by the now-cleaner state machine.

### Findings

**[ACCEPT] docs/baseline-capture-spec.md:388** — "Enforce one active baseline across versions"
- **Issue:** §10 invariant "Exactly one active baseline per sub-account" is enforced via `UNIQUE INDEX (subaccount_id, baseline_version) WHERE status <> 'reset'`. But this only prevents duplicate rows of the *same* version. Admin reset bumps `baseline_version` and creates a new row in `pending` while the prior row may not yet be `reset` (transactional ordering, or stale jobs creating future versions). Two non-reset rows at different versions both satisfy the partial-unique predicate.
- **Reason:** Real defect. The index doesn't enforce the stated invariant. Unambiguous fix: drop `baseline_version` from the index key.
- **Fix:** (1) Changed §3 migration index to `UNIQUE INDEX ... ON subaccount_baselines(subaccount_id) WHERE status <> 'reset'` with explanatory comment. (2) Updated the §10 invariant text to describe the new index and require admin reset to be transactional (`UPDATE prior SET status='reset'` THEN `INSERT new` in one tx). (3) Added a second integration-test requirement: assert the admin-reset transaction succeeds while a non-transactional double-insert fails.

**[ACCEPT] docs/baseline-capture-spec.md:235** — "Keep terminal failed baselines out of retry pickup"
- **Issue:** §5.4 explicitly says `failed` is terminal and `<ManualBaselineForm>` is the recovery path. But the same paragraph says the cron picks up rows where `status IN ('ready', 'failed') AND capture_attempt_count > 0`. Including `failed` in the retry pickup contradicts the state-machine design — exhausted baselines would be re-enqueued by the cron forever.
- **Reason:** Self-contradiction in the spec. Clean fix: drop `failed` from the cron's pickup predicate.
- **Fix:** (1) Updated §5.4 text to `WHERE status='ready' AND capture_attempt_count > 0`, with explicit note that `failed` is terminal. (2) Updated the matching index in §3 (`subaccount_baselines_pending_retry_idx`) from `WHERE status IN ('ready', 'failed')` to `WHERE status = 'ready'`, with comment explaining the exclusion.

**Decisions:** 2 ACCEPTED, 0 REJECTED. Iteration 2 lint+typecheck clean.

---

## Iteration 3

After iter-2 fixes to the spec, Codex re-reviewed and surfaced two consistency issues in the upstream `tasks/builds/stream-1-onboarding-scope/plan.md` invariants list.

### Findings

**[ACCEPT] tasks/builds/stream-1-onboarding-scope/plan.md:128** — "Use the declared retry status in runtime invariant"
- **Issue:** The plan's runtime invariant says `captureBaselineService.run` asserts row status is `pending` or `retrying` on entry. But the schema CHECK constraint enumerates `'pending', 'ready', 'capturing', 'captured', 'failed', 'manual', 'reset'` — `retrying` is not a valid status. The §5.3 lock SQL (after iter-1 fix) acquires rows where `status IN ('pending','ready')`. An implementation that follows this invariant literally would assert false on every retry and fail fast.
- **Reason:** Real schema/invariant mismatch. Fix is unambiguous.
- **Fix:** Changed invariant to assert `pending` or `ready`, with explicit note "the schema status enum has no `retrying` state — retryable failures revert to `ready` per §5.4."

**[ACCEPT] tasks/builds/stream-1-onboarding-scope/plan.md:132** — "Keep fallback cron from skipping pending baselines"
- **Issue:** The plan's invariant says "Fallback job exits early if baseline exists." But the fallback cron's purpose is to recover `pending` and `ready` rows missed by the event-driven path or due for retry. If the cron exits when ANY non-reset baseline exists, it would skip exactly the rows it is meant to capture. The fallback would be a permanent no-op for every sub-account that already has a row (which is every sub-account with onboarding completed — i.e. all of them).
- **Reason:** Self-defeating invariant. Fix is to narrow the early-exit guard to *terminal* states only (`captured`, `manual`, `failed`).
- **Fix:** Updated invariant to "exits early when a baseline is already terminal" and listed `captured`, `manual`, `failed` as the early-exit triggers. Added explicit note that `pending` and `ready` are recovery targets and MUST NOT trigger early exit.

**Decisions:** 2 ACCEPTED, 0 REJECTED. Iteration 3 lint+typecheck clean.

---

## Changes Made

- `tasks/builds/subaccount-artefacts/progress.md` — added "Branch scope note" callout warning readers on the wrong branch not to re-implement F1 chunks (iter-1).
- `docs/baseline-capture-spec.md` — fixed §3 unique index (drop `baseline_version` from key), fixed §3 retry index (drop `failed` from predicate), fixed §5.1 state machine (remove unwriteable `pending→ready` transition), fixed §5.3 lock SQL (accept `pending` or `ready`), fixed §5.4 cron predicate (drop `failed`), updated §10 active-baseline invariant to require transactional admin reset (iters 1+2).
- `tasks/builds/stream-1-onboarding-scope/plan.md` — fixed runtime ownership invariant (status `retrying` → `ready`), fixed fallback-cron early-exit invariant (any non-reset → terminal-only) (iter-3).

## Rejected Recommendations

None. All 6 Codex findings across 3 iterations were real, verifiable spec defects — every one ACCEPTED.

---

## Notes on scope

The branch under review accumulates ~85k LOC of merged feature work plus the most recent docs commits. Codex correctly focused its findings on the only commits not yet reviewed (the spec/progress doc updates `16cb227b` and `1f42c980`); the merged feature code had already passed `pr-reviewer` + `chatgpt-pr-review` cycles in their respective PRs (#255 agentic commerce, #257 framework, #258 workflows v1 phase 2, etc., per the existing review log files in `tasks/review-logs/`). No additional findings were raised against the merged code, which matches the expectation that previously-merged work is not re-relitigated.

All 6 findings concerned the F3 baseline-capture spec or the F3-related stream-1 plan.md. The fixes harden the spec / plan in advance of implementation; no production code was changed.

---

**Verdict:** APPROVED (3 iterations, 6 spec defects fixed; lint+typecheck clean throughout)
