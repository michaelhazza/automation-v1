# ClientPulse for GHL Agencies — Development Brief

**Status:** High-level brief only. **Not a detailed development specification.** A full dev spec will be written later, once the in-flight upstream code improvements on other branches have landed. At that point this brief becomes the input to the spec, not a substitute for it. Do not treat anything here as implementation-ready — treat it as directional framing for the spec writer.
**Goal:** Soft launch ClientPulse as a Synthetos product tier targeted at Go High Level agencies — positioned as "the missing agency dashboard GHL forgot to build."

---

## Contents

1. Strategic framing
2. Guiding architectural principle — templates are the abstraction
3. Module breakdown
   - Module A — Config Template System & Module Lifecycle
   - Module B — ClientPulse (1-agent Reporting Agent, org-scoped)
   - Module C — GHL Data Connector
   - Module D — Self-Serve Onboarding
   - Module E — Template-Driven UI Narrowing + Dashboard & Reports
   - Module F — HTML Email Report Delivery
   - Module G — Billing & Metering
4. What we are leveraging — already built
5. Explicitly out of scope for soft launch
6. Open questions to resolve before writing the full spec
7. Suggested build order
8. Success criteria for soft launch

---

## 1. Strategic framing

- **ClientPulse is a product tier / module of Synthetos**, not a separate application, separate codebase, or hardcoded feature.
- **"GHL Agency" is one configuration template** among many future templates (Real Estate Investor, SaaS Founder, Content Publisher, E-commerce, etc.). **Nothing GHL-specific — or ClientPulse-specific — lives in core code.** It all lives in the template plus pluggable connectors.
- Synthetos is the parent brand. ClientPulse is marketed as "ClientPulse by Synthetos" at `synthetos.ai/clientpulse`.
- Soft-launch target: GHL agencies managing 10–100 sub-accounts. Pricing ~$99–$499/mo tiered by sub-account count.
- ClientPulse is a direct on-ramp to the long-term GHL Automation OS play — every ClientPulse customer is a pre-warmed Synthetos customer who later upgrades to the full action-taking tier.

---

## 2. Guiding architectural principle — templates are the abstraction

**The Configuration Template system already exists** — this brief extends it, it does not introduce it. The abstraction is `system_hierarchy_templates` + `system_hierarchy_template_slots`, managed by `systemTemplateService`, surfaced at `/system/config-templates`. "GHL Agency Intelligence" is already seeded (migration 0068). The job of Module A is to **complete** this system, not build it from scratch.

A Config Template declares, in one place:

- Which **system agents** are linked into the org (via slots — selective, not all of them)
- Which **skills** are enabled on each slot
- Default **operational defaults** (health score weights, anomaly thresholds, scan frequencies)
- Default **memory seeds** injected into org memory on load
- Required **data source connectors** (e.g. `'ghl'`)
- Required **operator inputs** (OAuth credentials, alert email, etc.)
- **Sidebar shape** — which nav items the end user sees (new, added by Module E)
- **Billing tier** the template is associated with (new, added by Module G)

**Every go-to-market flavour is a config template row, not a code change.** GHL Agency Intelligence is the first. Real Estate Investor, SaaS Founder, Content Publisher, and E-commerce are all future rows in the same table with different slots, different operational defaults, different sidebars, and different connector requirements. Nothing GHL-specific — or ClientPulse-specific — lives in core code.

**Crucial constraint Module A still needs to enforce:** today, every org can see every system agent regardless of subscription state. The fix is a **module-driven allowlist** — a new `modules` table declaring which agents are entitled to run under each module, a new `subscriptions` concept tying orgs to modules, and enforcement at four points (scheduling, execution, UI, write-to-activate). See Module A for the full design. Without this, the upgrade / downgrade path silently ships a bug.

---

## 3. Module breakdown

Each module is a unit of functionality a template can opt into. MVP ships these seven:

### Module A — Config Template System & Module Lifecycle *(extends existing, build first)*

**Status: ~50% already built.** The Config Template system already exists as `system_hierarchy_templates` + `system_hierarchy_template_slots`, with `systemTemplateService` (684 lines) providing `loadToOrg()` provisioning. Management page lives at `/system/config-templates` (`SystemCompanyTemplatesPage`). One template seeded: "GHL Agency Intelligence" (migration 0068). See `tasks/ghl-agency-development-brief.md` Phase 4 for current build status and `tasks/build-config-template-feature.md` for the management-page task.

**Terminology note:** throughout this brief "config template" means `system_hierarchy_templates`. Do not confuse with "team templates" (`hierarchy_templates`, admin-level agent hierarchies) or the deprecated `agent_templates`.

**What's already in place and reusable:**

- Template data model with operational defaults (JSONB), memory seeds (JSONB), required operator inputs (JSONB), slot definitions
- `systemTemplateService.loadToOrg(templateId, orgId, inputs)` — provisions agents, `orgAgentConfigs`, memory seeds
- List / preview / update / delete API endpoints
- Per-slot skill enablement map and execution-scope field (org / subaccount)

**Separation of concerns — templates are not modules:**

This brief treats **templates** and **modules** as two different concepts with separate lifecycles:

| Concept | Purpose | Lifecycle | Owns |
|---|---|---|---|
| **Config Template** (`system_hierarchy_templates`) | Provisioning blueprint — what gets **created** when an org is first set up | Applied once (or on upgrade to add new things) | Slots (agents to provision), operational defaults, memory seeds, required operator inputs, required connector type |
| **Module** (new `modules` table) | Runtime entitlement — what agents are **allowed to run** at any given moment | Toggled on/off continuously based on subscription state | Display name (admin-editable), description, allowed agent slugs (or wildcard), sidebar config |

A template is applied by `loadToOrg()` and creates rows. A module sits behind the scheduler and says yes/no on every tick. Conflating them means you can't express "Full Access — unlock every agent" without polluting the template slot list.

**What still needs to be built or fixed inside Module A:**

1. **Seed-script hygiene** — the UI currently shows **two** "GHL Agency Intelligence" rows (one with 1 agent, one with 0). Check the master seed script (and any other seed scripts that may be independently seeding templates — the GHL template may not be in the master seed at all) and ensure proper upsert semantics keyed on a stable manifest hash or slug, so repeated runs don't create duplicates. Clean up the existing duplicate row before soft-launch testing.

2. **Introduce the `modules` table** — a new first-class concept, system-admin managed:

   ```
   modules
     id                    uuid
     slug                  text unique        -- stable machine key, e.g. 'client_pulse', 'full_access'
     display_name          text               -- editable from system-admin UI, applies system-wide
     description           text
     allowed_agent_slugs   jsonb              -- array of agent slugs, OR null if allow_all_agents
     allow_all_agents      boolean            -- wildcard flag; when true, allowed_agent_slugs is ignored
     sidebar_config        jsonb              -- array of nav items the end user sees; unioned with other active modules
     created_at / updated_at
   ```

   **Seed two modules at launch:**

   | Slug | Default display name | Allowed agents | Sidebar |
   |---|---|---|---|
   | `client_pulse` | "ClientPulse" | `['reporting_agent']` | Dashboard → Inbox → Companies → Reports → Integrations → Team → Manage Org |
   | `full_access` | "Full Access" | `allow_all_agents: true` | Full operator sidebar (current behaviour) |

   Both display names are editable by system admin through a new UI (see point 4 below). The slug is the stable machine key and never changes.

3. **Allowlist-based enforcement — not provenance-based.** The rule is: **an agent can only run if its slug appears in the union of `allowed_agent_slugs` across the org's currently-active modules.** History does not matter. Where the agent came from does not matter. All that matters is whether the currently-active module set entitles the org to run it.

   Enforcement at **four** points:

   - **Scheduling:** `agentScheduleService.enqueue()` calls `isAgentAllowedForOrg(agent, orgId)` and skips disallowed agents.
   - **Execution:** on dequeue, re-check. Abort with `skipped_module_disabled` if the module set changed between enqueue and execute.
   - **Agent list / UI:** default list queries filter to allowed agents. Disallowed system-backed agents either disappear or render with a "Disabled by subscription" badge for system admins.
   - **Write paths that activate an agent:** any API that sets `heartbeatEnabled: true`, `scheduleEnabled: true`, or re-enables a disabled agent calls the same allowlist check and rejects if not allowed. **This is the system-admin protection.** Even a system admin using `X-Organisation-Id` to scope into an org cannot activate an agent that isn't in that org's module allowlist — they have to change the org's subscription to include a module that includes the agent. No `?override=true` escape hatch in v1. (If emergency debugging becomes necessary later, it can be added as a logged, audit-event-writing override.)

   **Resolver:**

   ```
   getAllowedAgentSlugs(orgId) -> Set<string>
     1. Read active modules for org from subscription state
     2. If any active module has allow_all_agents = true, return "all"
     3. Otherwise union their allowed_agent_slugs arrays and return the set
   ```

   **Agent-scope rules:**
   - **System-backed agents** (`systemAgentId` not null): subject to the allowlist
   - **Org-created agents** (`systemAgentId` is null): bypass the allowlist entirely — they're the org's own creations and are governed by the normal permission system. For the ClientPulse tier specifically, the agent creation UI is hidden anyway, so this edge case doesn't apply in practice.

   **No `source_template_id`, no `org_active_templates`, no provenance column on `agents`, no migration for existing agents.** An earlier version of this brief proposed provenance tracking; that was wrong. The allowlist is stateless with respect to history — it's a pure function of currently-active module state.

4. **System-admin UI for module management.** A new page (suggestion: under the existing system admin area, alongside `/system/config-templates`) that lets system admins:
   - List all modules with display name, slug, allowed-agent count, and "in use by N orgs"
   - Edit module display name (applies system-wide immediately — this is how non-engineers rename "ClientPulse" to something else in the future)
   - Edit module description
   - Edit the allowed_agent_slugs list (checkbox picker over system agents)
   - Toggle `allow_all_agents` (for Full Access)
   - Edit sidebar_config (simple ordered list of nav item slugs)
   - Prevent deletion if any subscription still references the module (soft-delete only when no references)

   The slug is **not** editable — only the display name. Changing the slug would break subscription references.

5. **Upgrade / downgrade behaviour.** When an org's active module set changes (driven by subscription changes), the allowlist resolver's next call returns a different set and the four enforcement points immediately reflect it. No migration, no provisioning, no destructive ops. Agents that move out of the allowlist go dormant (not deleted). Agents that move into the allowlist resume. Scheduled tasks whose agent is outside the allowlist stop firing but remain in the DB. Run history is preserved.

6. **Sidebar-in-module-config.** The `sidebar_config` field on each module drives what nav items the end user sees. When an org has multiple active modules, the union (ordered, deduped) wins. The existing org sidebar component is refactored once to read from this config instead of showing a static list. Future templates / modules declare their own sidebar — zero frontend changes.

**Without the allowlist enforcement, the upgrade / downgrade bug is guaranteed to ship.**

### Module B — ClientPulse *(the actual thing the customer pays for)*

**The agent shape is deliberately minimal: one agent, org-scoped, iterates over subaccounts in its own run loop.** No orchestrator, no BA agent, no sub-agent handoffs, no per-subaccount agent provisioning. This is simpler and cheaper than the 3-agent model in `tasks/ghl-agency-development-brief.md` (which should be updated to match) and matches the read-only positioning of ClientPulse v1.

A module that, when enabled, exposes:

- **The Reporting Agent — one row, org-scoped.** Provisioned by `loadToOrg()` as a single `agents` row with `isSystemManaged: true`, `executionScope: 'org'`. **No `subaccountAgents` links are created.** The other ~14 system agents remain defined in `systemAgents` but are never linked into the org via this template. At runtime, Module A's allowlist (driven by the `client_pulse` module's `allowed_agent_slugs: ['reporting_agent']`) is what actually entitles this agent to run — provisioning and entitlement are separate concerns.
- The Reporting Agent skill bundle already shipped in core: `compute_health_score`, `compute_churn_risk`, `detect_anomaly`, `generate_portfolio_report`, `trigger_account_intervention`, `query_subaccount_cohort`, `read_org_insights`, `write_org_insight`, etc.
- **Per-client iteration inside the agent run loop.** The agent lists the org's active GHL-linked subaccounts via `canonicalDataService`, iterates client-by-client, computes health score / churn risk / anomalies per client, emits per-client sections of the portfolio report. Single run, single scheduled task, single cost record. No handoff mechanism, no per-client sub-runs.
- **One org-level weekly scheduled task** (not per-subaccount) running on a heartbeat/cron. Scale with client count is linear inside the loop, not multiplicative across scheduled tasks.
- **Report viewer routes** and a dashboard page (see Module E).
- **HTML email delivery** (see Module F — PDF is deferred).

Important: the customer never sees the Reporting Agent as "an agent." They see **Reports** and **Alerts** and a **Dashboard**. The agent is invisible infrastructure. Module A's visibility gating + Module E's template-driven sidebar are what make that hiding clean rather than hacky.

**Upgrade path note:** when a customer later upgrades to the full Synthetos tier, their subscription activates the `full_access` module (which has `allow_all_agents: true`). If additional agents haven't yet been provisioned, `loadToOrg()` runs with the relevant template to create them. If they downgrade back to ClientPulse, the `full_access` module deactivates, the allowlist contracts to `['reporting_agent']`, and the extra agents immediately stop firing — not because anything was deleted, but because they're no longer entitled to run. The Reporting Agent continues running because `client_pulse` is still active. On re-upgrade, the extra agents resume without re-provisioning.

### Module C — GHL Data Connector *(new plugin)*

A first-class integration plugin, not a hardcoded special case.

- OAuth 2.0 **Agency App** registered with GHL (marketplace-approved later; private during beta)
- `/locations` enumeration → bulk subaccount provisioning
- Data source adapters for: contacts, opportunities, calendars, campaigns, forms, call tracking, reviews
- Rate-limit + backoff via existing `withBackoff`
- Pulled data stored as `agent_data_sources` rows at subaccount scope, using the existing cascade
- Refresh schedule (daily or just-before-report)

Architecturally, this is the **first data source plugin** — the same extensibility point that will later host Google Ads, GA4, Meta, HubSpot, Stripe. GHL is the first citizen, not a special case.

### Module D — Self-Serve Onboarding *(new product surface)*

The consumer-grade front door the platform currently lacks.

- Public signup (email + password or Google SSO)
- Stripe checkout with trial
- `createOrgFromTemplate('ghl-agency')` on signup
- "Connect Go High Level" OAuth step
- **Location enumeration screen**: "We found N sub-accounts. Select the ones you want ClientPulse to monitor."
- Auto-provision selected locations as subaccounts (reuses existing subaccount model)
- Auto-link Reporting Agent to each new subaccount via existing subaccount agent linking
- First-report preview using sample data while real data pulls in the background
- Post-signup dashboard landing

**Target: from landing page to first report in under 5 minutes.** That is the acceptance criterion.

### Module E — Template-Driven UI Narrowing + Dashboard & Reports *(extends existing UI)*

**Not a second frontend.** The existing admin UI stays. The ClientPulse end-user experience is the same app with a narrower sidebar driven by the active config template, plus 2–3 new pages. Power users (system_admin, org_admin) continue to see the full admin UI; ClientPulse users land on a restricted view.

**How the sidebar narrowing works:** the config template's operational defaults carry a `sidebar` array declaring which nav items are visible for that template. The existing org sidebar reads from this config instead of showing a static list. A future Real Estate Investor template defines its own sidebar — zero frontend changes.

**Final sidebar decisions for the GHL Agency Intelligence template** (compared to the current org-admin sidebar: Inbox, Companies, Agents, Workflows, Skills, Integrations, Team, Health, Manage Org):

| Current item | ClientPulse decision |
|---|---|
| Inbox | **Keep as "Inbox"** — no rename |
| Companies | **Keep as "Companies"** — no rename |
| Agents | **Hide** — end user doesn't configure agents |
| Workflows | **Hide** — operator concept |
| Skills | **Hide** — operator concept |
| Integrations | **Keep, narrow** to the template's `requiredConnectorType` (GHL only for this template) |
| Team | **Keep** — agency staff invitations |
| Health | **Hide** — internal platform health audit, not client health |
| Manage Org | **Keep** — billing, settings, subscription |

**New items to add to the sidebar** (and to the app, as new pages):

- **Dashboard** *(new top-level item — first thing users see)* — portfolio-level overview: total clients, red/yellow/green breakdown, anomalies this week, churn-risk flags, latest report preview. **Build it reusably.** The same dashboard component must also work as the org-level dashboard for a future full-tier Synthetos account, so it should be driven by whichever intelligence data is available (health scores, anomalies, recent runs, alerts) rather than being GHL-specific. Data-driven widgets, not hardcoded sections.
- **Reports** *(new top-level item)* — list of delivered weekly portfolio reports with filter/search and drill-down to per-client breakdowns. Exists at org level (reports cover the full portfolio), not per-client. Also useful for fully-fledged accounts — same component, different data source depth.

**Final ClientPulse sidebar shape:** Dashboard → Inbox → Companies → Reports → Integrations → Team → Manage Org. Seven items. Zero operator concepts.

**Build work in this module:**
- Make the org sidebar config-driven (reads `sidebar` array from active template)
- Build `DashboardPage` as a reusable component that works at ClientPulse tier and future full-tier
- Build `ReportsListPage` + `ReportDetailPage`
- Narrow the Integrations page to filter by template-allowed connectors
- Public marketing / signup pages at `synthetos.ai/clientpulse` (separate surface, not part of the authenticated app)

### Module F — HTML Email Report Delivery *(new capability)*

**No PDF, no headless browser for v1.** The codebase uses Playwright (not Puppeteer — an earlier version of this brief was wrong), and running Playwright/Chromium on Replit is genuinely painful: large binaries, nix package friction, memory pressure, unreliable cold starts. PDF rendering is not worth that cost when HTML email is both simpler and what customers actually prefer.

- Rich HTML email rendered from the Reporting Agent's structured output (per-client sections, health scores, anomalies, narrative)
- Inline charts rendered server-side via a lightweight library (e.g. `chart.js-node-canvas`) or a hosted image service (e.g. `quickchart.io`) — no browser needed
- Delivery via the existing `send_email` skill
- Same HTML also rendered in-app on the new Reports page (Module E) — single template, two surfaces
- Synthetos-branded for MVP; white-label is a later module
- **PDF deferred to v1.1 via `@react-pdf/renderer`** (pure-JS, no browser dependency, runs fine on Replit) — only build if customers actually ask for it

### Module G — Subscriptions, Billing & System Admin UI *(new subsystem)*

**What this module covers:** the subscription data model, the system-admin UI for creating/editing subscriptions and assigning them to orgs, and the Stripe integration for self-serve customers. These are designed together because the admin UI is the shortest path to letting us actually toggle ClientPulse ↔ Full Access on test orgs during development, before Stripe is wired up at all.

#### Subscriptions data model

A new `subscriptions` table, system-admin authored, referenced by orgs:

```
subscriptions
  id                        uuid
  slug                      text unique       -- 'starter', 'growth', 'scale', 'full_access_trial', etc.
  display_name              text              -- "Starter", "Growth", "Scale"
  description               text
  module_ids                jsonb             -- array of module ids (tickbox selection in UI)
  price_monthly_cents       integer           -- null if free / comped
  price_yearly_cents        integer           -- auto-calculated from monthly with default 20% discount, editable
  yearly_discount_percent   integer           -- default 20, editable per subscription
  currency                  text              -- default 'USD'
  subaccount_limit          integer           -- null = unlimited
  trial_days                integer           -- default 14, 0 = no trial
  status                    text              -- 'active' | 'draft' | 'archived' (subscription template status)
  stripe_product_id         text              -- null during development, populated when Stripe is wired
  stripe_price_id_monthly   text
  stripe_price_id_yearly    text
  notes                     text              -- internal only
  created_at / updated_at / deleted_at

org_subscriptions
  id                        uuid
  org_id                    uuid fk
  subscription_id           uuid fk
  billing_cycle             text              -- 'monthly' | 'yearly' | 'comp'
  status                    text              -- 'trialing' | 'active' | 'past_due' | 'cancelled' | 'paused'
  trial_ends_at             timestamp
  current_period_start      timestamp
  current_period_end        timestamp
  stripe_subscription_id    text              -- null during development
  is_comped                 boolean           -- admin comped account, no Stripe
  notes                     text
  created_at / updated_at
```

The split is deliberate: **`subscriptions`** is the catalogue (definitions system admin edits), **`org_subscriptions`** is the assignment (which org is on which plan right now). An org has exactly one active `org_subscriptions` row at a time.

**Allowlist resolution:** when the scheduler / UI / write paths call `getAllowedAgentSlugs(orgId)`, the resolver:
1. Looks up the org's active `org_subscriptions` row
2. Follows it to the parent `subscriptions` row
3. Walks the referenced `module_ids`
4. Unions their `allowed_agent_slugs` (or short-circuits to "all" if any module has `allow_all_agents: true`)

Subscription state is the **source of truth** — `modules` are the vocabulary, `subscriptions` are the bundles, `org_subscriptions` is the assignment.

#### System-admin UI requirements

A new page (suggested location: `/system/subscriptions`) with two main views:

**1. Subscription catalogue editor.** Lists all `subscriptions` rows. Create / edit / archive. The edit form includes:

- **Display name** (text)
- **Slug** (text, lowercased, read-only after first save)
- **Description** (textarea — shown to customers on the pricing page)
- **Modules** — **tickbox list of all modules** from the `modules` table. One subscription can include one or more modules. For ClientPulse: tick `client_pulse`. For the top tier: tick `full_access`. Multi-select is supported for future bundles.
- **Per-month price** (integer cents, with a nicer dollar-input UI)
- **Per-year price** — two linked fields:
  - **Yearly discount percent** (integer, default **20**, editable)
  - **Per-year price** — auto-calculated as `monthly × 12 × (1 − discount/100)` when the monthly price or discount changes, but **also directly editable** so an admin can override the calculation. Changing the yearly price recalculates the implied discount for display. Changing the monthly price re-runs the default calculation unless the yearly price has been manually overridden (tracked via a `yearly_price_overridden` flag or by comparing to the derived value).
- **Currency** (dropdown, default USD)
- **Subaccount limit** (integer, blank = unlimited) — caps how many subaccounts this subscription allows
- **Trial days** (integer, default 14)
- **Status** (Draft / Active / Archived) — only Active subscriptions can be assigned to orgs via self-serve signup; Draft can still be assigned manually by system admin for testing
- **Internal notes** (textarea, never shown to customers)
- **Stripe linkage** (product id, monthly price id, yearly price id) — left empty during development, filled in when Stripe is wired

**2. Per-org subscription management.** On the existing org detail page (or a new `/system/orgs/:id/subscription` tab), a system admin can:

- See the org's current subscription (or "none")
- Change the subscription assignment — dropdown of Active + Draft subscriptions, with a confirmation dialog explaining which modules will activate and which will deactivate
- Set `is_comped: true` for free internal / design-partner orgs (no Stripe dependency)
- Override trial end date
- Override subaccount limit for this org specifically (overage negotiated)
- Pause / cancel / reactivate the subscription
- View the module allowlist delta preview: "This change adds the following agents to the allowlist: ... and removes the following: ..."
- Write an internal note attached to the change
- Every change is audit-logged to `audit_events`

**Why this UI is the short path to soft launch:** until Stripe is integrated, system admin can create design-partner orgs and assign them the ClientPulse or Full Access subscription directly from this UI. No payment required, no self-serve flow needed, no webhooks to debug. Soft launch begins the moment this admin UI works end-to-end with the allowlist enforcement — Stripe is a follow-up.

#### Seeded subscriptions at launch

Three rows seeded on first migration, matching the tier names already decided:

| Slug | Display name | Modules | Monthly | Yearly (20% off) | Subaccount cap | Notes |
|---|---|---|---|---|---|---|
| `starter` | Starter | `[client_pulse]` | TBD | TBD | 10 | Trial: 14 days |
| `growth` | Growth | `[client_pulse]` | TBD | TBD | 30 | — |
| `scale` | Scale | `[client_pulse]` | TBD | TBD | 100 | — |
| `full_access_internal` | Full Access (Internal) | `[full_access]` | null (comp) | null | unlimited | Draft status; for Synthetos internal + design-partner orgs |

Prices intentionally left TBD — lock before Stripe integration.

#### Stripe integration (later, not blocking soft launch)

- Stripe products and prices are created **manually in Stripe dashboard**, then linked to subscription rows by populating the `stripe_*` columns
- Stripe webhooks update `org_subscriptions.status` and `current_period_end`
- `org_subscriptions.status` transitions drive module activation / deactivation, which drives the allowlist, which drives scheduling behaviour
- Billing portal link via Stripe Customer Portal
- Trial-to-paid conversion flow via Stripe checkout

#### Optional future fourth tier

**Enterprise** (human-touch, custom SLAs, SSO, dedicated support) above Scale. Same subscription row shape, created on demand per-customer, `status: 'draft'` so it doesn't appear in self-serve pricing.

---

## 4. What we are leveraging — already built

These exist today and require zero or minimal new work:

**Config Template system (~50% complete):**
- `system_hierarchy_templates` + `system_hierarchy_template_slots` schema (migration 0068)
- `systemTemplateService.ts` (684 lines) — Paperclip import, `loadToOrg()` provisioning, template CRUD
- `hierarchyTemplateService.ts` (676 lines) — org-level template management
- `SystemCompanyTemplatesPage` at `/system/config-templates` — list/preview/unpublish/delete
- API: `GET/PATCH/DELETE /api/system/company-templates/:id`
- **Seeded template:** "GHL Agency Intelligence" (with duplicate — see Module A seed-script note)

**GHL Connector (~60% complete):**
- `server/adapters/ghlAdapter.ts` (342 lines) — OAuth, webhook verification, rate limiting, ingestion stubs
- `server/routes/webhooks/ghlWebhook.ts` — webhook endpoint with HMAC verification
- `server/db/schema/canonicalEntities.ts` (170 lines) + `canonicalAccounts.ts` (30 lines) — canonical data model
- `canonicalDataService.ts` (354 lines) — query layer used by intelligence skills
- `connectorConfigService.ts` (131 lines), `connectorPollingService.ts` (157 lines) — config + polling
- `integrationConnectionService.ts` (591 lines) — OAuth token lifecycle

**Org-level execution (~70% complete):**
- Migration 0043 — nullable subaccountId on agent_runs, execution_mode, result_status, config_snapshot
- `orgAgentConfigs` schema + service + routes
- `agentExecutionService` updated with execution mode routing, kill switch, config loading
- `agentScheduleService` updated with org-level job queues (`agent-org-scheduled-run`)
- Org-level review queue routes

**Intelligence skills (~40% complete):**
- Skill definitions: `compute_health_score`, `compute_churn_risk`, `detect_anomaly`, `generate_portfolio_report`, `trigger_account_intervention`, `query_subaccount_cohort`, `read_org_insights`, `write_org_insight`
- `intelligenceSkillExecutor.ts` (485 lines) — executor framework, skills registered in action registry
- Remaining: wire executors to real canonical data (~3–5 days per existing phase brief)

**Platform primitives (100% complete):**
- Three-tier org / subaccount data model — maps 1:1 onto agency / GHL-location
- `agent_data_sources` cascade with eager / lazy loading and budget enforcement
- Scheduled tasks + heartbeat via pg-boss (minute-precision offsets prevent thundering herd)
- HITL review gates (for future action-taking tier)
- RLS three-layer tenant isolation + scope assertions
- Run traces, cost breakers, budget reservations
- Memory blocks (per-agency preferences, voice, thresholds)
- `send_email`, `send_to_slack`, `transcribe_audio` skills

**This is why the brief feels small — most of the platform is already done.** The new work is: finishing the GHL ingestion pipeline, wiring intelligence executors to real data, adding Module A's lifecycle gating, building the template-driven sidebar, a handful of new pages, and billing. Not seven new modules from scratch.

**Cross-references:**
- `tasks/ghl-agency-development-brief.md` — authoritative phase-by-phase build plan with remaining-effort estimates
- `tasks/ghl-agency-feasibility-assessment.md` — feasibility context
- `tasks/ghl-agency-value-proposition.md` — positioning and value-prop thinking
- `tasks/build-config-template-feature.md` — management-page task spec (editing templates from the UI)

---

## 5. Explicitly out of scope for soft launch

Cut deliberately to keep scope tight:

- Google Ads / GA4 / Meta Ads connectors (v1.1 — reuse Module C's plugin shape)
- Non-GHL CRMs (HubSpot, Salesforce, etc.)
- Action-taking skills — ClientPulse v1 is read-only. No drafted emails, no campaign tweaks, no client replies.
- White-label / per-agency branding
- Team seats / multi-user orgs
- Custom report templates
- Client-facing portals (the agency's clients never log in)
- Mobile app
- Zapier / webhook outputs

---

## 6. Open questions to resolve before writing the full spec

**Resolved in this revision:**

- ~~Pricing tier naming~~ — **Starter / Growth / Scale** (optional Enterprise above). Generic, vertical-agnostic.
- ~~Agent list shape~~ — **1-agent model**: Reporting Agent only, org-scoped, iterates subaccounts in-loop. No orchestrator, no BA agent, no per-subaccount provisioning.
- ~~PDF rendering strategy~~ — **HTML email only for v1**. PDF deferred to v1.1 via `@react-pdf/renderer` if customers actually ask for it. No headless browser dependency.
- ~~How to hide operator UI from ClientPulse users~~ — **module-driven sidebar**. Each module declares its sidebar_config; active modules union their configs; existing UI reads the union. Zero if-statements.
- ~~Upgrade / downgrade agent lifecycle~~ — **allowlist-based enforcement**, not provenance-based. Modules declare `allowed_agent_slugs`; subscription state determines active modules; scheduler / execution / UI / write paths all check the union allowlist. Zero migration, zero provenance tracking, agents go dormant on downgrade and resume on re-upgrade. See Module A.
- ~~Templates vs modules distinction~~ — **templates provision, modules entitle.** Separate tables, separate lifecycles, cleanly decoupled.
- ~~Initial module set~~ — seed **`client_pulse`** and **`full_access`** modules with system-admin-editable display names.
- ~~System admin bypass~~ — no escape hatch in v1. System admins must change the org's subscription to change what's allowed. Future: optional audit-logged override if needed.
- ~~Org-created agents~~ — bypass the allowlist entirely (only system-backed agents are governed by modules).
- ~~Legacy orgs~~ — not a concern, product is still pre-launch; no legacy org migration needed.

**Still open:**

1. **Template config format** — operational_defaults JSONB (current) is fine for runtime, but should new templates be authored as YAML in repo (code-reviewed, diffable) and imported into the DB, or authored directly as DB records via an admin UI? Paperclip already supports the import path. Recommendation: YAML in repo for canonical templates; admin UI for ad-hoc edits.
2. **GHL Marketplace approval path** — does soft launch wait for marketplace approval, or launch with a private OAuth app and migrate design partners later?
3. **Minimum viable GHL data subset for a useful first report** — recommendation: contacts + opportunities + calendars + campaigns. Skip call tracking and reviews in v1.
4. **Soft-launch audience** — invite-only with ~10 design partners, or public self-serve from day one? Invite-only is lower risk and gives tighter feedback.
5. **Seed-script hygiene** — where does "GHL Agency Intelligence" get seeded, and is the master seed script the right home for it? Duplicate row in the current UI suggests repeat runs without upsert. Resolve before soft-launch testing.
6. **Lock initial pricing** — Starter / Growth / Scale monthly dollar amounts need to be decided before Module G's seeded subscriptions are finalised.

---

## 7. Suggested build order

1. **Module A** — new `modules` table + seed `client_pulse` and `full_access` modules + `getAllowedAgentSlugs(orgId)` resolver + enforcement at the four points (scheduling, execution, UI, write-to-activate) + sidebar-in-module-config refactor + seed-script hygiene for the GHL template. Everything downstream depends on this.
2. **Module G admin UI (partial)** — `subscriptions` + `org_subscriptions` tables + the system-admin subscription catalogue editor + per-org subscription assignment UI. **Stripe is NOT required at this stage** — admins can comp design-partner orgs directly. This is the shortest path to being able to toggle ClientPulse ↔ Full Access on test orgs end-to-end.
3. **Module C (GHL Connector)** — finish real data ingestion (`fetchContacts`, `fetchOpportunities`, `fetchConversations`, `fetchRevenue`) per `tasks/ghl-agency-development-brief.md` Phase 2. Parallelisable with A/G.
4. **Module B (ClientPulse wiring)** — wire intelligence executors to canonical data, finalise 1-agent template definition, cleanup duplicate seed row.
5. **Module F (HTML email delivery)** — standalone, parallelisable with B.
6. **Module E (Dashboard + Reports pages + module-driven sidebar)** — parallelisable with B/F once Module A's sidebar config shape lands.
7. **Module D (Self-serve onboarding)** — needs A + C + B + G.
8. **Module G Stripe integration** — wire Stripe products, prices, webhooks. Maps `org_subscriptions.status` to allowlist activation.
9. **Soft launch to ~10 design-partner GHL agencies** — can actually begin at step 5 or 6 with comped subscriptions, Stripe-gated public launch later.

---

## 8. Success criteria for soft launch

- 10 paying GHL agencies onboarded with real data
- End-to-end signup → first report in under 10 minutes (stretch target: 5)
- Weekly reports delivered reliably for 4 consecutive weeks
- At least one documented case study (quantified churn catch, retention win, or reporting-time saved)
- Zero data leakage between orgs (RLS + scope assertions hold)
- **Template system validated by adding a second template** (e.g. `generic-agency.yaml`) with zero changes to core code — this is the real architectural proof, not just that ClientPulse works
