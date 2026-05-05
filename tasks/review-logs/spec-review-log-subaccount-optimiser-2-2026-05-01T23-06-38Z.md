# Spec Review — subaccount-optimiser — Iteration 2

- Spec commit at start: 9a045bcf
- Spec-context commit: 03cf8188
- Codex output: tasks/review-logs/_codex_iter2.txt

## Codex findings

### #1 — acknowledged_at not cleared on update-in-place
- Section: §6.1, §6.2 (lines 247, 274-276)
- Issue: §6.1 says acknowledge means "until something changes" but the §6.2 update path doesn't explicitly null `acknowledged_at` on evidence change. Looking at iteration-1 §6.2 text, it does say "acknowledged_at is cleared (re-surface the row to the operator)" — Codex misread, but the §6.1 prose still doesn't lock this loop. Worth tightening for clarity.
- Classification: mechanical (cross-reference tightening between §6.1 and §6.2; also pin a concrete trigger condition).
- Disposition: auto-apply. State explicitly that `acknowledged_at` clearing is keyed on a normalised `evidence_hash` mismatch (couples cleanly with #3).

### #2 — `output.recommend` return-shape inconsistency between §5 and §6.2
- Section: §5 (line 199), §6.2 (lines 271-276), §6.5 (line 350)
- Issue: §5 skills table says `{recommendation_id, was_new}`; §6.2 says the full discriminated union with optional `reason`. §6.5 references the §6.2 contract. §5 should be brought up to date.
- Classification: mechanical
- Disposition: auto-apply.

### #3 — re-render condition vague ("evidence shape changes")
- Section: §2, §5, §13 (lines 137, 201, 569)
- Issue: "Evidence shape changes" misses value-only changes that still warrant fresh operator copy. Pin a concrete rule: normalised `evidence_hash` over the full `evidence` JSON (including values).
- Classification: mechanical
- Disposition: auto-apply. Use canonical-JSON hash of `evidence` (deterministic key ordering); store on the row as a non-indexed column, compare at write-time, update + regenerate copy + clear acknowledged_at on mismatch.

### #4 — GET endpoint for `useAgentRecommendations` not specified
- Section: §6.3, §6.5, §9 Phase 0, §10
- Issue: Hook implies an HTTP GET but no GET endpoint is pinned in the spec. Acknowledge / dismiss endpoints are pinned; the listing one isn't.
- Classification: mechanical
- Disposition: auto-apply. Add `GET /api/recommendations?scopeType=…&scopeId=…&includeDescendantSubaccounts=…&limit=…` with response shape matching the row-data contract in §6.3.

### #5 — Acknowledge UI affordance missing from row description
- Section: §6.3 (line 300), §11 (line 554)
- Issue: Component row description mentions deep-link + dismiss; doesn't mention an acknowledge action. §11 promises "Acknowledge / dismiss round-trips via UI" — implies a UI affordance for acknowledge.
- Classification: mechanical
- Disposition: auto-apply. Define implicit acknowledge: clicking "Help me fix this →" deep-link auto-acknowledges the recommendation (the user has now acted on it). No separate visible acknowledge button — keeps row clean. Dismiss (×) remains explicit.

### #6 — UI/API surface for the opt-out toggle missing
- Section: §1, §4, §8, §9, §10
- Issue: Migration adds `subaccounts.optimiser_enabled` but no settings UI/route is named. Calling it a "toggle" implies operator-visible UI.
- Classification: ambiguous → AUTO-DECIDED
- Disposition: best-judgment — downgrade to "backend column with admin SQL toggle". UI surface is out of scope for v1; a Configuration Assistant prompt or a future subaccount-settings page can expose it. Add a Deferred Items entry. Route to tasks/todo.md.

### #7 — `inactive.workflow` dedupe key uses `workflow_id` after the §2 retrigger rewrite
- Section: §2 (line 109), §3 (line 153), §5 (line 194), §9 (line 441)
- Issue: After Iter-1 #7, the trigger now keys on sub-account agents but §2's dedupe-keys table still maps `inactive.workflow → <workflow_id>`. Internal contradiction.
- Classification: mechanical
- Disposition: auto-apply. Change dedupe key to `<subaccount_agent_id>` and update returned shape in §5.

### #8 — `action_hint` format / deep-link schema unspecified
- Section: §12 (line 560), §9 (line 473), §6.5
- Issue: Spec uses `action_hint` everywhere but the format isn't pinned (schema, example payload, allowed targets). The §6.5 example uses `configuration-assistant://agent/agent-uuid?focus=budget` — that's only one example, not a contract.
- Classification: mechanical
- Disposition: auto-apply. Pin a per-category `action_hint` schema in §6.5 with one worked example per category.

### #9 — Hard-cap selection policy when > 10 candidates
- Section: §8 (line 413), §6.2 (line 271)
- Issue: Cap of 10 enforced at insert time; ordering of inserts is whatever the agent loop iterates. Spec should pin a deterministic priority so the cap doesn't randomly drop categories.
- Classification: mechanical
- Disposition: auto-apply. Pre-write ordering: severity desc (critical > warn > info), then category slug ASC, then dedupe key ASC. Stated as a §6.2 sub-clause.

## Rubric pass — additional findings

None this iteration — the rubric concerns from iter 1 were all addressed and the new edits introduced no fresh contradictions. Self-consistency pass against §6.5 / §6.2 / §6.3 / §10 confirms file inventory matches prose and contracts pin the missing shapes.

## Iteration 2 Summary

- Codex findings: 9 (8 mechanical, 1 ambiguous → AUTO-DECIDED)
- Rubric findings: 0
- Mechanical accepted: 8
- Mechanical rejected: 0
- Reclassified → directional: 0
- Directional: 0
- AUTO-DECIDED: 1 (#6, opt-out UI deferred)

