# Spec Review Log — Iteration 3

**Spec:** `docs/superpowers/specs/2026-04-30-dev-pipeline-coordinators-spec.md`
**Iteration:** 3
**Timestamp:** 2026-05-01T14:00:00Z

## Codex Output (verbatim)

The patch fixes one contradiction, but the new Phase 1 resume entry still cannot be evaluated reliably and it weakens the PLANNING concurrency gate. It also overstates Phase 2 backward compatibility by claiming resumability that the rewritten coordinator does not specify.

Findings:
- [P2] Persist the Phase 1 slug before checking the paused-run resume path (§1.3 lines 133-135): resume rule can't be executed — build_slug is not in current-focus.md at PLANNING entry time (derived later in §1.7).
- [P2] Refuse non-resumable PLANNING states at spec-coordinator entry (§1.3 lines 133-136): PLANNING + no matching paused handoff leaves concurrency lock semantics undefined.
- [P2] Don't promise Phase 2 builds can resume on the rewritten coordinator (§10.3.1 step 5 lines 1946-1949): feature-coordinator always re-runs architect from scratch; "resume" overstates what backwards-compat provides.

## Findings Extracted (Step 2)

FINDING #8
  Source: Codex
  Section: §1.3 (lines 133-135)
  Description: Resume check references `tasks/builds/{slug}/handoff.md` but at §1.3 execution time, the slug hasn't been derived yet — §1.7 (Step 4) derives the slug, which is after §1.3 (Step 0).
  Codex's suggested fix: Persist the slug into current-focus.md before entry-check can use it.
  Classification: mechanical
  Reasoning: Implementation dependency — the resume check requires the slug, but the slug is available in current-focus.md from the previous run's PLANNING write only if it was written there. The fix is to specify that current-focus.md's build_slug field is what the resume check reads (set from the previous run), and to ensure that when current-focus.md is written to PLANNING status for a new run, build_slug is set too (after §1.7 slug derivation). Alternatively: update the resume check to read build_slug from current-focus.md directly.
  Disposition: auto-apply

FINDING #9
  Source: Codex
  Section: §1.3 (lines 133-136)
  Description: The entry check now handles NONE/MERGED (start fresh), PLANNING+paused-handoff (resume), and BUILDING/REVIEWING/MERGE_READY (refuse) — but is silent on PLANNING without a matching paused handoff (e.g. another slug in planning, or a crashed previous session).
  Codex's suggested fix: Add an explicit refuse case for PLANNING without a matching paused handoff.
  Classification: mechanical
  Reasoning: Missing case in the state machine entry check. The silence would leave the concurrency lock semantics undefined. Fix adds the missing case.
  Disposition: auto-apply

FINDING #10
  Source: Codex
  Section: §10.3.1 Step 5 (lines 1946-1949)
  Description: Rollout step uses "resume" for in-flight Phase 2 builds, but feature-coordinator always re-runs architect from scratch — it doesn't consult progress.md to skip already-completed chunks.
  Codex's suggested fix: Change "resume" to reflect that the build restarts rather than continues from a checkpoint.
  Classification: mechanical
  Reasoning: "Resume" implies per-chunk continuation which is not implemented. The fix aligns the word choice with §10.3.2's more precise description. No scope change.
  Disposition: auto-apply

## Rubric Pass (Step 4)

FINDING #R8
  Source: Rubric-invariants
  Section: §6.1 (current-focus.md required fields)
  Description: The §6.1.1 spec says build_slug is a required field in the mission-control block, but the new §1.3 logic writes status: PLANNING before slug derivation (§1.7). So the mission-control block would be written with build_slug: none initially. Is this correct?
  Classification: mechanical
  Reasoning: The existing required-fields list shows build_slug must be set. Writing a PLANNING block without build_slug contradicts the required-field mandate. The fix is to split the PLANNING write into two steps: (1) write status: PLANNING and build_slug: none at §1.3 (to claim the concurrency lock early), (2) update build_slug in current-focus.md after §1.7 derives the slug. This is consistent with how the spec currently handles the BUILDING transition (§1.13 writes the full block including build_slug). The resume check can then read build_slug from the current-focus.md of the paused run. This directly resolves Finding #8.

## Step 5 — Classification Summary

Mechanical (auto-apply): #8, #9, #10, #R8 (consolidated with #8)
No directional or ambiguous findings this iteration.

## Step 7 — Autonomous Decisions

None needed — no directional or ambiguous findings this iteration.

## Step 6 — Mechanical Findings Applied

[ACCEPT] §1.3 — Resume check: slug available via current-focus.md build_slug field
  Fix applied: Updated §1.3 to specify that when writing PLANNING status, the coordinator first writes build_slug: none (as a placeholder), then after §1.7 derives the slug, updates current-focus.md with build_slug: {slug}. The resume check reads build_slug from current-focus.md to find the paused handoff.

[ACCEPT] §1.3 — Add explicit refuse for PLANNING without matching paused handoff
  Fix applied: Added bullet: "If PLANNING AND no matching PHASE_1_PAUSED handoff found (different slug or no handoff): refuse with message naming the current PLANNING slug and instruct operator to abort or manually reset current-focus.md to NONE."

[ACCEPT] §10.3.1 Step 5 — "resume" overstates; changed to "restart on"
  Fix applied: Changed "resume on the NEW feature-coordinator" to "restart on the NEW feature-coordinator (architect re-runs from scratch; completed chunks from the old run are not skipped — see §10.3.2)".

## Iteration 3 Summary

- Mechanical findings accepted:  4 (Findings #8, #9, #10, #R8)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   [to be set after commit]
