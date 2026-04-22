# Spec Review Log — Iteration 2

Spec: `docs/skill-analyzer-v2-spec.md`
Spec commit: working-tree only (HEAD = 9b75c17)
Iteration: 2 of 5

## Codex findings (5)

1. `proposedMerge.definition` type inconsistency — string example vs jsonb schema.
2. Transaction contract not defined for executeApproved() atomicity invariant.
3. "Read the live slug" wording conflates agent slug with skill slug being appended.
4. Phase 0 depends on unresolved visibility-vs-isActive mapping (§11 open item).
5. Service surface inconsistency — §1/§4 promise 4 new methods, Phase 0 only lists 2.

## Rubric findings (2)

A. Phase 1 ships execute path that rejects all PARTIAL_OVERLAP rows until Phase 3 (merge content null).
B. Phase 0 "confirm at implementation time" hedge on schema check can be replaced with a hard assertion.

## Classification

FINDING #1 — proposedMerge.definition type
  Source: Codex (important)
  Section: §6.1 / §5.2 / §7.1
  Classification: mechanical
  Reasoning: example/contract inconsistency; the spec already means jsonb object per the schema and the "parse on blur" phrasing; fixing the string example is a prose/contract tidy.
  Disposition: auto-apply

FINDING #2 — Transaction-thread contract for executeApproved
  Source: Codex (critical)
  Section: §4 / §8 / §10 Phase 0 / §10 Phase 2
  Classification: mechanical (load-bearing claim without contract)
  Reasoning: spec already asserts atomicity invariant; adding the concrete `tx?: DrizzleTx` parameter to Phase 0 method signatures and threading via `db.transaction(...)` in Phase 2 is the standard Drizzle idiom and matches existing primitives. No scope change.
  Disposition: auto-apply

FINDING #3 — "Read the live slug" wording
  Source: Codex (important)
  Section: §5.2 / §8 step 3 / §9 edge cases / §10 Phase 2
  Classification: mechanical
  Reasoning: prose contradiction — `defaultSystemSkillSlugs` stores skill slugs, not agent slugs. The agent's live slug is irrelevant to the attach. Straightforward wording fix in 4 places.
  Disposition: auto-apply

FINDING #4 — Phase 0 depends on unresolved visibility mapping
  Source: Codex (important)
  Section: §10 Phase 0 / §11 open items #5
  Classification: ambiguous (bias to HITL)
  Reasoning: The human's iteration-1 self-review explicitly added the visibility mapping question to §11 as a deferred-to-architect open item. Codex's point that a "prerequisite phase" should not ship with an undecided invariant is legitimate implementation-readiness feedback, but resolving it picks an API-design direction (map to isActive vs add a new column) that the human has explicitly chosen to defer. Flagging for HITL confirmation.
  Disposition: HITL-checkpoint

FINDING #5 — Service surface inconsistency
  Source: Codex (minor)
  Section: §1 / §3 / §4 / §10 Phase 0
  Classification: mechanical
  Reasoning: the human's iteration-1 self-review note says "preserve systemSkillService API surface instead of renaming methods". Under that direction, the mechanical fix is to drop `getSystemSkillById` and `listSystemSkills` from the §1/§3/§4 method lists and rely on the preserved `getSkill` / `listSkills`. No scope change.
  Disposition: auto-apply

FINDING #6 (Rubric A) — Phase 1 PARTIAL_OVERLAP execute path broken until Phase 3
  Source: Rubric-invariant-leak
  Section: §10 Phase 1
  Classification: mechanical
  Reasoning: Phase 1 removes the "Cannot update a system skill" rejection and switches executeApproved's skill-write to systemSkillService, but Phase 3 is what populates `proposedMergedContent`. In between, PARTIAL_OVERLAP execute always hits "merge unavailable". Phase 1 already has a scope note for agent-attach deferral to Phase 2 — it needs a parallel note for PARTIAL_OVERLAP merge deferral to Phase 3. Pure clarification.
  Disposition: auto-apply

FINDING #7 (Rubric B) — Phase 0 "confirm at implementation time" hedge
  Source: Rubric-under-specified
  Section: §10 Phase 0
  Classification: mechanical
  Reasoning: the hedge asks "confirm against the current file at implementation time" for the schema columns. Spec-review already verified the current `server/db/schema/systemSkills.ts` contains all the named columns. Replace the hedge with a hard assertion.
  Disposition: auto-apply

## Application log

[ACCEPT] §6.1 / §5.2 / §7.1 — proposedMerge.definition type contradiction
  Fix applied: rewrote the JSON example in §6.1 to show `definition` as an Anthropic tool-definition object; added a field-type table after the example; updated §5.2 `proposedMergedContent` shape to `{ name: string, description: string, definition: object, instructions: string | null }`; rewrote §7.1 validation bullet to say `definition` renders as a JSON textarea and parses on blur (no more ambiguity about string vs object).

[ACCEPT] §8 / §10 Phase 0 / §10 Phase 2 — atomicity invariant without transaction contract
  Fix applied: added a new §8.1 "Transaction threading contract" section that defines the optional `{ tx?: DrizzleTx }` parameter for `createSystemSkill`, `updateSystemSkill`, `systemAgentService.updateAgent`, and `systemAgentService.getAgentById`, specifies `executeApproved()` wraps each per-result sequence in `db.transaction(async (tx) => { … })`, and clarifies that different results run in independent transactions. Updated Phase 0's "New methods" bullet to carry the optional-tx parameter. Updated Phase 2's executeApproved bullet to thread `tx` through the skill create and the agent update. Updated §8 DISTINCT execution steps to reference `{ tx }` on every call.

[ACCEPT] §5.2 / §8 step 3 / §9 / §10 Phase 2 — "read the live slug" wording conflates agent slug with skill slug
  Fix applied: rewrote §5.2 `agentProposals` cell to say the execute path looks up the live agent row by `systemAgentId` and appends the new skill's slug (not the agent's slug) to `defaultSystemSkillSlugs`. Rewrote §8 DISTINCT steps 3 and 4 to explicitly say "take the current `defaultSystemSkillSlugs` array off the returned row and compute the next array by appending the newly created skill's slug". Rewrote §9 rename-between-analysis-and-execute bullet accordingly. Phase 2's executeApproved bullet now says "append the newly created skill's slug to that agent's `defaultSystemSkillSlugs` array".

[ACCEPT] §1 / §3 / §4 — inconsistent systemSkillService surface (getSystemSkillById / listSystemSkills promised but not delivered)
  Fix applied: dropped `getSystemSkillById` and `listSystemSkills` from the §1 bullet, §3 "What this feature adds" bullet, and §4 Goals bullet. Rewrote Phase 0's preservation note to list the full existing public API surface (nine methods, verified against the current file) and added explicit notes on `invalidateCache` becoming a no-op façade and `stripBodyForBasic` being a pure helper. Updated §3 Current state to document the full nine-method export list (previously listed six).

[ACCEPT] §10 Phase 1 — PARTIAL_OVERLAP execute path silently broken until Phase 3
  Fix applied: added a second bullet under Phase 1's "Scope notes" explicitly stating that PARTIAL_OVERLAP / IMPROVEMENT execute attempts fail with the §8 null-guard until Phase 3 ships, that this is the guard doing its job (not a bug), that reviewers cannot usefully approve PARTIAL_OVERLAP rows until Phase 3, and that the Phase 1 test plan must cover the null-guard rejection path. Also added a Phase 1 requirement that `executeApproved` already wraps its skill write in `db.transaction(async (tx) => { … })` so the §8.1 contract is in place before Phase 2 extends it.

[ACCEPT] §10 Phase 0 — "confirm at implementation time" hedges replaced with assertions
  Fix applied: replaced the "confirm against the current file at implementation time" hedge on the `system_skills` schema check with a hard assertion (verified at spec-review time, no new columns required unless §11 #5 adds a visibility column). Replaced the conditional `listSystemSkills` bullet with a concrete assertion that the current `listSkills()` returns all rows (also verified) and that no new method is needed.

[HITL] §10 Phase 0 / §11 #5 — Phase 0 visibility semantics unresolved
  Classification: ambiguous (the caller's iteration-1 self-review explicitly deferred this). Written to HITL checkpoint at tasks/spec-review-checkpoint-skill-analyzer-v2-spec-2-2026-04-11T10-05-57Z.md with a tentative recommendation to add a three-state `visibility` column to `system_skills` in the Phase 0 migration. Details on why the §11 #5 framing ("map visible → isActive") is provably wrong (the markdown source has TWO orthogonal flags, not one) are captured in the checkpoint.

## Iteration 2 Summary

- Mechanical findings accepted:  6
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            1
- Reclassified → directional:    0
- HITL checkpoint path:          tasks/spec-review-checkpoint-skill-analyzer-v2-spec-2-2026-04-11T10-05-57Z.md
- HITL status:                   pending
- Spec commit after iteration:   untracked (working tree; HEAD = 9b75c17)

