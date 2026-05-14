# chatgpt-plan-review — skill-merge-consolidation-pass

**Date:** 2026-05-14
**Plan:** tasks/builds/skill-merge-consolidation-pass/plan.md
**Spec:** tasks/builds/skill-merge-consolidation-pass/spec.md
**Branch:** claude/improve-skill-analyzer-RiFpB
**Task class:** Significant
**Mode:** manual
**Caller:** feature-coordinator (Phase 2 Step 4)

---

## Session context

- Spec went through 3 ChatGPT-web spec-review rounds (commits 673eff0b, 35764257, 4f8051a5). This review focuses on the **plan's** implementation choices, not the spec.
- Plan claims migration `0351` (was `0346` in spec text). R13 patches the spec text in the same commit as the migration.
- Plan's `Open questions` section restates spec §14 with concrete recommendations.
- Load-bearing assumptions worth scrutiny (plan §2.2):
  - `effectiveTierMap` merges DB tier map over `DEFAULT_WARNING_TIER_MAP` so legacy snapshots inherit informational.
  - `validateMergeOutput` warnings array is local and safe to cache for revert (R2).

---

## Round 1 — 2026-05-14 (manual ChatGPT-web mode)

**Reviewer verdict:** Build plan is strong and mostly implementation-ready; tracks the locked spec closely, handles migration-number drift correctly, has a good risk register. Not blocking structurally. 4 should-fix items (F1–F4) and 5 tightenings (T1–T5) raised.

**Disposition:** all 9 findings applied to the plan.

### Findings (technical — auto-applied)

| # | Finding | Disposition | Where applied |
|---|---|---|---|
| F1 | Gate placement vs spec wording — pre/post-remediation cohorts ambiguous | applied | plan §1.1 new "Placement authority" paragraph |
| F2 | postProcess throw on parser rejection muddies failure-reason taxonomy | applied | plan Chunk 3 contracts + error-handling — parseConsolidationResponse now runs after routeCall returns and returns a discriminated rejection; four-branch tree explicit |
| F3 | Chunk 2 strict dependency on Chunk 1 over-stated (literal union doesn't need schema) | applied | plan Chunk 2 dependencies — relaxed to recommended-not-required; canonical C1→C2→C3 order kept by convention |
| F4 | mergeRationale-missing parser rule missing — allows malformed ProposedMerge downstream | applied | plan Chunk 2 parser contract + 4 new test cases; new `rationale_missing_or_invalid` rejection added to union |
| T1 | DB CHECK constraint — add or explicitly reject | applied | plan Chunk 1 migration header comment now records the no-CHECK rationale and closure-enforcement chain |
| T2 | Targeted test for "still bloated but shorter = succeeded" | applied | plan Chunk 3 acceptance — two new targeted unit tests pin §5 outcome-classification rule and hard-constraint revert |
| T3 | Warning detail encoding (string vs jsonb object) ambiguous | applied | plan §2.2 — verified `MergeWarning.detail: string` at `skillAnalyzerServicePure.ts:418`; single-stringify rule recorded |
| T4 | consolidationNote handling on parse-rejection / timeout not explicit | applied | plan Chunk 3 last contract line — explicit per-outcome rule (null on every `failed` path + `not_triggered`; parsed value on `declined` + `succeeded`) |
| T5 | "No new services" doesn't cover helper-extraction case | applied | plan §1.6 closing paragraph — helper extractions allowed only inside `skillAnalyzerServicePure.ts` or `skillAnalyzerJob.ts`; no new modules |

### Findings (user-facing) — none

No findings affected product surface, visible copy, workflow, or feature policy. All findings were implementation/structure clarifications.

### Outcome

- Plan revised in same commit as this log entry.
- No directional findings raised; no spec changes required.
- No structural changes to the four-chunk decomposition or the spec coverage matrix.
- Lock-ready signal: plan ready for builder once operator confirms.

---

## Round 2 — 2026-05-14 (lock decision + nit + S1 sync drift)

**Reviewer verdict:** "Round 1 findings applied cleanly. Plan ready to build." One consistency nit raised. Operator decision: **lock the plan and start build**.

**Disposition:** nit applied; same-session S1 main-sync surfaced an additional migration-slot drift that R1 had anticipated.

### Findings (technical — auto-applied)

| # | Finding | Disposition | Where applied |
|---|---|---|---|
| Nit | R14 mitigation wording contradicts F3's relaxation of Chunk 2 dependency | applied | plan §2.1 R14 row — mitigation rewritten to "C3 cannot proceed until C1 lands; C2 is pure-function only and may land before C1; canonical order C1→C2→C3→C4 by convention" |

### Side-effects of in-session `git merge origin/main` (S1 sync)

| Item | Disposition | Where applied |
|---|---|---|
| PR #299 (personal-assistant-v2-operator) merged into main, claiming migration slots `0351-0357` | renumber | every plan reference to migration slot updated from `0351` → `0358`; R1 narrative updated; §6 augmented with slot-claim history table preserving the `0351` historical reference |
| File-inventory overlap audit | confirmed zero overlap | no plan-touched file (the 9 listed in chunk inventories) was modified by main |
| Line-number anchor audit | confirmed valid | grep on `server/jobs/skillAnalyzerJob.ts`: validateMergeOutput@1217, recoverDroppedTableRows@1232 (plan says 1229 — 3-line drift is within margin), adjustClassifierConfidence@1332, insertSingleResult@1365. Plan does not need to be edited; the implementer can find the call sites. |
| current-focus.md known-shape conflict | resolved | HEAD's active build pointer preserved; main's `last_merged_*` fields adopted (PA-V2 is now the most recent merge, iee-browser shifts to "Prior merge") |

### Findings (user-facing) — none

### Outcome

- Plan locked for build.
- Migration slot is `0358` (renumber from `0351` triggered by S1 sync, predicted by R1).
- Ready for `superpowers:subagent-driven-development` on Sonnet.
- Phase 2 plan-gate satisfied per CLAUDE.md "plan gate is a deliberate checkpoint" — operator approved.

