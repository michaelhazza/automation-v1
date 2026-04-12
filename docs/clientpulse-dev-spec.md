---
title: ClientPulse for GHL Agencies — Development Specification
date: 2026-04-12
status: draft
input: docs/clientpulse-ghl-dev-brief.md
revision: 1
---

# ClientPulse for GHL Agencies — Development Specification

## Table of contents

1. Summary
2. Current state audit
3. Module A — Modules table & allowlist enforcement
4. Module G (partial) — Subscriptions, billing data model & admin UI
5. Module C — GHL data connector completion
6. Module B — ClientPulse agent wiring
7. Module F — HTML email report delivery
8. Module E — Template-driven UI narrowing, Dashboard & Reports
9. Module D — Self-serve onboarding flow
10. Module G (Stripe) — Stripe integration (post soft-launch)
11. Migration inventory
12. Build phases & dependency graph
13. Verification plan
14. Open items & pre-implementation gates

<!-- Sections follow in build-order per the brief's Section 8 -->

## 1. Summary

This spec translates the ClientPulse dev brief (`docs/clientpulse-ghl-dev-brief.md`) into implementation-ready detail. It covers seven modules (A through G) ordered by build dependency, specifies every new table, service, route, and UI page, and maps each piece to existing codebase primitives.

**What ClientPulse is:** A product tier of Synthetos targeted at GHL agencies. One org-scoped Reporting Agent iterates across an agency's sub-accounts (GHL "locations"), computes health scores / anomaly detection / churn risk per client, and delivers a weekly portfolio report via HTML email + an in-app Dashboard. The agency owner connects GHL once via OAuth; everything else is automated.

**What this spec produces when fully implemented:**

- A `modules` table and allowlist enforcement at four points (scheduling, execution, UI, write-to-activate) — Module A
- A `subscriptions` + `org_subscriptions` data model with system-admin UI for catalogue management and per-org assignment — Module G
- Completed GHL data ingestion pipeline with real API calls, webhook normalisation, and sync state machine — Module C
- Intelligence skill executors wired to canonical data (health score, anomaly, churn risk, portfolio report) — Module B
- HTML email report rendering and delivery — Module F
- Module-driven sidebar narrowing, a customer-facing Dashboard page, and a Reports page — Module E
- Self-serve signup → OAuth → first-report onboarding flow — Module D
- Stripe integration for self-serve billing (post soft-launch) — Module G (Stripe)

**North-star acceptance test:** A real design-partner GHL agency connects their account and sees a portfolio health report on the Dashboard within 10 minutes (stretch: 5 minutes). Weekly reports deliver reliably for 4+ consecutive weeks. See brief Section 3 for the full seven-step user journey.

**Build order rationale:** Module A (allowlist) is the foundation — without it, the upgrade/downgrade path ships a bug. Module G admin UI (partial, no Stripe) unlocks the ability to toggle subscriptions on test orgs. Module C (GHL connector) and Module B (agent wiring) produce the data and intelligence. Modules E and F build the customer-facing surfaces. Module D wires the self-serve front door. Stripe integration is explicitly deferred past soft launch.

---

## 2. Current state audit

Inventory of existing code that ClientPulse builds on. Every file path verified against main as of commit `83c8736`.

### 2.1 Config template system (~50% complete)

| Asset | Path | Status |
|-------|------|--------|
| Schema: templates | `server/db/schema/systemHierarchyTemplates.ts` | Exists — `id`, `name`, `slug`, `description`, `operationalDefaults` (jsonb), `memorySeedsJson` (jsonb), `requiredOperatorInputs` (jsonb), `isPublished`, `createdAt`, `updatedAt`, `deletedAt` |
| Schema: template slots | `server/db/schema/systemHierarchyTemplateSlots.ts` | Exists — `templateId`, `systemAgentId`, `executionScope`, `skillSlugs` (jsonb), `sortOrder` |
| Service | `server/services/systemTemplateService.ts` (684 lines) | Exists — `loadToOrg()`, template CRUD, Paperclip import |
| Service | `server/services/hierarchyTemplateService.ts` (676 lines) | Exists — org-level template management |
| Routes | `server/routes/systemCompanyTemplates.ts` | Exists — `GET/PATCH/DELETE /api/system/company-templates/:id` |
| UI | `client/src/pages/SystemCompanyTemplatesPage.tsx` | Exists — list/preview/unpublish/delete |
| Seeded template | Migration 0068 | "GHL Agency Intelligence" seeded — **known issue: duplicate row in UI (1 agent vs 0 agents)** |

**Gap:** No `modules` table, no allowlist enforcement, no sidebar-config-in-template, no subscription linkage. `loadToOrg()` does not yet handle org-scoped agent provisioning fully (needs `executionScope` routing, `orgAgentConfigs` creation).

### 2.2 GHL connector (~60% complete)

| Asset | Path | Status |
|-------|------|--------|
| Adapter | `server/adapters/ghlAdapter.ts` (342 lines) | Exists — OAuth token exchange, webhook verification, rate limiting, ingestion method stubs (`listAccounts`, `fetchContacts`, `fetchOpportunities`, `fetchConversations`, `fetchRevenue`) |
| Webhook route | `server/routes/webhooks/ghlWebhook.ts` | Exists — HMAC verification, event normalisation via `mapGhlEventType` |
| Canonical schema | `server/db/schema/canonicalEntities.ts` (170 lines) | Exists — `canonical_contacts`, `canonical_opportunities`, `canonical_conversations`, `canonical_revenue` |
| Canonical accounts | `server/db/schema/canonicalAccounts.ts` (30 lines) | Exists — `canonical_accounts` with `externalId`, `source`, `orgId`, `subaccountId` |
| Data service | `server/services/canonicalDataService.ts` (354 lines) | Exists — query layer for metrics aggregation |
| Connector config | `server/services/connectorConfigService.ts` (131 lines) | Exists — CRUD for connector configs |
| Polling service | `server/services/connectorPollingService.ts` (157 lines) | Exists — polling job with sync phases |
| Integration connections | `server/services/integrationConnectionService.ts` (591 lines) | Exists — full OAuth token lifecycle (encrypt/decrypt, refresh, status tracking) |

**Gap:** Ingestion methods are stubs — need real GHL API calls with pagination, error handling, and canonical entity normalisation. Webhook event normalisation incomplete for Opportunity stage/status transitions. Sync-phase state machine not fully wired. Agency-token-vs-location-token exchange unverified. Mount paths need renaming (`/oauth/callback`, `/webhooks/ingest`).

### 2.3 Org-level execution (~70% complete)

| Asset | Path | Status |
|-------|------|--------|
| Migration 0043 | `migrations/0043_*.sql` | Landed — nullable `subaccountId` on `agent_runs`, `execution_mode`, `result_status`, `config_snapshot` |
| Org agent configs | `server/db/schema/orgAgentConfigs.ts` + `server/services/orgAgentConfigService.ts` | Exists |
| Execution service | `server/services/agentExecutionService.ts` | Updated — execution mode routing, kill switch, config loading |
| Schedule service | `server/services/agentScheduleService.ts` | Updated — org-level job queue (`agent-org-scheduled-run`) |

**Gap:** Null-subaccountId guards incomplete in workspace memory, board context, dev context, triggers, insights extraction. Skill executor audit for null subaccountId across ~47 tool functions not complete.

### 2.4 Intelligence skills (~40% complete)

| Asset | Path | Status |
|-------|------|--------|
| Skill definitions | `server/skills/compute_health_score.md`, `compute_churn_risk.md`, `detect_anomaly.md`, `generate_portfolio_report.md`, `trigger_account_intervention.md`, `query_subaccount_cohort.md`, `read_org_insights.md`, `write_org_insight.md` | Exist as markdown definitions |
| Executor framework | `server/services/intelligenceSkillExecutor.ts` (485 lines) | Exists — framework with registered skills in action registry |
| Action registry | `server/config/actionRegistry.ts` | Intelligence skills registered |

**Gap:** Executor functions are framework-only — need wiring to real `canonicalDataService` queries. Health score calculation, anomaly detection algorithm, churn risk model, and portfolio report generation are not yet implemented against real data.

### 2.5 Platform primitives (100% complete)

These require zero new work for ClientPulse:

- Three-tier org/subaccount data model
- `agent_data_sources` cascade with eager/lazy loading
- Scheduled tasks + heartbeat via pg-boss (minute-precision offsets)
- HITL review gates
- RLS three-layer tenant isolation + scope assertions
- Run traces, cost breakers, budget reservations
- Memory blocks (per-agency preferences)
- `send_email`, `send_to_slack` skills
- `useSocket` WebSocket hook for real-time dashboard refreshes
- DB-backed system skills (`systemSkillService`, migrations 0097–0099)
- Skill versioning (`skill_versions`, migration 0101)

### 2.6 Client-side infrastructure

| Asset | Path | Notes |
|-------|------|-------|
| Router | `client/src/App.tsx` | React Router v6, lazy loading, `ProtectedLayout` wrapper, `OrgAdminGuard` / `SystemAdminGuard` |
| Layout + sidebar | `client/src/components/Layout.tsx` | Permission-driven nav via `/api/my-permissions`, org/subaccount context in localStorage, breadcrumbs |
| ColHeader pattern | `client/src/pages/SystemSkillsPage.tsx` | `ColHeader` + `NameColHeader` components — `Set<T>` exclusion filters, sort indicators, indigo active-filter dots, "Clear all" button |
| Realtime | `client/src/hooks/useSocket.ts` | `useSocket()`, `useSocketRoom()`, `useSocketConnected()` — room-based subscriptions with dedup |
| API wrapper | `client/src/lib/api.ts` | Bearer token, `X-Organisation-Id` header for system admin scoping, 401 redirect |
| Auth | `client/src/lib/auth.ts` | JWT in localStorage, org/subaccount context helpers |
| OpsDashboardPage | `client/src/pages/OpsDashboardPage.tsx` | Operator-facing activity feed — **explicitly NOT the ClientPulse customer dashboard** |

**Gap:** No module-driven sidebar. No customer-facing Dashboard page. No Reports page. No onboarding wizard. No public signup flow.

---

## 3. Module A — Modules table & allowlist enforcement

**Depends on:** nothing (foundation module)
**Depended on by:** all other modules

### 3.1 Purpose

Introduce a `modules` table as a first-class runtime entitlement concept. Modules declare which system-backed agents are allowed to run for an org. Enforcement happens at four points: scheduling, execution, agent list UI, and write paths that activate agents. The module also drives sidebar shape — each module declares which nav items its users see.

### 3.2 Data model

#### New table: `modules`

```sql
-- Migration: 0104_modules.sql
CREATE TABLE modules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                TEXT NOT NULL UNIQUE,
  display_name        TEXT NOT NULL,
  description         TEXT,
  allowed_agent_slugs JSONB,           -- string[] of system agent slugs, NULL if allow_all_agents
  allow_all_agents    BOOLEAN NOT NULL DEFAULT false,
  sidebar_config      JSONB,           -- ordered array of nav-item slugs
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);
```

**Drizzle schema file:** `server/db/schema/modules.ts`

#### Seed data (in the same migration)

```sql
INSERT INTO modules (slug, display_name, description, allowed_agent_slugs, allow_all_agents, sidebar_config)
VALUES
  ('client_pulse', 'ClientPulse', 'Weekly client health reports and churn-risk alerts for agencies',
   '["reporting_agent"]'::jsonb, false,
   '["dashboard","inbox","companies","reports","integrations","team","manage_org"]'::jsonb),
  ('full_access', 'Full Access', 'Unlock every agent and the full operator UI',
   NULL, true,
   '["inbox","companies","agents","workflows","skills","integrations","team","health","manage_org","dashboard","reports"]'::jsonb);
```

### 3.3 Allowlist resolver

**New file:** `server/services/moduleService.ts`

```typescript
// Core resolver — called by scheduling, execution, UI, and write-to-activate paths
async function getAllowedAgentSlugs(orgId: string): Promise<Set<string> | 'all'>

// Resolution logic:
// 1. Look up org's active org_subscriptions row (requires Module G table — see §4)
// 2. Follow subscription_id → subscriptions.module_ids
// 3. Load referenced modules rows
// 4. If any module has allow_all_agents = true → return 'all'
// 5. Otherwise union all allowed_agent_slugs arrays → return Set<string>

async function isAgentAllowedForOrg(agentSlug: string, orgId: string): Promise<boolean>
// Calls getAllowedAgentSlugs, checks membership. Org-created agents (systemAgentId IS NULL) bypass.

async function getSidebarConfig(orgId: string): Promise<string[]>
// Same resolution path, unions sidebar_config arrays from active modules (ordered, deduped).
```

**Caching:** Per-request cache on `req._moduleAllowlistCache` (same pattern as permission caching on `req._orgPermissionCache`). Invalidated on subscription change.

**Bootstrap dependency:** `getAllowedAgentSlugs` depends on `org_subscriptions` (Module G). During implementation of Module A, if Module G tables don't exist yet, stub the resolver to return `'all'` and add a `TODO(module-g)` marker. The enforcement points are wired now; the data source is plugged in when Module G lands. Both modules can be developed in parallel since the interface is stable.

### 3.4 Enforcement points

#### 3.4.1 Scheduling

**File:** `server/services/agentScheduleService.ts`

At `enqueue()` — before writing the pg-boss job:

```typescript
const agent = await agentService.getAgent(agentId, orgId);
if (agent.systemAgentId) {
  const systemAgent = await systemAgentService.getAgent(agent.systemAgentId);
  const allowed = await moduleService.isAgentAllowedForOrg(systemAgent.slug, orgId);
  if (!allowed) {
    logger.info({ agentId, orgId, slug: systemAgent.slug }, 'Skipping schedule — agent not in module allowlist');
    return; // silently skip
  }
}
```

#### 3.4.2 Execution

**File:** `server/services/agentExecutionService.ts`

On dequeue (before the agentic loop starts) — re-check because subscription may have changed between enqueue and execute:

```typescript
if (agent.systemAgentId) {
  const systemAgent = await systemAgentService.getAgent(agent.systemAgentId);
  const allowed = await moduleService.isAgentAllowedForOrg(systemAgent.slug, orgId);
  if (!allowed) {
    await markRunAs(runId, 'skipped_module_disabled');
    return;
  }
}
```

New `result_status` enum value: `'skipped_module_disabled'`. Added via ALTER TYPE in the migration.

#### 3.4.3 Agent list UI filtering

**File:** `server/routes/agents.ts` (the org-level agent list endpoint)

Add a query parameter `?respectModuleAllowlist=true` (default `true` for non-system-admin callers). When active, filter the returned list to agents whose system agent slug is in the allowlist. System admins see all agents regardless, but disallowed ones are annotated with `{ disabledByModule: true }` so the UI can render a badge.

#### 3.4.4 Write-to-activate guard

**Files:** Any route that sets `heartbeatEnabled: true`, `scheduleEnabled: true`, or re-enables a disabled agent.

- `server/routes/agents.ts` — PATCH agent
- `server/routes/subaccountAgents.ts` — PATCH subaccount agent link
- `server/services/agentScheduleService.ts` — `updateSchedule()`

Before allowing the activation write:

```typescript
if (agent.systemAgentId) {
  const allowed = await moduleService.isAgentAllowedForOrg(systemAgent.slug, orgId);
  if (!allowed) {
    throw { statusCode: 403, message: 'Agent not available on current subscription', errorCode: 'module_not_entitled' };
  }
}
```

No `?override=true` escape hatch in v1.

### 3.5 Sidebar config integration

**File:** `client/src/components/Layout.tsx`

Currently the sidebar is a static list of nav items gated by permissions. Change to:

1. Add a new API endpoint: `GET /api/my-sidebar-config` — returns the ordered nav-item slug array from `moduleService.getSidebarConfig(orgId)`. Returns the full static list for system admins.
2. In `Layout.tsx`, fetch this endpoint alongside `/api/my-permissions`.
3. Filter the nav items list: only render items whose slug is in the sidebar config array.
4. Permission checks still apply on top — sidebar config removes items the module doesn't expose; permissions remove items the user's role can't access. Both filters must pass.

**Nav item slug registry** (new constant, `client/src/lib/navSlugs.ts`):

```typescript
export const NAV_SLUGS = {
  dashboard: 'dashboard',
  inbox: 'inbox',
  companies: 'companies',
  agents: 'agents',
  workflows: 'workflows',
  skills: 'skills',
  integrations: 'integrations',
  team: 'team',
  health: 'health',
  manage_org: 'manage_org',
  reports: 'reports',
} as const;
```

Each nav item in `Layout.tsx` gets a `slug` prop mapped to this registry. The sidebar config from the API is compared against these slugs.

### 3.6 Seed-script hygiene

**Problem:** The UI currently shows two "GHL Agency Intelligence" template rows (one with 1 agent, one with 0).

**Fix:**
1. Audit `scripts/seed-*.ts` and migration 0068 to find both insertion points.
2. Ensure the master seed uses upsert semantics keyed on `slug` (not `id`): `INSERT ... ON CONFLICT (slug) DO UPDATE SET ...`.
3. Write a one-time cleanup migration that deletes the duplicate row (the one with 0 agents) by checking `NOT EXISTS (SELECT 1 FROM system_hierarchy_template_slots WHERE template_id = t.id)`.
4. Add a unique constraint on `system_hierarchy_templates.slug` if not already present.

### 3.7 System admin UI for modules

**New page:** `/system/modules` — `SystemModulesPage.tsx`

**Features:**
- List all modules: display name, slug, allowed-agent count (or "All"), in-use-by-N-orgs count
- Edit module: display name (text), description (textarea), allowed_agent_slugs (checkbox picker over system agents), allow_all_agents toggle, sidebar_config (ordered list editor)
- Slug is read-only after creation
- Prevent deletion if any subscription references the module (soft-delete only when no references)

**Routes:**

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/system/modules` | `requireSystemAdmin` | List all modules |
| GET | `/api/system/modules/:id` | `requireSystemAdmin` | Get single module |
| POST | `/api/system/modules` | `requireSystemAdmin` | Create module |
| PATCH | `/api/system/modules/:id` | `requireSystemAdmin` | Update module |
| DELETE | `/api/system/modules/:id` | `requireSystemAdmin` | Soft-delete (blocked if referenced by subscriptions) |

**Service:** `server/services/moduleService.ts` — CRUD methods alongside the allowlist resolver.

### 3.8 Verification

- [ ] Unit test (pure): `moduleServicePure.test.ts` — test `getAllowedAgentSlugs` with various module combinations (single module, multiple modules, wildcard, empty)
- [ ] Verify scheduling skips disallowed agents: create an org with `client_pulse` module only, attempt to schedule a non-reporting agent → silently skipped
- [ ] Verify execution re-checks: enqueue a run, change subscription before it executes → run marked `skipped_module_disabled`
- [ ] Verify write-to-activate guard: attempt `PATCH /api/agents/:id { heartbeatEnabled: true }` for a disallowed agent → 403
- [ ] Verify sidebar filtering: org with `client_pulse` module → sidebar shows only Dashboard, Inbox, Companies, Reports, Integrations, Team, Manage Org
- [ ] Verify system admin sees full sidebar regardless of org's module
- [ ] Verify duplicate template row is cleaned up
- [ ] `npm run lint` + `npm run typecheck` pass

---

## 4. Module G (partial) — Subscriptions, billing data model & admin UI

**Depends on:** Module A (modules table must exist)
**Depended on by:** Module A's allowlist resolver (data source), Module D (onboarding assigns subscription)

This section covers the subscription catalogue, per-org assignment, and the system-admin UI. Stripe integration is deferred to §10.

### 4.1 Data model

#### New table: `subscriptions`

```sql
-- Migration: 0105_subscriptions.sql
CREATE TABLE subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    TEXT NOT NULL UNIQUE,
  display_name            TEXT NOT NULL,
  description             TEXT,
  module_ids              JSONB NOT NULL DEFAULT '[]'::jsonb,   -- array of module UUIDs
  price_monthly_cents     INTEGER,                               -- null = free / comped
  price_yearly_cents      INTEGER,
  yearly_discount_percent INTEGER NOT NULL DEFAULT 20,
  currency                TEXT NOT NULL DEFAULT 'USD',
  subaccount_limit        INTEGER,                               -- null = unlimited
  trial_days              INTEGER NOT NULL DEFAULT 14,
  status                  TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('active', 'draft', 'archived')),
  stripe_product_id       TEXT,
  stripe_price_id_monthly TEXT,
  stripe_price_id_yearly  TEXT,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at              TIMESTAMPTZ
);
```

#### New table: `org_subscriptions`

```sql
CREATE TABLE org_subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id         UUID NOT NULL REFERENCES organisations(id),
  subscription_id         UUID NOT NULL REFERENCES subscriptions(id),
  billing_cycle           TEXT NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'yearly', 'comp')),
  status                  TEXT NOT NULL DEFAULT 'trialing'
    CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled', 'paused')),
  trial_ends_at           TIMESTAMPTZ,
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  stripe_subscription_id  TEXT,
  is_comped               BOOLEAN NOT NULL DEFAULT false,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active subscription per org at a time
CREATE UNIQUE INDEX uq_org_subscriptions_active
  ON org_subscriptions (organisation_id)
  WHERE status IN ('trialing', 'active', 'past_due');
```

**Drizzle schema files:** `server/db/schema/subscriptions.ts`, `server/db/schema/orgSubscriptions.ts`

#### Seed data (in the same migration)

```sql
-- Requires modules table from migration 0104
INSERT INTO subscriptions (slug, display_name, description, module_ids, price_monthly_cents, subaccount_limit, trial_days, status)
VALUES
  ('starter', 'Starter',
   'Monitor up to 10 client accounts with weekly health reports',
   (SELECT jsonb_agg(id) FROM modules WHERE slug = 'client_pulse'),
   NULL, 10, 14, 'active'),
  ('growth', 'Growth',
   'Monitor up to 30 client accounts with weekly health reports',
   (SELECT jsonb_agg(id) FROM modules WHERE slug = 'client_pulse'),
   NULL, 30, 14, 'active'),
  ('scale', 'Scale',
   'Monitor up to 100 client accounts with weekly health reports',
   (SELECT jsonb_agg(id) FROM modules WHERE slug = 'client_pulse'),
   NULL, 100, 14, 'active'),
  ('full_access_internal', 'Full Access (Internal)',
   'Unlock every agent — for Synthetos internal and design-partner orgs',
   (SELECT jsonb_agg(id) FROM modules WHERE slug = 'full_access'),
   NULL, NULL, 0, 'draft');
```

Prices intentionally NULL — lock before Stripe integration.

### 4.2 Service layer

**New file:** `server/services/subscriptionService.ts`

```typescript
// Subscription catalogue CRUD (system admin)
async function listSubscriptions(): Promise<Subscription[]>
async function getSubscription(id: string): Promise<Subscription>
async function createSubscription(data: CreateSubscriptionInput): Promise<Subscription>
async function updateSubscription(id: string, data: UpdateSubscriptionInput): Promise<Subscription>
async function archiveSubscription(id: string): Promise<void>
  // Blocked if any org_subscriptions reference it with status in ('trialing','active','past_due')

// Per-org assignment
async function getOrgSubscription(orgId: string): Promise<OrgSubscription | null>
async function assignSubscription(orgId: string, data: AssignSubscriptionInput): Promise<OrgSubscription>
  // Creates org_subscriptions row. If org already has an active subscription, deactivate the old one first.
  // Emits audit_event with actor, old subscription, new subscription, module delta preview.
async function updateOrgSubscription(orgId: string, data: UpdateOrgSubscriptionInput): Promise<OrgSubscription>
  // For status changes, trial overrides, comp toggles.
async function cancelOrgSubscription(orgId: string): Promise<void>
  // Sets status = 'cancelled'. Allowlist immediately contracts on next resolver call.

// Module delta preview (for confirmation dialog)
async function previewSubscriptionChange(orgId: string, newSubscriptionId: string): Promise<{
  addedAgents: string[];
  removedAgents: string[];
  addedSidebarItems: string[];
  removedSidebarItems: string[];
}>
```

**Pure companion:** `server/services/subscriptionServicePure.ts` — module delta computation, yearly price auto-calculation, validation.

### 4.3 Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/system/subscriptions` | `requireSystemAdmin` | List subscription catalogue |
| GET | `/api/system/subscriptions/:id` | `requireSystemAdmin` | Get single subscription |
| POST | `/api/system/subscriptions` | `requireSystemAdmin` | Create subscription |
| PATCH | `/api/system/subscriptions/:id` | `requireSystemAdmin` | Update subscription |
| DELETE | `/api/system/subscriptions/:id` | `requireSystemAdmin` | Archive (soft-delete, blocked if active orgs) |
| GET | `/api/system/orgs/:orgId/subscription` | `requireSystemAdmin` | Get org's current subscription |
| POST | `/api/system/orgs/:orgId/subscription` | `requireSystemAdmin` | Assign subscription to org |
| PATCH | `/api/system/orgs/:orgId/subscription` | `requireSystemAdmin` | Update org subscription (status, trial, comp) |
| DELETE | `/api/system/orgs/:orgId/subscription` | `requireSystemAdmin` | Cancel org subscription |
| GET | `/api/system/orgs/:orgId/subscription/preview-change?subscriptionId=...` | `requireSystemAdmin` | Module delta preview |
| GET | `/api/my-subscription` | `authenticate` | Current user's org subscription (for client-side gating) |

**Route file:** `server/routes/subscriptions.ts`

### 4.4 System admin UI

#### Subscription catalogue page

**New page:** `/system/subscriptions` — `SystemSubscriptionsPage.tsx`

**List view:**
- Table with ColHeader sort/filter (follows `SystemSkillsPage` pattern)
- Columns: Display name, Slug, Status, Modules (badge list), Monthly price, Yearly price, Subaccount limit, Trial days, Active orgs count
- Filter on Status (active/draft/archived)
- Create button opens a form modal or inline form

**Edit form fields:**
- Display name (text input)
- Slug (text input, read-only after first save, auto-generated from display name on create)
- Description (textarea)
- Modules (checkbox list from `GET /api/system/modules`, shows display name + slug)
- Monthly price (dollar input → stored as cents)
- Yearly discount % (integer, default 20) — auto-calculates yearly price
- Yearly price (dollar input, editable override — recalculates implied discount)
- Currency (dropdown, default USD)
- Subaccount limit (integer, blank = unlimited)
- Trial days (integer, default 14)
- Status (Draft / Active / Archived)
- Internal notes (textarea)
- Stripe fields (product ID, price IDs) — displayed but editable only when non-empty; greyed out with "Configure in Stripe first" message when empty

#### Per-org subscription management

**Location:** Tab on existing org detail page, or new `/system/orgs/:id/subscription`

**Features:**
- Current subscription summary (or "No subscription")
- Subscription dropdown (Active + Draft subscriptions)
- Confirmation dialog showing module delta: "This change adds: [agents]. Removes: [agents]."
- Comp toggle (`is_comped: true`)
- Trial end date override (date picker)
- Subaccount limit override for this org
- Pause / Cancel / Reactivate buttons
- Internal notes field
- Change history (from `audit_events`)

### 4.5 Wiring Module A's allowlist resolver

With the `subscriptions` and `org_subscriptions` tables in place, update `moduleService.getAllowedAgentSlugs(orgId)` to:

1. `SELECT os.* FROM org_subscriptions os WHERE os.organisation_id = $1 AND os.status IN ('trialing', 'active', 'past_due')`
2. If no row → return empty set (no agents allowed — org has no subscription)
3. `SELECT s.module_ids FROM subscriptions s WHERE s.id = os.subscription_id`
4. `SELECT * FROM modules WHERE id = ANY(s.module_ids) AND deleted_at IS NULL`
5. Union `allowed_agent_slugs` or short-circuit to `'all'` if any module has `allow_all_agents = true`

### 4.6 Verification

- [ ] Unit test (pure): `subscriptionServicePure.test.ts` — yearly price auto-calculation, module delta computation
- [ ] Create a subscription via admin UI → verify it appears in the catalogue
- [ ] Assign subscription to org → verify `GET /api/my-subscription` returns it
- [ ] Assign `client_pulse` subscription → verify only `reporting_agent` is in the allowlist
- [ ] Switch to `full_access_internal` → verify all agents are in the allowlist
- [ ] Cancel subscription → verify allowlist returns empty set
- [ ] Comp an org → verify subscription works without Stripe
- [ ] Archive a subscription with active orgs → verify it's blocked
- [ ] `npm run lint` + `npm run typecheck` pass

---

## 5. Module C — GHL data connector completion

**Depends on:** nothing (parallelisable with A/G)
**Depended on by:** Module B (intelligence executors need real data), Module D (onboarding triggers sync)

### 5.1 Current state (updated per codebase audit)

The GHL adapter at `server/adapters/ghlAdapter.ts` is more complete than the brief suggested. The codebase audit found:

- **`listAccounts`** — implemented, calls `GET /locations/search?companyId={id}&limit=100`
- **`fetchContacts`** — implemented with pagination and `since` filter, maps to canonical contact shape
- **`fetchOpportunities`** — implemented with status mapping (open/won/lost/abandoned), stage tracking
- **`fetchConversations`** — implemented, maps channel/status/messageCount/lastMessageAt
- **`fetchRevenue`** — implemented, amounts in cents from GHL converted to dollars, status mapping
- **`validateCredentials`** — implemented, checks token via locations/search
- **`computeMetrics`** — implemented, derives 7 metrics from entity counts
- **`verifySignature`** — HMAC-SHA256 timing-safe comparison
- **`normaliseEvent`** — maps Contact/Opportunity/Conversation/Revenue events to canonical types

**`connectorPollingService.syncConnector()`** — fully implemented: resolves connection → fetches account list → upserts canonical accounts → per-account fetches (contacts, opps, conversations, revenue) → computes metrics → updates sync status.

### 5.2 Remaining work

Despite the adapter being functional, the following gaps remain for production readiness:

#### 5.2.1 Agency-token vs location-token exchange

**Pre-implementation gate.** The adapter assumes a single agency-level OAuth token can call per-location endpoints with `locationId` as a query parameter. This is unverified against a live GHL agency.

**Action items:**
1. Install the app on a test GHL agency with 3–5 sub-accounts
2. Call each fetch method (`fetchContacts`, `fetchOpportunities`, `fetchConversations`, `fetchRevenue`) using the agency token
3. If any endpoint returns 401/403 for a location-scoped call:

**Fallback implementation** (add to `ghlAdapter.ts`):

```typescript
async function getLocationToken(
  connection: DecryptedConnection,
  locationId: string
): Promise<string> {
  const cacheKey = `ghl:loc-token:${connection.id}:${locationId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const response = await withBackoff({
    label: 'ghl.getLocationToken',
    isRetryable: isTransientGhlError,
    maxAttempts: 3,
  }, () => fetch('https://services.leadconnectorhq.com/oauth/locationToken', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${connection.accessToken}`,
      'Version': '2021-07-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ companyId: connection.configJson.companyId, locationId }),
  }));

  const data = await response.json();
  tokenCache.set(cacheKey, { token: data.access_token, expiresAt: Date.now() + (data.expires_in * 1000) - 60000 });
  return data.access_token;
}
```

Cache keyed on `(connectionId, locationId)` with TTL from GHL's response minus 60s buffer. Build this helper early regardless — cheap insurance against GHL API changes.

#### 5.2.2 Route path alignment

**Current mount paths** (in `server/index.ts`):
- GHL webhook: mounted before body parsing at a GHL-specific path
- OAuth callback: handled by `oauthIntegrationsRouter`

**Required changes:**
1. **Webhook path:** Rename the mount path to `/webhooks/ingest` (or add an alias). The internal filename `ghlWebhook.ts` stays. The handler already dispatches by event type, so future connectors sharing the same endpoint would need a connector-type header or sub-path.
2. **OAuth callback:** Verify the existing `oauthIntegrationsRouter` already handles `/oauth/callback` or create a new route at that path with state-parameter dispatch. The route exchanges the authorization code for tokens via `integrationConnectionService`.

**Implementation note:** Since the GHL marketplace URL validator rejects paths containing `ghl` / `gohighlevel` / `highlevel` / `hl` / `leadconnector`, the registered paths must be generic: `/oauth/callback` and `/webhooks/ingest`.

#### 5.2.3 Webhook event normalisation gaps

The `normaliseEvent` function handles the core events. Verify these additional events are handled or silently dropped:

| Event | Current handling | Action needed |
|-------|-----------------|---------------|
| `INSTALL` | Needs verification | Add handler: create `integration_connections` row, trigger initial `syncConnector` |
| `UNINSTALL` | Needs verification | Add handler: mark connection as `disconnected`, disable scheduled runs |
| `LocationCreate` | Not handled | Add: create new `canonical_accounts` row, trigger sync for new location |
| `LocationUpdate` | Not handled | Add: update `canonical_accounts` metadata |
| `OpportunityDelete` | Not handled | Add: soft-delete canonical opportunity |

For `INSTALL`/`UNINSTALL`, wire them to the `integrationConnectionService` lifecycle. For `LocationCreate`/`LocationUpdate`, wire to `canonicalDataService.upsertAccount()`.

#### 5.2.4 Sync-phase state machine

`connectorConfigs.syncPhase` supports `'backfill' | 'transition' | 'live'`. The polling service needs:

1. **Backfill phase** (initial sync): Full historical pull of all entities. Set `syncPhase = 'backfill'` on first connect. Transition to `'transition'` when the backfill job completes for all accounts.
2. **Transition phase**: Process any webhooks queued during backfill (webhooks arrive from moment of install but shouldn't be processed until backfill establishes the baseline). Replay the webhook queue chronologically. Transition to `'live'` when the queue is drained.
3. **Live phase**: Webhooks processed in real-time. Polling runs on `pollIntervalMinutes` cadence as a consistency check (catches dropped webhooks).

**Implementation in `connectorPollingService`:**

```typescript
async function syncConnector(connectorConfigId: string): Promise<SyncResult> {
  const config = await connectorConfigService.get(connectorConfigId);

  if (config.syncPhase === 'backfill') {
    const result = await runBackfill(config);
    if (result.complete) {
      await connectorConfigService.update(connectorConfigId, { syncPhase: 'transition' });
    }
    return result;
  }

  if (config.syncPhase === 'transition') {
    await replayQueuedWebhooks(config);
    await connectorConfigService.update(connectorConfigId, { syncPhase: 'live' });
  }

  // Live: incremental sync with since-filter
  return runIncrementalSync(config);
}
```

#### 5.2.5 Environment variables

Ensure `server/config/env.ts` reads and validates:

| Variable | Purpose |
|----------|---------|
| `GHL_APP_CLIENT_ID` | OAuth client ID |
| `GHL_APP_CLIENT_SECRET` | OAuth client secret |
| `GHL_APP_WEBHOOK_SECRET` | HMAC signing secret |
| `GHL_APP_REDIRECT_URI` | `https://app.synthetos.ai/oauth/callback` |

These should have runtime presence checks that throw on startup if any are missing when a GHL connector config exists.

### 5.3 Verification

- [ ] **Phase 0 gate:** Install on own test GHL agency, verify all five fetch methods return data
- [ ] Agency-token-vs-location-token: call each fetch method for 3+ different locations using the agency token. Document which endpoints require location tokens.
- [ ] Webhook HMAC verification: send a test webhook with valid and invalid signatures
- [ ] INSTALL webhook: creates `integration_connections` row and triggers backfill
- [ ] UNINSTALL webhook: marks connection disconnected, disables scheduled runs
- [ ] LocationCreate webhook: creates new `canonical_accounts` row
- [ ] Sync-phase transitions: backfill → transition → live
- [ ] Incremental sync with `since` filter after initial backfill
- [ ] Route paths match GHL-registered URLs (`/oauth/callback`, `/webhooks/ingest`)
- [ ] `npm run lint` + `npm run typecheck` pass

---

## 6. Module B — ClientPulse agent wiring

**Depends on:** Module C (real data must flow), Module A (allowlist must exist for the 1-agent model to work)
**Depended on by:** Module F (report generation), Module E (dashboard data), Module D (first-run trigger)

### 6.1 Agent shape

**One agent. Org-scoped. Iterates subaccounts in its own run loop.**

| Field | Value |
|-------|-------|
| System agent slug | `reporting_agent` |
| `isSystemManaged` | `true` |
| `executionScope` | `'org'` |
| Skill bundle | `compute_health_score`, `compute_churn_risk`, `detect_anomaly`, `generate_portfolio_report`, `trigger_account_intervention`, `query_subaccount_cohort`, `read_org_insights`, `write_org_insight`, `send_email` |
| Default schedule | Weekly, Monday 8am in the org's timezone |
| `heartbeatEnabled` | `true` |

The customer never sees "an agent." They see Reports, Alerts, and a Dashboard. Module A's visibility gating + Module E's sidebar narrowing hide the agent infrastructure.

### 6.2 Template provisioning via `loadToOrg()`

When `systemTemplateService.loadToOrg('ghl-agency-intelligence', orgId, {})` is called (during signup — Module D), it must:

1. Look up the "GHL Agency Intelligence" template by slug
2. For each slot in `system_hierarchy_template_slots`:
   - Find the corresponding system agent (e.g. `reporting_agent`)
   - Create an `agents` row: `organisationId = orgId`, `systemAgentId = slot.systemAgentId`, `isSystemManaged = true`, `executionScope = slot.executionScope`
   - Create an `org_agent_configs` row if the slot specifies execution scope `'org'`
   - **Do NOT create `subaccount_agents` links.** The Reporting Agent is org-scoped; it doesn't need per-subaccount links.
3. Apply memory seeds from the template's `memorySeedsJson` to org memory
4. Return the provisioned agent IDs

**Gap to fix in `systemTemplateService.ts`:** The current `loadToOrg()` may not handle `executionScope: 'org'` correctly — verify it creates `orgAgentConfigs` (not `subaccountAgents` links) for org-scoped slots. If it only creates subaccount-scoped links today, extend it.

### 6.3 GHL Agency Intelligence template seed fix

**Problem:** Duplicate "GHL Agency Intelligence" rows in the UI.

**Fix (in migration 0104 or 0105):**

```sql
-- Delete the duplicate template row (the one with zero slots)
DELETE FROM system_hierarchy_templates
WHERE slug = 'ghl-agency-intelligence'
  AND id NOT IN (
    SELECT template_id FROM system_hierarchy_template_slots
  );

-- Ensure slug uniqueness going forward
ALTER TABLE system_hierarchy_templates
  ADD CONSTRAINT uq_system_hierarchy_templates_slug UNIQUE (slug)
  WHERE deleted_at IS NULL;
```

Update the master seed script to use `INSERT ... ON CONFLICT (slug) DO UPDATE` semantics.

### 6.4 Intelligence executor wiring

The `intelligenceSkillExecutor.ts` is already config-driven (confirmed by codebase audit — 658 lines, reads factor/signal/intervention definitions from `orgConfigService`). The remaining work is verifying and tuning the signal evaluation against real canonical data.

#### Signal-to-canonical-data mapping

| Signal type | Data source | Method |
|-------------|-------------|--------|
| `metric_trend` (contact_growth_rate) | `canonicalDataService.getContactMetrics(accountId, dateRange)` | Compare recent vs previous period counts |
| `metric_trend` (pipeline_velocity) | `canonicalDataService.getOpportunityMetrics(accountId)` | Pipeline value, stage transitions per period |
| `metric_trend` (revenue_trend) | `canonicalMetrics` for `revenue_trend` slug | Recent vs previous revenue |
| `metric_threshold` (stale_deal_ratio) | `canonicalDataService.getOpportunityMetrics(accountId)` | % of deals with no stage change in N days |
| `metric_trend` (conversation_engagement) | `canonicalMetrics` for `conversation_engagement` slug | Message count / response rate trends |
| `staleness` (days_since_last_sync) | `canonicalAccounts.lastSyncAt` | Days since last successful sync |
| `anomaly_count` | `canonicalDataService.getRecentAnomalies(accountId)` | Count of anomaly events in last 7 days |

#### Health score computation

The `computeMetrics()` method in `ghlAdapter.ts` already derives 7 metrics. The `intelligenceSkillExecutor.evaluateSignal()` reads these from `canonicalMetrics`. The default health score weights from the brief:

| Factor | Weight |
|--------|--------|
| Pipeline velocity | 30% |
| Conversation engagement | 25% |
| Contact growth | 20% |
| Revenue trend | 15% |
| Platform activity | 10% |

These weights are stored in the template's `operationalDefaults` JSONB and read by `orgConfigService` at runtime. The `evaluateSignal` → `computeChurnRisk` → `classifyHealth` pipeline is already implemented — the work is ensuring the `orgConfigService` loads the GHL Agency Intelligence template's operational defaults correctly.

#### Portfolio report generation

The `generate_portfolio_report` skill handler must:

1. List all active GHL-linked canonical accounts for the org: `canonicalDataService.getAccountsByOrg(orgId)`
2. For each account:
   - Call `evaluateSignal` for each configured factor → per-client health score
   - Call `computeChurnRisk` → per-client churn risk with confidence
   - Call `getRecentAnomalies` → per-client anomaly list
   - Classify: `classifyHealth` → red/yellow/green
3. Aggregate into a portfolio summary: total clients, breakdown by health status, top anomalies, highest-risk clients
4. Persist the report (see §6.5)
5. Return the structured report data for `send_email` to consume

### 6.5 Reports table

#### New table: `reports`

```sql
-- Migration: 0106_reports.sql (or combined with earlier migrations)
CREATE TABLE reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   UUID NOT NULL REFERENCES organisations(id),
  agent_run_id      UUID REFERENCES agent_runs(id),
  report_type       TEXT NOT NULL DEFAULT 'portfolio_health'
    CHECK (report_type IN ('portfolio_health', 'anomaly_alert', 'custom')),
  title             TEXT NOT NULL,
  summary_text      TEXT,                    -- plain text executive summary
  report_data       JSONB NOT NULL,          -- structured report payload
  html_content      TEXT,                    -- rendered HTML (for email + in-app viewer)
  status            TEXT NOT NULL DEFAULT 'generated'
    CHECK (status IN ('generating', 'generated', 'delivered', 'failed')),
  delivered_at      TIMESTAMPTZ,
  delivery_method   TEXT,                    -- 'email', 'in_app', 'both'
  delivery_metadata JSONB,                   -- email recipients, message IDs, etc.
  period_start      TIMESTAMPTZ,
  period_end        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reports_org_created ON reports (organisation_id, created_at DESC);
```

**Drizzle schema file:** `server/db/schema/reports.ts`

**`report_data` JSONB shape:**

```typescript
interface PortfolioReportData {
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  totalClients: number;
  healthBreakdown: { healthy: number; atRisk: number; critical: number };
  clients: Array<{
    accountId: string;
    displayName: string;
    healthScore: number;
    healthStatus: 'healthy' | 'at_risk' | 'critical';
    churnRisk: { score: number; confidence: number; factors: string[] };
    anomalies: Array<{ metric: string; message: string; severity: string }>;
    metrics: Record<string, { current: number; previous: number; trend: 'up' | 'down' | 'flat' }>;
  }>;
  topAnomalies: Array<{ clientName: string; metric: string; message: string }>;
  highestRiskClients: Array<{ clientName: string; churnScore: number; primaryFactor: string }>;
}
```

### 6.6 Report service

**New file:** `server/services/reportService.ts`

```typescript
async function createReport(orgId: string, data: CreateReportInput): Promise<Report>
async function getReport(id: string, orgId: string): Promise<Report>
async function listReports(orgId: string, opts?: { limit, offset, reportType }): Promise<{ reports: Report[]; total: number }>
async function updateReportStatus(id: string, orgId: string, status: string, metadata?: object): Promise<void>
async function getLatestReport(orgId: string): Promise<Report | null>
```

### 6.7 Reporting Agent run loop

The Reporting Agent's `masterPrompt` should instruct it to:

1. Query org's active GHL-linked subaccounts
2. Iterate client-by-client in a single run (no handoffs, no sub-agent spawning)
3. Per client: call `compute_health_score`, `detect_anomaly`, `compute_churn_risk`
4. Call `generate_portfolio_report` with aggregated data
5. Call `send_email` with the rendered HTML report
6. Write org insight summarising the week's findings

This is a system-managed agent — the `masterPrompt` is platform IP, not editable by the org. The org can only edit `additionalPrompt` (e.g. "Focus especially on clients X, Y, Z" or "Skip clients tagged 'paused'").

### 6.8 First-run trigger

When the initial GHL data sync completes (all accounts synced), immediately trigger one run of the Reporting Agent. Do not wait for the weekly schedule.

**Implementation:** In `connectorPollingService`, after the final account's sync completes:

```typescript
if (isInitialSync && allAccountsSynced) {
  await agentScheduleService.triggerImmediateRun({
    agentId: reportingAgent.id,
    orgId,
    runSource: 'trigger',
    triggerContext: { reason: 'initial_sync_complete' },
  });
}
```

### 6.9 Verification

- [ ] `loadToOrg('ghl-agency-intelligence', orgId)` creates exactly one org-scoped agent with `isSystemManaged: true`
- [ ] No `subaccount_agents` links created
- [ ] Reporting Agent run iterates across 3+ canonical accounts and produces per-client health data
- [ ] `generate_portfolio_report` writes a `reports` row with valid `report_data` JSONB
- [ ] `send_email` delivers the report to the org owner's email
- [ ] First-run trigger fires immediately after initial sync
- [ ] Weekly schedule fires on the configured day/time
- [ ] Health score weights from `operationalDefaults` are correctly applied
- [ ] `npm run lint` + `npm run typecheck` pass
- [ ] `npm test` — intelligence executor pure tests pass

---

## 7. Module F — HTML email report delivery

**Depends on:** Module B (report data structure)
**Depended on by:** Module D (first report delivery), Module E (same HTML rendered in-app)
**Parallelisable with:** Module B

### 7.1 Design decisions

- **No PDF, no headless browser.** Playwright on Replit is painful (large binaries, memory pressure, unreliable cold starts). HTML email is simpler and what customers actually prefer.
- **Inline charts** via a hosted image service (`quickchart.io`) or server-side rendering (`chartjs-node-canvas`). No browser dependency.
- **Single template, two surfaces.** The same HTML is delivered via email and rendered in-app on the Reports page. The template must be email-client-safe (inline CSS, table layout, no external JS).
- **PDF deferred to v1.1** via `@react-pdf/renderer` (pure JS, no browser) — only if customers ask.

### 7.2 Report HTML template

**New file:** `server/templates/portfolio-report.ts`

A TypeScript function that takes a `PortfolioReportData` object (from §6.5) and returns an HTML string. Not a template engine — a pure function.

```typescript
export function renderPortfolioReportHtml(data: PortfolioReportData, orgName: string): string
```

**Template sections:**
1. **Header** — Synthetos logo, org name, report period, generation timestamp
2. **Executive summary** — "N clients monitored. X healthy, Y at risk, Z critical. Top finding: [most severe anomaly]."
3. **Portfolio overview** — table with per-client row: client name, health score (colour-coded badge), trend arrow, churn risk, anomaly count
4. **Critical clients detail** — expanded section for red/critical clients: per-metric breakdown, anomaly descriptions, recommended actions
5. **At-risk clients detail** — same format, yellow/at-risk
6. **Healthy clients summary** — compact list (no expansion needed)
7. **Inline charts** — portfolio health distribution (pie/donut), health score trend over time (line), top anomalies bar chart
8. **Footer** — "Powered by Synthetos", unsubscribe link, view-in-app link

**Chart rendering approach:**

Option A — `quickchart.io` (simpler, external dependency):
```typescript
const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
// Embed as <img src="..."> in the email HTML
```

Option B — `chartjs-node-canvas` (no external dependency, runs in-process):
```typescript
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
const canvas = new ChartJSNodeCanvas({ width: 600, height: 300 });
const imageBuffer = await canvas.renderToBuffer(chartConfig);
// Convert to base64 data URI or upload to storage and reference by URL
```

**Recommendation:** Start with `quickchart.io` for speed. Migrate to `chartjs-node-canvas` if the external dependency becomes a problem.

### 7.3 Email delivery

Uses the existing `send_email` skill handler in `skillExecutor.ts`. The Reporting Agent calls `send_email` with:

```typescript
{
  to: orgOwnerEmail,  // from org's primary user
  subject: `ClientPulse Weekly Report — ${orgName} — ${periodLabel}`,
  html: renderedHtml,
  replyTo: 'reports@synthetos.ai',
}
```

The `send_email` handler already uses `withBackoff` for retries. No new infrastructure needed — the email provider is already configured.

### 7.4 Report status tracking

After email delivery, update the `reports` row:

```typescript
await reportService.updateReportStatus(reportId, orgId, 'delivered', {
  method: 'email',
  recipients: [orgOwnerEmail],
  sentAt: new Date().toISOString(),
});
```

### 7.5 Dependencies

**npm packages:**
- `quickchart.io` — no package needed, just URL construction
- OR `chartjs-node-canvas` + `chart.js` — if going with server-side rendering

### 7.6 Verification

- [ ] `renderPortfolioReportHtml` produces valid HTML for a sample `PortfolioReportData` with 5 clients
- [ ] HTML renders correctly in Gmail, Outlook, Apple Mail (test with a real email send)
- [ ] Inline charts render as images in the email
- [ ] Same HTML renders correctly in-browser (for the in-app Reports page)
- [ ] Report status transitions: generating → generated → delivered
- [ ] `npm run lint` + `npm run typecheck` pass

---

## 8. Module E — Template-driven UI narrowing, Dashboard & Reports

**Depends on:** Module A (sidebar config), Module B (report data), Module F (HTML template)
**Depended on by:** Module D (post-onboarding landing page)
**Parallelisable with:** Module B and F once Module A's sidebar config shape lands

### 8.1 Sidebar narrowing

Covered in §3.5 (Module A). The sidebar reads `sidebar_config` from the active module set and filters nav items accordingly. No additional work here beyond what Module A specifies.

### 8.2 New pages

#### 8.2.1 Customer Dashboard — `ClientPulseDashboardPage.tsx`

**Route:** `/dashboard` (top-level, first thing users see after onboarding)

**NOT the same as `OpsDashboardPage`** (operator-facing at `/admin/ops`). These are two different pages for two different personas. The ClientPulse customer Dashboard is portfolio-health-focused; the Ops Dashboard is an internal activity feed.

**Data source:** `GET /api/dashboard` — new endpoint that returns:

```typescript
interface DashboardData {
  totalClients: number;
  healthBreakdown: { healthy: number; atRisk: number; critical: number };
  latestReport: { id: string; createdAt: string; title: string } | null;
  recentAnomalies: Array<{ clientName: string; metric: string; message: string; detectedAt: string }>;
  highRiskClients: Array<{ accountId: string; displayName: string; churnScore: number; healthScore: number }>;
  syncStatus: { totalAccounts: number; syncedAccounts: number; lastSyncAt: string | null };
}
```

**Service:** `server/services/dashboardService.ts` — aggregates from `canonicalDataService`, `reportService`, `connectorConfigService`. Org-scoped.

**Route:** `server/routes/dashboard.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/dashboard` | `authenticate` | Dashboard data for current org |

**UI layout (widget-based, data-driven):**

1. **Sync status bar** (top) — "Monitoring N clients. Last sync: X minutes ago." If initial sync is in progress: "Syncing N clients… X done, Y to go" with a progress bar. Uses `useSocketRoom` for live updates.
2. **Health breakdown widget** — three large numbers: Healthy (green), At Risk (yellow), Critical (red). Clickable → filters the client list.
3. **Recent anomalies widget** — compact list of the last 5 anomalies with client name, metric, severity badge. Links to client detail.
4. **High-risk clients widget** — table of top 5 clients by churn score. Columns: Client name, Health score (colour badge), Churn risk (%), Primary factor.
5. **Latest report widget** — link to the most recent portfolio report with date and title. "View full report →" link.

**Real-time updates:** `useSocketRoom('org', orgId, ['dashboard:update'])` — emitted by the Reporting Agent on run completion and by `connectorPollingService` on sync completion.

**Reusability:** Build the dashboard as a composition of widget components (`HealthBreakdownWidget`, `AnomaliesWidget`, `HighRiskClientsWidget`, `LatestReportWidget`, `SyncStatusWidget`). These same widgets can be used on a future full-tier Synthetos dashboard — they read whatever intelligence data is available.

#### 8.2.2 Reports list — `ReportsListPage.tsx`

**Route:** `/reports`

**Data source:** `GET /api/reports` — paginated list from `reportService.listReports(orgId, { limit, offset })`

**UI:**
- Table with ColHeader sort/filter (follows `SystemSkillsPage` pattern)
- Columns: Title, Date, Type (badge), Status (delivered/failed), Actions (view)
- Filter on Type (portfolio_health, anomaly_alert)
- Sort on Date (default: newest first)
- Click row → navigates to report detail

**Route (API):** Add to `server/routes/reports.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/reports` | `authenticate` | Paginated report list for current org |
| GET | `/api/reports/:id` | `authenticate` | Single report with full data |
| GET | `/api/reports/latest` | `authenticate` | Most recent report |

#### 8.2.3 Report detail — `ReportDetailPage.tsx`

**Route:** `/reports/:id`

**Data source:** `GET /api/reports/:id` — full report including `html_content` and `report_data`

**UI:**
- Render `html_content` in a styled container (same HTML as the email, but wrapped in the app's layout)
- "Download PDF" button (greyed out with "Coming soon" tooltip for v1)
- "Resend email" button → calls `POST /api/reports/:id/resend`
- Per-client expandable sections with metric details

### 8.3 Integrations page filtering

The Integrations page (`IntegrationsAndCredentialsPage.tsx`) currently shows all available connector types. For ClientPulse orgs, filter to show only the connectors required by the active template.

**Implementation:** The `connector_configs` for the org already know which connector type is active. The sidebar config from Module A hides the full integrations page and replaces it with a narrowed version. Alternatively, add a `?connectorTypes=ghl` query parameter to the integrations API and have the sidebar config pass it.

Simpler approach: In the Integrations page component, if the user is on a module that specifies `requiredConnectorType` in the template's operational defaults, show only that connector. The template's `operationalDefaults.requiredConnectorType` field already exists in the schema.

### 8.4 Verification

- [ ] ClientPulse org lands on `/dashboard` after login — shows health breakdown, anomalies, high-risk clients
- [ ] Dashboard widgets populate with real data from canonical accounts
- [ ] Sync progress bar shows real-time progress during initial sync
- [ ] Reports list page shows delivered reports with sort/filter
- [ ] Report detail page renders the same HTML as the email
- [ ] Full-access org does NOT see the ClientPulse dashboard as their default landing (they see the existing dashboard)
- [ ] Integrations page shows only GHL connector for ClientPulse orgs
- [ ] ColHeader pattern implemented correctly on Reports list (sort, filter, clear all)
- [ ] `npm run lint` + `npm run typecheck` + `npm run build` pass

---

## 9. Module D — Self-serve onboarding flow

**Depends on:** Module A (template provisioning), Module C (OAuth + sync), Module B (first-run trigger), Module G (subscription assignment)
**Depended on by:** nothing (this is the front door)

### 9.1 Overview

The consumer-grade front door. Seven steps from landing page to first report (maps to brief Section 3):

1. Landing page → "Start free trial"
2. Signup (email/password or Google SSO)
3. Connect Go High Level (OAuth)
4. Location enumeration (select sub-accounts)
5. First data pull (async background with progress UI)
6. First report triggered (immediate)
7. Dashboard with first report

### 9.2 Signup flow

#### New routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/signup` | public | Create user + org + subscription |
| POST | `/api/auth/signup/google` | public | Google SSO signup |

**Signup handler logic:**

```typescript
async function signup(email: string, password: string): Promise<{ token: string; user: User }> {
  // 1. Create user row
  const user = await userService.create({ email, password });

  // 2. Create organisation row
  const org = await organisationService.create({
    name: `${email.split('@')[0]}'s Agency`,
    ownerId: user.id,
  });

  // 3. Assign Starter subscription (trialing)
  const starterSub = await subscriptionService.getBySlug('starter');
  await subscriptionService.assignSubscription(org.id, {
    subscriptionId: starterSub.id,
    billingCycle: 'monthly',
    status: 'trialing',
    trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    isComped: false,
  });

  // 4. Provision the Reporting Agent via template
  await systemTemplateService.loadToOrg('ghl-agency-intelligence', org.id, {});

  // 5. Generate JWT
  const token = generateToken(user, org);
  return { token, user };
}
```

**During soft-launch:** System admin can also create orgs and comp them via the Module G admin UI (§4.4). The self-serve signup is the scalable path but not the only path.

### 9.3 Onboarding wizard

**New page:** `OnboardingWizardPage.tsx` at `/onboarding`

A multi-step wizard shown after signup. The wizard tracks progress via a `wizard_step` field on the org or a separate `onboarding_state` in localStorage.

#### Step 1: Connect Go High Level

Single-screen with one button: "Connect Go High Level"

**On click:**
1. Redirect to GHL's OAuth consent screen:
   ```
   https://marketplace.gohighlevel.com/oauth/chooselocation
     ?response_type=code
     &client_id=${GHL_APP_CLIENT_ID}
     &redirect_uri=${GHL_APP_REDIRECT_URI}
     &scope=locations.readonly contacts.readonly opportunities.readonly conversations.readonly conversations/message.readonly payments/orders.readonly businesses.readonly
     &state=ghl:${orgId}
   ```
2. User approves → GHL redirects to `/oauth/callback?code=...&state=ghl:${orgId}`
3. The OAuth callback handler:
   - Parses `state` to determine connector type (`ghl`) and org context
   - Exchanges code for tokens via GHL's token endpoint
   - Stores tokens in `integration_connections` via `integrationConnectionService`
   - Creates a `connector_configs` row with `connectorType: 'ghl'`, `syncPhase: 'backfill'`
   - Redirects to `/onboarding?step=locations`

#### Step 2: Location enumeration

**After OAuth redirect, auto-fetch locations:**

1. Call `ghlAdapter.ingestion.listAccounts(connection, { companyId })` — returns all GHL locations
2. Display: "We found N sub-accounts. Which ones should ClientPulse monitor?"
3. Default: all selected with a "Select all" checkbox
4. On confirm:
   - Create `subaccounts` row per selected location (maps GHL location → Synthetos subaccount)
   - Create `canonical_accounts` row per selected location
   - Trigger initial sync via `connectorPollingService.syncConnector(connectorConfigId)`
   - Redirect to `/onboarding?step=syncing`

**API:**

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/onboarding/locations` | `authenticate` | List discovered GHL locations |
| POST | `/api/onboarding/locations/confirm` | `authenticate` | Confirm selected locations, create subaccounts, trigger sync |

#### Step 3: Sync progress

**While sync is running:**

Display a progress UI: "Syncing N clients… X done, Y to go" with a per-client status list.

**Data source:** Poll `GET /api/onboarding/sync-status` or use WebSocket.

```typescript
interface SyncStatus {
  phase: 'syncing' | 'complete' | 'error';
  totalAccounts: number;
  syncedAccounts: number;
  accounts: Array<{
    accountId: string;
    displayName: string;
    status: 'pending' | 'syncing' | 'complete' | 'error';
    error?: string;
  }>;
}
```

**When all accounts are synced:** auto-advance to "Generating first report..." message, then redirect to `/dashboard` when the first Reporting Agent run completes. The first-run trigger from §6.8 handles this.

### 9.4 Post-onboarding landing

After the first report is generated, redirect to `/dashboard`. The Dashboard (§8.2.1) shows the portfolio overview. The first email report is also in the user's inbox.

From this point, the weekly schedule takes over. The user manages their account via the ClientPulse sidebar: Dashboard, Inbox, Companies, Reports, Integrations, Team, Manage Org.

### 9.5 Onboarding service

**New file:** `server/services/onboardingService.ts`

```typescript
async function discoverLocations(orgId: string): Promise<GhlLocation[]>
  // Finds the org's GHL connection, calls listAccounts

async function confirmLocations(orgId: string, locationIds: string[]): Promise<void>
  // Creates subaccounts + canonical_accounts, triggers sync

async function getSyncStatus(orgId: string): Promise<SyncStatus>
  // Aggregates sync progress across all connector configs for the org
```

**Route file:** `server/routes/onboarding.ts`

### 9.6 Verification

- [ ] Full signup flow: email/password → org created → Starter subscription assigned → Reporting Agent provisioned
- [ ] OAuth redirect to GHL → approval → callback → tokens stored
- [ ] Location enumeration shows real GHL sub-accounts
- [ ] Selecting locations creates subaccounts + canonical accounts
- [ ] Sync progress UI shows real-time progress
- [ ] First report triggers automatically when sync completes
- [ ] Redirect to Dashboard after first report is generated
- [ ] Under-10-minute target met for a 20-client agency
- [ ] `npm run lint` + `npm run typecheck` + `npm run build` pass

---

## 10. Module G (Stripe) — Stripe integration (post soft-launch)

**Depends on:** Module G partial (§4), live customers
**Deferred until:** After soft-launch with comped design-partner orgs

This section is intentionally brief — Stripe integration is not on the critical path for soft launch. System admin can comp orgs directly via the admin UI.

### 10.1 Scope

- Create Stripe products and prices **manually in Stripe Dashboard**, then link to `subscriptions` rows by populating `stripe_product_id`, `stripe_price_id_monthly`, `stripe_price_id_yearly`
- Stripe webhooks (`invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`) update `org_subscriptions.status` and `current_period_end`
- `org_subscriptions.status` transitions drive module activation/deactivation → allowlist → scheduling behaviour
- Billing portal link via Stripe Customer Portal
- Trial-to-paid conversion flow via Stripe Checkout

### 10.2 Implementation notes

- **Webhook handler:** `server/routes/webhooks/stripeWebhook.ts` — mount before body parsing (raw body for signature verification)
- **Stripe SDK:** Use `stripe` npm package (already in `package.json`)
- **Customer creation:** On first payment, create Stripe Customer linked to org via `organisations.stripe_customer_id` (new column)
- **Checkout session:** `POST /api/billing/checkout` → creates Stripe Checkout Session → redirects to Stripe → success redirects to `/dashboard`
- **Portal session:** `POST /api/billing/portal` → creates Stripe Customer Portal Session → redirects to Stripe

### 10.3 Verification

- [ ] Stripe Checkout creates subscription → `org_subscriptions` status = `active`
- [ ] Failed payment → `org_subscriptions` status = `past_due` → allowlist still active (grace period)
- [ ] Subscription cancellation → `org_subscriptions` status = `cancelled` → allowlist contracts
- [ ] Billing portal accessible from Manage Org page

---

## 11. Migration inventory

All new tables and schema changes required by this spec, in dependency order. Next available migration number: **0104**.

| Migration | Tables / Changes | Module | Depends on |
|-----------|-----------------|--------|------------|
| 0104 | `modules` table + seed (`client_pulse`, `full_access`). `ALTER TYPE agent_run_result_status ADD VALUE 'skipped_module_disabled'`. Template slug uniqueness constraint. Duplicate template cleanup. | A | — |
| 0105 | `subscriptions` table + `org_subscriptions` table + seed (starter, growth, scale, full_access_internal) | G | 0104 (references modules) |
| 0106 | `reports` table | B | — |

**No schema changes needed for:** Module C (uses existing tables), Module F (uses reports table from 0106), Module E (reads from existing tables + reports), Module D (writes to existing tables via services).

**Stripe integration (deferred):** `ALTER TABLE organisations ADD COLUMN stripe_customer_id TEXT` — when Stripe is wired.

**Total new tables:** 3 (`modules`, `subscriptions`, `org_subscriptions`, `reports` — technically 4 counting `org_subscriptions` separately from `subscriptions`).

---

## 12. Build phases & dependency graph

### Phase diagram

```
Phase 1 (foundation)        Phase 2 (data + intelligence)      Phase 3 (surfaces)          Phase 4 (front door)
┌──────────────────┐       ┌────────────────────────┐         ┌──────────────────────┐    ┌──────────────────┐
│  Module A        │       │  Module C              │         │  Module E            │    │  Module D        │
│  (modules +      │──────▶│  (GHL connector        │────────▶│  (Dashboard +        │───▶│  (onboarding)    │
│   allowlist)     │       │   completion)           │         │   Reports + sidebar) │    │                  │
├──────────────────┤       ├────────────────────────┤         ├──────────────────────┤    └──────────────────┘
│  Module G admin  │       │  Module B              │         │  Module F            │
│  (subscriptions  │──────▶│  (agent wiring +       │────────▶│  (HTML email)        │
│   + admin UI)    │       │   intelligence)         │         │                      │
└──────────────────┘       └────────────────────────┘         └──────────────────────┘

                                                                                          Phase 5 (deferred)
                                                                                          ┌──────────────────┐
                                                                                          │  Module G Stripe │
                                                                                          └──────────────────┘
```

### Phase 1 — Foundation (Module A + Module G admin)

**Parallelisable:** Yes — A and G can be developed in parallel since A stubs the allowlist resolver until G's tables exist.

| Work item | Module | Effort estimate |
|-----------|--------|----------------|
| `modules` table + Drizzle schema + seed | A | 0.5 day |
| `moduleService.ts` — allowlist resolver + CRUD | A | 1 day |
| Enforcement at 4 points (scheduling, execution, UI, write-to-activate) | A | 1.5 days |
| `SystemModulesPage.tsx` — admin UI | A | 1 day |
| Sidebar config integration in `Layout.tsx` | A | 1 day |
| Seed-script hygiene + duplicate template cleanup | A | 0.5 day |
| `subscriptions` + `org_subscriptions` tables + Drizzle schemas + seed | G | 0.5 day |
| `subscriptionService.ts` — CRUD + assignment + delta preview | G | 1.5 days |
| `SystemSubscriptionsPage.tsx` — catalogue editor + per-org management | G | 2 days |
| Wire allowlist resolver to real subscription data | A+G | 0.5 day |

**Total Phase 1: ~10 days (can compress to ~7 with parallelism)**

### Phase 2 — Data + Intelligence (Module C + Module B)

**Parallelisable:** Partially — C and B have sequential dependency (B needs C's data), but parts of B (template fix, report table, report service) can start in parallel.

| Work item | Module | Effort estimate |
|-----------|--------|----------------|
| Agency-token-vs-location-token verification (Phase 0 gate) | C | 1 day |
| `getLocationToken` helper (build regardless) | C | 0.5 day |
| Route path alignment (`/oauth/callback`, `/webhooks/ingest`) | C | 0.5 day |
| INSTALL/UNINSTALL/LocationCreate webhook handlers | C | 1 day |
| Sync-phase state machine (backfill → transition → live) | C | 1 day |
| Environment variable wiring | C | 0.5 day |
| GHL template seed fix (duplicate cleanup, upsert semantics) | B | 0.5 day |
| `loadToOrg()` fix for org-scoped agent provisioning | B | 1 day |
| `reports` table + `reportService.ts` | B | 1 day |
| Verify intelligence executor against real canonical data | B | 2 days |
| Portfolio report generation in `generate_portfolio_report` handler | B | 1.5 days |
| First-run trigger wiring | B | 0.5 day |

**Total Phase 2: ~11 days (can compress to ~8 with some parallelism)**

### Phase 3 — Customer Surfaces (Module E + Module F)

**Parallelisable:** Yes — E and F are independent of each other.

| Work item | Module | Effort estimate |
|-----------|--------|----------------|
| `renderPortfolioReportHtml` template function | F | 1.5 days |
| Chart rendering (quickchart.io integration) | F | 0.5 day |
| Email delivery wiring via `send_email` | F | 0.5 day |
| `dashboardService.ts` + `/api/dashboard` route | E | 1 day |
| `ClientPulseDashboardPage.tsx` — widget-based layout | E | 2 days |
| `ReportsListPage.tsx` — ColHeader table + API | E | 1 day |
| `ReportDetailPage.tsx` — HTML viewer | E | 0.5 day |
| Report routes (`/api/reports`, `/api/reports/:id`) | E | 0.5 day |
| Integrations page filtering for ClientPulse orgs | E | 0.5 day |

**Total Phase 3: ~8 days (can compress to ~5 with parallelism)**

### Phase 4 — Front Door (Module D)

| Work item | Module | Effort estimate |
|-----------|--------|----------------|
| Signup API (`/api/auth/signup`) + org/subscription provisioning | D | 1 day |
| `OnboardingWizardPage.tsx` — GHL OAuth step | D | 1 day |
| Location enumeration UI + confirmation | D | 1 day |
| Sync progress UI with WebSocket updates | D | 1 day |
| `onboardingService.ts` — discovery + confirmation + sync status | D | 1 day |
| End-to-end flow testing | D | 1 day |

**Total Phase 4: ~6 days**

### Phase 5 — Stripe (deferred)

| Work item | Module | Effort estimate |
|-----------|--------|----------------|
| Stripe webhook handler | G | 1 day |
| Checkout session creation | G | 1 day |
| Customer portal integration | G | 0.5 day |
| Trial-to-paid conversion flow | G | 1 day |

**Total Phase 5: ~3.5 days**

### Grand total

| Phase | Effort | Compressed (with parallelism) |
|-------|--------|-------------------------------|
| Phase 1 | ~10 days | ~7 days |
| Phase 2 | ~11 days | ~8 days |
| Phase 3 | ~8 days | ~5 days |
| Phase 4 | ~6 days | ~6 days |
| **Soft launch total** | **~35 days** | **~26 days** |
| Phase 5 (Stripe) | ~3.5 days | ~3.5 days |

**Soft launch can begin at Phase 3** with comped subscriptions (system admin assigns via Module G admin UI). Stripe-gated public launch follows in Phase 5.

---

## 13. Verification plan

### Pre-implementation gates

These must be resolved before implementation begins:

1. **Agency-token-vs-location-token** — Install on a test GHL agency and verify all fetch methods work with the agency token. This is the single biggest unverified GHL-side risk. Block on this before Phase 2.
2. **GHL app registration** — Complete the app registration per `docs/create-ghl-app.md`. Need Client ID, Client Secret, and Webhook Secret in environment variables.
3. **Lock initial pricing** — Starter/Growth/Scale monthly dollar amounts for Module G seed data.

### Per-module verification (condensed)

| Module | Key verification | Method |
|--------|-----------------|--------|
| A | Allowlist enforcement at all 4 points | Manual test: schedule/execute/UI-list/write-to-activate a disallowed agent |
| A | Sidebar narrowing | Visual: ClientPulse org sees 7 nav items, full-access org sees all |
| G | Subscription assignment + allowlist integration | Manual: assign ClientPulse sub → verify agent allowlist, switch to Full Access → verify all agents |
| C | Data flows from GHL to canonical tables | End-to-end: connect real GHL → sync → verify canonical_accounts + entities populated |
| B | Reporting Agent produces portfolio report | Run agent → verify reports table row with valid report_data |
| F | HTML email renders correctly | Send to Gmail/Outlook/Apple Mail test accounts |
| E | Dashboard populates with real data | Visual after sync + report generation |
| D | Full signup → first report in <10 min | Timed end-to-end with a 20-client agency |

### Automated checks (run after every non-trivial change)

Per CLAUDE.md verification commands:

- `npm run lint` — any code change
- `npm run typecheck` — any TypeScript change
- `npm test` — logic changes in `server/`
- `npm run db:generate` — schema changes (verify migration file)
- `npm run build` — client changes

### Static gate additions

Consider adding these project-specific verify scripts:

- `verify-module-allowlist-wired.sh` — ensure all 4 enforcement points call `moduleService.isAgentAllowedForOrg`
- `verify-reports-org-scoped.sh` — ensure report queries filter by `organisationId`

---

## 14. Open items & pre-implementation gates

### Must resolve before implementation

| # | Item | Owner | Blocking |
|---|------|-------|----------|
| 1 | Agency-token-vs-location-token verification | Dev (Phase 0 gate) | Phase 2 |
| 2 | GHL app registration (Client ID, Secret, Webhook Secret) | Product | Phase 2 |
| 3 | Lock Starter/Growth/Scale pricing (monthly cents) | Product | Module G seed |
| 4 | Confirm email provider is configured and working | Dev | Module F |
| 5 | Domain setup for `app.synthetos.ai` | Infra | Module C (OAuth redirect), Module D |

### Design decisions deferred to implementation

| # | Item | Default if not decided |
|---|------|----------------------|
| 1 | Chart rendering: `quickchart.io` vs `chartjs-node-canvas` | Start with `quickchart.io` |
| 2 | Template authoring: YAML in repo vs DB-only | DB-only via admin UI; YAML import as optional enhancement |
| 3 | Soft-launch audience: invite-only vs public | Invite-only (matches private-app 5-agency cap) |
| 4 | Dashboard landing route for non-ClientPulse orgs | Keep existing dashboard; `/dashboard` only for ClientPulse module orgs |

### Risks

| Risk | Mitigation |
|------|-----------|
| Agency token doesn't work for location-scoped endpoints | `getLocationToken` fallback (§5.2.1) — build early |
| GHL API rate limits during large backfills | Existing rate limiter in `ghlAdapter.ts`; add per-org concurrency cap (`organisations.ghl_concurrency_cap` — migration 0087 already exists) |
| First sync takes >10 min for 100+ client agencies | Acceptable per brief — UI must show progress, never appear stuck. Acceptance target is for 20–50 client agencies. |
| Email deliverability issues | Use existing `send_email` infrastructure; monitor bounce rates. Dedicated sending domain (SPF/DKIM) for `synthetos.ai` |
| Duplicate template rows in seed | Fixed in migration 0104 cleanup + upsert semantics (§3.6, §6.3) |
