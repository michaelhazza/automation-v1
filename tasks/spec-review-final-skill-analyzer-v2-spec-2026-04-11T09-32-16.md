# Spec Review Final Report — skill-analyzer-v2-spec

**Spec:** `docs/skill-analyzer-v2-spec.md`
**Spec commit at start:** untracked (working-tree only; HEAD = 9b75c17)
**Spec commit at finish:** untracked (working-tree only; mechanical edits applied in place)
**Spec-context commit:** 7cc51443210f4dab6a7b407f7605a151980d2efc (2026-04-08)
**Iterations run:** 1 of 5
**Exit condition:** blocked-on-HITL (iteration 1 surfaced five directional/ambiguous findings; loop cannot proceed to iteration 2 until the human resolves them)

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Directional | Ambiguous | HITL status |
|---|---|---|---|---|---|---|---|
| 1 | 8 | 1 | 4 | 0 | 1 | 4 | pending |

---

## Mechanical changes applied

### §3 Current state

- Replaced shorthand route list with full current paths from `server/routes/skillAnalyzer.ts`. Now lists six routes: `POST /api/system/skill-analyser/jobs`, `GET .../jobs`, `GET .../jobs/:jobId`, `PATCH .../jobs/:jobId/results/:resultId`, `POST .../jobs/:jobId/results/bulk-action`, `POST .../jobs/:jobId/execute`.
- Rewrote the classify-stage description to match actual `skillAnalyzerJob.ts` behaviour: exact-hash matches → DUPLICATE without LLM, distinct band → DISTINCT without LLM, and both `likely_duplicate` and `ambiguous` bands go through the Claude Haiku classifier. Added the `ANTHROPIC_API_KEY` fallback to PARTIAL_OVERLAP.

### §10 Build phases

- Phase 2: named the new service concretely as `server/services/agentEmbeddingService.ts` with `refreshSystemAgentEmbeddings()` and `getAgentEmbedding(systemAgentId)` exports. Named the pure ranking helper `rankAgentsForCandidate(candidateEmbedding, agentEmbeddings, { topK, threshold }): AgentProposal[]` following the `*Pure.ts` + `*.test.ts` convention.
- Phase 2: replaced "integration test for the full pipeline" with "pure-function unit tests for `rankAgentsForCandidate` covering threshold boundary, top-K truncation, tie-breaking, empty agent list".
- Phase 3: named the pure helpers `buildClassifyPromptWithMerge()` and `parseClassificationResponseWithMerge()`. Replaced "unit tests" (underspecified) with "pure-function unit tests for the prompt builder, the parser, and the fallback when `proposedMerge` is missing or malformed".
- Phase 4: replaced "component tests for the block" with a pure-function helper requirement and an explicit note: "No frontend component tests — frontend tests are not part of the current testing envelope."
- Phase 5: replaced "component tests" with a pure-function helper requirement for diff-row derivation and the same "no frontend component tests" note.

---

## Rejected findings

None. No findings were rejected in iteration 1.

---

## Directional and ambiguous findings (resolved via HITL)

None resolved yet. Iteration 1 surfaced five findings requiring human resolution. All five are PENDING in the checkpoint at `tasks/spec-review-checkpoint-skill-analyzer-v2-spec-1-2026-04-11T09-32-16.md`.

Summary of open HITL findings:

| # | Section(s) | Classification | Issue |
|---|---|---|---|
| 1.1 | §1 / §4 / §5 / §6 / §8 / §11 | directional (critical) | Authoritative source for `system_skills` is unresolved. Spec assumes DB-backed writes via `systemSkillService.createSystemSkill()` / `updateSystemSkill()` — these methods do not exist; the current service is file-based only. Three options: A) DB-backed with new Phase 0, B) file-based rewrite of §5-§8, C) defer the rescope. |
| 1.2 | §5.3 | ambiguous | `matchedSkillId` semantics conflict with existing `matchedSystemSkillSlug` column. Dependent on resolution of 1.1. |
| 1.3 | §5.2 / §7.3 / §8 | ambiguous | `agentProposals` keyed on slug, but `systemAgentService.updateAgent` rewrites slug on rename. Two possible fixes: capture `systemAgentId` (new jsonb field) or freeze slug-on-rename in systemAgentService. |
| 1.4 | §6.2 / §7.1 | ambiguous | Selection rules contradict: §6.2 bullet 1 says "top 3 with score ≥ 0.50" (Option B), §6.2 bullet 2 and the §7.1 UI example imply "top 3 always, pre-select by threshold" (Option A). Pick one. |
| 1.5 | §7.2 / §7.3 | ambiguous | Bulk-approve-partial-overlaps flow is under-specified (no button named, no endpoint named, semantics of "skipped because LLM failed" vs `actionTaken = 'skipped'` unclear). |

---

## Open questions deferred by `stop-loop`

None. The loop did not `stop-loop`; it is blocked on HITL pending the human's resolution of the five PENDING decisions in the checkpoint file.

---

## Mechanically tight, but verify directionally

This spec now has four mechanical problems fixed (route list, classifier description, named primitives, testing posture aligned with `spec-context.md`). However, the review is NOT complete:

- **Iteration 2 has not run yet.** The single most important finding (Finding 1.1 — authoritative source for system skills) is a directional call that blocks everything downstream. Until the human resolves it, iteration 2 cannot run, and any subsequent Codex pass will just surface the same dependent findings again.
- **The directional findings are not evenly weighted.** Finding 1.1 is critical; Findings 1.2 and 1.4 are partially dependent on its resolution. Resolving 1.1 first may collapse the checkpoint's effective size to three findings.
- **The mechanical-tight claim is partial.** The mechanical edits landed, but the spec's §8 Execute step still references `systemSkillService.createSystemSkill()` and `systemSkillService.updateSystemSkill()` — methods that do not exist in the current codebase. Until Finding 1.1 is resolved, the Execute step remains built on an API that is not available.

**Recommended next step:** Read the HITL checkpoint at `tasks/spec-review-checkpoint-skill-analyzer-v2-spec-1-2026-04-11T09-32-16.md`. Resolve Finding 1.1 first — A/B/C — then resolve 1.2 and 1.4 in the same pass (their answers usually follow from 1.1). Decide 1.3 and 1.5 independently. Edit the `Decision:` lines, save, and re-invoke the spec-reviewer agent to run iteration 2.
