# Handoff — skill-merge-consolidation-pass

**Build slug:** skill-merge-consolidation-pass
**Branch:** claude/improve-skill-analyzer-RiFpB
**Spec path:** tasks/builds/skill-merge-consolidation-pass/spec.md

## Phase 1 (SPEC) — complete

**Created:** 2026-05-13T23:59:14Z (Phase 1 bridged into this file on 2026-05-13 because the spec was authored directly without the spec-coordinator playbook; operator confirmed "bridge and proceed" before Phase 2 launch.)
**Spec author:** main session (Opus)
**Spec status (per spec frontmatter):** draft
**Spec date:** 2026-05-13
**Last spec edit:** 2026-05-14
**Task class:** Significant
  - Crosses multiple domains (schema migration, LLM-orchestration job, pure functions, client UI, config service).
  - Introduces a new orchestration step (consolidation gate) with a new closed enum (`consolidationOutcome`) and three new warning codes.
  - Adds a migration with default-value semantics + warningTierMap defaults — schema + config change in one PR.
  - Not Major: no new subsystem, no new route, no cross-cutting concern; the change is additive within the existing skill-analyzer pipeline.

**UI-touch:** yes (additive — one collapsible banner above the existing three-column diff in `MergeReviewBlock.tsx`). No mockup loop ran (banner is a small additive surface to an existing reviewed component; mockup-designer was not invoked).

**Reviews completed in Phase 1:**
  - chatgpt-spec-review: 3 rounds (commits 673eff0b, 35764257, 4f8051a5).
    - Round 1 — contract precision + tiered preservation (Tier 1 hard / Tier 2 best-effort).
    - Round 2 — parser-rejection routes to `failed`, not `declined`.
    - Round 3 — editorial typo + lock-ready signal.
  - spec-reviewer (Codex): not run.

**Phase 1 decisions pinned in the spec:**
  - Conditional pass (fire only on `SCOPE_EXPANSION` / `SCOPE_EXPANSION_CRITICAL` — gated by `consolidation_trigger_severity`).
  - Single attempt, no retry escalation.
  - Three new informational warning codes (`CONSOLIDATION_APPLIED`, `CONSOLIDATION_DECLINED`, `CONSOLIDATION_FAILED`).
  - Closed enum `consolidationOutcome`: `not_triggered | succeeded | declined | failed`.
  - Pre-consolidation draft stored in a new column for audit; `originalProposedMerge` repurposed to post-consolidation when consolidation succeeds.
  - Telemetry rides on the existing `mergeWarnings` jsonb — no separate columns for size delta.
  - Migration number: `0346` (collision-free against `main` HEAD which is at `0345`).

**Phase 1 deferred items (recorded in spec §12):** rule-based-fallback consolidation, multi-pass consolidation, operator-triggered re-tightening, section-by-section change tracking, DISTINCT consolidation, A/B telemetry. None blocking.

**phase_status:** PHASE_1_COMPLETE

---
