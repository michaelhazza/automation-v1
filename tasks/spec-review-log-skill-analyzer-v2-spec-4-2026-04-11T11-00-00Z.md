# Iteration 4 Log — skill-analyzer-v2-spec

**Spec:** `docs/skill-analyzer-v2-spec.md`
**Spec commit:** untracked (working-tree only; HEAD = 9b75c17)
**Spec-context commit:** 7cc51443210f4dab6a7b407f7605a151980d2efc
**Timestamp:** 2026-04-11T11:00:00Z

## Iteration 3 drift check

Verified caller's iteration 3 application matches the Option A resolution exactly:
- §10 Phase 1 line 321 adds the `matchedSkillContent` server response-shape extension with a live `systemSkillService.getSkill(matchedSkillId)` lookup. Explicitly notes no intermediate window.
- §10 Phase 5 line 362 rewritten to "Client-side consumption of `matchedSkillContent` (the response-shape extension already landed in Phase 1)."

No drift.

## Codex findings (8)

### FINDING 4.1 — systemSkillService method inventory drift in §1 Summary

Source: Codex (minor)
Section: §1 line 29 vs §10 Phase 0 line 306
Description: §1 Summary lists 6 preserved methods (`listSkills`, `getSkill`, `getSkillBySlug`, `listVisibleSkills`, `updateSkillVisibility`, `resolveSystemSkills`). §10 Phase 0 lists the full 9 (`invalidateCache`, `listSkills`, `listActiveSkills`, `listVisibleSkills`, `getSkill`, `getSkillBySlug`, `updateSkillVisibility`, `resolveSystemSkills`, `stripBodyForBasic`).
Classification: mechanical (rubric: file/method inventory drift)
Reasoning: Same concept described two ways. Phase 0 is the authoritative list. Summary is the stale list.
Disposition: auto-apply — tighten Summary to match Phase 0's inventory or explicitly mark Summary as non-exhaustive.

### FINDING 4.2 — LLM fallback covers only ambiguous band, not likely_duplicate band

Source: Codex (important)
Section: §3 line 48 vs §6.3 line 187
Description: §3 says "both `likely_duplicate` and `ambiguous` similarity bands go through the Claude Haiku classifier". §6.3 says only "ambiguous-band results fall back" when LLM fails — `likely_duplicate` fallback is undefined.
Classification: mechanical (contradiction between §3 current-state and §6.3 fallback contract)
Reasoning: §3 is the authoritative description of what's LLM-bound. §6.3 is the stale fallback contract that predates the spec's decision to route both bands through the classifier.
Disposition: auto-apply — broaden §6.3 to "all LLM-bound results (both `likely_duplicate` and `ambiguous` bands)".

### FINDING 4.3 — "Remove the HTTP 405 handlers" (plural) is stale; DELETE handler should remain

Source: Codex (important)
Section: §10 Phase 0 line 310 (and §3 line 55)
Description: §10 Phase 0 says "Remove the HTTP 405 handlers in `server/routes/systemSkills.ts`". Today there are TWO 405 handlers: `POST /api/system/skills` and `DELETE /api/system/skills/:id`. Phase 0 only introduces `createSystemSkill` and `updateSystemSkill` — no delete primitive. Removing the DELETE 405 without a replacement would break the route.
Classification: mechanical (stale plural language relative to the spec's own method inventory which adds only create+update)
Reasoning: The spec's authoritative method inventory (§1, §3 "what this feature adds", §4 Goals, §10 Phase 0) consistently adds only create+update. The plural "handlers" in line 310 is a minor prose drift. Rewriting line 310 to specify POST→createSystemSkill and DELETE stays 405 is a mechanical tidy that matches the spec's settled scope, not a directional scope change.
Disposition: auto-apply — rewrite line 310 to disambiguate POST and DELETE.

### FINDING 4.4 — PR cut line line 371 overstates Phase 1–3 compatibility

Source: Codex (critical — but adjudicated narrow mechanical)
Section: §10 PR cut line line 371
Description: Line 371 says "Second reviewable PR: Phases 1–3. Server-only, leaves the existing Review UI working because it ignores the new columns." After iteration 3's Option A resolution, Phase 1 drops `matchedSkillName` / `matchedSystemSkillSlug` from the response, but the existing client reads those fields. Line 371's "leaves the existing Review UI working" is stale prose relative to the iteration 3 decision.
Classification: mechanical (stale prose relative to settled iteration 3 directional decision)
Reasoning: Iteration 3's Option A explicitly accepted that Phase 1 does not cross the client boundary — the existing Review UI loses match-metadata display on cards until Phase 5 ships the three-column renderer. Making line 371's prose honest about that is a mechanical tidy. RE-opening whether Phase 1 should update the client IS directional and is NOT what this fix does. The existing client code at `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx:122` guards with `{result.matchedSkillName && …}`, so the UI does not crash — it silently hides the "vs. <name>" line. "Working" is technically defensible but the spec should make the limitation explicit.
Disposition: auto-apply narrow — tighten line 371 to describe the actual post-Phase-1 state without re-opening directional question.

### FINDING 4.5 — Manual-add agent-flow endpoint contract is unresolved

Source: Codex (important)
Section: §7.3 vs §10 Phase 4 line 350
Description: §7.1 describes a load-bearing manual-add flow ("Add another…"). §7.3 defines only toggle/remove on `/agents`. §10 Phase 4 says "integrated into the same PATCH or a sibling POST — architect to decide".
Classification: REJECT
Reasoning: The spec explicitly defers the endpoint choice to the architect using the "architect to decide" marker inline in Phase 4. This is the same deferral pattern used in §11 #1 (diff library) and §11 #4 (auto-on-startup vs one-shot backfill). A deferred-to-architect marker IS a valid verdict at the spec-review level — picking a concrete endpoint shape now would be directional (changing the API surface). Moving the defer from inline to §11 would be cosmetic relocation that changes neither the spec's meaning nor the implementer's obligations. No mechanical fix is warranted.
Disposition: reject with reason logged.

### FINDING 4.6 — updateSystemSkill / createSystemSkill / PATCH merge contract is prose-only

Source: Codex (important)
Section: §10 Phase 0 line 308, §7.3 PATCH /merge, §8.1
Description: §10 Phase 0 describes `createSystemSkill(input, opts?)` and `updateSystemSkill(id, patch, opts?)` in prose but never specifies the shape of `input` or `patch`. §7.3 PATCH /merge uses partial fields `{ name?, description?, definition?, instructions? }`. Whether `updateSystemSkill` accepts full-replacement or partial is implied but not explicit.
Classification: mechanical (under-specified contract for a load-bearing primitive)
Reasoning: §5.2 already gives the `proposedMergedContent` shape `{ name: string, description: string, definition: object, instructions: string | null }`. §7.3 implies `updateSystemSkill` accepts partial patches because the PATCH body is partial. Making that signature explicit in §10 Phase 0 is a mechanical clarification that codifies what the other sections already imply, not a new design decision.
Disposition: auto-apply — add explicit field shapes to the `createSystemSkill` / `updateSystemSkill` bullets in §10 Phase 0.

### FINDING 4.7 — Atomicity invariant in §4 contradicts missing-agent drop in §8/§9

Source: Codex (important)
Section: §4 line 77 vs §8 lines 262-266 and §9 line 294
Description: §4 says "Skill write + agent assignment either both happen or both roll back per result." §8 DISTINCT path says a missing (deleted) agent is logged and dropped silently without rolling back the skill creation. §9 edge case confirms.
Classification: mechanical (internal contradiction — §4 invariant is too strong relative to the settled §8/§9 contract)
Reasoning: §8 and §9 make the authoritative contract explicit: the transaction rolls back on thrown errors, and a null result from `getAgentById` is not an error but a silent drop. §4's invariant pre-dates that concretion. Narrowing §4 to match is a mechanical tidy-up.
Disposition: auto-apply — narrow §4's invariant wording to reflect the §8/§9 contract.

### FINDING 4.8 — §10 Phase 0 line 309 vs §11 #5 analyzer-library-read framing mismatch

Source: Codex (minor)
Section: §10 Phase 0 line 309 vs §11 line 381
Description: Line 309 normatively states `listSkills()` returns all rows and the analyzer compares candidates against the full library. §11 #5 frames the question as "whether the analyzer's library read should include inactive system skills" — which re-opens the question line 309 already answered.
Classification: mechanical (settled-vs-open framing drift)
Reasoning: Line 309 is the authoritative normative statement. §11 #5 should either be removed or reframed narrowly as "the architect may add an analyzer-side `isActive = false` filter on top of `listSkills()` if there's a reason to — default is include all rows". A narrow reframing is mechanical; removal is also defensible.
Disposition: auto-apply — reframe §11 #5 as a narrow override question rather than re-opening the default.

## Rubric pass

Rubric pass added no new findings beyond Codex. The spec's remaining under-specifications (e.g. what happens when `systemSkillService.getSkill(matchedSkillId)` returns null in the Phase 1 response) are covered by general error-handling conventions and do not rise to rubric-level findings.

## Counts

- Codex findings: 8
- Rubric findings: 0
- Classified mechanical: 7 (4.1, 4.2, 4.3, 4.4, 4.6, 4.7, 4.8)
- Classified directional: 0
- Classified ambiguous: 0
- Rejected: 1 (4.5)
- HITL needed: 0

## Iteration 4 Summary

- Mechanical findings accepted:  7 (to be applied)
- Mechanical findings rejected:  1 (4.5 — explicit deferral marker is a valid verdict)
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- HITL checkpoint path:          none this iteration
- HITL status:                   none
