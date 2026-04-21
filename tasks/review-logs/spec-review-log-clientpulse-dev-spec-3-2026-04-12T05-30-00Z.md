# Spec Review Log — clientpulse-dev-spec — Iteration 3

**Spec:** `docs/clientpulse-dev-spec.md`
**Spec commit at start:** `87723bf046029c6c8b06abc7613b613f6ae67d5b`
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Codex status:** Not available (Codex review CLI is designed for code diffs, not document review — rubric-only review)
**Timestamp:** 2026-04-12T05:30:00Z

## Resuming from iteration 2

Checkpoint `tasks/spec-review-checkpoint-clientpulse-dev-spec-2-2026-04-12T03-50-42Z.md` — Finding 2.1 (onboarding wizard state tracking mechanism):
- Decision: `apply-with-modification` — applied in this session
- Replaced ambiguous "wizard_step field on the org OR localStorage" with derive-from-API pattern (`GET /api/onboarding/status`)
- Added `OnboardingStatus` interface, route to §9.3 route table, and `getOnboardingStatus()` to §9.5 service contract
- Status: resolved, iteration 2 closed

## Finding classifications

---

FINDING #1
  Source: Rubric-file-inventory-drift
  Section: §4.6 — subscriptionTrialCheckJob registration file
  Description: §4.6 says the cron job should be "registered in `server/jobs/index.ts`" but that file does not exist. All cron schedules are registered via `boss.schedule()` in `server/services/queueService.ts`.
  Classification: mechanical
  Reasoning: Factual error — `server/jobs/index.ts` does not exist in the codebase. All existing cron jobs (memory-decay, agent-run-cleanup, security-events-cleanup, etc.) are registered via `boss.schedule()` calls in `queueService.ts`. Referencing a non-existent file would cause implementation confusion.
  Disposition: auto-apply

---

FINDING #2
  Source: Rubric-load-bearing-claims-without-contracts
  Section: §9.2 signup handler calls `subscriptionService.getBySlug('starter')` / §4.2 service contract
  Description: §9.2 calls `subscriptionService.getBySlug('starter')` but §4.2 only defines `getSubscription(id)` — `getBySlug` (or equivalent slug-lookup) is missing from the service contract.
  Classification: mechanical
  Reasoning: Direct internal inconsistency — a function is called in one section of the spec that is not defined in the service contract section. The fix is to add `getSubscriptionBySlug(slug: string)` to §4.2 and update the §9.2 call site to use the consistent name. No scope or direction change.
  Disposition: auto-apply

---

FINDING #3
  Source: Rubric-contradictions
  Section: §8.3 Integrations page filtering
  Description: §8.3 says "the template's `operationalDefaults.requiredConnectorType` field" treating it as a JSONB key inside `operationalDefaults`, but in the actual schema `requiredConnectorType` is a separate top-level TEXT column on `system_hierarchy_templates` (not nested inside JSONB).
  Classification: mechanical
  Reasoning: Factual mismatch between spec prose and actual schema. The codebase confirms `requiredConnectorType text('required_connector_type')` is a top-level column (in `server/db/schema/systemHierarchyTemplates.ts`), separate from `operationalDefaults jsonb`. Correcting the prose to say "top-level column" rather than "operationalDefaults key" resolves the contradiction without any scope change.
  Disposition: auto-apply

---

FINDING #4
  Source: Rubric-contradictions
  Section: §2.1 current state audit — systemHierarchyTemplates column list
  Description: The §2.1 column inventory for `system_hierarchy_templates` does not include `requiredConnectorType` (TEXT column), which exists in the current schema.
  Classification: mechanical
  Reasoning: The §2.1 audit is supposed to enumerate existing columns. `requiredConnectorType` exists in `server/db/schema/systemHierarchyTemplates.ts` as a top-level column and was verified in the codebase. Omitting it from the audit creates a mismatch with §8.3's claim that the field "already exists in the schema" — an implementer reading §2.1 wouldn't know it exists.
  Disposition: auto-apply

---

FINDING #5
  Source: Rubric-load-bearing-claims-without-contracts
  Section: §9.6 Verification checklist
  Description: The new `GET /api/onboarding/status` endpoint (added in HITL resolution of Finding 2.1) has no corresponding verification steps in §9.6.
  Classification: mechanical
  Reasoning: The verification checklist should cover every load-bearing endpoint. The endpoint was added to the spec in this session (HITL modification) and the checklist wasn't updated. Adding verification steps for the three key states (pre-OAuth, post-OAuth, post-first-run) and cross-device resumption is a pure completeness fix.
  Disposition: auto-apply

---

FINDING #6
  Source: Rubric-file-inventory-drift
  Section: §9.3 Step 3 / onboarding route table
  Description: §9.3 Step 3 references `GET /api/onboarding/sync-status` in prose and §9.5 defines `getSyncStatus(orgId)` in the service contract, but the route is absent from the §9.3 API route table.
  Classification: mechanical
  Reasoning: The route is mentioned in Step 3 prose and the backing service function exists in §9.5, but it's not in the route table. An implementer building from the route table would omit this route. File inventory drift — add the missing route to the table.
  Disposition: auto-apply

---

FINDING #7
  Source: Rubric-contradictions
  Section: §6.5 — reports table migration comment vs §11 migration inventory
  Description: The SQL comment inside the `reports` table definition says "Migration: 0106_reports.sql (or combined with earlier migrations)" but §11 (the authoritative migration inventory) explicitly commits to a single migration 0104 combining all tables including `reports`.
  Classification: mechanical
  Reasoning: Direct internal contradiction between §6.5 inline comment and §11 migration inventory. §11 is the authoritative source for migration numbering — §6.5's comment is stale from when separate migrations were considered. Fix: update the §6.5 comment to reference migration 0104.
  Disposition: auto-apply

---

## Adjudication log

[ACCEPT] §4.6 — Job registration references non-existent `server/jobs/index.ts`
  Fix applied: Updated §4.6 to reference `server/services/queueService.ts` as the correct registration location for cron schedules, with an explicit `boss.schedule()` call example. Added note that `server/jobs/index.ts` does not exist.

[ACCEPT] §4.2 / §9.2 — `subscriptionService.getBySlug` called but not defined in service contract
  Fix applied: Added `getSubscriptionBySlug(slug: string): Promise<Subscription>` to §4.2 service contract; updated §9.2 call site from `getBySlug` to `getSubscriptionBySlug` for consistency.

[ACCEPT] §8.3 — `requiredConnectorType` incorrectly described as inside `operationalDefaults` JSONB
  Fix applied: Corrected §8.3 prose to state that `requiredConnectorType` is a top-level column on `system_hierarchy_templates`, not a key inside `operationalDefaults` JSONB.

[ACCEPT] §2.1 — `requiredConnectorType` column missing from current state audit
  Fix applied: Added `requiredConnectorType` (text) to the §2.1 column inventory for `server/db/schema/systemHierarchyTemplates.ts`.

[ACCEPT] §9.6 — Missing verification steps for `GET /api/onboarding/status`
  Fix applied: Added 4 verification items: (1) status immediately after signup, (2) status after GHL OAuth, (3) status after first report, (4) wizard cross-device resumption.

[ACCEPT] §9.3 route table / §9.5 service — `GET /api/onboarding/sync-status` missing from route table
  Fix applied: Added `GET /api/onboarding/sync-status` row to the §9.3 API route table.

[ACCEPT] §6.5 — Migration comment references `0106_reports.sql` contradicting §11's single-migration decision
  Fix applied: Updated §6.5 SQL comment from "0106_reports.sql (or combined with earlier migrations)" to "0104 (combined migration — see §11 Migration inventory)".

---

## Iteration counts

- mechanical_accepted: 7
- mechanical_rejected: 0
- directional_or_ambiguous: 0

## Iteration 3 Summary

- Mechanical findings accepted:  7
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified to directional:   0
- HITL checkpoint path:          none this iteration
- HITL status:                   none
- Spec commit after iteration:   87723bf046029c6c8b06abc7613b613f6ae67d5b (changes applied in-session, not yet committed)
