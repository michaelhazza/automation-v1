# Progress — closed-loop-skill-improvement

## Phase 1 status

| Field | Value |
|---|---|
| Phase | SPEC (Phase 1) |
| Branch | claude/review-mockup-suggestions-tVf84 |
| Slug | closed-loop-skill-improvement |
| Started | 2026-05-18 |
| Spec path | docs/superpowers/specs/2026-05-18-closed-loop-skill-improvement-spec.md (to be written) |

---

## Step log

- **S0 branch sync:** 0 commits behind main — clean, no merge needed.
- **PLANNING lock acquired:** 2026-05-18. current-focus.md → PLANNING.
- **Intent intake (Step 3):** Major class. UI-touch = true. Provisional slug = closed-loop-skill-improvement. `intent.md` written.
- **Duplication / Strategy Check (Step 3a):** Duplication = `clear`, Strategic fit = `clear`, Recommendation = `proceed`. No gate triggered.
- **Grill-me Q&A (Step 3b):** 8 decisions locked (see intent.md § Grill-me Q&A).
- **Slug ratified (Step 4):** `closed-loop-skill-improvement` — directory already existed from mockup phase.
- **Mockup reuse-check (Step 5):** `status: complete` YAML marker detected in mockup-log.md, Round 5 CLEAN. Operator confirmation pending.

---

## Phase 2 status

| Field | Value |
|---|---|
| Phase | BUILD (Phase 2) |
| Started | 2026-05-18T04:44Z |

## Phase 2 step log

- **S1 branch sync (2026-05-18T04:46Z):** Branch was 12 ahead / 2 behind origin/main. Main brought in `.github/workflows/bump-framework-submodule.yml` (new file, identical to a pre-existing untracked local copy — removed local copy before merge) and `.claude-framework` submodule pointer bump `17cd13c2 → a913153d`. Merge auto-resolved; merge commit amended to take main's submodule pointer (branch's older pointer was wrongly preserved by ort strategy). Migration-collision check: 0 migrations on either side. Post-merge `npm run typecheck`: PASS. Overlapping-files guard: no real overlap (files brought in entirely from main with no branch-authored conflict).
- **Chunk 1 built + committed (c4b84b77):** migration 0370 (8 tables), 8 Drizzle schemas, shared types, 7 RLS manifest entries.
- **Chunk 2 built + committed (b0a0bf67):** resolver extension (resolveSkillsForAgent +ctx.runId, resolveSkillsForInspection, resolveSkillForEvaluator), composeAmendmentsPure, snapshotWrite, RESOLVER_VERSION, LRU cache, CI grep gate. 7 pure tests pass.
- **Chunk 3 built + committed (bba94e5b):** failure:post-mortem job (§9.1 steps 1-6 only — RCA synthesis, no amendment writes), pgBossTxSend, rcaPromptBuilder, 29 pure tests pass.
- **SANITY GATE — PAUSED (2026-05-18):** Waiting for operator to deploy Chunks 1-3, collect 10+ real RCA outputs from fail verdicts at `tasks/builds/closed-loop-skill-improvement/rca-samples/`, inspect them, then type "continue chunk 4". Inspection checklist in plan §SANITY GATE section.

---

## Grill decisions (summary)

1. Proposer trigger: subordinate pg-boss dispatch from judge job
2. Morning queue shape: section band below existing tab content (not third tab)
3. Peer reviewer: GPT-class via OpenAI API
4. Regression set: new `skill_regression_cases` table
5. Feature flag: none (data-gated)
6. `learned_failure_mode`: deferred to Phase 2
7. Correction-pattern-detector: modify existing job, additive dimension
8. Rollback UI: skill detail page only (Phase 1)
