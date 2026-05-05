# Spec Review Final Report

**Spec:** `docs/superpowers/specs/2026-04-30-dev-pipeline-coordinators-spec.md`
**Spec commit at start:** `c09840bb0f72cae84bde766e0652b6e008fc56cb`
**Spec commit at finish:** `100ea7c52b62cc23a280a20db07f6331410057ad`
**Spec-context commit:** `c09840bb0f72cae84bde766e0652b6e008fc56cb`
**Iterations run:** 5 of 5
**Exit condition:** iteration-cap
**Verdict:** READY_FOR_BUILD (5 iterations, 14 mechanical fixes applied, 4 AUTO-DECIDED items in tasks/todo.md for human review)

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|---|---|---|---|---|---|---|
| 1 | 4 | 3 | 5 | 0 | 0 | 0 | 1 |
| 2 | 3 | 0 | 3 | 0 | 0 | 1 | 0 |
| 3 | 3 | 1 | 4 | 0 | 0 | 0 | 0 |
| 4 | 3 | 0 | 2 | 0 | 0 | 1 | 0 |
| 5 | 3 | 0 | 2 | 0 | 0 | 0 | 1 |

---

## Mechanical changes applied

### §1.3 Context loading (spec-coordinator entry)
- Added PLANNING status write to current-focus.md (with build_slug: none placeholder) at coordinator entry to acquire concurrency lock before any other work (Finding #2).
- Split entry check into three cases: NONE/MERGED (start fresh), PLANNING+paused-handoff (resume), PLANNING+no-matching-handoff/BUILDING/REVIEWING/MERGE_READY (refuse) (Findings #2, #9).
- After §1.7 slug derivation, spec now requires writing build_slug back to current-focus.md (Finding #8).

### §1.4 TodoWrite list (spec-coordinator)
- Updated item 1 to include PLANNING status write (Finding #2 consolidated with #R1).
- Reordered items: slug derivation (item 4) before mockup loop (item 5) (Finding #1).
- Fixed stale parenthetical from "Item 4 (mockup loop)" to "Item 5 (mockup loop)" (Finding #R7).

### §1.5 Branch-sync S0
- Added early-exit rule: reset current-focus.md to NONE before refusing on 30+ commits-behind (Finding #12).

### §1.6 Brief intake
- Added PLANNING lock release (current-focus.md → NONE) before stopping on Trivial briefs (Finding #12).

### §1.7/§1.8 Step ordering
- Swapped: §1.7 is now Build slug derivation (Step 4), §1.8 is now Mockup loop (Step 5). Added "Why before mockup loop" note (Finding #1).

### §4.3.4 chatgpt-plan-review resume probe
- Scoped the log-file glob from unscoped `chatgpt-plan-review-*.md` to slug-scoped `chatgpt-plan-review-{slug}-*.md` (Finding #15).

### §5.1.2 Adversarial auto-trigger preamble
- Updated from "branch's full diff (committed + staged + unstaged + untracked)" to "branch's committed diff against origin/main" with explanatory note (Finding #16).

### §6.5 Auto-commit posture
- Added `tasks/builds/{slug}/progress.md` to spec-coordinator's end-of-Phase-1 commit file list (Finding #R3).
- Updated feature-coordinator justification: removed "resume from last committed chunk" claim; replaced with accurate "restart on same branch with committed changes preserved" description (Finding #13).

### §8.2 Sync command sequence
- Fixed git merge --abort bug: replaced the erroneous abort-on-already-up-to-date path with `git merge-base --is-ancestor origin/main HEAD` pre-check (Finding #3).

### §8.3 Migration collision detection
- Replaced `git log ... | head -20` approach with file-comparison using `git diff HEAD...origin/main --name-only` + prefix extraction + `comm -12` collision detection (Finding #4).

### §10.3.1 Rollout Step 5
- Changed "finish on OLD coordinator" to "restart on NEW feature-coordinator (architect re-runs from scratch)" (Finding #7).
- Changed "resume" to "restart" to match Phase 2's restart-not-resume posture (Finding #10).

---

## Rejected findings

None. All Codex/rubric findings were either accepted as mechanical or auto-decided as directional.

The "main-branch protection" finding (Open Question §1) was raised by Codex in iterations 2 and 4. Both times it was AUTO-DECIDED reject — this is an intentionally open product design question flagged in the spec for chatgpt-spec-review and operator decision. The spec's Open Question #1 documents this explicitly. See tasks/todo.md for the deferred action.

---

## Directional and ambiguous findings (autonomously decided)

| Iter | Finding | Classification | Decision | Rationale |
|---|---|---|---|---|
| 1 | §6.2 "frontmatter description must include TodoWrite skeleton" | Ambiguous | AUTO-DECIDED reject | YAML description field is a one-liner; body Step 1 sections in all agents satisfy the intent |
| 2 | Open questions §1 — main-branch protection | Directional | AUTO-DECIDED reject | Explicitly open question flagged for chatgpt-spec-review; product design choice not for automated review |
| 4 | Open questions §1 — same finding re-raised | Directional | AUTO-REJECT convention | Same rejection applies; Codex severity escalation is not an adjudication criterion |
| 5 | §2.16/§6.4.2 — Phase 2 hard-escalation current-focus.md state | Ambiguous | AUTO-DECIDED accept (minor clarification) | Hard escalations should set NONE per restart-not-resume posture; non-blocking clarification |

All AUTO-DECIDED items are in `tasks/todo.md` under "Deferred spec decisions — dev-pipeline-coordinators".

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review across 5 iterations. The human has adjudicated every directional finding that surfaced. However:

- The review did not re-verify the framing assumptions at the top of this document. If the product context has shifted since the spec was written (stage of app, testing posture, rollout model), re-read the spec's Implementation philosophy / Execution model / Headline findings sections yourself before calling the spec implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not see. Automated review converges on known classes of problem; it does not generate insight from product judgement.
- **Open Question #1 (main-branch protection)** remains unresolved. This MUST be resolved before the pipeline ships. Recommended: add a guard in spec-coordinator that refuses to start if `git branch --show-current` matches main/master/develop.
- **Open Question #1 resolution** requires the operator's decision between "refuse on integration branch" (safer) and "auto-create feature branch" (more automated but destructive).

**Recommended next step:** resolve Open Question #1, then start implementation per the spec's §10 acceptance criteria.
