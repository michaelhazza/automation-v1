# Spec Review Final Report

**Spec:** `docs/improvements-roadmap-spec.md`
**Spec HEAD commit at start:** `6a8e48b33d88c1218cac7a694f746ffc8c011abd` (working tree carries uncommitted spec-reviewer edits across iterations 1-5)
**Spec HEAD commit at finish:** `6a8e48b33d88c1218cac7a694f746ffc8c011abd` (no commits created; edits remain in working tree)
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iterations run:** 5 of 5
**Exit condition:** iteration-cap

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted (mechanical) | Rejected | Directional | Ambiguous | HITL status |
|---|---|---|---|---|---|---|---|
| 1 | ~8 | ~2 | 7 | 1 | 2 | 0 | resolved |
| 2 | ~7 | ~1 | 6 | 1 | 1 | 0 | resolved |
| 3 | ~6 | ~1 | 5 | 0 | 2 | 0 | resolved |
| 4 | 6 | 0 | 6 | 0 | 2 | 0 | resolved |
| 5 | 8 | 0 | 8 | 0 | 0 | 0 | none |

Iteration counts for rounds 1-3 are reconstructed from carried context; iteration 4 and 5 counts are exact.

---

## Mechanical changes applied in iteration 5

### Verdict legend
- Rewrote the `BUILD WHEN DEPENDENCY SHIPS` definition to cover the common same-sprint-after-dependency case (previously read "immediately after ... lands" which contradicted same-sprint rows like P1.2, P3.2, P3.3, P4.1, P4.3, P4.4).

### P1.2 — Replay pipeline
- Rewrote the "same harness and injection seam as P0.1" claim. P0.1's explicit non-goal is the full `routeCall` refactor; the replay runner now introduces its own minimal, runner-scoped router-injection seam inside `scripts/run-regression-cases.ts` and reuses P0.1 only for fixture wiring and the extracted pure helpers.

### P1.2 — Capture pipeline contradiction
- Rewrote the "one extra line" inline snippet to enqueue a `regression-capture` pg-boss job (matching the Files table). Capture is never inline; worker invokes `regressionCaptureService.captureFromAuditRecord` off the request path.

### P1.2 — Risk / replay enablement
- Removed the undefined "opt-in (does not run automatically until enabled per-org)" claim. Mitigation is now stated as `runCostBreaker` per-org monthly cost cap as the single enforcement point. Updated the `regressionReplayCron.ts` Files row to match (cost enforcement per-job in the processor, not at cron-enqueue time).

### P4.1 — Universal-skill contract reference
- Fixed the wrong rule citation: `See P2.1's checkpoint persistence contract Rule 2` → `Rule 6 (activeTools is recomputed on resume, never serialised)`.

### P4.1 — Files to change drift
- Added `server/config/limits.ts` row for `MIN_TOOL_ACTION_CONFIDENCE = 0.5`.
- Added `scripts/gates/verify-confidence-escape-hatch-wired.sh` row for the new static gate.

### P4.3 — Risk section
- Removed the unsupported "the threshold is configurable per-org" claim; replaced with an accurate summary of the three heuristics actually declared in the Design section (`complexityHint`, word-count, skill-count).

### P3.3 — Reference trajectory format
- Removed the `$schema` field pointing at a `.json` schema file that the spec never ships. Replaced with a one-line note that `shared/iee/trajectorySchema.ts` (Zod) is the single source of truth.

---

## Mechanical changes applied from iteration 4 HITL resolution (before iteration 5)

### P3.1 — Bulk-run contract (Finding 4.1, apply-with-modification Option A)
- Extended migration 0086 SQL block to add nullable `parent_run_id uuid REFERENCES playbook_runs(id)` and `target_subaccount_id uuid REFERENCES subaccounts(id)` columns on `playbook_runs`, plus a widened `status` CHECK constraint that includes `'partial'`.
- Added explanatory paragraph defining the bulk parent/child key shape: `(parent_run_id, target_subaccount_id)` is the idempotency key; `'partial'` is reserved for a bulk parent with mixed success/failure children. No new tables.
- Updated `migrations/0086_playbook_run_mode.sql` and `server/db/schema/playbookRuns.ts` rows in the P3.1 Files table to reflect the three new columns and the widened status enum.
- Updated the Sprint 4 summary row (#17) and the migration rollback table row for 0086 to match.

### P4.3 — Replanning storage shape (Finding 4.2, apply-with-modification Option B)
- Rewrote the Replanning-on-failure prose to "The revised plan overwrites `plan_json` with a new timestamp; the previous plan is discarded. `parsePlan()` returns a single plan object — no revisions array, no versioned envelope, no UI toggle." Added a note that an envelope can be added additively later if P2.2's reflection loop ever needs replan history.

---

## Rejected findings

Iteration 5 rejected none — all 8 Codex findings were accepted as mechanical. Earlier iteration rejections are in the per-iteration scratch files for that round.

---

## Directional and ambiguous findings (resolved via HITL)

| Iteration | Finding | Classification | Human decision | Modification applied |
|---|---|---|---|---|
| 4 | 4.1 — P3.1 bulk-run contract shape | directional | apply-with-modification, Option A | Extended migration 0086 with `parent_run_id`, `target_subaccount_id`, `'partial'` status; mirrored in schema file; updated P3.1 Files table. |
| 4 | 4.2 — P4.3 replanning envelope vs overwrite | directional | apply-with-modification, Option B | Rewrote P4.3 Design prose to "overwrite plan_json with new timestamp; previous plan discarded"; `parsePlan()` returns single plan object. |

(Iterations 1-3 directional decisions are captured in their respective resolved checkpoint files under `tasks/`.)

---

## Total mechanical changes across the 5-iteration run

- Iteration 1: 7 (approximate, reconstructed)
- Iteration 2: 6 (approximate, reconstructed)
- Iteration 3: 5 (approximate, reconstructed)
- Iteration 4: 6 (exact — listed in iteration 4 checkpoint)
- Iteration 5: 8 (exact — listed above)

**Approximate total: 32 mechanical changes applied across the full run.**

---

## Open questions deferred by `stop-loop`

None. The loop exited on iteration cap with no `stop-loop` decisions.

---

## Unresolved findings deferred to a future review

None. Iteration 5 surfaced 8 findings, all of which were adjudicated as mechanical and applied. No HITL checkpoint was written for iteration 5. The rubric pass surfaced no additional findings beyond Codex's.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review over 5 iterations. The human has adjudicated every directional finding that surfaced (4 total across iterations 1-4; iteration 5 was mechanical-only). However:

- The review did not re-verify the framing assumptions (pre-production, rapid-evolution testing, prefer-existing-primitives, no-feature-flags). If the product context has shifted since the spec was written, re-read the spec's Verdict legend, Implementation philosophy, and Execution model sections before calling the spec implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not see. Automated review converges on known classes of problem; it does not generate insight from product judgement.
- The review did not prescribe what to build next. Sprint sequencing, scope trade-offs, and priority decisions are still the human's job.
- All spec-reviewer edits across the 5-iteration run remain uncommitted in the working tree on branch `claude/review-recommendations-18oDD`. The human should review the full diff before committing.

**Recommended next step:** read the spec's framing sections (first ~200 lines) one more time, confirm the headline findings and the verdict legend match your current intent, diff the working tree against HEAD to review all mechanical edits from the 5-round loop, and then commit and start implementation.
