# Session 1 Spec — Foundation + Operator Config UX

**Scope:** Phase A (platform cleanup) + Phase 5 (Settings UIs) + Phase 7 (Operator onboarding wizard)
**Branch:** `claude/clientpulse-session-1-<suffix>` (new branch off `main`)
**Est. effort:** ~2 weeks, one PR
**Predecessors:** ClientPulse Phases 0–4 + 4.5 shipped to main 2026-04-19

---

## Contents

1. Scope, ship gates, and locked contracts
2. Phase A — org-level operational-config data-model separation
3. Phase A — rename `clientpulse.operator_alert → notify_operator` + module-composable `SENSITIVE_CONFIG_PATHS`
4. Phase A — generic `/api/organisation/config/apply` route + UI renames + housekeeping
5. Phase A — Configuration Assistant popup (Option 2: embedded real agent loop)
6. Phase 5 — ClientPulse Settings page (typed editors) + Subaccount Blueprint editor refactor
7. Phase 7 — Operator onboarding wizard (sysadmin create-org + org-admin first-run)
8. Work sequence, chunks, ship-gate tests, and review gates
9. File inventory (to create / to modify)
10. Open questions

---

## §1. Scope, ship gates, and locked contracts

### §1.1 What Session 1 delivers

After merge:

- Org-level operational config overrides live in a dedicated column on `organisations` (not on `hierarchy_templates`). Every platform write path targets this single row; effective config is `system_hierarchy_templates.operational_defaults` deep-merged with that row (which may be `NULL` until the first explicit edit).
- Every platform-level concern (action slugs, route paths, capability registries, UI labels) is **generic-named**. Anything still carrying a product brand (e.g. `clientpulse.*`) is a deliberate vertical-module concept, not an accidental platform coupling.
- Operators have two equal surfaces for editing their org's operational config: a typed Settings page (point-and-click) and the Configuration Assistant popup (conversational). Both write through the same underlying config-update service + audit trail — the Settings page via `POST /api/organisation/config/apply` directly, the Configuration Assistant via the `config_update_organisation_config` skill reached through the existing agent-conversations API (see §1.3(j) for the full contract).
- New orgs can be created + onboarded end-to-end via UI using the new terminology (Organisation Templates, Subaccount Blueprints, ClientPulse Settings).
- Every existing intervention flow (scenario detector, operator-driven propose, outcome measurement) continues to work unchanged — the cleanup is surgical, not behavioural.

### §1.2 Ship gates

| # | Gate | Phase | Verification |
|---|------|-------|--------------|
| S1-A1 | Every Phase-4.5 config write targets `organisations.operational_config_override` instead of `hierarchy_templates.operational_config`. `orgConfigService.getOperationalConfig` reads from the new column. Existing data backfilled idempotently by the migration. | A | Unit test: seed an org with template overrides → run migration → assert `organisations.operational_config_override` carries the overrides and the chat write-path hits the new column. |
| S1-A2 | Action type `clientpulse.operator_alert` renamed to `notify_operator` across registry, skill executor, proposer job, metadata schema, UI, and existing action rows. Legacy alias resolves to the new slug so in-flight review-queue items stay intact. | A | Pure test: registry lookup on both slugs via `resolveActionSlug`; migration assertion that all historical `actions.action_type` values are rewritten; pure-test assertion on `proposeClientPulseInterventionsJob` / `clientPulseInterventionProposerPure` output emits the new slug. |
| S1-A3 | `SENSITIVE_CONFIG_PATHS` is composable. Modules declare their sensitive paths via a registry; the core merges them. Adding a new module does not touch core code. | A | Unit test: register a synthetic module's paths + assert `isSensitiveConfigPath` covers them. |
| S1-A4 | Generic route `POST /api/organisation/config/apply` is the platform-wide config-write surface. `POST /api/clientpulse/config/apply` is retired entirely (no redirect) per §4.2 / §10.3. | A | Integration test: POST to the generic route, receive the same response shape as the legacy route. |
| S1-A5 | Configuration Assistant popup mounts the real agent loop (not the Phase-4.5 direct-patch form). Session persists across modal close + reopen. Minimised pill shows background execution. The Phase-4.5 `ConfigAssistantChatPopup` file is either rewritten or deleted. | A | Manual: open the popup, submit a multi-step plan, close the popup while executing, re-open, verify the same session resumes. |
| S1-5.1 | ClientPulse Settings page at `/clientpulse/settings` has an editor surface for every `operational_config` block exposed in the schema today: typed editors for the 9 blocks healthScoreFactors, churnRiskSignals, churnBands, interventionDefaults, alertLimits, staffActivity, integrationFingerprints, dataRetention, onboardingMilestones; and a schema-validated JSON editor (`InterventionTemplatesJsonEditor`) for interventionTemplates per §6.2 + §10.5 (typed editor deferred to Session 2 Phase 8). Every write goes through the generic route. | 5 | Manual: open page, edit each block, verify `config_history` row lands, verify `organisations.operational_config_override` reflects the change. |
| S1-5.2 | Subaccount Blueprint editor (refactored `AdminAgentTemplatesPage`) no longer exposes **editable** `operationalConfig` fields. The seed block is rendered read-only (per §6.5) as an informational preview with a "change live config in ClientPulse Settings" callout. Editor only controls blueprint metadata + agent hierarchy; the `operational_config_seed` block is rendered read-only as informational preview only. | 5 | Manual: open the blueprint editor, verify no editable operational-config fields are visible (the read-only seed preview is expected); verify creating a new subaccount from the default blueprint inherits the org's effective operational config via `orgConfigService.getOperationalConfig(orgId)` correctly. |
| S1-7.1 | New orgs go through the create-org + first-run flows using the new terminology ("Organisation Template" picker + "ClientPulse Settings" reference + "Subaccount Blueprints" in nav). No legacy labels appear in either flow. | 7 | Manual: run the happy-path onboarding for a fresh org, screenshot each screen, verify all labels match the post-Phase-A naming. |
| S1-7.2 | Onboarding wizard soft-gates GHL OAuth (workspace is usable at first sign-in, ClientPulse data appears only after the connection lands). No broken-state pages. | 7 | Manual: complete onboarding without connecting GHL → verify dashboard renders empty states cleanly; connect GHL → verify data lights up within one scan cycle. |

### §1.3 Locked contracts (non-negotiable, inherit + extend Phase 4/4.5)

Carried forward from the Phase 4 pickup prompt (no change):

- (a) 5 namespaced action slugs: `crm.fire_automation`, `crm.send_email`, `crm.send_sms`, `crm.create_task`. **Changed this session:** `clientpulse.operator_alert` → `notify_operator`.
- (b) Interventions remain `actions` rows + `intervention_outcomes` rows. No parallel intervention table.
- (c) Configuration Agent writes flow via `config_update_organisation_config` skill (renamed this session from `config_update_hierarchy_template`; legacy slug preserved via `ACTION_SLUG_ALIASES` per §3.4). The skill's **target row** moves from `hierarchy_templates` to `organisations.operational_config_override` (see §2).
- (d) Intervention templates continue to live in operational_config JSONB. What changes: the JSONB lives on `organisations`, not on `hierarchy_templates`.
- (e) No auto-execution path in V1.
- (f) Sensitive-path writes require `actions` row with `gateLevel='review'`. `SENSITIVE_CONFIG_PATHS` becomes module-composable (§3).
- (g) Merge-field resolver grammar unchanged.

Introduced this session:

- (h) **`organisations.operational_config_override` is the single organisation-owned writable source of truth for operational-config overrides.** Every writer targets this one row. Effective runtime config is `system_hierarchy_templates.operational_defaults` deep-merged with that row (which may be `NULL` on newly-created orgs until the first explicit edit). No runtime path reads `hierarchy_templates.operational_config_seed`. Any code path that writes elsewhere — or reads the seed column at runtime — is a bug.
- (i) **Platform primitives are module-agnostic.** Any action slug, capability path, or route that is genuinely cross-module (e.g. operator alerts, config-apply) MUST be un-namespaced or generically-namespaced (`ops.*` / `system.*`). Module-branded slugs (`clientpulse.*`, `crm.*`) are reserved for genuinely module-specific concepts.
- (j) **Settings page and Configuration Assistant are equal surfaces on the same mechanism.** Both write through the same config-update service layer (`configUpdateOrganisationService.applyOrganisationConfigUpdate`), produce the same `config_history` audit trail, and respect the same sensitive-path split. The Settings page reaches this layer directly via `POST /api/organisation/config/apply` (§4); the Configuration Assistant reaches it via the `config_update_organisation_config` skill invoked through the existing `/api/agents/:agentId/conversations/...` agent loop (§5). No surface has privileged access.
- (k) **Session lifecycle for the Configuration Assistant popup:** opening a popup resumes the most recent agent run < 15 minutes old, else creates a fresh one. Closing the popup does not kill the run. Background execution surfaces via the minimised pill.
- (l) **All inbound action-slug surfaces MUST normalise via `resolveActionSlug`.** Routes, webhook handlers, queue consumers, anything that receives an `action_type` from an external caller. Legacy slugs are expected to appear for at least 2-3 releases; defensive normalisation is the contract, not the exception.
- (m) **Intervention state machine is strictly linear.** The `actions` row progresses `proposed → (approved | rejected | blocked) → executing → (completed | failed | skipped)`. No branching states, no intermediate sub-states. Transitions validated at `actionService.transition()` against `LEGAL_TRANSITIONS` (server/config/actionRegistry.ts). Any new state that feels necessary is an architectural change + needs a separate spec round — not an implementation-time addition.
  - **`blocked` state semantics.** `blocked` is a **terminal** state, not a transitional one — used when the policy engine, sensitive-path gate, or an external denial (missing credentials, expired scope, quota exceeded at the adapter layer) makes the action un-executable. `actions.errorJson.blockedReason` carries an enum explaining why (`policy_denial`, `missing_integration`, `scope_expired`, `quota_exceeded`, `sensitive_path_drift`, `other`). The operator does NOT re-enter approval for a blocked row — they re-propose (new action row with a new idempotency key). `blocked` does not auto-retry.
  - **`skipped` state semantics.** Terminal. Used when a proposed action was rendered irrelevant before execution (cooldown hit between propose and approve, target entity deleted, operator bulk-rejected via the review queue, duplicate detected at the adapter layer). Every skipped row MUST carry `actions.errorJson.skippedReason` from the closed enum `{ 'cooldown_elapsed', 'target_missing', 'operator_dismissed', 'duplicate_external', 'quota_exceeded_retroactive', 'other' }`. Analytics queries filter on this enum; un-enumerated `'other'` is a bug to chase.
- (n) **Config gating is pure; execution is deterministic.** Validation (`applyPathPatch` + `validateProposedConfig` + `classifyWritePath`) produces no side effects — same input → same output. The approval-execute phase never mutates config during execution; it re-validates for drift then applies the already-validated merge in a single transaction. Never interleave validation with execution.
- (o) **Canonical intervention idempotency key pattern.** Every intervention surface derives its key from: `clientpulse:intervention:{source}:{subaccountId|orgId}:{templateSlug|actionType}:{correlation}`, where `source ∈ {scenario_detector, operator_manual, ...}` and `correlation` is the logical-identity anchor (e.g. churnAssessmentId for scenario_detector, payload-hash for operator_manual). Any new intervention trigger (polling, webhook, API) MUST follow this pattern. Implemented in `clientPulseInterventionIdempotencyPure.ts`; new triggers extend the existing pure module rather than inventing their own format.
- (p) **Atomicity boundaries are explicit.** Each DB transaction is the unit of atomicity. Specifically:
  - Action insert + `review_items` insert → separate writes; operator-visible lag is acceptable. Reconciliation: a periodic sweep creates missing `review_items` rows for any `actions` row with `gateLevel='review' AND status='proposed' AND NOT EXISTS (review_items WHERE action_id=…)`.
  - Config write + `config_history` insert → atomic (same tx). Never partial.
  - Intervention execution (adapter call) + `actions.status` transition → separate ops. Reconciliation: the `stale-run-cleanup` job transitions orphan `executing` rows to `failed` after the execution timeout.
  - Action completion + `intervention_outcomes` insert → eventual; outcome-measurement job closes the gap on the next hourly tick.
- (q) **Correlation key contract.** Every log, event emission, and audit row that touches the intervention lifecycle MUST carry `actionId` as a first-class correlation key. Specifically:
  - Log calls: `logger.info('clientpulse.intervention.*', { ..., actionId })` — applies to proposer enqueue, dedup, approval, execute, outcome-measure, failure.
  - `config_history.change_summary` for intervention-related config changes references the triggering action via "triggered by action <id>" when applicable.
  - `action_events` already carries action_id via FK — no change needed there.
  - The existing `clientpulse.intervention.enqueued` lifecycle event already complies; new events inherit the pattern.
- (r) **Replayability is a first-class constraint.** Every intervention-decision function is pure-testable with deterministic inputs → deterministic outputs. `proposeClientPulseInterventionsPure()`, `decideOutcomeMeasurement()`, `validateInterventionActionMetadata()`, `applyPathPatch()`, `validateProposedConfig()`, `classifyWritePath()`, `resolveMergeFields()`, `canonicalStringify()`, `buildScenarioDetectorIdempotencyKey()`, `buildOperatorIdempotencyKey()` — all already pure. Any new intervention-decision logic added in Session 1 MUST live in a `*Pure.ts` module. I/O wrappers can exist around it but decision logic never lives inside them.
- (s) **Retry vs replay — distinct concepts, distinct machinery.**
  - **Automatic retry** (in-scope for Session 1): same `actions` row, `retry_count++` on each attempt, same `idempotency_key`, handler is expected to produce the same external effect (idempotent at the provider layer). Retry policy lives on `actionDefinition.retryPolicy` (maxRetries, strategy, retryOn, doNotRetryOn). The execution layer owns automatic retries; decision layer never triggers them.
  - **Manual replay** (out-of-scope for Session 1 — documented for future): a deliberate NEW action row that re-runs a previously-completed or previously-failed intervention against a current-state target. When introduced, the schema adds `actions.replay_of_action_id` (nullable FK to the original). The new row's idempotency key derives from `(original_idempotency_key, 'replay', attempt_n, replaying_user_id)` so the two rows cannot collide on the canonical dedup guard. Operator audit trail links the replay back to the original via `replay_of_action_id`.
  - **Never**: don't let automatic retry spawn a new action row. Never let manual replay reuse the original row's idempotency key.
- (t) **Execution ordering priority** (for every atomic transaction boundary defined in (p)):
  1. **Internal state writes first** — DB rows, status transitions, audit marker inserts. These are cheap + recoverable.
  2. **External side effects last** — adapter calls, provider HTTP requests, email sends, SMS fires. These are expensive + often non-idempotent at the provider.
  3. **Audit / logging NEVER skipped.** Every step emits its lifecycle log line before proceeding to the next step. If the audit write fails, the step aborts (no silent side effect).
  Rationale: if the transaction aborts mid-flight, internal state rolls back + the external side effect never happened. If the external side effect succeeds but the post-step internal write fails, the next reconciliation sweep (per (p)) catches and rectifies the state drift via the existing execution timeout + orphan-detection paths.
- (u) **External side effect preconditions.** No external side effect (adapter call, CRM API, email send, SMS fire, outbound webhook) executes unless ALL of the following are true:
  1. Action is in `approved` state (per (m)).
  2. Config validation is complete (per (n); for config-writing actions, drift digest matches).
  3. Idempotency key is locked at the expected layer (DB unique index for the action row; provider-level Idempotency-Key header where the provider supports it).
  4. Execution timeout + max-retry budget have capacity remaining.
  The execution layer asserts all four before dispatching to the adapter; failed preconditions transition the action to `blocked` with an appropriate `errorJson.blockedReason`.
- (v) **Deterministic ordering under concurrency.** When multiple interventions target the same subaccount or the same canonical entity:
  - Scenario-detector proposals for the same `(subaccount, template, churnAssessmentId)` collapse to one (idempotency (o)).
  - Approved actions for the same subaccount execute **serially**, ordered by `actions.created_at ASC` (secondary: `actions.id ASC` for tiebreaker). The execution layer acquires a PG advisory lock on `hashtext('intervention:' || subaccount_id)` for the duration of each action; concurrent executions against the same subaccount queue behind the lock. Cross-subaccount parallelism is unconstrained.
  - Config writes against the same `organisations.operational_config_override` row serialise via `configHistoryService.recordHistory`'s existing advisory lock (`pg_advisory_xact_lock(hashtext('clientpulse_operational_config:' || entity_id))`).
  - Any new intervention surface MUST declare its concurrency-lock scope up-front (which advisory key does it hold during execute?). Default to "same subaccount" unless there's an explicit cross-subaccount coordination requirement.

### §1.6 Intervention lifecycle invariants

Two invariants that bind everything above:

1. **Every intervention produces exactly one terminal outcome.** `completed`, `failed`, `rejected`, `blocked`, or `skipped` — one row, one final state. The `intervention_outcomes` row (when applicable) records the measurement outcome separately from the action's terminal state; the action's terminal state is still one.
2. **Every intervention is traceable via `action.id`.** Every log, event, audit row, and config_history row that touches the lifecycle carries the id. Cross-system queries for "what happened with intervention X" resolve from that single key. When manual replay lands (future), traces follow the replay chain via `replay_of_action_id`.

### §1.4 Layering — Decision vs Execution

Make the layering explicit so it doesn't drift in implementation:

- **Decision layer** — proposer job, intervention context service, Configuration Assistant agent loop, pure matchers. Produces proposals, validates config, computes recommendations, evaluates policy. Writes `actions` rows (+ review items) but does NOT call adapters or external APIs.
- **Execution layer** — execution-layer service + adapters (`apiAdapter`, `workerAdapter`, `devopsAdapter`). Consumes approved `actions` rows. Dumb and deterministic — reads the payload, calls the external system, writes the result. Never re-runs decision logic.

Any code that crosses this boundary (decision calling execution, or execution branching on new decisions) is a smell and should be split. The operator approval in between is the only gate that bridges the two layers.

### §1.5 Intervention envelope — conceptual, not structural

The "intervention envelope" is the conceptual object `{ actions row + intervention_outcomes row + all config_history rows tagged with actionId }`. It is materialised across tables, not unified into a single row:

- `actions.payloadJson` — proposed intervention payload
- `actions.metadataJson` — decision context (validated by `interventionActionMetadataSchema`)
- `actions.status` + `gateLevel` + `approvedBy` — approval state
- `actions.resultJson` + `executedAt` — execution state + result
- `intervention_outcomes` row — band-change attribution + measured outcome
- `config_history` rows (when the intervention triggered a config write) — audit trail

Queries that need the "full envelope" join on `action.id` = `intervention_outcomes.intervention_id` = `config_history` where applicable. Do NOT introduce a materialised `interventions` view table — the envelope lives where the data is written.

**`intervention_id` vs `action_id` — explicit naming rule.** In Session 1 the two are the same identifier (one action row = one intervention). The canonical contract:

```typescript
type InterventionEnvelope = {
  // Identity — logical intervention id. Today: equal to actionId. When manual
  // replay is introduced, this becomes the "chain id" that groups the original
  // and its replays; `replay_of_action_id` walks the chain.
  interventionId: string;  // = actionId in Session 1
  actionId: string;        // FK → actions.id

  // Decision
  actionType: string;
  payload: unknown;
  decisionContext: InterventionActionMetadata;  // actions.metadataJson, validated

  // Approval
  approvalState: 'proposed' | 'approved' | 'rejected' | 'blocked';
  approvedBy?: string;
  approvedAt?: Date;

  // Execution
  executionState: 'executing' | 'completed' | 'failed' | 'skipped';
  resultJson?: unknown;
  executedAt?: Date;

  // Outcome (Nullable — measurement lags execution)
  outcome?: {
    healthScoreBefore?: number;
    healthScoreAfter?: number;
    bandBefore?: string;
    bandAfter?: string;
    bandChanged: boolean;
    outcome: 'improved' | 'unchanged' | 'worsened' | null;
  };
};
```

This type is **documentation-only** — it is not a persisted table or returned by any API directly today. Logs, event payloads, and cross-service correlation should use `actionId` as the first-class key (per (q)); `interventionId` as a logical grouping becomes a distinct concept only when manual replay lands. At that point the type-alias stays; `interventionId` starts differing from `actionId` for replay chains; all existing queries continue to work because they join on `action.id` which is always present.

## §2. Phase A — data-model separation for org-level operational config

### §2.1 The problem being solved

Today, `hierarchy_templates.operational_config` is doing two jobs:

1. **Subaccount blueprint:** "when a new subaccount is created from this template, seed it with these operational defaults."
2. **Org-level runtime config:** "this org's live scoring weights / churn bands / intervention defaults / alert limits."

These are different concepts. The runtime reader (`orgConfigService.getOperationalConfig`) targets whichever template has `systemTemplateId IS NOT NULL`. The Phase-4.5 chat writer (`resolveDefaultHierarchyTemplateId`) targets whichever has `isDefaultForSubaccount=true`. An org with more than one hierarchy_template row can have these resolve to different rows — chat writes silently no-op against the runtime.

### §2.2 Decision: single new column on `organisations`

**Add `organisations.operational_config_override: jsonb` — one row per org, validated by `operationalConfigSchema`.**

Chain becomes:

```
system_hierarchy_templates.operational_defaults   (platform seed, system admin owns)
  → organisations.operational_config_override     (org overrides, org admin owns — this is where chat + Settings UI write)
  → effective config used by runtime
```

Deep-merge order stays the same (template defaults → org overrides). `orgConfigService.getOperationalConfig` swaps its read source from the hierarchy_template row to the organisation row.

Hierarchy templates keep their `operational_config` field (**renamed to** `operational_config_seed`) purely as an informational breadcrumb of what was seeded when the template was adopted. It is NOT read by any runtime path after initial adoption: all runtime reads go through the org column, and new subaccounts created under a blueprint inherit the org's **effective** operational config via `orgConfigService.getOperationalConfig(orgId)` (the deep-merge of `system_hierarchy_templates.operational_defaults` with `organisations.operational_config_override`) — not the blueprint's `operational_config_seed` and not the raw override row. Per §6.5 the Subaccount Blueprint editor renders the seed block read-only as a reference display, not as an input to any live code path.

### §2.3 Why a column, not a table

- One row per org is the shape the data actually has. A separate `org_operational_configs` table adds join overhead and row-lifecycle concerns for zero payoff.
- `config_history` already provides version history; a separate versioned table duplicates that infrastructure.
- RLS is simpler: the `organisations` table already has tenant-isolation policies.

Trade-off: adding a column to a hot table. Not an issue — `organisations` is tiny (one row per org, thousands at most at steady-state) and the JSONB column is nullable.

### §2.4 Migration plan

**Migration `NNNN_org_operational_config_override.sql`** (next-free number at kickoff; check `ls migrations/ | tail -3`):

```sql
BEGIN;

-- 1. Add the new operational-config override column.
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS operational_config_override jsonb;

-- 2. Add the org-level FK to the adopted system template. This migration OWNS
--    the ADD COLUMN — §10.1's chunk-2 audit decides only the final column NAME
--    (keep `applied_system_template_id` as the default; only rename inside this
--    migration if a pre-existing column under a different name is found during
--    the audit). The FK is nullable because pre-existing orgs may not have an
--    explicit linkage yet; step 3 backfills from the current implicit linkage.
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS applied_system_template_id uuid
    REFERENCES system_hierarchy_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS organisations_applied_system_template_id_idx
  ON organisations (applied_system_template_id)
  WHERE applied_system_template_id IS NOT NULL;

-- 3. Backfill the FK from the current implicit linkage (any hierarchy_templates
--    row under the org with a non-null system_template_id). Pick the most
--    recently updated matching template if there are multiple.
WITH resolved_link AS (
  SELECT DISTINCT ON (ht.organisation_id)
    ht.organisation_id, ht.system_template_id
  FROM hierarchy_templates ht
  WHERE ht.system_template_id IS NOT NULL
    AND ht.deleted_at IS NULL
  ORDER BY ht.organisation_id, ht.updated_at DESC
)
UPDATE organisations o
SET applied_system_template_id = rl.system_template_id
FROM resolved_link rl
WHERE o.id = rl.organisation_id
  AND o.applied_system_template_id IS NULL;

-- 4. Backfill the override column: copy each org's existing
--    hierarchy_templates.operational_config into the new column. Picks the
--    hierarchy_template that has systemTemplateId IS NOT NULL AND deletedAt IS NULL
--    and uses ORDER BY updated_at DESC when multiple rows match (intentional
--    determinisation — today's orgConfigService.getOperationalConfig uses
--    LIMIT 1 without ORDER BY, which makes tie-breaking non-deterministic;
--    the migration is the first time every org's override is locked to a
--    specific row, so we pick the most-recently-updated candidate and accept
--    this is a slight hardening of runtime behaviour, not a faithful copy).
WITH resolved_tpl AS (
  SELECT DISTINCT ON (ht.organisation_id)
    ht.organisation_id, ht.operational_config
  FROM hierarchy_templates ht
  WHERE ht.system_template_id IS NOT NULL
    AND ht.deleted_at IS NULL
    AND ht.operational_config IS NOT NULL
  ORDER BY ht.organisation_id, ht.updated_at DESC
)
UPDATE organisations o
SET operational_config_override = rt.operational_config
FROM resolved_tpl rt
WHERE o.id = rt.organisation_id
  AND o.operational_config_override IS NULL;

-- 5. Rename the template column so the intent is clear + stop accidental writes
--    from code that still thinks it's the runtime column.
ALTER TABLE hierarchy_templates
  RENAME COLUMN operational_config TO operational_config_seed;

-- 6. Deprecation marker — a comment on the new column makes the intent
--    discoverable in psql + ORM introspection.
COMMENT ON COLUMN organisations.operational_config_override IS
  'Org-level runtime operational config. Single source of truth. Written by config_update_organisation_config skill + ClientPulse Settings page. Deep-merged with system_hierarchy_templates.operational_defaults at read time.';
COMMENT ON COLUMN hierarchy_templates.operational_config_seed IS
  'One-time informational snapshot copied from system_hierarchy_templates.operational_defaults when this blueprint is adopted. NOT a runtime source; organisations.operational_config_override remains NULL on newly-created orgs until the first explicit edit, and effective config is derived by deep-merging system_hierarchy_templates.operational_defaults with organisations.operational_config_override at read time.';

COMMIT;
```

Rollback (in reverse order): rename `hierarchy_templates.operational_config_seed` back to `operational_config`; drop the supporting index `organisations_applied_system_template_id_idx`; drop `organisations.applied_system_template_id`; drop `organisations.operational_config_override`. The backfilled override data is recoverable from `hierarchy_templates.operational_config_seed` before the rename is reverted; the FK backfill is recoverable from the same implicit linkage the forward migration read from.

### §2.5 Code changes required

| Path | Change |
|------|--------|
| `server/db/schema/organisations.ts` | Add `operationalConfigOverride: jsonb('operational_config_override').$type<Record<string, unknown> \| null>()` AND `appliedSystemTemplateId: uuid('applied_system_template_id').references(() => systemHierarchyTemplates.id, { onDelete: 'set null' })`. Both columns are added by the §2.4 migration; the schema file must surface both. |
| `server/db/schema/hierarchyTemplates.ts` | Rename field `operationalConfig` → `operationalConfigSeed`. Type stays the same. |
| `server/services/orgConfigService.ts` | `getOperationalConfig` reads from `organisations.operational_config_override` (+ system template defaults). Deep-merge logic unchanged. |
| `server/services/configUpdateHierarchyTemplateService.ts` | Rewrite to target `organisations.operational_config_override`. Rename to `configUpdateOrganisationService.ts`. `resolveDefaultHierarchyTemplateId` is retired (replaced by: always target the caller's org). `resolvePortfolioHealthAgentId` stays (still needed for sensitive-path action enqueue). |
| `server/skills/config_update_hierarchy_template.md` | Rename skill to `config_update_organisation_config`. Update the markdown; action slug renamed in the registry (see §3). Payload no longer takes `templateId` — the target is always the caller's organisation. |
| `server/config/actionRegistry.ts` | Rename action slug: `config_update_hierarchy_template` → `config_update_organisation_config`. Add legacy-alias resolution (§3). |
| `server/services/skillExecutor.ts` | Rename the case statement; call the renamed service. |
| `server/services/configUpdateHierarchyTemplatePure.ts` | Rename to `configUpdateOrganisationConfigPure.ts`. Logic unchanged — still deep-merges, classifies sensitive, builds snapshot. |
| `server/services/__tests__/configUpdateHierarchyTemplatePure.test.ts` | Update imports + test names to match the renamed module. All 18 existing cases carry over unchanged. |
| `server/services/clientPulseInterventionContextService.ts` | `resolveDefaultHierarchyTemplateId` removed (not needed — org is the target). |
| `architecture.md` §"ClientPulse Intervention Pipeline" | Update the "Configuration Assistant extension" subsection to reflect the new target. |
| `docs/configuration-assistant-spec.md` | Tool #29 renamed; target org instead of template. |
| `docs/integration-reference.md` | `clientpulse-configuration` pseudo-integration block updates its `skills_enabled` slug. |

### §2.6 Read-path correctness check

The read path in `getOperationalConfig` currently joins through `hierarchyTemplates` for org overrides. After the change:

```typescript
async getOperationalConfig(orgId: string): Promise<OperationalConfig | null> {
  const [org] = await db
    .select({ override: organisations.operationalConfigOverride, appliedTemplateId: organisations.appliedSystemTemplateId })
    .from(organisations)
    .where(eq(organisations.id, orgId))
    .limit(1);
  if (!org) return null;

  let systemDefaults: Record<string, unknown> = {};
  if (org.appliedTemplateId) {
    const [sys] = await db
      .select({ defaults: systemHierarchyTemplates.operationalDefaults })
      .from(systemHierarchyTemplates)
      .where(eq(systemHierarchyTemplates.id, org.appliedTemplateId));
    systemDefaults = (sys?.defaults as Record<string, unknown>) ?? {};
  }
  const overrides = (org.override as Record<string, unknown>) ?? {};
  return deepMerge(systemDefaults, overrides) as OperationalConfig;
}
```

This relies on `organisations.applied_system_template_id` — a new nullable FK on the organisations table pointing at the adopted system template. Today the linkage is implicit (via hierarchy_template.systemTemplateId); moving it to the org makes the dependency explicit + avoids the join. **The migration in §2.4 is the sole owner of the ADD COLUMN, FK, supporting index, and backfill for this linkage.** Chunk-2 kickoff audit decides only whether a pre-existing column under a different name already carries this meaning; if it does, the `ALTER TABLE ADD COLUMN` in §2.4 step 2 is replaced by reusing the existing column name in-place, but the decision "an explicit org-level FK to the adopted system template exists post-§2.4" is locked.

### §2.7 Open questions for §2

*(Resolved — see §10 for the decisions log.)*
## §3. Phase A — rename `clientpulse.operator_alert → notify_operator` + module-composable `SENSITIVE_CONFIG_PATHS`

### §3.1 Rename rationale

`operator_alert` is a platform primitive — it writes a notification, optionally fans out to in-app / email / slack via the existing notifications worker. Nothing about that is ClientPulse-specific. Future modules (SEO monitor, content-performance digests, anything agent-driven) will want the same primitive. Keeping it namespaced under `clientpulse.*` forces every future module to either:

- Reuse a ClientPulse-branded slug (wrong — creates false coupling), or
- Define their own slug and duplicate the handler (wrong — fragments the primitive).

Neither is acceptable. Rename it once, now, while the action row count is small.

### §3.2 Canonical new slug

**`notify_operator`** — un-namespaced. Justification:

- The existing action registry has un-namespaced core primitives (`send_email`, `create_task`, `read_inbox`). `notify_operator` fits that convention.
- `ops.*` was considered but introduces a new namespace that has no other residents today — premature.
- Reserved for platform-level operator notifications; modules that want richer domain-specific alerting add their own primitives (e.g. `clientpulse.escalation_alert` if a ClientPulse-specific escalation ever diverges from the generic one).

### §3.3 Migration

**Migration `NNNN_rename_operator_alert.sql`:**

```sql
BEGIN;

-- 1. Rewrite all existing action_type values.
UPDATE actions
SET action_type = 'notify_operator'
WHERE action_type = 'clientpulse.operator_alert';

-- 2. Rewrite intervention_outcomes.intervention_type_slug the same way.
UPDATE intervention_outcomes
SET intervention_type_slug = 'notify_operator'
WHERE intervention_type_slug = 'clientpulse.operator_alert';

-- 3. Rewrite the partial index predicate that lists the 5 intervention action types.
DROP INDEX IF EXISTS actions_intervention_outcome_pending_idx;
CREATE INDEX IF NOT EXISTS actions_intervention_outcome_pending_idx
  ON actions (organisation_id, executed_at)
  WHERE action_type IN (
          'crm.fire_automation',
          'crm.send_email',
          'crm.send_sms',
          'crm.create_task',
          'notify_operator'
        )
    AND status IN ('completed', 'failed');

COMMIT;
```

Rollback script rewrites the slug back + restores the old index.

### §3.4 Legacy alias resolution (defence in depth)

Even after the migration, legacy code paths in-flight might still reference the old slug (cached action definitions, queued job payloads that landed pre-migration, dashboard filters). Add an alias map in `actionRegistry.ts`:

```typescript
const ACTION_SLUG_ALIASES: Record<string, string> = {
  'clientpulse.operator_alert': 'notify_operator',
  'config_update_hierarchy_template': 'config_update_organisation_config',
};

export function resolveActionSlug(slug: string): string {
  return ACTION_SLUG_ALIASES[slug] ?? slug;
}

export function getActionDefinition(actionType: string): ActionDefinition | undefined {
  return ACTION_REGISTRY[resolveActionSlug(actionType)];
}
```

Every registry lookup + executor dispatch goes through `resolveActionSlug`. Legacy slugs still resolve correctly. After 2-3 releases with zero hits on the alias path (instrumented via a log event), the aliases can be retired.

### §3.5 Code changes — touch list

| Path | Change |
|------|--------|
| `server/config/actionRegistry.ts` | Rename entry `clientpulse.operator_alert` → `notify_operator`. Add `ACTION_SLUG_ALIASES` + `resolveActionSlug`. |
| `server/services/skillExecutor.ts` | Case statement renamed. Dispatch via `resolveActionSlug`. |
| `server/services/interventionActionMetadata.ts` | Rename the `clientpulse.operator_alert` entry in the `INTERVENTION_ACTION_TYPES` tuple to `notify_operator`. This is the single authoritative rename location; downstream imports (context service, proposer, jobs, UI) pick up the new literal via this module's exported tuple + type. |
| `server/services/clientPulseInterventionContextService.ts` | Rename the zod enum literal for `createOperatorProposal`. The `INTERVENTION_ACTION_TYPES` tuple is imported from `interventionActionMetadata.ts` (above), so the tuple source edit lives there. |
| `server/services/clientPulseInterventionIdempotencyPure.ts` | Rename `clientpulse.operator_alert` → `notify_operator` in the `InterventionActionTypeName` hard-coded union (consumed by both `buildScenarioDetectorIdempotencyKey` and `buildOperatorIdempotencyKey`). |
| `server/skills/clientPulseOperatorAlertServicePure.ts` | Rename `clientpulse.operator_alert` → `notify_operator` in the hard-coded slug literal (used in the idempotency-key builder + JSDoc header). |
| `server/jobs/proposeClientPulseInterventionsJob.ts` | Rename the literal in the `actionType === 'clientpulse.operator_alert'` branch → `notify_operator`. |
| `server/jobs/measureInterventionOutcomeJob.ts` | Rename in raw-SQL action_type IN clause. |
| `server/jobs/measureInterventionOutcomeJobPure.ts` | Rename in operator-alert branch of `decideOutcomeMeasurement`. |
| `server/routes/clientpulseInterventions.ts` + `clientPulseInterventionContextService.ts` | Rename in zod enums; alias accepted on input + normalised via `resolveActionSlug`. |
| `client/src/components/clientpulse/ProposeInterventionModal.tsx` + `OperatorAlertEditor.tsx` | Rename in `InterventionActionType` union + submit payload. |
| Pure tests | Update literals: `clientPulseInterventionProposerPure.test.ts`, `clientPulseInterventionPrimitivesPure.test.ts`, `interventionActionMetadataPure.test.ts`, `interventionIdempotencyKeysPure.test.ts`, `measureInterventionOutcomeJobPure.test.ts`. |
| Docs | `architecture.md` §intervention-pipeline · `docs/capabilities.md` · `docs/integration-reference.md` (taxonomy entry). |
| `tasks/builds/clientpulse/progress.md` | Log the rename. |

### §3.6 Module-composable `SENSITIVE_CONFIG_PATHS`

#### Current state

`server/services/operationalConfigSchema.ts` hardcodes the list. ClientPulse owns every entry. A new module can't add its sensitive paths without editing this file.

#### Design

Registry pattern — each module declares its paths; the core merges at read time.

**New file: `server/config/sensitiveConfigPathsRegistry.ts`**

```typescript
/**
 * sensitiveConfigPathsRegistry — module-declared set of operational_config
 * dot-paths whose writes must route through the action→review queue.
 *
 * Each module contributes its paths via `registerSensitiveConfigPaths()` at
 * module-init time (imported once at server startup). The core config-agent
 * service reads the merged set via `getAllSensitiveConfigPaths()`.
 *
 * The registry is append-only within a process lifetime: paths can be added,
 * never silently removed. Removal requires a deliberate code change +
 * deployment.
 */

const registeredPaths = new Set<string>();

export function registerSensitiveConfigPaths(moduleSlug: string, paths: readonly string[]): void {
  for (const p of paths) registeredPaths.add(p);
}

export function getAllSensitiveConfigPaths(): readonly string[] {
  return Array.from(registeredPaths);
}

export function isSensitiveConfigPath(path: string): boolean {
  for (const sensitive of registeredPaths) {
    if (path === sensitive || path.startsWith(sensitive + '.')) return true;
  }
  return false;
}
```

**Module registration (server boot / module init):**

`server/modules/clientpulse/registerSensitivePaths.ts` (new):

```typescript
import { registerSensitiveConfigPaths } from '../../config/sensitiveConfigPathsRegistry.js';

// Invoked once at server boot.
registerSensitiveConfigPaths('clientpulse', [
  'interventionDefaults.defaultGateLevel',
  'interventionDefaults.cooldownHours',
  'interventionDefaults.maxProposalsPerDayPerSubaccount',
  'interventionDefaults.maxProposalsPerDayPerOrg',
  'interventionTemplates',
  'healthScoreFactors',
  'churnRiskSignals',
  'churnBands',
  'staffActivity.excludedUserKinds',
  'staffActivity.automationUserResolution',
  'staffActivity.churnFlagThresholds',
  'alertLimits.maxAlertsPerRun',
  'alertLimits.maxAlertsPerAccountPerDay',
  'dataRetention',
]);
```

#### Deprecation of the old export

`operationalConfigSchema.ts`:

```typescript
// @deprecated — use sensitiveConfigPathsRegistry.getAllSensitiveConfigPaths() directly.
// Kept as a function-backed alias (not an empty frozen array) so any remaining
// direct consumer receives the live registry contents, not a permanently-empty
// snapshot. Eligible for deletion after Session 1 grep confirms zero imports.
export const getSensitiveConfigPaths = (): readonly string[] =>
  getAllSensitiveConfigPaths();
```

The Session 1 touch list (§3.7) moves every known in-repo import off `SENSITIVE_CONFIG_PATHS` before the array export is deleted; the `getSensitiveConfigPaths()` function alias stays for one release cycle to catch any external-to-module consumer that grep missed. `isSensitiveConfigPath` in the same file also delegates to the registry. All callers automatically pick up the new list. There is exactly one source of truth: the registry.

#### Boot-time registration

The module's `registerSensitivePaths.ts` is imported by `server/index.ts` alongside other boot-time setup (routes, queues). It runs once, synchronously, before the first request.

### §3.7 Code changes — `SENSITIVE_CONFIG_PATHS` refactor

| Path | Change |
|------|--------|
| `server/config/sensitiveConfigPathsRegistry.ts` | **NEW** — registry primitive. Exports BOTH the sensitive-paths API (`registerSensitiveConfigPaths`, `getAllSensitiveConfigPaths`) AND the root-keys API per §3.8 (`registerOperationalConfigRoots`, `isValidConfigPath`). Single file so modules have one composability surface. |
| `server/services/operationalConfigSchema.ts` | `SENSITIVE_CONFIG_PATHS` array export replaced with a `getSensitiveConfigPaths()` function-backed alias that delegates to the registry (no empty frozen array); `isSensitiveConfigPath` delegates to the registry. All in-repo imports migrated off the array export in the same chunk. |
| `server/modules/clientpulse/registerSensitivePaths.ts` | **NEW** — ClientPulse's sensitive paths declaration |
| `server/index.ts` | Import the registration module at boot |
| `server/services/configUpdateHierarchyTemplatePure.ts` (→ renamed per §2) | Use the registry helpers + the `isValidConfigPath` allow-list. The allow-list also becomes composable — see §3.8. |
| `server/services/__tests__/configUpdateHierarchyTemplatePure.test.ts` | Add a test: register a synthetic module's paths + assert coverage |

### §3.8 Bonus: also make `ALLOWED_CONFIG_ROOT_KEYS` composable

The typo-guard allow-list I added during the last review loop has the same problem — it's a hardcoded array inside a pure module. Fold it into the **same file** as the sensitive-paths registry — `server/config/sensitiveConfigPathsRegistry.ts` becomes the single config-composability primitive that modules touch. Rename the file header but not the filename (to avoid a second file rename in §9.1). Add these exports alongside the existing sensitive-paths registrations:

```typescript
// server/config/sensitiveConfigPathsRegistry.ts — adds:
const registeredRootKeys = new Set<string>();

export function registerOperationalConfigRoots(moduleSlug: string, roots: readonly string[]): void {
  for (const r of roots) registeredRootKeys.add(r);
}

export function isValidConfigPath(path: string): boolean {
  if (!path) return false;
  const root = path.split('.')[0];
  return registeredRootKeys.has(root);
}
```

ClientPulse's `registerSensitivePaths.ts` calls both `registerSensitiveConfigPaths(...)` AND `registerOperationalConfigRoots(...)` at boot. Future modules ship one file that declares both sets. The file is already listed in §3.7 and §9.1 (as `server/config/sensitiveConfigPathsRegistry.ts`) — no additional file inventory changes are required; the §3.7 row's "Change" column picks up the `registerOperationalConfigRoots` + `isValidConfigPath` exports.

### §3.9 Resolutions

1. **Legacy-alias hit logging:** yes — log-once per process via a `Set<string>` so we have signal for the eventual alias retirement. Lands in `resolveActionSlug` itself.
2. **Alias-map pure test:** yes — short test asserts every key resolves to a valid registered slug. Prevents typos in the alias map itself. Covered by `actionSlugAliasesPure.test.ts`.
3. **Webhook handler audit:** every inbound handler that carries an `action_type` (or equivalent) field MUST normalise via `resolveActionSlug` — this is now a locked rule in §1.3 (see (l) below in §10), not a per-caller check. Audit at chunk-2 kickoff confirms which handlers need the defensive normalisation added.
## §4. Phase A — generic `/api/organisation/config/apply` route + UI renames + housekeeping

### §4.1 The new canonical route

**`POST /api/organisation/config/apply`** — platform-generic surface for writing to `organisations.operational_config_override`. Any module settings UI (ClientPulse Settings today; future SEO Settings, Content Settings, etc.) calls this one route.

Request shape:

```typescript
{
  path: string;           // dot-path into operational_config (e.g. "alertLimits.notificationThreshold")
  value: unknown;         // JSON-serialisable
  reason: string;         // operator rationale (logged on config_history.change_summary)
  sessionId?: string;     // optional Configuration Assistant conversation id (carried to `config_history.source_session` for audit; field name preserved for wire-compat with the existing column)
}
```

Response shape is the same as the existing config-apply returns:

```typescript
| { committed: true; configHistoryVersion: number; path: string; classification: 'non_sensitive' }
| { committed: false; actionId: string; classification: 'sensitive'; requiresApproval: true }
| { committed: false; errorCode: 'INVALID_BODY' | 'SCHEMA_INVALID' | 'SUM_CONSTRAINT_VIOLATED' | 'INVALID_PATH' | 'AGENT_REQUIRED_FOR_SENSITIVE'; message: string }
```

No `templateId` input — the target is always the caller's organisation. `resolveDefaultHierarchyTemplateId` is removed.

### §4.2 What happens to `POST /api/clientpulse/config/apply`

**Decision: retire it, not redirect.** Rationale:

- The route has been live for one release cycle and has one caller in the client (`ConfigAssistantChatPopup`). That caller is being rewritten in §5 of this spec anyway.
- A redirect keeps the cruft around for future sessions to wonder about. Clean removal is easier to reason about.
- No external integrations hit this route.

If any in-flight operator session is holding the old URL at deploy time, their next submit will 404 — acceptable given the scope (internal pilot surface, not public API).

If later audit finds the route IS called from somewhere unexpected, the rollback is a one-line export from the generic route file that handles the old path too.

### §4.3 Auth + permissions

Same middleware chain as today:

```typescript
router.post(
  '/api/organisation/config/apply',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(...)
);
```

The `ORG_PERMISSIONS.AGENTS_EDIT` permission scope is inherited — this is an org-admin surface. If a new `ORG_PERMISSIONS.CONFIG_EDIT` feels more semantically correct, add it and use it. Not urgent; flagged as open question §10.

### §4.4 Route file

**New: `server/routes/organisationConfig.ts`** (replaces `server/routes/clientpulseConfig.ts`).

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import {
  applyOrganisationConfigUpdate,
  resolvePortfolioHealthAgentId,
} from '../services/configUpdateOrganisationService.js';

const router = Router();

const applyBodySchema = z.object({
  path: z.string().min(1).max(500),
  value: z.unknown(),
  reason: z.string().min(1).max(5_000),
  sessionId: z.string().uuid().optional(),
});

router.post(
  '/api/organisation/config/apply',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT),
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) throw { statusCode: 400, message: 'Organisation context required' };

    const parsed = applyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw { statusCode: 400, message: 'Invalid request body', errorCode: 'INVALID_BODY' };
    }

    const agentId = (await resolvePortfolioHealthAgentId(orgId)) ?? undefined;

    const result = await applyOrganisationConfigUpdate({
      organisationId: orgId,
      path: parsed.data.path,
      value: parsed.data.value,
      reason: parsed.data.reason,
      sourceSession: parsed.data.sessionId ?? null,
      changedByUserId: req.user?.id ?? null,
      agentId,
    });

    res.json(result);
  }),
);

export default router;
```

### §4.5 Reads: a symmetrical read endpoint

Phase 5's Settings page needs to read the current merged operational config to populate the typed editors. Add:

**`GET /api/organisation/config`** — returns the effective merged config (`system defaults → org overrides`) + the raw override row so the UI can compute the "which values are overridden" mask and show the "reset to template default" affordance per-field.

Response:

```typescript
{
  effective: OperationalConfig;                         // merged deep-merge result; fully-normalised
  overrides: DeepPartial<OperationalConfig> | null;     // raw sparse row from organisations.operational_config_override
  systemDefaults: OperationalConfig | null;             // the underlying system template defaults (null iff appliedSystemTemplateId is null)
  appliedSystemTemplateId: string | null;
  appliedSystemTemplateName: string | null;
}
```

The `overrides` field is the **raw sparse JSON row** — it is NOT schema-filled with defaults; missing keys signal "no explicit override at this path." The Settings UI's per-field override-indicator reads this shape directly (via `hasExplicitOverride(overrides, path)`). `effective` is the merged result (system defaults + overrides + code-level schema defaults for unwritten leaves) and MUST conform to `OperationalConfig` end-to-end.

`systemDefaults` is `null` iff the org has no adopted system template (`appliedSystemTemplateId IS NULL`). Under Option A this is only possible for legacy pre-Session-1 orgs that never ran through `createFromTemplate` — new orgs always have `appliedSystemTemplateId` set (§7.2 step 1). When `systemDefaults` is `null`, the Settings UI disables the "reset to template default" button across the board (no baseline to reset to) and the provenance strip shows "Adopted template: none (legacy org)." `effective` is still a valid `OperationalConfig` in this case — it is the raw `overrides` value deep-merged with `{}`, i.e. whatever the org has explicitly written, falling back to the code-level schema defaults for any unwritten leaf.

**Type-signature note (iter-5 spec-reviewer 5.2).** The `overrides: DeepPartial<OperationalConfig> | null` type is deliberate — it replaces an earlier `OperationalConfig | null` draft that implied a fully-normalised object. Runtime schema validation on the effective-read hot path (`operationalConfigSchema.parse(deepMerge(...))` in §2.6) is **deferred to Session 2 or later** — adding `.parse()` to every effective-read is a posture change (throws on partially-invalid legacy override rows) that needs a deliberate decision + repair migration + validity gate. Session 1 keeps the existing `deepMerge(...) as OperationalConfig` cast; §10.3 notes this explicitly as a chunk-A.1 clarification.

**Override-detection contract (consistent with §6.7's option-a reset semantic):** the Settings UI derives **two** per-leaf states from the response:

- `hasExplicitOverride(path)` — `true` iff the path is **present** in `overrides` at that leaf. Presence is the audit-trail signal ("this leaf was explicitly written by someone, regardless of current value"). Used for audit displays and "this field was manually set" indicators.
- `differsFromTemplate(path)` — `true` iff the effective leaf value is not deep-equal (after schema normalisation) to the value produced by the system defaults alone (i.e. if we stripped the override row, the effective value would change). Deep-equality is required because leaves include arrays (e.g. `healthScoreFactors`) and nested objects — JS `!==` is reference equality and would mis-enable the override badge / reset button on every array or object leaf regardless of content. Implementation note: the Settings UI uses a stable deep-equal helper (`fast-deep-equal` or an equivalent already in the client bundle — audit at chunk-6 kickoff). Used for badge display ("overridden" pill) and for "reset-to-template-default" button enablement.

These are orthogonal. After a reset-to-default (option a per §10.5), `hasExplicitOverride = true` AND `differsFromTemplate = false` — the leaf has been written-through but the effective value now matches the system default, so the reset button correctly disables itself ("Already at template default") while the audit trail continues to show the explicit write. A leaf that has never been touched shows `hasExplicitOverride = false` AND `differsFromTemplate = false`.

`effective` is still a full deep-merge; it is the source-of-truth value to display in the editors. The UI computes both derived states locally from `(overrides, systemDefaults, effective)` — no additional endpoints or response fields are required.

Same auth middleware. Lives in the same route file.

### §4.6 UI renames

| From | To | Where |
|------|----|-----|
| `/system/config-templates` (route) | `/system/organisation-templates` | `client/src/App.tsx` route + `SystemCompanyTemplatesPage` renamed to `SystemOrganisationTemplatesPage` |
| "Config Templates" (nav label) | "Organisation Templates" | `client/src/components/Layout.tsx` NavItem |
| `AdminAgentTemplatesPage` (whatever label it currently uses) | "Subaccount Blueprints" | nav label + page H1 |
| Section heading "Agent templates" in any admin surface | "Subaccount Blueprints" | consistent rename across client |
| `/clientpulse/settings` (new) | "ClientPulse Settings" | new nav item under Configuration (Phase 5) |
| Any in-code reference to "config template" that means a platform-admin organisation template | "Organisation Template" | grep + rename |
| Any in-code reference to "agent template" that means a per-org subaccount blueprint | "Subaccount Blueprint" | grep + rename |

Grep scope: `client/src/**/*.{ts,tsx}` + `server/**/*.md` + `docs/**/*.md`. Server code that references the table name `hierarchy_templates` stays — we're not renaming the table, only the UI labels + the `.operationalConfig` field (per §2).

### §4.7 Housekeeping

#### Migration 0178 collision

Two migrations exist on main with the same prefix:

- `0178_clientpulse_interventions_phase_4.sql`
- `0178_skill_analyzer_execution_lock_token.sql`

Drizzle's migration runner doesn't enforce numeric-prefix uniqueness strictly, but on a fresh DB run the ordering is non-deterministic. Renumber the skill-analyzer one (it landed second per the merge order).

```bash
# NNNN = Session 1's first migration slot (resolved at chunk A.1 kickoff).
# With current main ending at 0179, NNNN=0180, so the rename target is 0184.
git mv migrations/0178_skill_analyzer_execution_lock_token.sql migrations/0184_skill_analyzer_execution_lock_token.sql
```

Verify nothing else references `0178_skill_analyzer_execution_lock_token.sql` by filename.

#### Migration numbering for Session 1

At kickoff, count the highest numbered migration. Plan:

| Session 1 migration | Purpose |
|---|---|
| `NNNN_org_operational_config_override.sql` | §2 — add + backfill the new column; rename the template column |
| `NNNN+1_rename_operator_alert.sql` | §3 — rewrite slug values + recreate partial index |
| `NNNN+2_organisations_onboarding_completed_at.sql` | §7 — onboarding gate column |
| `NNNN+3_renumber_skill_analyzer_migration.sql` | **Conditional** — only land this if the `git mv` for the 0178 skill-analyzer migration can't be done via filename alone because Drizzle meta also references the old name (check at kickoff). If the meta is clean, skip this slot entirely. |

### §4.8 Config history audit-trail stability

`config_history` rows written by Phase-4.5 use `entity_type='clientpulse_operational_config'` and `entity_id=hierarchy_template.id`. Post-§2, the target is the organisation, so:

- **Entity type change:** `clientpulse_operational_config` → `organisation_operational_config`. New rows use the new type. Creation-event rows written by §7.2 step 6 carry `snapshot_after=NULL` — history readers must treat `snapshot_after=NULL` as a creation marker meaning "no explicit overrides yet"; they must not reconstruct a point-in-time JSON snapshot unless a historical defaults snapshot is explicitly available. (The current adopted-template defaults are mutable over time, so the NULL row is a semantic marker, not a reconstruction anchor.)
- **Existing rows:** leave as-is. The entity_id still points at the (renamed) hierarchy_template row, which now stores the one-time seed. Readers that grep `clientpulse_operational_config` in history continue to find historical entries.
- **History viewer** (`docs/capabilities.md` capability `clientpulse.config.history` → generic rename `organisation.config.history`) queries both entity types for continuity.

Alternatively, migrate the historical rows to the new entity_type + id. Trade-off: cleaner audit trail vs. irreversible. **Recommendation: leave existing rows untouched; route new writes to the new type.** Audit continuity via the read-side union.

**Implementation owner for the union + entity-type whitelist:** `server/services/configHistoryService.ts` exports the `CONFIG_HISTORY_ENTITY_TYPES` set used by `server/routes/configHistory.ts` to validate inbound `entityType` query params. Today the set does not include either the legacy `clientpulse_operational_config` or the new `organisation_operational_config` (Phase-4.5 writes go to the table directly without a gate-set check). §4.8's work list therefore adds `clientpulse_operational_config` AND `organisation_operational_config` to the `CONFIG_HISTORY_ENTITY_TYPES` set, and extends the history-read route in `server/routes/configHistory.ts` to accept a special `organisation_config_all` query value that internally `OR`s both entity types so operators see a single contiguous timeline. Both files are listed in the §9.3 modify table.

### §4.9 Capability taxonomy renames

`docs/integration-reference.md` taxonomy:

| Current slug | New slug | Reason |
|---|---|---|
| `clientpulse.config.read` | `organisation.config.read` | Generic platform capability |
| `clientpulse.config.update` | `organisation.config.update` | Generic platform capability |
| `clientpulse.config.reset` | `organisation.config.reset` | Generic platform capability |
| `clientpulse.config.history` | `organisation.config.history` | Generic platform capability |

The integration block in `integration-reference.md` renames from `clientpulse-configuration` (pseudo-integration) to `organisation-configuration`. Same YAML shape, new slug. Verifier gate re-run after edit.

### §4.10 Resolutions

1. **Permission scope:** reuse `ORG_PERMISSIONS.AGENTS_EDIT` for Session 1. A dedicated `CONFIG_EDIT` permission is cleaner long-term but premature without a concrete "edit config but not agents" use case. Revisit when that use case appears.
2. **`clientpulseReports.ts` route rename:** no action. Product-specific reads stay on the `/clientpulse/` prefix — the vertical module owns them. Only genuinely cross-module concerns (the config-apply surface) move to `/api/organisation/*`.
3. **Registration ordering in `server/index.ts`:** `registerSensitivePaths` imports at the very top of the route-wiring section, before routes register. Co-located with other boot-time module init.
## §5. Phase A — Configuration Assistant popup (Option 2: embedded real agent loop)

### §5.1 What's wrong with today's popup

`client/src/components/clientpulse/ConfigAssistantChatPopup.tsx` (shipped in Phase 4.5) is mis-named. It looks like a chat surface but is actually a direct-patch form: operator types a path + value + reason, and clicks Apply. No agent loop, no plan preview, no conversational resolution. It's a UI on top of `POST /api/clientpulse/config/apply`.

This was fine as a pilot proof, but it's not the Configuration Assistant — it's a lightweight settings form. The real Configuration Assistant (conversational plan-preview-execute loop, 28 tools before this session, 29 after this session, live at `/admin/config-assistant`) does what operators actually need.

### §5.2 What Option 2 delivers

A popup-mounted version of the real Configuration Assistant. Same server-side agent loop, same tools, same plan-preview-execute flow, same session lifecycle — but in a modal that opens from any page, survives close + reopen, and surfaces background execution via a minimised pill.

### §5.3 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  <ConfigAssistantPanel>                                     │
│  — session list + active session chat + composer + actions │
│  — used by BOTH the full-page + the popup mount             │
└─────────────────────────────────────────────────────────────┘
         ↑                            ↑
┌────────────────────┐    ┌────────────────────────────────┐
│ ConfigAssistantPage│    │ ConfigAssistantPopup           │
│  — full /config-   │    │  — Modal wrapper + minimise    │
│    assistant page  │    │    pill + global trigger hooks │
│  — existing        │    │  — NEW (replaces Phase 4.5     │
│                    │    │    ConfigAssistantChatPopup)   │
└────────────────────┘    └────────────────────────────────┘
```

The chat panel becomes a reusable child. The page and the popup are thin wrappers that mount it, each owning their own chrome (nav vs modal).

### §5.4 Session lifecycle

Per locked contract (k):

- **Open popup:** resolve the Configuration Assistant agent's `agentId` once on mount, then call `GET /api/agents/<agentId>/conversations?updatedAfter=<15min-ago>&order=updated_desc&limit=1`. If a conversation returns, resume it (load messages via the existing message-read endpoint, show chat transcript). If no recent conversation, `POST /api/agents/<agentId>/conversations` (existing) to create a fresh one; if `initialPrompt` is present, then `POST /api/agents/<agentId>/conversations/<convId>/messages` (existing) to seed the initial user message. The list endpoint always scopes to the authenticated user (`req.user.id` — already the existing behaviour); no `userId` query param is added.
- **Close popup (× button):** do not cancel the conversation. Store the current conversation id in `sessionStorage` under `configAssistant.activeConversationId` + expiry timestamp.
- **Minimise (_ button):** collapse to a floating pill in the bottom-left (matches the mockup). Pill shows current step of the plan if executing; shows "chat ready" otherwise. Click pill → re-expand.
- **Reopen from any page:** hook reads `sessionStorage`; if active conversation < 15 minutes old, resume directly; else start a new conversation.
- **Execution while minimised:** the agent run lives server-side. If the plan finishes while the popup is closed, the next open shows the completed transcript. If it finishes while minimised, the pill briefly flashes + shows "✓ Complete — click to view."

Ceiling: the 15-minute window prevents stale resumption after a long idle. Configurable via a `CONVERSATION_RESUME_WINDOW_MIN` constant in the hook file.

Server-side delta owned by §5: extend the existing `GET /api/agents/:agentId/conversations` list endpoint (already in `server/routes/agents.ts`, implemented by `conversationService.listConversations`) with optional query params `updatedAfter` (ISO-8601 timestamp), `order` (one of `updated_desc` | `updated_asc` | `created_desc` | `created_asc`; default `updated_desc` — which matches current behaviour), and `limit` (positive int, capped at 50; default unchanged = return all). The scoping-to-authenticated-user filter is already enforced by the service and the route; no `userId` query param is added. This is the single server change §5 requires — no new endpoint family is introduced. The popup and the full-page Configuration Assistant share the same `/api/agents/:agentId/conversations/...` surface, which is what §5.2 locks ("same server-side agent loop, same tools, same plan-preview-execute flow, same session lifecycle").

### §5.5 Deep-link support

`?config-assistant=open&prompt=<url-encoded-string>` opens the popup on page load. If `prompt` is set and no active conversation exists, creates a fresh conversation seeded with the prompt as the first user message. If an active conversation exists, prepends the prompt to the next user input field (not auto-sent) so the operator can review before sending.

Used by:

- ClientPulse Settings page: page-level "Open Configuration Assistant" button (per §6.1). Per-block contextual deep-links ("Ask the assistant to change this" next to each editor card) are **deferred to Session 2** — see §10.7.
- Drilldown page (Session 2): "Open Config Assistant" button.
- Dashboard high-risk widget (future): context-specific prompts.

### §5.6 Global triggers

1. **Nav button** in the global sidebar (new): "🤖 Configuration Assistant" — opens the popup with no seeded prompt.
2. **⌘K palette entry** (depends on whether a command palette exists — check at kickoff; if not, skip the hotkey in Session 1 and flag as a follow-up).
3. **Contextual buttons** on settings pages / dashboards as described above.
4. **Deep-link** via URL.

### §5.7 Component contract

**`<ConfigAssistantPanel>`** — the extracted shared child.

Props:

```typescript
interface ConfigAssistantPanelProps {
  conversationId: string | null;                                   // null = fresh conversation
  initialPrompt?: string;                                          // only honoured on a fresh conversation
  onConversationReady?: (conversationId: string) => void;          // bubbles up once a conversation is created
  onPlanPreview?: (plan: PlanPreview) => void;                     // hook for the popup's minimise pill
  onPlanComplete?: (summary: PlanSummary) => void;
  compactMode?: boolean;                                           // popup: true (narrower, simpler) · page: false
}
```

**`<ConfigAssistantPopup>`** — Modal wrapper. Props:

```typescript
interface ConfigAssistantPopupProps {
  open: boolean;
  initialPrompt?: string;
  onClose: () => void;
}
```

Internal state: `{ minimised: boolean; conversationId: string | null; planState: 'idle' | 'preview' | 'executing' | 'complete' }`.

### §5.8 What to do with `ConfigAssistantChatPopup.tsx`

**Delete** (per decision in §4.2 on the legacy route). The file ships in Phase 4.5 and has one caller (the button on `ClientPulseDashboardPage.tsx`). That caller is updated to open the new popup via the shared hook.

If deletion feels too aggressive, alternative: gut the file and re-export the new popup under the old name to preserve the import path. Not recommended — creates surface confusion.

### §5.9 `useConfigAssistantPopup()` hook

**New: `client/src/hooks/useConfigAssistantPopup.ts`**

Responsibilities:
- Read/write `sessionStorage` for the active-conversation resume window (key: `configAssistant.activeConversationId`).
- Register the popup mount once at App-shell level.
- Expose `openConfigAssistant(initialPrompt?)` as a function callable from anywhere.
- Parse the `?config-assistant=open&prompt=...` deep-link on route change.

```typescript
export function useConfigAssistantPopup(): {
  open: boolean;
  openConfigAssistant: (initialPrompt?: string) => void;
  closeConfigAssistant: () => void;
};
```

Implementation detail: the hook manages a React context so `openConfigAssistant` can be called from any component tree, and the popup's open-state is a single global.

### §5.10 Files — §5 additions

| Path | Change |
|------|--------|
| `client/src/components/config-assistant/ConfigAssistantPanel.tsx` | **NEW** — extracted from `ConfigAssistantPage.tsx`. Same chat rendering, session load, composer, plan-preview-execute UX. Adds `compactMode` for popup rendering. |
| `client/src/components/config-assistant/ConfigAssistantPopup.tsx` | **NEW** — Modal wrapper + minimised pill + close/minimise buttons. Mounts `ConfigAssistantPanel`. |
| `client/src/hooks/useConfigAssistantPopup.ts` | **NEW** — trigger hook + context provider. |
| `client/src/App.tsx` | Mount the `ConfigAssistantPopup` once at shell level; wrap the tree in the context provider. |
| `client/src/pages/ConfigAssistantPage.tsx` | Refactor to mount `ConfigAssistantPanel` instead of inlining the chat. No UX change for the full-page view. |
| `client/src/components/Layout.tsx` | Add "🤖 Configuration Assistant" nav item that calls `openConfigAssistant()`. |
| `client/src/components/clientpulse/ConfigAssistantChatPopup.tsx` | **DELETE.** |
| `client/src/pages/ClientPulseDashboardPage.tsx` | Replace the local `ConfigAssistantChatPopup` state + JSX with a call to `openConfigAssistant()` from the hook. |
| `server/routes/agents.ts` | **Extend** `GET /api/agents/:agentId/conversations` with optional query params `updatedAfter` (ISO-8601 timestamp), `order` (`updated_desc` \| `updated_asc` \| `created_desc` \| `created_asc`; default `updated_desc`), `limit` (positive int, capped at 50) to support the 15-minute resume query. Auth middleware + org-scope guards unchanged. User-scoping stays implicit (`req.user.id`). Pass the parsed query params through to the service. |
| `server/services/conversationService.ts` | **Extend** `listConversations({ agentId, userId, organisationId, subaccountId?, updatedAfter?, order?, limit? })` with the matching optional filter/order/limit parameters. `updatedAfter` is an ISO-8601 timestamp mapped to `agentConversations.updatedAt >= <ts>`; `order` maps to `ORDER BY updated_at DESC / ASC` or `created_at DESC / ASC` (default `updated_desc` — matches current behaviour); `limit` applies `LIMIT <n>` (cap at 50 at the service layer too, defence-in-depth). All existing callers (which pass none of the new params) see unchanged behaviour. |

### §5.11 Risk: plan-preview UX in a narrow modal

The full-page Configuration Assistant renders the plan preview with room for a step-by-step diff. A 600px-wide popup has less real estate. Handling:

- **Preview fits:** render it inline in `compactMode` with tighter spacing.
- **Preview too big:** show a summary (step count + affected entities), with a "View full plan →" link that opens the same conversation on `/admin/config-assistant` in a new tab. Conversation state is shared; the operator can approve from either surface.

The "too big" threshold is empirical — size-check on render + flip to summary view above N steps (start with N=5, tune later).

### §5.12 Real-time + concurrency

- The popup and the full page share conversations (per §5.4). If an operator has both open against the same conversation, WebSocket updates render in both simultaneously.
- Approving a plan from either surface is idempotent at the server — `agentRun.approvePlan()` transitions `plan_pending` → `executing` once; second call returns the same result.
- Closing the popup mid-plan-preview does NOT cancel the plan. The preview is server-persistent. The operator sees it again on re-open.

### §5.13 Resolutions

1. **⌘K command palette:** audit at chunk-5 kickoff. If a palette exists, register the "Open Configuration Assistant" entry. If not, skip for Session 1 + file a follow-up ticket. Non-blocking; nav button + contextual triggers are sufficient.
2. **WebSocket re-entry on remount:** audit at chunk-5 kickoff. If `useSocket` doesn't already support rejoin-after-remount, extend it. Popup open + close + reopen against the same conversation must re-subscribe cleanly.
3. **Empty-state UX:** chips on fresh; transcript on resume. Matches the mockup; consistent with the full-page surface.
4. **Multi-tab conversations:** each tab carries its own `sessionStorage` pointer. Two tabs with the same conversation id share the server-side run and receive real-time updates — no additional dedup needed. Locked.
## §6. Phase 5 — ClientPulse Settings page + Subaccount Blueprint editor refactor

### §6.1 ClientPulse Settings — route + page

Route: `/clientpulse/settings` (client-side). Backed by `GET /api/organisation/config` for reads and `POST /api/organisation/config/apply` for writes (both added in §4).

File: `client/src/pages/ClientPulseSettingsPage.tsx` (new).

Layout matches the existing settings mockup (`tasks/clientpulse-mockup-settings.html` v2). Key elements:

- **Page header:** breadcrumb + title + subtitle + provenance strip showing where values live (`organisations.operational_config_override`) + adopted Organisation Template name.
- **Config Assistant callout:** primary button "Open Configuration Assistant" (wires to `openConfigAssistant()` from §5's hook).
- **Section cards,** one per operational_config block. Each card renders a typed editor specific to that block.

### §6.2 Section cards (typed editors)

Each card shows: block title + description, current values, per-field "overridden" indicator + "reset to template default" button, save button that calls `POST /api/organisation/config/apply` per changed path.

**Editor inventory — one per block in `OperationalConfig`:**

| Block | Editor component | Fields |
|-------|-----------------|--------|
| `healthScoreFactors` | `HealthScoreFactorsEditor` | Array of factor rows with weight slider (0.0–1.0), label, metric slug, normalisation type + bounds. Sum-validator on the client (sums to 1.0 ±0.001). |
| `churnRiskSignals` | `ChurnRiskSignalsEditor` | Array of signal rows with weight, signal slug, type enum, condition, thresholds. |
| `churnBands` | `ChurnBandsEditor` | 4 band range pickers (healthy / watch / atRisk / critical) with 0–100 sliders + overlap-check + gap-check. |
| `interventionDefaults` | `InterventionDefaultsEditor` | Numeric inputs: cooldownHours, cooldownScope enum, defaultGateLevel enum, maxProposalsPerDayPerSubaccount, maxProposalsPerDayPerOrg. |
| `interventionTemplates` | `InterventionTemplatesJsonEditor` | **Session 1 ships a JSON editor with schema validation + side-by-side schema reference panel.** Typed per-field editor (slug / label / gateLevel / actionType / targets multi-select / priority / measurementWindowHours / payloadDefaults / defaultReason) is deferred to Session 2 (Phase 8 — "intervention template editor"). The JSON editor still writes through the same save flow + validation + audit. Reason: the typed editor is the most complex in the inventory; building it in Session 1 risks scope creep on the foundation sprint when the other 9 editors unblock the bulk of operator value already. |
| `alertLimits` | `AlertLimitsEditor` | maxAlertsPerRun, maxAlertsPerAccountPerDay, batchLowPriority toggle. |
| `staffActivity` | `StaffActivityEditor` | countedMutationTypes array, excludedUserKinds multi-select, automationUserResolution (strategy enum + threshold + cacheMonths), lookbackWindowsDays, churnFlagThresholds. |
| `integrationFingerprints` | `IntegrationFingerprintsEditor` | seedLibrary read-only list + scanFingerprintTypes multi-select + unclassifiedSignalPromotion thresholds. |
| `dataRetention` | `DataRetentionEditor` | Per-resource retention days (nullable = unlimited): metricHistoryDays, healthSnapshotDays, anomalyEventDays, orgMemoryDays, syncAuditLogDays, canonicalEntityDays. |
| `onboardingMilestones` | `OnboardingMilestonesEditor` | Array of milestone rows: slug + label + targetDays + signal. |

Each editor is a self-contained component in `client/src/components/clientpulse-settings/`. Shared primitives (reset-to-default pill, override badge, save bar) live in `.../shared/`.

### §6.3 Save flow

- Editors track their dirty state locally.
- Save button on each card dispatches one POST per changed leaf path. Example: changing two weight values in `healthScoreFactors` sends two separate POSTs (or a single POST for the full `healthScoreFactors` array, which replaces wholesale). Default behaviour: **replace-wholesale on array roots, per-leaf on scalar leaves.** The editor decides based on the block type.
- Response handling:
  - `{ committed: true }` → toast "Saved · history v<n>", clear dirty state, refresh the provenance strip.
  - `{ committed: false, requiresApproval: true, actionId }` → toast "Sent to review queue · Action <id>" with a link to the review queue; keep dirty state highlighted until the action resolves (optional — can just clear optimistically).
  - Error → inline banner above the card, save button re-enabled.

### §6.4 "Reset to template default" affordance

Per-field button. Enablement + behaviour are driven by the §4.5 derived states:

- **Button enabled when `differsFromTemplate(path) === true`** (effective value differs from system default). On click: POST a save with `value: <the-system-default-value>`. The save is option (a) from §10.5 — it writes the system default as an explicit override. After the save, `hasExplicitOverride` stays `true` (the write is audited), but `differsFromTemplate` flips to `false`, which disables the button with the tooltip "Already at template default."
- **Button disabled when `differsFromTemplate(path) === false`**, regardless of `hasExplicitOverride`. Tooltip: "Already at template default." This is the terminal state whether the field was never touched or was reset via this button.
- The "overridden" badge next to the indicator shows when `differsFromTemplate === true`. A separate "manually set" micro-indicator (optional UX polish — ship in Session 1 if trivial, defer otherwise) shows `hasExplicitOverride === true && differsFromTemplate === false` for audit transparency.

UX: small "reset" icon button next to the override indicator (matches existing settings mockup).

### §6.5 Subaccount Blueprint editor refactor

The existing `AdminAgentTemplatesPage` (exact label TBD — audit at kickoff) handles CRUD on `hierarchy_templates`. After §2 renames `operational_config → operational_config_seed`, the editor needs to stop exposing those fields because:

1. They're no longer the runtime source.
2. Exposing them here creates the split-brain confusion we're cleaning up.

Changes:

- **Read-only display of the "seed" block** as an informational preview: "This is the operational-config snapshot captured when this blueprint was adopted from the system template. It is informational only — new subaccounts created under this blueprint inherit the org's effective operational config (via `orgConfigService.getOperationalConfig(orgId)`), not this snapshot. Change the live config in ClientPulse Settings."
- **Remove the edit controls** for operational defaults. The blueprint editor controls only:
  - Blueprint name + description
  - Agent hierarchy (which agents get linked, what roles, what skills, what schedules)
  - Default-for-subaccount toggle
  - Delete / archive
- **Rename the page** to "Subaccount Blueprints" + route to `/agents/blueprints` (per the new mockup).
- Nav label updated (per §4.6).

### §6.6 Page mount + nav wiring

`client/src/App.tsx`:

```tsx
<Route path="/clientpulse/settings" element={<ClientPulseSettingsPage user={user!} />} />
<Route path="/agents/blueprints" element={<SubaccountBlueprintsPage user={user!} />} />
```

`client/src/components/Layout.tsx` — nav items (org-admin scope):

- "ClientPulse Settings" → `/clientpulse/settings`
- "Subaccount Blueprints" → `/agents/blueprints`

Add the "Configuration" sidebar section group if it doesn't exist; both items live there.

### §6.7 Resolutions

1. **Reset-to-default semantic:** option (a) — write the system-default value as an explicit override. Idempotent, always-writeable, clean history. Override row size is not a concern at steady-state. No new unset endpoint.
2. **Validation posture:** client-side AND server-side. Client fails fast; server is the system-of-record. Never skip server-side validation.
3. **Permission scope:** `ORG_PERMISSIONS.AGENTS_EDIT` is sufficient for Session 1 (same as the config-apply route). Future split flagged in §4.10.
4. **Typed intervention template editor:** deferred to Session 2 Phase 8 per §6.2's `InterventionTemplatesJsonEditor` call-out. Session 1 ships the JSON editor with schema validation; operators can still author and edit templates, just via JSON.
## §7. Phase 7 — Operator onboarding wizard

Two user journeys:

- **System-admin flow:** creating a new organisation, selecting an Organisation Template, sending the invite.
- **Org-admin flow:** first sign-in after invite, GHL OAuth soft-gate, workspace orientation.

Both flows referenced in the mockups (`tasks/clientpulse-mockup-onboarding-sysadmin.html` + `-orgadmin.html`).

### §7.1 System-admin — "Create organisation" modal

Extends the existing `SystemOrganisationsPage.tsx` create-org surface.

**Current state:** assume a basic "create organisation" modal with name + slug fields (audit at kickoff).

**Target state (per mockup):** card-based picker for Organisation Template, tier toggle (Monitor / Operate / internal), live preview pane showing what the org will look like.

Key behaviour:

- **Template picker cards:** each card shows template name, short description, included agents count, operational defaults summary, required integrations. Populated from `GET /api/system/organisation-templates` (existing endpoint — maps to what was `system_hierarchy_templates`).
- **Tier toggle:** radio group. Determines which module access the new org gets. Consumed by subscription logic (out of scope for Session 1; just set the value, D6 wires it to billing later).
- **Live preview:** right-hand pane updates as the template is selected. Shows: "You'll create <Org Name> with <Template Name> · <N> agents will be seeded · <M> subaccount blueprints available · Operational defaults: inherited from the template (no org-specific overrides until the operator edits settings)."
- **Confirm button** creates the organisation, seeds the default subaccount blueprint from the template, links the new org to the template via `applied_system_template_id` (the override column stays `NULL` until first edit), creates the org-admin user + invite email.

### §7.2 System-admin — what the "create" action does server-side

**New service method: `organisationService.createFromTemplate({ name, slug, systemTemplateId, tier, orgAdminEmail })`**

Steps (all in one transaction):

1. INSERT the `organisations` row with `applied_system_template_id = systemTemplateId`.
2. Leave `organisations.operational_config_override` as `NULL`. The effective config for the new org is provided by `systemHierarchyTemplates.operational_defaults` deep-merged with `NULL`, which resolves to the platform's current defaults. Any subsequent edit via the Settings page or Configuration Assistant writes the first entry into the override column, initialising the row; before that the org inherits every platform-level default change automatically.
3. Create a `hierarchy_templates` row (the default Subaccount Blueprint) sourced from the system template — sets `isDefaultForSubaccount=true` and copies the agent hierarchy structure. The `operational_config_seed` field is populated from `systemHierarchyTemplates.operational_defaults` as a one-time informational snapshot (not read by any runtime path — subaccounts under this blueprint inherit the org's effective operational config via `orgConfigService.getOperationalConfig(orgId)`, which resolves to the live deep-merge and respects future platform-default changes per §2.2).
4. Seed any system agents declared by the template (e.g. `portfolio-health-agent` linked to the new org).
5. Create the org-admin user row + invite email.
6. Write a `config_history` row marking the creation event: `entity_type='organisation_operational_config'`, `entity_id=<new organisation id>`, `change_source='system_sync'`, `change_summary='Organisation created from template <template-slug>'`, `snapshot_after=NULL` (representing "no explicit overrides yet — effective config is the adopted template's current defaults"). This is an audit-trail marker for the creation event, not a config-change record; the `snapshot_after=NULL` value is the signal that no override write has happened.

Return the new `organisationId` for the modal to display success + a link.

### §7.3 Org-admin — first-run wizard (4 screens)

Route: `/onboarding` (client-side, auto-redirects after first sign-in until the wizard is marked complete).

Gate logic: a new `organisations.onboarding_completed_at: timestamp nullable` column. Null → wizard shown; set → wizard skipped.

`onboarding_completed_at` is the sole gate for "should the wizard auto-open?" — the existing derivation fields (`ghlConnected`, `agentsProvisioned`, `firstRunComplete`) exposed by `onboardingService.getOnboardingStatus` remain part of the response shape and continue to drive the sync-progress screen and the dashboard's empty-state messages, but they do NOT gate wizard display. The derivation and the gate are orthogonal: an org can be `onboarding_completed_at = <timestamp>` (wizard dismissed) while `ghlConnected = false` (GHL skipped during the wizard), and the dashboard will correctly show the "connect GHL" empty state even though the wizard is permanently dismissed. Extending — not replacing — the existing service is the contract.

**Screen 1 — Welcome.** Branded, explains what ClientPulse monitors + hints at the next 2 steps. Primary button "Next."

**Screen 2 — Connect GoHighLevel.** OAuth soft-gate per `tasks/clientpulse-mockup-onboarding-orgadmin.html`. Two buttons: "Connect GHL" (kicks off OAuth) or "Skip for now" (workspace usable, ClientPulse data empty state until connected). Both advance to screen 3.

**Screen 3 — Configure key defaults.** One impactful override, surfacing the churn-band cutoffs for immediate operator adjustment; other tuning happens in ClientPulse Settings post-onboarding.

- Churn-band cutoffs: collapsed summary view showing "Healthy 75–100 · Watch 51–74 · At-risk 26–50 · Critical 0–25" with a "Adjust thresholds" link that opens the ClientPulse Settings page inline (or defers). Sensitive path — the Save on the expanded editor queues the change via the standard review-queue flow; wizard continues either way.

Previous draft surfaced two additional controls on this screen (Scan frequency + Alert cadence). Per iter-5 spec-reviewer directional 5.1, both are dropped from Session 1 — neither was threaded through §6.2's editor inventory, §4's schema, or §9's file work. Adding them would be material scope creep; removing them is the smallest reversible call. Operators tune both post-onboarding via ClientPulse Settings.

On Next, **only fields the operator actually changed on screen 3 are POSTed** via `POST /api/organisation/config/apply` — one POST per dirty leaf path. Advancing without editing anything performs no config write and leaves `organisations.operational_config_override` `NULL`, preserving the Option A "override row is initialised by the first explicit edit" contract (§7.2 step 2, §10.1). Non-sensitive paths commit immediately; sensitive paths queue but the wizard continues — user re-visits the review queue later. Each successful or queued Screen-3 POST produces the normal `config_history` row via the standard `/api/organisation/config/apply` write path (entity_type `organisation_operational_config`, non-NULL `snapshot_after`); if the operator changes nothing, the only history entry remains the §7.2 step-6 creation marker with `snapshot_after=NULL`.

**Screen 4 — You're ready.** Summary card showing: org name, adopted template, GHL connection status, next scan ETA. Link to dashboard. Marks `onboarding_completed_at`.

### §7.4 Routes + pages

| Route | Page | Purpose |
|-------|------|---------|
| `/onboarding` (client) | `OnboardingWizardPage.tsx` | 4-screen wizard + state machine |
| `POST /api/onboarding/complete` (server) | `onboardingRoutes.ts` | Mark `organisations.onboarding_completed_at` |
| `GET /api/onboarding/status` (server) | Same | Returns `{ needsOnboarding: boolean, ghlConnected: boolean, agentsProvisioned: boolean, firstRunComplete: boolean }` — `needsOnboarding = (organisations.onboarding_completed_at IS NULL)` is the new field consumed by the wizard redirect; the remaining three fields carry through from the existing `onboardingService.getOnboardingStatus` derivation unchanged and continue to drive the sync-progress screen + dashboard empty states |

The redirect logic sits in `App.tsx` / a top-level effect: on first render, fetch `GET /api/onboarding/status`; if `needsOnboarding=true`, `navigate('/onboarding')` unless already there. The other three fields in the response are ignored by the redirect but consumed by other surfaces (sync-progress screen, dashboard empty states) against the same endpoint.

**Auth contract.** Both endpoints use the existing authenticated onboarding middleware chain (`authenticate` first, then the org-scoped resolver that sets `req.orgId`). `POST /api/onboarding/complete` requires the same org-admin eligibility as the wizard entry path — it mutates `organisations.onboarding_completed_at` so it must not be callable anonymously or from cross-org contexts. `GET /api/onboarding/status` is org-scoped read-only; same auth chain.

### §7.5 Migration

**Migration `NNNN_organisations_onboarding_completed_at.sql`:**

```sql
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamp with time zone;

-- Backfill: every existing org is marked onboarded by default. These orgs pre-date
-- the wizard and have already completed onboarding through the old flow. The
-- derivation fields (ghlConnected, agentsProvisioned, firstRunComplete) exposed
-- by onboardingService.getOnboardingStatus are independent of this column and
-- continue to reflect live DB state on every call.
UPDATE organisations
SET onboarding_completed_at = created_at
WHERE onboarding_completed_at IS NULL;
```

### §7.6 Wiring to Phase A naming

Every label in both flows uses the new terminology:

- System-admin modal: "Organisation Template" (not "Config Template")
- Org-admin screen 1: mentions "ClientPulse Settings" as the place to fine-tune later
- Org-admin nav after completion: "Subaccount Blueprints" (not "Agent Templates")

Screenshots of each screen go into the verification checklist (§8).

### §7.7 Resolutions

1. **Template-switch post-create:** not exposed. Out of scope for Session 1. If needed later, it's a separate flow (config-reset + agent hierarchy re-seed).
2. **GHL OAuth redirect flow:** reuse the existing OAuth pattern. Audit at chunk-7 kickoff to identify the canonical helper + callback path. Non-blocking; every route currently using OAuth follows the same pattern.
3. **Welcome email:** reuse existing invite email infrastructure; add one sentence mentioning the onboarding wizard in the email body. No new template.
4. **Subscription tier display:** same content regardless of tier. D6 retrofits tier-aware copy later. Locked.
## §8. Work sequence, chunks, ship-gate tests, and review gates

### §8.1 Chunk sequence (8 chunks, serialised)

1. **Architect pass.** Produce `tasks/builds/clientpulse/session-1-plan.md` appended as §§1–8 with chunk-level file inventories, test lists, and pseudocode for the interesting bits. (Spec-reviewer optional; see §8.5.)
2. **A.1 — Data model + core renames.** New migrations (org override column + seed rename + operator_alert slug rewrite + onboarding_completed_at). Schema + type updates. Pure tests for `getOperationalConfig` read chain + `resolveActionSlug` alias resolver. Carry-over pure tests consuming slug literals (`clientPulseInterventionProposerPure`, `clientPulseInterventionPrimitivesPure`, `interventionActionMetadataPure`, `interventionIdempotencyKeysPure`, `measureInterventionOutcomeJobPure`) migrated with updated `notify_operator` literals in the same chunk so the A.1 pure-test sanity gate stays green. One commit.
3. **A.2 — Config service refactor.** Rename `configUpdateHierarchyTemplate{Service,Pure}` → `configUpdateOrganisation{Service,Pure}`. Retarget the service at `organisations.operational_config_override`. Sensitive-paths registry + bootstrap registration. File rename `configUpdateHierarchyTemplatePure.test.ts → configUpdateOrganisationConfigPure.test.ts` (all 18 cases carry unchanged). One commit.
4. **A.3 — Generic route + UI renames.** New `server/routes/organisationConfig.ts` + `GET /api/organisation/config`. Retire `clientpulseConfig.ts`. UI renames (route, nav labels, page titles) across `client/src/`. One commit.
5. **A.4 — Configuration Assistant popup.** Extract `<ConfigAssistantPanel>`, build `<ConfigAssistantPopup>` + `useConfigAssistantPopup` hook, mount at App shell, retire the Phase-4.5 popup, wire global trigger + contextual triggers. Manual smoke test in browser per CLAUDE.md UI rule. One commit.
6. **Phase 5 — ClientPulse Settings page + blueprint editor refactor.** 9 typed editors (healthScoreFactors, churnRiskSignals, churnBands, interventionDefaults, alertLimits, staffActivity, integrationFingerprints, dataRetention, onboardingMilestones) + `InterventionTemplatesJsonEditor` (Session 1 ships JSON; typed Intervention Templates editor deferred to Session 2 per §6.2 / §10.5), save flow, reset-to-default affordance, provenance strip. Subaccount Blueprint editor field removal. One commit.
7. **Phase 7 — Onboarding wizard + create-org modal.** System-admin create-org modal rebuild, org-admin 4-screen wizard, redirect logic, completion endpoint. Manual happy-path + skip-GHL-OAuth verification. One commit.
8. **pr-reviewer pass + housekeeping.** Run `pr-reviewer` on the combined diff. Fix blocking findings. Renumber the skill-analyzer migration if not already done in A.1. Final commit if there are fixes. Open PR.

Each chunk leaves the system in a runnable state. Chunk 5–7 depend on 2–4 landing cleanly; reviewers should merge the earlier chunks even if later ones need rework.

### §8.2 Ship-gate tests (automated where possible)

Per-gate automation:

| Gate | Test type | Location |
|------|-----------|----------|
| S1-A1 (data-model separation) | Pure test + integration test | `server/services/__tests__/orgOperationalConfigMigrationPure.test.ts` (pure) + `server/services/__tests__/configUpdateOrganisationService.test.ts` (integration — hits DB fixture) |
| S1-A2 (slug rename) | Pure test | `server/config/__tests__/actionSlugAliasesPure.test.ts` — assert every legacy slug resolves to a registered slug |
| S1-A3 (sensitive-paths registry) | Pure test | `server/config/__tests__/sensitiveConfigPathsRegistryPure.test.ts` — register synthetic module paths + assert `isSensitiveConfigPath` recognises them |
| S1-A4 (generic route) | Integration | `server/routes/__tests__/organisationConfig.test.ts` — POST with valid/invalid paths, verify classification + response shape |
| S1-A5 (popup lifecycle) | Manual browser test | Documented in `tasks/builds/clientpulse/session-1-verification.md` (new file) |
| S1-5.1 (Settings page) | Manual | Verified in `tasks/builds/clientpulse/session-1-verification.md`. No frontend unit tests in Session 1 per the repo's testing posture (static gates + server-side pure tests only); typecheck + lint + `npm run build` are the static gates for the client-side surface. |
| S1-5.2 (blueprint editor refactor) | Manual | Verified in verification doc |
| S1-7.1 (new terminology in flows) | Manual | Screenshot-based in verification doc |
| S1-7.2 (OAuth soft-gate) | Manual | Verified in verification doc |

### §8.3 Pure test plan (carry-over + new)

Existing pure tests that must be updated with new literals/slugs:

- `mergeFieldResolverPure.test.ts` (24 cases) — no changes expected; resolver is slug-agnostic.
- `clientPulseInterventionProposerPure.test.ts` (14 cases) — update literals referencing `clientpulse.operator_alert`.
- `configUpdateHierarchyTemplatePure.test.ts` (18 cases) — **rename the file** to `configUpdateOrganisationConfigPure.test.ts` to match the renamed module (§2.5 + §9.1); update imports; all 18 cases carry unchanged.
- `clientPulseInterventionPrimitivesPure.test.ts` (23 cases) — update literals.
- `interventionActionMetadataPure.test.ts` (9 cases) — update literals.
- `interventionIdempotencyKeysPure.test.ts` (14 cases) — update literals (consumes the `InterventionActionTypeName` union that §3.5 renames).
- `measureInterventionOutcomeJobPure.test.ts` (11 cases) — update literals.

New pure tests introduced by Session 1:

- `actionSlugAliasesPure.test.ts` — new, ~6 cases.
- `sensitiveConfigPathsRegistryPure.test.ts` — new, ~8 cases.
- `orgOperationalConfigMigrationPure.test.ts` — new, ~6 cases exercising the read-chain helper (pure decode of `{ systemDefaults, overrides } → effective`).

New integration tests introduced by Session 1 (DB-fixture-backed, not pure):

- `configUpdateOrganisationService.test.ts` — S1-A1 ship-gate integration test; hits a DB fixture to assert the migration + service targets `organisations.operational_config_override`.
- `organisationConfig.test.ts` — S1-A4 route integration test; POST valid/invalid paths, verify classification + response shape.
- `organisationServiceCreateFromTemplate.test.ts` — §7.2 sysadmin service test; asserts `createFromTemplate` leaves `operational_config_override` `NULL` while seeding `appliedSystemTemplateId` + default blueprint correctly (Option A lifecycle per §7.2 / §10.1).

**Target post-Session-1:** 137 pure tests across ClientPulse (113 today + 24 new / carried). Zero regressions on the 43-error server typecheck baseline.

### §8.4 Manual verification checklist

New file: `tasks/builds/clientpulse/session-1-verification.md`. Per CLAUDE.md UI rule — start `npm run dev`, exercise each flow, record outcomes. Required checks:

1. **Migration safety.** Run migrations against a fresh DB (check schema only). Run against a local DB with pre-merge data (check backfill). Run rollback (check nothing lost).
2. **Popup lifecycle.** Open popup from nav → send a prompt → get plan preview → minimise → pill shows → reopen → plan still there → approve → execution progresses → close popup mid-execute → reopen → see completed transcript.
3. **Settings page CRUD.** Per block: edit, save, verify `config_history` row, refresh page, verify value persisted. Test both non-sensitive (direct commit) and sensitive (review-queue routing) paths. Test reset-to-default.
4. **Subaccount Blueprint editor.** Open the page, verify no **editable** operational-config fields visible (the §6.5 read-only seed preview is expected). Verify creating a new subaccount from the default blueprint still works end-to-end (agent hierarchy seeded correctly).
5. **Onboarding — sysadmin.** Create a test org via the modal. Verify: org created, default blueprint seeded, operational config override stays NULL (org inherits the template's defaults via the applied-system-template FK), invite email queued.
6. **Onboarding — org-admin.** Sign in as the new org-admin. Verify: wizard auto-opens, 4 screens navigable, GHL skip path works, completion marks `onboarding_completed_at`, subsequent sign-ins skip the wizard.
7. **Config Assistant vs Settings parity.** Change `alertLimits.maxAlertsPerRun` via the Settings page + via the chat popup. Verify both land in `organisations.operational_config_override`. Verify both appear in `config_history` with correct `change_source`.

### §8.5 Review gates

- **After Chunk 1 (architect pass):** optional `spec-reviewer` run on `session-1-plan.md`. Only if the user explicitly asks and Codex CLI is local. Do NOT auto-invoke.
- **After Chunk 4 (before moving to Phase 5):** architect review-pass on the Phase A surface alone. Cheap sanity check that the data-model + renames + route landed coherently.
- **After Chunk 7 (before PR open):** full `pr-reviewer` pass on the combined Session 1 diff. All findings triaged before PR open. Non-blocking findings can ship as follow-ups; blocking findings fix before PR.
- **Before merge:** final `pr-reviewer` re-run if fix commits landed. Repeat until clean.
- **`dual-reviewer`:** only if user explicitly requests AND session is local. Never auto-invoke.

### §8.6 Sanity gates between chunks

Run after every chunk:

- `npx tsc --noEmit -p server/tsconfig.json` — zero new errors vs the 43-error baseline.
- `npx tsc --noEmit -p client/tsconfig.json` — zero new errors vs the 10-error baseline.
- Relevant `npx tsx server/.../*Pure.test.ts` — all pass.
- `npm run lint` on touched files.
- `node scripts/verify-integration-reference.mjs` — zero blocking errors after Chunk 4 (doc touches).

### §8.7 Migration strategy for in-flight concerns

- **Existing `actions` rows with legacy slug:** rewritten in Chunk 1's migration. Defensive alias resolution in the registry covers any in-flight cache.
- **Existing operator sessions holding the retired `/api/clientpulse/config/apply` URL:** accept 404 on resubmit post-deploy. Document in the release note.
- **Existing `config_history` rows with old `entity_type`:** leave as-is per §4.8. Readers union over both types.
- **Existing Paperclip-imported `hierarchy_templates` rows with `operational_config` data:** backfill copies to `organisations.operational_config_override` in the migration. Source field renamed to `operational_config_seed`.

### §8.8 Rollback plan

If Session 1 needs to be rolled back post-deploy:

- Migrations are reversible (`_down/` pairs written for the new migrations; the pre-migration snapshot of `operational_config_override` is restore-able from the renamed `operational_config_seed` column).
- Route retirement of `/api/clientpulse/config/apply` is reversible by re-exporting the old file (kept in git history).
- UI renames are cosmetic — reversible via `git revert`.
- Popup refactor: reverting restores the old `ConfigAssistantChatPopup` from git.

**Data-loss caveat (pre-production framing).** Any writes that land in `organisations.operational_config_override` **after** the forward migration completes are not mirrored back into `hierarchy_templates.operational_config_seed`; a straight `_down` that drops the override column would drop those writes. This is acceptable under the current framing (`live_users: no`, `rollout_model: commit_and_revert` per `docs/spec-context.md`) — dev-environment data is disposable during the rollback window. If Session 1 ships past the first live-user milestone, add a `_down` step that copies each org's `operational_config_override` back into the resolved `hierarchy_templates` row before dropping the column. Until then: **no data-loss risk within the pre-production envelope. Downgrade window: 1 release cycle.**
## §9. File inventory

### §9.1 Files to create (server)

| Path | Purpose |
|------|---------|
| `migrations/NNNN_org_operational_config_override.sql` | §2 data-model migration (+ rollback in `_down/`) |
| `migrations/NNNN+1_rename_operator_alert.sql` | §3 slug rewrite + index rebuild |
| `migrations/NNNN+2_organisations_onboarding_completed_at.sql` | §7 onboarding gate column |
| `server/config/sensitiveConfigPathsRegistry.ts` | §3.6 composable registry |
| `server/modules/clientpulse/registerSensitivePaths.ts` | §3.6 ClientPulse's registration |
| `server/services/configUpdateOrganisationService.ts` | §2 replaces `configUpdateHierarchyTemplateService.ts` |
| `server/services/configUpdateOrganisationConfigPure.ts` | §2 replaces `configUpdateHierarchyTemplatePure.ts` |
| `server/routes/organisationConfig.ts` | §4 generic config-apply + GET reads |
| `server/skills/config_update_organisation_config.md` | §2 renamed skill definition |
| `server/services/__tests__/configUpdateOrganisationConfigPure.test.ts` | §2 renamed test file (18 cases carried over) |
| `server/config/__tests__/actionSlugAliasesPure.test.ts` | §3 alias resolver tests (NEW) |
| `server/config/__tests__/sensitiveConfigPathsRegistryPure.test.ts` | §3 registry tests (NEW) |
| `server/services/__tests__/orgOperationalConfigMigrationPure.test.ts` | §2 read-chain test (NEW) |
| `server/services/__tests__/configUpdateOrganisationService.test.ts` | §4 integration test (S1-A1 ship gate, hits DB fixture) |
| `server/routes/__tests__/organisationConfig.test.ts` | §4 route integration test |
| `server/services/__tests__/organisationServiceCreateFromTemplate.test.ts` | §7.2 sysadmin service test |

### §9.2 Files to create (client)

| Path | Purpose |
|------|---------|
| `client/src/components/config-assistant/ConfigAssistantPanel.tsx` | §5 extracted shared chat panel |
| `client/src/components/config-assistant/ConfigAssistantPopup.tsx` | §5 popup + minimise pill |
| `client/src/hooks/useConfigAssistantPopup.ts` | §5 trigger hook |
| `client/src/pages/ClientPulseSettingsPage.tsx` | §6 Settings page |
| `client/src/components/clientpulse-settings/HealthScoreFactorsEditor.tsx` | §6 per-block editor |
| `client/src/components/clientpulse-settings/ChurnRiskSignalsEditor.tsx` | §6 per-block editor |
| `client/src/components/clientpulse-settings/ChurnBandsEditor.tsx` | §6 per-block editor |
| `client/src/components/clientpulse-settings/InterventionDefaultsEditor.tsx` | §6 per-block editor |
| `client/src/components/clientpulse-settings/AlertLimitsEditor.tsx` | §6 per-block editor |
| `client/src/components/clientpulse-settings/StaffActivityEditor.tsx` | §6 per-block editor |
| `client/src/components/clientpulse-settings/IntegrationFingerprintsEditor.tsx` | §6 per-block editor |
| `client/src/components/clientpulse-settings/DataRetentionEditor.tsx` | §6 per-block editor |
| `client/src/components/clientpulse-settings/OnboardingMilestonesEditor.tsx` | §6 per-block editor |
| `client/src/components/clientpulse-settings/InterventionTemplatesJsonEditor.tsx` | §6 — JSON editor with schema-validation preview (Session 1). Typed editor lands in Session 2 Phase 8. |
| `client/src/components/clientpulse-settings/shared/*` | §6 reset pill / override badge / save bar |
| `client/src/components/onboarding/*` | §7 per-screen components (new — wizard-screen child components) |

### §9.3 Files to modify (server)

| Path | Change |
|------|--------|
| `server/db/schema/organisations.ts` | Add `operationalConfigOverride` + `onboardingCompletedAt` + `appliedSystemTemplateId` fields |
| `server/db/schema/hierarchyTemplates.ts` | Rename `operationalConfig` → `operationalConfigSeed` |
| `server/services/orgConfigService.ts` | Read chain swap (§2.6) |
| `server/services/operationalConfigSchema.ts` | `SENSITIVE_CONFIG_PATHS` replaced with `getSensitiveConfigPaths()` function-backed alias delegating to the registry; `isSensitiveConfigPath` delegates to registry; every in-repo import migrated off the array export in the same chunk |
| `server/config/actionRegistry.ts` | Slug rename + `ACTION_SLUG_ALIASES` + `resolveActionSlug` |
| `server/services/skillExecutor.ts` | Case rename + alias-aware dispatch |
| `server/services/interventionActionMetadata.ts` | `INTERVENTION_ACTION_TYPES` tuple entry renamed |
| `server/services/clientPulseInterventionContextService.ts` | Zod enum + literal renames; remove `resolveDefaultHierarchyTemplateId` |
| `server/jobs/proposeClientPulseInterventionsJob.ts` | Literal rename |
| `server/jobs/measureInterventionOutcomeJob.ts` | SQL literal rename |
| `server/jobs/measureInterventionOutcomeJobPure.ts` | Operator-alert branch literal rename |
| `server/routes/clientpulseInterventions.ts` | Zod enum rename |
| `server/index.ts` | Import `registerSensitivePaths` at boot; register new routes; retire old route |
| `server/services/organisationService.ts` | Add new method `createFromTemplate` per §7.2 (existing file — current exports: `listOrganisations`, `createOrganisation`, etc., preserved unchanged) |
| `server/services/configHistoryService.ts` | Add `clientpulse_operational_config` AND `organisation_operational_config` to the `CONFIG_HISTORY_ENTITY_TYPES` set per §4.8 (both legacy + new entity types must pass the gate-set check — legacy stays for historical continuity, new carries forward writes). No other service changes. |
| `server/routes/configHistory.ts` | Accept a `organisation_config_all` special value in the entity-type query param that internally `OR`s `clientpulse_operational_config` + `organisation_operational_config` per §4.8. Preserves explicit-type querying for any caller that passes either literal slug directly. |
| `server/services/onboardingService.ts` | Extend `getOnboardingStatus(orgId)` return shape to `{ needsOnboarding, ghlConnected, agentsProvisioned, firstRunComplete }` where `needsOnboarding = (organisations.onboarding_completed_at IS NULL)`. Existing derivation logic for `ghlConnected`, `agentsProvisioned`, `firstRunComplete` is preserved unchanged. `getSyncStatus` + all other methods on the service unchanged. This is an extend-not-replace contract per §7.3/§7.4 (HITL-resolved iteration 1) |
| `server/routes/onboarding.ts` | Extend with new endpoints: `GET /api/onboarding/status` return-shape extended to include `needsOnboarding: boolean`; `POST /api/onboarding/complete` added. Existing endpoints (`/api/onboarding/sync-status`, `/api/onboarding/confirm-locations`, `/api/onboarding/notify-on-complete`) unchanged |
| `server/routes/agents.ts` | Extend `GET /api/agents/:agentId/conversations` with optional query params `updatedAfter`, `order` (`updated_desc` \| `updated_asc` \| `created_desc` \| `created_asc`; default `updated_desc`), `limit` (cap 50) to support the Configuration Assistant popup's 15-minute resume query per §5.4. User-scoping stays implicit (`req.user.id`). |
| `server/services/conversationService.ts` | Extend `listConversations(...)` with matching `updatedAfter` / `order` / `limit` optional parameters per §5.10; translates them into Drizzle `where`/`orderBy`/`limit`. Existing call sites are unchanged. |
| `server/services/clientPulseInterventionIdempotencyPure.ts` | Rename `clientpulse.operator_alert` → `notify_operator` in the `InterventionActionTypeName` union (hard-coded literal; consumed by both operator and scenario-detector idempotency-key builders) |
| `server/skills/clientPulseOperatorAlertServicePure.ts` | Rename `clientpulse.operator_alert` → `notify_operator` in the idempotency-key builder literal + the JSDoc header. |
| All ClientPulse pure tests (7 files) | Literal renames |
| Any webhook handler that accepts an inbound `action_type` field | Normalise via `resolveActionSlug` on the way in (defensive, even if current audit shows no callers use the legacy slug) |

### §9.4 Files to modify (client)

| Path | Change |
|------|--------|
| `client/src/App.tsx` | New routes (`/clientpulse/settings`, `/agents/blueprints`, `/onboarding`); mount `ConfigAssistantPopup` at shell level; onboarding redirect logic |
| `client/src/components/Layout.tsx` | Nav renames + new nav items |
| `client/src/pages/ConfigAssistantPage.tsx` | Refactor to mount `ConfigAssistantPanel` |
| `client/src/pages/SystemCompanyTemplatesPage.tsx` | Rename to `SystemOrganisationTemplatesPage.tsx` + update copy |
| `client/src/pages/AdminAgentTemplatesPage.tsx` (exact name TBD) | Rename to `SubaccountBlueprintsPage.tsx`; remove operational-config fields |
| `client/src/pages/SystemOrganisationsPage.tsx` | Rebuild "Create organisation" modal per §7.1 |
| `client/src/pages/ClientPulseDashboardPage.tsx` | Remove local `ConfigAssistantChatPopup`; use `openConfigAssistant()` hook |
| `client/src/pages/OnboardingWizardPage.tsx` | Existing wizard page rebuilt per §7.3 4-screen flow (current file's structure replaced; route entry in `App.tsx` retained) |
| `client/src/components/clientpulse/ConfigAssistantChatPopup.tsx` | **DELETE** |
| 5 editor components in `client/src/components/clientpulse/` | Rename `clientpulse.operator_alert` literal → `notify_operator` (OperatorAlertEditor + ProposeInterventionModal) |

### §9.5 Documentation + tracker files

| Path | Change |
|------|--------|
| `architecture.md` | Update intervention-pipeline section (operator_alert rename + org-level config source) + Configuration Assistant section (tool rename + popup change) |
| `docs/capabilities.md` | Changelog entry + update customer-facing Configuration Assistant bullets |
| `docs/integration-reference.md` | Rename taxonomy slugs + pseudo-integration block |
| `docs/configuration-assistant-spec.md` | Tool #29 renamed; target org not template |
| `docs/orchestrator-capability-routing-spec.md` | Rename routing-hint capability slugs |
| `CLAUDE.md` | Update key-files-per-domain; update Current focus pointer |
| `tasks/builds/clientpulse/progress.md` | Session 1 entry |
| `tasks/builds/clientpulse/session-1-plan.md` | NEW — architect output (chunk 1) |
| `tasks/builds/clientpulse/session-1-verification.md` | NEW — manual verification checklist (chunk 7) |

### §9.6 Files to rename or delete (explicit)

The "replaces X" notation in §9.1 / §9.2 is normative, but the retired paths are listed here in one place so reviewers can check nothing was left behind.

| Path | Action | Landing chunk |
|------|--------|---------------|
| `server/services/configUpdateHierarchyTemplateService.ts` | **Rename** → `configUpdateOrganisationService.ts` per §2.5 / §9.1 | A.2 |
| `server/services/configUpdateHierarchyTemplatePure.ts` | **Rename** → `configUpdateOrganisationConfigPure.ts` per §2.5 / §9.1 | A.2 |
| `server/services/__tests__/configUpdateHierarchyTemplatePure.test.ts` | **Rename** → `configUpdateOrganisationConfigPure.test.ts` per §8.3 / §9.1 (all 18 cases carry over) | A.2 |
| `server/skills/config_update_hierarchy_template.md` | **Rename** → `config_update_organisation_config.md` per §2.5 / §9.1 (action slug rename in the same edit) | A.2 |
| `server/routes/clientpulseConfig.ts` | **Delete** — retired per §4.2 (no redirect; generic route at `server/routes/organisationConfig.ts` replaces it) | A.3 |
| `client/src/components/clientpulse/ConfigAssistantChatPopup.tsx` | **Delete** — retired per §5.8 / §9.4 (Phase-4.5 direct-patch form replaced by the real Configuration Assistant popup at `client/src/components/config-assistant/ConfigAssistantPopup.tsx`) | A.4 |
| `client/src/pages/SystemCompanyTemplatesPage.tsx` | **Rename** → `client/src/pages/SystemOrganisationTemplatesPage.tsx` per §4.6 / §9.4 (class name + copy updated in same edit) | A.3 |
| `client/src/pages/AdminAgentTemplatesPage.tsx` (exact filename TBD per audit) | **Rename** → `client/src/pages/SubaccountBlueprintsPage.tsx` per §4.6 / §9.4 (operational-config fields removed in same edit per §6.5) | 6 (Phase 5 chunk) |

Audit-deferred items (per §10.8) are intentionally not listed here; their inventory delta is `no touch unless the kickoff audit finds a real caller`. The known-retired paths above are locked.

---

## §10. Decisions log (consolidated)

All prior open questions have been resolved inline in their sections. Consolidated here for easy scan during implementation.

### §10.1 Data model + migrations

| Q | Decision | Location |
|---|----------|----------|
| `organisations.applied_system_template_id` exists already? | Audit at chunk-2 kickoff. §2.4's migration is the sole owner of the ADD COLUMN + FK + index + backfill under the default name; if a pre-existing column under a different name is found, replace the ADD COLUMN in step 2 with reuse-in-place. **Intent is locked** — an explicit org-level FK to the adopted system template exists post-§2.4. Column naming is the only implementation-flexible lever. | §2.4, §2.6 |
| Create-org override-row posture | NULL (orgs inherit future system-template default changes; first override write initialises the row) | §7.2 |
| Org-creation config_history row | Keep as audit-trail marker with `snapshot_after=NULL` (represents no-override-yet state) | §7.2 step 6, §4.8 |
| Template-switch post-create? | Out of scope for Session 1. One-time adopt only. Revisit when a concrete use case arises. | §7.7 |
| RLS on new column? | `organisations` table policies inherit automatically. Confirm config-agent principal has write at kickoff; adjust policy if not. Non-blocking; trivial to fix at build time. | §2.7 |

### §10.2 Slug rename + registry

| Q | Decision | Location |
|---|----------|----------|
| Legacy-alias hit logging? | Yes — log-once per process via a `Set<string>` in `resolveActionSlug`. Drives the "safe to retire aliases" call. | §3.9 |
| Alias-map pure test? | Yes — `actionSlugAliasesPure.test.ts` asserts every alias key resolves to a registered slug. Locked. | §3.9 |
| Webhook handler normalisation? | Locked contract (l) in §1.3: all inbound action-slug surfaces MUST normalise via `resolveActionSlug`. Chunk-2 audit confirms which handlers are affected; the rule stands regardless. | §1.3(l), §3.9 |

### §10.3 Route + UI renames

| Q | Decision | Location |
|---|----------|----------|
| Retire `/api/clientpulse/config/apply` with no redirect? | Yes — clean retirement. Single in-app caller is being rewritten anyway; no external callers. | §4.2 |
| Migration 0178 collision fix? | `git mv migrations/0178_skill_analyzer_execution_lock_token.sql migrations/NNNN+3_skill_analyzer_execution_lock_token.sql`, where `NNNN` is Session 1's first migration slot (resolved at chunk A.1 kickoff against `ls migrations/`). With `NNNN = 0180` on current main, the target is `0184_skill_analyzer_execution_lock_token.sql`. The original `0180` target predates Session 1's own migration numbering and would collide. If Drizzle meta also references the old name, add a meta-update migration in chunk A.1. | §4.7 |
| Dedicated `ORG_PERMISSIONS.CONFIG_EDIT`? | No — reuse `AGENTS_EDIT` for Session 1. Revisit when a concrete "edit config but not agents" need arises. | §4.10 |
| Rename `clientpulseReports.ts` routes? | No — product-specific reads stay on `/clientpulse/` prefix. Only genuinely cross-module surfaces move to `/api/organisation/*`. | §4.10 |
| `registerSensitivePaths` import ordering? | Top of route-wiring section in `server/index.ts`, before any route registration. | §4.10 |

### §10.4 Configuration Assistant popup

| Q | Decision | Location |
|---|----------|----------|
| ⌘K command palette registration? | Audit at chunk-5 kickoff. Register if exists; skip + file a follow-up if not. Nav button + contextual triggers are sufficient for Session 1. | §5.13 |
| WebSocket re-entry on remount? | Audit at chunk-5 kickoff. If `useSocket` doesn't support rejoin-after-remount today, extend it as part of chunk 5. | §5.13 |
| Empty-state UX on popup open? | Chips on fresh session; transcript on resume. Matches mockup + full-page surface. | §5.13 |
| Multi-tab session dedup? | None needed. Each tab carries its own `sessionStorage` pointer; shared server-side run gets real-time updates via WebSocket. | §5.13 |

### §10.5 Settings page + blueprint editor

| Q | Decision | Location |
|---|----------|----------|
| Reset-to-default semantic? | Option (a) — explicit override write of the system default. Simple, always-writeable, clean history. No new unset endpoint. | §6.7 |
| Client-side validation posture? | Both client-side (fail fast) AND server-side (system of record). Never skip server side. | §6.7 |
| Typed `InterventionTemplatesEditor` or JSON? | JSON editor with schema validation for Session 1. Typed editor deferred to Session 2 Phase 8. Allows Session 1 to focus on the 9 other block editors without blowing up estimate. | §6.2, §6.7 |

### §10.6 Onboarding wizard

| Q | Decision | Location |
|---|----------|----------|
| GHL OAuth redirect pattern? | Reuse existing pattern. Audit at chunk-7 kickoff to identify the canonical helper + callback path. Non-blocking. | §7.7 |
| Welcome email template? | Reuse existing invite infra; add one sentence about the onboarding wizard in the body. No new template. | §7.7 |
| Tier-aware wizard content? | Same content regardless of tier for Session 1. D6 retrofits tier-aware copy later. | §7.7 |

### §10.7 Out of scope (explicitly deferred — Session 2 or later)

- Subscription-tier runtime gating (D6)
- Drilldown page (Phase 6)
- Real CRM execution via apiAdapter (Phase 6)
- Live CRM data pickers in editor modals (Phase 6)
- Outcome-weighted recommendation signal (Phase 8)
- B6 UX copy polish (Phase 8)
- Channel fan-out verification (Phase 8)
- Typed `InterventionTemplatesEditor` (Phase 8 — pulled out of Session 1 scope per §10.5)
- Template-switch flow for existing orgs
- Dedicated `ORG_PERMISSIONS.CONFIG_EDIT` split
- Per-block "Ask the assistant" deep-links on ClientPulse Settings cards (iter-5 spec-reviewer 5.3 resolution — deferred to Session 2 Phase 6 drilldown + Phase 8 widget polish where per-block contextual prompts combine with high-risk account context for higher leverage)
- Wizard Screen-3 scan-frequency + alert-cadence controls (iter-5 spec-reviewer 5.1 resolution — dropped from Session 1 wizard scope; operator tunes post-onboarding via ClientPulse Settings)
- Runtime `operationalConfigSchema.parse()` on the effective-read hot path (iter-5 spec-reviewer 5.2 resolution — requires deliberate posture change + validity gate + repair migration; not Session-1-appropriate)

### §10.8 Items deliberately left as chunk-kickoff audits (non-blocking)

These are small discovery tasks the implementer does at the start of the relevant chunk — they can't be answered from this spec alone but don't block approval:

- Does `organisations.applied_system_template_id` already exist under another name? (chunk 2)
- Which webhook handlers carry inbound `action_type` fields needing `resolveActionSlug` defensive normalisation? (chunk 2)
- Does the subaccount-create path already read the org's effective operational config via `orgConfigService.getOperationalConfig(orgId)`, or does it read `hierarchy_templates.operational_config_seed` / a raw override row today? If it reads the seed / raw override, retarget it and add the touched file(s) (likely `server/services/subaccountService.ts` or equivalent — confirm at audit) to §9.3. If it already reads `getOperationalConfig(orgId)` the contract holds without a code touch. (chunk 6 kickoff, before the Phase 5 blueprint-editor refactor lands)
- Does a ⌘K command palette exist in the client? (chunk 5)
- Does `useSocket` support rejoin-after-remount cleanly? (chunk 5)
- What's the canonical OAuth helper + callback pattern to reuse for GHL in the wizard? (chunk 7)
- Which deep-equal helper is already in the client bundle for `differsFromTemplate` (§4.5) — `fast-deep-equal`, a local utility, or does one need to be added? (chunk 6 kickoff)

---

**End of Session 1 spec.**

All directional decisions are locked. The remaining audits in §10.8 are implementation discovery — they refine the code, not the plan. Ready for `spec-reviewer` pass when the local Codex is available.
