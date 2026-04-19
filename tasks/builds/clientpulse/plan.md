# ClientPulse Implementation Plan — Phases 0 + 0.5 + 1 + 2 + 3

**Spec:** `tasks/clientpulse-ghl-gap-analysis.md` (spec-reviewer-clean, 5/5 lifetime cap reached — do not re-invoke)
**Progress:** `tasks/builds/clientpulse/progress.md`
**Branch:** `claude/commit-to-main-y5BoZ`
**Scope:** server-only, single PR, Phase 4+ deferred

This plan is built chunk-by-chunk to avoid architect-agent timeouts. §§2–6 below are written per phase as that phase begins implementation, not all upfront.

---

## §1. Cross-cutting architecture decisions

Settled before any code lands. Apply to every phase.

### 1.1 Migration sequence

Next free number is **0170**. Five new migrations planned across the PR:

| # | File | Phase |
|---|------|-------|
| 0170 | `0170_clientpulse_template_extension.sql` | 0 |
| 0171 | `0171_playbook_run_scope.sql` | 0.5 |
| 0172 | `0172_clientpulse_signal_observations.sql` (+ canonical fingerprint/mutation tables) | 1 |
| 0173 | `0173_clientpulse_health_snapshots.sql` | 2 |
| 0174 | `0174_clientpulse_churn_assessments.sql` | 3 |

Any additional migrations (rollback pairs, dictionary seeds) slot after 0174 in sequence.

### 1.2 Handler re-targeting strategy (Phases 2 & 3)

**Decision:** `skillExecutor.ts:1269` (`compute_health_score`) and `:1279` (`compute_churn_risk`) are re-targeted to write to ClientPulse-shaped tables **in addition** to existing targets during a deprecation window. Dual-write — no switch cutover. Reason: existing generic `health_snapshots` has other readers (per §25.1); removing those writes in the same PR widens blast radius. Phase 4+ decides when to drop the generic write.

### 1.3 OAuth scope expansion safety

**Decision:** expanded scope list in `oauthProviders.ts` applies to new OAuth authorisations only. Existing connections with the old 3-scope token continue to work for their existing endpoint set. Endpoints that need the new scopes (funnels, calendars, users, locations, saas/subscription) gate their adapter calls with a scope-presence check and mark the observation `unavailable_missing_scope` when absent — triggering a re-consent prompt surfaced at phase 5 (out of scope for this PR). Documented in progress.md.

### 1.4 Canonical table pattern

**Decision:** the 6 new canonical fingerprint/mutation tables added in Phase 1 (`canonical_subaccount_mutations`, `canonical_conversation_providers`, `canonical_workflow_definitions`, `canonical_tag_definitions`, `canonical_custom_field_definitions`, `canonical_contact_sources`) share a common column header set (`organisation_id`, `subaccount_id`, `provider_type`, `external_id`, `observed_at`, `last_seen_at`) and the same RLS policy shape. They get one migration file but separate `CREATE TABLE` statements — no shared-helper abstraction, per CLAUDE.md §Core Principles "three similar lines is better than a premature abstraction." Each gets its own entry in `rlsProtectedTables.ts` and `canonicalDictionaryRegistry.ts`.

Unique constraint per canonical table: `UNIQUE(organisation_id, provider_type, external_id)` per §25.1 contract.

### 1.5 Test posture

Pure tests (`*Pure.test.ts`) for every new service / handler. Integration tests only where fixture data is available. Trajectory test `portfolio-health-3-subaccounts.json` (Phase 2 ship gate) is fixture-based — no live GHL required.

### 1.6 CLAUDE.md Current focus pointer

At Phase 0 start, update `CLAUDE.md` "Current focus" pointer from the canonical-data-platform roadmap reference to the ClientPulse build. Revert at final PR staging.

### 1.7 Open questions (none blocking)

Spec is directive on all Phases 0–3 scope. No HITL decisions needed before starting.

---

## §2. Phase 0 — Template extension + OAuth scopes + operational_config JSON Schema (B4)

### 2.1 Files to create

| Path | Purpose |
|------|---------|
| `migrations/0170_clientpulse_template_extension.sql` | UPDATE `system_hierarchy_templates` operational_defaults merge + UPDATE `oauth_providers` (if applicable — check schema) |
| `server/services/operationalConfigSchema.ts` | JSON Schema for `operational_config` with `sensitive` flags on intervention-template paths (B4). Exported as `OPERATIONAL_CONFIG_SCHEMA` + `SENSITIVE_CONFIG_PATHS: string[]`. |
| `server/services/__tests__/operationalConfigSchemaPure.test.ts` | Schema-validation tests: required fields present, sum constraints (healthScoreFactors weights sum to 1.0), sensitive-path enumeration round-trips. |
| `server/services/__tests__/orgConfigServicePure.test.ts` | Tests for 5 new accessors returning template defaults when no org override present. (Create only if this test file does not already exist; if it exists, append tests.) |

### 2.2 Files to modify

| Path | Change |
|------|--------|
| `server/config/oauthProviders.ts:52–56` | Extend GHL scopes array: add `locations.readonly`, `users.readonly`, `calendars.readonly`, `funnels.readonly`, `conversations.readonly`, `conversations/message.readonly`, `businesses.readonly`, `saas/subscription.readonly`. |
| `server/routes/ghl.ts` | Remove duplicate scope definition; build `scope=` query string from `OAUTH_PROVIDERS.ghl.scopes.join(' ')` — SSoT fix per §2.3 / I7 / locked contract (g). |
| `server/services/orgConfigService.ts` | Add 5 accessors: `getStaffActivityDefinition`, `getIntegrationFingerprintConfig`, `getChurnBands`, `getInterventionDefaults`, `getOnboardingMilestoneDefs`. Each follows existing pattern: system default → template override → org override. |
| `CLAUDE.md` §Current focus | Update pointer to ClientPulse build. |

### 2.3 Migration 0170 contents

Merge JSONB literal from spec §12.2 Gap A into the `ghl-agency-intelligence` template:

```sql
UPDATE system_hierarchy_templates
SET operational_defaults = operational_defaults || $${
  "staffActivity": { ... },              -- §12.2 full literal
  "integrationFingerprints": { ... },    -- §12.2 full literal
  "interventionDefaults": { ... },       -- §12.2 full literal
  "churnBands": { ... },                 -- §12.2 full literal
  "onboardingMilestones": []
}$$::jsonb
WHERE slug = 'ghl-agency-intelligence';
```

Rollback pair in `migrations/_down/0170_*.sql` removes the 5 new keys via `operational_defaults - 'staffActivity' - …`.

### 2.4 Tests

- `operationalConfigSchemaPure.test.ts` — 6+ cases: valid full config, missing required, weights don't sum, invalid sensitive path, enum mismatch, round-trip serialise.
- `orgConfigServicePure.test.ts` — 5 new accessors return seeded template defaults for a fresh org.

### 2.5 Ship-gate verification

Phase 0 ship gate (per progress.md line 53):

1. Run migration in a test DB. Assert `SELECT operational_defaults->'staffActivity'->'countedMutationTypes' FROM system_hierarchy_templates WHERE slug='ghl-agency-intelligence'` returns 10 rows.
2. Call `orgConfigService.getStaffActivityDefinition(testOrgId)` with no org override — assert the returned object matches the seeded JSONB shape without the caller having supplied defaults.
3. Run `OAUTH_PROVIDERS.ghl.scopes` assertion — length === 11 (3 existing + 8 new per Gap E).

### 2.6 Verification commands

```
npm run lint
npm run typecheck
npm test -- operationalConfigSchemaPure orgConfigServicePure
npm run db:generate   # verify 0170 migration file is generated cleanly
```

---

## §3. Phase 0.5 — Playbook engine scope refactor

*(Written at Phase 0.5 kickoff. Not expanded here to keep plan under architect timeout budget.)*

---

## §4. Phase 1 — Signal ingestion (6 adapter fns + canonical tables + RateLimiter B1)

*(Written at Phase 1 kickoff.)*

---

## §5. Phase 2 — Health-score execution (re-target skillExecutor.ts:1269)

*(Written at Phase 2 kickoff.)*

---

## §6. Phase 3 — Churn risk evaluation (re-target skillExecutor.ts:1279)

*(Written at Phase 3 kickoff.)*

---

## §7. Final verification plan

After all 5 phases land:

1. `npm run lint` — 0 errors
2. `npm run typecheck` — 0 errors
3. `npm test` — full server suite passes
4. `npm run db:generate` — 5 migrations (0170–0174) cleanly generated
5. `scripts/verify-job-idempotency-keys.sh` — passes (new jobs declare idempotency strategy)
6. `pr-reviewer` pass on combined diff
7. `dual-reviewer` pass on combined diff (≤3 iterations per CLAUDE.md)
8. Revert CLAUDE.md "Current focus" to post-build state
9. Stage PR description + reviewer outcomes for user sign-off — do NOT auto-push / auto-open

---

## §8. Handoff contract (for PR description)

**Scope:** ClientPulse Phases 0 + 0.5 + 1 + 2 + 3, server-only. Phase 4+ (intervention pipeline, 5 action primitives, UI editors, outcome loop) deferred to follow-up PR.

**§26.1 ship-gates closed by this PR:** B1 (RateLimiter wired), B4 (operational_config JSON Schema). Remaining (B2, B3, B5, B6) are Phase 4+ work.

**Vertical-slice validation:** NOT reachable in this PR — requires Phase 4. This PR lands the first half of the slice (signal → scoring → churn band).

**Locked contracts honoured:**
- (f) `skillExecutor.ts:1269` and `:1279` re-targeted (dual-write); no parallel handler files
- (g) OAuth scope SSoT in `oauthProviders.ts`; `server/routes/ghl.ts` duplicate removed
- (h) Every new canonical table has `UNIQUE(org, provider_type, external_id)`, RLS migration, `rlsProtectedTables.ts` entry, `canonicalDictionaryRegistry.ts` entry

---

## §9. Phase 1 follow-ups

Scope: webhook expansion + 2 real skill handlers + integration-fingerprint tables/seed + canonical dictionary entries. Replaces placeholder observations for `staff_activity_pulse` and `integration_fingerprint`. `ai_feature_usage` stays placeholder (deferred to Operate-tier).

### §9.1 Files to create

| Path | Purpose |
|------|---------|
| `migrations/0177_clientpulse_integration_fingerprints.sql` | Create `integration_fingerprints`, `integration_detections`, `integration_unclassified_signals`; seed library from `operational_config.integrationFingerprints.seedLibrary` (CloseBot, Uphex minimum). Bumped from 0176 after merge with IEE 0176_iee_run_id_and_inflight_index.sql landed on main. |
| `migrations/0177_clientpulse_integration_fingerprints.down.sql` | Rollback pair. |
| `server/skills/computeStaffActivityPulse.ts` | Real handler for `compute_staff_activity_pulse`. |
| `server/skills/scanIntegrationFingerprints.ts` | Real handler for `scan_integration_fingerprints`. |
| `server/services/__tests__/computeStaffActivityPulsePure.test.ts` | Pure tests for the staff-activity algorithm. |
| `server/services/__tests__/scanIntegrationFingerprintsPure.test.ts` | Pure tests for fingerprint matching + unclassified-signal writes. |
| `server/services/__tests__/ghlWebhookMutationsPure.test.ts` | Pure tests for the 10 event → mutation mappings (includes `externalUserKind` outlier heuristic). |

### §9.2 Files to modify

| Path | Change |
|------|--------|
| `server/routes/webhooks/ghlWebhook.ts` | Add switch cases for `INSTALL`, `UNINSTALL`, `LocationCreate`, `LocationUpdate`; extend existing 6 handlers to write `canonical_subaccount_mutations`. |
| `server/adapters/ghlAdapter.ts` (webhook normaliser) | Add 4 new event shapes to `normaliseEvent()`. |
| `server/config/actionRegistry.ts` | Register `compute_staff_activity_pulse`, `scan_integration_fingerprints`. |
| `server/services/skillExecutor.ts` | Add two case-statements adjacent to `compute_health_score` (:1269) and `compute_churn_risk` (:1279). Decrement `capabilityQueryCallCount` if these skills call capability discovery. |
| `server/config/canonicalDictionaryRegistry.ts` | Add 6 Phase-1 canonical-table entries (locked contract (i)). |

### §9.3 Migration 0177 contents

Tables per spec §2.0c lines 318–354. Columns (summary, full DDL at implementation time):

- `integration_fingerprints` — `id, organisation_id NULL (NULL=system scope), provider_type, pattern_type, pattern_value, matched_capability, confidence_weight, active, created_at`. Unique on `(COALESCE(organisation_id, '00000000-...'), provider_type, pattern_type, pattern_value)`.
- `integration_detections` — `id, organisation_id, subaccount_id, fingerprint_id, detected_at, poll_run_id, source_table, source_row_id, confidence`. Unique on `(subaccount_id, fingerprint_id, source_row_id)`.
- `integration_unclassified_signals` — `id, organisation_id, subaccount_id, provider_type, signal_key, sample_value, seen_count, first_seen_at, last_seen_at`. Unique on `(subaccount_id, provider_type, signal_key)`.

All three added to `rlsProtectedTables.ts` + RLS policies in same migration. Seed at least CloseBot + Uphex fingerprints into `integration_fingerprints` with `organisation_id=NULL`.

### §9.4 Webhook handler contract

| Event | mutationType | sourceEntity | externalUserId source | Notes |
|-------|--------------|--------------|----------------------|-------|
| ContactCreate | `contact_created` | `contact` | `event.contact.createdBy` | existing handler extended |
| ContactUpdate | `contact_updated` | `contact` | `event.contact.updatedBy` | existing handler extended |
| OpportunityStageUpdate | `opportunity_stage_changed` | `opportunity` | `event.opportunity.updatedBy` | existing handler extended |
| OpportunityStatusUpdate | `opportunity_status_changed` | `opportunity` | `event.opportunity.updatedBy` | existing handler extended |
| ConversationCreated | `message_sent_outbound` | `conversation` | `event.message.userId` | only when `direction='outbound' AND userId IS NOT NULL AND conversationProviderId IS NULL` |
| ConversationUpdated | `message_sent_outbound` | `conversation` | same | same guard |
| INSTALL | `app_installed` | `location` | `event.installedBy` | new normaliser + handler |
| UNINSTALL | `app_uninstalled` | `location` | `event.uninstalledBy` | new normaliser + handler |
| LocationCreate | `location_created` | `location` | `event.createdBy` | new normaliser + handler |
| LocationUpdate | `location_updated` | `location` | `event.updatedBy` | new normaliser + handler |

`externalUserKind` resolved via `resolveUserKindByVolume(orgId, subaccountId, externalUserId)` — implements `outlier_by_volume` with `threshold=0.6` from `getStaffActivityDefinition(orgId).automationUserResolution`. Returns `'human' | 'automation' | 'unknown'`.

### §9.5 Skill: compute_staff_activity_pulse

- Input: `{ orgId, subaccountId, lookbackDays? }`.
- Output: observation row `{ signalKey: 'staff_activity_pulse', value: weightedScore, metadata: { countsByType, windowDays, excludedUsers } }`.
- Algorithm: read `canonical_subaccount_mutations` within `lookbackWindowsDays` (from config); filter out `externalUserKind ∈ excludedUserKinds`; sum `count * countedMutationTypes[type].weight`; normalise per config; write to `client_pulse_signal_observations`.
- Idempotency: `(subaccountId, 'staff_activity_pulse', date_trunc('day', now()))`.

### §9.6 Skill: scan_integration_fingerprints

- Input: `{ orgId, subaccountId }`.
- Output: observation `{ signalKey: 'integration_fingerprint', value: detectionCount, metadata: { detections: [...], unclassified: [...] } }`.
- Algorithm: iterate `integration_fingerprints` (system + org-scoped); match against the 5 canonical artifact tables (`canonical_workflow_definitions`, `canonical_tag_definitions`, `canonical_custom_field_definitions`, `canonical_contact_sources`, `canonical_conversation_providers`) filtered to subaccount; upsert `integration_detections`; rows that look like integration fingerprints (name prefix/suffix, provider-specific patterns) but match nothing get upserted to `integration_unclassified_signals` with `seen_count` bumped.
- Idempotency: `(subaccountId, 'integration_fingerprint', pollRunId)`.

### §9.7 Tests

Pure tests (no DB), 4–6 cases each:

- **computeStaffActivityPulsePure**: weights applied correctly; excluded user-kind filtered; zero-mutation subaccount returns 0 not NaN; lookback window respected; config missing falls back to defaults.
- **scanIntegrationFingerprintsPure**: exact match; case-insensitive prefix match; system + org fingerprints both considered; unmatched candidate routed to unclassified; duplicate detection idempotent.
- **ghlWebhookMutationsPure**: each of the 10 events produces the correct row; outlier heuristic classifies majority user as `human` and low-volume as `automation`; unknown user returns `'unknown'`; ConversationCreated with `conversationProviderId IS NOT NULL` writes NO mutation row.

### §9.8 Ship-gate verification

**In-session (blocking the commit):**
- `npx tsc --noEmit -p server/tsconfig.json` — zero new errors.
- `npx tsx server/services/__tests__/computeStaffActivityPulsePure.test.ts` — pass.
- `npx tsx server/services/__tests__/scanIntegrationFingerprintsPure.test.ts` — pass.
- `npx tsx server/services/__tests__/ghlWebhookMutationsPure.test.ts` — pass.
- Migration dry-run: `psql -f migrations/0177_... && psql -f migrations/0177_....down.sql && psql -f migrations/0177_....sql`.
- Fixture-driven skill run against seeded `canonical_subaccount_mutations` produces non-null observation value for 7 of 8 signals (ai_feature_usage remains placeholder).

**Pilot-gated (not blocking this PR, verified post-merge):**
- Live GHL webhook replay populates `canonical_subaccount_mutations` for real sub-accounts.
- Outlier heuristic threshold (0.6) tuned against real user-volume distributions.
- Fingerprint library grown beyond CloseBot/Uphex seed via ops review of `integration_unclassified_signals`.

### §9.9 Commit granularity

Recommended 4 commits on this PR:

1. Migration 0177 + rollback + `rlsProtectedTables.ts` additions + seed rows.
2. `canonicalDictionaryRegistry.ts` entries for the 6 Phase-1 canonical tables (locked contract (i)).
3. Webhook handler expansion (4 new events + mutation writes on 6 existing) + pure tests.
4. Two skill handlers + registry + executor wiring + pure tests.
