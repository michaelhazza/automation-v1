# Spec Review Log — Iteration 2

**Spec:** `docs/superpowers/specs/2026-04-30-dev-pipeline-coordinators-spec.md`
**Iteration:** 2
**Timestamp:** 2026-05-01T13:00:00Z

## Codex Output (verbatim)

The new spec still contains workflow-breaking gaps: it can auto-push work directly to `main`, its documented Phase 1 pause/resume path cannot be entered again under the declared state machine, and the rollout sequence relies on an "old" coordinator that the same spec says will no longer exist.

Findings:
- [P1] Reject launches from main before coordinator auto-pushes (Open questions §1, line 1991): spec leaves main-branch protection as open question but §6.5 makes all three coordinators auto-push.
- [P2] Define a real state transition for paused Phase 1 runs (§1.15, line 312): resume path cannot work — §1.3 only allows NONE or MERGED, so PLANNING state after pause blocks re-entry.
- [P2] Remove the impossible "finish on OLD coordinator" rollout step (§10.3.1, line 1943): §10.3.4 says OLD coordinator is fully replaced with no transitional period, contradicting Step 5.

## Findings Extracted (Step 2)

FINDING #5
  Source: Codex
  Section: Open questions §1 (line 1991) + §6.5 (auto-commit-and-push)
  Description: Main-branch protection is left as an open question while §6.5 makes coordinators auto-push — if operator starts on main, commits go directly to main.
  Codex's suggested fix: Make main-branch detection deterministic (refuse on integration branches, or auto-create feature branch).
  Classification: directional
  Reasoning: "Should spec-coordinator auto-create a feature branch?" is explicitly an Open Question in the spec, flagged for chatgpt-spec-review and operator decision. Codex is proposing to resolve an intentionally open product design question. This matches the directional signal: "Add this item to the roadmap" / "Change the implementation philosophy section". The spec intentionally defers this.
  Disposition: auto-decide (Step 7)

FINDING #6
  Source: Codex
  Section: §1.15 (pause/resume path, line 312) + §1.3 (entry condition)
  Description: Phase 1 pause path writes phase_status: PHASE_1_PAUSED to handoff.md but current-focus.md stays at PLANNING; re-launching spec-coordinator checks for NONE or MERGED only and would refuse to enter.
  Codex's suggested fix: Add a PAUSED status to the state machine, or update the entry condition to allow PLANNING + same-slug as a resume case.
  Classification: mechanical
  Reasoning: This is a sequencing/state machine consistency bug — §1.3 entry condition contradicts §1.15 resume path. The fix is to update the entry condition to allow PLANNING status as a valid entry when the existing slug matches (resume case). No scope or framing change.
  Disposition: auto-apply

FINDING #7
  Source: Codex
  Section: §10.3.1 rollout plan (Step 5, line 1943) vs §10.3.4 (line 1971)
  Description: Rollout Step 5 says "Existing in-flight features finish on the OLD feature-coordinator" but §10.3.4 says the OLD coordinator is fully replaced with no transitional period — contradicting Step 5.
  Codex's suggested fix: Remove Step 5 or update it to acknowledge in-flight builds use the NEW coordinator (per §10.3.2 backwards compat).
  Classification: mechanical
  Reasoning: Stale retired language — §10.3.4 explicitly retired the "both coordinators coexist" scenario, but Step 5 still uses it. §10.3.2 is the correct story: in-flight builds resume on the NEW coordinator. Fix removes the contradiction.
  Disposition: auto-apply

## Rubric Pass (Step 4)

FINDING #R6
  Source: Rubric-stale-language
  Section: §1.6 (UI-touch detection, line 174)
  Description: After iteration 1 reordering, §1.6 still references "skip §1.8 entirely and jump to §1.9" (old step numbers) — but step 4 is now §1.7 (slug derivation) and step 5 is now §1.8 (mockup loop). The section references are now correct after the reorder; the cross-reference "skip §1.8 entirely and jump to §1.9" was already corrected in iteration 1. Verified correct. No issue.
  Classification: n/a (verified correct post-iteration-1)

FINDING #R7
  Source: Rubric-sequencing
  Section: §1.4 TodoWrite list item 4 note
  Description: §1.4 still says "Item 4 (mockup loop) may expand into many sub-items" but item 4 is now "Build slug derivation" and item 5 is the mockup loop. The parenthetical reference is stale.
  Classification: mechanical
  Reasoning: Stale reference from the step reordering — should read "Item 5 (mockup loop)".
  Disposition: auto-apply

## Step 5 — Classification Summary

Directional (Step 7): #5
Mechanical (auto-apply): #6, #7, #R7
N/A: #R6

## Step 7 — Autonomous Decisions

[AUTO-DECIDED - reject] Open questions §1 — main-branch protection is a design question left open for chatgpt-spec-review
  Reasoning: The spec explicitly flags this as an Open Question for chatgpt-spec-review and the operator, not for automated review to decide. The question involves a trade-off ("refuse" vs "auto-create branch") that requires the operator's judgment. Auto-resolving this would be out of scope for a mechanical spec review. The risk is real but acknowledged. Prefer spec as-is (open question stays open).
  → Added to tasks/todo.md for deferred review.

## Step 6 — Mechanical Findings Applied

[ACCEPT] §1.3/§1.15 — Entry condition must allow PLANNING+same-slug as resume
  Fix applied: Updated §1.3 entry condition to allow PLANNING status as a valid entry point when the existing build_slug matches the resume slug. Added resume-detection language: if status is PLANNING and handoff.md contains phase_status PHASE_1_PAUSED for the same slug, coordinator enters resume mode.

[ACCEPT] §10.3.1 Step 5 — Remove "finish on OLD coordinator" rollout step
  Fix applied: Updated rollout Step 5 to state that in-flight Phase 2 builds resume on the NEW feature-coordinator per §10.3.2 backwards-compat. Removed the impossible claim about finishing on the OLD coordinator.

[ACCEPT] §1.4 — Stale "Item 4 (mockup loop)" parenthetical
  Fix applied: Updated parenthetical from "Item 4 (mockup loop)" to "Item 5 (mockup loop)" to match the reordered step list.

## Iteration 2 Summary

- Mechanical findings accepted:  3 (Findings #6, #7, #R7)
- Mechanical findings rejected:  0
- Directional findings:          1 (Finding #5)
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 1
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             1 (see tasks/todo.md for details)
- Spec commit after iteration:   [to be set after commit]
