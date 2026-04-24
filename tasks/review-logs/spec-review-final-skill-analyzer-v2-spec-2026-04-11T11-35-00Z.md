# Spec Review Final Report — skill-analyzer-v2-spec

**Spec:** `docs/skill-analyzer-v2-spec.md`
**Spec commit at start:** untracked working-tree (HEAD = 9b75c17)
**Spec commit at finish:** untracked working-tree
**Spec-context commit:** 7cc51443210f4dab6a7b407f7605a151980d2efc (2026-04-08)
**Iterations run:** 5 of 5
**Exit condition:** two-consecutive-mechanical-only

---

## Iteration summary table

| # | Codex | Rubric | Accepted | Rejected | Directional | Ambiguous | HITL status |
|---|-------|--------|----------|----------|-------------|-----------|-------------|
| 1 | 5     | 0      | 0        | 0        | 1           | 4         | resolved    |
| 2 | 5     | 2      | 6        | 0        | 0           | 1         | resolved    |
| 3 | 2     | 0      | 1        | 0        | 0           | 1         | resolved    |
| 4 | 8     | 0      | 7        | 1        | 0           | 0         | none        |
| 5 | 9     | 0      | 8        | 2        | 0           | 0         | none        |

Iterations 4 and 5 are both mechanical-only rounds (zero directional, zero ambiguous findings). The preferred stopping heuristic is satisfied.

---

## Mechanical changes applied (iterations 4 and 5 only — earlier iterations covered in prior checkpoints)

### §1 Summary

- Rewrote the Phase 0 bullet to list all nine preserved `systemSkillService` methods (was: six), explicitly reference §10 Phase 0 as the authoritative list, and disambiguate the POST vs DELETE 405-handler replacement (POST → wired to `createSystemSkill`, DELETE 405 stays because this feature introduces no delete primitive). [4.1, 4.3]

### §4 Goals

- Narrowed the atomicity invariant to reflect the §8/§9 contract: skill write + agent assignments for every still-existing selected agent either all happen or all roll back; missing (deleted) selected agents are logged and silently skipped, not treated as a rollback condition. [4.7]

### §6.2 Agent-propose edge cases

- Manual-add flow now re-sorts the full `agentProposals` array by `score` descending after each insert so the §5.2 stored-order invariant holds. [5.1]

### §6.3 LLM fallback

- Fallback now covers all LLM-bound results (both `likely_duplicate` and `ambiguous` similarity bands) instead of only the ambiguous band, matching §3 line 48 which states both bands go through the classifier. [4.2]

### §7.3 New endpoints

- Added a preamble specifying the common response contract: all three endpoints return the updated `skill_analyzer_results` row; `401`/`403` follow `requireSystemAdmin`; `404` for missing rows. [5.8-mechanical]
- `PATCH .../agents` now gated on `classification = 'DISTINCT'` with a defined `409` and error message for non-DISTINCT rows. [5.2]
- `PATCH .../merge` now gated on `classification IN ('PARTIAL_OVERLAP', 'IMPROVEMENT')` with defined `409` codes for wrong classifications and for null `proposedMergedContent` on eligible rows. `400` for invalid JSON in `definition`. `instructions` may be explicitly null. [5.3]
- `POST .../merge/reset` now gated on the same classification set with a defined `409` code, and the null-original case now has an explicit error message. [5.3]

### §7.4 Response shape change

- `matchedSkillContent.instructions` changed from non-null `string` to `string | null` to match `system_skills.instructions` (nullable) and the `createSystemSkill`/`updateSystemSkill` contracts. [5.5]
- `matchedSkillContent.definition` explicitly typed as object, never returned as a string. [5.5]
- Added explicit "omitted if the live lookup returns no row" fallback for the soft-FK case when `matchedSkillId` is set but the library row has been deleted. [5.5]

### §8 Execute step

- DISTINCT path: added an explicit null guard on `candidate.definition` that fails the row with `executionError: "definition is required — candidate had no tool-definition block"`. [5.4]
- PARTIAL_OVERLAP / IMPROVEMENT path: added explicit null guards on `matchedSkillId` (fails with `"matchedSkillId is required for partial-overlap write"`) and on the "update affected zero rows" case (fails with `"library skill no longer exists — re-run analysis"` so the transaction rolls back). [5.6]

### §10 Phase 0

- `createSystemSkill` and `updateSystemSkill` bullets now have explicit TypeScript signatures with full field shapes (including nullability, optional visibility/isActive defaults, and explicit non-patchable `slug`). [4.6]
- Replaced the blanket "Remove the HTTP 405 handlers" with explicit "replace POST 405 with the new create route; keep the DELETE 405 in place" since this feature introduces no delete primitive. [4.3]

### §10 Phase 2

- `agentEmbeddingService` now exports three named functions instead of two, adding `refreshSystemAgentEmbedding(systemAgentId)` as the single-agent primitive the §6.2 manual-add flow depends on. [5.7]

### §10 PR cut line

- Second reviewable PR description rewritten to accurately describe the post-Phase-1 state of the existing Review UI: match-metadata display silently hides until Phase 5 because the client's `{result.matchedSkillName && …}` guard swallows the dropped fields. Not a crash, but not "working" in the sense of visible parity either. Cross-references iteration 3's directional decision. [4.4]

### §11 Open items

- #5 (analyzer-side `isActive = false` filter) reframed from "re-opens the listSkills contract" to "narrow architect override question on top of the settled default". [4.8]

---

## Rejected findings

### Iteration 4

- **4.5 — Manual-add agent-flow endpoint contract is unresolved.** Rejected because the spec uses the "architect to decide" inline deferral marker, which is a valid verdict pattern matching §11 #1 and §11 #4. Picking a concrete endpoint shape now would be a directional API-shape decision outside the spec-reviewer's authority.

### Iteration 5

- **5.8 (directional sub-part) — Freeze the manual-add route in-spec.** Rejected for the same reason as 4.5. The mechanical sub-part (response shape/status code contracts for the three existing endpoints) was applied.
- **5.9 — §11 #3 and #5 should be resolved normatively instead of left as open items.** Rejected because #3 already resolves inline ("inherits from the Phase 0 updateSystemSkill validator and does not need redesign") and #5 was just narrowed in iter 4 fix 4.8. Neither is a real open question, and neither is a directional scope decision — Codex over-reached.

---

## Directional and ambiguous findings (resolved via HITL)

### Iteration 1

Five HITL findings (4 ambiguous + 1 critical directional). All resolved `apply-with-modification`. The spec was rewritten from scratch to integrate decisions. Checkpoint: `tasks/spec-review-checkpoint-skill-analyzer-v2-spec-1-2026-04-11T09-32-16.md`.

### Iteration 2

One ambiguous finding: the Phase 0 visibility-vs-isActive mapping. Resolved `apply` — added `visibility` text column to the Phase 0 migration, spelled out the backfill frontmatter read, and made the service rewrite SQL concrete. Checkpoint: `tasks/spec-review-checkpoint-skill-analyzer-v2-spec-2-2026-04-11T10-05-57Z.md`.

### Iteration 3

One ambiguous finding: the Phase 1/5 sequencing gap on `matchedSkillContent`. Resolved `apply-with-modification` — Option A, moved the `matchedSkillContent` server response-shape change from Phase 5 into Phase 1. Phase 5 keeps only the client-side consumption. Checkpoint: `tasks/spec-review-checkpoint-skill-analyzer-v2-spec-3-2026-04-11T10-24-25Z.md`.

### Iteration 4 & 5

Zero directional or ambiguous findings. No HITL checkpoints generated.

---

## Open questions deferred by `stop-loop`

None.

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review across five iterations. The human has adjudicated every directional finding that surfaced in iterations 1–3, and iterations 4–5 were clean mechanical-only passes. However:

- The review did not re-verify the framing assumptions at the top of the spec-reviewer playbook. If the product context has shifted since the spec was written (stage of app, testing posture, rollout model), re-read the spec's §4 Goals/Non-goals and §10 build phases sections one more time before calling the spec implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not see. Automated review converges on known classes of problem; it does not generate insight from product judgement.
- The review did not prescribe what to build next. Sprint sequencing, scope trade-offs, and priority decisions are still the human's job.

The spec explicitly defers three items to the architect agent and one item to the implementation plan:

1. Diff library selection for the three-column Recommended column renderer (§11 #1).
2. Whether `agent_embeddings` should be invalidated eagerly or lazily (§11 #2). Spec recommends lazy.
3. Whether the Phase 0 backfill runs auto-on-startup or one-shot (§11 #4). Spec recommends one-shot.
4. Manual-add agent-flow endpoint shape — same PATCH with a different body variant, or a sibling POST (§10 Phase 4). Spec leaves "architect to decide".
5. Whether to add an analyzer-side `isActive = false` filter on top of `listSkills()` (§11 #5, narrowed in iter 4).

Each of these was adjudicated during the review loop as a legitimate architect-deferral matching the spec's own convention.

**Recommended next step:** read the spec's §1 Summary, §4 Goals, and §10 Build phases one more time, confirm the headline findings match the current intent, then start implementation against Phase 0.
