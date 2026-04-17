# Canonical Data Platform — P1+P2+P3 Implementation Spec

**Parent spec:** `docs/canonical-data-platform-roadmap.md`
**Branch:** `claude/middleware-database-integration-k6LfO`
**Date:** 2026-04-17
**Migrations:** 0160–0167

---

## Implementation philosophy

This spec is executable — every section maps to files, migrations, and testable exit criteria. It inherits all framing from the parent roadmap spec and does not restate architectural decisions (D1–D10) or the principal model shape. Read the parent spec first.

All work follows the project's pre-production posture: commit-and-revert rollout, static gates + pure-function tests, no feature flags, no staged rollout. Existing primitives are reused where they fit (`createWorker()`, `withBackoff`, `TripWire`, `withOrgTx`, `RLS_PROTECTED_TABLES`).

---

## Scope

Three phases, five sub-phases, seven migrations:

| Sub-phase | Delivers | Migrations |
|-----------|----------|------------|
| P1 | Scheduled polling + stale-connector health detector | 0160 |
| P2A | Read-path consolidation (`readPath` tagging + `canonicalDataService` extension) | 0161 (metadata only) |
| P2B | Machine-readable data dictionary + `canonical_dictionary` skill | — |
| P3A | Principal-model schema, context propagation, service-signature migration | 0162–0165 |
| P3B | Postgres RLS principal-scoped policies + enforcement | 0166–0167 |

**Strict ordering:** P1 → P2A → P2B → P3A → P3B. Each sub-phase lands in its own PR.

---

## Table of contents

1. [Migration plan](#migration-plan)
2. [P1 — Scheduled polling + stale-connector detector](#p1--scheduled-polling--stale-connector-detector)
3. [P2A — Read-path consolidation](#p2a--read-path-consolidation)
4. [P2B — Data dictionary skill](#p2b--data-dictionary-skill)
5. [P3A — Principal-model schema + context propagation](#p3a--principal-model-schema--context-propagation)
6. [P3B — Postgres RLS + enforcement](#p3b--postgres-rls--enforcement)
7. [Cross-cutting concerns](#cross-cutting-concerns)
8. [Static gates summary](#static-gates-summary)
9. [Decisions resolved for this spec](#decisions-resolved-for-this-spec)
10. [Exit criteria per sub-phase](#exit-criteria-per-sub-phase)

---

## Migration plan

All migrations start at 0160 (after current highest 0159). Each migration is idempotent where possible (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). Backfill logic is inline in the migration file, not in a separate script.

| # | File | Phase | Purpose |
|---|------|-------|---------|
| 0160 | `0160_p1_scheduled_polling.sql` | P1 | Add sync-tracking columns to `integration_connections` + create `integration_ingestion_stats` table |
| 0161 | `0161_p2a_readpath_metadata.sql` | P2A | No DB schema change — this migration is a placeholder that documents the `readPath` field addition to the TypeScript `ActionDefinition` type. Exists for audit trail only. |
| 0162 | `0162_p3a_principal_tables.sql` | P3A | Create `service_principals`, `teams`, `team_members`, `delegation_grants`, `canonical_row_subaccount_scopes` |
| 0163 | `0163_p3a_connection_ownership.sql` | P3A | Add ownership/classification/visibility columns to `integration_connections` + backfill existing rows |
| 0164 | `0164_p3a_agent_runs_principal.sql` | P3A | Add `principal_type`, `principal_id`, `acting_as_user_id`, `delegation_grant_id` to `agent_runs` + backfill |
| 0165 | `0165_p3a_canonical_columns.sql` | P3A | Add `owner_user_id`, `visibility_scope`, `shared_team_ids`, `source_connection_id` to every canonical table + backfill |
| 0166 | `0166_p3b_session_variables.sql` | P3B | Informational migration documenting the new session variables (`app.current_subaccount_id`, `app.current_principal_type`, `app.current_principal_id`, `app.current_team_ids`). No DDL. |
| 0167 | `0167_p3b_rls_policies.sql` | P3B | `CREATE POLICY` statements for every in-scope table. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` for tables not yet RLS-enabled. Add new tables to `RLS_PROTECTED_TABLES` manifest. |

### Backfill strategy summary

| Migration | Backfill rule |
|-----------|---------------|
| 0160 | No backfill — new columns default to NULL / `'backfill'` |
| 0163 | All existing connections → `ownership_scope = 'subaccount'`, `classification = 'shared_mailbox'`, `visibility_scope = 'shared_subaccount'`, `owner_user_id = NULL`, `shared_team_ids = '{}'` |
| 0164 | Rows with `user_id` → `principal_type = 'user', principal_id = user_id::text`. Scheduled-job rows → `principal_type = 'service', principal_id = 'service:unknown-legacy'`. `acting_as_user_id` and `delegation_grant_id` remain NULL. |
| 0165 | All canonical rows → `visibility_scope = 'shared_subaccount'`, `shared_team_ids = '{}'`, `owner_user_id = NULL`. `source_connection_id` set from existing `connector_config_id` linkage where available. |

---

## P1 — Scheduled polling + stale-connector detector

### Migration 0160

```sql
ALTER TABLE integration_connections
  ADD COLUMN IF NOT EXISTS last_successful_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_error text,
  ADD COLUMN IF NOT EXISTS last_sync_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_phase text NOT NULL DEFAULT 'backfill';

CREATE INDEX IF NOT EXISTS integration_connections_last_successful_sync_at_idx
  ON integration_connections (last_successful_sync_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS integration_connections_sync_phase_idx
  ON integration_connections (sync_phase)
  WHERE deleted_at IS NULL AND sync_phase IN ('backfill','transition','live');

CREATE TABLE IF NOT EXISTS integration_ingestion_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES integration_connections(id),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  sync_started_at timestamptz NOT NULL,
  sync_finished_at timestamptz,
  api_calls_approx int NOT NULL DEFAULT 0,
  rows_ingested int NOT NULL DEFAULT 0,
  sync_duration_ms int,
  sync_phase text NOT NULL,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_ingestion_stats_connection_idx
  ON integration_ingestion_stats (connection_id, sync_started_at DESC);
CREATE INDEX IF NOT EXISTS integration_ingestion_stats_org_idx
  ON integration_ingestion_stats (organisation_id, created_at DESC);
```

`integration_ingestion_stats` is org-scoped and should be added to `RLS_PROTECTED_TABLES` in the same migration (it contains per-connection sync metrics — cross-tenant leak reveals integration activity patterns).

### New files

| File | Purpose |
|------|---------|
| `server/jobs/connectorPollingTick.ts` | Cron job handler — selects connections due for sync, enqueues per-connection jobs |
| `server/jobs/connectorPollingSync.ts` | Per-connection job handler — calls `syncConnector`, records stats |
| `server/services/connectorPollingSchedulerPure.ts` | Pure function: `selectConnectionsDue(connections, now)` → connection IDs |
| `server/services/workspaceHealth/detectors/staleConnectorDetector.ts` | Health detector following existing `detectorTypes.ts` pattern |
| `server/services/workspaceHealth/detectors/staleConnectorDetectorPure.ts` | Pure function: `computeStaleness(connection, now)` → severity |
| `server/services/__tests__/connectorPollingSchedulerPure.test.ts` | Fixture tests: interval math, phase filter, paused-skip, null-lastSync |
| `server/services/__tests__/staleConnectorDetectorPure.test.ts` | Fixture tests: each severity band, edge cases |
| `server/config/connectorPollingConfig.ts` | Constants: `POLLING_TICK_CRON`, `MAX_CONCURRENT_SYNCS`, `STALE_THRESHOLDS` |
| `scripts/verify-connector-scheduler.sh` | Static gate |

### Files to modify

| File | Change |
|------|--------|
| `server/db/schema/integrationConnections.ts` | Add five new columns to Drizzle schema |
| `server/db/schema/index.ts` | Export new `integrationIngestionStats` table |
| `server/services/connectorPollingService.ts` | Add `ServicePrincipal` argument to `syncConnector()` (stub until P3A — just extract `organisationId`). Record `last_sync_started_at` before sync, `last_successful_sync_at` / `last_sync_error` after. Wrap sync call with `withBackoff`. |
| `server/config/jobConfig.ts` | Register `'connector-polling-tick'` (cron, 1min, singleton) and `'connector-polling-sync'` (on-demand, per-connection concurrency) |
| `server/services/workspaceHealth/detectors/index.ts` | Export `staleConnectorDetector` |
| `scripts/run-all-gates.sh` | Add `verify-connector-scheduler.sh` |

### Job design

**`connector-polling-tick`** (cron, every 1 minute):
1. Query `integration_connections` for connections where `sync_phase IN ('backfill','transition','live') AND deleted_at IS NULL AND (last_successful_sync_at IS NULL OR now() - last_successful_sync_at >= poll_interval_minutes * interval '1 minute')`.
2. For each, enqueue `connector-polling-sync` with `{ organisationId, connectionId }`.
3. Uses `createWorker()`. Singleton key prevents overlapping ticks.

**`connector-polling-sync`** (per-connection):
1. Load connection, build stub `ServicePrincipal` (`service:canonical-polling`).
2. Set `last_sync_started_at = now()`.
3. Call `connectorPollingService.syncConnector(connectionId, principal)` wrapped in `withBackoff` (existing primitive).
4. On success: update `last_successful_sync_at`, clear `last_sync_error`. Write `integration_ingestion_stats` row.
5. On failure: update `last_sync_error`, `last_sync_error_at`. Write stats row with error. Do not throw — the job completes and `TripWire` monitors error rates.
6. Concurrency: 1 per connection (keyed by `connectionId`), global max from config.

**Cron-parser reuse:** The `selectConnectionsDue` pure helper uses the same cron-parser library version as `scheduleCalendarServicePure.ts` (`SOURCE_PRIORITY`, `computeNextHeartbeatAt`). If the connector-polling cadence model diverges from agent-run scheduling, the divergence is documented in this spec with justification.

### Stale-connector detector

Follows the existing workspace-health detector pattern (see `server/services/workspaceHealth/detectors/`).

**Severity thresholds:**

| Condition | Severity |
|-----------|----------|
| Age < 2× `pollIntervalMinutes` | `none` (healthy) |
| 2×–5× interval | `warning` |
| > 5× interval, or `last_sync_error` within last 24h | `error` |
| Never synced AND `created_at` > 24h ago | `error` |

Findings carry `resourceId = connectionId` (stable, no duplicates on re-run).

### Static gate

`scripts/verify-connector-scheduler.sh` — greps for direct calls to `connectorPollingService.syncConnector` outside `connectorPollingSync.ts` and the manual-sync route (`POST /api/org/connectors/:id/sync`). Fails if found.

---

## P2A — Read-path consolidation

### Goal

Every action in the registry declares how it reads data: `canonical`, `liveFetch`, or `none`. Skills that read from canonical go through `canonicalDataService`; skills that hit provider APIs directly are tagged `liveFetch` with a rationale. No raw Drizzle queries against canonical tables outside `canonicalDataService`.

### Migration 0161

No DB schema change. The migration file documents the `readPath` field addition to `ActionDefinition` for audit trail. Content:

```sql
-- Migration 0161: P2A readPath metadata
-- No DDL. This migration documents the addition of the `readPath` field
-- to the TypeScript ActionDefinition type in server/config/actionRegistry.ts.
-- Every action is tagged: 'canonical' | 'liveFetch' | 'none'.
-- Static gate verify-skill-read-paths.sh enforces non-null.
```

### Type change — `ActionDefinition`

```typescript
// server/config/actionRegistry.ts — type addition
interface ActionDefinition {
  // ... existing fields ...
  readPath: 'canonical' | 'liveFetch' | 'none';
  liveFetchRationale?: string;  // required when readPath === 'liveFetch'
}
```

Every existing action in the registry is tagged in the same commit. Classification rules:

| Action reads from… | Tag | Example |
|---------------------|-----|---------|
| Canonical tables via `canonicalDataService` | `canonical` | `read_crm`, `read_contacts` |
| Provider API directly, with documented reason | `liveFetch` | `fetch_email_body` (D7), `read_inbox` (stub, pending P4) |
| No data read (pure tool action) | `none` | `send_to_slack`, `create_task`, `move_task` |

### `canonicalDataService` extension

Add missing read methods as skills refactor to use canonical. Existing methods (`getAccountsByOrg`, `getAccountById`, `getContactMetrics`, etc.) retain their `(organisationId, ...)` signature during P2A. Signature change to `(principal, ...)` happens in P3A.

New methods added on demand as each skill refactors:
- Naming convention: `get<Entity>By<Filter>(organisationId, filter)`
- Return types: typed DTOs, not raw Drizzle rows
- All queries filter by `organisationId` and `isNull(deletedAt)`

### Skill refactor order

High-traffic paths first, then long tail:

1. `read_crm` → `canonicalDataService.getAccountsByCrm()`
2. `read_contacts` → `canonicalDataService.getContacts()`
3. `read_campaigns` → `canonicalDataService.getCampaigns()`
4. `read_opportunities` → `canonicalDataService.getOpportunities()`
5. Remaining canonical-backed skills (refactor or reclassify as `liveFetch`)
6. Stubs (`read_inbox`) → tagged `liveFetch` with rationale "pending P4"

Each refactor: replace provider API calls with `canonicalDataService` calls, update `readPath` tag, update system-prompt context (add freshness expectations), add/update `*Pure.ts` tests for helper logic.

### New files

| File | Purpose |
|------|---------|
| `scripts/verify-skill-read-paths.sh` | Gate: every action has `readPath`, `liveFetch` actions have `liveFetchRationale` |
| `scripts/verify-canonical-read-interface.sh` | Gate: no raw Drizzle queries on `canonical_*` tables outside `canonicalDataService` |

### Files to modify

| File | Change |
|------|--------|
| `server/config/actionRegistry.ts` | Add `readPath` + `liveFetchRationale` to `ActionDefinition`. Tag every existing action. |
| `server/services/canonicalDataService.ts` | Add new read methods as skills refactor |
| `server/services/skillExecutor.ts` | Skills migrated from provider-direct to canonical |
| `scripts/run-all-gates.sh` | Add two new gates |

### Static gates

- `scripts/verify-skill-read-paths.sh` — iterates `ActionDefinition` entries. Fails if: `readPath` is missing; `readPath === 'liveFetch'` but `liveFetchRationale` is missing; a skill file imports a provider SDK but `readPath !== 'liveFetch'`.
- `scripts/verify-canonical-read-interface.sh` — greps for `from.*canonical_` or `canonical_accounts|canonical_contacts|...` pattern in `server/services/` and `server/routes/` outside `canonicalDataService.ts`. Fails if found.

---

## P2B — Data dictionary skill

### Goal

A machine-readable registry of every canonical table — purpose, columns, relationships, freshness expectations, skill references. Agents query it via the `canonical_dictionary` skill. A static gate catches drift between the registry and the actual schema.

### New files

| File | Purpose |
|------|---------|
| `server/services/canonicalDictionary/canonicalDictionaryRegistry.ts` | Registry: one entry per canonical table |
| `server/services/canonicalDictionary/canonicalDictionaryRendererPure.ts` | Pure renderer: given registry + optional filter, returns structured summary for agent context |
| `server/services/canonicalDictionary/canonicalDictionaryValidatorPure.ts` | Pure validator: given Drizzle schema AST + registry, returns drift findings |
| `server/services/__tests__/canonicalDictionaryRendererPure.test.ts` | Fixture tests for rendering |
| `server/services/__tests__/canonicalDictionaryValidatorPure.test.ts` | Fixture tests for drift detection |
| `scripts/verify-canonical-dictionary.sh` | Gate: runs validator against real schema + registry |

### Registry shape

```typescript
export interface CanonicalTableEntry {
  tableName: string;
  humanName: string;
  purpose: string;
  principalSemantics: string;
  visibilityFields: { ownerUserId?: boolean; visibilityScope?: boolean; sharedTeamIds?: boolean };
  columns: Array<{ name: string; type: string; purpose: string }>;
  foreignKeys: Array<{ column: string; referencesTable: string; referencesColumn: string }>;
  freshnessPeriod: string;
  skillReferences: string[];
}

export const CANONICAL_DICTIONARY_REGISTRY: CanonicalTableEntry[] = [
  // One entry per canonical table — populated during P2B
];
```

### Skill registration

```typescript
// In actionRegistry.ts
{
  actionType: 'canonical_dictionary',
  readPath: 'canonical',
  description: 'Query the canonical data dictionary for table metadata, columns, relationships, and skill references.',
  // ... standard fields ...
}
```

### Agent opt-in

`agentConfigService` gains an optional `includeDictionaryContext: boolean` flag on agent configurations. When true, dictionary summary is injected into the agent's system context at run start via `canonicalDictionaryRendererPure`. At least one existing agent (the reporting agent) is configured and verified against fixtures.

### Files to modify

| File | Change |
|------|--------|
| `server/config/actionRegistry.ts` | Add `canonical_dictionary` action |
| `server/services/skillExecutor.ts` | Handler for `canonical_dictionary` — calls renderer with filter from skill args |
| `scripts/run-all-gates.sh` | Add `verify-canonical-dictionary.sh` |

### Static gate

`scripts/verify-canonical-dictionary.sh` — runs `canonicalDictionaryValidatorPure` against the actual Drizzle schema and the registry. Fails on: missing entries, stale column lists, orphan registry rows.

---

## P3A — Principal-model schema + context propagation

### Goal

Every database session, every service call, every job handler carries a typed `PrincipalContext`. All canonical tables and `integration_connections` gain ownership/visibility columns. `canonicalDataService` signature changes from `(organisationId, ...)` to `(principal, ...)`.

### Migration 0162 — principal tables

```sql
CREATE TABLE service_principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid,
  service_id text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  UNIQUE (organisation_id, service_id)
);

CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE team_members (
  team_id uuid NOT NULL REFERENCES teams(id),
  user_id uuid NOT NULL REFERENCES users(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE delegation_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grantor_user_id uuid NOT NULL REFERENCES users(id),
  grantee_kind text NOT NULL CHECK (grantee_kind IN ('user','service')),
  grantee_id text NOT NULL,
  subaccount_id uuid,
  allowed_canonical_tables text[] NOT NULL,
  allowed_actions text[] NOT NULL,
  reason text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX delegation_grants_active_idx
  ON delegation_grants (grantor_user_id, grantee_kind, grantee_id, subaccount_id)
  WHERE revoked_at IS NULL;

CREATE TABLE canonical_row_subaccount_scopes (
  canonical_table text NOT NULL,
  canonical_row_id uuid NOT NULL,
  subaccount_id uuid NOT NULL,
  attribution text NOT NULL CHECK (attribution IN ('primary','mentioned','shared')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (canonical_table, canonical_row_id, subaccount_id)
);

CREATE INDEX canonical_row_subaccount_scopes_sub_idx
  ON canonical_row_subaccount_scopes (subaccount_id, canonical_table);
```

### Migration 0163 — connection ownership

```sql
ALTER TABLE integration_connections
  ADD COLUMN IF NOT EXISTS ownership_scope text NOT NULL DEFAULT 'subaccount'
    CHECK (ownership_scope IN ('user','subaccount','organisation')),
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS classification text NOT NULL DEFAULT 'shared_mailbox'
    CHECK (classification IN ('personal','shared_mailbox','service_account')),
  ADD COLUMN IF NOT EXISTS visibility_scope text NOT NULL DEFAULT 'shared_subaccount'
    CHECK (visibility_scope IN ('private','shared_team','shared_subaccount','shared_org')),
  ADD COLUMN IF NOT EXISTS shared_team_ids uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE integration_connections
  ADD CONSTRAINT connection_owner_consistency CHECK (
    (ownership_scope = 'user' AND owner_user_id IS NOT NULL)
    OR (ownership_scope <> 'user' AND owner_user_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS integration_connections_owner_user_id_idx
  ON integration_connections (owner_user_id) WHERE deleted_at IS NULL;

-- Backfill: all existing connections are subaccount-owned shared mailboxes
UPDATE integration_connections
  SET ownership_scope = 'subaccount',
      classification = 'shared_mailbox',
      visibility_scope = 'shared_subaccount'
  WHERE ownership_scope = 'subaccount';
```

### Migration 0164 — agent_runs principal fields

```sql
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS principal_type text NOT NULL DEFAULT 'user'
    CHECK (principal_type IN ('user','service','delegated')),
  ADD COLUMN IF NOT EXISTS principal_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS acting_as_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS delegation_grant_id uuid;

CREATE INDEX IF NOT EXISTS agent_runs_principal_idx
  ON agent_runs (principal_type, principal_id);

-- Backfill
UPDATE agent_runs SET principal_type = 'user', principal_id = user_id::text
  WHERE user_id IS NOT NULL AND principal_id = '';
UPDATE agent_runs SET principal_type = 'service', principal_id = 'service:unknown-legacy'
  WHERE user_id IS NULL AND principal_id = '';
```

Note: `is_test_run` (migration 0153) is orthogonal to `principal_type` — a user-principal run can be a test run; a service-principal run cannot.

### Migration 0165 — canonical table columns

Adds to every existing canonical table (`canonical_accounts`, `canonical_contacts`, `canonical_opportunities`, `canonical_conversations`, `canonical_revenue`, `canonical_metrics`):

```sql
ALTER TABLE <table>
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS visibility_scope text NOT NULL DEFAULT 'shared_subaccount'
    CHECK (visibility_scope IN ('private','shared_team','shared_subaccount','shared_org')),
  ADD COLUMN IF NOT EXISTS shared_team_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_connection_id uuid REFERENCES integration_connections(id);

CREATE INDEX IF NOT EXISTS <table>_owner_user_id_idx
  ON <table> (organisation_id, owner_user_id) WHERE deleted_at IS NULL AND owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS <table>_shared_team_gin_idx
  ON <table> USING gin (shared_team_ids);
CREATE INDEX IF NOT EXISTS <table>_source_connection_idx
  ON <table> (source_connection_id, ingested_at DESC) WHERE source_connection_id IS NOT NULL;
```

Backfill: `source_connection_id` set from existing `connector_config_id` linkage where available. All rows default to `visibility_scope = 'shared_subaccount'`.

### New files

| File | Purpose |
|------|---------|
| `server/services/principal/types.ts` | `PrincipalContext`, `UserPrincipal`, `ServicePrincipal`, `DelegatedPrincipal` types |
| `server/services/principal/principalContext.ts` | `buildUserPrincipal()`, `buildServicePrincipal()`, `buildDelegatedPrincipal()` |
| `server/services/principal/visibilityPredicatePure.ts` | `isVisibleTo(row, principal): boolean` — pure predicate |
| `server/services/principal/principalContextConstructorsPure.ts` | Pure builders from fixture data |
| `server/services/principal/delegationGrantValidatorPure.ts` | `validateGrant(grant, action, table, now)` → permit/deny |
| `server/services/__tests__/visibilityPredicatePure.test.ts` | 48+ fixtures: 3 types × 4 scopes × 2 owners × 2 org-match |
| `server/services/__tests__/principalContextConstructorsPure.test.ts` | Invariant tests per type |
| `server/services/__tests__/delegationGrantValidatorPure.test.ts` | Expiry, revocation, scope, action coverage |
| `server/db/withPrincipalContext.ts` | Transaction wrapper — sets session variables, calls `withOrgTx` under the hood |
| `scripts/verify-principal-context-propagation.sh` | Gate: no bare `organisationId` args to `canonicalDataService` |
| `scripts/verify-canonical-required-columns.sh` | Gate: every canonical table has required columns |
| `scripts/verify-connection-shape.sh` | Gate: connection fixtures have ownership/visibility set |

### Files to modify

| File | Change |
|------|--------|
| `server/db/schema/integrationConnections.ts` | Add ownership/visibility columns to Drizzle schema |
| `server/db/schema/agentRuns.ts` | Add principal columns. Comment: `is_test_run` is orthogonal to `principal_type`. |
| `server/db/schema/index.ts` | Export new tables (`servicePrincipals`, `teams`, `teamMembers`, `delegationGrants`, `canonicalRowSubaccountScopes`) |
| All canonical table schemas | Add `owner_user_id`, `visibility_scope`, `shared_team_ids`, `source_connection_id` |
| `server/services/canonicalDataService.ts` | **Breaking change:** all methods `(organisationId, ...)` → `(principal, ...)`. Service extracts org/subaccount/scope from principal. |
| `server/middleware/auth.ts` or new `server/middleware/principalScoping.ts` | Build `UserPrincipal` from session, attach to `req.principal` |
| `server/lib/createWorker.ts` | Extend to build `ServicePrincipal` from job payload `serviceId` field |
| `scripts/run-all-gates.sh` | Add three new gates |

### Principal context lifecycle

**Route handlers:** Middleware builds `UserPrincipal` from `req.user` + `req.orgId` + `req.subaccountId` (existing ALS context). Attached to `req.principal`. Route handler passes `req.principal` to service calls.

**Job handlers:** `createWorker()` extended — if job payload contains `serviceId`, builds `ServicePrincipal`. If payload contains `delegationGrantId`, loads grant, validates, builds `DelegatedPrincipal`. Handler receives principal in job context.

**Webhook handlers:** Build `ServicePrincipal` scoped to the webhook's named service (e.g. `service:ghl-webhook`). If webhook-originated work acts on behalf of a user, delegation grant is set up at connection time.

### `canonicalDataService` signature migration

This is the widest-reaching change. Every caller of `canonicalDataService` updates in the same commit. The static gate `verify-principal-context-propagation.sh` catches any caller still passing bare `organisationId`.

Before: `canonicalDataService.getAccountsByOrg(organisationId, filters)`
After: `canonicalDataService.getAccountsByOrg(principal, filters)`

The service internally calls `principal.organisationId` and applies visibility filtering via `visibilityPredicatePure`.

---

## P3B — Postgres RLS + enforcement

**Entry criteria:** P3A landed — all tables carry required columns, all callers pass principal context, three P3A static gates pass.

### Session-variable convention

P3B introduces three new `SET LOCAL` variables alongside the existing `app.organisation_id`:

| Variable | Type | Set by | Notes |
|----------|------|--------|-------|
| `app.organisation_id` | uuid | `withOrgTx` (existing) | **Already shipped.** Unchanged. |
| `app.current_subaccount_id` | uuid | `withPrincipalContext` | Null string `''` for org-level runs |
| `app.current_principal_type` | text | `withPrincipalContext` | `'user'`, `'service'`, or `'delegated'` |
| `app.current_principal_id` | text | `withPrincipalContext` | userId, serviceId, or acting-as-userId |
| `app.current_team_ids` | text | `withPrincipalContext` | Comma-separated uuid list; `''` for service/delegated |

**Naming asymmetry decision (resolved):** Keep `app.organisation_id` as-is. The `current_` prefix applies only to the new principal variables. Rationale: renaming `app.organisation_id` → `app.current_organisation_id` would rewrite 25+ existing RLS policies, `orgScoping.ts`, and `withOrgTx` — cosmetic gain, wide blast radius, zero security value. Accept the asymmetry.

**`app.current_team_ids` encoding:** Postgres `current_setting()` returns text. Team IDs are stored as a comma-separated string (`'uuid1,uuid2,...'`). Policies cast via `string_to_array(current_setting('app.current_team_ids', true), ',')::uuid[]` and use the `&&` (overlap) operator against the row's `shared_team_ids` column. Empty string yields empty array after cast, which never overlaps — correct default-deny.

### Migration 0166 — RLS policies for principal tables

Enables RLS and creates policies on the tables introduced by P3A migrations 0162–0163:

```sql
-- service_principals: org-scoped, readable by any authenticated principal in the org
ALTER TABLE service_principals ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_principals_org_read ON service_principals
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );
CREATE POLICY service_principals_org_write ON service_principals
  FOR ALL USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND current_setting('app.current_principal_type', true) = 'user'
  );

-- teams: org-scoped
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY teams_org_read ON teams
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- team_members: org-scoped, users can see all members in their org
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_members_org_read ON team_members
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- delegation_grants: only the granting user or the grantee can see their own grants
ALTER TABLE delegation_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY delegation_grants_principal_read ON delegation_grants
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (
      granted_by_user_id::text = current_setting('app.current_principal_id', true)
      OR grantee_service_id::text = current_setting('app.current_principal_id', true)
    )
  );

-- canonical_row_subaccount_scopes: org-scoped (rows are system-managed)
ALTER TABLE canonical_row_subaccount_scopes ENABLE ROW LEVEL SECURITY;
CREATE POLICY crss_org_read ON canonical_row_subaccount_scopes
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
  );
```

### Migration 0167 — RLS policies for canonical tables + integration_connections

Extends the existing org-level RLS on `integration_connections` with principal-scoped visibility. Adds RLS to canonical tables (which currently have no policies because they ship with P2/P4/P5, but the table structures exist from earlier migrations and P3A columns).

**Representative policy — `canonical_contacts` (1:1 scoped):**

```sql
ALTER TABLE canonical_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY canonical_contacts_principal_read ON canonical_contacts
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (
      -- service principals: shared-scope rows in their subaccount
      (current_setting('app.current_principal_type', true) = 'service'
        AND visibility_scope IN ('shared_subaccount', 'shared_org')
        AND (subaccount_id IS NULL
             OR subaccount_id = current_setting('app.current_subaccount_id', true)::uuid))
      OR
      -- user principals: scope-dependent
      (current_setting('app.current_principal_type', true) = 'user' AND (
        (visibility_scope = 'private'
          AND owner_user_id::text = current_setting('app.current_principal_id', true))
        OR (visibility_scope = 'shared_team'
          AND shared_team_ids && string_to_array(
            current_setting('app.current_team_ids', true), ',')::uuid[])
        OR (visibility_scope = 'shared_subaccount'
          AND (subaccount_id IS NULL
               OR subaccount_id = current_setting('app.current_subaccount_id', true)::uuid))
        OR visibility_scope = 'shared_org'
      ))
      OR
      -- delegated principals: private rows owned by the delegating user only
      (current_setting('app.current_principal_type', true) = 'delegated'
        AND visibility_scope = 'private'
        AND owner_user_id::text = current_setting('app.current_principal_id', true))
    )
  );
```

This pattern repeats for every canonical table. The migration generator (`rlsPredicateSqlBuilderPure.ts`) produces the SQL from a table's scoping shape — 1:1 scoped tables get the pattern above; multi-scoped tables (emails, calendar events) join through `canonical_row_subaccount_scopes`.

**`integration_connections` principal-scoped extension:**

```sql
-- Drop existing org-only policy, replace with principal-aware policy
DROP POLICY IF EXISTS integration_connections_org_isolation
  ON integration_connections;

CREATE POLICY integration_connections_principal_read ON integration_connections
  FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (
      -- subaccount/org-owned shared connections: visible to all in scope
      (ownership_scope IN ('subaccount', 'organisation')
        AND visibility_scope IN ('shared_subaccount', 'shared_org'))
      OR
      -- user-owned personal connections: visible to owner only (or delegated)
      (ownership_scope = 'user'
        AND owner_user_id::text = current_setting('app.current_principal_id', true))
      OR
      -- user-owned shared-team connections
      (ownership_scope = 'user'
        AND visibility_scope = 'shared_team'
        AND shared_team_ids && string_to_array(
          current_setting('app.current_team_ids', true), ',')::uuid[])
    )
  );
```

### `withPrincipalContext` implementation

Located at `server/db/withPrincipalContext.ts`. Wraps the existing `withOrgTx`:

```typescript
import { withOrgTx } from '../middleware/orgScoping';
import type { PrincipalContext } from '../services/principal/types';

export async function withPrincipalContext<T>(
  principal: PrincipalContext,
  work: (tx: DbHandle) => Promise<T>,
): Promise<T> {
  return withOrgTx(principal.organisationId, async (tx) => {
    await tx.execute(sql`
      SELECT
        set_config('app.current_subaccount_id',
          ${principal.subaccountId ?? ''}, true),
        set_config('app.current_principal_type',
          ${principal.type}, true),
        set_config('app.current_principal_id',
          ${principal.id}, true),
        set_config('app.current_team_ids',
          ${(principal.teamIds ?? []).join(',')}, true)
    `);
    return work(tx);
  });
}
```

`withOrgTx` already sets `app.organisation_id` and opens a transaction. `withPrincipalContext` layers the principal variables on top. The `true` parameter to `set_config` makes the setting transaction-local (`SET LOCAL` equivalent).

### `canonical_writer` role

Adapter write paths need to bypass RLS on INSERT/UPDATE to canonical tables. A dedicated role avoids granting `admin_role` to adapters:

```sql
-- In migration 0166, before enabling RLS on canonical tables
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'canonical_writer') THEN
    CREATE ROLE canonical_writer;
  END IF;
END $$;

-- For each canonical table:
ALTER TABLE canonical_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY canonical_contacts_writer_bypass ON canonical_contacts
  FOR ALL
  TO canonical_writer
  USING (true)
  WITH CHECK (true);
```

Adapter services call `SET LOCAL ROLE canonical_writer` within their transaction before writing. The transaction wrapper reverts the role on commit/rollback. This is narrower than `admin_role` — `canonical_writer` can write canonical tables but cannot bypass RLS on `tasks`, `agent_runs`, or any other app-surface table.

### RLS exclusion registry

`server/db/rlsExclusions.ts` — documents tables that legitimately bypass principal-scoped RLS:

```typescript
export interface RlsExclusion {
  tableName: string;
  rationale: string;
}

export const RLS_EXCLUSIONS: ReadonlyArray<RlsExclusion> = [
  { tableName: 'organisations', rationale: 'Platform-level — no tenant column' },
  { tableName: 'users', rationale: 'Cross-org — users can belong to multiple orgs' },
  { tableName: 'system_agents', rationale: 'Platform templates — identical for all orgs' },
  { tableName: 'skill_definitions', rationale: 'System-managed skill catalogue' },
  { tableName: 'action_registry', rationale: 'System-managed action catalogue' },
  // ... additional platform-level tables
];

export const RLS_EXCLUDED_TABLE_NAMES: ReadonlySet<string> = new Set(
  RLS_EXCLUSIONS.map((t) => t.tableName),
);
```

The static gate `verify-rls-coverage.sh` (already exists) is extended: every table not in `RLS_PROTECTED_TABLES` and not in `RLS_EXCLUSIONS` is a gate failure.

### Visibility parity harness

`server/services/__tests__/visibilityParityHarness.ts` — ensures the pure TypeScript predicate (`isVisibleTo`) and the Postgres RLS policy produce identical results for the same fixture data.

**Approach:**

1. Define a fixture set: 48+ rows spanning 3 principal types × 4 visibility scopes × 2 ownership states × 2 org-match states.
2. For each row, run the pure `isVisibleTo(row, principal)` predicate and record the boolean result.
3. Seed a throwaway Postgres schema (using the test database) with the same rows and policies.
4. For each principal in the fixture set, `SET LOCAL` the session variables and `SELECT` from the table. Record which rows are returned.
5. Assert: the set of visible rows from step 2 matches step 4 exactly.

This runs as a static gate (`scripts/verify-visibility-parity.sh`), not a runtime test. It uses the existing test database connection and runs in a transaction that rolls back — no persistent state.

### New files

| File | Purpose |
|------|---------|
| `server/db/withPrincipalContext.ts` | Transaction wrapper — sets principal session variables on top of `withOrgTx` |
| `server/db/rlsExclusions.ts` | Registry of tables that legitimately bypass RLS, with rationale |
| `server/services/principal/rlsPredicateSqlBuilderPure.ts` | Generates `CREATE POLICY` SQL from a table's scoping shape descriptor |
| `server/services/__tests__/rlsPredicateSqlBuilderPure.test.ts` | Fixture tests: 1:1 scoped, multi-scoped, personal-owned tables |
| `server/services/__tests__/visibilityParityHarness.ts` | Parity harness: pure predicate vs. SQL policy on shared fixtures |
| `scripts/verify-visibility-parity.sh` | Gate: runs parity harness, fails on any divergence |

### Files to modify

| File | Change |
|------|--------|
| `server/config/rlsProtectedTables.ts` | Add entries for `service_principals`, `teams`, `team_members`, `delegation_grants`, `canonical_row_subaccount_scopes`, and all canonical tables with their P3B policy migrations |
| `scripts/verify-rls-coverage.sh` | Extend to check `RLS_EXCLUSIONS` — tables not in either manifest fail the gate |
| `scripts/verify-rls-contract-compliance.sh` | Extend: callers of `canonicalDataService` or any query on canonical tables must go through `withPrincipalContext`, not bare `withOrgTx` |
| `scripts/run-all-gates.sh` | Add `verify-visibility-parity.sh` |
| `server/middleware/orgScoping.ts` (or equivalent) | No change — `withOrgTx` remains as-is; `withPrincipalContext` layers on top |

### Migration to `withPrincipalContext`

Every call site currently using `withOrgTx` for canonical-data operations migrates to `withPrincipalContext`. Non-canonical operations (existing app tables like `tasks`, `agent_runs`, `review_items`) continue to use `withOrgTx` — their existing org-level RLS is sufficient and they do not carry principal-scoped visibility columns.

The static gate `verify-rls-contract-compliance.sh` is extended with a new check: any file that imports from `canonicalDataService` must also import `withPrincipalContext` (or receive a principal via its function signature). Direct `withOrgTx` + `canonicalDataService` is a gate failure.

---

## Cross-cutting concerns

### Error handling

All new services follow existing convention: throw `{ statusCode, message, errorCode? }`. No new error types. Adapter failures (external API errors, rate limits) use `withBackoff` for retries and `TripWire` for circuit-breaking — both already exist.

### Logging

New services use the existing structured logger. Key log events:

| Event | Level | Where |
|-------|-------|-------|
| Sync job started/completed | info | `canonicalSyncSchedulerJob.ts` |
| Connector stale detected | warn | `staleConnectorDetector.ts` |
| `readPath` tag mismatch (action registry vs actual) | warn | `verify-read-path-tags.sh` output |
| Principal context set | debug | `withPrincipalContext.ts` |
| RLS policy check failure (denied row) | silent | Postgres — no app-level log; rows simply excluded |
| Data dictionary cache miss/rebuild | debug | `canonicalDictionarySkill.ts` |

### Transaction boundaries

- **Sync jobs:** Each adapter tick runs in a single transaction via `withOrgTx`. If the adapter writes 50 canonical rows in one tick, all 50 commit or roll back together.
- **P3B `withPrincipalContext`:** Every principal-scoped operation runs in a transaction. Session variables are transaction-local (`SET LOCAL` via `set_config(..., true)`). No ambient session state leaks between requests.
- **Data dictionary skill:** Read-only — no transaction needed. Uses `getOrgScopedDb` for reads.

### Performance considerations

- **`canonical_row_subaccount_scopes` join:** Multi-scoped tables (emails, calendar events in P4+) join through this table for RLS. Index on `(canonical_table, canonical_row_id)` ensures the join is indexed. For P1–P3 there are no multi-scoped canonical tables yet, so this join path is defined but not exercised until P4.
- **`shared_team_ids` GIN index:** The `&&` overlap operator on `uuid[]` requires a GIN index. Migration 0165 adds this to every canonical table. Cost: one GIN index per canonical table. Acceptable — canonical tables are write-rarely, read-often.
- **Session variable overhead:** Five `set_config` calls per transaction. Negligible — each is a hash-table insert in Postgres shared memory.

### Migration ordering and rollback

Migrations 0160–0167 are strictly ordered. Each migration uses `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` guards for idempotency. Rollback is manual (no down-migrations in this project's convention) but straightforward:

- Column additions: `ALTER TABLE ... DROP COLUMN IF EXISTS`
- Policy additions: `DROP POLICY IF EXISTS ... ON ...`
- Table additions: `DROP TABLE IF EXISTS`
- Role additions: `DROP ROLE IF EXISTS`

No migration modifies existing column types or drops existing columns. All changes are additive.

---

## Static gates summary

All gates run in `scripts/run-all-gates.sh`. New gates are appended; existing gates are extended where noted.

| Gate | Sub-phase | New / Extended | What it checks |
|------|-----------|---------------|----------------|
| `verify-read-path-tags.sh` | P2A | New | Every action-registry entry has a `readPath` tag; tag value matches actual implementation |
| `verify-canonical-dictionary.sh` | P2B | New | Dictionary YAML parses; every canonical table has an entry; field list matches Drizzle schema |
| `verify-principal-context-propagation.sh` | P3A | New | No bare `organisationId` args to `canonicalDataService`; all callers pass `PrincipalContext` |
| `verify-canonical-required-columns.sh` | P3A | New | Every canonical table has `owner_user_id`, `visibility_scope`, `shared_team_ids`, `source_connection_id` |
| `verify-connection-shape.sh` | P3A | New | Connection fixtures have `ownership_scope`, `classification`, `visibility_scope` set |
| `verify-rls-coverage.sh` | P3B | Extended | Adds canonical + principal tables to manifest; checks `RLS_EXCLUSIONS` registry — unaccounted tables fail |
| `verify-rls-contract-compliance.sh` | P3B | Extended | `canonicalDataService` callers must use `withPrincipalContext`; no bare `withOrgTx` for canonical operations |
| `verify-visibility-parity.sh` | P3B | New | Pure predicate vs. SQL policy parity on 48+ fixture rows |

### Existing gates (unchanged, still run)

- `verify-rls-coverage.sh` (base functionality from Sprint 2)
- `verify-rls-contract-compliance.sh` (base functionality from Sprint 2)
- All other gates in `scripts/run-all-gates.sh` — no interference from P1–P3 changes

---

## Decisions resolved for this spec

These decisions were open in the parent roadmap spec. This implementation spec resolves them:

| # | Decision | Resolution | Rationale |
|---|----------|------------|-----------|
| 1 | `app.organisation_id` naming asymmetry | Keep as-is; new variables use `app.current_*` prefix | Renaming rewrites 25+ policies for zero security gain |
| 2 | `app.current_team_ids` encoding | Comma-separated text, cast in policy SQL | Postgres `current_setting` returns text; no native array support for session vars |
| 3 | `canonical_writer` vs. `admin_role` for adapter writes | New `canonical_writer` role | Narrower than `admin_role`; adapters should not have break-glass access to app tables |
| 4 | Parity harness: runtime test vs. static gate | Static gate using test DB in rollback transaction | Matches project testing posture; no runtime test infra needed |
| 5 | `readPath` tag storage | Field on action-registry entries (in-memory config, not DB column) | No migration needed; tag is developer-facing, not user-facing |
| 6 | Data dictionary format | YAML with structured field descriptors | Machine-readable for agents; human-readable for developers; parseable by static gate |
| 7 | Sync scheduler: pg-boss vs. custom | pg-boss via `createWorker()` | Existing primitive; no new job infrastructure |
| 8 | Stale-connector detection: separate detector vs. inline check | `workspaceHealth/detectors/` detector | Matches existing detector pattern; surfaced in workspace health dashboard |

---

## Exit criteria per sub-phase

### P1 — Scheduled polling + stale-connector detector

- [ ] Migration 0160 applied — `connector_configs` has `sync_interval_minutes`, `last_sync_at`, `next_sync_at`, `sync_status`
- [ ] `canonicalSyncSchedulerJob` registered via `createWorker()` and fires on schedule
- [ ] Adapters called per connector config; `last_sync_at` / `next_sync_at` updated on completion
- [ ] `staleConnectorDetector.ts` registered in `workspaceHealth/detectors/index.ts`
- [ ] Detector fires finding when `last_sync_at` older than threshold
- [ ] `syncSchedulerPure.test.ts` passes — tick selection, jitter, error handling
- [ ] `staleConnectorDetectorPure.test.ts` passes — threshold, grace period, edge cases
- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean
- [ ] `pr-reviewer` + `dual-reviewer` passed

### P2A — Read-path consolidation

- [ ] Migration 0161 applied (if metadata column needed; otherwise config-only)
- [ ] Every action-registry entry has `readPath: 'canonical' | 'liveFetch' | 'none'`
- [ ] `canonicalDataService` extended with connection-aware read methods
- [ ] `verify-read-path-tags.sh` gate passes
- [ ] Gate added to `scripts/run-all-gates.sh`
- [ ] `readPathResolutionPure.test.ts` passes
- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean
- [ ] `pr-reviewer` + `dual-reviewer` passed

### P2B — Data dictionary skill

- [ ] `canonical-data-dictionary.yaml` exists with entries for every canonical table
- [ ] `canonicalDictionarySkill.ts` registered in action registry
- [ ] Skill returns structured field metadata when invoked by agent
- [ ] `verify-canonical-dictionary.sh` gate passes — YAML parses, tables covered, fields match schema
- [ ] Gate added to `scripts/run-all-gates.sh`
- [ ] `dictionaryParserPure.test.ts` passes
- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean
- [ ] `pr-reviewer` + `dual-reviewer` passed

### P3A — Principal-model schema + context propagation

- [ ] Migrations 0162–0165 applied — `service_principals`, `teams`, `team_members`, `delegation_grants`, `canonical_row_subaccount_scopes` tables created; `integration_connections` and `agent_runs` extended; canonical tables extended
- [ ] `PrincipalContext` types defined with `UserPrincipal`, `ServicePrincipal`, `DelegatedPrincipal`
- [ ] `visibilityPredicatePure.ts` implemented with 48+ fixture tests passing
- [ ] `delegationGrantValidatorPure.ts` implemented with expiry/revocation/scope tests passing
- [ ] `canonicalDataService` signature migrated — all callers pass `PrincipalContext`
- [ ] `verify-principal-context-propagation.sh` passes
- [ ] `verify-canonical-required-columns.sh` passes
- [ ] `verify-connection-shape.sh` passes
- [ ] All three gates added to `scripts/run-all-gates.sh`
- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean
- [ ] `pr-reviewer` + `dual-reviewer` passed

### P3B — Postgres RLS + enforcement

- [ ] Migrations 0166–0167 applied — RLS policies on all principal and canonical tables
- [ ] `withPrincipalContext` implemented and used at every canonical-data entry point
- [ ] `canonical_writer` role created; adapter write paths use it
- [ ] `rlsExclusions.ts` documents all platform tables that bypass RLS
- [ ] `rlsPredicateSqlBuilderPure.ts` generates correct policy SQL for all table shapes
- [ ] Visibility parity harness passes — pure predicate matches SQL policy on all 48+ fixtures
- [ ] `verify-rls-coverage.sh` passes (extended with new tables + exclusion registry)
- [ ] `verify-rls-contract-compliance.sh` passes (extended with `withPrincipalContext` check)
- [ ] `verify-visibility-parity.sh` passes
- [ ] All gates in `scripts/run-all-gates.sh`
- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean
- [ ] `pr-reviewer` + `dual-reviewer` passed

---

## Appendix: full file inventory

### New files (all sub-phases)

| File | Sub-phase |
|------|-----------|
| `server/jobs/canonicalSyncSchedulerJob.ts` | P1 |
| `server/services/canonicalSyncSchedulerPure.ts` | P1 |
| `server/services/__tests__/canonicalSyncSchedulerPure.test.ts` | P1 |
| `server/services/workspaceHealth/detectors/staleConnectorDetector.ts` | P1 |
| `server/services/workspaceHealth/detectors/staleConnectorDetectorPure.ts` | P1 |
| `server/services/__tests__/staleConnectorDetectorPure.test.ts` | P1 |
| `server/services/readPathResolutionPure.ts` | P2A |
| `server/services/__tests__/readPathResolutionPure.test.ts` | P2A |
| `scripts/verify-read-path-tags.sh` | P2A |
| `server/config/canonical-data-dictionary.yaml` | P2B |
| `server/services/canonicalDictionarySkill.ts` | P2B |
| `server/services/dictionaryParserPure.ts` | P2B |
| `server/services/__tests__/dictionaryParserPure.test.ts` | P2B |
| `scripts/verify-canonical-dictionary.sh` | P2B |
| `server/services/principal/types.ts` | P3A |
| `server/services/principal/principalContext.ts` | P3A |
| `server/services/principal/visibilityPredicatePure.ts` | P3A |
| `server/services/principal/principalContextConstructorsPure.ts` | P3A |
| `server/services/principal/delegationGrantValidatorPure.ts` | P3A |
| `server/services/__tests__/visibilityPredicatePure.test.ts` | P3A |
| `server/services/__tests__/principalContextConstructorsPure.test.ts` | P3A |
| `server/services/__tests__/delegationGrantValidatorPure.test.ts` | P3A |
| `server/db/withPrincipalContext.ts` | P3A/P3B |
| `scripts/verify-principal-context-propagation.sh` | P3A |
| `scripts/verify-canonical-required-columns.sh` | P3A |
| `scripts/verify-connection-shape.sh` | P3A |
| `server/db/rlsExclusions.ts` | P3B |
| `server/services/principal/rlsPredicateSqlBuilderPure.ts` | P3B |
| `server/services/__tests__/rlsPredicateSqlBuilderPure.test.ts` | P3B |
| `server/services/__tests__/visibilityParityHarness.ts` | P3B |
| `scripts/verify-visibility-parity.sh` | P3B |

### Files to modify (all sub-phases)

| File | Sub-phase | Change |
|------|-----------|--------|
| `server/db/schema/connectorConfigs.ts` | P1 | Add sync scheduling columns |
| `server/jobs/index.ts` | P1 | Register `canonicalSyncSchedulerJob` |
| `server/services/workspaceHealth/detectors/index.ts` | P1 | Export stale-connector detector |
| `server/config/actionRegistry.ts` | P2A, P2B | Add `readPath` tag; register dictionary skill |
| `server/services/canonicalDataService.ts` | P2A, P3A | Connection-aware reads (P2A); signature migration to `PrincipalContext` (P3A) |
| `server/services/skillExecutor.ts` | P2B | Register dictionary skill handler |
| `server/db/schema/integrationConnections.ts` | P3A | Add ownership/visibility columns |
| `server/db/schema/agentRuns.ts` | P3A | Add principal columns |
| `server/db/schema/index.ts` | P3A | Export new tables |
| All canonical table schemas (`server/db/schema/canonical*.ts`) | P3A | Add `owner_user_id`, `visibility_scope`, `shared_team_ids`, `source_connection_id` |
| `server/middleware/auth.ts` or new `server/middleware/principalScoping.ts` | P3A | Build `UserPrincipal` from session |
| `server/lib/createWorker.ts` | P3A | Extend to build `ServicePrincipal` from job payload |
| `server/config/rlsProtectedTables.ts` | P3B | Add all new table entries |
| `scripts/verify-rls-coverage.sh` | P3B | Extend with exclusion registry check |
| `scripts/verify-rls-contract-compliance.sh` | P3B | Extend with `withPrincipalContext` enforcement |
| `scripts/run-all-gates.sh` | P2A, P2B, P3A, P3B | Add all new gates |
