# Spec Review Log — Iteration 1

**Spec:** `docs/routines-response-dev-spec.md`
**Spec commit:** `16925715879d765a127bdafda43c738031e2bafd`
**Spec-context commit:** `7cc51443210f4dab6a7b404f7605a151980d2efc`
**Iteration:** 1 of 5

## Codex invocation notes

Two attempts at Codex review were made. The CLI (v0.118.0, ChatGPT account) does not support model override flags — `gpt-4o` and `o4-mini` both rejected. The default model (`gpt-5.4`) timed out on both attempts: it spent the allowed window running codebase shell commands rather than outputting prose findings. Per agent procedure, after two truncated/failed attempts, the iteration skips Codex output and relies on the rubric pass.

Useful codebase facts surfaced by Codex shell commands before timeout:
- `scheduled_tasks` uses `rrule`, `scheduleTime`, `timezone` — NOT `cronExpression`
- `playbook_studio_sessions` has `candidateFileContents` (text) and `candidateValidationState`, not a JSON definition column
- `playbookTemplates` has no `schedule` JSON field
- `server/routes/subaccountAgents.ts` is the correct route file for `:subaccountId/agents/:linkId` endpoints
- `RunTraceViewerPage.tsx` and the three agent edit pages exist in `client/src/pages/`

## Classification log

FINDING #1 | Source: Rubric-Contradictions | Section: §2 vs §9 | mechanical | auto-apply
  §2 says "No schema migrations are required for Features 1 and 2" but §9 lists two Feature 2 migrations.
  [ACCEPT] Fix: corrected §2 to name only Features 1, 3, 4, 5 as requiring no migrations.

FINDING #2 | Source: Rubric-Schema | Section: §3.2 Scheduled tasks row | mechanical | auto-apply
  `scheduled_tasks.cronExpression` and `scheduled_tasks.timezone` do not match schema (actual: `rrule`, `scheduleTime`, `timezone`).
  [ACCEPT] Fix: updated §3.2 table row to use correct column names.

FINDING #3 | Source: Rubric-Load-bearing-claims | Section: §3.2 Recurring playbooks row | directional | HITL-checkpoint
  `playbooks.schedule` JSON does not exist — no `playbooks` table or schedule column. Recurring playbook scheduling is done via `scheduled_tasks`. The implementer cannot build `projectPlaybookOccurrences` without knowing the actual source.
  Signal: Architecture signals — deciding what table backs recurring playbook scheduling is architectural.

FINDING #4 | Source: Rubric-Contradictions | Section: §4.3 Input block | mechanical | auto-apply
  "dry-run" toggle label contradicts §4.7 which states test runs DO consume tokens.
  [ACCEPT] Fix: renamed toggle label to "mark as test" in §4.3.

FINDING #5 | Source: Rubric-Contradictions | Section: §4.3 vs §4.5 | mechanical | auto-apply
  §4.3 refers to component as `<RunTrace>`; §4.5 defines it as `<RunTraceView>`.
  [ACCEPT] Fix: updated §4.3 to use `<RunTraceView>`.

FINDING #6 | Source: Rubric-File-inventory-drift | Section: §4.6 | mechanical | auto-apply
  Test-run endpoint attributed to `server/routes/agents.ts`; architecture says subaccount-agent endpoints belong in `server/routes/subaccountAgents.ts`.
  [ACCEPT] Fix: updated §4.6 to reference `server/routes/subaccountAgents.ts`.

FINDING #7 | Source: Rubric-Testing-posture | Section: §4.8 | mechanical | auto-apply
  "(golden-file snapshot test if useful)" violates `frontend_tests: none_for_now` convention rejection.
  [ACCEPT] Fix: removed snapshot suggestion; replaced with "verify by running the app".

FINDING #8 | Source: Rubric-Testing-posture | Section: §4.8 E2E item | directional | HITL-checkpoint
  "E2E: load SystemAgentEditPage..." is a frontend E2E test, conflicts with `e2e_tests_of_own_app: none_for_now`.
  Signal: Testing posture signals — "Add E2E tests of the Automation OS app"

FINDING #9 | Source: Rubric-Testing-posture | Section: §3.7 E2E item | directional | HITL-checkpoint
  "E2E: open the calendar page..." is a frontend E2E test.
  Signal: Testing posture signals — "Add E2E tests of the Automation OS app"

FINDING #10 | Source: Rubric-Testing-posture | Section: §5.7 E2E item | directional | HITL-checkpoint
  "E2E: admin pastes a workflow JSON in Studio chat..." is a frontend E2E test.
  Signal: Testing posture signals — "Add E2E tests of the Automation OS app"

FINDING #11 | Source: Rubric-File-inventory-drift | Section: §3.4 + §9 | mechanical | auto-apply
  New permission `subaccount.schedule.view_calendar` introduced with no file reference to `server/lib/permissions.ts` and no note in §9 migration inventory.
  [ACCEPT] Fix: added `server/lib/permissions.ts` reference to §3.4; added note to §9.

FINDING #12 | Source: Rubric-Stale-language | Section: §10.3 | ambiguous | HITL-checkpoint
  "against staging" — no staging environment defined in spec-context.md; may mean "local dev" but is ambiguous.

FINDING #13 | Source: Rubric-File-inventory-drift | Section: §9 | mechanical | auto-apply
  §9 lists SQL migration files but omits Drizzle schema files (`server/db/schema/agentTestFixtures.ts` new, `server/db/schema/agentRuns.ts` update).
  [ACCEPT] Fix: added schema file references to §9 migration notes column.

FINDING #14 | Source: Rubric-Load-bearing-claims | Section: §4.4 | ambiguous | HITL-checkpoint
  `agent_test_fixtures.target_id` has no FK constraint (polymorphic reference to agents or skills). Not documented as intentional.

## Iteration 1 Summary

- Mechanical findings accepted:  8  (#1, #2, #4, #5, #6, #7, #11, #13)
- Mechanical findings rejected:  0
- Directional findings:          3  (#3, #8, #9, #10 — three E2E items batched per feature, but all same signal)
- Ambiguous findings:            3  (#12, #14, plus #8/#9/#10 count as 3 directional)
- Reclassified → directional:    0
- HITL checkpoint path:          tasks/spec-review-checkpoint-routines-response-dev-spec-1-20260416T095114Z.md
- HITL status:                   pending
- Spec commit after iteration:   (applied after mechanical fixes below)
