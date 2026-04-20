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

- Org-level operational config lives in its own dedicated column on `organisations` (not on `hierarchy_templates`). Every platform read + write path targets this single row.
- Every platform-level concern (action slugs, route paths, capability registries, UI labels) is **generic-named**. Anything still carrying a product brand (e.g. `clientpulse.*`) is a deliberate vertical-module concept, not an accidental platform coupling.
- Operators have two equal surfaces for editing their org's operational config: a typed Settings page (point-and-click) and the Configuration Assistant popup (conversational). Both write through the same generic HTTP route and audit trail.
- New orgs can be created + onboarded end-to-end via UI using the new terminology (Organisation Templates, Subaccount Blueprints, ClientPulse Settings).
- Every existing intervention flow (scenario detector, operator-driven propose, outcome measurement) continues to work unchanged — the cleanup is surgical, not behavioural.

### §1.2 Ship gates

| # | Gate | Phase | Verification |
|---|------|-------|--------------|
| S1-A1 | Every Phase-4.5 config write targets `organisations.operational_config_override` instead of `hierarchy_templates.operational_config`. `orgConfigService.getOperationalConfig` reads from the new column. Existing data backfilled idempotently by the migration. | A | Unit test: seed an org with template overrides → run migration → assert `organisations.operational_config_override` carries the overrides and the chat write-path hits the new column. |
| S1-A2 | Action type `clientpulse.operator_alert` renamed to `notify_operator` across registry, skill executor, proposer job, metadata schema, UI, and existing action rows. Legacy alias resolves to the new slug so in-flight review-queue items stay intact. | A | Unit test: registry lookup on both slugs; migration assertion that all historical `actions.action_type` values are rewritten; e2e that a proposer job emits the new slug. |
| S1-A3 | `SENSITIVE_CONFIG_PATHS` is composable. Modules declare their sensitive paths via a registry; the core merges them. Adding a new module does not touch core code. | A | Unit test: register a synthetic module's paths + assert `isSensitiveConfigPath` covers them. |
| S1-A4 | Generic route `POST /api/organisation/config/apply` is the platform-wide config-write surface. `POST /api/clientpulse/config/apply` either redirects (301/308) or is retired entirely (see §4 for the call). | A | Integration test: POST to the generic route, receive the same response shape as the legacy route. |
| S1-A5 | Configuration Assistant popup mounts the real agent loop (not the Phase-4.5 direct-patch form). Session persists across modal close + reopen. Minimised pill shows background execution. The Phase-4.5 `ConfigAssistantChatPopup` file is either rewritten or deleted. | A | Manual: open the popup, submit a multi-step plan, close the popup while executing, re-open, verify the same session resumes. |
| S1-5.1 | ClientPulse Settings page at `/clientpulse/settings` has typed editors for every `operational_config` block exposed in the schema today (healthScoreFactors, churnRiskSignals, churnBands, interventionDefaults, interventionTemplates, alertLimits, staffActivity, integrationFingerprints, dataRetention, onboardingMilestones). Every write goes through the generic route. | 5 | Manual: open page, edit each block, verify `config_history` row lands, verify `organisations.operational_config_override` reflects the change. |
| S1-5.2 | Subaccount Blueprint editor (refactored `AdminAgentTemplatesPage`) no longer exposes `operationalConfig` fields. Editor only controls the agent hierarchy + which operational defaults to seed on apply. | 5 | Manual: open the blueprint editor, verify no operational-config fields are visible; verify creating a new subaccount from the default blueprint still seeds the org's current operational config override correctly. |
| S1-7.1 | New orgs go through the create-org + first-run flows using the new terminology ("Organisation Template" picker + "ClientPulse Settings" reference + "Subaccount Blueprints" in nav). No legacy labels appear in either flow. | 7 | Manual: run the happy-path onboarding for a fresh org, screenshot each screen, verify all labels match the post-Phase-A naming. |
| S1-7.2 | Onboarding wizard soft-gates GHL OAuth (workspace is usable at first sign-in, ClientPulse data appears only after the connection lands). No broken-state pages. | 7 | Manual: complete onboarding without connecting GHL → verify dashboard renders empty states cleanly; connect GHL → verify data lights up within one scan cycle. |

### §1.3 Locked contracts (non-negotiable, inherit + extend Phase 4/4.5)

Carried forward from the Phase 4 pickup prompt (no change):

- (a) 5 namespaced action slugs: `crm.fire_automation`, `crm.send_email`, `crm.send_sms`, `crm.create_task`. **Changed this session:** `clientpulse.operator_alert` → `notify_operator`.
- (b) Interventions remain `actions` rows + `intervention_outcomes` rows. No parallel intervention table.
- (c) Configuration Agent writes flow via `config_update_hierarchy_template` skill — but now the skill's **target row** moves from `hierarchy_templates` to `organisations.operational_config_override` (see §2).
- (d) Intervention templates continue to live in operational_config JSONB. What changes: the JSONB lives on `organisations`, not on `hierarchy_templates`.
- (e) No auto-execution path in V1.
- (f) Sensitive-path writes require `actions` row with `gateLevel='review'`. `SENSITIVE_CONFIG_PATHS` becomes module-composable (§3).
- (g) Merge-field resolver grammar unchanged.

Introduced this session:

- (h) **`organisations.operational_config_override` is the single runtime source-of-truth for org-level operational config.** Every reader and writer targets this one row. Any code path that reads / writes elsewhere is a bug.
- (i) **Platform primitives are module-agnostic.** Any action slug, capability path, or route that is genuinely cross-module (e.g. operator alerts, config-apply) MUST be un-namespaced or generically-namespaced (`ops.*` / `system.*`). Module-branded slugs (`clientpulse.*`, `crm.*`) are reserved for genuinely module-specific concepts.
- (j) **Settings page and Configuration Assistant are equal surfaces on the same mechanism.** Both call the same HTTP route; both produce the same audit trail; both respect the sensitive-path split. No surface has privileged access.
- (k) **Session lifecycle for the Configuration Assistant popup:** opening a popup resumes the most recent agent run < 15 minutes old, else creates a fresh one. Closing the popup does not kill the run. Background execution surfaces via the minimised pill.
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

Hierarchy templates keep their `operational_config` field (**renamed to** `operational_config_seed`) so blueprints can still carry seed defaults when adopted / created from a system template. The field is read-only after org creation — it is NOT a runtime source; it is a one-time seed. Further, we will stop reading it after the initial adopt; all runtime reads go through the org column.

### §2.3 Why a column, not a table

- One row per org is the shape the data actually has. A separate `org_operational_configs` table adds join overhead and row-lifecycle concerns for zero payoff.
- `config_history` already provides version history; a separate versioned table duplicates that infrastructure.
- RLS is simpler: the `organisations` table already has tenant-isolation policies.

Trade-off: adding a column to a hot table. Not an issue — `organisations` is tiny (one row per org, thousands at most at steady-state) and the JSONB column is nullable.

### §2.4 Migration plan

**Migration `NNNN_org_operational_config_override.sql`** (next-free number at kickoff; check `ls migrations/ | tail -3`):

```sql
BEGIN;

-- 1. Add the new column.
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS operational_config_override jsonb;

-- 2. Backfill: copy each org's existing hierarchy_templates.operational_config
--    (from the row selected by the current runtime resolver) into the new column.
--    Picks the single hierarchy_template that has systemTemplateId IS NOT NULL AND deletedAt IS NULL,
--    which is what orgConfigService.getOperationalConfig resolves today.
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

-- 3. Rename the template column so the intent is clear + stop accidental writes
--    from code that still thinks it's the runtime column.
ALTER TABLE hierarchy_templates
  RENAME COLUMN operational_config TO operational_config_seed;

-- 4. Deprecation marker — a comment on the new column makes the intent
--    discoverable in psql + ORM introspection.
COMMENT ON COLUMN organisations.operational_config_override IS
  'Org-level runtime operational config. Single source of truth. Written by config_update_hierarchy_template skill + ClientPulse Settings page. Deep-merged with system_hierarchy_templates.operational_defaults at read time.';
COMMENT ON COLUMN hierarchy_templates.operational_config_seed IS
  'One-time seed copied into organisations.operational_config_override when this template is adopted. NOT a runtime source — readers must use organisations.operational_config_override.';

COMMIT;
```

Rollback: drop the new column + rename the template column back. The backfilled data is preserved on `hierarchy_templates.operational_config_seed` until the rename is reverted.

### §2.5 Code changes required

| Path | Change |
|------|--------|
| `server/db/schema/organisations.ts` | Add `operationalConfigOverride: jsonb('operational_config_override').$type<Record<string, unknown> \| null>()` |
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

This introduces `organisations.applied_system_template_id` — a new nullable FK on the organisations table pointing at the adopted system template. Today the linkage is implicit (via hierarchy_template.systemTemplateId); moving it to the org makes the dependency explicit + avoids the join. Migration adds this FK and backfills from the current implicit linkage. If this is already present under a different name, use that instead — check at kickoff.

### §2.7 Open questions for §2

1. **Does `organisations.applied_system_template_id` already exist?** Check schema at kickoff. If yes, reuse; if no, add in the same migration.
2. **What happens when an org's system template is changed?** Today that's not a supported flow (platform support only, per onboarding spec). If §7's onboarding doesn't expose a template-switch path, leave this as "one-time adopt only" and revisit later.
3. **RLS on the new column.** `organisations` already has RLS policies; the new column inherits them. Confirm the existing policies allow the config-agent system principal to write. If not, adjust the policy.
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
| `server/services/interventionActionMetadata.ts` | No change (metadata schema is slug-agnostic). |
| `server/services/clientPulseInterventionContextService.ts` | Rename `INTERVENTION_ACTION_TYPES` tuple entry; rename in zod enum for `createOperatorProposal`. |
| `server/services/clientPulseInterventionProposerPure.ts` | No change (consumes the template's `actionType` field, which is data not code). |
| `server/jobs/proposeClientPulseInterventionsJob.ts` | Rename the literal in the `actionType === 'clientpulse.operator_alert'` branch → `notify_operator`. |
| `server/jobs/measureInterventionOutcomeJob.ts` | Rename in raw-SQL action_type IN clause. |
| `server/jobs/measureInterventionOutcomeJobPure.ts` | Rename in operator-alert branch of `decideOutcomeMeasurement`. |
| `server/routes/clientpulseInterventions.ts` + `clientPulseInterventionContextService.ts` | Rename in zod enums; alias accepted on input + normalised via `resolveActionSlug`. |
| `client/src/components/clientpulse/ProposeInterventionModal.tsx` + `OperatorAlertEditor.tsx` | Rename in `InterventionActionType` union + submit payload. |
| Pure tests | Update literals: `clientPulseInterventionProposerPure.test.ts`, `clientPulseInterventionPrimitivesPure.test.ts`, `interventionActionMetadataPure.test.ts`, `interventionIdempotencyKeysPure.test.ts`, `measureInterventionOutcomeJobPure.test.ts`. |
| `server/services/interventionActionMetadata.ts` | No schema change; just confirm `INTERVENTION_ACTION_TYPES` import downstream uses the new slug. |
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
// @deprecated — use sensitiveConfigPathsRegistry.getAllSensitiveConfigPaths()
export const SENSITIVE_CONFIG_PATHS: readonly string[] = Object.freeze([]);
```

Keep the export to avoid breaking external-to-module consumers during the transition; emptying the array + delegating to the registry means there's exactly one source of truth.

`isSensitiveConfigPath` in the same file delegates to the registry. All callers automatically pick up the new list.

#### Boot-time registration

The module's `registerSensitivePaths.ts` is imported by `server/index.ts` alongside other boot-time setup (routes, queues). It runs once, synchronously, before the first request.

### §3.7 Code changes — `SENSITIVE_CONFIG_PATHS` refactor

| Path | Change |
|------|--------|
| `server/config/sensitiveConfigPathsRegistry.ts` | **NEW** — registry primitive |
| `server/services/operationalConfigSchema.ts` | `SENSITIVE_CONFIG_PATHS` array emptied (kept as deprecated alias); `isSensitiveConfigPath` delegates to the registry |
| `server/modules/clientpulse/registerSensitivePaths.ts` | **NEW** — ClientPulse's sensitive paths declaration |
| `server/index.ts` | Import the registration module at boot |
| `server/services/configUpdateHierarchyTemplatePure.ts` (→ renamed per §2) | Use the registry helpers + the `isValidConfigPath` allow-list. The allow-list also becomes composable — see §3.8. |
| `server/services/__tests__/configUpdateHierarchyTemplatePure.test.ts` | Add a test: register a synthetic module's paths + assert coverage |

### §3.8 Bonus: also make `ALLOWED_CONFIG_ROOT_KEYS` composable

The typo-guard allow-list I added during the last review loop has the same problem — it's a hardcoded array inside a pure module. Refactor it into the same registry pattern:

```typescript
// server/config/operationalConfigRegistry.ts (same file OR sibling)
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

ClientPulse's `registerSensitivePaths.ts` also registers its root keys. Future modules ship one file that declares both.

### §3.9 Open questions for §3

1. **Should legacy-alias hits be logged?** Recommendation: yes, log-once per process via a `Set<string>` to avoid log spam. Aides the "safe to retire aliases" decision.
2. **Should the alias map be tested via a pure test?** Recommendation: yes — short test that every key resolves to a valid registry entry. Prevents typos in the alias map itself.
3. **Do webhook payloads carry the legacy slug?** Check `server/routes/`-wired webhook handlers. If any external integration emits the legacy `clientpulse.operator_alert` slug in an inbound webhook payload, the handler needs to normalise via `resolveActionSlug` on the way in. Audit at kickoff.
## §4. Phase A — generic `/api/organisation/config/apply` route + UI renames + housekeeping

### §4.1 The new canonical route

**`POST /api/organisation/config/apply`** — platform-generic surface for writing to `organisations.operational_config_override`. Any module settings UI (ClientPulse Settings today; future SEO Settings, Content Settings, etc.) calls this one route.

Request shape:

```typescript
{
  path: string;           // dot-path into operational_config (e.g. "alertLimits.notificationThreshold")
  value: unknown;         // JSON-serialisable
  reason: string;         // operator rationale (logged on config_history.change_summary)
  sessionId?: string;     // optional Configuration Assistant session id
}
```

Response shape is the same as the existing config-apply returns:

```typescript
| { committed: true; configHistoryVersion: number; path: string; classification: 'non_sensitive' }
| { committed: false; actionId: string; classification: 'sensitive'; requiresApproval: true }
| { committed: false; errorCode: 'SCHEMA_INVALID' | 'SUM_CONSTRAINT_VIOLATED' | 'INVALID_PATH' | 'AGENT_REQUIRED_FOR_SENSITIVE'; message: string }
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

**`GET /api/organisation/config`** — returns the effective merged config (`system defaults → org overrides`) + a parallel "which values are overridden" mask so the UI can show the "reset to template default" affordance per-field.

Response:

```typescript
{
  effective: OperationalConfig;          // merged deep-merge result
  overrides: OperationalConfig | null;   // just the org override row (nullable)
  systemDefaults: OperationalConfig;     // the underlying system template defaults
  appliedSystemTemplateId: string | null;
  appliedSystemTemplateName: string | null;
}
```

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
git mv migrations/0178_skill_analyzer_execution_lock_token.sql migrations/0180_skill_analyzer_execution_lock_token.sql
```

Verify nothing else references `0178_skill_analyzer_execution_lock_token.sql` by filename.

#### Migration numbering for Session 1

At kickoff, count the highest numbered migration. Plan:

| Session 1 migration | Purpose |
|---|---|
| `NNNN_org_operational_config_override.sql` | §2 — add + backfill the new column; rename the template column |
| `NNNN+1_rename_operator_alert.sql` | §3 — rewrite slug values + recreate partial index |
| `NNNN+2_renumber_skill_analyzer_migration.sql` | (if the rename can't be done via `git mv` alone because Drizzle meta also references the old name — check at kickoff) |

### §4.8 Config history audit-trail stability

`config_history` rows written by Phase-4.5 use `entity_type='clientpulse_operational_config'` and `entity_id=hierarchy_template.id`. Post-§2, the target is the organisation, so:

- **Entity type change:** `clientpulse_operational_config` → `organisation_operational_config`. New rows use the new type.
- **Existing rows:** leave as-is. The entity_id still points at the (renamed) hierarchy_template row, which now stores the one-time seed. Readers that grep `clientpulse_operational_config` in history continue to find historical entries.
- **History viewer** (`docs/capabilities.md` capability `clientpulse.config.history` → generic rename `organisation.config.history`) queries both entity types for continuity.

Alternatively, migrate the historical rows to the new entity_type + id. Trade-off: cleaner audit trail vs. irreversible. **Recommendation: leave existing rows untouched; route new writes to the new type.** Audit continuity via the read-side union.

### §4.9 Capability taxonomy renames

`docs/integration-reference.md` taxonomy:

| Current slug | New slug | Reason |
|---|---|---|
| `clientpulse.config.read` | `organisation.config.read` | Generic platform capability |
| `clientpulse.config.update` | `organisation.config.update` | Generic platform capability |
| `clientpulse.config.reset` | `organisation.config.reset` | Generic platform capability |
| `clientpulse.config.history` | `organisation.config.history` | Generic platform capability |

The integration block in `integration-reference.md` renames from `clientpulse-configuration` (pseudo-integration) to `organisation-configuration`. Same YAML shape, new slug. Verifier gate re-run after edit.

### §4.10 Open questions for §4

1. **New permission `ORG_PERMISSIONS.CONFIG_EDIT`?** Today the route reuses `AGENTS_EDIT` as a rough approximation. A dedicated permission would let orgs grant "edit operational config" without granting "edit agents." Low priority for Session 1 unless there's a known use case.
2. **Do we rename `clientpulseReports.ts` route file + endpoint paths?** Those routes (`/api/clientpulse/health-summary`, `/api/clientpulse/high-risk`) are product-specific reads and staying on the `/clientpulse/` prefix is correct — the vertical module owns them. No action.
3. **Where exactly does `server/index.ts` import the sensitive-paths registration?** Recommendation: at the very top of the route-wiring section (before routes register), alongside other boot-time module init.
## §5. Phase A — Configuration Assistant popup (Option 2: embedded real agent loop)

### §5.1 What's wrong with today's popup

`client/src/components/clientpulse/ConfigAssistantChatPopup.tsx` (shipped in Phase 4.5) is mis-named. It looks like a chat surface but is actually a direct-patch form: operator types a path + value + reason, and clicks Apply. No agent loop, no plan preview, no conversational resolution. It's a UI on top of `POST /api/clientpulse/config/apply`.

This was fine as a pilot proof, but it's not the Configuration Assistant — it's a lightweight settings form. The real Configuration Assistant (conversational plan-preview-execute loop, 28 tools before this session, 29 after this session, live at `/config-assistant`) does what operators actually need.

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

- **Open popup:** fetch `GET /api/agent-runs?agentSlug=configuration-assistant&userId=<me>&createdAfter=<15min-ago>&order=desc&limit=1`. If a run exists, resume it (load messages, show chat transcript). If no recent run, create a fresh one via `POST /api/agent-runs/start { agentSlug: 'configuration-assistant', initialPrompt? }`.
- **Close popup (× button):** do not cancel the run. Store the current session id in `sessionStorage` under `configAssistant.activeSessionId` + expiry timestamp.
- **Minimise (_ button):** collapse to a floating pill in the bottom-left (matches the mockup). Pill shows current step of the plan if executing; shows "chat ready" otherwise. Click pill → re-expand.
- **Reopen from any page:** hook reads `sessionStorage`; if active session < 15 minutes old, resume directly; else new session.
- **Execution while minimised:** the agent run lives server-side. If the plan finishes while the popup is closed, the next open shows the completed transcript. If it finishes while minimised, the pill briefly flashes + shows "✓ Complete — click to view."

Ceiling: the 15-minute window prevents stale resumption after a long idle. Configurable via a `SESSION_RESUME_WINDOW_MIN` constant in the hook file.

### §5.5 Deep-link support

`?config-assistant=open&prompt=<url-encoded-string>` opens the popup on page load. If `prompt` is set and no active session exists, creates a fresh session seeded with the prompt as the first user message. If an active session exists, prepends the prompt to the next user input field (not auto-sent) so the operator can review before sending.

Used by:

- ClientPulse Settings page: "Ask the assistant to change this" links next to each editor block.
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
  sessionId: string | null;                           // null = new session
  initialPrompt?: string;                             // only honoured on fresh session
  onSessionReady?: (sessionId: string) => void;       // bubbles up once a run is started
  onPlanPreview?: (plan: PlanPreview) => void;        // hook for the popup's minimise pill
  onPlanComplete?: (summary: PlanSummary) => void;
  compactMode?: boolean;                              // popup: true (narrower, simpler) · page: false
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

Internal state: `{ minimised: boolean; sessionId: string | null; planState: 'idle' | 'preview' | 'executing' | 'complete' }`.

### §5.8 What to do with `ConfigAssistantChatPopup.tsx`

**Delete** (per decision in §4.2 on the legacy route). The file ships in Phase 4.5 and has one caller (the button on `ClientPulseDashboardPage.tsx`). That caller is updated to open the new popup via the shared hook.

If deletion feels too aggressive, alternative: gut the file and re-export the new popup under the old name to preserve the import path. Not recommended — creates surface confusion.

### §5.9 `useConfigAssistantPopup()` hook

**New: `client/src/hooks/useConfigAssistantPopup.ts`**

Responsibilities:
- Read/write `sessionStorage` for the active-session resume window.
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

### §5.11 Risk: plan-preview UX in a narrow modal

The full-page Configuration Assistant renders the plan preview with room for a step-by-step diff. A 600px-wide popup has less real estate. Handling:

- **Preview fits:** render it inline in `compactMode` with tighter spacing.
- **Preview too big:** show a summary (step count + affected entities), with a "View full plan →" link that opens the same session on `/config-assistant` in a new tab. Session state is shared; the operator can approve from either surface.

The "too big" threshold is empirical — size-check on render + flip to summary view above N steps (start with N=5, tune later).

### §5.12 Real-time + concurrency

- The popup and the full page share sessions (per §5.4). If an operator has both open against the same session, WebSocket updates render in both simultaneously.
- Approving a plan from either surface is idempotent at the server — `agentRun.approvePlan()` transitions `plan_pending` → `executing` once; second call returns the same result.
- Closing the popup mid-plan-preview does NOT cancel the plan. The preview is server-persistent. The operator sees it again on re-open.

### §5.13 Open questions for §5

1. **Does a ⌘K command palette exist?** If yes, register the entry; if no, skip for Session 1.
2. **Does `useSocket` / the WebSocket subscription model already support re-entering a room on remount?** If the popup closes + reopens against the same session, the second mount should auto-resubscribe. Audit at build time.
3. **Pending-plan state on popup open with no previous session:** should the popup show the agent's greeting / suggestion chips (per the mockup), or a fresh empty chat? Recommendation: chips on fresh; transcript on resume. Consistent with the mockup.
4. **What's the session-dedup strategy if the operator has multiple browser tabs?** Each tab gets its own active-session pointer in `sessionStorage` today; if they collide, both tabs hit the same run and the UX is fine (real-time sync). No change needed unless audit finds a problem.
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
| `interventionTemplates` | `InterventionTemplatesEditor` | Array of template rows with slug + label + gateLevel + actionType + targets multi-select (bands) + priority + measurementWindowHours + payloadDefaults (JSON) + defaultReason. |
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

Per-field button. When clicked:

- If the field is currently overridden: POST a save with `value: <the-system-default-value>` OR a dedicated delete-override path (see open question §6.7.1). Recommendation: the POST shape is "set to the system default," which deep-merges to no-op at the effective layer but keeps the override-row shape deterministic.
- If the field is not overridden: button is disabled with tooltip "Already at template default."

UX: small "reset" icon button next to the override indicator (matches existing settings mockup).

### §6.5 Subaccount Blueprint editor refactor

The existing `AdminAgentTemplatesPage` (exact label TBD — audit at kickoff) handles CRUD on `hierarchy_templates`. After §2 renames `operational_config → operational_config_seed`, the editor needs to stop exposing those fields because:

1. They're no longer the runtime source.
2. Exposing them here creates the split-brain confusion we're cleaning up.

Changes:

- **Read-only display of the "seed" block** as an informational preview: "This blueprint will seed new subaccounts with these operational defaults. Change the live config in ClientPulse Settings."
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

### §6.7 Open questions for §6

1. **Reset-to-default semantic.** Two options: (a) write the system-default value as an explicit override (idempotent, simple) — pro: always-writeable, clean history; con: override row grows. (b) add a `POST /api/organisation/config/unset` that removes the key from the override row — pro: override row stays minimal; con: new endpoint + audit shape. Recommendation: (a) for v1.
2. **Editor-side validation vs server-side validation.** Client-side sum-check on weights prevents bad submits; server still enforces. Recommend both — fail fast on the client, trust the server. Don't skip server side.
3. **Permission scope.** Does `ORG_PERMISSIONS.AGENTS_EDIT` grant access to this page? It should for v1 since that's the config-route permission. Flagged in §4.10 for potential future split.
4. **Typed intervention template editor complexity.** The `InterventionTemplatesEditor` is the most complex — nested action-type picker + per-action payload defaults + merge-field guidance. If scoping shows this is blowing up the Phase 5 estimate, split: keep a JSON-raw editor for v1 of Session 1 + defer the typed editor to Session 2 (Phase 8's "intervention template editor" bullet already accounts for this).
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
- **Live preview:** right-hand pane updates as the template is selected. Shows: "You'll create <Org Name> with <Template Name> · <N> agents will be seeded · <M> subaccount blueprints available · Operational defaults: <summary bullets>."
- **Confirm button** creates the organisation, seeds the default subaccount blueprint from the template, copies the template's `operational_defaults` into the new `organisations.operational_config_override`, creates the org-admin user + invite email.

### §7.2 System-admin — what the "create" action does server-side

**New service method: `organisationService.createFromTemplate({ name, slug, systemTemplateId, tier, orgAdminEmail })`**

Steps (all in one transaction):

1. INSERT the `organisations` row with `applied_system_template_id = systemTemplateId`.
2. Copy `systemHierarchyTemplates.operational_defaults` → `organisations.operational_config_override` (fresh copy, operator can diverge from the template from day one).
3. Create a `hierarchy_templates` row (the default Subaccount Blueprint) sourced from the system template — sets `isDefaultForSubaccount=true` and copies the agent hierarchy structure. The `operational_config_seed` field is populated for reference only.
4. Seed any system agents declared by the template (e.g. `portfolio-health-agent` linked to the new org).
5. Create the org-admin user row + invite email.
6. Write a `config_history` row with `change_source='system_sync'` and `change_summary='Organisation created from template <template-slug>'`.

Return the new `organisationId` for the modal to display success + a link.

### §7.3 Org-admin — first-run wizard (4 screens)

Route: `/onboarding` (client-side, auto-redirects after first sign-in until the wizard is marked complete).

Gate logic: a new `organisations.onboarding_completed_at: timestamp nullable` column. Null → wizard shown; set → wizard skipped.

**Screen 1 — Welcome.** Branded, explains what ClientPulse monitors + hints at the next 2 steps. Primary button "Next."

**Screen 2 — Connect GoHighLevel.** OAuth soft-gate per `tasks/clientpulse-mockup-onboarding-orgadmin.html`. Two buttons: "Connect GHL" (kicks off OAuth) or "Skip for now" (workspace usable, ClientPulse data empty state until connected). Both advance to screen 3.

**Screen 3 — Configure key defaults.** Three sliders / inputs surfacing the most impactful overrides:

- Scan frequency (hours): default 24, slider 6–72
- Alert cadence: daily / weekly / monthly / off
- Churn-band cutoffs: collapsed summary view showing "Healthy 75–100 · Watch 51–74 · At-risk 26–50 · Critical 0–25" with a "Adjust thresholds" link that opens the ClientPulse Settings page inline (or defers).

Each value written via `POST /api/organisation/config/apply` on Next. Non-sensitive paths commit immediately; sensitive paths queue but the wizard continues — user re-visits the review queue later.

**Screen 4 — You're ready.** Summary card showing: org name, adopted template, GHL connection status, next scan ETA. Link to dashboard. Marks `onboarding_completed_at`.

### §7.4 Routes + pages

| Route | Page | Purpose |
|-------|------|---------|
| `/onboarding` (client) | `OnboardingWizardPage.tsx` | 4-screen wizard + state machine |
| `POST /api/onboarding/complete` (server) | `onboardingRoutes.ts` | Mark `organisations.onboarding_completed_at` |
| `GET /api/onboarding/status` (server) | Same | Returns whether current user's org needs the wizard |

The redirect logic sits in `App.tsx` / a top-level effect: on first render, fetch `GET /api/onboarding/status`; if `needsOnboarding=true`, `navigate('/onboarding')` unless already there.

### §7.5 Migration

**Migration `NNNN_organisations_onboarding_completed_at.sql`:**

```sql
ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamp with time zone;

-- Backfill: existing orgs are considered onboarded (they're live).
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

### §7.7 Open questions for §7

1. **Template-switch post-create.** Not exposed in the system-admin modal. If needed later, that's a separate operation (requires config-reset + agent hierarchy re-seed). Out of scope for Session 1.
2. **GHL OAuth redirect flow.** Existing OAuth pattern used elsewhere in the app — reuse. Audit at kickoff.
3. **Does a "welcome email template" need to be part of the system-admin flow?** Recommendation: reuse existing invite email infrastructure; add a one-line mention of the onboarding wizard in the email body.
4. **Subscription tier gating in the wizard.** If the system admin picked "Monitor" tier, the org-admin wizard should show a different "what you can do" summary than "Operate." For Session 1, render the same content regardless — D6 tier gating happens later and will retrofit.
## §8. Work sequence, chunks, ship-gate tests, and review gates

### §8.1 Chunk sequence (8 chunks, serialised)

1. **Architect pass.** Produce `tasks/builds/clientpulse/session-1-plan.md` appended as §§1–8 with chunk-level file inventories, test lists, and pseudocode for the interesting bits. (Spec-reviewer optional; see §8.5.)
2. **A.1 — Data model + core renames.** New migrations (org override column + seed rename + operator_alert slug rewrite + onboarding_completed_at). Schema + type updates. Pure tests for `getOperationalConfig` read chain + `resolveActionSlug` alias resolver. One commit.
3. **A.2 — Config service refactor.** Rename `configUpdateHierarchyTemplate{Service,Pure}` → `configUpdateOrganisation{Service,Pure}`. Retarget the service at `organisations.operational_config_override`. Sensitive-paths registry + bootstrap registration. All 18 existing Pure tests + 10 existing idempotency-key tests + 9 metadata-contract tests migrated with updated literals. One commit.
4. **A.3 — Generic route + UI renames.** New `server/routes/organisationConfig.ts` + `GET /api/organisation/config`. Retire `clientpulseConfig.ts`. UI renames (route, nav labels, page titles) across `client/src/`. One commit.
5. **A.4 — Configuration Assistant popup.** Extract `<ConfigAssistantPanel>`, build `<ConfigAssistantPopup>` + `useConfigAssistantPopup` hook, mount at App shell, retire the Phase-4.5 popup, wire global trigger + contextual triggers. Manual smoke test in browser per CLAUDE.md UI rule. One commit.
6. **Phase 5 — ClientPulse Settings page + blueprint editor refactor.** All 10 typed editors, save flow, reset-to-default affordance, provenance strip. Subaccount Blueprint editor field removal. One commit.
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
| S1-5.1 (Settings page) | Manual + per-editor pure tests | `client/src/components/clientpulse-settings/__tests__/*.test.tsx` (optional — if client test infra exists) + manual |
| S1-5.2 (blueprint editor refactor) | Manual | Verified in verification doc |
| S1-7.1 (new terminology in flows) | Manual | Screenshot-based in verification doc |
| S1-7.2 (OAuth soft-gate) | Manual | Verified in verification doc |

### §8.3 Pure test plan (carry-over + new)

Existing pure tests that must be updated with new literals/slugs:

- `mergeFieldResolverPure.test.ts` (24 cases) — no changes expected; resolver is slug-agnostic.
- `clientPulseInterventionProposerPure.test.ts` (14 cases) — update literals referencing `clientpulse.operator_alert`.
- `configUpdateHierarchyTemplatePure.test.ts` (18 cases) — rename file + import; all cases carry.
- `clientPulseInterventionPrimitivesPure.test.ts` (23 cases) — update literals.
- `interventionActionMetadataPure.test.ts` (9 cases) — update literals.
- `interventionIdempotencyKeysPure.test.ts` (14 cases) — update literals.
- `measureInterventionOutcomeJobPure.test.ts` (11 cases) — update literals.

New pure tests introduced by Session 1:

- `actionSlugAliasesPure.test.ts` — new, ~6 cases.
- `sensitiveConfigPathsRegistryPure.test.ts` — new, ~8 cases.
- `orgOperationalConfigMigrationPure.test.ts` — new, ~6 cases exercising the read-chain helper (pure decode of `{ systemDefaults, overrides } → effective`).

**Target post-Session-1:** 137 pure tests across ClientPulse (113 today + 24 new / carried). Zero regressions on the 43-error server typecheck baseline.

### §8.4 Manual verification checklist

New file: `tasks/builds/clientpulse/session-1-verification.md`. Per CLAUDE.md UI rule — start `npm run dev`, exercise each flow, record outcomes. Required checks:

1. **Migration safety.** Run migrations against a fresh DB (check schema only). Run against a local DB with pre-merge data (check backfill). Run rollback (check nothing lost).
2. **Popup lifecycle.** Open popup from nav → send a prompt → get plan preview → minimise → pill shows → reopen → plan still there → approve → execution progresses → close popup mid-execute → reopen → see completed transcript.
3. **Settings page CRUD.** Per block: edit, save, verify `config_history` row, refresh page, verify value persisted. Test both non-sensitive (direct commit) and sensitive (review-queue routing) paths. Test reset-to-default.
4. **Subaccount Blueprint editor.** Open the page, verify no operational-config fields visible. Verify creating a new subaccount from the default blueprint still works end-to-end (agent hierarchy seeded correctly).
5. **Onboarding — sysadmin.** Create a test org via the modal. Verify: org created, default blueprint seeded, operational config override populated, invite email queued.
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

- Migrations are reversible (`_down/` pairs written for the new migrations; the backfill is restore-able from the renamed seed column).
- Route retirement of `/api/clientpulse/config/apply` is reversible by re-exporting the old file (kept in git history).
- UI renames are cosmetic — reversible via `git revert`.
- Popup refactor: reverting restores the old `ConfigAssistantChatPopup` from git.

No data loss risk. Downgrade window: 1 release cycle.
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
| `server/services/organisationService.ts` — `createFromTemplate` method | §7.2 sysadmin create-org service |
| `server/routes/onboarding.ts` — status + complete endpoints | §7.4 onboarding endpoints |
| `server/skills/config_update_organisation_config.md` | §2 renamed skill definition |
| `server/services/__tests__/configUpdateOrganisationConfigPure.test.ts` | §2 renamed test file (18 cases carried over) |
| `server/config/__tests__/actionSlugAliasesPure.test.ts` | §3 alias resolver tests (NEW) |
| `server/config/__tests__/sensitiveConfigPathsRegistryPure.test.ts` | §3 registry tests (NEW) |
| `server/services/__tests__/orgOperationalConfigMigrationPure.test.ts` | §2 read-chain test (NEW) |
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
| `client/src/components/clientpulse-settings/InterventionTemplatesEditor.tsx` | §6 per-block editor |
| `client/src/components/clientpulse-settings/AlertLimitsEditor.tsx` | §6 per-block editor |
| `client/src/components/clientpulse-settings/StaffActivityEditor.tsx` | §6 per-block editor |
| `client/src/components/clientpulse-settings/IntegrationFingerprintsEditor.tsx` | §6 per-block editor |
| `client/src/components/clientpulse-settings/DataRetentionEditor.tsx` | §6 per-block editor |
| `client/src/components/clientpulse-settings/OnboardingMilestonesEditor.tsx` | §6 per-block editor |
| `client/src/components/clientpulse-settings/shared/*` | §6 reset pill / override badge / save bar |
| `client/src/pages/OnboardingWizardPage.tsx` | §7 4-screen org-admin wizard |
| `client/src/components/onboarding/*` | §7 per-screen components |

### §9.3 Files to modify (server)

| Path | Change |
|------|--------|
| `server/db/schema/organisations.ts` | Add `operationalConfigOverride` + `onboardingCompletedAt` + `appliedSystemTemplateId` fields |
| `server/db/schema/hierarchyTemplates.ts` | Rename `operationalConfig` → `operationalConfigSeed` |
| `server/services/orgConfigService.ts` | Read chain swap (§2.6) |
| `server/services/operationalConfigSchema.ts` | `SENSITIVE_CONFIG_PATHS` becomes deprecated alias; `isSensitiveConfigPath` delegates to registry |
| `server/config/actionRegistry.ts` | Slug rename + `ACTION_SLUG_ALIASES` + `resolveActionSlug` |
| `server/services/skillExecutor.ts` | Case rename + alias-aware dispatch |
| `server/services/interventionActionMetadata.ts` | `INTERVENTION_ACTION_TYPES` tuple entry renamed |
| `server/services/clientPulseInterventionContextService.ts` | Zod enum + literal renames; remove `resolveDefaultHierarchyTemplateId` |
| `server/services/clientPulseInterventionProposerPure.ts` | No change (data-driven) |
| `server/jobs/proposeClientPulseInterventionsJob.ts` | Literal rename |
| `server/jobs/measureInterventionOutcomeJob.ts` | SQL literal rename |
| `server/jobs/measureInterventionOutcomeJobPure.ts` | Operator-alert branch literal rename |
| `server/routes/clientpulseInterventions.ts` | Zod enum rename |
| `server/index.ts` | Import `registerSensitivePaths` at boot; register new routes; retire old route |
| `server/routes/onboarding.ts` (if existing) | Status + complete endpoints |
| All ClientPulse pure tests (7 files) | Literal renames |

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

---

## §10. Open questions (consolidated, for HITL before kickoff)

### §10.1 Must resolve before Chunk 2 starts

1. **§2.7.1 — does `organisations.applied_system_template_id` already exist?** If yes, reuse; if no, add in the same migration.
2. **§3.9.3 — do any webhook handlers emit/accept the legacy `clientpulse.operator_alert` slug in inbound payloads?** Audit server/routes/*.ts for webhook handlers. If yes, normalise inbound via `resolveActionSlug`.
3. **§4.2 — confirm retiring `/api/clientpulse/config/apply` without a redirect is acceptable.** Deferred call in the spec; may want a 308 for one release cycle if any external monitoring hits it.
4. **§4.7 — confirm migration 0178 rename is acceptable.** Double-number on main. Rename or leave?
5. **§6.7.4 — drop `InterventionTemplatesEditor` from Session 1 if it blows up estimate?** Fall-back is a raw JSON editor with schema validation. Ship the typed version in Session 2 under Phase 8.
6. **§7.7.4 — subscription tier display in the onboarding wizard — same content regardless, or branch on tier?** Default to same content.

### §10.2 Nice-to-resolve, not blocking

7. §4.10.1 — dedicated `ORG_PERMISSIONS.CONFIG_EDIT` permission.
8. §5.13.1 — ⌘K command palette existence check.
9. §5.13.3 — popup empty-state UX (chips on fresh, transcript on resume).
10. §6.7.1 — reset-to-default as explicit override vs. new unset endpoint.
11. §7.7.2 — GHL OAuth redirect pattern reuse (should be trivial; audit at kickoff).

### §10.3 Out of scope — explicitly deferred

- Subscription-tier runtime gating (D6) — Session 2 or later.
- Drilldown page (Phase 6) — Session 2.
- Real CRM execution via apiAdapter (Phase 6) — Session 2.
- Live CRM data pickers in editor modals (Phase 6) — Session 2.
- Outcome-weighted recommendation signal (Phase 8) — Session 2.
- B6 UX copy polish (Phase 8) — Session 2.
- Channel fan-out verification (Phase 8) — Session 2.

---

**End of Session 1 spec.**

Ready for review. When approved, the next step is to kick off Chunk 1 (architect pass) to produce `tasks/builds/clientpulse/session-1-plan.md`.
