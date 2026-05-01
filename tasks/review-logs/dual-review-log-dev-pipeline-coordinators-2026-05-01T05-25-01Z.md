# Dual Review Log — dev-pipeline-coordinators

**Files reviewed:**
- `.claude/agents/builder.md` (new)
- `.claude/agents/mockup-designer.md` (new)
- `.claude/agents/chatgpt-plan-review.md` (new)
- `.claude/agents/spec-coordinator.md` (new + pr-reviewer fixes)
- `.claude/agents/finalisation-coordinator.md` (new + pr-reviewer fixes)
- `.claude/agents/feature-coordinator.md` (rewrite + pr-reviewer fixes)
- `.claude/agents/adversarial-reviewer.md` (updated)
- `.claude/agents/dual-reviewer.md` (updated)
- `CLAUDE.md` (updated)

**Iterations run:** 2/3
**Timestamp:** 2026-05-01T05:25:01Z

---

## Iteration 1

Codex review (`codex review --base main`) produced 4 findings.

[ACCEPT] `.claude/agents/finalisation-coordinator.md:258` — [P1] Write the Phase 3 handoff before setting `current-focus` to `MERGE_READY`.
  Reason: real workflow gap. Step 9 wrote `current-focus.md` to MERGE_READY on disk, then Step 10 wrote handoff.md and committed both. If interrupted between the Step 9 disk write and the Step 10 handoff write, the working tree shows MERGE_READY but no Phase 3 section in handoff.md. Re-running finalisation-coordinator would fail its REVIEWING entry guard (line 31), and spec-coordinator refuses MERGE_READY (line 39 in spec-coordinator.md), leaving the pipeline stuck. Existing text on line 258 acknowledged the risk via "warn the operator" but did not eliminate it. The right fix is to compose the new current-focus.md content in Step 9 (in-memory only) and have Step 10 write handoff.md FIRST, then current-focus.md, then commit both atomically. The reverse mid-state (handoff.md updated, current-focus.md still REVIEWING) is recoverable — finalisation-coordinator can be re-run from Step 9. Fix: restructured Step 9 / Step 10 in finalisation-coordinator.md.

[ACCEPT] `.claude/agents/feature-coordinator.md:258` — [P1] Re-review the diff after `dual-reviewer` applies code changes.
  Reason: real coverage gap. §8.3 records pr-reviewer APPROVED, then §8.5 invokes dual-reviewer which may apply edits, then Step 10's invariant carries forward "pr-reviewer verdict is APPROVED" — but pr-reviewer never saw the post-dual-reviewer diff. Fix: added a "Re-review check" at end of §8.5 that re-invokes pr-reviewer if dual-reviewer's log records non-empty "Changes Made". When dual-reviewer is skipped (Codex unavailable) or makes no edits, no re-review is needed.

[ACCEPT] `.claude/agents/feature-coordinator.md:125-132` — [P2] Persist the resume environment snapshot to `progress.md`.
  Reason: real spec bug. Step 6 says "Capture and compare against values stored in `progress.md`" but the agent definition never described WRITING those values anywhere. Fix: clarified the resume-time check to require a prior `## Environment snapshot` section (skip on fresh runs); added a "Chunk-completion progress write" subsection that rewrites the snapshot section after each chunk's commit, recording HEAD, package-lock MD5, migration count, and timestamp.

[ACCEPT] `.claude/agents/finalisation-coordinator.md:90-98` — [P3] Calculate actual overlap instead of treating the whole branch diff as overlap.
  Reason: real bug. `git diff origin/main...HEAD --name-only` (three-dot) returns the complete branch-only changeset, not the intersection with main's recent changes. The "overlapping files" prompt would fire on nearly every finalisation run, training operators to rubber-stamp it. Fix: capture pre-merge state (OLD_BASE, PRE_MERGE_HEAD), then compute the intersection of `git diff $OLD_BASE..$PRE_MERGE_HEAD --name-only` with `git diff $OLD_BASE..origin/main --name-only` using `comm -12`. Added an inline note explaining why three-dot is not the right calculation, to prevent regression.

## Iteration 2

Codex review produced 1 finding.

[REJECT] `.claude/agents/feature-coordinator.md:280-286` — [P1] Re-run pr-reviewer after any dual-reviewer fix round.
  Reason: based on misreading of dual-reviewer's contract. dual-reviewer (`.claude/agents/dual-reviewer.md`) is a single sub-agent invocation that runs UP TO 3 internal iterations of its own loop. The log's `## Changes Made` section is CUMULATIVE across all iterations of that single invocation (line 134-135 of dual-reviewer.md: "list of files edited and what changed — one line each" — written once at the end of all iterations). dual-reviewer's auto-commit step (line 156) explicitly skips committing if "no files changed across the whole loop". feature-coordinator §8.5 invokes dual-reviewer exactly once — there is no "multi-round dual-reviewer" pattern in the pipeline. So the trigger condition (non-empty "Changes Made" section in the cumulative log) correctly captures all changes dual-reviewer made within its single invocation. Codex's iteration-2 finding presupposes a multi-invocation pattern that does not exist in this pipeline. No change made.

---

## Changes Made

- `.claude/agents/finalisation-coordinator.md` — restructured Step 9 / Step 10 so handoff.md is always written before current-focus.md transitions to MERGE_READY (eliminates the stuck-pipeline mid-state).
- `.claude/agents/finalisation-coordinator.md` — replaced incorrect three-dot diff with merge-base-anchored intersection for overlap detection; added explanatory note.
- `.claude/agents/feature-coordinator.md` — added "Re-review check" at end of §8.5 that re-invokes pr-reviewer when dual-reviewer applied changes.
- `.claude/agents/feature-coordinator.md` — clarified resume-time environment snapshot check (skip on fresh runs); added chunk-completion progress write subsection that persists the snapshot in progress.md after each chunk commit.

## Rejected Recommendations

- Iteration 2 [P1] re-run pr-reviewer after any dual-reviewer fix ROUND — rejected as based on a misread of dual-reviewer's single-invocation, cumulative-log contract. The §8.5 re-review check as written correctly covers the only path where dual-reviewer changes the branch.

---

**Verdict:** APPROVED (2 iterations, 4 accepted findings applied, 1 rejected with rationale)
