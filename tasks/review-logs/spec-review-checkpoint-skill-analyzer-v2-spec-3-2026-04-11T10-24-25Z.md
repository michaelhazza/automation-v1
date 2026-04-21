# Spec Review HITL Checkpoint — Iteration 3

**Spec:** `docs/skill-analyzer-v2-spec.md`
**Spec commit:** untracked (working-tree only; HEAD = 9b75c17)
**Spec-context commit:** 7cc51443210f4dab6a7b407f7605a151980d2efc (2026-04-08)
**Iteration:** 3 of 5
**Timestamp:** 2026-04-11T10:24:25Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 4 until every finding below is resolved by the human. Resolve by editing this file in place and changing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

Iteration 3 ran a fresh Codex pass plus a rubric pass. Codex produced 2 findings; the rubric pass added 0. Finding 3.2 (Phase 2 `getAgentById` checklist drift) was auto-applied as mechanical inventory fix — see `tasks/spec-review-log-skill-analyzer-v2-spec-3-2026-04-11T10-24-25Z.md` for the log. Finding 3.1 below is ambiguous because it proposes a phase-contents change and two of the three reasonable options are directional.

Finding 2.1 drift check: verified. The caller's application of iteration-2 Finding 2.1 (Phase 0 visibility column, backfill, service rewrite SQL, §11 #5 removal) matches the recommendation in the iteration-2 checkpoint exactly. No drift logged.

---

## Finding 3.1 — Phase 1/Phase 5 sequencing gap: match-metadata response shape drops out between phases

**Classification:** ambiguous
**Signal matched (if directional):** Sequencing signals: "Ship this in a different sprint" / "This should come after / before [other item]" (picking where the `matchedSkillContent` response shape lands is a phase-contents change)
**Source:** Codex (important)
**Spec section:** §5.3 + §10 Phase 1 vs §7.4 + §10 Phase 5

### Codex's finding (verbatim)

> - Section: §5.3 + §10 Phase 1 versus §7.4 + §10 Phase 5
>   One-sentence description: Phase 1 drops `matchedSystemSkillSlug`/`matchedSkillName` from the DB/API while the replacement `matchedSkillContent` response field is deferred to Phase 5, so every build between those milestones would ship a Review UI that no longer receives any match metadata.
>   Suggested fix: Either keep the two legacy columns/API fields until the Phase 5 client work lands, or (better) move the `matchedSkillContent` lookup and response-shape change into the same Phase 1 server work that drops the columns so the existing UI never loses data.
>   Severity: important

### Independently verified facts about the spec

- §5.3 explicitly drops `matchedSystemSkillSlug` and `matchedSkillName` "in the same migration as 5.1 / 5.2" (the Phase 1 migration), and rationalises the drops by pointing at "the new `matchedSkillContent` field in the GET jobs response (§7.4)".
- §7.4 is the section that defines the new `matchedSkillContent` response shape.
- §10 Phase 1 (line 318) includes the migration that drops the two legacy columns. Phase 1 has NO bullet extending the GET /jobs/:id response.
- §10 Phase 5 (line 361) contains the bullet: "Library content included in `GET /jobs/:id` response as `matchedSkillContent`."
- So: Phase 1 drops the schema columns. Phase 2 and Phase 3 do not touch the GET response shape. Phase 5 is where the response shape change lands. Between Phase 1 and Phase 5, the GET response still shaped for the old fields would send neither the dropped fields (because the underlying columns are gone) nor the replacement field (because that code lands in Phase 5). The existing Review UI — which reads `matchedSkillName` / `matchedSystemSkillSlug` from `GET /jobs/:id` — would receive neither set and would render cards without match metadata.
- The severity of "the UI loses match-metadata for multiple phases" depends on whether the Review UI is actually exercised between Phase 1 and Phase 5. In pre-production with a single developer running the analyzer for dev smoke testing, the window is tolerable. In a staged rollout or with real reviewers in the loop, the window is a bug.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would apply one of the following three options. All three are reasonable; picking one is a directional call:

**Option A — Move the `matchedSkillContent` server response-shape change from Phase 5 to Phase 1.** Phase 1's server work already touches the GET /jobs/:id response shape because the columns it drops are currently returned by that endpoint. Adding the live `system_skills` lookup for `matchedSkillContent` in the same PR removes the window entirely. Phase 5 keeps only the client-side consumption of `matchedSkillContent` (the three-column merge view already depends on it for Current column rendering). This is the option Codex recommends as "better".

**Option B — Defer dropping the two legacy columns until Phase 5.** Phase 1 keeps `matchedSystemSkillSlug` and `matchedSkillName` alive (both in the schema and in the GET response) and populates them on write for any new rows. Phase 5 drops them in the same PR that introduces `matchedSkillContent`. This keeps Phase 1 simpler at the cost of Phase 1 having to continue writing to columns that will later be dropped.

**Option C — Tolerate the window.** Leave the spec as-is. The Review UI is explicitly a dev-only concern until the analyzer is used in anger, which (per spec-context.md) is post-first-agency onboarding. Between Phase 1 and Phase 5, the developer running smoke tests accepts that the Review UI renders without match metadata. Phase 5 restores it. No spec change needed, just an explicit note in Phase 1 acknowledging the temporary regression.

### Reasoning

This finding is ambiguous for three separate reasons:

1. **Codex proposed two different fixes and flagged one as "better".** Neither fix is obviously wrong. Picking Option A splits Phase 5's server work forward into Phase 1. Picking Option B defers Phase 1's schema cleanup into Phase 5. Picking Option C tolerates the window but adds a note. All three are phase-contents changes; the spec-reviewer is not authorised to pick which.

2. **The directional signal list explicitly covers this case.** Both "Ship this in a different sprint" and "This should come after / before [other item]" are hardcoded directional signals. The classification rule says: "if a finding matches any item here, it is directional REGARDLESS of how small the change seems or how obviously correct Codex's recommendation looks."

3. **The severity depends on product framing.** In the pre-production posture from `docs/spec-context.md`, the window is almost certainly tolerable because no live user depends on the Review UI. But that is a framing call the human should confirm rather than the spec-reviewer inferring.

Downstream impact of each option:

- **Apply Option A:** Phase 1 gains one server bullet (add the `matchedSkillContent` response-shape extension with the live `system_skills` lookup). Phase 5's "Library content included in GET /jobs/:id response as `matchedSkillContent`" bullet is removed or rewritten to reference the Phase 1 work. The PR cut line note in §10 may need updating (Phase 1 gains a little scope). No framing change.
- **Apply Option B:** §5.3 "in the same migration as 5.1 / 5.2" is changed to "in the Phase 5 migration". Phase 1's schema-drop bullet is removed. Phase 5 gains a new migration bullet. The rationale in §5.3 needs updating (the current rationale assumes the drops happen with the new columns). More edits, more risk of touch-up bugs in adjacent sections.
- **Apply Option C:** Phase 1 gains a new bullet explicitly acknowledging the window: "Scope note: between Phase 1 shipping and Phase 5 shipping, the GET /jobs/:id response returns neither `matchedSkillContent` (added in Phase 5) nor the old `matchedSystemSkillSlug` / `matchedSkillName` (dropped in Phase 1). The Review UI renders cards with no match metadata during this window. This is acceptable because the Review UI is dev-only until post-first-agency onboarding. Smoke tests between Phase 1 and Phase 5 must not depend on the Review UI displaying match metadata." No migration changes, no phase re-shaping.
- **Reject:** Spec stays as-is, sequencing gap stays latent, implementer discovers it when Phase 1 ships and the Review UI breaks in dev.
- **Stop-loop:** Spec is left in its current state. Finding is captured for a future review run.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`. If `apply-with-modification`, add the modification inline (specify which option A/B/C). If `reject`, add a one-sentence reason. If `stop-loop`, the review loop exits and the spec stays in its current state.

```
Decision: apply-with-modification
Modification (if apply-with-modification): Option A — move the matchedSkillContent server response-shape change from Phase 5 into Phase 1. Phase 1 gains a bullet extending the GET /jobs/:id response with a live system_skills lookup that produces matchedSkillContent for each result where matchedSkillId is set. Phase 5 keeps only the client-side consumption of matchedSkillContent in the three-column diff renderer. §5.3 rationale unchanged (still points at §7.4 which is unchanged). PR cut line note updated: Phase 1 gains a small scope bump but does not need to cross the client boundary.
Reject reason (if reject): n/a
```

### Applied changes (by caller, not the spec-reviewer agent)

- §10 Phase 1: added bullet extending `GET /api/system/skill-analyser/jobs/:id` with a live `system_skills` lookup producing `matchedSkillContent` for each result where `matchedSkillId` is set (server-only, no client work).
- §10 Phase 5: removed the "Library content included in GET /jobs/:id response as matchedSkillContent" bullet since it now lands in Phase 1.

---

## How to resume the loop

After editing the `Decision:` line above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour the decision (`apply`, `apply-with-modification`, `reject`, or `stop-loop`), and continue to iteration 4.

If you want to stop the loop entirely without resolving the finding, set the decision to `stop-loop` and the loop will exit immediately after honouring any findings that have been marked `apply` or `apply-with-modification`.

## Iteration 3 stopping-heuristic note

Iteration 3 surfaced 2 findings total: 1 auto-applied mechanical (3.2, `getAgentById` checklist drift), 1 HITL (3.1, Phase 1/5 sequencing gap). Iterations 1, 2, and 3 have all had at least one non-mechanical finding, so the "two consecutive mechanical-only rounds" stopping heuristic has not started a streak. Iteration 4 would need to run unless the human resolves 3.1 as `stop-loop`. If the human resolves 3.1 as `apply` (any option) or `reject`, iteration 4 runs. If iteration 4 is mechanical-only AND iteration 5 is also mechanical-only, the loop exits via the preferred heuristic. Otherwise the loop exits at the iteration cap (5).
