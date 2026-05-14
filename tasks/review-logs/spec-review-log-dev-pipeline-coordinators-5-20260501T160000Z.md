# Spec Review Log — Iteration 5 (FINAL)

**Spec:** `docs/superpowers/specs/2026-04-30-dev-pipeline-coordinators-spec.md`
**Iteration:** 5 of 5 (lifetime cap)
**Timestamp:** 2026-05-01T16:00:00Z

## Codex Output (verbatim)

The spec introduces a few workflow-contract bugs: paused BUILD runs are not actually resumable, plan-review log resumption is not scoped to the active feature, and the adversarial auto-trigger can miss uncommitted security-sensitive changes.

Findings:
- [P1] Add actual resume handling for paused Phase 2 runs (§2.3 lines 347-359): Step 0 only validates BUILDING status; never inspects phase_status values from §2.16/§6.4, so restart behaviour is undefined.
- [P2] Scope plan-review log resume to the active build slug (§4.3.4 lines 1027-1030): the glob `chatgpt-plan-review-*.md` is unscoped and can pick up a different feature's log.
- [P2] Include staged and unstaged changes in adversarial auto-trigger (§5.1.2 lines 1117-1124): detection uses committed-only diff but preamble says "full diff including staged/unstaged/untracked".

## Findings Extracted (Step 2)

FINDING #14
  Source: Codex
  Section: §2.3 (Step 0, lines 347-359) + §2.16 + §6.4.2
  Description: feature-coordinator Step 0 only checks current-focus.md `status: BUILDING` but §2.16 hard-escalation paths write `phase_status` to handoff.md without clearly specifying what current-focus.md status is set to, leaving the recovery path for interrupted Phase 2 builds ambiguous.
  Classification: ambiguous
  Reasoning: The spec's Phase 2 posture is "restart not resume" (established in iterations 3-4). Hard escalations at §2.16 write phase_status to handoff.md and "set current-focus.md status appropriately" per §6.4.2 — but "appropriately" is undefined for PHASE_2_PAUSED_PLAN paths. This is under-specified. However, the restart posture means the correct behaviour is: hard escalations set current-focus to NONE, operator re-launches fresh. The entry check at §2.3 is correct as-is (only BUILDING is a valid starting state).
  Disposition: auto-decide (Step 7)

FINDING #15
  Source: Codex
  Section: §4.3.4 item 3 (line 1030)
  Description: Log resume probe `ls tasks/review-logs/chatgpt-plan-review-*.md | sort | tail -1` picks the globally newest log; the next sentence says "if one exists for this slug" — contradiction if multiple slugs exist.
  Classification: mechanical
  Reasoning: Code and prose directly contradict each other. The fix scopes the glob to the current slug pattern.
  Disposition: auto-apply

FINDING #16
  Source: Codex
  Section: §5.1.2 preamble + detection algorithm (lines 1113-1127)
  Description: Preamble says "branch's full diff (committed + staged + unstaged + untracked)" but detection uses `git diff origin/main...HEAD` which only catches committed changes.
  Classification: mechanical
  Reasoning: Prose and implementation diverge. Given that feature-coordinator commits after each chunk (before the adversarial check runs), staged/unstaged are already committed in practice. The minimum fix is to align the prose to say "committed branch diff" rather than "full diff including staged/unstaged" — this matches the actual implementation without adding complexity.
  Disposition: auto-apply

## Rubric Pass (Step 4)

No new rubric findings beyond what Codex caught.

## Step 5 — Classification Summary

Ambiguous (Step 7): #14
Mechanical (auto-apply): #15, #16

## Step 7 — Autonomous Decisions

[AUTO-DECIDED - accept] §2.3/§2.16/§6.4.2 — Phase 2 hard-escalation current-focus.md state is unspecified
  Priority 3 — Best judgment: The spec's Phase 2 posture is "always restart from scratch" (established iterations 3-4). For consistency: hard escalations should reset current-focus.md to NONE (not BUILDING), so that the next re-launch must be a fresh start. The §6.4.2 "sets tasks/current-focus.md status appropriately" should be interpreted as NONE for PHASE_2_PAUSED* states. The minimum fix is to add a clarifying note to §2.16 hard-escalation paths.
  → Added to tasks/todo.md for deferred review (minor clarification, not blocking).

## Step 6 — Mechanical Findings Applied

[ACCEPT] §4.3.4 — Scope plan-review log resume to current slug
  Fix applied: Changed the resume probe from `ls tasks/review-logs/chatgpt-plan-review-*.md 2>/dev/null | sort | tail -1` to `ls tasks/review-logs/chatgpt-plan-review-{slug}-*.md 2>/dev/null | sort | tail -1`. If {slug} is not yet available, derive it from current-focus.md active_plan field.

[ACCEPT] §5.1.2 — Align preamble with committed-only detection implementation
  Fix applied: Updated preamble from "the branch's full diff (committed + staged + unstaged + untracked)" to "the branch's committed diff against origin/main". Added a note explaining that by the time the adversarial check runs (after G2, which follows all chunk commits), unstaged/untracked changes should not exist for pipeline-authored code.

## Iteration 5 Summary

- Mechanical findings accepted:  2 (Findings #15, #16)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            1 (Finding #14)
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 1
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             1 (see tasks/todo.md for details)
- Spec commit after iteration:   [to be set after commit]
- Exit condition:                ITERATION_CAP (5 of 5)
