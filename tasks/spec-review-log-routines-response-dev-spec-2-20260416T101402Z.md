# Spec Review Iteration 2 Log — routines-response-dev-spec

**Spec:** `docs/routines-response-dev-spec.md`
**Spec commit at start of iteration:** `16925715879d765a127bdafda43c738031e2bafd` (working tree modified — HITL decisions from iter 1 applied before Codex run)
**Iteration:** 2 of 5
**Timestamp:** 2026-04-16T10:14:02Z

---

## Pre-iteration: HITL decisions from iteration 1 applied

All four decisions from `tasks/spec-review-checkpoint-routines-response-dev-spec-1-20260416T095114Z.md` applied before running Codex:

- Finding 1.1 (apply-with-modification): §3.2 Recurring playbooks row updated to `scheduled_tasks WHERE createdByPlaybookSlug IS NOT NULL`; projection function updated to `projectPlaybookOccurrences(scheduledTask, windowStart, windowEnd)`.
- Finding 1.2 (apply): E2E bullets in §3.7, §4.8, §5.7 replaced with integration test bullets; "UI verification: see §10.3 demo rehearsal." note added to each.
- Finding 1.3 (apply): "against staging" replaced with "against the local development environment" in §10.3.
- Finding 1.4 (apply): Polymorphic FK note added to §4.4 `agent_test_fixtures` table definition.

---

## Codex run details

- Model: gpt-5.4 (default, ChatGPT account — o4-mini not supported)
- Mode: `codex exec --sandbox read-only --ephemeral`
- Spec piped as stdin with implementation-readiness review prompt
- Output: 10 distinct findings

---

## Classification log

FINDING #C1
  Source: Codex
  Section: §3.2
  Description: Recurring playbooks and Scheduled tasks rows both query `scheduled_tasks` with no disjoint WHERE clause, causing double-counting.
  Codex's suggested fix: Split into disjoint queries (IS NOT NULL / IS NULL); add explicit dedupe rule in service and integration test.
  Classification: mechanical
  Reasoning: Contradiction between two rows in the same table that now share the same base table without exclusion filters; the fix is a single WHERE clause addition with no scope change.
  Disposition: auto-apply

[ACCEPT] §3.2 — Scheduled tasks row now includes `WHERE createdByPlaybookSlug IS NULL` to make the two `scheduled_tasks` queries disjoint.
  Fix applied: Added `WHERE createdByPlaybookSlug IS NULL` condition to the Scheduled tasks row in the §3.2 sources table.

---

FINDING #C2
  Source: Codex
  Section: §4.2, §4.3, §4.4, §4.6
  Description: Skill test runs route through `skill_simulate` and may not create `agent_runs` rows, yet the spec commits a unified panel and `is_test_run` column on `agent_runs`.
  Codex's suggested fix: Decide whether skill tests create `agent_runs` rows or use a separate model; make spec consistent.
  Classification: directional
  Reasoning: Architecture signal — "Change the interface of X" — deciding whether skill test runs write `agent_runs` requires an architectural decision about persistence model for skill test runs.
  Disposition: HITL-checkpoint

---

FINDING #C3
  Source: Codex
  Section: §4.3, §4.6, §4.7
  Description: The "mark as test" toggle implies optionality but the `/test-run` endpoint hardwires `isTestRun: true`; the off-state of the toggle is undefined.
  Codex's suggested fix: Remove the toggle, or change the endpoint to accept both test and non-test runs.
  Classification: directional
  Reasoning: Architecture signal — "Change the interface of X" — what the toggle's off-state does to the backend path is a product/scope call (does the test panel produce non-test manual runs?).
  Disposition: HITL-checkpoint

---

FINDING #C4
  Source: Codex
  Section: §3.5, §3.7, §10.3, §1
  Description: `UpcomingWorkCard.tsx` is labelled "(stretch)" in §3.5 but is required by the north-star demo (§1) and demo rehearsal (§10.3 step 2).
  Codex's suggested fix: Pick one verdict — either make it required v1 or remove it from the acceptance and demo paths.
  Classification: directional
  Reasoning: Scope signal — "Remove this item from the roadmap" / deciding whether the portal card is a v1 required deliverable changes the Feature 1 implementation scope.
  Disposition: HITL-checkpoint

---

FINDING #C5
  Source: Codex
  Section: §3.1, §3.3, §3.7
  Description: Calendar date-window request validation (max span, invalid window behaviour, timezone rules) is unspecified.
  Codex's suggested fix: Define exact validation rules including max span, error responses, timezone handling.
  Classification: mechanical
  Reasoning: Load-bearing claims without contracts — the route accepts arbitrary `start`/`end` params but no validation contract is stated; adding one is a precision fix with no directional impact.
  Disposition: auto-apply

[ACCEPT] §3.3 — Request validation block added: ISO 8601 with timezone, `start < end`, max 30 days, invalid → 400, valid empty window → 200 with empty array.
  Fix applied: Added explicit "Request validation:" paragraph to §3.3 after the two route lines.

---

FINDING #C6
  Source: Codex
  Section: §3.3
  Description: `ScheduleOccurrence.runType` includes `'triggered'|'manual'` which are meaningless for projected future occurrences; `estimatedTokens`/`estimatedCost` undefined for non-agent sources.
  Codex's suggested fix: Constrain `runType` to `'scheduled'`; define cost fields for non-agent sources.
  Classification: mechanical
  Reasoning: Contradiction — `runType` union members conflict with the stated purpose (projected future occurrences); under-specified cost fields for non-agent sources. Both are precision fixes within §3.3 with no scope change.
  Disposition: auto-apply

[ACCEPT] §3.3 — `runType` constrained to `'scheduled'` with explanatory comment; `estimatedTokens`/`estimatedCost` comments updated to note null for non-agent sources.
  Fix applied: Updated the `ScheduleOccurrence` TypeScript type in §3.3.

---

FINDING #C7
  Source: Codex
  Section: §4.4, §4.6, §4.7, §10.4
  Description: `is_test_run` default exclusion is asserted but no specific endpoints/aggregates are enumerated, leaving the guarantee unverifiable.
  Codex's suggested fix: Name the exact endpoints that must apply the `is_test_run=false` default filter.
  Classification: mechanical
  Reasoning: Load-bearing claims without contracts — the spec asserts a business-critical filtering guarantee without naming the enforcement points; adding the table is a precision fix.
  Disposition: auto-apply

[ACCEPT] §4.7 — Added "Enforcement points for `is_test_run` default exclusion" table listing 5 endpoints/aggregates with their exclusion defaults and override params.
  Fix applied: Table appended to §4.7 after the four bullet points.

---

FINDING #C8
  Source: Codex
  Section: §5.4
  Description: Node-type mapping table uses short identifiers (`httpRequest`) while the IR type example shows fully qualified names (`n8n-nodes-base.httpRequest`); inconsistency would confuse implementer.
  Codex's suggested fix: Normalize to actual n8n type strings or document the normalization step.
  Classification: mechanical
  Reasoning: Contradiction between the IR definition and the mapping table keys; fixing it is a precision edit with no scope change.
  Disposition: auto-apply

[ACCEPT] §5.4 — Added normalization note before the mapping table; added "Full n8n type string" column with examples; updated table rows to use correct short keys and actual type paths.
  Fix applied: Expanded the node-type mapping table in §5.4.

---

FINDING #C9
  Source: Codex
  Section: §5.4, §5.5, §5.6
  Description: The webhook row note said "Webhook path mounted under our existing `/api/webhooks/...` convention" implying an active route before save, contradicting §5.5 ("Not yet saved").
  Codex's suggested fix: Specify that webhook steps use a placeholder in the draft; actual path allocated on save.
  Classification: mechanical
  Reasoning: Contradiction between §5.4 note and §5.5 "Not yet saved" status. Fixing the note is a precision edit.
  Disposition: auto-apply (fixed as part of C8 table rewrite)

[ACCEPT] §5.4 (webhook row) — Note updated to "Webhook path defined as placeholder in draft; real path allocated only on save via `playbook_propose_save`".
  Fix applied: Webhook row Notes cell in the §5.4 mapping table.

---

FINDING #C10
  Source: Codex
  Section: §4.7, §4.8
  Description: §4.7 specifies "10 per hour" rate limit but §4.8 test says "more than 10 times within a minute" — different time windows.
  Codex's suggested fix: Make the limit and test use the same window language.
  Classification: mechanical
  Reasoning: Contradiction between spec (§4.7 hourly) and test wording (§4.8 minute); precision fix with no scope change.
  Disposition: auto-apply

[ACCEPT] §4.8 — Rate-limit test bullet updated to say "exhaust the per-user rate limit by hitting 11 times in rapid succession, assert 429 on the 11th (rate-limit window: 10 per hour per user, per §4.7)".
  Fix applied: Integration test bullet in §4.8.

---

## Iteration 2 counts

- mechanical_accepted: 7
- mechanical_rejected: 0
- directional_or_ambiguous: 3 (C2, C3, C4)
- reclassified: 0
- HITL checkpoint path: tasks/spec-review-checkpoint-routines-response-dev-spec-2-20260416T101402Z.md
- HITL status: pending
