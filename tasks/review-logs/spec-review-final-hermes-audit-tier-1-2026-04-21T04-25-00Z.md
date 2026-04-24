# Spec Review Final Report — Hermes Audit Tier 1

**Spec:** `tasks/hermes-audit-tier-1-spec.md`
**Spec commit at start:** `947111d0ddb919023ddb7bdfd58af8579197499a`
**Spec commit at finish:** `947111d` + iterations 1-5 edits (uncommitted)
**Spec-context commit:** `00a67e9bec29554f6ca9cb10d1387e7f5eeca73f`
**Iterations run:** 5 of 5 (lifetime cap)
**Exit condition:** `iteration-cap` AND `two-consecutive-mechanical-only` (iterations 4 & 5)

---

## Iteration summary

| # | Accepted | Rejected | Directional | HITL |
|---|----|----|----|----|
| 1 | — | — | 1 | resolved (apply) |
| 2 | — | — | 1 | resolved (apply) |
| 3 | 7 | 0 | 2 | resolved (apply × 2) |
| 4 | 6 | 1 (already-resolved) | 0 | none |
| 5 | 6 | 0 | 0 | none |

---

## Mechanical changes applied (iterations 4-5)

### §1 Summary / §3 In-scope
- Phase A bullet: "two agent-run detail surfaces" (PlaybookRunDetailPage dropped per iter-3 HITL 3.1).
- Phase B bullet: `trajectoryPassed` now called a reserved forward-compatible slot.
- Phase C bullet: `assertWithinRunBudgetFromLedger` on LLM path; `assertWithinRunBudget` scoped to Slack/Whisper.
- §3 in-scope list updated to match.

### §4 File inventory
- §4.1 `PlaybookRunDetailPage.tsx` row removed; totals updated.
- §4.2 `workspaceMemoryService` row extended for `options?` bag; `outcomeLearningService` row explains `overrides` rationale; `workspaceMemoryServicePure.test.ts` relabelled `Extend` (file exists); new impure `workspaceMemoryService.test.ts` row added.
- §4.3 `runCostBreaker` row names two new sibling exports explicitly; `llmRouter` row updated.
- §4 inventory lock exempts generated `tasks/` artifacts.
- §4.5 `trajectoryService.ts` entry clarified — Phase B does NOT consume `TrajectoryDiff.pass`.

### §5 / §6 / §7 Phase prose
- §5.1 "agent or playbook run" → "direct agent-run surface".
- §5.2.1 canonical semantics vs client import site (`shared/runStatus.ts` vs `client/src/lib/runStatus.ts`).
- §5.3 "all four host pages" → "all three host pages"; §5.5 table row removed; §5.9 done #1 updated.
- §6.3.1 write-once guard rewritten — SQL-level `WHERE run_result_status IS NULL` + `.returning({ id })` + `updated.length === 0`. Dropped vague `finaliseAgentRun` service-boundary reference.
- §6.4 signature block includes `options` bag; second-caller bullet describes override pattern.
- §6.7.1 new "Caller-specific exception — human-curated content" subsection.
- §7.3 pseudocode calls `assertWithinRunBudgetFromLedger`; §7.4.1 pins the two new sibling exports explicitly; §7.9 done #1 names the correct helper.

### §8 Contracts
- §8.3 `extractRunInsights` signature now includes `options?: ExtractRunInsightsOptions`; full interface added.
- §8.3 `runCostBreaker` exports: 3 unchanged + 2 new siblings with full signatures.
- §8.3 `workspaceMemoryServicePure` / `memoryEntryQualityServicePure` exports split; `HALF_LIFE_DAYS` relocated to the latter.

### §9 Testing posture
- §9.2 `workspaceMemoryServicePure.test.ts` block labelled `(extend)`; no `options.overrides` coverage here.
- §9.2 new `workspaceMemoryService.test.ts` block pins the impure `options.overrides` integration test.

### §11 Rollout / deferred
- §11.4 new deferred item #10: Playbook-run cost visibility (two follow-up-spec options documented).
- §11.5 #1 "four host pages" → "three host pages" + named surfaces.

---

## Rejected findings

**Iteration 4 Finding #2** — Codex re-raised the frontend + API-contract test deviations as lacking an explicit HITL framing override. **Reject reason:** already HITL-resolved in iteration 1 (`tasks/spec-review-checkpoint-hermes-audit-tier-1-1-*.md`); the §9 lines 891-896 acknowledgement section is the documented override. Re-raising a resolved directional finding does not advance the spec.

No other rejections.

---

## Directional findings resolved via HITL

| Iteration | Finding | Decision |
|---|---|---|
| 1 | Frontend + API-contract test framing deviation | apply |
| 2 | (prior-session finding) | apply |
| 3.1 | `PlaybookRunDetailPage` identity/status mismatch → drop from Phase A | apply |
| 3.2 | `outcomeLearningService` "neutral partial" regresses human-curated lessons → `options.overrides` | apply |

All four HITL findings were resolved with `apply` (no modification, no reject, no `stop-loop`).

---

## Open questions deferred by `stop-loop`

None. The loop exited at the 5-iteration lifetime cap with both "iteration-cap" and "two-consecutive-mechanical-only" conditions triggered.

---

## Mechanically tight, but verify directionally

This spec is mechanically tight against the rubric, the pre-production framing assumptions, and Codex's best-effort review across five iterations. The human has adjudicated every directional finding that surfaced. However:

- The review did not re-verify the framing assumptions. If the product context has shifted since `docs/spec-context.md` was last updated, re-read §1 / §2 / §3 once more before calling the spec implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not see.
- Sprint sequencing, scope trade-offs, and priority decisions are still the human's job.
- The spec contains two HITL-approved testing-posture deviations (RTL component test + route integration test). If those deviations feel wrong on second reading, revisit before implementation — hard to undo once code lands.

**Recommended next step:** read §1 / §9 / §11 once more, confirm intent, commit the spec edits, begin implementation. Suggested commit: `spec(hermes-tier-1): apply spec-reviewer iter 1-5 — 4 HITL decisions + 13 mechanical fixes`.

---

## Files in the review trail

- `tasks/hermes-audit-tier-1-spec.md` — spec itself.
- `tasks/spec-review-checkpoint-hermes-audit-tier-1-{1,2,3}-*.md` — HITL checkpoints.
- `tasks/spec-review-log-hermes-audit-tier-1-{1..5}-*.md` — per-iteration mechanical logs.
- `tasks/_spec-review-hermes-iter{4,5}-codex-output.txt` — Codex raw outputs.
- This file — consolidated review report.
