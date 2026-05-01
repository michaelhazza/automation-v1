# Spec Review Log — Iteration 4

**Spec:** `docs/superpowers/specs/2026-04-30-dev-pipeline-coordinators-spec.md`
**Iteration:** 4
**Timestamp:** 2026-05-01T15:00:00Z

## Codex Output (verbatim)

The spec still contains workflow-breaking gaps: it can push coordinator commits directly to an integration branch, it can leave current-focus.md wedged in PLANNING on normal early exits, and it promises a Phase 2 resume capability that the rest of the document does not define.

Findings:
- [P1] Resolve main-branch launches before enabling coordinator auto-push (Open questions line 2003): operator starting on main allows commits to land directly on main.
- [P1] Release the PLANNING lock on pre-spec early exits (§1.3 lines 134-136): §1.5 refuses on 30+ commits behind and §1.6 stops for Trivial briefs without resetting current-focus.md.
- [P2] Remove the unsupported resume-from-last-chunk guarantee (§6.5 line 1418): chunk commits described as "recovery points" for resuming from last committed chunk, but feature-coordinator always restarts from scratch.

## Findings Extracted (Step 2)

FINDING #11
  Source: Codex
  Section: Open questions §1 (line 2003)
  Description: Same finding as #5 from iteration 2 — main-branch protection is an open design question.
  Classification: directional
  Reasoning: This is the same open question explicitly flagged for chatgpt-spec-review in the spec. AUTO-DECIDED reject in iteration 2 still applies. Codex escalated severity but the classification criterion is unchanged — this is a product design decision, not a mechanical fix.
  Disposition: auto-decide (Step 7) — same decision as iteration 2

FINDING #12
  Source: Codex
  Section: §1.3 (lines 133-141) + §1.5 + §1.6 (early exit paths)
  Description: §1.5 refuses on 30+ commits behind and §1.6 stops for Trivial briefs without resetting current-focus.md to NONE — leaving the PLANNING lock (with build_slug: none) permanently set.
  Codex's suggested fix: Add current-focus.md reset to NONE on all early-exit paths before the handoff exists.
  Classification: mechanical
  Reasoning: Missing step on early-exit paths — the concurrency lock must be released on any exit before the spec is authored. Fix adds reset instruction to §1.5 refusal and §1.6 Trivial-brief stop.
  Disposition: auto-apply

FINDING #13
  Source: Codex
  Section: §6.5 (line 1418)
  Description: feature-coordinator auto-commit justification says "chunk-level commits are recovery points; if Phase 2 is interrupted, the operator can resume from the last committed chunk." But feature-coordinator always re-runs architect from scratch — it does NOT resume from the last committed chunk (as was clarified in iteration 3 rollout-step fix).
  Codex's suggested fix: Remove the "resume from last committed chunk" claim in §6.5 since it is unsupported.
  Classification: mechanical
  Reasoning: Stale justification text — the iteration 3 fix corrected the rollout step, but the same "resume from last chunk" language survived in §6.5. The fix aligns §6.5 with the corrected rollout step.
  Disposition: auto-apply

## Rubric Pass (Step 4)

No new rubric findings this iteration beyond what Codex caught.

## Step 5 — Classification Summary

Directional (Step 7): #11
Mechanical (auto-apply): #12, #13
No ambiguous findings.

## Step 7 — Autonomous Decisions

[AUTO-REJECT - framing/convention] Open questions §1 — main-branch protection (same as iteration 2 Finding #5)
  Convention: The spec explicitly flags Open Question #1 for chatgpt-spec-review and operator decision. This is a product design question, not a mechanical spec fix. Codex escalating severity does not change the classification — severity is not an adjudication criterion per spec-reviewer rules.
  Same AUTO-DECIDED reject as iteration 2 applies. Not added again to tasks/todo.md (already recorded).

## Step 6 — Mechanical Findings Applied

[ACCEPT] §1.5/§1.6 — Add PLANNING lock release on early-exit paths
  Fix applied: Added to §1.5 (30+ commits behind refusal): "Before refusing, reset tasks/current-focus.md to NONE (releasing the PLANNING lock) and print the current state so the operator knows the concurrency lock was cleared."
  Added to §1.6 (Trivial brief stop): "Before stopping, reset tasks/current-focus.md to NONE and inform the operator."

[ACCEPT] §6.5 — Remove "resume from last committed chunk" claim
  Fix applied: Updated the feature-coordinator justification in §6.5 from "chunk-level commits are recovery points; if Phase 2 is interrupted, the operator can resume from the last committed chunk" to "chunk-level commits preserve incremental work on the branch; if Phase 2 is interrupted, the operator can restart feature-coordinator and it will re-run architect from scratch on the same branch."

## Iteration 4 Summary

- Mechanical findings accepted:  2 (Findings #12, #13)
- Mechanical findings rejected:  0
- Directional findings:          1 (Finding #11 — same as iteration 2 #5, re-rejected)
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions: 1 (same finding re-seen; same rejection applied)
  - AUTO-REJECT (framing): 0
  - AUTO-REJECT (convention): 1 (same open-question rule)
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED: 0
- Spec commit after iteration:   1ecf106f
