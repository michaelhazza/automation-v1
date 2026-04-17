# Spec Review HITL Checkpoint — Iteration 1

**Spec:** `docs/routines-response-dev-spec.md`
**Spec commit:** `16925715879d765a127bdafda43c738031e2bafd`
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 1 of 5
**Timestamp:** 2026-04-16T09:51:14Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 2 until every finding below is resolved by the human. Resolve by editing this file in place and changing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

**Mechanical findings already applied (no human action needed):**
- Finding #1: §2 migration claim corrected (Features 1/3/4/5 require no migrations; Feature 2 does)
- Finding #2: §3.2 scheduled_tasks columns corrected (cronExpression → rrule + scheduleTime)
- Finding #4: §4.3 "dry-run" toggle renamed to "mark as test" with token-consumption note
- Finding #5: §4.3 `<RunTrace>` corrected to `<RunTraceView>`
- Finding #6: §4.6 `agents.ts` corrected to `subaccountAgents.ts`
- Finding #7: §4.8 golden-file snapshot suggestion removed
- Finding #11: §3.4 permission key now references `server/lib/permissions.ts` and `permissionSeedService.ts`; §9 updated with Drizzle schema files and permission seed note
- Finding #13: §9 migration notes updated with Drizzle schema file names

---

## Finding 1.1 — Recurring playbooks source table does not exist

**Classification:** directional
**Signal matched (if directional):** Architecture signals — "Change the interface of X" (deciding the backing data source for recurring playbook scheduling requires an architectural decision)
**Source:** Rubric-Load-bearing-claims
**Spec section:** §3.2 Sources of scheduled events — Recurring playbooks row

### Codex's finding (verbatim)

(Codex did not reach prose output; this finding was identified by the rubric pass and codebase verification.)

The §3.2 table lists "Recurring playbooks" as sourced from "`playbook_runs` with recurring schedule; `playbooks.schedule` JSON". Neither a `playbooks` table nor a `playbooks.schedule` column exists in the codebase. The `playbookTemplates` and `systemPlaybookTemplates` tables have no schedule field. `playbookRuns` has no schedule field. Recurring playbook execution scheduling is handled by `scheduled_tasks` (which fires playbook runs via `createdByPlaybookSlug`).

### Tentative recommendation (non-authoritative)

If this were mechanical, I would update the §3.2 Recurring playbooks row to read: `scheduled_tasks` rows where `createdByPlaybookSlug IS NOT NULL` as the source for recurring playbook occurrences, and change the projection function signature to `projectPlaybookOccurrences(scheduledTask, windowStart, windowEnd)`. This is marked tentative because it would change the design of Feature 1 — the calendar may not need to project recurring playbooks separately from scheduled tasks at all, since recurring playbook runs are already captured as scheduled tasks.

### Reasoning

This is not a stale-word typo. `playbooks.schedule` is a non-existent schema construct, and the current architecture routes recurring playbook scheduling through `scheduled_tasks`. The decision is: (a) remove the "Recurring playbooks" row entirely from §3.2 and rely on the Scheduled tasks row to cover playbook-driven scheduled tasks, or (b) clarify the source as `scheduled_tasks WHERE createdByPlaybookSlug IS NOT NULL`. Either decision changes the scope and design of `scheduleCalendarService.ts`. This is architectural.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Update the §3.2 Recurring playbooks source to `scheduled_tasks WHERE createdByPlaybookSlug IS NOT NULL`. Update the projection function signature to `projectPlaybookOccurrences(scheduledTask, windowStart, windowEnd)`. Keep the row — do not remove it.
Reject reason (if reject): <edit here>
```

---

## Finding 1.2 — E2E tests across Features 1, 2, and 3

**Classification:** directional
**Signal matched (if directional):** Testing posture signals — "Add E2E tests of the Automation OS app"
**Source:** Rubric-Testing-posture (three instances batched: §3.7, §4.8, §5.7)
**Spec section:** §3.7, §4.8, §5.7 Verification sections

### Codex's finding (verbatim)

(Rubric finding — Codex did not reach prose output.)

Three verification sections include frontend E2E tests:
- §3.7: "E2E: open the calendar page, pick a date range, assert at least one occurrence renders with correct agent name"
- §4.8: "E2E: load SystemAgentEditPage, type a test prompt, click Run, assert streaming updates render in the side panel"
- §5.7: "E2E: admin pastes a workflow JSON in Studio chat, receives a mapping report + candidate definition, clicks through simulate, cost-estimate, save-and-PR"

All three conflict with `e2e_tests_of_own_app: none_for_now` in `spec-context.md`.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would remove all three E2E bullet points and replace them with integration tests that verify backend behavior (endpoint responses, DB state) and a note referencing the "Demo rehearsal" in §10.3 as the manual verification path for UI behavior. This is marked tentative because removing E2E items is a testing-posture decision.

### Reasoning

The spec-context file explicitly defers E2E tests to a future phase. However, the spec includes E2E items in the verification sections of all three build features. Whether to keep them as aspirational/manual-only descriptions, replace them with integration test bullets, or remove them entirely is a posture call the human should make. The E2E items as written suggest automated browser tests that don't exist and aren't planned.

### Decision

```
Decision: apply
Modification (if apply-with-modification): Replace each E2E bullet with an integration test bullet verifying backend behavior (endpoint responses, DB state). Add a note at the end of each verification section: "UI verification: see §10.3 demo rehearsal."
Reject reason (if reject): <edit here>
```

---

## Finding 1.3 — "Against staging" in §10.3

**Classification:** ambiguous
**Signal matched (if directional):** N/A (ambiguous)
**Source:** Rubric-Stale-language
**Spec section:** §10.3 End-to-end demo rehearsal

### Codex's finding (verbatim)

(Rubric finding.)

§10.3 says "Run the full north-star demo script (per §1) against staging before declaring the spec complete." `spec-context.md` states `staged_rollout: never_for_this_codebase_yet`. There is no staging environment defined. "Staging" here may be informal shorthand for "local dev environment" or it may imply a production-like staging server that does not exist.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would replace "against staging" with "against the local development environment." This is marked tentative because if there is actually a staging environment (even an informal one), the word is correct and should stay.

### Reasoning

"Staging" is ambiguous in a pre-production, rapid-evolution context. If it means "local dev," the fix is a one-word change with no downstream impact. If it refers to an actual environment that hasn't been documented yet, changing it could obscure a real deployment step.

### Decision

```
Decision: apply
Modification (if apply-with-modification): Replace "against staging" with "against the local development environment".
Reject reason (if reject): <edit here>
```

---

## Finding 1.4 — agent_test_fixtures.target_id polymorphic FK not documented

**Classification:** ambiguous
**Signal matched (if directional):** N/A (ambiguous)
**Source:** Rubric-Load-bearing-claims
**Spec section:** §4.4 Data model additions

### Codex's finding (verbatim)

(Rubric finding.)

`agent_test_fixtures.target_id` is typed as `uuid NOT NULL` with a comment "agent id or skill id" but has no FK constraint. This is a polymorphic reference (can point at `agents` or `skills` tables). The spec does not document that the absence of a FK constraint is deliberate, nor does it describe how referential integrity is enforced at the application layer.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would add a note to the §4.4 table definition comment: "No FK constraint — target_id is polymorphic (agent id when scope='agent', skill id when scope='skill'); integrity enforced at application layer in agentTestFixtures service." This is marked tentative because the human may prefer to add a CHECK + two separate optional FKs, or a different enforcement approach.

### Reasoning

Other polymorphic references in the codebase exist and are intentional (e.g., audit_events references multiple resource types). This may be the same intentional pattern. However, leaving it undocumented in the spec means the implementer has to decide on their own. At minimum the spec should acknowledge the design choice. Whether the right fix is a note or a schema change is ambiguous.

### Decision

```
Decision: apply
Modification (if apply-with-modification): Add a note to the §4.4 table definition: "No FK constraint — target_id is polymorphic (agent id when scope='agent', skill id when scope='skill'); integrity enforced at application layer in agentTestFixturesService."
Reject reason (if reject): <edit here>
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour each decision (apply, apply-with-modification, reject, or stop-loop), and continue to iteration 2.

If you want to stop the loop entirely without resolving findings, set any decision to `stop-loop` and the loop will exit immediately after honouring the findings that have been marked `apply` or `apply-with-modification`.
