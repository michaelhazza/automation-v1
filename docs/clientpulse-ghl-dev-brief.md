# ClientPulse for GHL Agencies — Development Brief

**Status:** High-level brief only. **Not a detailed development specification.** A full dev spec will be written later, once the in-flight upstream code improvements on other branches have landed. At that point this brief becomes the input to the spec, not a substitute for it. Do not treat anything here as implementation-ready — treat it as directional framing for the spec writer.
**Goal:** Soft launch ClientPulse as a Synthetos product tier targeted at Go High Level agencies — positioned as "the missing agency dashboard GHL forgot to build."

---

## Contents

1. Strategic framing
2. Guiding architectural principle — templates are the abstraction
3. User journey — landing page to first report
4. Module breakdown
   - Module A — Config Template System & Module Lifecycle
   - Module B — ClientPulse (1-agent Reporting Agent, org-scoped)
   - Module C — GHL Data Connector
   - Module D — Self-Serve Onboarding
   - Module E — Template-Driven UI Narrowing + Dashboard & Reports
   - Module F — HTML Email Report Delivery
   - Module G — Subscriptions, Billing & System Admin UI
5. What we are leveraging — already built
6. Explicitly out of scope for soft launch
7. Open questions to resolve before writing the full spec
8. Suggested build order
9. Success criteria for soft launch

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

## 3. User journey — landing page to first report

This is the north-star flow every module is in service of. It is also the concrete acceptance test for "is ClientPulse ready to ship." All architectural decisions in this brief exist to make this flow work end-to-end on a real design-partner agency with real GHL data.

### Step 1 — Landing page (0–30 sec)

Agency owner lands at `synthetos.ai/clientpulse`. Sees the pitch: *"Weekly client health reports and churn-risk alerts, powered by AI."* Clicks "Start free trial."

### Step 2 — Signup (30 sec – 1 min)

- Email + password, or Google SSO
- Create `user` row + `organisations` row
- Look up the Starter subscription in the `subscriptions` catalogue
- Create `org_subscriptions` row with `status: 'trialing'`, 14-day trial
- Call `systemTemplateService.loadToOrg('ghl-agency-intelligence', orgId, {})` — provisions the Reporting Agent row in `agents` for this org (`isSystemManaged: true`, `executionScope: 'org'`)
- The `client_pulse` module is now active on this org; its allowlist `['reporting_agent']` governs what runs (per Module A's allowlist enforcement)
- Redirect to the onboarding wizard

### Step 3 — Connect Go High Level (1–2 min)

Single-screen wizard: one button, "Connect Go High Level." On click:

- Redirect to GHL's OAuth consent screen with the scope list from Module C
- User approves → GHL redirects to `https://app.synthetos.ai/oauth/callback?code=...&state=ghl`
- Exchange the authorization code for an `access_token` + `refresh_token` + `companyId` via GHL's token endpoint
- Write credentials to `integration_connections` via the existing `integrationConnectionService` (591 lines, already built)

### Step 4 — Location enumeration (10–30 sec)

- Call `ghlAdapter.ingestion.listAccounts(connection, { companyId })` — already implemented at `server/adapters/ghlAdapter.ts:91`
- GHL returns every location (sub-account) under the agency via `GET /locations/search?companyId={id}&limit=100`
- Wizard shows: *"We found N sub-accounts. Which ones should ClientPulse monitor?"* with a "Select all" default
- On confirm, create a `subaccounts` row + a `canonical_accounts` row per selected location, all org-scoped (reuses the existing three-tier data model)

### Step 5 — First data pull (1–5 min, async background)

A `connectorPollingService` job fires per newly-created canonical account. For each sub-account, in order:

1. `fetchContacts` → `canonical_contacts`
2. `fetchOpportunities` → `canonical_opportunities`
3. `fetchConversations` → `canonical_conversations`
4. `fetchRevenue` → `canonical_revenue` (best-effort; swallows errors on plans without `/payments/orders`)
5. `computeMetrics` → metrics table

**Realistic timing:** on an agency with many clients and years of historical data, this is the slowest step in the whole flow — minutes, not seconds. The UI must show per-client progress ("Syncing 23 clients… 6 done, 17 to go") rather than appearing frozen. A background job with a polling dashboard is fine; a spinner is not.

### Step 6 — First report triggered (1–2 min)

Once the initial sync completes, **immediately fire one run of the Reporting Agent** — do not wait for the weekly schedule. Waiting would be a bad first impression for a paying customer who just onboarded. The agent:

1. Runs its planning prelude
2. Queries `canonicalDataService` for the org's active GHL-linked subaccounts
3. Iterates client-by-client in its execution loop (single run, not one run per client)
4. Per client, calls: `compute_health_score`, `detect_anomaly`, `compute_churn_risk`
5. Emits a per-client section into the run's handoff JSON
6. Calls `generate_portfolio_report` to produce the final report artefact
7. Writes the report to a new `reports` table row (org-scoped)
8. Calls `send_email` to deliver the HTML report (see Module F) to the signup email
9. Completes; dashboard refreshes via WebSocket (`useSocket`)

### Step 7 — First report viewed (immediate)

User lands on the Dashboard (see Module E) showing the red / yellow / green portfolio overview. The first weekly HTML report is also sitting in their inbox. **From week 2 onward, the scheduled task takes over** and fires the Reporting Agent on its configured weekly cadence (default: Monday 8am in the org's timezone).

### Acceptance target

**Landing page → dashboard with first report visible in under 10 minutes** for a typical agency (20–50 clients). Stretch target: under 5 minutes. For 100+ client agencies with deep historical data, longer is acceptable — but the UI must never appear stuck. The sync progress UI is non-negotiable.

The ClientPulse soft launch is **not considered validated** until this flow works end-to-end for a real design-partner agency on real GHL data. Mocks and test fixtures are necessary during development but are not a substitute for real-world validation (see Module C's agency-token-vs-location-token note — that's the single biggest unverified GHL-side risk in the plan).

---

## 4. Module breakdown

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

### Module C — GHL Data Connector *(extends existing, ~60% built)*

The **first data source plugin** — the same extensibility point that will later host Google Ads, GA4, Meta, HubSpot, Stripe. Architecturally GHL is the first citizen, not a special case, so the plugin shape it establishes is what future connectors inherit.

**Status: ~60% already built.** See `server/adapters/ghlAdapter.ts` (342 lines), `server/routes/webhooks/ghlWebhook.ts`, and the `canonicalEntities` + `canonicalDataService` stack. What's left: real-world validation of the fetch methods against a live GHL agency, webhook event normalisation for Opportunity stage/status transitions, and completing the sync-phase state machine (see `tasks/ghl-agency-development-brief.md` Phase 2).

#### OAuth + app registration

- **App type:** Agency-level (not Sub-Account). One install at agency level grants access to all locations under that agency — no per-client setup, no per-client auth prompts.
- **Redirect URL:** `https://app.synthetos.ai/oauth/callback` — generic path, future connectors share it via `state`-parameter dispatch
- **Webhook URL:** `https://app.synthetos.ai/webhooks/ingest` — generic path, future connectors share it via sub-path or header routing
- **URL compliance:** no `ghl`, `gohighlevel`, `highlevel`, `hl`, or `leadconnector` strings in any registered URL — GHL's validator rejects them outright and the white-label approval rule demands it (see "GHL compliance rules" below)
- **Distribution:** **Private app** during beta. Install URL shared directly with design partners. **Hard cap: 5 active external agencies** on private apps before new installs are blocked. Marketplace submission required to scale past 5.
- **Full step-by-step app registration walkthrough:** see `docs/create-ghl-app.md` — covers the Create App dialog, Profile → Basic Info, Advanced Settings → Auth, Advanced Settings → Webhooks, scopes investigation, compliance rules, private-app limits, and a logo generation prompt

#### Minimum OAuth scope set

Seven scopes, all read-only. Keeping the list tight matters for consent-screen trust, marketplace review velocity, and security blast radius.

| Scope | Purpose |
|---|---|
| `locations.readonly` | List sub-accounts at install time via `/locations/search` |
| `contacts.readonly` | Contact records + Contact lifecycle webhooks — drives lead volume metric |
| `opportunities.readonly` | Opportunity records + Opportunity stage/status webhooks — drives pipeline velocity metric |
| `conversations.readonly` | Conversation metadata + Conversation lifecycle webhooks — drives engagement metric |
| `conversations/message.readonly` | Message-level details — some GHL plans require this as a separate scope |
| `payments/orders.readonly` | Invoice/Payment webhooks + revenue data — degrades gracefully on plans without payments |
| `businesses.readonly` | Business metadata per sub-account (name, timezone, address) — used for report labelling |

**Not requested:** any `.write` scopes (v1 is strictly read-only), `calendars*`, `associations*`, `campaigns*`, `forms*`, `surveys*`, `users*`.

#### Webhook event subscriptions

See `docs/create-ghl-app.md` Appendix B for the canonical list. High-level:

- **Contact lifecycle** — `ContactCreate` / `ContactUpdate` / `ContactDelete`
- **Opportunity lifecycle** — `OpportunityCreate` / `OpportunityStageUpdate` / `OpportunityStatusUpdate` / `OpportunityDelete`
- **Conversation lifecycle** — `ConversationCreated` / `ConversationUpdated` / `ConversationInactive`
- **Revenue** — `InvoiceCreated`, `PaymentReceived`, `InvoicePaid` (plan-dependent)
- **App lifecycle (critical)** — `INSTALL`, `UNINSTALL` — drives initial sync and cleanup
- **Sub-account lifecycle** — `LocationCreate`, `LocationUpdate` — detect new sub-accounts mid-stream without waiting for re-enumeration

Everything else stays disabled. The existing `mapGhlEventType` in `ghlAdapter.ts` handles the canonical events and silently drops unrecognised ones, so enabling extras doesn't crash — it just adds noise and consumes inbound rate-limit budget.

#### GHL API endpoints used

All live on `https://services.leadconnectorhq.com` with `Version: 2021-07-28` header and Bearer-token auth, called from the existing `ghlAdapter.ingestion` methods:

| Purpose | Endpoint |
|---|---|
| List sub-accounts | `GET /locations/search?companyId={agencyId}&limit=100` |
| Fetch contacts | `GET /contacts/?locationId={id}` (paginated) |
| Fetch opportunities | `GET /opportunities/search?location_id={id}` (paginated) |
| Fetch conversations | `GET /conversations/search?locationId={id}` (paginated) |
| Fetch payment orders | `GET /payments/orders?altId={id}&altType=location` (paginated — may 404 on plans without payments) |

#### Agency token vs location-token exchange — the biggest unverified risk

The existing `ghlAdapter.ts` assumes **a single agency-level OAuth token can directly call per-location endpoints** with `locationId` as a query parameter. This is the optimistic assumption and it may or may not hold for every endpoint in the current GHL API version. The code was written to that assumption but has not been validated against a real GHL agency account.

**If direct calls fail on some endpoints during live testing**, the fallback is a minimal one-day extension:

1. Add `getLocationToken(connection, locationId)` helper that POSTs to `/oauth/locationToken` with `{ companyId, locationId }` using the agency token
2. GHL returns a location-scoped token with short TTL (~1 hour)
3. Cache the location token keyed on `(companyId, locationId)` until expiry
4. In the fetch methods, replace `decryptAccessToken(connection)` with `getLocationToken(connection, locationId)` on the affected endpoints only

**This must be verified against a real GHL agency with 3–5 sub-accounts before committing to soft launch.** It is the single biggest GHL-side risk in the plan. Build the `getLocationToken` helper early even if the direct-token pattern works — it's cheap insurance against GHL tightening the API in a future version.

#### GHL compliance rules — "no HighLevel references"

GHL enforces a "no HighLevel references in public surfaces" rule to preserve white-label compatibility. Many GHL agencies run in SaaS Mode where their clients never see the "HighLevel" brand — if ClientPulse references HighLevel anywhere public, those agencies can't safely install it.

**The rule:** do not use the strings `highlevel`, `gohighlevel`, `hl`, or `leadconnector` in:

- App name, tagline, company, website URL (in the GHL marketplace listing)
- Redirect URL or webhook URL paths (enforced by GHL's URL validator — rejects outright)
- Landing page content at the registered website
- Marketing copy in the Listing Configuration / App Profile
- Screenshot captions
- Getting Started Guide copy

**Permitted everywhere else:** internal code, comments, documentation (including this brief), the authenticated Synthetos app after install, private support materials. The restriction is specifically on the public-facing surface the GHL review team and white-label agencies can see.

This is why the recommended URL paths are `/oauth/callback` and `/webhooks/ingest`, not `/integrations/ghl/callback` and `/webhooks/ghl`. It's also why the tagline, company, and website fields in `docs/create-ghl-app.md` are written to avoid brand references while still describing the product accurately.

#### Private-app soft-launch ramp

| Phase | Action | External agency count |
|---|---|---|
| 0 | Install on own test agency. Verify OAuth + data pull end-to-end, including the agency-token-vs-location-token question. | 0 (internal only) |
| 1 | Closed beta with 3–5 design-partner agencies on the private app | 3–5 |
| 2 | Submit for marketplace review — in parallel with closed beta, not after | Still 3–5 |
| 3 | Approval lands → flip to Public → scale past 5 | Unlimited |

**Submission timing:** start marketplace submission **before** hitting the 5-cap, not after. Review timelines are unknown and non-trivial; approval must arrive when you're ready to scale, not after you're blocked with a waiting list.

#### Codebase changes required to match registered URLs

Whatever URLs get registered in the GHL app builder must match the Express route paths in the codebase. The existing `server/routes/webhooks/ghlWebhook.ts` is mounted at whatever path the `server/index.ts` gives it — that mount path needs to match the registered webhook URL (`/webhooks/ingest`). Same story for the OAuth callback: create or rename a route at `/oauth/callback` with state-based dispatch to the right adapter.

Environment variables to set:

| Variable | Source | Purpose |
|---|---|---|
| `GHL_APP_CLIENT_ID` | GHL app builder | OAuth client ID |
| `GHL_APP_CLIENT_SECRET` | GHL app builder | OAuth client secret (sensitive) |
| `GHL_APP_WEBHOOK_SECRET` | GHL app builder → Webhooks | HMAC signing secret for webhook verification |
| `GHL_APP_REDIRECT_URI` | Hardcoded | `https://app.synthetos.ai/oauth/callback` |

### Module D — Self-Serve Onboarding *(new product surface)*

The consumer-grade front door the platform currently lacks. See **Section 3** for the full step-by-step user journey this module implements.

- Public signup (email + password or Google SSO)
- Stripe checkout with trial — **or admin-comped during soft launch** (see Module G; Stripe is not on the critical path for the initial beta)
- On signup: create org + `org_subscriptions` row (Starter tier, trialing), call `systemTemplateService.loadToOrg('ghl-agency-intelligence', orgId, {})` to provision the Reporting Agent (org-scoped, single row)
- "Connect Go High Level" OAuth step — redirects to GHL's consent screen with the Module C scope list
- **Location enumeration screen**: *"We found N sub-accounts. Which ones should ClientPulse monitor?"* with "Select all" default
- Auto-provision selected locations as `subaccounts` + `canonical_accounts` rows at the org level — **no per-subaccount agent provisioning**, because the Reporting Agent is already org-scoped from the template load (see Module B)
- **Trigger the first Reporting Agent run immediately when initial sync completes** — do not wait for the weekly schedule. The first 10 minutes of a new customer's experience is non-negotiable.
- Post-signup dashboard landing with a progress UI for any in-flight sync

**Target:** landing page → dashboard with first report visible in **under 10 minutes** (stretch: under 5 minutes). Aligned with Section 3's acceptance target and Section 9's success criteria.

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

- Make the org sidebar config-driven (reads `sidebar_config` from the union of active modules per Module A)
- Build `DashboardPage` as a reusable component that works at ClientPulse tier and future full-tier — data-driven widgets (health scores, anomalies, recent runs, alerts), not hardcoded sections
- Build `ReportsListPage` + `ReportDetailPage` for the portfolio-report viewer
- Narrow the Integrations page to filter by template-allowed connectors (GHL only for this template)
- Public marketing / signup pages at `synthetos.ai/clientpulse` (separate surface, not part of the authenticated app)
- **Honour the "tables: column-header sort + filter by default" architecture rule** from CLAUDE.md — the Reports list, Companies list, and any tabular widgets on the Dashboard must use the `SystemSkillsPage.tsx` `ColHeader` / `NameColHeader` pattern: `Set<T>`-based exclusion filter state, sort indicators (↑ / ↓), active-filter indigo dots, and a "Clear all" button in the page header when any sort or filter is active. No exceptions, no legacy "static table" fallbacks.
- **Distinguish the ClientPulse customer Dashboard from the internal `OpsDashboardPage`** — these are two different pages with different audiences and must not be confused or merged:
  - `OpsDashboardPage` (at `/admin/ops`, `/system/ops`, `/admin/subaccounts/:id/ops`) is the **operator-facing** activity feed showing agent runs, review items, health findings, inbox items, decision logs, playbook runs, task events, and workflow executions. Built in the Agent Coworker Features work on main. ClientPulse users must NOT see it — their sidebar doesn't include it.
  - The **ClientPulse customer Dashboard** (Module E) is a **portfolio-health-focused** view for agency owners showing per-client red/yellow/green status, anomalies, churn risk, and latest reports. Lives at a different route (e.g. `/dashboard`). It is not a replacement for `OpsDashboardPage`; both exist for different personas.

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

## 5. What we are leveraging — already built

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
- `useSocket` WebSocket hook for real-time dashboard refreshes on run completion

**Agent Coworker Features (100% complete — available but not wired for ClientPulse v1):**

Five features shipped on main that ClientPulse can optionally leverage later, but does not require for soft launch. Documented in `architecture.md` → "Agent Coworker Features":

- **Ops Dashboard** (`OpsDashboardPage.tsx`, `opsDashboardService.ts`, routes at `/admin/ops`, `/system/ops`) — operator-facing activity feed. **Explicitly NOT the ClientPulse customer Dashboard** (see Module E for the distinction). Two different pages for two different personas.
- **Priority Feed** (`priorityFeedService`, `read_priority_feed` universal skill, migration 0100) — scored work queue for heartbeat agents. Optional future optimisation: the Reporting Agent could use it to order which clients to process first. Not needed for v1; simple linear iteration is fine.
- **Cross-Agent Memory Search** (`search_agent_history` universal skill, semantic vector search over `workspaceMemoryEntries`) — the Reporting Agent could reference observations from prior runs across the org. Not needed for v1 but available on demand.
- **Slack Conversational Surface** (`slackConversationService`, `slackWebhook.ts` `block_actions` handler, migrations 0102–0103) — **not wired for ClientPulse v1** (read-only tier has no HITL actions to approve), but ready to go when ClientPulse v2 adds action-taking skills and needs HITL approvals over Slack. The infrastructure is done; the action-taking skills aren't.
- **Skill Studio + skill versioning** (`skillStudioService`, `skill_versions` table, migration 0101) — available for rollback-safe refinement of the Reporting Agent skill bundle going forward. Relevant during the "wire intelligence executors to real canonical data" phase if the skills need iteration.
- **System skills DB-backed** (migrations 0097–0099) — `systemSkillService` manages skill rows; `handlerKey` enforced at server boot by `validateSystemSkillHandlers()`. The Reporting Agent's skill bundle is governed by this, so any new intelligence skills must be registered in the handler map.

**This is why the brief feels small — most of the platform is already done.** The new work is: finishing the GHL ingestion pipeline, wiring intelligence executors to real data, adding Module A's allowlist enforcement, building the module-driven sidebar, a handful of new pages, Module G's admin UI, and the GHL app registration. Not seven new modules from scratch.

**Cross-references:**
- `architecture.md` — authoritative description of codebase patterns ClientPulse inherits (three-tier model, cascading data sources, RLS, pg-boss scheduling, skill system, the Agent Coworker Features above, and the "tables: column-header sort + filter by default" rule)
- `docs/create-ghl-app.md` — step-by-step walkthrough for registering the ClientPulse app in the GHL Marketplace (Create dialog, Profile, Auth, Webhooks, scopes, compliance rules, private-app limits, logo prompt, known ambiguities)
- `tasks/ghl-agency-development-brief.md` — authoritative phase-by-phase build plan with remaining-effort estimates per phase
- `tasks/ghl-agency-feasibility-assessment.md` — feasibility context for the original GHL agency play
- `tasks/ghl-agency-value-proposition.md` — positioning and value-prop thinking
- `tasks/build-config-template-feature.md` — management-page task spec (editing config templates from the UI)

---

## 6. Explicitly out of scope for soft launch

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

## 7. Open questions to resolve before writing the full spec

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
- ~~GHL marketplace approval path~~ — **start on a private app**, closed beta with 3–5 design partners, submit for marketplace review in parallel so approval lands before scaling past the 5-agency private cap. See Module C's "Private-app soft-launch ramp" table.
- ~~GHL URL compliance~~ — no `ghl` / `gohighlevel` / `highlevel` / `hl` / `leadconnector` in any registered URL. Use `/oauth/callback` and `/webhooks/ingest` — generic, future-connector-friendly, and passes GHL's validator. See Module C and `docs/create-ghl-app.md`.
- ~~First-report timing~~ — immediately trigger one Reporting Agent run when initial sync completes. Never wait for the weekly schedule on a fresh signup. See Section 3 Step 6 and Module D.
- ~~Dashboard vs OpsDashboard distinction~~ — the ClientPulse customer Dashboard (Module E) and the internal operator-facing `OpsDashboardPage` are two different pages with different audiences. Both exist. ClientPulse users only see the customer Dashboard. See Module E.

**Still open:**

1. **Template config format** — operational_defaults JSONB (current) is fine for runtime, but should new templates be authored as YAML in repo (code-reviewed, diffable) and imported into the DB, or authored directly as DB records via an admin UI? Paperclip already supports the import path. Recommendation: YAML in repo for canonical templates; admin UI for ad-hoc edits.
2. **Minimum viable GHL data subset for a useful first report** — recommendation: contacts + opportunities + conversations + revenue (where available). Skip calendars, call tracking, and reviews in v1.
3. **Soft-launch audience** — invite-only with 3–5 design partners (matching the private-app cap), or wait for marketplace approval and go public from day one? Recommendation: invite-only private beta for tighter feedback, submit for review in parallel.
4. **Seed-script hygiene** — the current UI shows two "GHL Agency Intelligence" rows (one with 1 agent, one with 0). Where does the template get seeded, and is the master seed script the right home? Upsert semantics keyed on a stable manifest hash or slug. Resolve before soft-launch testing.
5. **Lock initial pricing** — Starter / Growth / Scale monthly dollar amounts need to be decided before Module G's seeded subscriptions are finalised.
6. **Agency-token-vs-location-token empirical verification** — the existing adapter assumes direct agency-token calls work for all endpoints. This is unverified. Phase 0 of the soft-launch ramp (install on own test agency) must validate this before Phase 1 starts. See Module C's "Agency token vs location-token exchange" section.

---

## 8. Suggested build order

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

## 9. Success criteria for soft launch

- 10 paying GHL agencies onboarded with real data
- End-to-end signup → first report in under 10 minutes (stretch target: 5)
- Weekly reports delivered reliably for 4 consecutive weeks
- At least one documented case study (quantified churn catch, retention win, or reporting-time saved)
- Zero data leakage between orgs (RLS + scope assertions hold)
- **Template system validated by adding a second template** (e.g. `generic-agency.yaml`) with zero changes to core code — this is the real architectural proof, not just that ClientPulse works
