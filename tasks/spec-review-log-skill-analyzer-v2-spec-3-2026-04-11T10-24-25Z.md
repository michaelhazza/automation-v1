# Spec Review Log — Iteration 3

Spec: `docs/skill-analyzer-v2-spec.md`
Spec commit: working-tree only (HEAD = 9b75c17)
Iteration: 3 of 5

## Iteration 2 Finding 2.1 drift check

Verified the caller's application of iteration-2 Finding 2.1 (`Decision: apply`) against the spec:

- Phase 0 migration bullet (line 304) adds a `visibility text` column to `system_skills` with CHECK constraint `IN ('none', 'basic', 'full')` and default `'none'`, and explains that `isActive` and `visibility` are two orthogonal flags. **Matches recommendation.**
- Phase 0 backfill bullet (line 305) reads `visibility` from each markdown file's frontmatter and defaults to `'none'` if absent. **Matches recommendation.**
- Phase 0 service rewrite bullet (line 307) spells out concrete SQL for `updateSkillVisibility` (`UPDATE system_skills SET visibility = $1 WHERE slug = $2`), `listVisibleSkills` (`WHERE isActive = true AND visibility != 'none'`), `listActiveSkills` (`WHERE isActive = true`), and `listSkills` (all rows). **Matches recommendation.**
- Phase 0 analyzer library-read bullet (line 309) no longer carries the "revisit once §11 #5 is resolved" caveat. **Matches recommendation.**
- §11 open items: visibility-semantic-mapping bullet is removed. Analyzer library-read bullet (line 380) only flags the `isActive = false` filter question. **Matches recommendation.**

**No drift logged.** Iteration 3 proceeds with a fresh Codex + rubric pass.

## Codex findings (2)

1. §5.3 + §10 Phase 1 vs §7.4 + §10 Phase 5 — Phase 1 drops `matchedSystemSkillSlug` / `matchedSkillName` columns and API fields while the replacement `matchedSkillContent` response field is deferred to Phase 5, so every build between Phase 1 and Phase 5 ships a Review UI that no longer receives any match metadata. Severity: important.
2. §8.1 vs §10 Phase 2 — The `getAgentById` signature extension (optional `{ tx }`) is promised in §8.1 but the Phase 2 checklist only mentions extending `updateAgent`. Severity: important.

## Rubric findings (0)

Own rubric pass surfaced no additional findings. Checked:

- **Contradictions:** none beyond Codex #1.
- **Stale retired language:** none — no "staged rollout", "feature flag", "verify in staging" language.
- **Load-bearing claims without contracts:** atomicity contract lives in §8.1; backfill idempotency stated in Phase 0; Phase 0 migration schema stated as a hard assertion.
- **File inventory drift:** Codex #2 is exactly this category; no additional drift.
- **Schema overlaps:** `system_skills.isActive` vs `system_skills.visibility` explicitly declared orthogonal in Phase 0 (line 304).
- **Sequencing bugs:** Codex #1; no additional sequencing bugs.
- **Invariants stated but not enforced:** atomicity stated in §4, enforced in §8.1. Topic-filter and universal-skill preservation not relevant to this spec.
- **Missing per-item verdicts:** all six phases have phase-number verdicts, all §11 open items have explicit "defer to architect" or "recommend X" dispositions.
- **Unnamed new primitives:** all new primitives (`agentEmbeddingService.ts`, `rankAgentsForCandidate`, `buildClassifyPromptWithMerge`, `parseClassificationResponseWithMerge`, `AGENT_PROPOSAL_THRESHOLD`, `AGENT_PROPOSAL_TOPK`, `agent_embeddings` table, `system_skills.visibility` column) are concretely named with file paths, export names, or schema definitions.

## Classification

FINDING 3.1 — Phase 1/Phase 5 sequencing gap on match-metadata response
  Source: Codex (important)
  Section: §5.3 + §10 Phase 1 vs §7.4 + §10 Phase 5
  Classification: ambiguous
  Reasoning: Codex proposes two concrete alternative fixes — (a) keep the legacy columns until Phase 5 lands, or (b) move the `matchedSkillContent` response-shape change into Phase 1's server work. Either is a phase-contents change ("Ship this in a different sprint" / "This should come after / before [other item]"). Both options are reasonable. Picking one is a directional call about which phase owns the server-side response-shape extension. The "when in doubt, HITL" bias applies. There is also a third option the human might prefer: tolerate the temporary window because this is pre-production and no users depend on the Review UI between Phase 1 and Phase 5.
  Disposition: HITL-checkpoint

FINDING 3.2 — Phase 2 checklist missing `getAgentById` optional-tx extension
  Source: Codex (important)
  Section: §10 Phase 2 vs §8.1
  Classification: mechanical
  Reasoning: §8.1 explicitly states that Phase 2 ships the optional `tx` extension for both `systemAgentService.updateAgent` AND `systemAgentService.getAgentById`, and §8 execute step 1 calls `systemAgentService.getAgentById(systemAgentId, { tx })`. The Phase 2 checklist at line 333 only mentions `updateAgent`. This is pure file/method inventory drift between §8.1 and §10 Phase 2 — the method is already required by the contract, Phase 2 already ships the contract, the bullet just doesn't list the method. No scope change, no direction, no new primitive, no new signal from the directional list. Straight mechanical cleanup.
  Disposition: auto-apply

## Application log

[ACCEPT] §10 Phase 2 — `getAgentById` optional-tx extension missing from the Phase 2 checklist despite being promised in §8.1
  Fix applied: rewrote the Phase 2 bullet at line 333 to list both `systemAgentService.updateAgent` AND `systemAgentService.getAgentById` as receiving the optional `{ tx?: DrizzleTx }` parameter, added a trailing sentence noting both methods are part of the §8.1 transaction-threading contract and must ship together in Phase 2.

[HITL] §5.3 + §10 Phase 1 vs §7.4 + §10 Phase 5 — Phase 1-to-Phase 5 window drops match-metadata response shape
  Classification: ambiguous (two valid fixes + a "tolerate the window" option, picking one is directional). Written to HITL checkpoint at tasks/spec-review-checkpoint-skill-analyzer-v2-spec-3-2026-04-11T10-24-25Z.md with both Codex-suggested options plus the third option.

## Iteration 3 Summary

- Mechanical findings accepted:  1
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            1
- Reclassified → directional:    0
- HITL checkpoint path:          tasks/spec-review-checkpoint-skill-analyzer-v2-spec-3-2026-04-11T10-24-25Z.md
- HITL status:                   pending
- Spec commit after iteration:   untracked (working tree; HEAD = 9b75c17)

## Stopping heuristic

Iteration 3 has one ambiguous finding → NOT a mechanical-only round. The "two consecutive mechanical-only rounds" streak cannot start until the human resolves finding 3.1 and a subsequent iteration is also mechanical-only. The loop must pause here for HITL. The caller re-invokes the agent once the decision line is edited.
