# Spec Review HITL Checkpoint — Iteration 2

**Spec:** `docs/routines-response-dev-spec.md`
**Spec commit:** `16925715879d765a127bdafda43c738031e2bafd` (working tree modified — HITL decisions from iter 1 applied + 7 mechanical fixes from iter 2)
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 2 of 5
**Timestamp:** 2026-04-16T10:14:02Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 3 until every finding below is resolved by the human. Resolve by editing this file in place and changing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

**Mechanical findings already applied this iteration (no human action needed):**
- C1: §3.2 Scheduled tasks row now has `WHERE createdByPlaybookSlug IS NULL` — the two `scheduled_tasks` queries are now disjoint.
- C5: §3.3 explicit request-validation contract added (max 30 days, invalid ISO → 400, empty window → 200 + empty array).
- C6: §3.3 `ScheduleOccurrence.runType` constrained to `'scheduled'`; cost field nullability documented for non-agent sources.
- C7: §4.7 enforcement-points table added for `is_test_run` default exclusion across 5 endpoints/aggregates.
- C8: §5.4 node-type mapping table rewritten with normalization note + full n8n type strings.
- C9: §5.4 webhook row note corrected to "placeholder in draft; real path allocated only on save."
- C10: §4.8 rate-limit test bullet aligned to §4.7's "10 per hour" window.

---

## Finding 2.1 — Skill test runs and `agent_runs` persistence model undefined

**Classification:** directional
**Signal matched (if directional):** Architecture signals — "Change the interface of X" (deciding whether skill test runs write `agent_runs` rows or use a separate persistence model)
**Source:** Codex
**Spec section:** §4.2, §4.3, §4.4, §4.6

### Codex's finding (verbatim)

> Skill test runs do not fit the `agent_runs`-based design (§4.2, §4.3, §4.4, §4.6) — Decide whether skill tests create `agent_runs` rows or use a separate run model. Then make the spec consistent across the panel, trace viewer, DB column, and endpoints. If skills do not write `agent_runs`, remove them from this feature or define a separate `skill_test_runs` path and viewer contract.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would add a clarifying note to §4.2 stating: "Skill test runs also create `agent_runs` rows (via the `skill_simulate` path which wraps agent execution internally); the `is_test_run` column therefore applies uniformly across both agent and skill test runs." However, this is marked tentative because if `skill_simulate` does NOT write `agent_runs` rows, the entire §4.3 trace viewer design (which assumes a run id from `agent_runs`) would break for skill test runs, and the spec needs a different contract for the skill path.

### Reasoning

Feature 2 explicitly applies to both agent edit pages and Skill Studio (§4.2). The `is_test_run` column is on `agent_runs` (§4.4). The streaming trace in the test panel uses `<RunTraceView>` which is designed around a run id (§4.5). The skill endpoint at §4.6 delegates to `skill_simulate` — a pre-existing primitive. Whether `skill_simulate` internally creates `agent_runs` rows is not documented in this spec. If it does, the design works uniformly. If it does not, the spec needs either (a) a note that skills create `agent_runs` via `skill_simulate`, (b) a separate `skill_test_runs` table and viewer contract, or (c) removing skill support from Feature 2's scope. This is an architectural decision.

### Decision

```
Decision: apply
Modification (if apply-with-modification): Add a note to §4.2: "Skill test runs also create `agent_runs` rows (via the `skill_simulate` path, which wraps agent execution internally); `is_test_run` applies uniformly to both agent and skill test runs."
Reject reason (if reject): <edit here>
```

---

## Finding 2.2 — "mark as test" toggle off-state is undefined

**Classification:** directional
**Signal matched (if directional):** Architecture signals — "Change the interface of X" (what the toggle's off-state does to the backend call path)
**Source:** Codex
**Spec section:** §4.3, §4.6, §4.7

### Codex's finding (verbatim)

> "Test" toggle conflicts with a dedicated `/test-run` endpoint (§4.3, §4.6, §4.7) — Remove the toggle, or change the endpoint so the panel can intentionally create both normal manual runs and test runs. Right now the panel is described as a test surface, but the backend path always forces `isTestRun: true`, so the toggle has no meaningful off-state.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would update §4.3 to remove the word "toggle" and re-describe it as: "a 'mark as test' indicator (always on for runs from this panel; the panel is exclusively a test surface — for production manual runs, use the agent detail page)." This removes the ambiguity by making the panel always produce test runs. This is marked tentative because the human may instead want the toggle to be a real toggle that sends the run to the normal manual-run endpoint when off.

### Reasoning

§4.3 says "a 'mark as test' toggle that forces `runType: 'manual'` and sets `isTestRun: true`." The word "toggle" implies an on/off state. But §4.6's endpoint is `/test-run` which always forces `isTestRun: true` — the backend has no mechanism to produce a non-test run from this endpoint. Either the toggle is cosmetic/always-on (the panel is always a test surface), or the toggle needs to route to a different endpoint when off (the normal manual-run path). The decision affects the UX contract, the backend interface, and the §4.7 rate-limit semantics (does the rate limit apply to non-test runs from this panel?).

### Decision

```
Decision: apply
Modification (if apply-with-modification): Remove "toggle" language from §4.3. Re-describe as: "a 'This is a test run' indicator (always on; this panel is exclusively a test surface — for production manual runs, use the agent detail page)."
Reject reason (if reject): <edit here>
```

---

## Finding 2.3 — Portal card verdict conflict: "stretch" vs. required in acceptance path

**Classification:** directional
**Signal matched (if directional):** Scope signals — "Remove this item from the roadmap" / deciding whether UpcomingWorkCard is a v1 required deliverable changes Feature 1 scope
**Source:** Codex
**Spec section:** §3.5, §3.7, §10.3, §1

### Codex's finding (verbatim)

> Portal card is marked stretch but required by acceptance and demo flow (§3.5, §3.7, §10.3, §1) — Pick one verdict. Either make `UpcomingWorkCard` part of Feature 1 proper and keep it in the north-star demo, or move it out of the required acceptance path and remove it from §10.3 step 2 and the summary language.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would remove §10.3 step 2 ("Open the client portal as `client_user`; confirm the 'Upcoming Work' card renders") and add a parenthetical to the relevant §1 north-star text noting that the portal card is a stretch deliverable dependent on the subaccount calendar shipping. This keeps the portal card as aspirational without making it block the Feature 1 acceptance gate. This is marked tentative because the human may instead want to promote the portal card to required v1 status (given it is the "demoable wedge" per §3.5).

### Reasoning

§3.5 explicitly labels `UpcomingWorkCard.tsx` as "(stretch)" — i.e., optional. §3.7 verification includes a demo step referencing the portal card. §10.3 step 2 requires the portal card to render as part of the end-to-end rehearsal. §1 north-star acceptance test says "an agency owner can (a) open the Scheduled Runs Calendar… (b) edit an agent… (c) paste an n8n workflow…" — it does not explicitly require the portal card, but §3.5 calls it "the demoable wedge." The result is that the portal card is simultaneously stretch and required. Resolving this either upgrades it to required (which adds implementation scope to Feature 1) or downgrades the acceptance paths (which makes the demo weaker). This is a scope call.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Promote UpcomingWorkCard to required v1 in §3.5 (remove the "(stretch)" label). Keep it in §10.3 and §3.7. It is a strong demo moment and should be a committed deliverable for Feature 1.
Reject reason (if reject): <edit here>
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour each decision (apply, apply-with-modification, reject, or stop-loop), and continue to iteration 3.

If you want to stop the loop entirely without resolving findings, set any decision to `stop-loop` and the loop will exit immediately after honouring the findings that have been marked `apply` or `apply-with-modification`.
