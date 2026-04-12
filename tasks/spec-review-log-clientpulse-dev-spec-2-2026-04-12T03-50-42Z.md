# Spec Review Log — clientpulse-dev-spec — Iteration 2

**Spec:** `docs/clientpulse-dev-spec.md`
**Spec commit at start:** `87723bf046029c6c8b06abc7613b613f6ae67d5b` (HEAD)
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Codex status:** Not available (rubric-only review)
**Timestamp:** 2026-04-12T03:50:42Z

## Resuming from iteration 1

Checkpoint `tasks/spec-review-checkpoint-clientpulse-dev-spec-1-2026-04-12T01-53-23Z.md` — Finding 1.1 (RLS policies for `reports` and `org_subscriptions`):
- Decision: `apply` — applied in commit `b11c040`
- Verified in spec §11: migration 0104 now includes RLS policies and rlsProtectedTables.ts additions
- Status: resolved, iteration 1 closed

## Finding classifications

---

FINDING #1 (combined — two column name errors on same line)
  Source: Rubric-contradictions
  Section: §2.3 (line 90) — Current state audit table for Migration 0043
  Description: Two column name errors in the §2.3 audit table: `execution_mode` should be `execution_scope` and `result_status` should be `run_result_status`, per the actual migration 0043 SQL.
  Classification: mechanical
  Reasoning: Factual mismatch between spec and actual migration SQL (`ALTER TABLE agent_runs ADD COLUMN execution_scope text` and `ADD COLUMN run_result_status text`). Pure documentation error in the current-state audit.
  Disposition: auto-apply

---

FINDING #2
  Source: Rubric-contradictions
  Section: §2.1 (line 61) — systemHierarchyTemplates "Exists" column list
  Description: §2.1 lists `slug` as an existing column of `system_hierarchy_templates`, but the actual schema file (`server/db/schema/systemHierarchyTemplates.ts`) has no `slug` column — it is being added for the first time in migration 0104 as specified by this spec.
  Classification: mechanical
  Reasoning: Factual error in the current-state audit — including a to-be-added column in the "Exists" description is an internal contradiction with §6.3 which states "The `system_hierarchy_templates` table has NO `slug` column." The §2.1 should reflect the pre-migration state.
  Disposition: auto-apply

---

FINDING #3
  Source: Rubric-contradictions
  Section: §8.2.1 (line 1134) — Sync status bar hook vs line 1140 Real-time updates paragraph
  Description: Line 1134 says the sync status bar "Uses `useSocketRoom` for live updates" but line 1140 (same section) explicitly says "Use `useSocket('dashboard:update', callback)` (the global hook, **not** `useSocketRoom`)". §6.9 also specifies `useSocket`, not `useSocketRoom`.
  Classification: mechanical
  Reasoning: Direct internal contradiction. §6.9 and line 1140 are consistent with each other; line 1134 is the outlier. The correct hook is `useSocket` as stated in §6.9 and the paragraph in §8.2.1 itself.
  Disposition: auto-apply

---

FINDING #4
  Source: Rubric-file-inventory-drift
  Section: §8.2.2 — Reports list route table (lines 1161–1163)
  Description: The route table for `/api/reports*` is missing `POST /api/reports/:id/resend`, which is referenced in §8.2.3's UI description. Also, `GET /api/reports/latest` appears AFTER `GET /api/reports/:id` in the table — in Express, this is a registration-order bug because `:id` will capture requests to `/latest` before the `latest` handler fires.
  Classification: mechanical
  Reasoning: The `resend` route is named in the UI description but absent from the route contract table (file inventory drift). The route ordering of `latest` after `:id` is a sequencing bug — it will cause `/api/reports/latest` to be handled by the `/:id` handler with `id = 'latest'`. Both are mechanical fixes: add the missing route and reorder so `latest` precedes `:id`.
  Disposition: auto-apply

---

FINDING #5
  Source: Rubric-load-bearing-claims-without-contracts
  Section: §4.2 — `archiveSubscription()` mechanism
  Description: The `subscriptions` table defines BOTH a `deleted_at` column (soft-delete pattern) AND a `status='archived'` value in the CHECK constraint. `archiveSubscription()` is described as "Archive (soft-delete)" but does not specify which mechanism it uses, creating an under-specified contract.
  Classification: mechanical
  Reasoning: The answer is implied by the existing code (the UI filter shows Status in ('active'/'draft'/'archived'), meaning status drives visibility, not deleted_at) and by the pattern in modules (which uses deleted_at). But "implied" is not "specified" — a one-sentence clarification in the service comment resolves this cleanly. The `subscriptions` table uses status='archived' for archival (soft-delete via status, not deleted_at); deleted_at is present for potential hard-delete or future use. Fix: add a one-sentence note in the archiveSubscription comment.
  Disposition: auto-apply

---

FINDING #6
  Source: Rubric-load-bearing-claims-without-contracts
  Section: §9.3 — Onboarding wizard state tracking
  Description: The spec says "The wizard tracks progress via a `wizard_step` field on the org or a separate `onboarding_state` in localStorage" — the "or" is unresolved. If a DB column is used, it must appear in the migration inventory (§11). The migration 0104 description does not include any `wizard_step` or onboarding column.
  Classification: ambiguous
  Reasoning: The "or" between a DB column approach and localStorage is an unresolved implementation choice with migration implications. Using localStorage is simpler (no migration needed, pre-production codebase is the right default) but means onboarding state is lost on device switch. Using a DB column (e.g. `organisations.onboarding_step`) requires a migration 0104 addition. This cannot be resolved mechanically — the human must decide which approach. Classifying as ambiguous because I cannot confirm which option the human intended without guessing.
  Disposition: HITL-checkpoint

---

## Adjudication log

[ACCEPT] §2.3 line 90 — `execution_mode` and `result_status` column name errors
  Fix applied: Corrected `execution_mode` to `execution_scope` and `result_status` to `run_result_status` in the §2.3 audit table row for Migration 0043.

[ACCEPT] §2.1 line 61 — `slug` listed as existing column in systemHierarchyTemplates
  Fix applied: Removed `slug` from the "Exists" column list in §2.1; added a note that slug is added by migration 0104.

[ACCEPT] §8.2.1 line 1134 — `useSocketRoom` vs `useSocket` contradiction
  Fix applied: Changed "Uses `useSocketRoom` for live updates" to "Uses `useSocket('dashboard:update', callback)` for live updates" in the sync status bar description.

[ACCEPT] §8.2.2 — Missing `POST /api/reports/:id/resend` route and route ordering bug
  Fix applied: Added `POST /api/reports/:id/resend` to the routes table; reordered `GET /api/reports/latest` to appear before `GET /api/reports/:id`; updated Phase 3 effort table (§12) to list all four routes.

[ACCEPT] §4.2 — archiveSubscription mechanism unspecified (deleted_at vs status='archived')
  Fix applied: Added one-sentence clarification to the `archiveSubscription` comment specifying that it sets `status = 'archived'` (not deleted_at).

---

## Iteration counts

- mechanical_accepted: 5
- mechanical_rejected: 0
- directional_or_ambiguous: 1

## Iteration 2 Summary

- Mechanical findings accepted:  5
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            1
- Reclassified to directional:   0
- HITL checkpoint path:          tasks/spec-review-checkpoint-clientpulse-dev-spec-2-2026-04-12T03-50-42Z.md
- HITL status:                   resolved
- Spec commit after iteration:   87723bf046029c6c8b06abc7613b613f6ae67d5b (changes applied in-session, not yet committed)

## HITL Resolution — Finding 2.1

Decision: `apply-with-modification`
Modification applied:
- Replaced ambiguous "wizard_step field on the org OR localStorage" text with derive-from-API pattern
- Added `GET /api/onboarding/status` endpoint returning `{ ghlConnected, agentsProvisioned, firstRunComplete }` derived from existing DB tables
- Defined cross-device safe wizard step resolution: wizard calls this endpoint on mount and on step completion
- `localStorage` scoped to within-session UX continuity only (current page, not step completion state)
- Added `GET /api/onboarding/status` route to §9.3 route table
- Added `getOnboardingStatus(orgId)` function to §9.5 service contract
- No migration change needed — consistent with §11 having no wizard_step column
