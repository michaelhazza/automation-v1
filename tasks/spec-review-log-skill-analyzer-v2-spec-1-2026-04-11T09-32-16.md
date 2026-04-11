# Iteration 1 Log — spec-review: skill-analyzer-v2-spec

**Timestamp:** 2026-04-11T09:32:16Z
**Spec:** docs/skill-analyzer-v2-spec.md
**MAX_ITERATIONS:** 5
**HITL status:** pending (checkpoint written, 5 findings require human resolution)

## Findings from Codex (iteration 1)

Raw output at: `tasks/spec-review-codex-iter1.txt`

1. (§11/§1/§4/§5/§6/§8) Authoritative source unresolved — severity critical
2. (§5.3) `matchedSkillId` semantics vs `matchedSystemSkillSlug` — severity important
3. (§5.2) Agent proposals use unstable slug keys — severity important
4. (§6.2/§7.1) Selection rules contradict each other — severity important
5. (§7.2) Bulk partial-overlap flow undefined — severity important
6. (§3) Classifier behavior misstated (current state) — severity important
7. (§3) Route list drifts from implementation — severity minor
8. (§10) Test plan conflicts with repo posture — severity important

## Rubric findings added independently

9. (§10 Phase 2) Unnamed new primitives — the "agent embedding helper service" and the top-K cosine helper are under-specified. No file path or function signatures. Compare with `AGENT_PROPOSAL_THRESHOLD` named in §6.2.

Note: two further rubric observations (transactionality claim depends on Finding 1 resolution, §11 open item #3 references a non-existent `systemSkillService` update path) were rolled into Finding 1 as downstream dependencies rather than surfaced as separate findings.

## Classification + disposition

### Mechanical (auto-applied)

[ACCEPT] §3 Current state — Classifier behavior misstated (Codex #6)
  Fix applied: Rewrote the classify-stage description to match `server/jobs/skillAnalyzerJob.ts:389-390` — exact-hash → DUPLICATE, distinct band → DISTINCT, and BOTH `likely_duplicate` AND `ambiguous` bands go through the Claude Haiku classifier. Noted the ANTHROPIC_API_KEY fallback to PARTIAL_OVERLAP.

[ACCEPT] §3 Current state — Route list drifts (Codex #7)
  Fix applied: Replaced the shorthand route list with the full current paths from `server/routes/skillAnalyzer.ts`: `POST /api/system/skill-analyser/jobs`, `GET .../jobs`, `GET .../jobs/:jobId`, `PATCH .../jobs/:jobId/results/:resultId`, `POST .../jobs/:jobId/results/bulk-action`, `POST .../jobs/:jobId/execute`.

[ACCEPT] §10 Build phases — Test plan conflicts with repo posture (Codex #8)
  Fix applied: Rewrote Phase 2, 3, 4, 5 test lines to use pure-function unit tests against `*Pure.ts` helpers only. Removed the "integration test for the full pipeline" and all "component test" bullets. Phase 4 and Phase 5 now state explicitly "No frontend component tests — frontend tests are not part of the current testing envelope." This aligns with `spec-context.md` framing (`frontend_tests: none_for_now`, `runtime_tests: pure_function_only`, `composition_tests: defer_until_stabilisation`).

[ACCEPT] §10 Phase 2/3 — Unnamed new primitives (rubric finding #9)
  Fix applied: Rolled into the same edit as Codex #8. Named `server/services/agentEmbeddingService.ts` with concrete `refreshSystemAgentEmbeddings()` and `getAgentEmbedding()` exports. Named the pure ranking helper `rankAgentsForCandidate(candidateEmbedding, agentEmbeddings, { topK, threshold }): AgentProposal[]`. Named the classify-stage pure helpers `buildClassifyPromptWithMerge()` and `parseClassificationResponseWithMerge()`.

### Rejected

(none — no findings rejected in iteration 1)

### Reclassified → directional/ambiguous (HITL)

[HITL 1.1] §1/§4/§5/§6/§8/§11 — Authoritative source for system_skills unresolved (Codex #1)
  Reason: Architecture signal ("Introduce a new abstraction / service / pattern") + Cross-cutting signal ("affects every item in the spec"). Three distinct options (DB-backed with new phase 0, file-based rewriting §5-§8, or deferring the rescope) each reshape the spec.

[HITL 1.2] §5.3 — matchedSkillId semantics (Codex #2)
  Reason: Depends on Finding 1.1 resolution. The right identifier (UUID vs slug) and column-drop decision cannot be made without committing to DB-backed or file-based path.

[HITL 1.3] §5.2/§7.3/§8 — Agent proposals use unstable slug keys (Codex #3)
  Reason: Introducing `systemAgentId` as a new required field in the jsonb shape is a new concept, even though Codex's fix is correct. Alternative fix (freeze slug-on-rename in systemAgentService) is an equally valid directional call.

[HITL 1.4] §6.2/§7.1 — Selection rules contradict (Codex #4)
  Reason: Contradiction class would normally be mechanical, but the resolution picks a product behavior (what reviewer sees when no agent passes threshold). Bias to HITL on UX calls.

[HITL 1.5] §7.2/§7.3 — Bulk partial-overlap flow undefined (Codex #5)
  Reason: Load-bearing claim without contract. Fix introduces new semantics around `actionTaken = 'skipped'` vs "filtered client-side" — a schema/semantics call the human should make.

## Iteration 1 Summary

- Mechanical findings accepted:  4 (Codex #6, #7, #8 + rubric #9)
- Mechanical findings rejected:  0
- Directional findings:          1 (Finding 1.1)
- Ambiguous findings:            4 (Findings 1.2, 1.3, 1.4, 1.5)
- Reclassified → directional:    0
- HITL checkpoint path:          tasks/spec-review-checkpoint-skill-analyzer-v2-spec-1-2026-04-11T09-32-16.md
- HITL status:                   pending
- Spec commit after iteration:   (untracked; working-tree edits only)

Loop status: BLOCKED ON HITL. Cannot proceed to iteration 2 until all five PENDING decisions in the checkpoint file are resolved.
