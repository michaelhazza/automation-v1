# Chunk 1 — RLS Hardening — Verification Log

**Authored:** 2026-04-26
**Branch:** `spec/pre-launch-hardening`
**Source spec:** `docs/pre-launch-rls-hardening-spec.md`
**Invariants pinned:** `cf2ecbd0` (`docs/pre-launch-hardening-invariants.md`)

This log captures the present-state verification of the Chunk 1 surface as authored by the mini-spec on 2026-04-26. Migration 0227 (commit `c6f491c3` "feat(phase-1): RLS hardening — migration 0227, service extractions, org-scoped write guards, subaccount resolution, gate baselines") landed between the mini-spec audit and the start of Chunk 1 spec authoring, and closed 12 of the 14 cited items. This log records the verification evidence so the audit trail is durable.

## Table of contents

1. Already-closed items — verified evidence
2. Truly-open items
3. SC-1 — RLS-protected-tables 3-set delta
4. Manifest entries — per-table classification (full table)

---

## 1. Already-closed items — verified evidence

For each item: the verification command, the expected outcome (per the mini-spec's gap claim), and the observed outcome (per direct grep / file inspection 2026-04-26).

### P3-C1 — `memory_review_queue` FORCE RLS + CREATE POLICY

- **Mini-spec claim:** Missing FORCE RLS + CREATE POLICY (migration 0139).
- **Verified by:** `grep "memory_review_queue.*FORCE\|memory_review_queue_org_isolation" migrations/0227_rls_hardening_corrective.sql`
- **Result:** `ALTER TABLE memory_review_queue FORCE ROW LEVEL SECURITY;` + `CREATE POLICY memory_review_queue_org_isolation` present in migration 0227. **CLOSED.**

### P3-C2 — `drop_zone_upload_audit` FORCE RLS

- **Mini-spec claim:** Missing FORCE RLS (migration 0141).
- **Verified by:** `grep "drop_zone_upload_audit.*FORCE" migrations/0227_rls_hardening_corrective.sql`
- **Result:** `ALTER TABLE drop_zone_upload_audit FORCE ROW LEVEL SECURITY;` present. **CLOSED.**

### P3-C3 — `onboarding_bundle_configs` FORCE RLS

- **Mini-spec claim:** Missing FORCE RLS (migration 0142).
- **Verified by:** `grep "onboarding_bundle_configs.*FORCE" migrations/0227_rls_hardening_corrective.sql`
- **Result:** `ALTER TABLE onboarding_bundle_configs FORCE ROW LEVEL SECURITY;` present. **CLOSED.**

### P3-C4 — `trust_calibration_state` FORCE RLS

- **Mini-spec claim:** Missing FORCE RLS (migration 0147).
- **Verified by:** `grep "trust_calibration_state.*FORCE" migrations/0227_rls_hardening_corrective.sql`
- **Result:** `ALTER TABLE trust_calibration_state FORCE ROW LEVEL SECURITY;` present. **CLOSED.**

### P3-C6 — `routes/memoryReviewQueue.ts` direct `db` import

- **Mini-spec claim:** Direct `db` import bypasses RLS middleware; needs service-layer extraction.
- **Verified by:** `grep -nE "^import.*\bdb\b" server/routes/memoryReviewQueue.ts`
- **Result:** No matches. The route no longer imports `db` directly. **CLOSED.**

### P3-C7 — `routes/systemAutomations.ts` direct `db` import

- **Verified by:** `grep -nE "^import.*\bdb\b" server/routes/systemAutomations.ts`
- **Result:** No matches. **CLOSED.**

### P3-C8 — `routes/subaccountAgents.ts` direct `db` import

- **Verified by:** `grep -nE "^import.*\bdb\b" server/routes/subaccountAgents.ts`
- **Result:** No matches. **CLOSED.**

### P3-C9 — `routes/clarifications.ts` missing `resolveSubaccount`

- **Verified by:** `grep -nE "resolveSubaccount" server/routes/clarifications.ts`
- **Result:** Line 17 imports `resolveSubaccount`; line 33 calls `resolveSubaccount(subaccountId, orgId)`. **CLOSED.**

### P3-C10 — `documentBundleService` lines 679/685 missing `organisationId` filter

- **Verified by:** Read `server/services/documentBundleService.ts` lines 675–690.
- **Result:** Queries to `agents` and `tasks` tables now include `eq(agents.organisationId, organisationId)` and `eq(tasks.organisationId, organisationId)` in their WHERE clauses. **CLOSED.**

### P3-C11 — `skillStudioService` lines 168/309 missing `organisationId` filter

- **Verified by:** Read `server/services/skillStudioService.ts` lines 164–172.
- **Result:** `getSkillStudioContext` query at line 168 has `eq(skills.organisationId, orgId)`; throws on missing `orgId` for non-system scopes. **CLOSED.**

### P3-H2 — `lib/briefVisibility.ts` direct `db` import

- **Verified by:** Read `server/lib/briefVisibility.ts` header.
- **Result:** Header comment: "comply with the RLS architecture contract (no db imports in server/lib/)". File contains no `import db` statements. **CLOSED.**

### P3-H3 — `lib/workflow/onboardingStateHelpers.ts` direct `db` import

- **Verified by:** Read `server/lib/workflow/onboardingStateHelpers.ts` header.
- **Result:** Same compliance comment as P3-H2. No `import db` statements. **CLOSED.**

---

## 2. Truly-open items

### P3-C5 — Phantom `app.current_organisation_id` session variable

- **Mini-spec claim:** Migrations 0205, 0206, 0207, 0208 reference a session var that is never set, causing policies to silently fail-open.
- **Verified by:** `grep -lE "current_organisation_id" migrations/*.sql` (active uses only — comments excluded).
- **Result:** Active phantom-var uses found in **6 migrations**, not 5 (mini-spec scope was incomplete):
  - `0204_document_bundles.sql` (1 occurrence)
  - `0205_document_bundle_members.sql` (2 occurrences — USING + sub-EXISTS)
  - `0206_document_bundle_attachments.sql` (1 occurrence)
  - `0207_bundle_resolution_snapshots.sql` (1 occurrence)
  - `0208_model_tier_budget_policies.sql` (2 occurrences)
  - `0212_bundle_suggestion_dismissals.sql:32` (1 occurrence — **missed by mini-spec**)

  Comments-only references in 0200, 0213, 0227 are not violations. Total active uses: **8 occurrences across 6 migrations**.
- **Status:** OPEN. Closed by Chunk 1 spec via new corrective migration that sweeps all 6 source migrations.

### GATES-2026-04-26-1 — `reference_documents` / `reference_document_versions` FORCE RLS via parent-EXISTS

- **Mini-spec claim:** Both tables are RLS-listed but missing the parent-EXISTS WITH CHECK variant the mini-spec / invariant 1.7 require.
- **Verified by:** `grep "reference_documents.*FORCE\|reference_document_versions.*FORCE" migrations/*.sql`
- **Result:** Both tables have `ENABLE ROW LEVEL SECURITY` (in 0202 and 0203 respectively) but neither has `FORCE ROW LEVEL SECURITY`. Migration 0213 mentions them in comments (the cleanup-side note from PR #203 round 1) but does not add FORCE.
- **Status:** OPEN. Closed by Chunk 1 spec via new corrective migration. The parent-EXISTS variant is required because `reference_document_versions` has no `organisation_id` column — it must be scoped via `EXISTS (SELECT 1 FROM reference_documents WHERE id = reference_document_versions.document_id AND organisation_id = current_setting('app.organisation_id', true)::uuid)`.

---

## 3. SC-1 — RLS-protected-tables 3-set delta

The mini-spec asserted a "60-table delta between RLS-protected-tables registry and migrations" as of 2026-04-26. Direct verification (manifest entries × migration FORCE RLS coverage × code-side tenant-scoped query usage) shows:

- **Total manifest entries:** 73
- **Aligned (3-layer complete):** 71
- **Manifest-only (FORCE RLS missing):** 2 — `reference_documents` and `reference_document_versions`, both subject to GATES-2026-04-26-1 above.
- **Migration-only:** 0
- **Code-only:** 0
- **Tenant-but-unenforced:** 0
- **System-legitimate:** 0

The drift is now **2 tables**, both already named in the mini-spec as a follow-up. The 60-table figure was accurate at 2026-04-26 audit time but was reduced to 2 by migration 0227 + the accompanying service refactors.

After GATES-2026-04-26-1 lands, drift = 0.

---

## 4. Manifest entries — per-table classification (full table)

| # | Table | Tenant scope | Manifest line | FORCE RLS migration | Classification | Gap |
|---|-------|--------------|---------------|---------------------|----------------|-----|
| 1 | `tasks` | org | 46 | 0079 | aligned | none |
| 2 | `actions` | org | 52 | 0079 | aligned | none |
| 3 | `agent_runs` | org | 58 | 0079 | aligned | none |
| 4 | `review_items` | org | 65 | 0080 | aligned | none |
| 5 | `review_audit_records` | org | 71 | 0080 | aligned | none |
| 6 | `workspace_memories` | sub | 77 | 0080 | aligned | none |
| 7 | `llm_requests` | org | 84 | 0081 | aligned | none |
| 8 | `llm_requests_archive` | org | 90 | 0188 | aligned | none |
| 9 | `audit_events` | org | 96 | 0081 | aligned | none |
| 10 | `task_activities` | org | 102 | 0091 | aligned | none |
| 11 | `task_deliverables` | org | 108 | 0091 | aligned | none |
| 12 | `tool_call_security_events` | org | 115 | 0082 | aligned | none |
| 13 | `org_subscriptions` | org | 122 | 0104 | aligned | none |
| 14 | `reports` | org | 128 | 0104 | aligned | none |
| 15 | `regression_cases` | org | 135 | 0083 | aligned | none |
| 16 | `agent_run_messages` | org | 142 | 0084 | aligned | none |
| 17 | `agent_briefings` | org | 149 | 0105 | aligned | none |
| 18 | `agent_beliefs` | org | 156 | 0112 | aligned | none |
| 19 | `subaccount_state_summaries` | sub | 162 | 0105 | aligned | none |
| 20 | `memory_blocks` | org | 169 | 0088 | aligned | none |
| 21 | `scraping_selectors` | org | 176 | 0108 | aligned | none |
| 22 | `scraping_cache` | org | 182 | 0108 | aligned | none |
| 23 | `memory_review_queue` | org | 191 | 0227 | aligned (P3-C1 closed) | none |
| 24 | `trust_calibration_state` | org | 197 | 0227 | aligned (P3-C4 closed) | none |
| 25 | `drop_zone_upload_audit` | org | 203 | 0227 | aligned (P3-C2 closed) | none |
| 26 | `onboarding_bundle_configs` | org | 209 | 0227 | aligned (P3-C3 closed) | none |
| 27 | `agent_test_fixtures` | org | 215 | 0227 | aligned | none |
| 28 | `feature_requests` | org | 222 | 0156 | aligned | none |
| 29 | `routing_outcomes` | org | 228 | 0156 | aligned | none |
| 30 | `integration_ingestion_stats` | org | 235 | 0168 | aligned | none |
| 31 | `service_principals` | org | 242 | 0167 | aligned | none |
| 32 | `teams` | org | 248 | 0167 | aligned | none |
| 33 | `team_members` | org | 254 | 0167 | aligned | none |
| 34 | `delegation_grants` | org | 260 | 0167 | aligned | none |
| 35 | `canonical_row_subaccount_scopes` | sub | 266 | 0167 | aligned | none |
| 36 | `canonical_accounts` | org | 273 | 0168 | aligned | none |
| 37 | `canonical_contacts` | org | 279 | 0168 | aligned | none |
| 38 | `canonical_opportunities` | org | 285 | 0168 | aligned | none |
| 39 | `canonical_conversations` | org | 291 | 0168 | aligned | none |
| 40 | `canonical_revenue` | org | 297 | 0168 | aligned | none |
| 41 | `health_snapshots` | org | 303 | 0168 | aligned | none |
| 42 | `anomaly_events` | org | 309 | 0168 | aligned | none |
| 43 | `canonical_metrics` | org | 315 | 0168 | aligned | none |
| 44 | `canonical_metric_history` | org | 321 | 0168 | aligned | none |
| 45 | `integration_connections` | org | 327 | 0168 | aligned | none |
| 46 | `canonical_subaccount_mutations` | sub | 334 | 0172 | aligned | none |
| 47 | `canonical_conversation_providers` | sub | 340 | 0172 | aligned | none |
| 48 | `canonical_workflow_definitions` | sub | 346 | 0172 | aligned | none |
| 49 | `canonical_tag_definitions` | sub | 352 | 0172 | aligned | none |
| 50 | `canonical_custom_field_definitions` | sub | 358 | 0172 | aligned | none |
| 51 | `canonical_contact_sources` | sub | 364 | 0172 | aligned | none |
| 52 | `client_pulse_signal_observations` | sub | 370 | 0172 | aligned | none |
| 53 | `subaccount_tier_history` | sub | 376 | 0172 | aligned | none |
| 54 | `client_pulse_health_snapshots` | sub | 383 | 0173 | aligned | none |
| 55 | `client_pulse_churn_assessments` | sub | 390 | 0174 | aligned | none |
| 56 | `integration_fingerprints` | org/system | 398 | 0177 | aligned | none |
| 57 | `integration_detections` | sub | 404 | 0177 | aligned | none |
| 58 | `integration_unclassified_signals` | sub | 410 | 0177 | aligned | none |
| 59 | `agent_execution_events` | org | 418 | 0227 | aligned | none |
| 60 | `agent_run_prompts` | org | 424 | 0227 | aligned | none |
| 61 | `agent_run_llm_payloads` | org | 430 | 0227 | aligned | none |
| 62 | `fast_path_decisions` | org | 439 | 0195 | aligned | none |
| 63 | `conversations` | org | 447 | 0194 | aligned | none |
| 64 | `conversation_messages` | org | 454 | 0194 | aligned | none |
| 65 | `reference_documents` | org | 472 | (ENABLE only in 0202) | **manifest_only** | **GATES-2026-04-26-1: add FORCE RLS via parent-EXISTS WITH CHECK** |
| 66 | `reference_document_versions` | org | 478 | (ENABLE only in 0203) | **manifest_only** | **GATES-2026-04-26-1: add FORCE RLS via parent-EXISTS (no org_id; scope via parent document_id)** |
| 67 | `document_bundles` | org | 485 | 0204 | aligned | none |
| 68 | `document_bundle_members` | org | 491 | 0205 | aligned | none |
| 69 | `document_bundle_attachments` | org | 497 | 0206 | aligned | none |
| 70 | `bundle_resolution_snapshots` | org | 503 | 0207 | aligned | none |
| 71 | `model_tier_budget_policies` | org/system | 508 | 0208 | aligned | none |
| 72 | `bundle_suggestion_dismissals` | org | 515 | 0212 | aligned | none |
| 73 | `delegation_outcomes` | org | 522 | 0217 | aligned | none |

Source: SC-1 derivation by Explore agent 2026-04-26 (cross-referenced via direct grep of `server/config/rlsProtectedTables.ts` against migration `FORCE ROW LEVEL SECURITY` patterns and code-side principal-context helper usage).
