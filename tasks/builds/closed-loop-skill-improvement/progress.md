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
- **SANITY GATE — OPERATOR OVERRIDE (2026-05-18):** Operator instructed "please continue" without live inspection. Proceeding to Chunk 4. REVIEW_GAP: sanity-gate inspection skipped | reason: operator override | remediation: run RCA prompt calibration pass before merge if rcaPromptBuilder.ts produces low-quality outputs in staging.
- **Chunks 4–9 built + committed:** All 9 chunks complete. Key commits: Chunk 4 (72ce6ae5), Chunk 5 (b7553650), Chunk 6 (cd568f32), Chunk 7 (a0295744), Chunk 8 (c9b02d90), Chunk 9 (f9cc84ad).
- **REQ#7 + REQ#13 fixed (8a6a5efa):** acceptAfterEdit transitions to retired/superseded; proposer metrics use 'unknown' not peer model version.
- **spec-conformance (2026-05-18):** NON_CONFORMANT — 15 directional schema gaps routed to tasks/todo.md. 33 PASS items. Two code bugs (REQ#7, REQ#13) fixed before pr-reviewer.
- **pr-reviewer (2026-05-18):** 3 blockers fixed in commit bcc76f19 — B1: snapshot write before cache check; B2: proposer metrics use tx not pool db; B3: truncation size check includes join separators. 7 should-fix + 4 consider items in tasks/todo.md. **CHANGES_REQUESTED resolved — blockers closed.**
- **Phase 2 build COMPLETE (2026-05-18).** Branch ready for Phase 3 finalisation (chatgpt-pr-review + doc-sync + MERGE_READY).

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

---

## LEARNING_FEEDBACK_PROPOSAL

| Pattern | Target | Rationale | Operator decision |
|---|---|---|---|
| grep-based CI invariant gates miss multiline call sites — use `tr '\n' ' '` collapse before grep | `agent-instruction` (builder) | Builders write verify-*.sh gates; if they only use grep -E with [^)]* they'll miss multiline formatting. A builder-instruction to always use the collapse technique would prevent future gates shipping with this bypass. | |
| pg-boss dispatch payload field names must match what the sender actually knows — defer entity resolution to the receiver | `spec-authoring-instructions` | Specs often name payload fields after the receiver's expectation (e.g. "skillSlug") but the sender may not have that data. Spec authoring instruction: payload fields should be named after the sender's data, with resolution documented as a receiver-side step. | |
| singletonKey is meaningless if the transport layer doesn't use it in the SQL INSERT — verify at implementation, not just type-level | `regression-test` | A regression test that verifies pgBossTxSend actually includes singletonKey in the INSERT would have caught this at Chunk 3. | |
| Migration collision renumbering: check ALL concurrent in-flight PRs at first collision, not just current main HEAD | `feature-coordinator` | feature-coordinator S2 step should note: if a collision is detected, check `git ls-remote origin 'refs/pull/*/head'` or equivalent for other open PRs and their migration numbers before renumbering. | |
| Inconclusive regression outcomes should default to conservative rollback in automated pipelines | `spec-authoring-instructions` | Spec §9.2 only mentioned `fix_proposed → fail` triggering rollback; `inconclusive` was unspecified and the builder defaulted to non-rollback. Spec authoring instruction: always specify what happens on inconclusive/error outcomes in automated state-machine steps. | |
