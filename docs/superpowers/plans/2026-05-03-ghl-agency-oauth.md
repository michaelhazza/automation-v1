# GHL Agency-Level OAuth Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship end-to-end agency-level OAuth: install once, enumerate all GHL sub-accounts, persist agency + location tokens, wire adapters.

**Architecture:** Agency token stored in `connector_configs` (`token_scope='agency'`). Location tokens minted on demand and cached in new `connector_location_tokens` table. Nine adapter fetch methods use location tokens; two agency-scope methods keep the agency token. Webhook side effects drive enrolment idempotently via DB-level upsert.

**Tech Stack:** TypeScript, Drizzle ORM, Postgres RLS, pg-boss, vitest, `withBackoff` (existing at `server/lib/withBackoff.ts`), `asyncHandler` (existing at `server/lib/asyncHandler.ts`)

---

## Contents

1. [File Structure](#file-structure)
2. [Task 0 — Build scaffolding + pre-flight](#task-0)
3. [Task 1 — Phase 1: Scope config update](#task-1)
4. [Task 2 — Phase 2a: Migration 0268 SQL](#task-2)
5. [Task 3 — Phase 2b: Drizzle schema updates](#task-3)
6. [Task 4 — Phase 2c/d: State store + ghlAgencyOauthServicePure](#task-4)
7. [Task 5 — Phase 2e: connectorConfigService additions](#task-5)
8. [Task 6 — Phase 2f: ghl.ts rework + oauthIntegrations.ts GHL branch](#task-6)
9. [Task 7 — Phase 2g: connectorPollingTick agency token refresh](#task-7)
10. [Task 8 — Phase 3a: enumerateAgencyLocations](#task-8)
11. [Task 9 — Phase 3b: autoEnrolAgencyLocations](#task-9)
12. [Task 10 — Phase 4a/b: Migration 0269 + connectorLocationTokens schema](#task-10)
13. [Task 11 — Phase 4c/d: locationTokenServicePure + locationTokenService](#task-11)
14. [Task 12 — Phase 4e: Rewire ghlAdapter 9 fetch methods](#task-12)
15. [Task 13 — Phase 5: Webhook side effects](#task-13)
16. [Task 14 — Final sweep + doc sync](#task-14)

---

## Critical Implementation Notes {#notes}

Read these before writing code. They resolve ambiguities in the spec.

### Token storage on connector_configs

**Decision: dedicated columns. Do NOT use `configJson` for agency tokens.**

Migration 0268 adds **8 new columns** to `connector_configs`: the 4 agency-metadata columns (`token_scope`, `company_id`, `installed_at`, `disconnected_at`) plus 4 token columns (`access_token TEXT`, `refresh_token TEXT`, `expires_at TIMESTAMPTZ`, `scope TEXT NOT NULL DEFAULT ''`).

Rationale:
- `expires_at` must be queryable without JSON casting for the polling tick sweep (`lt(connectorConfigs.expiresAt, fiveMinFromNow)`)
- Dedicated columns eliminate type-cast bugs in every read path
- Consistent with `connector_location_tokens` which always uses dedicated columns

All `connectorConfigService` methods in Tasks 5 and 7 read/write these columns directly via Drizzle. No `configJson` access is used for agency tokens.

### poll_enabled column

**Decision: use `status='disconnected'` as the sentinel. Do not add a `poll_enabled` column.**

The polling tick already skips `status='disconnected'` connectors. The UNINSTALL handler sets `status='disconnected'` — this is sufficient and idempotent. Remove any `poll_enabled=false` references in Task 13's UNINSTALL block.

### Callback route URL discrepancy

The spec says redirect URI is `${APP_BASE_URL}/api/oauth/callback`, but `oauthIntegrations.ts` currently registers `GET /api/integrations/oauth2/callback`.

Resolution: add a **new** route `GET /api/oauth/callback` to `server/routes/oauthIntegrations.ts` (or a dedicated file) that handles only the GHL agency flow. Register it in `server/index.ts`. Update `ghl.ts` to use `/api/oauth/callback` as the redirect URI. The existing `/api/integrations/oauth2/callback` route is unchanged (still serves Gmail, Slack, HubSpot, etc.).

**State handling difference:** The new `/api/oauth/callback` uses a raw nonce (from `ghlOAuthStateStore`) as the `state` param — NOT a JWT. Do not run `jwt.verify(state)` in this handler. It is GHL-only.

### oauthIntegrations.ts modification approach

**Mandatory: implement as a completely separate route. Do NOT modify the existing `/api/integrations/oauth2/callback` flow.**

The existing callback validates `state` as a JWT. GHL uses a raw nonce as `state` — mixing these two models in the same handler creates a fragile ordering dependency (GHL branch must precede `jwt.verify`). A separate route eliminates the risk entirely.

1. Keep existing `/api/integrations/oauth2/callback` **completely unchanged** — it still serves Gmail, Slack, HubSpot, etc.
2. Add a NEW `GET /api/oauth/callback` handler in `oauthIntegrations.ts` (as a separate `router.get(...)` registration). This handler MUST NOT call `jwt.verify(state, ...)` — the GHL state param is a raw nonce, not a JWT.
3. Wire the new handler: validate nonce via `consumeGhlOAuthState` → `exchangeGhlAuthCode` → `upsertAgencyConnection` → `autoEnrolAgencyLocations` → redirect to `/onboarding?connected=ghl`
4. Register the new route in `server/index.ts` (or wherever `oauthIntegrations` router is mounted).

### Token encryption (security — mandatory)

**All agency tokens and location tokens MUST be encrypted at rest.** Use `connectionTokenService.encryptToken` / `connectionTokenService.decryptToken`.

Before implementing Tasks 5 or 11, run:
```bash
grep -rn "encryptToken\|decryptToken\|connectionTokenService" server/ --include="*.ts" -l
```
Identify the import path (e.g. `server/services/connectionTokenService.ts` or similar). Note the exact method names from the source.

**Pattern — write path:**
```typescript
import { connectionTokenService } from '../services/connectionTokenService.js';
// ...
accessToken: connectionTokenService.encryptToken(params.accessToken),
refreshToken: connectionTokenService.encryptToken(params.refreshToken),
```

**Pattern — read path (returning token to a caller or using it for an API call):**
```typescript
const rawToken = connectionTokenService.decryptToken(row.accessToken);
```

**Where this applies:**
- Task 5 `upsertAgencyConnection`: encrypt `accessToken` + `refreshToken` on insert and on conflict update
- Task 5 `refreshAgencyTokenIfExpired`: encrypt when writing refreshed tokens; decrypt when reading the stored `refreshToken` to build the refresh request body
- Task 8 `enumerateAgencyLocations`: decrypt `agencyConnection.accessToken` before using it in `Authorization: Bearer`
- Task 11 `mintLocationToken`: (a) decrypt `agencyConnection.accessToken` before using as agency bearer; (b) encrypt `data.access_token` + `data.refresh_token` before INSERT; (c) return `data.access_token` (raw, direct from API — no decrypt needed for the return value); race-loser path: `return connectionTokenService.decryptToken(winner.accessToken)`
- Task 11 `refreshLocationToken`: decrypt stored `refreshToken` before building refresh body; encrypt on UPDATE; return `data.access_token` directly
- Task 11 `getLocationToken` cache-hit: `return connectionTokenService.decryptToken(cached.accessToken)`

### Mandatory log events (§5.9)

Add these structured log calls where missing from the task steps:

| Event key | Where |
|-----------|-------|
| `ghl.oauth.callback_success` | In the `/api/oauth/callback` handler, after `upsertAgencyConnection` succeeds |
| `ghl.oauth.callback_failure` | In the `/api/oauth/callback` handler, on any redirect-to-error path |
| `ghl.token.refresh_failure` | In `refreshLocationToken` when the refresh call exhausts retries (all `withBackoff` attempts failed) — include `locationId`, `orgId`, error message |
| `ghl.token.invalid` | In `handleLocationToken401` when the remint also returns 401 (second 401) — include `locationId`, `orgId` |
| `ghl.token.mint` | Already present in `mintLocationToken` — confirm it fires on every successful new mint |

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `server/lib/ghlOAuthStateStore.ts` | In-process nonce store (singleton Map, TTL 10 min, one-shot); shared between `ghl.ts` (write) and `oauthIntegrations.ts` (validate + consume) |
| `server/services/ghlAgencyOauthServicePure.ts` | Pure: token expiry math, `AgencyTokenResponse` validation, scope serialisation, URL helpers |
| `server/services/ghlAgencyOauthService.ts` | IO: `exchangeGhlAuthCode`, `enumerateAgencyLocations`, `autoEnrolAgencyLocations`, structured logging |
| `server/services/locationTokenServicePure.ts` | Pure: expiry-window check, `LocationTokenResponse` validation, race-loser detection |
| `server/services/locationTokenService.ts` | IO: `getLocationToken` — cache hit / mint / refresh / 401-soft-delete |
| `server/services/__tests__/ghlAgencyOauthServicePure.test.ts` | Unit tests for all pure GHL OAuth helpers |
| `server/services/__tests__/ghlAgencyOauthService.test.ts` | In-process tests with mocked HTTP (callback round-trip, 250-location enumerate) |
| `server/services/__tests__/locationTokenServicePure.test.ts` | Unit tests for location-token pure helpers |
| `server/services/__tests__/locationTokenService.test.ts` | In-process tests with mocked HTTP (mint, refresh, 401 paths) |
| `server/services/__tests__/ghlWebhookMutationsService.test.ts` | In-process tests for INSTALL/UNINSTALL/LocationCreate side-effect chain |
| `server/adapters/__tests__/ghlAdapter.test.ts` | Integration test for 3+ rewired adapter methods through `withLocationToken` wrapper (401 retry, success, second-401 throw) |
| `server/db/schema/connectorLocationTokens.ts` | Drizzle schema for `connector_location_tokens` |
| `migrations/0268_connector_configs_agency_columns.sql` | Adds `token_scope`, `company_id`, `installed_at`, `disconnected_at` to `connector_configs`; two partial unique indexes; `connector_config_id` + `external_id` columns + partial unique index on `subaccounts` |
| `migrations/_down/0268_connector_configs_agency_columns.sql` | Down migration for 0268 |
| `migrations/0269_connector_location_tokens.sql` | Creates `connector_location_tokens`, indexes, RLS policy |
| `migrations/_down/0269_connector_location_tokens.sql` | Down migration for 0269 |
| `tasks/builds/ghl-module-c-oauth/plan.md` | Pointer to this file |
| `tasks/builds/ghl-module-c-oauth/progress.md` | Session progress scratch |
| `tasks/builds/ghl-module-c-oauth/test-agency-decision.md` | Trial-vs-partner cutover criteria (per spec §6 Phase 0) |

### Modified files

| File | Change |
|------|--------|
| `server/config/oauthProviders.ts` | 15-scope list; `authUrl` stays `chooselocation` (verify empirically in Phase 0) |
| `server/routes/ghl.ts` | Fix env var name; redirect URI → `/api/oauth/callback`; drop old callback stub; use shared state store |
| `server/routes/oauthIntegrations.ts` | Add standalone `GET /api/oauth/callback` handler (separate route, not a branch of the existing JWT callback) |
| `server/db/schema/connectorConfigs.ts` | Add `tokenScope`, `companyId`, `installedAt`, `disconnectedAt` columns |
| `server/db/schema/subaccounts.ts` | Add `connectorConfigId`, `externalId` columns |
| `server/db/schema/index.ts` | Export `connectorLocationTokens` |
| `server/services/connectorConfigService.ts` | Add `upsertAgencyConnection`, `findAgencyConnectionByCompanyId`, `refreshAgencyTokenIfExpired` |
| `server/services/ghlWebhookMutationsService.ts` | Extend post-mutation side-effect chain: INSTALL / UNINSTALL / LocationCreate dispatch |
| `server/jobs/connectorPollingTick.ts` | Add agency-token refresh sweep before fanning out sync jobs |
| `server/adapters/ghlAdapter.ts` | Wire 9 location-scoped fetch methods through `getLocationToken`; keep `fetchLocations` + `fetchSubscription` on agency token |
| `server/config/rlsProtectedTables.ts` | Add `connector_location_tokens` entry |
| `docs/capabilities.md` | Mark GHL connector agency-level production-ready after Stage 6b passes |
| `docs/integration-reference.md` | Add agency vs location token model section |

---

## Task 0 — Build scaffolding + pre-flight {#task-0}

**Files:**
- Create: `tasks/builds/ghl-module-c-oauth/plan.md`
- Create: `tasks/builds/ghl-module-c-oauth/progress.md`
- Create: `tasks/builds/ghl-module-c-oauth/test-agency-decision.md`

- [ ] **Step 1: Create build directory and pointer files**

```bash
mkdir -p tasks/builds/ghl-module-c-oauth
```

Write `tasks/builds/ghl-module-c-oauth/plan.md`:
```markdown
# GHL Agency OAuth — Build Plan

See full plan at `docs/superpowers/plans/2026-05-03-ghl-agency-oauth.md`.
Branch: `ghl-agency-oauth` | Build slug: `ghl-module-c-oauth`
```

Write `tasks/builds/ghl-module-c-oauth/progress.md`:
```markdown
# Progress

## Status: IN PROGRESS
## Current task: (update as you go)
## Decisions / blockers: (update as you go)
```

Write `tasks/builds/ghl-module-c-oauth/test-agency-decision.md`:
```markdown
# Test Agency Decision

## Stage 6a — GHL Agency Pro Trial
Use a fresh 14-day Agency Pro trial (own account, zero risk to real clients).
Create 3-5 dummy sub-accounts inside the trial.

## Stage 6b — Design Partner Agency
Transition to the pre-arranged design-partner agency only after all Stage 6a
checks are green.

## Cutover criteria
- All Phase 6 Stage 6a checks pass (zero permission errors, enumeration correct,
  INSTALL + UNINSTALL flows end-to-end, location-token mint-once-per-day verified)
- No test red on the trial after a full reinstall cycle
- Only then: contact design partner to schedule the real-world install
```

- [ ] **Step 2: Pre-flight — confirm `subaccounts` is missing GHL columns**

Run: `grep -n "connector_config_id\|external_id" server/db/schema/subaccounts.ts`
Expected: zero matches — confirms migration 0268 must add both columns.

- [ ] **Step 3: Pre-flight — confirm migration sequence**

Run: `ls migrations/ | grep "^026" | sort | tail -5`
Expected: `0267_agent_recommendations.sql` is the current tail. Next migration is `0268`.

- [ ] **Step 4: Confirm `autoStartOwedOnboardingWorkflows` uses pg-boss**

Run: `grep -rn "autoStartOwedOnboardingWorkflows" server/`
Find the definition. Open the file. Confirm it enqueues via `boss.send(...)` or the pg-boss wrapper, NOT inline execution. If it executes inline, add a TODO comment and fix it in Task 9 before wiring enrolment.

- [ ] **Step 5: Commit scaffolding**

```bash
git add tasks/builds/ghl-module-c-oauth/
git commit -m "chore(ghl-module-c-oauth): build directory + pre-flight docs"
```

---

## Task 1 — Phase 1: Scope config update {#task-1}

**Files:**
- Modify: `server/config/oauthProviders.ts`
- Test: `server/services/__tests__/ghlAgencyOauthServicePure.test.ts` (scope test added in Task 4, but write this one now as the first test)

- [ ] **Step 1: Write the failing scope test**

Create `server/services/__tests__/ghlAgencyOauthServicePure.test.ts` with just the scope test for now:

```typescript
/**
 * ghlAgencyOauthServicePure.test.ts
 * Run: npx tsx server/services/__tests__/ghlAgencyOauthServicePure.test.ts
 */
import { test, expect } from 'vitest';
import { OAUTH_PROVIDERS } from '../../config/oauthProviders.js';

const REQUIRED_SCOPES = [
  'contacts.readonly', 'contacts.write',
  'opportunities.readonly', 'opportunities.write',
  'locations.readonly', 'users.readonly',
  'calendars.readonly', 'funnels.readonly',
  'conversations.readonly', 'conversations.write',
  'conversations/message.readonly', 'businesses.readonly',
  'saas/subscription.readonly', 'companies.readonly',
  'payments/orders.readonly',
];

test('GHL scope list contains all 15 required scopes', () => {
  const configured = OAUTH_PROVIDERS.ghl.scopes;
  for (const s of REQUIRED_SCOPES) {
    expect(configured, `missing scope: ${s}`).toContain(s);
  }
  expect(configured.length, 'scope count').toBe(15);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx server/services/__tests__/ghlAgencyOauthServicePure.test.ts
```
Expected: FAIL — current list has 11 scopes, missing 4.

- [ ] **Step 3: Update oauthProviders.ts with the 15-scope list**

In `server/config/oauthProviders.ts`, replace the `ghl.scopes` array:

```typescript
ghl: {
  authUrl: 'https://marketplace.leadconnectorhq.com/oauth/chooselocation',
  tokenUrl: 'https://services.leadconnectorhq.com/oauth/token',
  scopes: [
    'contacts.readonly',
    'contacts.write',
    'opportunities.readonly',
    'opportunities.write',
    'locations.readonly',
    'users.readonly',
    'calendars.readonly',
    'funnels.readonly',
    'conversations.readonly',
    'conversations.write',
    'conversations/message.readonly',
    'businesses.readonly',
    'saas/subscription.readonly',
    'companies.readonly',
    'payments/orders.readonly',
  ],
},
```

Note: `authUrl` stays as `chooselocation`. The spec says verify empirically; GHL's token-exchange POST sends `user_type=Company` regardless of the install URL — confirm this during Phase 0 dev-portal walkthrough.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsx server/services/__tests__/ghlAgencyOauthServicePure.test.ts
```
Expected: PASS

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```
Expected: no errors on changed files.

- [ ] **Step 6: Commit**

```bash
git add server/config/oauthProviders.ts server/services/__tests__/ghlAgencyOauthServicePure.test.ts
git commit -m "feat(ghl-oauth): update scope list to 15 (add companies.readonly + 3 write scopes)"
```

---

## Task 2 — Phase 2a: Migration 0268 SQL {#task-2}

**Files:**
- Create: `migrations/0268_connector_configs_agency_columns.sql`
- Create: `migrations/_down/0268_connector_configs_agency_columns.sql`

- [ ] **Step 1: Write the up migration**

Create `migrations/0268_connector_configs_agency_columns.sql`:

```sql
-- Migration 0268: GHL agency-level OAuth — connector_configs + subaccounts extensions
-- Spec: docs/ghl-module-c-oauth-spec.md §7 Migrations, §5.4, §6 Phase 2
-- Branch: ghl-agency-oauth

-- ── connector_configs: agency token columns ───────────────────────────────────

ALTER TABLE connector_configs ADD COLUMN token_scope TEXT NOT NULL DEFAULT 'agency';
ALTER TABLE connector_configs ADD COLUMN company_id TEXT;
ALTER TABLE connector_configs ADD COLUMN installed_at TIMESTAMPTZ;
ALTER TABLE connector_configs ADD COLUMN disconnected_at TIMESTAMPTZ;

-- Agency token columns (dedicated, not in configJson — required for expiry queries).
ALTER TABLE connector_configs ADD COLUMN access_token TEXT;
ALTER TABLE connector_configs ADD COLUMN refresh_token TEXT;
ALTER TABLE connector_configs ADD COLUMN expires_at TIMESTAMPTZ;
ALTER TABLE connector_configs ADD COLUMN scope TEXT NOT NULL DEFAULT '';

-- Per-org unique index: one active agency connection per (org, connector_type, agency).
-- Partial: only applies to agency-scope rows that are not yet disconnected.
CREATE UNIQUE INDEX connector_configs_org_agency_uniq
  ON connector_configs(organisation_id, connector_type, company_id)
  WHERE token_scope = 'agency' AND status <> 'disconnected';

-- Global unique index: one GHL agency can belong to only one Automation OS org at a time.
-- Enables O(1) webhook → org routing by (connector_type, company_id).
-- If status becomes 'disconnected', the index slot is freed for re-install under
-- a different org (e.g. after an UNINSTALL + reinstall flow).
CREATE UNIQUE INDEX connector_configs_global_agency_uniq
  ON connector_configs(connector_type, company_id)
  WHERE token_scope = 'agency' AND status <> 'disconnected';

-- ── subaccounts: GHL location linkage columns ────────────────────────────────
-- connector_config_id: which agency install created this sub-account row (nullable for non-GHL)
-- external_id: GHL locationId (nullable for manually-created subaccounts)

ALTER TABLE subaccounts ADD COLUMN connector_config_id UUID REFERENCES connector_configs(id);
ALTER TABLE subaccounts ADD COLUMN external_id TEXT;

-- Partial unique index: one active (connector_config, GHL location) pair.
-- WHERE clause excludes rows that lack either column (manually-created subaccounts).
CREATE UNIQUE INDEX subaccounts_connector_external_uniq
  ON subaccounts(connector_config_id, external_id)
  WHERE deleted_at IS NULL
    AND connector_config_id IS NOT NULL
    AND external_id IS NOT NULL;
```

- [ ] **Step 2: Write the down migration**

Create `migrations/_down/0268_connector_configs_agency_columns.sql`:

```sql
DROP INDEX IF EXISTS subaccounts_connector_external_uniq;
ALTER TABLE subaccounts DROP COLUMN IF EXISTS external_id;
ALTER TABLE subaccounts DROP COLUMN IF EXISTS connector_config_id;

DROP INDEX IF EXISTS connector_configs_global_agency_uniq;
DROP INDEX IF EXISTS connector_configs_org_agency_uniq;
ALTER TABLE connector_configs DROP COLUMN IF EXISTS scope;
ALTER TABLE connector_configs DROP COLUMN IF EXISTS expires_at;
ALTER TABLE connector_configs DROP COLUMN IF EXISTS refresh_token;
ALTER TABLE connector_configs DROP COLUMN IF EXISTS access_token;
ALTER TABLE connector_configs DROP COLUMN IF EXISTS disconnected_at;
ALTER TABLE connector_configs DROP COLUMN IF EXISTS installed_at;
ALTER TABLE connector_configs DROP COLUMN IF EXISTS company_id;
ALTER TABLE connector_configs DROP COLUMN IF EXISTS token_scope;
```

- [ ] **Step 3: Run db:generate to confirm Drizzle can parse the schema**

First complete Task 3 (Drizzle schema updates) then come back and run:
```bash
npm run db:generate
```
Expected: generates a new migration file showing the column additions. Review it — the generated file should match the SQL above. If there are discrepancies, fix the Drizzle schema (Task 3) first.

- [ ] **Step 4: Commit migrations**

```bash
git add migrations/0268_connector_configs_agency_columns.sql migrations/_down/0268_connector_configs_agency_columns.sql
git commit -m "feat(ghl-oauth): migration 0268 — connector_configs agency columns + subaccounts GHL linkage"
```

---

## Task 3 — Phase 2b: Drizzle schema updates {#task-3}

**Files:**
- Modify: `server/db/schema/connectorConfigs.ts`
- Modify: `server/db/schema/subaccounts.ts`

- [ ] **Step 1: Update connectorConfigs.ts**

In `server/db/schema/connectorConfigs.ts`, add four new columns inside the table definition (after `configVersion`):

```typescript
tokenScope: text('token_scope').notNull().default('agency').$type<'agency' | 'location'>(),
companyId: text('company_id'),
installedAt: timestamp('installed_at', { withTimezone: true }),
disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
// Agency token columns — dedicated columns, not configJson (required for expiry queries)
accessToken: text('access_token'),
refreshToken: text('refresh_token'),
expiresAt: timestamp('expires_at', { withTimezone: true }),
scope: text('scope').notNull().default(''),
```

The two partial unique indexes from migration 0268 are SQL-only (expressed in the migration, not Drizzle indexes) — Drizzle cannot express partial unique indexes with `WHERE` clauses in `pgTable`, so do NOT add them to the schema object.

- [ ] **Step 2: Update subaccounts.ts**

In `server/db/schema/subaccounts.ts`, add two columns after `deletedAt`:

First add the import for `connectorConfigs` at the top:
```typescript
import { connectorConfigs } from './connectorConfigs.js';
```

Then add in the table body (after `deletedAt`):
```typescript
connectorConfigId: uuid('connector_config_id').references(() => connectorConfigs.id),
externalId: text('external_id'),
```

The partial unique index `subaccounts_connector_external_uniq` is SQL-only — do not add to Drizzle schema object.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors. If there are circular-import errors on the `connectorConfigs` import in `subaccounts.ts`, move the import to the bottom of the file using a dynamic `() =>` reference — Drizzle supports this via `.references(() => connectorConfigs.id)` which is already a lazy reference.

- [ ] **Step 4: Run db:generate**

```bash
npm run db:generate
```
Review the generated migration file. If it correctly mirrors the 0268 SQL columns, the schema is correct. If it generates unexpected changes, reconcile.

- [ ] **Step 5: Commit schema updates**

```bash
git add server/db/schema/connectorConfigs.ts server/db/schema/subaccounts.ts
git commit -m "feat(ghl-oauth): drizzle schema — connector_configs + subaccounts agency columns"
```

---

## Task 4 — Phase 2c/d: State store + ghlAgencyOauthServicePure {#task-4}

**Files:**
- Create: `server/lib/ghlOAuthStateStore.ts`
- Modify: `server/services/__tests__/ghlAgencyOauthServicePure.test.ts` (add more tests)
- Create: `server/services/ghlAgencyOauthServicePure.ts`

- [ ] **Step 1: Create ghlOAuthStateStore.ts**

Create `server/lib/ghlOAuthStateStore.ts`:

```typescript
// Shared singleton nonce store for GHL agency OAuth CSRF protection.
// ghl.ts writes; oauthIntegrations.ts validates + consumes.
// One-shot: nonce is deleted on first successful validation.
// TTL: 10 minutes from creation.

const NONCE_TTL_MS = 10 * 60 * 1000;

interface GhlOAuthState {
  orgId: string;
  expiresAt: number;
}

// Single-instance only: state is lost on process restart and invisible to other nodes.
// A user who completes OAuth mid-restart will receive invalid_state and must restart the flow.
// Replace with Redis/DB-backed store before running multi-instance or blue-green deployments.
const store = new Map<string, GhlOAuthState>();

export function setGhlOAuthState(nonce: string, orgId: string): void {
  // Prune expired entries on every write to prevent unbounded growth.
  const now = Date.now();
  for (const [key, val] of store) {
    if (val.expiresAt < now) store.delete(key);
  }
  store.set(nonce, { orgId, expiresAt: now + NONCE_TTL_MS });
}

/** Returns orgId if valid; null if missing, expired, or already consumed. */
export function consumeGhlOAuthState(nonce: string): string | null {
  const entry = store.get(nonce);
  if (!entry) return null;
  store.delete(nonce);
  if (entry.expiresAt < Date.now()) return null;
  return entry.orgId;
}
```

- [ ] **Step 2: Add pure-function tests to ghlAgencyOauthServicePure.test.ts**

Append to `server/services/__tests__/ghlAgencyOauthServicePure.test.ts`:

```typescript
import {
  computeAgencyTokenExpiresAt,
  validateAgencyTokenResponse,
  isAgencyTokenExpiringSoon,
  type AgencyTokenResponse,
} from '../ghlAgencyOauthServicePure.js';

// ── computeAgencyTokenExpiresAt ───────────────────────────────────────────

test('computeAgencyTokenExpiresAt: adds expires_in seconds to claimedAt', () => {
  const claimedAt = new Date('2026-05-01T10:00:00Z');
  const result = computeAgencyTokenExpiresAt(claimedAt, 86400);
  expect(result.toISOString()).toBe(new Date('2026-05-02T10:00:00Z').toISOString());
});

// ── isAgencyTokenExpiringSoon ─────────────────────────────────────────────

test('isAgencyTokenExpiringSoon: true when < 5 min remaining', () => {
  const expiresAt = new Date(Date.now() + 3 * 60 * 1000); // 3 min
  expect(isAgencyTokenExpiringSoon(expiresAt)).toBe(true);
});

test('isAgencyTokenExpiringSoon: false when > 5 min remaining', () => {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min
  expect(isAgencyTokenExpiringSoon(expiresAt)).toBe(false);
});

// ── validateAgencyTokenResponse ───────────────────────────────────────────

test('validateAgencyTokenResponse: accepts valid Company token', () => {
  const payload: AgencyTokenResponse = {
    access_token: 'tok_123',
    refresh_token: 'ref_456',
    expires_in: 86399,
    scope: 'contacts.readonly',
    userType: 'Company',
    companyId: 'co_abc',
  };
  expect(() => validateAgencyTokenResponse(payload)).not.toThrow();
});

test('validateAgencyTokenResponse: rejects userType !== Company', () => {
  const payload = {
    access_token: 'tok',
    refresh_token: 'ref',
    expires_in: 86399,
    scope: 'contacts.readonly',
    userType: 'Location',
    companyId: 'co_abc',
  } as unknown as AgencyTokenResponse;
  expect(() => validateAgencyTokenResponse(payload)).toThrow('userType');
});

test('validateAgencyTokenResponse: rejects missing companyId', () => {
  const payload = {
    access_token: 'tok',
    refresh_token: 'ref',
    expires_in: 86399,
    scope: 'contacts.readonly',
    userType: 'Company',
    companyId: '',
  } as AgencyTokenResponse;
  expect(() => validateAgencyTokenResponse(payload)).toThrow('companyId');
});
```

- [ ] **Step 3: Run test to verify it fails (functions don't exist yet)**

```bash
npx tsx server/services/__tests__/ghlAgencyOauthServicePure.test.ts
```
Expected: FAIL — `ghlAgencyOauthServicePure.js` not found.

- [ ] **Step 4: Create ghlAgencyOauthServicePure.ts**

Create `server/services/ghlAgencyOauthServicePure.ts`:

```typescript
// Pure helpers for GHL agency OAuth flow.
// No DB access, no HTTP — testable without infrastructure.

export interface AgencyTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  userType: string;
  companyId: string;
  userId?: string;
  locationId?: string | null;
}

export interface GhlLocation {
  id: string;
  name: string;
  businessId?: string | null;
  companyId: string;
  address?: string | null;
  timezone?: string | null;
}

/** Compute expires_at from when the token was claimed. */
export function computeAgencyTokenExpiresAt(claimedAt: Date, expiresInSeconds: number): Date {
  return new Date(claimedAt.getTime() + expiresInSeconds * 1000);
}

/** True if token expires within 5 minutes (refresh window). */
export function isAgencyTokenExpiringSoon(expiresAt: Date): boolean {
  return expiresAt.getTime() - Date.now() < 5 * 60 * 1000;
}

/** Validate that the GHL token exchange returned a Company-type agency token. */
export function validateAgencyTokenResponse(payload: AgencyTokenResponse): void {
  if (payload.userType !== 'Company') {
    throw Object.assign(
      new Error(`GHL token validation failed: expected userType 'Company', got '${payload.userType}'`),
      { code: 'AGENCY_TOKEN_WRONG_USER_TYPE' },
    );
  }
  if (!payload.companyId) {
    throw Object.assign(
      new Error('GHL token validation failed: companyId is missing or empty'),
      { code: 'AGENCY_TOKEN_MISSING_COMPANY_ID' },
    );
  }
  if (!payload.access_token || !payload.refresh_token) {
    throw Object.assign(
      new Error('GHL token validation failed: access_token or refresh_token missing'),
      { code: 'AGENCY_TOKEN_MISSING_TOKENS' },
    );
  }
}

/** Parse scope string from GHL into an array. */
export function parseGhlScope(scopeStr: string): string[] {
  return scopeStr.split(/\s+/).filter(Boolean);
}

/** Build the GHL token-exchange POST body for initial code exchange. */
export function buildTokenExchangeBody(params: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    user_type: 'Company',
  });
}

/** Build the GHL refresh token POST body. */
export function buildRefreshTokenBody(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx tsx server/services/__tests__/ghlAgencyOauthServicePure.test.ts
```
Expected: PASS (scope test + all pure-function tests)

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add server/lib/ghlOAuthStateStore.ts server/services/ghlAgencyOauthServicePure.ts server/services/__tests__/ghlAgencyOauthServicePure.test.ts
git commit -m "feat(ghl-oauth): ghlOAuthStateStore + ghlAgencyOauthServicePure with tests"
```

---

## Task 5 — Phase 2e: connectorConfigService additions {#task-5}

**Files:**
- Modify: `server/services/connectorConfigService.ts`
- Modify: `server/db/schema/index.ts` (if `connectorLocationTokens` not yet exported — will be done properly in Task 10, but note it here)

- [ ] **Step 1: Read connectorConfigService.ts to understand the existing pattern**

Read `server/services/connectorConfigService.ts` fully. Note:
- DB import pattern
- How existing upsert methods are structured
- How errors are thrown (`{ statusCode, message }` shape)

- [ ] **Step 2: Add upsertAgencyConnection**

Append to the `connectorConfigService` export object in `server/services/connectorConfigService.ts`:

```typescript
async upsertAgencyConnection(params: {
  orgId: string;
  companyId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
}): Promise<typeof connectorConfigs.$inferSelect> {
  // Upsert semantics per spec §6 Phase 2:
  // ON CONFLICT on per-org index → update tokens + clear disconnected_at + set status='active'.
  // A 23505 on the global index (different org) → HTTP 409.
  // Tokens are encrypted at rest — see "Token encryption" Critical Note above.
  const encryptedAccess = connectionTokenService.encryptToken(params.accessToken);
  const encryptedRefresh = connectionTokenService.encryptToken(params.refreshToken);
  try {
    const [row] = await db
      .insert(connectorConfigs)
      .values({
        organisationId: params.orgId,
        connectorType: 'ghl',
        tokenScope: 'agency',
        companyId: params.companyId,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        expiresAt: params.expiresAt,
        scope: params.scope,
        status: 'active',
        installedAt: new Date(),
        disconnectedAt: null,
      } as Parameters<typeof db.insert>[0] extends { values: infer V } ? V : never)
      .onConflictDoUpdate({
        target: [connectorConfigs.organisationId, connectorConfigs.connectorType],
        // Drizzle cannot express partial unique conflict targets directly.
        // Use raw SQL where parameter targeting falls short.
        set: {
          accessToken: encryptedAccess,
          refreshToken: encryptedRefresh,
          expiresAt: params.expiresAt,
          scope: params.scope,
          status: 'active',
          disconnectedAt: null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  } catch (err: unknown) {
    const pg = err as { code?: string; constraint?: string };
    if (pg.code === '23505' && pg.constraint?.includes('global_agency')) {
      throw Object.assign(
        new Error('agency_already_installed_under_different_org'),
        { statusCode: 409, errorCode: 'AGENCY_ALREADY_INSTALLED', companyId: params.companyId },
      );
    }
    throw err;
  }
},
```

**Important implementation note:** The Drizzle `.onConflictDoUpdate` with a partial unique index cannot be expressed using the standard column-array `target`. Use raw SQL for the ON CONFLICT clause via `sql` tagged template from drizzle-orm. Example:

```typescript
import { sql } from 'drizzle-orm';
// ...
.onConflictDoUpdate({
  target: sql`(organisation_id, connector_type, company_id) WHERE token_scope = 'agency' AND status <> 'disconnected'`,
  set: { /* ... */ },
})
```

Check the Drizzle version in `package.json` and verify whether partial-index conflict targets are supported. If not, use a raw `db.execute(sql`INSERT ... ON CONFLICT ... DO UPDATE ...`)` instead.

- [ ] **Step 3: Add findAgencyConnectionByCompanyId**

```typescript
async findAgencyConnectionByCompanyId(companyId: string): Promise<typeof connectorConfigs.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(connectorConfigs)
    .where(
      and(
        eq(connectorConfigs.connectorType, 'ghl'),
        eq(connectorConfigs.companyId, companyId),
        eq(connectorConfigs.tokenScope, 'agency'),
        ne(connectorConfigs.status, 'disconnected'),
      )
    )
    .limit(1);
  return row ?? null;
},
```

- [ ] **Step 4: Add refreshAgencyTokenIfExpired**

```typescript
async refreshAgencyTokenIfExpired(configId: string): Promise<void> {
  const [config] = await db
    .select()
    .from(connectorConfigs)
    .where(and(eq(connectorConfigs.id, configId), eq(connectorConfigs.tokenScope, 'agency')));
  if (!config || !config.expiresAt) return;

  const { isAgencyTokenExpiringSoon, buildRefreshTokenBody } =
    await import('./ghlAgencyOauthServicePure.js');

  if (!isAgencyTokenExpiringSoon(config.expiresAt)) return;

  const clientId = process.env.OAUTH_GHL_CLIENT_ID;
  const clientSecret = process.env.OAUTH_GHL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return;

  const rawRefreshToken = connectionTokenService.decryptToken(config.refreshToken ?? '');
  const body = buildRefreshTokenBody({
    refreshToken: rawRefreshToken,
    clientId,
    clientSecret,
  });

  const GHL_TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';
  const response = await fetch(GHL_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    // 401 means the token is permanently revoked (not a transient error).
    // Mark the connection disconnected so polling stops and the operator is notified.
    if (response.status === 401) {
      await db
        .update(connectorConfigs)
        .set({ status: 'disconnected', disconnectedAt: new Date(), updatedAt: new Date() })
        .where(eq(connectorConfigs.id, configId));
      throw Object.assign(new Error(`Agency token permanently revoked for config ${configId}`), {
        code: 'AGENCY_TOKEN_REVOKED',
        statusCode: 401,
      });
    }
    throw Object.assign(new Error(`Agency token refresh failed: ${response.status} ${text}`), {
      code: 'AGENCY_TOKEN_REFRESH_FAILED',
      statusCode: response.status,
    });
  }

  const data = await response.json() as { access_token: string; refresh_token: string; expires_in: number; scope: string };
  const claimedAt = new Date();
  const { computeAgencyTokenExpiresAt } = await import('./ghlAgencyOauthServicePure.js');

  await db
    .update(connectorConfigs)
    .set({
      accessToken: connectionTokenService.encryptToken(data.access_token),
      refreshToken: connectionTokenService.encryptToken(data.refresh_token),
      expiresAt: computeAgencyTokenExpiresAt(claimedAt, data.expires_in),
      scope: data.scope,
      updatedAt: new Date(),
    })
    .where(eq(connectorConfigs.id, configId));
},
```

**Token storage:** `accessToken`, `refreshToken`, `expiresAt`, and `scope` are dedicated columns added to `connector_configs` by migration 0268 (Task 2) and the Drizzle schema (Task 3). Use them directly — no `configJson` access.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```
Expected: no new errors. Token columns (`accessToken`, `refreshToken`, `expiresAt`, `scope`) were added to `connectorConfigs.ts` in Task 3 and migration 0268 in Task 2.

- [ ] **Step 6: Commit**

```bash
git add server/services/connectorConfigService.ts
git commit -m "feat(ghl-oauth): connectorConfigService — upsertAgencyConnection, findAgencyConnectionByCompanyId, refreshAgencyTokenIfExpired"
```

---

## Task 6 — Phase 2f: ghl.ts rework + oauthIntegrations.ts GHL branch {#task-6}

**Files:**
- Modify: `server/routes/ghl.ts`
- Modify: `server/routes/oauthIntegrations.ts`
- Test: `server/services/__tests__/ghlAgencyOauthService.test.ts` (callback round-trip)

- [ ] **Step 1: Write the callback integration test**

Create `server/services/__tests__/ghlAgencyOauthService.test.ts`:

```typescript
/**
 * ghlAgencyOauthService.test.ts — in-process callback round-trip test.
 * Mocks the GHL token endpoint; exercises the full callback flow.
 *
 * Run: npx tsx server/services/__tests__/ghlAgencyOauthService.test.ts
 */
import { test, expect, vi } from 'vitest';
import { validateAgencyTokenResponse } from '../ghlAgencyOauthServicePure.js';
import { computeAgencyTokenExpiresAt } from '../ghlAgencyOauthServicePure.js';

// ── Callback flow pure logic: token parsing + validation ──────────────────

test('callback flow: valid Company token passes validation', () => {
  const mockResponse = {
    access_token: 'eyJ.agency.tok',
    refresh_token: 'eyJ.refresh',
    expires_in: 86399,
    scope: 'contacts.readonly companies.readonly',
    userType: 'Company',
    companyId: 'co_test123',
    userId: 'user_456',
    locationId: null,
  };
  expect(() => validateAgencyTokenResponse(mockResponse)).not.toThrow();
});

test('callback flow: expiresAt is 86399s after claimedAt', () => {
  const claimedAt = new Date('2026-05-03T10:00:00Z');
  const expiresAt = computeAgencyTokenExpiresAt(claimedAt, 86399);
  const diffSeconds = (expiresAt.getTime() - claimedAt.getTime()) / 1000;
  expect(diffSeconds).toBe(86399);
});

test('callback flow: Location token rejected', () => {
  const mockResponse = {
    access_token: 'eyJ.loc.tok',
    refresh_token: 'eyJ.refresh',
    expires_in: 86399,
    scope: 'contacts.readonly',
    userType: 'Location',
    companyId: 'co_test123',
  };
  expect(() => validateAgencyTokenResponse(mockResponse as Parameters<typeof validateAgencyTokenResponse>[0])).toThrow('Company');
});
```

- [ ] **Step 2: Run test to verify it passes (pure logic is already implemented)**

```bash
npx tsx server/services/__tests__/ghlAgencyOauthService.test.ts
```
Expected: PASS

- [ ] **Step 3: Rework ghl.ts**

Replace the content of `server/routes/ghl.ts` with:

```typescript
import { Router } from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { env } from '../lib/env.js';
import { OAUTH_PROVIDERS, getProviderClientId } from '../config/oauthProviders.js';
import { setGhlOAuthState } from '../lib/ghlOAuthStateStore.js';

const router = Router();

/**
 * GET /api/ghl/oauth-url
 * Generates the GHL install URL and registers the CSRF state nonce.
 * Requires authenticated session — orgId is taken from JWT (never from query params).
 */
router.get('/api/ghl/oauth-url', authenticate, asyncHandler(async (req, res) => {
  const clientId = getProviderClientId('ghl');
  if (!clientId) {
    throw Object.assign(
      new Error('GHL OAuth not configured: OAUTH_GHL_CLIENT_ID missing'),
      { statusCode: 503 },
    );
  }

  const nonce = crypto.randomBytes(32).toString('hex');
  const orgId = req.orgId!;
  setGhlOAuthState(nonce, orgId);

  const callbackBase = env.OAUTH_CALLBACK_BASE_URL || env.APP_BASE_URL;
  const redirectUri = `${callbackBase}/api/oauth/callback`;
  const scopes = OAUTH_PROVIDERS.ghl.scopes.join(' ');

  const url = new URL(OAUTH_PROVIDERS.ghl.authUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scopes);
  url.searchParams.set('state', nonce);

  res.json({ url: url.toString() });
}));

export default router;
```

Key changes: uses `getProviderClientId('ghl')` (reads `OAUTH_GHL_CLIENT_ID`), redirects to generic `/api/oauth/callback`, stores state via `setGhlOAuthState`, drops the old callback stub and locations stub.

- [ ] **Step 4: Add standalone `GET /api/oauth/callback` handler to oauthIntegrations.ts**

**Do NOT modify the existing `GET /api/integrations/oauth2/callback` handler.** Add a completely new `router.get('/api/oauth/callback', ...)` registration. This handler never calls `jwt.verify` — the GHL `state` param is a raw nonce, not a JWT.

Move `exchangeGhlAuthCode` to `server/services/ghlAgencyOauthService.ts` (exported), not inline in the route. Import it here.

```typescript
// ── NEW standalone handler — GHL agency OAuth only ────────────────────────
// This is a separate route from /api/integrations/oauth2/callback.
// GHL state = raw nonce (ghlOAuthStateStore); no JWT verification here.
router.get('/api/oauth/callback', asyncHandler(async (req, res) => {
  const appBase = env.APP_BASE_URL;
  const { code, state } = req.query as Record<string, string | undefined>;

  if (!code || !state) {
    return res.redirect(`${appBase}/onboarding?error=invalid_callback`);
  }

  const { consumeGhlOAuthState } = await import('../lib/ghlOAuthStateStore.js');
  const ghlOrgId = consumeGhlOAuthState(state);
  if (!ghlOrgId) {
    return res.redirect(`${appBase}/onboarding?error=invalid_state`);
  }

  const callbackBase = env.OAUTH_CALLBACK_BASE_URL || env.APP_BASE_URL;
  const redirectUri = `${callbackBase}/api/oauth/callback`;

  const { exchangeGhlAuthCode } = await import('../services/ghlAgencyOauthService.js');
  const tokenData = await exchangeGhlAuthCode(code, redirectUri);
  if (!tokenData) {
    return res.redirect(`${appBase}/onboarding?error=token_exchange_failed`);
  }

  const { validateAgencyTokenResponse, computeAgencyTokenExpiresAt, parseGhlScope } =
    await import('../services/ghlAgencyOauthServicePure.js');

  try {
    validateAgencyTokenResponse(tokenData);
  } catch {
    return res.redirect(`${appBase}/onboarding?error=token_validation_failed`);
  }

  const claimedAt = new Date();
  const expiresAt = computeAgencyTokenExpiresAt(claimedAt, tokenData.expires_in);
  const scope = parseGhlScope(tokenData.scope).join(' ');

  const { connectorConfigService } = await import('../services/connectorConfigService.js');
  let connection;
  try {
    connection = await connectorConfigService.upsertAgencyConnection({
      orgId: ghlOrgId,
      companyId: tokenData.companyId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt,
      scope,
    });
  } catch (err: unknown) {
    const e = err as { statusCode?: number };
    if (e.statusCode === 409) {
      return res.redirect(`${appBase}/onboarding?error=agency_already_installed`);
    }
    return res.redirect(`${appBase}/onboarding?error=storage_failed`);
  }

  logger.info('ghl.oauth.callback_success', {
    event: 'ghl.oauth.callback_success',
    orgId: ghlOrgId,
    companyId: tokenData.companyId,
    locationId: null,
    result: 'success',
    error: null,
  });

  // Fire sub-account enumeration + enrolment. Best-effort — connection stays
  // 'active' even if enumeration fails (spec §6 Phase 3).
  // Hard timeout: 15 s cap so the OAuth redirect never hangs indefinitely.
  try {
    const { autoEnrolAgencyLocations } = await import('../services/ghlAgencyOauthService.js');
    await Promise.race([
      autoEnrolAgencyLocations(ghlOrgId, connection, `oauth_callback:${connection.id}`),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('autoEnrolAgencyLocations timeout')), 15_000),
      ),
    ]);
  } catch (err) {
    logger.warn('ghl.oauth.callback_enrol_failed', { orgId: ghlOrgId, error: String(err) });
    // Do not redirect to error — the agency token is valid. Recovery via INSTALL webhook.
  }

  return res.redirect(`${appBase}/onboarding?connected=ghl`);
}));
// ── End GHL agency callback ───────────────────────────────────────────────
```

Register this route in `server/index.ts` (wherever the `oauthIntegrations` router is mounted, or add a separate `app.use(ghlOAuthCallbackRouter)` if kept in a dedicated file).

Also: add `exchangeGhlAuthCode` to `server/services/ghlAgencyOauthService.ts`:

```typescript
export async function exchangeGhlAuthCode(
  code: string,
  redirectUri: string,
): Promise<AgencyTokenResponse | null> {
  const { buildTokenExchangeBody } = await import('./ghlAgencyOauthServicePure.js');
  const { withBackoff } = await import('../lib/withBackoff.js');
  const clientId = process.env.OAUTH_GHL_CLIENT_ID ?? '';
  const clientSecret = process.env.OAUTH_GHL_CLIENT_SECRET ?? '';
  if (!clientId || !clientSecret) return null;

  const body = buildTokenExchangeBody({ code, redirectUri, clientId, clientSecret });
  const GHL_TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';

  try {
    return await withBackoff(
      async () => {
        const r = await fetch(GHL_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: body.toString(),
          signal: AbortSignal.timeout(20_000),
        });
        if (r.status === 429 || r.status >= 500) {
          throw Object.assign(new Error(`GHL token exchange ${r.status}`), { statusCode: r.status });
        }
        if (!r.ok) return null;
        return r.json() as Promise<AgencyTokenResponse>;
      },
      {
        label: 'ghl.exchangeAuthCode',
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 4000,
        isRetryable: (err) => {
          const e = err as { statusCode?: number };
          return e.statusCode === 429 || (e.statusCode !== undefined && e.statusCode >= 500);
        },
        correlationId: 'oauth_callback',
        runId: code.slice(0, 8),
      },
    );
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add server/routes/ghl.ts server/routes/oauthIntegrations.ts server/lib/ghlOAuthStateStore.ts server/services/__tests__/ghlAgencyOauthService.test.ts
git commit -m "feat(ghl-oauth): rework ghl.ts initiation endpoint + add GHL branch to oauthIntegrations callback"
```

---

## Task 7 — Phase 2g: connectorPollingTick agency token refresh {#task-7}

**Files:**
- Modify: `server/jobs/connectorPollingTick.ts`

- [ ] **Step 1: Add agency token refresh sweep**

In `server/jobs/connectorPollingTick.ts`, add a refresh sweep for agency tokens before the existing integration-connections fan-out:

```typescript
import { eq, and, lt, ne, isNotNull } from 'drizzle-orm';
import { connectorConfigs } from '../db/schema/index.js';
import { connectorConfigService } from '../services/connectorConfigService.js';

// Agency-token refresh sweep (spec §6 Phase 2).
// Refreshes near-expiry agency tokens before issuing poll jobs.
// Runs with the admin db handle (same as the integration-connections sweep below).
// Concurrency cap: 5 concurrent refreshes to avoid hammering the GHL token endpoint.
const AGENCY_REFRESH_CONCURRENCY = 5;

async function refreshNearExpiryAgencyTokens(): Promise<void> {
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
  const nearExpiry = await db
    .select({ id: connectorConfigs.id })
    .from(connectorConfigs)
    .where(
      and(
        eq(connectorConfigs.connectorType, 'ghl'),
        eq(connectorConfigs.tokenScope, 'agency'),
        ne(connectorConfigs.status, 'disconnected'),
        isNotNull(connectorConfigs.expiresAt),
        lt(connectorConfigs.expiresAt, fiveMinFromNow),
      )
    );

  for (let i = 0; i < nearExpiry.length; i += AGENCY_REFRESH_CONCURRENCY) {
    const batch = nearExpiry.slice(i, i + AGENCY_REFRESH_CONCURRENCY);
    await Promise.allSettled(
      batch.map(({ id }) =>
        connectorConfigService.refreshAgencyTokenIfExpired(id).catch((err) => {
          console.error(`[connectorPollingTick] agency token refresh failed for config ${id}:`, err);
        }),
      ),
    );
  }
}
```

Call `refreshNearExpiryAgencyTokens()` at the top of `runConnectorPollingTick`, before the integration-connections loop:

```typescript
export async function runConnectorPollingTick(boss: PgBoss): Promise<void> {
  await refreshNearExpiryAgencyTokens();

  // ... existing integration-connections fan-out code ...
}
```

**Note:** `expiresAt`, `accessToken`, `refreshToken`, and `scope` are dedicated columns on `connector_configs` added in Tasks 2 and 3. Use Drizzle column references directly (e.g. `lt(connectorConfigs.expiresAt, fiveMinFromNow)`) — no JSON casting needed.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add server/jobs/connectorPollingTick.ts
git commit -m "feat(ghl-oauth): connectorPollingTick — refresh near-expiry agency tokens before sync"
```

---

## Task 8 — Phase 3a: enumerateAgencyLocations {#task-8}

**Files:**
- Modify: `server/services/ghlAgencyOauthService.ts` (create if not yet created)
- Modify: `server/services/__tests__/ghlAgencyOauthService.test.ts`

- [ ] **Step 1: Add pagination + truncation tests**

Append to `server/services/__tests__/ghlAgencyOauthService.test.ts`:

```typescript
import { buildLocationSearchUrl, computePaginationPages, checkTruncation } from '../ghlAgencyOauthServicePure.js';

// ── Pagination ────────────────────────────────────────────────────────────

test('computePaginationPages: 0 locations → empty', () => {
  expect(computePaginationPages(0)).toEqual([]);
});

test('computePaginationPages: 1 location → [0]', () => {
  expect(computePaginationPages(1)).toEqual([{ skip: 0, limit: 100 }]);
});

test('computePaginationPages: 100 locations → [0]', () => {
  expect(computePaginationPages(100)).toEqual([{ skip: 0, limit: 100 }]);
});

test('computePaginationPages: 101 locations → [0, 100]', () => {
  expect(computePaginationPages(101)).toEqual([
    { skip: 0, limit: 100 },
    { skip: 100, limit: 100 },
  ]);
});

test('checkTruncation: 1000 locations → truncated', () => {
  expect(checkTruncation(1000)).toBe(true);
});

test('checkTruncation: 999 locations → not truncated', () => {
  expect(checkTruncation(999)).toBe(false);
});
```

- [ ] **Step 2: Add helpers to ghlAgencyOauthServicePure.ts**

Append to `server/services/ghlAgencyOauthServicePure.ts`:

```typescript
export const GHL_PAGINATION_LIMIT = 100;
export const GHL_LOCATION_CAP = 1000;

/** Compute the pagination skip offsets for a known total (used for testing the loop logic). */
export function computePaginationPages(total: number): Array<{ skip: number; limit: number }> {
  if (total === 0) return [];
  const pages: Array<{ skip: number; limit: number }> = [];
  for (let skip = 0; skip < total; skip += GHL_PAGINATION_LIMIT) {
    pages.push({ skip, limit: GHL_PAGINATION_LIMIT });
  }
  return pages;
}

/** True if the enumeration cap was reached (caller should fire notify_operator). */
export function checkTruncation(totalReturned: number): boolean {
  return totalReturned >= GHL_LOCATION_CAP;
}
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
npx tsx server/services/__tests__/ghlAgencyOauthService.test.ts
```
Expected: PASS

- [ ] **Step 4: Create/extend ghlAgencyOauthService.ts with enumerateAgencyLocations**

Create `server/services/ghlAgencyOauthService.ts`:

```typescript
import { withBackoff } from '../lib/withBackoff.js';
import { logger } from '../lib/logger.js';
import { connectorConfigService } from './connectorConfigService.js';
import { connectionTokenService } from './connectionTokenService.js';
import {
  GHL_PAGINATION_LIMIT,
  GHL_LOCATION_CAP,
  checkTruncation,
  type GhlLocation,
} from './ghlAgencyOauthServicePure.js';
import type { ConnectorConfig } from '../db/schema/connectorConfigs.js';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

function ghlHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Version: GHL_API_VERSION,
    'Content-Type': 'application/json',
  };
}

/**
 * Enumerate all GHL locations for an agency via paginated /locations/search.
 * Caps at 1000 per spec §5.5. Returns the flat list of up to 1000 locations.
 * On truncation: fires notify_operator (best-effort) and returns the 1000.
 * On 429/5xx: uses withBackoff (3 retries, 1s/2s/4s exponential).
 * On 401: refreshes agency token once and retries; second 401 → AGENCY_TOKEN_INVALID.
 */
export async function enumerateAgencyLocations(
  agencyConnection: ConnectorConfig,
  correlationId: string,
): Promise<GhlLocation[]> {
  // Decrypt the stored agency token before using it as Authorization: Bearer
  const accessToken = connectionTokenService.decryptToken(
    (agencyConnection as unknown as Record<string, string>).accessToken,
  );
  const companyId = agencyConnection.companyId;
  if (!companyId) throw new Error('enumerateAgencyLocations: companyId missing on connection');

  logger.info('ghl.enumeration.start', {
    event: 'ghl.enumeration.start',
    orgId: agencyConnection.organisationId,
    companyId,
    locationId: null,
    result: 'success',
    error: null,
  });

  const all: GhlLocation[] = [];
  let skip = 0;
  let refreshed = false;
  let currentToken = accessToken;
  let apiCallCount = 0;

  while (all.length < GHL_LOCATION_CAP) {
    const fetchPage = async (): Promise<GhlLocation[]> => {
      const url = new URL(`${GHL_API_BASE}/locations/search`);
      url.searchParams.set('companyId', companyId);
      url.searchParams.set('limit', String(GHL_PAGINATION_LIMIT));
      url.searchParams.set('skip', String(skip));

      apiCallCount++;
      const r = await fetch(url.toString(), {
        headers: ghlHeaders(currentToken),
        signal: AbortSignal.timeout(15_000),
      });

      if (r.status === 401) {
        if (!refreshed) {
          refreshed = true;
          await connectorConfigService.refreshAgencyTokenIfExpired(agencyConnection.id);
          // Re-read token after refresh
          const updated = await connectorConfigService.get(agencyConnection.id, agencyConnection.organisationId);
          currentToken = (updated as unknown as Record<string, string>).accessToken;
          return fetchPage(); // one retry
        }
        throw Object.assign(new Error('AGENCY_TOKEN_INVALID'), { code: 'AGENCY_TOKEN_INVALID', statusCode: 401 });
      }

      if (r.status === 429 || r.status >= 500) {
        const e = Object.assign(new Error(`GHL locations search: ${r.status}`), { statusCode: r.status });
        throw e;
      }

      if (!r.ok) {
        throw Object.assign(new Error(`GHL locations search 4xx: ${r.status}`), { statusCode: r.status });
      }

      const data = await r.json() as { locations?: GhlLocation[] };
      return data.locations ?? [];
    };

    const page = await withBackoff(fetchPage, {
      label: 'ghl.locations.search',
      maxAttempts: 4,
      baseDelayMs: 1000,
      maxDelayMs: 4000,
      isRetryable: (err) => {
        const e = err as { statusCode?: number };
        return e.statusCode === 429 || (e.statusCode !== undefined && e.statusCode >= 500);
      },
      correlationId,
      runId: agencyConnection.id,
    });

    all.push(...page);
    if (page.length < GHL_PAGINATION_LIMIT) break; // last page
    skip += GHL_PAGINATION_LIMIT;
  }

  const truncated = checkTruncation(all.length);

  logger.info('ghl.enumeration.end', {
    event: 'ghl.enumeration.end',
    orgId: agencyConnection.organisationId,
    companyId,
    locationId: null,
    result: 'success',
    error: null,
    enrolled: all.length,
    pagesFetched: Math.ceil(all.length / GHL_PAGINATION_LIMIT) || 1,
    apiCallCount,
    truncated,
  });

  if (truncated) {
    // Best-effort operator notification — do not throw on failure
    logger.warn('ghl.enumeration.truncated', {
      event: 'ghl.enumeration.truncated',
      orgId: agencyConnection.organisationId,
      companyId,
      processed: GHL_LOCATION_CAP,
    });
    // TODO: fire notify_operator skill when it is wired as a callable primitive
  }

  return all;
}
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add server/services/ghlAgencyOauthService.ts server/services/ghlAgencyOauthServicePure.ts server/services/__tests__/ghlAgencyOauthService.test.ts
git commit -m "feat(ghl-oauth): enumerateAgencyLocations — paginated /locations/search with cap + withBackoff"
```

---

## Task 9 — Phase 3b: autoEnrolAgencyLocations {#task-9}

**Files:**
- Modify: `server/services/ghlAgencyOauthService.ts`
- Modify: `server/services/__tests__/ghlAgencyOauthService.test.ts`
- Verify: `autoStartOwedOnboardingWorkflows` uses pg-boss (fix if not)

- [ ] **Step 1: Verify autoStartOwedOnboardingWorkflows uses pg-boss**

Run: `grep -rn "autoStartOwedOnboardingWorkflows" server/ --include="*.ts" -l`
Open the file(s) found. Confirm the function enqueues each workflow via `boss.send(...)` or the pg-boss helper. If it calls the workflow function directly (inline), refactor it to dispatch via pg-boss before proceeding.

- [ ] **Step 2: Add upsert idempotency tests**

Append to `server/services/__tests__/ghlAgencyOauthService.test.ts`:

```typescript
import { buildSubaccountUpsertKey } from '../ghlAgencyOauthServicePure.js';

// ── buildSubaccountUpsertKey ──────────────────────────────────────────────

test('buildSubaccountUpsertKey: deterministic from (connectorConfigId, locationId)', () => {
  const key1 = buildSubaccountUpsertKey('cfg-1', 'loc-abc');
  const key2 = buildSubaccountUpsertKey('cfg-1', 'loc-abc');
  expect(key1).toBe(key2);
});

test('buildSubaccountUpsertKey: different for different locationIds', () => {
  const key1 = buildSubaccountUpsertKey('cfg-1', 'loc-abc');
  const key2 = buildSubaccountUpsertKey('cfg-1', 'loc-def');
  expect(key1).not.toBe(key2);
});
```

- [ ] **Step 3: Add buildSubaccountUpsertKey to ghlAgencyOauthServicePure.ts**

```typescript
/** Deterministic upsert key for (connectorConfig, GHL location) pair. */
export function buildSubaccountUpsertKey(connectorConfigId: string, locationId: string): string {
  return `${connectorConfigId}:${locationId}`;
}
```

- [ ] **Step 4: Run tests**

```bash
npx tsx server/services/__tests__/ghlAgencyOauthService.test.ts
```
Expected: PASS

- [ ] **Step 5: Implement autoEnrolAgencyLocations in ghlAgencyOauthService.ts**

```typescript
import { db } from '../db/index.js';
import { subaccounts } from '../db/schema/index.js';
import { sql } from 'drizzle-orm';

/**
 * Upsert one subaccount row per GHL location.
 * Idempotency primitive: INSERT ... ON CONFLICT DO UPDATE RETURNING (xmax = 0) AS inserted.
 * autoStartOwedOnboardingWorkflows fires ONLY when inserted = true (first creation).
 * Safe to call twice concurrently — DB unique partial index is the authoritative guard.
 *
 * Returns { enrolled, insertedCount } so callers can log whether this was a first install
 * (insertedCount > 0) vs a re-run (insertedCount === 0, all locations already existed).
 */
export async function autoEnrolAgencyLocations(
  orgId: string,
  agencyConnection: ConnectorConfig,
  correlationId = agencyConnection.id,
): Promise<{ enrolled: number; insertedCount: number }> {
  const locations = await enumerateAgencyLocations(agencyConnection, correlationId);
  let insertedCount = 0;

  for (const loc of locations) {
    // Slug collision guard: try base slug, then suffix with last-4 of locationId on 23505.
    // The ON CONFLICT below targets (connector_config_id, external_id) — NOT slug —
    // so a slug 23505 is always a new-row insert collision, not an idempotent update.
    const { generateSubaccountSlug } = await import('./ghlAgencyOauthServicePure.js');
    const baseSlug = generateSubaccountSlug(loc.name, loc.id);

    let result: { id: string; inserted: boolean } | undefined;
    for (const slug of [baseSlug, `${baseSlug}-${loc.id.slice(-4)}`]) {
      try {
        const [row] = await db.execute<{ id: string; inserted: boolean }>(sql`
          INSERT INTO subaccounts (
            id, organisation_id, name, slug, status,
            connector_config_id, external_id, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), ${orgId}, ${loc.name}, ${slug}, 'active',
            ${agencyConnection.id}, ${loc.id}, now(), now()
          )
          ON CONFLICT (connector_config_id, external_id)
            WHERE deleted_at IS NULL
              AND connector_config_id IS NOT NULL
              AND external_id IS NOT NULL
          DO UPDATE SET name = EXCLUDED.name, updated_at = now()
          RETURNING id, (xmax = 0) AS inserted
        `);
        result = row;
        break;
      } catch (err) {
        const pg = err as { code?: string; constraint?: string };
        if (pg.code === '23505' && pg.constraint?.includes('slug')) continue; // try suffix
        throw err; // unexpected error — propagate
      }
    }
    if (!result) {
      logger.warn('ghl.enumeration.slug_collision_unresolved', { orgId, locationId: loc.id });
      continue; // skip this location rather than crashing the entire batch
    }

    logger.info('ghl.enumeration.subaccount_upsert', {
      event: 'ghl.enumeration.subaccount_upsert',
      orgId,
      companyId: agencyConnection.companyId,
      locationId: loc.id,
      result: 'success',
      inserted: result.inserted,
      error: null,
    });

    if (result.inserted) {
      insertedCount++;
      // Enqueue onboarding workflows via pg-boss — never inline (spec §6 Phase 3)
      try {
        const { autoStartOwedOnboardingWorkflows } = await import('./onboardingService.js');
        await autoStartOwedOnboardingWorkflows(orgId, result.id);
      } catch (err) {
        logger.error('ghl.enumeration.onboarding_dispatch_failed', {
          event: 'ghl.enumeration.onboarding_dispatch_failed',
          orgId,
          subaccountId: result.id,
          locationId: loc.id,
          error: { code: 'ONBOARDING_DISPATCH_FAILED', message: String(err) },
        });
        // Non-fatal — subaccount row is created; operator can re-trigger onboarding
      }
    }
  }

  const isFirstInstall = insertedCount > 0;
  logger.info('ghl.enrol.complete', {
    event: 'ghl.enrol.complete',
    orgId,
    companyId: agencyConnection.companyId,
    enrolled: locations.length,
    insertedCount,
    isFirstInstall,
    correlationId,
  });

  return { enrolled: locations.length, insertedCount };
}
```

**Important:** The import path for `autoStartOwedOnboardingWorkflows` — find it with `grep -rn "autoStartOwedOnboardingWorkflows" server/` and use the correct module path.

**Slug generation:** Add `generateSubaccountSlug` to `ghlAgencyOauthServicePure.ts`. Check how existing subaccounts are slugged in `server/routes/subaccounts.ts` or `server/services/subaccountService.ts` — reuse the same slug utility if one exists, or use:

```typescript
export function generateSubaccountSlug(name: string, locationId: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return base || locationId.slice(-12);
}
```

The slug collision loop above tries the base slug first, then appends `-${loc.id.slice(-4)}`. If both collide (extremely unlikely), the location is skipped with a warning rather than crashing the batch. The `ON CONFLICT` in the INSERT targets `(connector_config_id, external_id)` for idempotent updates — slug collisions are a separate, rarer case.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add server/services/ghlAgencyOauthService.ts server/services/ghlAgencyOauthServicePure.ts server/services/__tests__/ghlAgencyOauthService.test.ts
git commit -m "feat(ghl-oauth): autoEnrolAgencyLocations — idempotent upsert with xmax guard + pg-boss dispatch"
```

---

## Task 10 — Phase 4a/b: Migration 0269 + connectorLocationTokens schema {#task-10}

**Files:**
- Create: `migrations/0269_connector_location_tokens.sql`
- Create: `migrations/_down/0269_connector_location_tokens.sql`
- Create: `server/db/schema/connectorLocationTokens.ts`
- Modify: `server/db/schema/index.ts`
- Modify: `server/config/rlsProtectedTables.ts`

- [ ] **Step 1: Write migration 0269**

Create `migrations/0269_connector_location_tokens.sql`:

```sql
-- Migration 0269: connector_location_tokens table
-- Spec: docs/ghl-module-c-oauth-spec.md §7 Migrations, §5.2, §6 Phase 4
-- Branch: ghl-agency-oauth

CREATE TABLE connector_location_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_config_id UUID NOT NULL REFERENCES connector_configs(id),
  location_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Unique partial index: authoritative concurrency guard for mint races.
-- Only one live (non-deleted) token row per (connector_config, location).
CREATE UNIQUE INDEX connector_location_tokens_live_uniq
  ON connector_location_tokens(connector_config_id, location_id)
  WHERE deleted_at IS NULL;

-- Secondary index: fast expiry-check sweep for the refresh/prune path.
CREATE INDEX connector_location_tokens_expires_idx
  ON connector_location_tokens(expires_at)
  WHERE deleted_at IS NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Tenant isolation via connector_config_id → connector_configs.organisation_id.
-- A row is visible only when the session org matches the parent connector_config's org.

ALTER TABLE connector_location_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_location_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS connector_location_tokens_org_isolation ON connector_location_tokens;
CREATE POLICY connector_location_tokens_org_isolation ON connector_location_tokens
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM connector_configs cc
      WHERE cc.id = connector_config_id
        AND cc.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND EXISTS (
      SELECT 1 FROM connector_configs cc
      WHERE cc.id = connector_config_id
        AND cc.organisation_id = current_setting('app.organisation_id', true)::uuid
    )
  );
```

- [ ] **Step 2: Write down migration 0269**

Create `migrations/_down/0269_connector_location_tokens.sql`:

```sql
DROP POLICY IF EXISTS connector_location_tokens_org_isolation ON connector_location_tokens;
DROP INDEX IF EXISTS connector_location_tokens_expires_idx;
DROP INDEX IF EXISTS connector_location_tokens_live_uniq;
DROP TABLE IF EXISTS connector_location_tokens;
```

- [ ] **Step 3: Create connectorLocationTokens Drizzle schema**

Create `server/db/schema/connectorLocationTokens.ts`:

```typescript
import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { connectorConfigs } from './connectorConfigs.js';

export const connectorLocationTokens = pgTable(
  'connector_location_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    connectorConfigId: uuid('connector_config_id').notNull().references(() => connectorConfigs.id),
    locationId: text('location_id').notNull(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    scope: text('scope').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    // Partial unique index (live_uniq) is SQL-only — Drizzle cannot express WHERE.
    // Secondary index for expiry sweep:
    expiresIdx: index('connector_location_tokens_expires_idx').on(table.expiresAt),
  }),
);

export type ConnectorLocationToken = typeof connectorLocationTokens.$inferSelect;
export type NewConnectorLocationToken = typeof connectorLocationTokens.$inferInsert;
```

- [ ] **Step 4: Export from schema index**

In `server/db/schema/index.ts`, add:
```typescript
export * from './connectorLocationTokens.js';
```

- [ ] **Step 5: Add RLS manifest entry**

In `server/config/rlsProtectedTables.ts`, append to `RLS_PROTECTED_TABLES` array (before the closing `];`):

```typescript
// 0269 — GHL location token cache
{
  tableName: 'connector_location_tokens',
  schemaFile: 'connectorLocationTokens.ts',
  policyMigration: '0269_connector_location_tokens.sql',
  rationale: 'Per-agency-connection GHL location access tokens — direct credential leak risk; tenant-isolated via parent connector_config.',
},
```

- [ ] **Step 6: Run typecheck + db:generate**

```bash
npm run typecheck
npm run db:generate
```
Expected: typecheck clean; db:generate produces a new snapshot file without errors.

- [ ] **Step 7: Commit schema + migration + RLS manifest together (required — CI gate checks both)**

```bash
git add migrations/0269_connector_location_tokens.sql migrations/_down/0269_connector_location_tokens.sql server/db/schema/connectorLocationTokens.ts server/db/schema/index.ts server/config/rlsProtectedTables.ts
git commit -m "feat(ghl-oauth): migration 0269 + connector_location_tokens schema + RLS manifest"
```

---

## Task 11 — Phase 4c/d: locationTokenServicePure + locationTokenService {#task-11}

**Files:**
- Create: `server/services/locationTokenServicePure.ts`
- Create: `server/services/__tests__/locationTokenServicePure.test.ts`
- Create: `server/services/locationTokenService.ts`
- Create: `server/services/__tests__/locationTokenService.test.ts`

- [ ] **Step 1: Write locationTokenServicePure tests**

Create `server/services/__tests__/locationTokenServicePure.test.ts`:

```typescript
/**
 * locationTokenServicePure.test.ts
 * Run: npx tsx server/services/__tests__/locationTokenServicePure.test.ts
 */
import { test, expect } from 'vitest';
import {
  isLocationTokenExpiringSoon,
  validateLocationTokenResponse,
  type LocationTokenResponse,
} from '../locationTokenServicePure.js';

test('isLocationTokenExpiringSoon: true when < 5 min remaining', () => {
  const expiresAt = new Date(Date.now() + 3 * 60 * 1000);
  expect(isLocationTokenExpiringSoon(expiresAt)).toBe(true);
});

test('isLocationTokenExpiringSoon: false when > 5 min remaining', () => {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  expect(isLocationTokenExpiringSoon(expiresAt)).toBe(false);
});

test('validateLocationTokenResponse: accepts valid Location token', () => {
  const payload: LocationTokenResponse = {
    access_token: 'eyJ.loc',
    refresh_token: 'eyJ.ref',
    expires_in: 86399,
    scope: 'contacts.readonly',
    userType: 'Location',
    companyId: 'co_abc',
    locationId: 'loc_789',
  };
  expect(() => validateLocationTokenResponse(payload, 'co_abc', 'loc_789')).not.toThrow();
});

test('validateLocationTokenResponse: throws LOCATION_TOKEN_MISMATCH on wrong companyId', () => {
  const payload: LocationTokenResponse = {
    access_token: 'tok',
    refresh_token: 'ref',
    expires_in: 86399,
    scope: '',
    userType: 'Location',
    companyId: 'co_WRONG',
    locationId: 'loc_789',
  };
  expect(() => validateLocationTokenResponse(payload, 'co_abc', 'loc_789')).toThrow('LOCATION_TOKEN_MISMATCH');
});

test('validateLocationTokenResponse: throws LOCATION_TOKEN_MISMATCH on wrong locationId', () => {
  const payload: LocationTokenResponse = {
    access_token: 'tok',
    refresh_token: 'ref',
    expires_in: 86399,
    scope: '',
    userType: 'Location',
    companyId: 'co_abc',
    locationId: 'loc_WRONG',
  };
  expect(() => validateLocationTokenResponse(payload, 'co_abc', 'loc_789')).toThrow('LOCATION_TOKEN_MISMATCH');
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx tsx server/services/__tests__/locationTokenServicePure.test.ts
```
Expected: FAIL

- [ ] **Step 3: Create locationTokenServicePure.ts**

Create `server/services/locationTokenServicePure.ts`:

```typescript
// Pure helpers for GHL location token management.

export interface LocationTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  userType: string;
  companyId: string;
  locationId: string;
}

/** True if token expires within 5 minutes. Same window as agency tokens. */
export function isLocationTokenExpiringSoon(expiresAt: Date): boolean {
  return expiresAt.getTime() - Date.now() < 5 * 60 * 1000;
}

/** Compute expires_at for a freshly minted or refreshed location token. */
export function computeLocationTokenExpiresAt(claimedAt: Date, expiresInSeconds: number): Date {
  return new Date(claimedAt.getTime() + expiresInSeconds * 1000);
}

/**
 * Validate that the mint/refresh response matches the expected (companyId, locationId) pair.
 * Throws LOCATION_TOKEN_MISMATCH if either assertion fails — do not persist the token.
 */
export function validateLocationTokenResponse(
  response: LocationTokenResponse,
  expectedCompanyId: string,
  expectedLocationId: string,
): void {
  if (response.companyId !== expectedCompanyId || response.locationId !== expectedLocationId) {
    throw Object.assign(
      new Error(
        `LOCATION_TOKEN_MISMATCH: expected companyId=${expectedCompanyId} locationId=${expectedLocationId}, got companyId=${response.companyId} locationId=${response.locationId}`,
      ),
      {
        code: 'LOCATION_TOKEN_MISMATCH',
        requestedLocationId: expectedLocationId,
        returnedLocationId: response.locationId,
        requestedCompanyId: expectedCompanyId,
        returnedCompanyId: response.companyId,
      },
    );
  }
}

/** Build the body for the GHL /oauth/locationToken POST. */
export function buildLocationTokenBody(params: {
  companyId: string;
  locationId: string;
}): Record<string, string> {
  return { companyId: params.companyId, locationId: params.locationId };
}

/** Build the body for a location token refresh POST. */
export function buildLocationRefreshBody(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx tsx server/services/__tests__/locationTokenServicePure.test.ts
```
Expected: PASS

- [ ] **Step 5: Write locationTokenService tests**

Create `server/services/__tests__/locationTokenService.test.ts`:

```typescript
/**
 * locationTokenService.test.ts — in-process tests with mocked HTTP.
 * Run: npx tsx server/services/__tests__/locationTokenService.test.ts
 */
import { test, expect } from 'vitest';
import { computeLocationTokenExpiresAt, isLocationTokenExpiringSoon } from '../locationTokenServicePure.js';

// ── Cache-hit / expiry logic (pure, no DB needed) ─────────────────────────

test('non-expiring token: isLocationTokenExpiringSoon = false', () => {
  const expiresAt = computeLocationTokenExpiresAt(new Date(), 86400);
  expect(isLocationTokenExpiringSoon(expiresAt)).toBe(false);
});

test('expiring-soon token: isLocationTokenExpiringSoon = true', () => {
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 min
  expect(isLocationTokenExpiringSoon(expiresAt)).toBe(true);
});
```

- [ ] **Step 6: Create locationTokenService.ts**

Create `server/services/locationTokenService.ts`:

```typescript
import { db } from '../db/index.js';
import { connectorLocationTokens, connectorConfigs } from '../db/schema/index.js';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { withBackoff } from '../lib/withBackoff.js';
import { logger } from '../lib/logger.js';
import { connectionTokenService } from './connectionTokenService.js';
import {
  isLocationTokenExpiringSoon,
  computeLocationTokenExpiresAt,
  validateLocationTokenResponse,
  buildLocationTokenBody,
  buildLocationRefreshBody,
  type LocationTokenResponse,
} from './locationTokenServicePure.js';
import type { ConnectorConfig } from '../db/schema/connectorConfigs.js';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

function ghlHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Version: GHL_API_VERSION,
    'Content-Type': 'application/json',
  };
}

// In-process mint lock: prevents parallel fetches to /oauth/locationToken for the same
// (configId, locationId) pair. The DB unique index is the authoritative guard against
// duplicates across processes; this Map prevents the N simultaneous same-process fetches
// that would otherwise all call the GHL endpoint before the first insert lands.
// Key format: `${connectorConfigId}:${locationId}`
const mintInFlight = new Map<string, Promise<string>>();

/**
 * Get a valid access token for a GHL location.
 * Cache-hit fast path: return existing non-expiring token.
 * Miss / near-expiry: mint via /oauth/locationToken with agency bearer.
 * Concurrent mint: in-memory Map dedup + DB INSERT ON CONFLICT DO NOTHING; loser re-reads winner row.
 * 401 on cached token: soft-delete + remint once; second 401 → LOCATION_TOKEN_INVALID.
 */
export async function getLocationToken(
  agencyConnection: ConnectorConfig,
  locationId: string,
): Promise<string> {
  // ── Cache hit ──────────────────────────────────────────────────────────
  const [cached] = await db
    .select()
    .from(connectorLocationTokens)
    .where(
      and(
        eq(connectorLocationTokens.connectorConfigId, agencyConnection.id),
        eq(connectorLocationTokens.locationId, locationId),
        isNull(connectorLocationTokens.deletedAt),
      )
    )
    .limit(1);

  if (cached) {
    if (!isLocationTokenExpiringSoon(cached.expiresAt)) {
      return connectionTokenService.decryptToken(cached.accessToken);
    }
    // Near expiry — refresh in place (passes encrypted refreshToken; function decrypts internally)
    return refreshLocationToken(agencyConnection, cached.id, cached.refreshToken, locationId);
  }

  // ── Cache miss — mint new token (in-process lock prevents redundant parallel fetches) ─
  const lockKey = `${agencyConnection.id}:${locationId}`;
  const inFlight = mintInFlight.get(lockKey);
  if (inFlight) return inFlight;

  const mintPromise = mintLocationToken(agencyConnection, locationId).finally(() => {
    mintInFlight.delete(lockKey);
  });
  mintInFlight.set(lockKey, mintPromise);
  return mintPromise;
}

async function mintLocationToken(
  agencyConnection: ConnectorConfig,
  locationId: string,
): Promise<string> {
  // Decrypt the stored agency token before using it as Authorization: Bearer
  const agencyToken = connectionTokenService.decryptToken(
    (agencyConnection as unknown as Record<string, string>).accessToken,
  );
  const companyId = agencyConnection.companyId!;
  const clientId = process.env.OAUTH_GHL_CLIENT_ID!;
  const clientSecret = process.env.OAUTH_GHL_CLIENT_SECRET!;

  const mintFn = async (): Promise<LocationTokenResponse> => {
    const r = await fetch(`${GHL_API_BASE}/oauth/locationToken`, {
      method: 'POST',
      headers: { ...ghlHeaders(agencyToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(buildLocationTokenBody({ companyId, locationId })),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 401) throw Object.assign(new Error('401'), { statusCode: 401 });
    if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`${r.status}`), { statusCode: r.status });
    if (!r.ok) throw Object.assign(new Error(`${r.status}`), { statusCode: r.status });
    return r.json() as Promise<LocationTokenResponse>;
  };

  const data = await withBackoff(mintFn, {
    label: 'ghl.location.mint',
    maxAttempts: 4,
    baseDelayMs: 1000,
    maxDelayMs: 4000,
    isRetryable: (err) => {
      const e = err as { statusCode?: number };
      return e.statusCode === 429 || (e.statusCode !== undefined && e.statusCode >= 500);
    },
    correlationId: agencyConnection.id,
    runId: locationId,
  });

  validateLocationTokenResponse(data, companyId, locationId);

  const claimedAt = new Date();
  const expiresAt = computeLocationTokenExpiresAt(claimedAt, data.expires_in);

  // INSERT ON CONFLICT DO NOTHING — the unique partial index is the race guard AND the
  // churn guard. Because the row must exist before getLocationToken returns a cache hit,
  // a buggy caller cannot spam /oauth/locationToken — the cache hit path short-circuits.
  // No additional cooldown is needed; strict DB row existence is sufficient.
  const [inserted] = await db
    .insert(connectorLocationTokens)
    .values({
      connectorConfigId: agencyConnection.id,
      locationId,
      accessToken: connectionTokenService.encryptToken(data.access_token),
      refreshToken: connectionTokenService.encryptToken(data.refresh_token),
      expiresAt,
      scope: data.scope,
    })
    .onConflictDoNothing()
    .returning();

  if (!inserted) {
    // Race loser: another concurrent mint won. Re-read the winner's row.
    const [winner] = await db
      .select()
      .from(connectorLocationTokens)
      .where(
        and(
          eq(connectorLocationTokens.connectorConfigId, agencyConnection.id),
          eq(connectorLocationTokens.locationId, locationId),
          isNull(connectorLocationTokens.deletedAt),
        )
      )
      .limit(1);
    if (!winner) throw new Error(`getLocationToken: race-loser re-read found no row for ${locationId}`);
    return connectionTokenService.decryptToken(winner.accessToken);
  }

  const tokenAgeMs = Date.now() - claimedAt.getTime();
  logger.info('ghl.token.mint', {
    event: 'ghl.token.mint',
    orgId: agencyConnection.organisationId,
    companyId,
    locationId,
    result: 'success',
    tokenAgeMs, // metric: time from claimed_at to DB persist — useful for diagnosing clock drift
    error: null,
  });

  // Return raw API token (not DB value) — no decrypt needed for freshly-minted token
  return data.access_token;
}

async function refreshLocationToken(
  agencyConnection: ConnectorConfig,
  tokenRowId: string,
  encryptedRefreshToken: string,   // encrypted value straight from DB
  locationId: string,
): Promise<string> {
  const clientId = process.env.OAUTH_GHL_CLIENT_ID!;
  const clientSecret = process.env.OAUTH_GHL_CLIENT_SECRET!;
  const companyId = agencyConnection.companyId!;
  const refreshToken = connectionTokenService.decryptToken(encryptedRefreshToken);

  const refreshFn = async (): Promise<LocationTokenResponse> => {
    const body = buildLocationRefreshBody({ refreshToken, clientId, clientSecret });
    const r = await fetch(`${GHL_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error('401'), { statusCode: 401 });
    if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`${r.status}`), { statusCode: r.status });
    if (!r.ok) throw Object.assign(new Error(`${r.status}`), { statusCode: r.status });
    return r.json() as Promise<LocationTokenResponse>;
  };

  let data: LocationTokenResponse;
  try {
    data = await withBackoff(refreshFn, {
      label: 'ghl.location.refresh',
      maxAttempts: 4,
      baseDelayMs: 1000,
      maxDelayMs: 4000,
      isRetryable: (err) => {
        const e = err as { statusCode?: number };
        return e.statusCode === 429 || (e.statusCode !== undefined && e.statusCode >= 500);
      },
      correlationId: agencyConnection.id,
      runId: locationId,
    });
  } catch (err) {
    const e = err as { statusCode?: number };
    if (e.statusCode === 401) {
      // Refresh failed — soft-delete + remint
      await db
        .update(connectorLocationTokens)
        .set({ deletedAt: new Date() })
        .where(eq(connectorLocationTokens.id, tokenRowId));
      return mintLocationToken(agencyConnection, locationId);
    }
    // All withBackoff retries exhausted (429/5xx) — log the failure counter
    logger.error('ghl.token.refresh_failure', {
      event: 'ghl.token.refresh_failure',
      orgId: agencyConnection.organisationId,
      companyId: agencyConnection.companyId,
      locationId,
      result: 'failure',
      error: { message: String(err) },
    });
    throw err;
  }

  // Update in place — spec §5.2: always persist returned scope on refresh
  const claimedAt = new Date();
  await db
    .update(connectorLocationTokens)
    .set({
      accessToken: connectionTokenService.encryptToken(data.access_token),
      refreshToken: connectionTokenService.encryptToken(data.refresh_token),
      expiresAt: computeLocationTokenExpiresAt(claimedAt, data.expires_in),
      scope: data.scope,
      updatedAt: new Date(),
    })
    .where(eq(connectorLocationTokens.id, tokenRowId));

  logger.info('ghl.token.refresh', {
    event: 'ghl.token.refresh',
    orgId: agencyConnection.organisationId,
    companyId,
    locationId,
    result: 'success',
    error: null,
  });

  // Return raw API token — no decrypt needed since we just fetched it
  return data.access_token;
}

/**
 * Handles a 401 from an adapter call with a cached token.
 * Soft-deletes the cached row and remints exactly once.
 * Second 401 → throws LOCATION_TOKEN_INVALID.
 */
export async function handleLocationToken401(
  agencyConnection: ConnectorConfig,
  locationId: string,
): Promise<string> {
  // Soft-delete the current cached row
  await db
    .update(connectorLocationTokens)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(connectorLocationTokens.connectorConfigId, agencyConnection.id),
        eq(connectorLocationTokens.locationId, locationId),
        isNull(connectorLocationTokens.deletedAt),
      )
    );

  // Remint once
  try {
    return await mintLocationToken(agencyConnection, locationId);
  } catch (err) {
    const e = err as { statusCode?: number };
    if (e.statusCode === 401) {
      logger.error('ghl.token.invalid', {
        event: 'ghl.token.invalid',
        orgId: agencyConnection.organisationId,
        companyId: agencyConnection.companyId,
        locationId,
        result: 'failure',
        error: { code: 'LOCATION_TOKEN_INVALID', message: 'second 401 on remint — token permanently invalid' },
      });
      throw Object.assign(
        new Error(`LOCATION_TOKEN_INVALID: second 401 for locationId=${locationId}`),
        { code: 'LOCATION_TOKEN_INVALID', locationId },
      );
    }
    throw err;
  }
}
```

- [ ] **Step 7: Run tests**

```bash
npx tsx server/services/__tests__/locationTokenServicePure.test.ts
npx tsx server/services/__tests__/locationTokenService.test.ts
```
Expected: PASS on both.

- [ ] **Step 8: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add server/services/locationTokenServicePure.ts server/services/locationTokenService.ts server/services/__tests__/locationTokenServicePure.test.ts server/services/__tests__/locationTokenService.test.ts
git commit -m "feat(ghl-oauth): locationTokenService — cache hit/miss/refresh/401-soft-delete + pure helpers"
```

---

## Task 12 — Phase 4e: Rewire ghlAdapter 9 fetch methods {#task-12}

**Files:**
- Modify: `server/adapters/ghlAdapter.ts`

- [ ] **Step 1: Read the full ghlAdapter.ts to inventory all fetch methods**

Read `server/adapters/ghlAdapter.ts` completely. Identify which methods are currently called on which tokens. The 9 location-scoped methods per spec §5.2 / §10a:
1. `fetchContacts` (line ~130)
2. `fetchOpportunities` (line ~155)
3. `fetchConversations` (line ~179)
4. `fetchRevenue` (line ~201)
5. `fetchFunnels` — find line
6. `fetchFunnelPages` — find line
7. `fetchCalendars` — find line
8. `fetchUsers` — find line
9. `fetchLocationDetails` — find line

Agency-token methods that stay unchanged:
- `listAccounts` / `fetchLocations` (`/locations/search`)
- `fetchSubscription` (`/saas/location/.../subscription`)

- [ ] **Step 2: Add withLocationToken wrapper and resolveLocationToken (internal only)**

The current `decryptAccessToken` function works with `IntegrationConnection`. After this change, the adapter receives a `ConnectorConfig` (for agency connections). Add the helpers below.

**Export contract (strict):**
- `withLocationToken` — exported. The ONLY entry point for location-scoped adapter calls.
- `resolveLocationToken` — NOT exported. Used only by `withLocationToken` internally.
- `mintLocationToken`, `refreshLocationToken`, `handleLocationToken401` — these live in `locationTokenService.ts` and are not re-exported from `ghlAdapter.ts`.

```typescript
import { getLocationToken, handleLocationToken401 } from '../services/locationTokenService.js';
import type { ConnectorConfig } from '../db/schema/connectorConfigs.js';

/**
 * Internal: resolve a token for the given connection type.
 * Do NOT call this directly from adapter methods — use withLocationToken instead.
 */
async function resolveLocationToken(
  connection: IntegrationConnection | ConnectorConfig,
  locationId: string,
): Promise<string> {
  if ('tokenScope' in connection && connection.tokenScope === 'agency') {
    return getLocationToken(connection as ConnectorConfig, locationId);
  }
  // Legacy IntegrationConnection path — unchanged
  return decryptAccessToken(connection as IntegrationConnection);
}
```

- [ ] **Step 3: Rewire each of the 9 location-scoped fetch methods**

For each method, replace:
```typescript
const accessToken = decryptAccessToken(connection);
```
with:
```typescript
const accessToken = await resolveLocationToken(connection, accountExternalId);
```

Do this for: `fetchContacts`, `fetchOpportunities`, `fetchConversations`, `fetchRevenue`, `fetchFunnels`, `fetchFunnelPages`, `fetchCalendars`, `fetchUsers`, `fetchLocationDetails`.

Each method must handle a 401 response by calling `handleLocationToken401` and retrying once:
```typescript
import { handleLocationToken401 } from '../services/locationTokenService.js';

// In each method, after the main try-catch for the axios/fetch call:
// If the error is a 401, call handleLocationToken401 and retry.
```

**Mandatory:** Extract a `withLocationToken` wrapper. ALL 9 location-scoped methods MUST use it — no method is allowed to bypass it. This is the enforcement point that prevents inconsistent retry behaviour and duplicated 401 handling across adapter methods.

```typescript
async function withLocationToken<T>(
  connection: IntegrationConnection | ConnectorConfig,
  locationId: string,
  fn: (token: string) => Promise<T>,
): Promise<T> {
  const token = await resolveLocationToken(connection, locationId);
  try {
    return await fn(token);
  } catch (err) {
    const e = err as { response?: { status?: number }; status?: number; statusCode?: number };
    const status = e.response?.status ?? e.status ?? e.statusCode;
    if (status === 401 && 'tokenScope' in connection) {
      const freshToken = await handleLocationToken401(connection as ConnectorConfig, locationId);
      return fn(freshToken);
    }
    throw err;
  }
}
```

Then each method body becomes:
```typescript
async fetchContacts(connection, accountExternalId, opts) {
  return withLocationToken(connection, accountExternalId, async (accessToken) => {
    // ... existing fetch logic using accessToken ...
  });
},
```

- [ ] **Step 4: Verify fetchLocations + fetchSubscription are unchanged**

Confirm `listAccounts` / `fetchLocations` still calls `decryptAccessToken(connection)` directly (agency token). Confirm `fetchSubscription` still uses the agency token.

- [ ] **Step 4b: Add adapter integration test**

In `server/adapters/__tests__/ghlAdapter.test.ts` (create if missing), add tests that exercise at least 3 of the 9 rewired methods through the `withLocationToken` wrapper with a mocked `getLocationToken`. Verify that:
- A 401 response triggers `handleLocationToken401` and retries once
- A success response returns the expected data shape
- A second 401 throws `LOCATION_TOKEN_INVALID`

This is a regression guard — adapter regressions will not surface through unit tests on individual services alone.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```
Expected: no errors. The `IntegrationConnection | ConnectorConfig` union may require narrowing in some places.

- [ ] **Step 6: Lint**

```bash
npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add server/adapters/ghlAdapter.ts
git commit -m "feat(ghl-oauth): rewire ghlAdapter — 9 location-scoped methods use getLocationToken; agency endpoints unchanged"
```

---

## Task 13 — Phase 5: Webhook side effects {#task-13}

**Files:**
- Modify: `server/services/ghlWebhookMutationsService.ts`
- Create: `server/services/__tests__/ghlWebhookMutationsService.test.ts`

- [ ] **Step 1: Verify dedupe key ordering in ghlWebhookMutationsService.ts**

Read the full `server/services/ghlWebhookMutationsService.ts`. Find where the `gohighlevel_webhook_id` dedupe row is committed.

Per spec §5.4 hard invariant: the dedupe row MUST be committed **only after all side effects succeed**. If the current code commits the dedupe key first (before side effects), reverse the ordering. Document the finding in a code comment.

- [ ] **Step 2: Write webhook side-effect tests**

Create `server/services/__tests__/ghlWebhookMutationsService.test.ts`:

```typescript
/**
 * ghlWebhookMutationsService.test.ts
 * Run: npx tsx server/services/__tests__/ghlWebhookMutationsService.test.ts
 */
import { test, expect } from 'vitest';
import {
  classifyWebhookEvent,
  shouldProcessInstall,
} from '../ghlWebhookMutationsService.js'; // add these pure helpers in Step 3

// ── Event classification ──────────────────────────────────────────────────

test('classifyWebhookEvent: INSTALL with installType=Company → install_company', () => {
  expect(classifyWebhookEvent({ type: 'INSTALL', installType: 'Company', webhookId: 'wh-1', companyId: 'co-1' }))
    .toBe('install_company');
});

test('classifyWebhookEvent: INSTALL with installType=Location → install_location_ignored', () => {
  expect(classifyWebhookEvent({ type: 'INSTALL', installType: 'Location', webhookId: 'wh-2', companyId: 'co-1' }))
    .toBe('install_location_ignored');
});

test('classifyWebhookEvent: UNINSTALL → uninstall', () => {
  expect(classifyWebhookEvent({ type: 'UNINSTALL', webhookId: 'wh-3', companyId: 'co-1' }))
    .toBe('uninstall');
});

test('classifyWebhookEvent: LocationCreate → location_create', () => {
  expect(classifyWebhookEvent({ type: 'LocationCreate', webhookId: 'wh-4', companyId: 'co-1', locationId: 'loc-1' }))
    .toBe('location_create');
});

// ── Missing webhookId → reject ────────────────────────────────────────────

test('classifyWebhookEvent: missing webhookId → throws', () => {
  expect(() => classifyWebhookEvent({ type: 'INSTALL', installType: 'Company', companyId: 'co-1' }))
    .toThrow('webhookId');
});
```

- [ ] **Step 3: Run test — verify it fails**

```bash
npx tsx server/services/__tests__/ghlWebhookMutationsService.test.ts
```
Expected: FAIL — `classifyWebhookEvent` not yet exported.

- [ ] **Step 4: Add pure classification helpers to ghlWebhookMutationsPure.ts**

In `server/services/ghlWebhookMutationsPure.ts`, export:

```typescript
export type WebhookEventClass =
  | 'install_company'
  | 'install_location_ignored'
  | 'uninstall'
  | 'location_create'
  | 'location_update'
  | 'other';

export interface WebhookEnvelopeMinimal {
  type: string;
  webhookId?: string;
  companyId?: string;
  locationId?: string;
  installType?: string;
}

/**
 * Classifies a GHL webhook event and validates that webhookId is present.
 * Throws if webhookId is missing — no safe dedupe key = no processing.
 */
export function classifyWebhookEvent(event: WebhookEnvelopeMinimal): WebhookEventClass {
  if (!event.webhookId) {
    throw Object.assign(
      new Error('GHL webhook missing webhookId — cannot safely process without dedupe key'),
      { statusCode: 400, code: 'WEBHOOK_MISSING_ID' },
    );
  }
  if (event.type === 'INSTALL') {
    return event.installType === 'Company' ? 'install_company' : 'install_location_ignored';
  }
  if (event.type === 'UNINSTALL') return 'uninstall';
  if (event.type === 'LocationCreate') return 'location_create';
  if (event.type === 'LocationUpdate') return 'location_update';
  return 'other';
}
```

Export `classifyWebhookEvent` from `ghlWebhookMutationsService.ts` as a re-export so the test can import it.

- [ ] **Step 5: Run test — verify it passes**

```bash
npx tsx server/services/__tests__/ghlWebhookMutationsService.test.ts
```
Expected: PASS

- [ ] **Step 6: Implement webhook side-effect dispatch in ghlWebhookMutationsService.ts**

Add a new exported async function `dispatchWebhookSideEffects`:

```typescript
import { connectorConfigService } from './connectorConfigService.js';
import { autoEnrolAgencyLocations } from './ghlAgencyOauthService.js';
import { db } from '../db/index.js';
import { connectorLocationTokens, connectorConfigs } from '../db/schema/index.js';
import { and, eq, isNull } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
import { classifyWebhookEvent, type WebhookEnvelopeMinimal } from './ghlWebhookMutationsPure.js';

/**
 * Side-effect handler for lifecycle webhook events.
 * Call this BEFORE writing the dedupe row (per §5.4 hard invariant).
 * If this returns 503 or throws, the route must respond 503 and NOT write the dedupe row.
 * Only on 200: write the dedupe row, then respond 200.
 */
export async function dispatchWebhookSideEffects(
  event: WebhookEnvelopeMinimal & { webhookId: string; companyId: string },
): Promise<{ statusCode: 200 | 503 }> {
  const eventClass = classifyWebhookEvent(event);

  if (eventClass === 'install_company') {
    logger.info('ghl.webhook.install_company', {
      event: 'ghl.webhook.install_company',
      orgId: null, companyId: event.companyId, locationId: null,
      result: 'success', error: null,
    });
    const connection = await connectorConfigService.findAgencyConnectionByCompanyId(event.companyId);
    if (!connection) {
      // OAuth callback hasn't landed yet — ack and let callback drive enrolment
      return { statusCode: 200 };
    }
    try {
      await autoEnrolAgencyLocations(connection.organisationId, connection, event.webhookId);
    } catch (err) {
      const e = err as { code?: string; statusCode?: number };
      if (e.code === 'AGENCY_RATE_LIMITED' || (e.statusCode !== undefined && e.statusCode >= 500)) {
        return { statusCode: 503 }; // GHL will retry
      }
    }
    return { statusCode: 200 };
  }

  if (eventClass === 'install_location_ignored') {
    logger.info('ghl.webhook.install_location_ignored', {
      event: 'ghl.webhook.install_location_ignored',
      orgId: null, companyId: event.companyId, locationId: event.locationId ?? null,
      result: 'success', error: null,
    });
    // Write ignored log row (best-effort, non-blocking)
    // TODO: persist to a webhook_ignored_log table if one exists, or use logger only
    return { statusCode: 200 };
  }

  if (eventClass === 'uninstall') {
    logger.info('ghl.webhook.uninstall', {
      event: 'ghl.webhook.uninstall',
      orgId: null, companyId: event.companyId, locationId: null,
      result: 'success', error: null,
    });
    const connection = await connectorConfigService.findAgencyConnectionByCompanyId(event.companyId);
    if (!connection) return { statusCode: 200 }; // already disconnected, idempotent no-op

    // Step 1: Best-effort token revoke (failure is logged, does not block)
    try {
      await fetch('https://services.leadconnectorhq.com/oauth/revoke', {
        method: 'POST',
        headers: { Authorization: `Bearer ${(connection as unknown as Record<string, string>).accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      logger.warn('ghl.webhook.uninstall.revoke_failed', { companyId: event.companyId, error: String(err) });
    }

    // Step 2: Mark connector_config disconnected.
    // `status='disconnected'` is the sentinel — polling tick already skips disconnected rows.
    // Do NOT set pollEnabled: there is no such column (see Critical Notes).
    await db
      .update(connectorConfigs)
      .set({ status: 'disconnected', disconnectedAt: new Date(), updatedAt: new Date() })
      .where(eq(connectorConfigs.id, connection.id));

    // Step 3: Soft-delete location tokens
    await db
      .update(connectorLocationTokens)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(connectorLocationTokens.connectorConfigId, connection.id),
          isNull(connectorLocationTokens.deletedAt),
        )
      );

    // Step 4: notify_operator (best-effort)
    // TODO: fire notify_operator skill when callable as a primitive
    logger.info('ghl.webhook.uninstall.complete', {
      event: 'ghl.webhook.uninstall',
      orgId: connection.organisationId, companyId: event.companyId, locationId: null,
      result: 'success', error: null,
    });

    return { statusCode: 200 };
  }

  if (eventClass === 'location_create') {
    logger.info('ghl.webhook.location_create', {
      event: 'ghl.webhook.location_create',
      orgId: null, companyId: event.companyId, locationId: event.locationId ?? null,
      result: 'success', error: null,
    });
    const connection = await connectorConfigService.findAgencyConnectionByCompanyId(event.companyId);
    if (!connection || !event.locationId) return { statusCode: 200 };

    // Single-location version of autoEnrolAgencyLocations using the shared upsert primitive.
    // Apply the same slug collision guard as autoEnrolAgencyLocations.
    const { db: dbInner } = await import('../db/index.js');
    const { sql: sqlTag } = await import('drizzle-orm');
    const { generateSubaccountSlug } = await import('./ghlAgencyOauthServicePure.js');
    const locId = event.locationId;
    const locName = (event as Record<string, unknown>).name as string | undefined ?? locId;
    const baseSlug = generateSubaccountSlug(locName, locId);

    let result: { id: string; inserted: boolean } | undefined;
    for (const slug of [baseSlug, `${baseSlug}-${locId.slice(-4)}`]) {
      try {
        const [row] = await dbInner.execute<{ id: string; inserted: boolean }>(sqlTag`
          INSERT INTO subaccounts (id, organisation_id, name, slug, status, connector_config_id, external_id, created_at, updated_at)
          VALUES (gen_random_uuid(), ${connection.organisationId}, ${locName}, ${slug}, 'active', ${connection.id}, ${locId}, now(), now())
          ON CONFLICT (connector_config_id, external_id)
            WHERE deleted_at IS NULL AND connector_config_id IS NOT NULL AND external_id IS NOT NULL
          DO UPDATE SET name = EXCLUDED.name, updated_at = now()
          RETURNING id, (xmax = 0) AS inserted
        `);
        result = row;
        break;
      } catch (err) {
        const pg = err as { code?: string; constraint?: string };
        if (pg.code === '23505' && pg.constraint?.includes('slug')) continue;
        throw err;
      }
    }

    if (result?.inserted) {
      try {
        const { autoStartOwedOnboardingWorkflows } = await import('./onboardingService.js');
        await autoStartOwedOnboardingWorkflows(connection.organisationId, result.id);
      } catch { /* non-fatal */ }
    }

    return { statusCode: 200 };
  }

  return { statusCode: 200 };
}
```

**Reminder:** `status='disconnected'` is the only sentinel needed. There is no `pollEnabled` column — do not add one.

- [ ] **Step 7: Wire dispatchWebhookSideEffects into the webhook route**

Find `server/routes/webhooks/ghlWebhook.ts` (or wherever GHL webhooks are routed).

**Hard invariant (spec §5.4): side effects FIRST, dedupe row AFTER.** The exact ordering must be:

```
1. Parse and validate the webhook envelope
2. Call dispatchWebhookSideEffects(event)
   a. If it returns { statusCode: 503 } → respond 503 → DO NOT write the dedupe row
   b. If it throws → respond 503 → DO NOT write the dedupe row
3. Only on success (statusCode: 200): write the dedupe row → respond 200
```

If the dedupe row is written before side effects, a failed side effect will never be retried — GHL sees a 200 on the next delivery and skips it. Writing the dedupe row after ensures that any 503 response causes GHL to re-deliver, which re-runs the side effects.

Read the existing webhook handler carefully in Step 1 — if the dedupe row is currently committed first, reverse the ordering before wiring in the new dispatch function.

- [ ] **Step 8: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add server/services/ghlWebhookMutationsService.ts server/services/ghlWebhookMutationsPure.ts server/services/__tests__/ghlWebhookMutationsService.test.ts
git commit -m "feat(ghl-oauth): webhook side effects — INSTALL/UNINSTALL/LocationCreate dispatch + dedupe ordering"
```

---

## Task 14 — Final sweep + doc sync {#task-14}

- [ ] **Step 1: Run full lint**

```bash
npm run lint
```
Fix all errors. Do not suppress with eslint-disable unless a lint rule is demonstrably wrong for the specific case and you've documented why.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```
Zero errors required.

- [ ] **Step 3: Run all new test files**

```bash
npx tsx server/services/__tests__/ghlAgencyOauthServicePure.test.ts
npx tsx server/services/__tests__/ghlAgencyOauthService.test.ts
npx tsx server/services/__tests__/locationTokenServicePure.test.ts
npx tsx server/services/__tests__/locationTokenService.test.ts
npx tsx server/services/__tests__/ghlWebhookMutationsService.test.ts
npx tsx server/adapters/__tests__/ghlAdapter.test.ts
```
All must PASS.

- [ ] **Step 4: Update docs/capabilities.md**

Find the GHL connector entry. Add a note that agency-level OAuth is implemented (mark as pending Stage 6b sign-off, not yet production-ready until Stage 6b passes).

- [ ] **Step 5: Update docs/integration-reference.md**

Add a new section "GHL Agency vs Location Token Model" describing:
- Agency token: one per org + GHL company, stored in `connector_configs.token_scope='agency'`
- Location token: minted on demand per location, cached in `connector_location_tokens`
- `getLocationToken` helper: cache-hit / mint / refresh / 401-soft-delete pattern
- Which adapter methods use which token (9 location-scoped vs 2 agency-scoped)

- [ ] **Step 6: Final commit**

```bash
git add docs/capabilities.md docs/integration-reference.md
git commit -m "docs(ghl-oauth): update capabilities.md + integration-reference.md agency/location token model"
```

- [ ] **Step 7: Run spec-conformance**

```
spec-conformance: verify the current branch against its spec
```
Address any MECHANICAL gaps it flags. Route DIRECTIONAL gaps to `tasks/todo.md`.

- [ ] **Step 8: Run pr-reviewer**

```
pr-reviewer: review the changes on the ghl-agency-oauth branch
```
Address blockers before marking done.

---
