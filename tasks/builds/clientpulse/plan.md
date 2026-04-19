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

---

## §10. Phase 4 — server + UI (chunks A, B, C, D)

Closes ship-gate B2. Locked contracts (a)(b)(e)(g) from `phase-4-and-4.5-pickup-prompt.md` §5 govern this section.

### §10.0 Cross-cutting decisions for Phase 4

1. **No new tables.** Interventions are `actions` rows + `intervention_outcomes` rows (both tables already exist). Migration 0178 only adds indexes.
2. **Migration sequence.** Next free migration number is **0178** (latest on main is 0177). If main moves before commit, renumber.
3. **Idempotency strategy for the 5 new primitives.** All 5 are `keyed_write` (per pickup prompt §8). The action row's `idempotencyKey` is the dedup vector — `(subaccountId, idempotencyKey)` already has a UNIQUE index per `actions.ts:87`.
4. **GateLevel.** All 5 primitives default to `gateLevel='review'` per locked contract (b) — no auto-execution path in V1 (locked contract (e)).
5. **Outcome attribution.** `interventionOutcomes.interventionId` references the `actions.id` of the executed intervention (per `interventionOutcomes.ts:14` comment "references actions or review_items"). `triggerEventId` set to the `actions.id` again (V1 simplification — the action IS the trigger record). `interventionTypeSlug` set to the action's `actionType` (e.g. `crm.send_email`).

### §10.A Phase 4 chunk A — 5 action primitives + merge-field resolver

#### §10.A.1 Files to create

| Path | Purpose |
|------|---------|
| `server/skills/crmFireAutomationService.ts` | Handler for `crm.fire_automation` — calls GHL workflow trigger API. Pure I/O wrapper; the `Pure` test fixture covers payload validation + provider call shape. |
| `server/skills/crmSendEmailService.ts` | Handler for `crm.send_email` — calls GHL conversations send-email endpoint. Resolves merge fields server-side via `mergeFieldResolver` before the provider call. |
| `server/skills/crmSendSmsService.ts` | Handler for `crm.send_sms` — calls GHL conversations send-sms endpoint. Resolves merge fields. |
| `server/skills/crmCreateTaskService.ts` | Handler for `crm.create_task` — creates a CRM-side task on the contact. Distinct from the existing internal `create_task` (board task) — the `crm.` prefix avoids collision per locked contract (a). |
| `server/skills/clientPulseOperatorAlertService.ts` | Handler for `clientpulse.operator_alert` — writes a notification row + (optionally) emits an in-app socket event + email/slack fan-out. Internal action; no external CRM call. |
| `server/services/mergeFieldResolver.ts` | Thin I/O wrapper that fetches the namespace inputs (contact, subaccount, signals, org, agency) from canonical tables + the snapshot, then delegates to the pure resolver. Exposes one HTTP route helper used by §10.D's preview endpoint. |
| `server/services/mergeFieldResolverPure.ts` | Pure resolver: V1 grammar only, strict — `{{namespace.field}}` (single dot, no fallback, no conditionals). On unresolved token: leaves the literal `{{…}}` in place AND adds the path to a returned `unresolved: string[]` array. Throws only on malformed grammar (e.g. unmatched `{{`). |
| `server/services/__tests__/mergeFieldResolverPure.test.ts` | 12+ cases — see §10.A.4 |
| `server/skills/__tests__/crmFireAutomationServicePure.test.ts` | Payload validation, idempotency-key shape, provider error mapping. |
| `server/skills/__tests__/crmSendEmailServicePure.test.ts` | Payload validation, merge-field substitution before provider call, missing-channel mapping. |
| `server/skills/__tests__/crmSendSmsServicePure.test.ts` | Same shape as send_email. |
| `server/skills/__tests__/crmCreateTaskServicePure.test.ts` | Payload validation, due-date parsing, missing assignee. |
| `server/skills/__tests__/clientPulseOperatorAlertServicePure.test.ts` | Payload validation, channel-list filter against org integrations. |
| `migrations/0178_clientpulse_interventions_phase_4.sql` | Two indexes on `actions.metadata_json` for proposer queries — see §10.A.3. No new tables. Down pair drops both indexes. |
| `server/routes/clientpulseMergeFields.ts` | Single `POST /api/clientpulse/merge-fields/preview` route. Accepts `{ subaccountId, template: { subject?, body? } }`, returns `{ subject?, body, unresolved: string[] }`. Wraps `mergeFieldResolver`. (Owns §10.D open question 3.) |

#### §10.A.2 Files to modify

| Path | Change |
|------|--------|
| `server/config/actionRegistry.ts` | Append 5 new entries — `crm.fire_automation`, `crm.send_email`, `crm.send_sms`, `crm.create_task`, `clientpulse.operator_alert`. Each follows the existing `send_email` shape (`actionRegistry.ts:273`): `actionCategory='api'` for the 4 CRM primitives, `'worker'` for `clientpulse.operator_alert`; `defaultGateLevel='review'`; `idempotencyStrategy='keyed_write'`; `topics=['clientpulse','intervention']`. Per locked contract (a), the `crm.` prefix keeps these distinct from the existing unprefixed `send_email` / `create_task`. |
| `server/services/skillExecutor.ts` | Append 5 case statements following the `compute_staff_activity_pulse` pattern at `:1284–1294` (lazy import + `executeWithActionAudit` wrapper). Insert after the existing intervention skills block (around `:1313`). |
| `server/services/orgConfigService.ts` | Add `getInterventionTemplates(orgId): Promise<InterventionTemplate[]>` — reads `operational_config.interventionTemplates[]` JSONB seeded in migration 0170. Pattern matches `getInterventionDefaults` already shipped in Phase 0. |
| `server/routes/index.ts` (or the equivalent registration file) | Register `clientpulseMergeFields.ts`. |

#### §10.A.3 Migration 0178 contents

```sql
-- 0178_clientpulse_interventions_phase_4.sql
-- Indexes on actions.metadata_json to support the proposer + outcome jobs.

-- Proposer query: "has this template been proposed in the cooldown window?"
-- Filters by actions.organisation_id + metadata_json->>'triggerTemplateSlug' + executed_at.
CREATE INDEX IF NOT EXISTS actions_metadata_template_slug_idx
  ON actions ((metadata_json->>'triggerTemplateSlug'))
  WHERE metadata_json ? 'triggerTemplateSlug';

-- Outcome-measurement query: "actions executed in the last 14d with no outcome row".
-- Composite to avoid bitmap scan on a hot table.
CREATE INDEX IF NOT EXISTS actions_intervention_outcome_pending_idx
  ON actions (organisation_id, executed_at)
  WHERE action_type IN ('crm.fire_automation', 'crm.send_email', 'crm.send_sms', 'crm.create_task', 'clientpulse.operator_alert')
    AND status = 'completed';
```

Down pair drops both indexes.

#### §10.A.4 Test plan — `mergeFieldResolverPure.test.ts`

12+ cases. Group by namespace.

- `contact.firstName` resolves
- `contact.unknown` → unresolved array contains `contact.unknown`, literal `{{contact.unknown}}` stays in output
- `subaccount.name` resolves
- `signals.healthScore` resolves
- `org.tradingName` resolves
- `agency.brandColour` resolves
- Empty input → empty output, empty unresolved
- Malformed `{{contact.firstName` (missing `}}`) → throws
- Multiple tokens in one string → all resolved or each unresolved entry emitted
- Same token twice → unresolved deduplicated (set semantics)
- Disallowed namespace `{{secret.apiKey}}` → unresolved array contains it (strict grammar means unknown namespaces are treated identically to unknown fields — they don't crash)
- Nested keys `{{contact.address.line1}}` → resolves if value present (V1 supports single-level by default; if spec §16 requires single dot, the pure throws on multi-dot — confirm with §16 read by implementer; **flagged as open question in §10.A.6**)

#### §10.A.5 Action handler test plan (per primitive)

Each handler test asserts:
1. Schema-validate rejects missing required fields with the right `errorCode`.
2. Idempotency key shape — handler returns the canonical key it would write under (used by `actions.idempotencyKey`).
3. Merge-field substitution applied (for `send_email`, `send_sms`) before provider call — assert provider mock receives resolved body, not raw `{{…}}`.
4. Provider error → mapped to retryable / non-retryable per `retryPolicy.doNotRetryOn`.

#### §10.A.6 Open questions for chunk A

1. **Nested merge-field grammar** — §16 of the spec says "single dot, no conditionals, no fallback". Confirm whether `{{contact.address.line1}}` is valid (multi-dot pathing) or invalid (only one dot allowed). Recommendation: accept multi-dot pathing into nested objects but still no fallback / no conditionals — that matches what the editor mockups imply (`{{contact.firstName}}`, `{{subaccount.primaryContact.email}}`). Confirm with user before implementation.
2. **`clientpulse.operator_alert` channel fan-out** — does the alert handler synchronously fan out to email/slack, or does it write a notification row and let an existing notifications worker do the fan-out? Pickup prompt does not specify. Recommendation: write the notification row + emit the in-app socket event synchronously; defer email/slack fan-out to the existing notifications worker (one place to own delivery retries). Flagged.
3. **Idempotency key composition for `crm.fire_automation`** — should `(automationId, contactId)` be the dedup vector, or `(automationId, contactId, executedDate)`? Same-day re-fires are valid for some workflows; multi-fire-per-day for others. Recommendation: include `(automationId, contactId, scheduleHint)` so two distinct schedule choices land as distinct actions. Flagged.

### §10.B Phase 4 chunk B — proposeClientPulseInterventionsJob + propose/context routes

#### §10.B.1 Trigger model

**Decision: event-driven.** `proposeClientPulseInterventionsJob` runs as a follow-on to `compute_churn_risk` per sub-account. Concretely: at the end of `executeComputeChurnRisk` in `intelligenceSkillExecutor.ts`, after the dual-write to `client_pulse_churn_assessments` + legacy `health_snapshots`, enqueue a pg-boss job `clientpulse:propose-interventions` with `{ organisationId, subaccountId, churnAssessmentId }`. Justification:

- **Latency.** Operators see "intervention proposed" within seconds of the churn band changing — not on the next cron tick.
- **Idempotency.** One churn assessment → one proposer run. The job's idempotency key is the assessment id (`scheduled:propose-interventions:<churnAssessmentId>`).
- **Backpressure.** pg-boss enqueue is cheap; quota enforcement happens inside the job (counted against `interventionDefaults.maxProposalsPerDayPerSubaccount` / `maxProposalsPerDayPerOrg`), so a flood of churn assessments produces at most one proposal per sub-account per quota window.

A daily cron is **not** needed in V1 — the churn risk job runs at least once per sub-account per day per Phase 3, so every sub-account gets evaluated daily.

#### §10.B.2 Files to create

| Path | Purpose |
|------|---------|
| `server/jobs/proposeClientPulseInterventionsJob.ts` | pg-boss worker. Loads churn assessment + latest health snapshot + intervention templates from `operational_config` + cooldown state; calls `proposeClientPulseInterventionsPure`; for each returned proposal, inserts an `actions` row + emits a socket event. |
| `server/services/clientPulseInterventionProposerPure.ts` | Pure matcher: `(templates, observations, snapshot, cooldownState, defaults) → proposal[]`. Handles template eligibility, scoring, quota slicing. |
| `server/services/__tests__/clientPulseInterventionProposerPure.test.ts` | 10+ cases — see §10.B.5 |
| `server/routes/clientpulseInterventions.ts` | Two routes — `POST /api/clientpulse/subaccounts/:id/interventions/propose` (operator-driven equivalent; submits an `actions` row directly) + `GET /api/clientpulse/subaccounts/:id/intervention-context` (returns the payload §10.D consumes). |

#### §10.B.3 Files to modify

| Path | Change |
|------|--------|
| `server/services/intelligenceSkillExecutor.ts` | At end of `executeComputeChurnRisk`, enqueue `clientpulse:propose-interventions` with `{ organisationId, subaccountId, churnAssessmentId }`. Wrap in try/catch — proposer enqueue failure must not roll back the churn assessment. |
| `server/jobs/index.ts` | Register `proposeClientPulseInterventionsJob` worker. |
| `server/config/jobConfig.ts` | Add `'clientpulse:propose-interventions'` queue config: `retryLimit: 2, retryDelay: 30, expireInSeconds: 90, idempotencyStrategy: 'payload-key'`. |
| `server/routes/clientpulseReports.ts` | High-risk widget query selects the most recent proposed intervention for each subaccount → returns `mostRecentInterventionAt: ISO\|null` + `mostRecentInterventionType: string\|null` so the dashboard widget can hint "intervention pending". |

#### §10.B.4 Action-row metadata schema (locked contract (b))

```typescript
type InterventionActionMetadata = {
  triggerTemplateSlug: string;            // operational_config.interventionTemplates[].slug
  triggerReason: string;                  // human-readable; surfaced in review queue + outcome history
  bandAtProposal: 'healthy' | 'watch' | 'at_risk' | 'critical';
  healthScoreAtProposal: number;          // integer 0–100
  configVersion: string;                  // hierarchy_templates.config_version snapshot at proposal
  recommendedBy: 'scenario_detector' | 'operator_manual';
  // Set when scenario_detector path
  churnAssessmentId?: string;
  // Set when operator_manual path (from §10.D submit)
  operatorRationale?: string;
};
```

The proposer job sets `recommendedBy='scenario_detector'` + `churnAssessmentId`. The `POST …/propose` route (operator-driven) sets `recommendedBy='operator_manual'` + `operatorRationale`.

#### §10.B.5 Pure proposer test plan

10+ cases:

1. **Happy path** — at-risk band + matching template + no cooldown → 1 proposal.
2. **No matching template** — at-risk band + zero templates that target this band → 0 proposals.
3. **Cooldown blocks (executed scope)** — recent executed intervention of same slug → 0 proposals; reason includes `cooldown:executed`.
4. **Cooldown blocks (proposed scope)** — recent proposed intervention of same slug → 0 proposals; reason `cooldown:proposed`.
5. **Per-subaccount quota** — `maxProposalsPerDayPerSubaccount: 1` and one already proposed today → 0 proposals.
6. **Per-org quota** — `maxProposalsPerDayPerOrg: 20` and 20 already proposed across all subs → 0 proposals.
7. **Multi-template selection** — at-risk band matches 3 templates; quota = 1; proposer picks the highest-priority template; lower-priority templates emit a `suppressed` reason with rank.
8. **Healthy band** — 0 proposals (no template targets healthy).
9. **Critical band** — chooses the critical-band template if present, else falls back to at-risk template.
10. **Template targeting wrong band** — template `targets: ['watch']` but band is `at_risk` → 0 proposals.
11. **Account override `suppressAlerts: true`** — 0 proposals; reason `account_override:suppress_alerts`.

#### §10.B.6 Quota enforcement order

Inside the pure matcher, in order:
1. Account override check (suppressAlerts blocks all)
2. Template band-targeting filter
3. Template-level cooldown (delegates to `interventionService.checkCooldown` — but for pure tests we inject the cooldown state, so the pure fn takes `cooldownState: Record<templateSlug, { allowed, reason }>`)
4. Template priority sort (higher first)
5. Per-subaccount quota slice
6. Per-org quota slice (proposer job pre-counts org-day total before calling pure fn; pure fn enforces remaining capacity)

Anything filtered out emits a `suppressed: { templateSlug, reason }` entry alongside the `proposals` for observability.

#### §10.B.7 Open questions for chunk B

1. **Existing endpoint reuse?** Does an `/api/clientpulse/...` route layer already exist or does §10.B own creating the directory? The spec says yes (`server/routes/clientpulseReports.ts` is referenced in pickup prompt §10). Confirm before adding `clientpulseInterventions.ts`.
2. **Live-fetch surfaces in `/intervention-context`** — automation list, CRM users, contacts. Does the response include these inline, or are they separate endpoint calls from the editor (one per editor that needs them)? Recommendation: separate endpoints (one per editor needs them only when the editor mounts, avoiding wasted CRM calls on every context load). Flagged.
3. **Socket event for new proposal** — does the existing review-queue socket channel already emit on `actions` insert with `gateLevel='review'`, or does the proposer need to emit explicitly? Confirm before adding emit.

### §10.C Phase 4 chunk C — measureInterventionOutcomeJob (closes B2)

#### §10.C.1 Files to create

| Path | Purpose |
|------|---------|
| `server/jobs/measureInterventionOutcomeJob.ts` | pg-boss worker. Hourly cron. Selects executed intervention actions older than `template.measurementWindowHours` (default 24) and younger than 14d with no `intervention_outcomes` row; loads latest health snapshot for the account; calls `interventionService.recordOutcome()`. |
| `server/services/__tests__/measureInterventionOutcomeJob.test.ts` | End-to-end fixture test for the Phase 4 ship gate — see §10.C.4 |

#### §10.C.2 Files to modify

| Path | Change |
|------|--------|
| `server/jobs/index.ts` | Register `measureInterventionOutcomeJob` worker + schedule entry (`@every 1 hour`). |
| `server/config/jobConfig.ts` | Add `'clientpulse:measure-outcomes'` queue config: `retryLimit: 1, retryDelay: 60, expireInSeconds: 600, idempotencyStrategy: 'one-shot'`. |
| `server/services/interventionService.ts` | Extend `recordOutcome()` to accept `bandBefore` + `bandAfter` so the outcome row carries the band-change attribution required by B2. The existing implementation derives `outcome` from `delta` only; add the band fields without breaking existing callers. |

#### §10.C.3 Job query

```sql
SELECT a.id, a.organisation_id, a.subaccount_id, a.action_type, a.executed_at,
       a.metadata_json->>'triggerTemplateSlug' AS template_slug,
       (a.metadata_json->>'healthScoreAtProposal')::int AS health_score_at_proposal,
       a.metadata_json->>'bandAtProposal' AS band_at_proposal,
       a.metadata_json->>'configVersion' AS config_version
FROM actions a
WHERE a.action_type IN (
  'crm.fire_automation','crm.send_email','crm.send_sms','crm.create_task','clientpulse.operator_alert'
)
  AND a.status = 'completed'
  AND a.executed_at > now() - interval '14 days'
  AND a.executed_at < now() - interval '1 hour'  -- min observation window
  AND NOT EXISTS (
    SELECT 1 FROM intervention_outcomes o WHERE o.intervention_id = a.id
  )
ORDER BY a.executed_at ASC
LIMIT 200;
```

For each row: load latest `client_pulse_health_snapshots` for `(organisation_id, subaccount_id)` after `executed_at + template.measurementWindowHours`. Compute delta + band-after. Call `interventionService.recordOutcome` with the new band fields. Honour `template.measurementWindowHours` from `operational_config.interventionTemplates[].measurementWindowHours` (default 24h if omitted).

#### §10.C.4 End-to-end fixture test (B2 ship gate)

`server/services/__tests__/measureInterventionOutcomeJob.test.ts`:

1. Seed an organisation + sub-account with a starting health snapshot at score 38 (band=`at_risk`).
2. Insert an `actions` row with `actionType='crm.send_email'`, `status='completed'`, `executed_at = now() - 25 hours`, `metadataJson={ triggerTemplateSlug:'check_in', triggerReason:'health drop 7d', bandAtProposal:'at_risk', healthScoreAtProposal:38, configVersion:'cv-1', recommendedBy:'scenario_detector' }`.
3. Insert a follow-up health snapshot at score 56 (band=`watch`) timestamped `executed_at + 23 hours`.
4. Run the job handler.
5. Assert one `intervention_outcomes` row exists with `interventionId=<actions.id>`, `healthScoreBefore=38`, `healthScoreAfter=56`, `outcome='improved'`, `bandBefore='at_risk'`, `bandAfter='watch'`, `deltaHealthScore=18`.
6. Run the job a second time. Assert no new row inserted (idempotency check).

#### §10.C.5 Open questions for chunk C

1. **Band derivation source** — does the job derive `bandAfter` from `churnBands` config in `operational_config`, or does it pull from the latest `client_pulse_churn_assessments` row (which already stores the band)? Recommendation: pull from `client_pulse_churn_assessments` if a row exists post-intervention; otherwise derive locally. Flagged.
2. **Multiple snapshots per day** — which snapshot wins? Recommendation: the latest snapshot at-or-after `executed_at + template.measurementWindowHours`. Flagged.
3. **Action with status='failed'** — should failures get an outcome row with `outcome='unchanged'` so cooldown logic still respects them? Recommendation: yes — record an outcome row marked `executionFailed: true` so `interventionService.checkCooldown` (which checks for any recent row) prevents re-fire. Flagged.

---

## §10.D Phase 4 — UI (intervention editor modals + proposer review flow)

Scope: chunk D from the 7-chunk sequence in `tasks/builds/clientpulse/phase-4-and-4.5-pickup-prompt.md` §11. Five primitive editors + one wrapper that hosts step 1 (pick-an-action) and routes to the picked editor for step 2 (configure + submit). All modals submit to the proposer endpoint defined by §10.B; submission produces an `actions` row with `gateLevel='review'` (locked contract (b)) — these modals never trigger an execution path directly.

**Convention sample:** `client/src/components/Modal.tsx` (portal-based dialog with focus trap, Esc handler, animated backdrop, configurable `maxWidth`). Every editor wraps `Modal` rather than re-implementing portals or focus management. Mockups use plain HTML / inline styles — translate to Tailwind matching `MajorApprovalModal.tsx` / `ClientPulseDashboardPage.tsx` style: slate / indigo palette, `rounded-xl`, `text-[NN]px` for non-default sizes.

### §10.D.1 Files to create

| Path | Purpose |
|------|---------|
| `client/src/components/clientpulse/ProposeInterventionModal.tsx` | Wrapper modal (~1080px, two-column). Left pane: client context (band, top signals, intervention history, cooldown state) — fed from a single `GET /api/clientpulse/subaccounts/:id/intervention-context` call. Right pane: step-1 action-type picker (5 primitives). On pick, holds the choice; on "Configure →" swaps the right pane for the chosen editor (single overlay, no nested portals). Mockup: `tasks/clientpulse-mockup-propose-intervention.html`. |
| `client/src/components/clientpulse/FireAutomationEditor.tsx` | Editor for `crm.fire_automation`. Live-fetches active automations from the client's CRM via the proposer endpoint. Two-column: left automation picker (search + category filter pills + radio-row list); right: contact picker, schedule, rationale, step-by-step preview of the chosen automation. Mockup: `tasks/clientpulse-mockup-fire-automation.html`. |
| `client/src/components/clientpulse/EmailAuthoringEditor.tsx` | Editor for `crm.send_email`. Template picker strip → compose form (from address, to address, subject, body) → live preview using the merge-field resolver. Mockup: `tasks/clientpulse-mockup-email-authoring.html`. |
| `client/src/components/clientpulse/SendSmsEditor.tsx` | Editor for `crm.send_sms`. From-number + to-contact selects, message textarea with 160-char segment counter, schedule + rationale, phone-style preview with merge-field substitutions. Mockup: `tasks/clientpulse-mockup-send-sms.html`. |
| `client/src/components/clientpulse/CreateTaskEditor.tsx` | Editor for `crm.create_task`. Title, assignee select (from CRM users), related-contact select, due date/time, three-way priority toggle, notes / call-script textarea, CRM-task-card preview. Mockup: `tasks/clientpulse-mockup-create-task.html`. |
| `client/src/components/clientpulse/OperatorAlertEditor.tsx` | Editor for `clientpulse.operator_alert`. Title, message, three-way severity toggle, recipients select, channel checkboxes (in-app, email, slack), in-app notification-tray preview. Mockup: `tasks/clientpulse-mockup-operator-alert.html`. |

**No shared sub-component extracted.** Per CLAUDE.md "three similar lines is better than a premature abstraction": the merge-field palette (chip row), the rationale field, the live-preview block, and the schedule-toggle each appear in 2–3 editors. Implement inline; revisit only if a 4th editor wants the same shape. Wrapper does not own form state — each editor owns its own state and submits independently.

### §10.D.2 Files to modify

| Path | Change |
|------|--------|
| `client/src/pages/ClientPulseDashboardPage.tsx` | High-risk widget rows (lines 169–183) become clickable → opens `ProposeInterventionModal` for that subaccount. Hold `proposingForSubaccountId: string \| null` in page state; render `<ProposeInterventionModal>` conditionally. After successful submit: toast + close + soft-refresh `high-risk` query (no full page reload — already paid for). The pickup prompt also lists `server/routes/clientpulseReports.ts` as a wire point; that one is a server-side change owned by §10.B (proposer output → high-risk widget data shape). The client only needs the new click handler + modal mount. |
| Drilldown page (does not yet exist) | **Out of scope for §10.D.** When the Phase 5+ drilldown page lands, it will mount the same `ProposeInterventionModal` from a primary action button. Document this in the new component file's JSDoc so the next-phase author finds it. |

No global context / store changes. Each modal is stateful per render; cross-modal state (the picked action type) lives in the wrapper's local React state.

### §10.D.3 Component contracts

**`ProposeInterventionModal`**
- Props: `{ subaccountId: string; subaccountName: string; onClose: () => void; onSubmitted: (action: { id: string; actionType: string }) => void }`.
- On mount: `GET /api/clientpulse/subaccounts/:subaccountId/intervention-context` → `{ band, healthScore, healthScoreDelta7d, topSignals: { key, label, value, severity }[], recentInterventions: { occurredAt, templateLabel, outcome }[], cooldownState: { blocked: boolean, reason?: string }, primaryContact: { id, name, channel }, recommendedActionType?: ActionType }` (this endpoint is owned by §10.B — see §10.D.6 open question 2).
- Internal state: `pickedActionType: ActionType | null` where `ActionType ∈ 'fire_automation' | 'send_email' | 'send_sms' | 'create_task' | 'operator_alert'`.
- On "Configure →": render the matching editor in the right pane; left pane (context) stays mounted. On editor submit: bubble `onSubmitted` upward + `onClose()`.

**Per-editor common contract**
- Props: `{ subaccountId: string; subaccountName: string; context: InterventionContext; onCancel: () => void; onSubmitted: (action: { id: string; actionType: string }) => void }`.
- Submit verb: `POST /api/clientpulse/subaccounts/:subaccountId/interventions/propose` with body `{ actionType, payload, scheduleHint, rationale, templateSlug? }`.
  - `actionType`: one of the 5 namespaced slugs (`crm.fire_automation` etc.).
  - `payload`: editor-specific. Examples below.
  - `scheduleHint`: `'immediate' | 'delay_24h' | 'scheduled'` (+ `scheduledFor?: ISO string`).
  - `rationale`: free-text (logged on the action row's `metadataJson.triggerReason`, surfaced later in outcome history).
  - `templateSlug`: present when the editor was seeded from an `interventionTemplate` (so the proposer/outcome job can attribute and apply per-template cooldown).
- On 4xx with `errorCode='COOLDOWN_BLOCKED'` / `'QUOTA_EXCEEDED'` / `'SENSITIVE_PATH_BLOCKED'`: surface message inline above the submit row (red banner). Do **not** crash. On 2xx: call `onSubmitted` with the returned action shape.

**Per-editor `payload` shapes**
- `FireAutomationEditor`: `{ automationId: string, contactId: string }` (the proposer enriches with snapshot fields server-side; the editor only sends the IDs).
- `EmailAuthoringEditor`: `{ from: string, toContactId: string, subject: string, body: string }`. Body and subject contain raw `{{merge.field}}` tokens — server resolves at execution time.
- `SendSmsEditor`: `{ fromNumber: string, toContactId: string, body: string }`.
- `CreateTaskEditor`: `{ assigneeUserId: string, relatedContactId: string | null, title: string, notes: string, dueAt: ISO string, priority: 'low' | 'med' | 'high' }`.
- `OperatorAlertEditor`: `{ title: string, message: string, severity: 'info' | 'warn' | 'urgent', recipients: { kind: 'preset' | 'custom', value: string | string[] }, channels: ('in_app' | 'email' | 'slack')[] }`.

**Merge-field preview behaviour**
- Editors that author copy (`EmailAuthoringEditor`, `SendSmsEditor`) call `POST /api/clientpulse/merge-fields/preview` with `{ subaccountId, template: { subject?, body } }` → `{ subject?, body, unresolved: string[] }`. Debounced 350ms after the last keystroke. Server uses the V1 grammar resolver (locked contract (g)) — strict; unresolved tokens come back in the `unresolved` array and render with a yellow underline (`bg-amber-100`) in the preview.
- `FireAutomationEditor` and `CreateTaskEditor` do not need the merge preview — their previews echo raw form fields.
- `OperatorAlertEditor` uses raw form fields too — operator alerts target operators, not contacts, so canonical merge tokens don't apply.

### §10.D.4 Error handling

| Surface | Source | UX |
|---------|--------|----|
| Context fetch fails | `GET …/intervention-context` 5xx or network | Wrapper renders an error state in the left pane (red icon + "Unable to load context — try again"); right pane stays disabled. Retry button refetches. |
| No active automations (Fire automation) | proposer returns `automations: []` | Picker shows empty-state ("No active automations in Smith Dental's CRM. Create one in GHL first."); submit disabled. |
| No CRM users (Create task) | proposer returns `users: []` | Assignee select shows empty-state; submit disabled. |
| Cooldown blocked | proposer-context returns `cooldownState.blocked: true` | Wrapper shows the red cooldown card in the left pane. Submit on any editor still attempts — server is the SoT, can override at proposal time, but UI warns up-front. |
| Quota exceeded | submit responds 429 `errorCode='QUOTA_EXCEEDED'` | Inline red banner above submit row; rationale + draft preserved. |
| Sensitive-path block | submit responds 422 `errorCode='SENSITIVE_PATH_BLOCKED'` | Same banner pattern; surface the gate message returned by the server. |
| Validation errors (empty body, missing recipient, etc.) | client-side check before POST | Field-level red text + disable submit until fixed. |
| Slack channel selected when not configured | static check against `org.integrations.slack.connected` (already in user/session) | Render a hint under the channel row: "Slack integration available in Operate tier · currently not configured". Checkbox disabled. |

### §10.D.5 Manual verification checklist

Per CLAUDE.md UI rule — start `npm run dev`, open `http://localhost:5173/clientpulse`, sign in as an org user with at least one GHL-connected sub-account that the Phase 4 chunks A–C populated with health snapshots. Steps:

**Wrapper / context flow**
1. Click any high-risk client in the dashboard widget → wrapper opens, left pane populates with band + signals + history + cooldown card. Verify each field renders non-empty for a real subaccount.
2. Click the close (×) button → modal closes; widget unchanged. Press Esc inside a focused field → modal closes.
3. Open wrapper, refresh the page mid-flow → modal closes (confirm no zombie state). Re-open → fresh fetch.
4. Open wrapper for a sub-account whose context endpoint 500s (toggle by killing the server) → left pane shows error state, retry button works after server is restored.

**FireAutomationEditor**
- Golden: pick "Fire automation", click Configure, search the picker for "nurture", click a row, pick Dr. Marcia from contact, set schedule = "Immediately on approval", click Submit → 2xx, toast, modal closes, action visible in `/review` queue with `actionType='crm.fire_automation'` + `gateLevel='review'`.
- Edge 1: open editor on a sub-account whose CRM has zero active automations → empty state renders, submit disabled.
- Edge 2: select a row, then click Refresh → list re-fetches, selection cleared (verify no submit on stale ID).

**EmailAuthoringEditor**
- Golden: pick "Send email", select the "Check-in" template, type a custom subject containing `{{contact.firstName}}` → preview renders "Hi Marcia," after debounce. Submit → 2xx, action queued.
- Edge 1: type an unknown token `{{contact.bogusField}}` → preview underlines it amber + "1 unresolved field" hint. Submit still allowed (server may resolve at execution time).
- Edge 2: paste a 5KB body → no perf jank; preview debounces, no per-keystroke server hit.

**SendSmsEditor**
- Golden: type a 130-char message with two merge tokens → segment counter shows `~135 / 160 · 1 segment` after merge resolution. Submit → 2xx.
- Edge 1: paste a 165-char message → counter turns red, shows `2 segments`, submit still allowed (carriers will charge 2 segments, not blocking).
- Edge 2: pick a contact whose `phone` is null → submit returns 422 with `errorCode='MISSING_CHANNEL'`; banner renders.

**CreateTaskEditor**
- Golden: title, assignee, due date "Friday", priority High, 3-line notes → submit → 2xx, task preview matches what landed.
- Edge 1: leave title empty → field-level error, submit disabled.
- Edge 2: pick a due date in the past → field-level warning ("Due date is in the past — assign anyway?"); not blocking.

**OperatorAlertEditor**
- Golden: severity Urgent, recipient "Kel · agency owner", channels in-app + email → submit → 2xx; the alert shows up immediately in the in-app notification tray (verify via the bell icon / `/api/notifications/unread`).
- Edge 1: try to check Slack when not configured → checkbox disabled, hint visible.
- Edge 2: submit with empty message → field-level error.

**Real-time / cleanup**
- After any successful submit, the `dashboard:update` socket event should not fire for the proposer (it fires for execution, not proposal). Verify with `WebSocket.onmessage` logging that no event fires within 5s of submit. Manual-only — no test required.

### §10.D.6 Open questions (need answers before §10.D implementation begins)

1. **Where does the proposer review flow live?** Mockups show the flow opening from a per-client drilldown that doesn't yet exist. The pickup prompt's §10 lists `clientpulseReports.ts` (high-risk widget) as the only client-facing wire point for Phase 4. **Recommendation:** mount `ProposeInterventionModal` from the dashboard high-risk widget (clickable rows) for §10.D, and document that the same wrapper will be re-mounted from the drilldown when Phase 5+ ships it. Confirm with user before implementing.
2. **Does the "propose intervention" endpoint (`POST /api/clientpulse/subaccounts/:id/interventions/propose`) and the context endpoint (`GET …/intervention-context`) exist after §10.B, or does §10.D need to wait for them?** The pickup prompt §10 names `clientpulseReports.ts` as modified in Phase 4 but does not enumerate routes. **Recommendation:** §10.B explicitly exposes both endpoints — the proposer job writes proposed `actions`, and these two routes are the synchronous operator-driven equivalent. If §10.B does not own them, surface this gap before chunk D begins so the route work is added to chunk B (not bolted onto chunk D, which would inflate scope past "UI only").
3. **Merge-field preview endpoint shape.** The resolver service is created in §10.A (`server/services/mergeFieldResolver.ts`). Does §10.A also expose an HTTP wrapper at `POST /api/clientpulse/merge-fields/preview`, or is that on §10.D? **Recommendation:** §10.A owns the route — preview is a thin wrapper over the pure resolver, lives next to the service, and avoids §10.D needing a server-side change.
4. **Recommended action-type signal.** Mockup highlights "Fire automation" as RECOMMENDED. Source of that recommendation: scenario detector output (§10.B) attached to the context payload, or a static heuristic in the wrapper? **Recommendation:** server-derived (`recommendedActionType` field on the context response) so the same signal can drive future API consumers (drilldown, chat surface, mobile).

### §10.D.7 Dependencies

- Hard dependency on §10.A: 5 namespaced action slugs registered in `actionRegistry.ts`. The submit endpoint validates `actionType ∈ {…}`.
- Hard dependency on §10.B: `POST …/interventions/propose` + `GET …/intervention-context` routes (subject to open question 2).
- Hard dependency on §10.A: merge-field preview endpoint (subject to open question 3).
- Soft dependency on §10.C: outcome-measurement loop is invisible to §10.D — submitted actions show up in the review queue, get approved + executed by existing pipelines, and §10.C's job picks them up later. No client wiring needed.

### §10.D.8 Commit granularity

One commit per the 7-chunk sequence in the pickup prompt §11 (chunk D = single commit). Recommended sub-structure within the single commit:

1. `ProposeInterventionModal.tsx` wrapper + dashboard widget wiring + context fetch.
2. Five editor files added in alphabetical order.
3. Manual verification log appended to `tasks/builds/clientpulse/progress.md` chunk D entry.

---

## §11. Phase 4.5 — Configuration Agent extension

Closes ship-gates B3 + B5. Locked contracts (c)(d)(f) from `phase-4-and-4.5-pickup-prompt.md` §5 govern this section.

### §11.0 Cross-cutting decisions for Phase 4.5

1. **Reuse `config_history` table** (per locked contract (c)). No new audit table. `entity_type='clientpulse_operational_config'`, `change_source='config_agent'`, `version` monotonically increases per `(organisation_id, entity_type, entity_id)`. Existing UNIQUE index `config_history_org_entity_version_uniq` enforces no version collisions.
2. **`entity_id` choice.** **Decision: `entity_id = hierarchy_template.id`** (the template being modified). Rationale: org-id is too coarse — a single org can host multiple template versions over time, and the audit trail must distinguish them. Template-id matches the existing `hierarchyTemplates` write target. (Surfaced as open question if there's an existing convention to honour — see §11.A.6.)
3. **Sensitive-path routing model** (per locked contract (f)). Every config write goes through `configUpdateHierarchyTemplateService`. Two paths:
   - **Non-sensitive path** (target path NOT in `SENSITIVE_CONFIG_PATHS`): direct merge into `hierarchy_templates.operational_config` JSONB + `config_history` row written in the same transaction. Returns `{ committed: true, configHistoryId }`.
   - **Sensitive path** (target path IS in `SENSITIVE_CONFIG_PATHS`): inserts an `actions` row with `actionType='config_update_hierarchy_template'`, `gateLevel='review'`, `status='pending_approval'`, `payloadJson={ templateId, path, value, schemaValidatedAt }`, `metadataJson={ sensitivePath: true, sourceSession, validationDigest }`. The action handler (executed on approval, NOT on insert) does the merge + writes config_history. Returns `{ committed: false, actionId, requiresApproval: true }`.
4. **Validation order.** Inside the service: (1) schema-validate the proposed full config via `validateOperationalConfig` (computes the merged result first, then validates whole-config — so sum-constraints catch cross-field violations); (2) classify path via `isSensitiveConfigPath`; (3) route to one of the two paths above. Sum-constraint validation happens at *proposal* time, not at *approval* time (per pickup prompt §14). The action's `payloadJson.schemaValidatedAt` records the validation timestamp; on approval, the handler re-validates against the live config (in case it drifted) before merging.

### §11.A Phase 4.5 chunk A — config_update_hierarchy_template skill + sensitive-path routing (closes B3 + B5)

#### §11.A.1 Files to create

| Path | Purpose |
|------|---------|
| `server/skills/config_update_hierarchy_template.md` | Skill definition (markdown front-matter for the skill registry + body documenting the contract). Same shape as existing `server/skills/*.md` files. |
| `server/services/configUpdateHierarchyTemplateService.ts` | Orchestration: load current config → compute proposed full config → validate → classify sensitive → route (direct write OR enqueue review). Owns the transaction boundary for the non-sensitive path. |
| `server/services/configUpdateHierarchyTemplatePure.ts` | Pure: (a) deep-merge a path/value into a config JSONB; (b) classify sensitive (delegates to `isSensitiveConfigPath`); (c) build the action payload + metadata for the review path; (d) build the config_history snapshot row. No I/O. |
| `server/services/__tests__/configUpdateHierarchyTemplatePure.test.ts` | 12+ cases — see §11.A.4 |
| `server/services/__tests__/configUpdateHierarchyTemplateService.test.ts` | Integration: writes config_history on direct path; writes actions row + does NOT mutate operational_config on sensitive path; sum-constraint reject; schema-invalid reject; approval-handler executes the merge + writes config_history. |

#### §11.A.2 Files to modify

| Path | Change |
|------|--------|
| `server/config/actionRegistry.ts` | Register `config_update_hierarchy_template` — `actionCategory='worker'`, `defaultGateLevel='review'` (always — the auto path is short-circuited by the service before an action row is created), `idempotencyStrategy='keyed_write'`, `parameterSchema=z.object({ templateId, path, value, reason, sourceSession })`, `topics=['clientpulse','config','agent']`. |
| `server/services/skillExecutor.ts` | Add case: lazy-import `executeConfigUpdateHierarchyTemplate` (which is the *approval-execution* handler — runs only when an approved action lands here). Pattern matches `compute_staff_activity_pulse` at `:1284–1294`. |
| `server/services/orgConfigService.ts` | Add `applyOperationalConfigPatch(orgId, templateId, path, value, opts)` write helper. Used by both the service's direct-write path and the action handler's approval-execute path. |
| `server/db/schema/index.ts` | (Verify `configHistory` is already exported. If not, add the export.) |

#### §11.A.3 Skill front-matter (`config_update_hierarchy_template.md`)

```yaml
---
slug: config_update_hierarchy_template
title: Update hierarchy template operational_config
intent: |
  Apply a single path/value patch to a hierarchy template's operational_config
  JSONB. Validates the proposed full config against the operational_config
  schema (including sum-constraints on healthScoreFactors weights). Sensitive
  paths route through the action→review queue per B5.
inputs:
  templateId: uuid
  path: string                 # dot-path into operational_config
  value: any                   # JSON-serialisable
  reason: string               # operator-supplied rationale (logged)
  sourceSession: uuid?         # config-agent chat session id (optional)
returns:
  committed: boolean
  configHistoryId: uuid?       # set when committed=true
  actionId: uuid?              # set when committed=false (sensitive path)
  requiresApproval: boolean
errors:
  - SCHEMA_INVALID
  - SUM_CONSTRAINT_VIOLATED
  - UNKNOWN_PATH
  - TEMPLATE_NOT_FOUND
---
```

#### §11.A.4 Pure test plan

12 cases:

1. **Non-sensitive path direct merge** — `path='alertLimits.notificationThreshold'`, `value=5` → returns `{ committed: true }` shape; merged config has the new value.
2. **Sensitive path enqueues review** — `path='healthScoreFactors'`, `value=[…]` → returns `{ committed: false, requiresApproval: true }` shape; merged config NOT mutated.
3. **Sum-constraint reject** — `path='healthScoreFactors'`, `value=[{weight:0.6}, {weight:0.5}]` (sum=1.1) → returns error `SUM_CONSTRAINT_VIOLATED`.
4. **Schema-invalid reject** — `path='churnBands.healthy'`, `value='not-a-tuple'` → returns error `SCHEMA_INVALID`.
5. **Unknown path** — `path='this.does.not.exist'`, `value=anything` — depends on schema permissiveness. Recommendation: `passthrough()` allows unknown root keys, so this is *not* an error in V1; flag in metadata. Captured in test as expected behaviour.
6. **Deep-merge correctness** — `path='staffActivity.churnFlagThresholds.zeroActivityDays'`, `value=14` → only that leaf changes; siblings (`weekOverWeekDropPct`) preserved.
7. **Array replacement** — `path='healthScoreFactors'`, `value=[…]` (sensitive — review path) → action payload contains the full new array, not a merge.
8. **Sensitive prefix match** — `path='interventionDefaults.cooldownHours.nested'` → classified sensitive (prefix match per `isSensitiveConfigPath`).
9. **Sensitive top-level array** — `path='interventionTemplates'` (replaces whole array) → sensitive route.
10. **Idempotency key shape** — pure builder produces a stable key from `(templateId, path-hash, value-hash)` → same input twice → same key.
11. **Snapshot row builder** — given current config + path + value → produces config_history snapshot with `version=current+1`, full proposed-config in `snapshot` field.
12. **Validation digest** — same input twice → same digest (used to detect drift between proposal and approval).

#### §11.A.5 Action handler (approval-execute path)

`executeConfigUpdateHierarchyTemplate(input, context)`:

1. Load the action row by `context.actionId`.
2. Re-load `hierarchy_templates.operational_config` for `payload.templateId`.
3. Re-validate the proposed full config via `validateOperationalConfig` (drift check).
4. If invalid: action transitions to `failed` with `errorJson={ errorCode:'DRIFT_DETECTED', currentDigest, originalDigest }`. Operator must re-propose.
5. If valid: open transaction → merge into `operational_config` → insert `config_history` row → commit. Return `{ configHistoryId }`.

#### §11.A.6 Open questions for chunk A

1. **`entity_id` convention** — does an existing audit pattern in this codebase use `entity_id = template_id` or `entity_id = organisation_id` for org-scoped entity audits? If a convention exists, follow it. Recommendation: template_id (as decided in §11.0.2). Confirm before implementation.
2. **Drift handling on approval** — if validation fails on approval, should the action auto-rollback to a fresh proposal (re-enqueue), or fail terminally and require operator re-propose? Recommendation: fail terminally — operators see the failure in the review queue and can re-issue the chat command. Avoids implicit retries on potentially-stale config.
3. **Multiple paths per call** — does the chat surface ever submit multi-path patches (e.g. "bump weights AND lower cooldown"), or strictly one path per call? Recommendation: one path per call in V1; the chat agent can chain multiple skill calls if needed. Affects parameter schema. Flagged.

### §11.B Phase 4.5 chunk B — Configuration Agent chat popup + routing doc updates

#### §11.B.1 Files to create

| Path | Purpose |
|------|---------|
| `client/src/components/clientpulse/ConfigAssistantChatPopup.tsx` | Global popup: header (× close, current scope label), chat transcript, composer textarea, footer with model/scope hints. On agent reply containing a config-update proposal: render a "confirm-before-write" card with before/after diff, two buttons (Confirm / Discuss further). Confirm calls the `config_update_hierarchy_template` skill via the standard agent-action submit pipeline. Mockup: `tasks/clientpulse-mockup-config-assistant-chat.html`. |
| `client/src/hooks/useConfigAssistantChatPopup.ts` | Trigger hook: opens the popup; reads from query param `?config-assistant=open` so deep-links work. Mounts the popup at the App-shell level so it survives route changes. |

#### §11.B.2 Files to modify

| Path | Change |
|------|--------|
| `client/src/App.tsx` (or App shell equivalent) | Mount `<ConfigAssistantChatPopup />` once at the App level, gated by the `useConfigAssistantChatPopup` open state. |
| `client/src/components/Nav*.tsx` (global nav) | Add a "Config Assistant" entry in the global nav that calls `openConfigAssistant()` from the hook. |
| `client/src/keybindings.ts` (or equivalent ⌘K registration) | Register `cmd+k → openConfigAssistant`. If a command palette already exists, register the entry in its config. |
| `client/src/pages/ClientPulseDashboardPage.tsx` (and settings pages where applicable) | Add inline callouts ("Need to adjust the weights? Open the Config Assistant →") that call `openConfigAssistant()`. |
| `docs/capabilities.md` | Add 4 capability slugs in the appropriate section: `clientpulse.config.read`, `clientpulse.config.update`, `clientpulse.config.reset`, `clientpulse.config.history`. **Re-read CLAUDE.md §0 editorial rules before editing** — no vendor names in customer-facing sections. Generic category language only. |
| `docs/integration-reference.md` | Add `clientpulse_configuration` pseudo-integration block in the structured YAML format used by other entries. Include capability slugs from above + the `config_update_hierarchy_template` skill reference. |
| `docs/configuration-assistant-spec.md` | Add mutation tool #16 — `update_clientpulse_config`. Move ClientPulse from out-of-scope to in-scope v2. (If file does not exist, this is an open question — see §11.B.5.) |
| `docs/orchestrator-capability-routing-spec.md` | Add ClientPulse config routing hints: queries like "weights", "cooldown", "intervention defaults", "churn band thresholds" should route to the Configuration Agent with the ClientPulse scope set. |
| `architecture.md` | One paragraph in the Phase 4.5 / Configuration Agent section confirming the sensitive-path routing pattern for ClientPulse config writes. |

#### §11.B.3 Component contracts

**`ConfigAssistantChatPopup`**

Props:
```typescript
{ open: boolean; onClose: () => void; initialPrompt?: string; scope?: 'clientpulse' | 'all'; }
```

Internal behaviour:
- Opens a fresh agent session (or resumes a stored session id from sessionStorage).
- Renders messages as `{ role: 'user' | 'agent', content, attachments?: { kind: 'config_diff', before, after, path }[] }`.
- On agent message with a `config_diff` attachment: render the confirm card. Operator clicks Confirm → POST to `/api/clientpulse/config/apply` with `{ sessionId, templateId, path, value, reason }` → service routes to direct-write or review-queue based on sensitivity.
- After Confirm: agent response shows "Applied" (non-sensitive) or "Sent to review queue — Action #1234" (sensitive). Settings page banner "Config updated · refresh to see new values" displays for the next 60s.

**Trigger surfaces:**
- Global nav button (always visible to org-admins)
- ⌘K palette entry "Open Configuration Assistant"
- Inline callouts on settings + dashboard pages
- Deep-link `?config-assistant=open&prompt=...`

#### §11.B.4 Manual verification checklist

Per CLAUDE.md UI rule — start `npm run dev`, sign in as org-admin.

**Non-sensitive path golden test:**
1. Click global nav "Config Assistant" → popup opens, transcript empty, composer focused.
2. Type "lower the alert limit notification threshold from 10 to 5" → Send.
3. Agent responds with a confirm card: `before: { notificationThreshold: 10 }, after: { notificationThreshold: 5 }`.
4. Click Confirm → toast "Applied", agent message confirms.
5. Refresh `/settings/clientpulse` → field shows 5.
6. Inspect `config_history` table → one new row with `entity_type='clientpulse_operational_config'`, `change_source='config_agent'`, `version` = previous + 1, `snapshot` contains the new full config. **B3 GATE PASSED.**

**Sensitive path golden test:**
1. Click global nav "Config Assistant" → popup opens.
2. Type "bump pipeline velocity weight to 0.35" → Send.
3. Agent responds with confirm card showing the proposed weights array (with `pipeline_velocity: 0.35` plus rebalanced others summing to 1.0).
4. Click Confirm → toast "Sent to review queue · Action #1234", agent message confirms.
5. **`operational_config` NOT mutated yet.** Verify by querying the template.
6. Navigate to `/review` queue → action visible with `gateLevel='review'`, `actionType='config_update_hierarchy_template'`.
7. Approve the action.
8. Verify `operational_config` now contains the new weights. Verify `config_history` has the row. **B5 GATE PASSED.**

**Sum-constraint reject test:**
1. Type "set healthScoreFactor pipeline_velocity to 0.6 and engagement to 0.5" (sums to 1.1+).
2. Agent responds with rejection: "Weights would sum to 1.10, must equal 1.00. Proposing rebalance instead — confirm?"
3. Operator can confirm rebalance OR discard.

**Discard / cancel test:**
1. Open popup, send any prompt, get confirm card.
2. Click "Discuss further" instead of Confirm → card minimises, transcript continues without write.

#### §11.B.5 Open questions for chunk B

1. **`docs/configuration-assistant-spec.md` existence** — does this file already exist with a numbered mutation-tool list, or is this the first ClientPulse-related entry? Architect needs to verify. If file does not exist, surface to user before §11.B implementation.
2. **`/api/clientpulse/config/apply` endpoint** — does this route exist as part of the existing Configuration Agent surface, or does §11.B own creating it? Recommendation: §11.B owns it, located at `server/routes/clientpulseConfig.ts`, calling `configUpdateHierarchyTemplateService` directly. Confirm.
3. **Editorial rules — capability slug naming** — `clientpulse.config.*` slugs are factual product surface. Confirm with user that the four slugs (read/update/reset/history) match the product taxonomy already used in `docs/capabilities.md` (some sections use kebab-case, some use dot.notation). Match the existing convention.
4. **Reset behaviour** — `clientpulse.config.reset` capability — does "reset" mean revert to template defaults (system-managed reset) or revert to the last `config_history` snapshot (operator undo)? Pickup prompt is silent. Recommendation: revert to template defaults (matches Configuration Agent's "factory reset" semantic in other surfaces). Flagged.

### §11.C Sequencing & dependencies

Hard dependencies:
- §11.A depends on `SENSITIVE_CONFIG_PATHS` and `validateOperationalConfig` (Phase 0 — already shipped).
- §11.A depends on `config_history` table (already exists).
- §11.B hard-depends on §11.A (popup confirm calls into §11.A's service).
- §11.B doc updates can land in the same commit as §11.B code (per CLAUDE.md §11 docs-stay-in-sync rule).

Soft dependencies:
- §11.A is independent of all Phase 4 work — could land before, after, or in parallel.
- §11.B's chat popup is a new App-shell-level component — verify no existing global popup already occupies the slot.

### §11.D Commit granularity

Two commits per the 7-chunk sequence:
- **Chunk 6 (§11.A):** skill + service + pure + tests + action handler + registration. One commit.
- **Chunk 7 (§11.B):** popup + nav wiring + ⌘K + doc updates (`capabilities.md`, `integration-reference.md`, `configuration-assistant-spec.md`, `orchestrator-capability-routing-spec.md`, `architecture.md`). One commit (per CLAUDE.md §11 docs-stay-in-sync).

### §11.E Aggregate ship-gate verification (B3 + B5)

End-to-end test (manual, before declaring chunks 6-7 done):

1. Run the §11.B.4 non-sensitive golden test. Verify `config_history` row exists with `change_source='config_agent'`. **B3 PASSED.**
2. Run the §11.B.4 sensitive golden test. Verify the action→review→approve→write loop. **B5 PASSED.**

Document both verifications in `tasks/builds/clientpulse/progress.md` Chunk 7 entry.
