# ClientPulse for GHL Agencies — Development Brief

**Status:** Draft, high-level brief only. Full dev spec to follow once in-flight code improvements land.
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

**Crucial constraint Module A still needs to enforce:** today, every org can still see every system agent regardless of which template provisioned the org. That has to change. The fix is `source_template_id` on agents + lifecycle gating at three enforcement points (see Module A). Without this, the upgrade / downgrade path silently ships a bug.

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

**What still needs to be built or fixed inside Module A:**

1. **Seed-script hygiene** — the UI currently shows **two** "GHL Agency Intelligence" rows (one with 1 agent, one with 0). Check the master seed script (and any other seed scripts that may be independently seeding templates — the GHL template may not be in the master seed at all) and ensure proper upsert semantics keyed on a stable manifest hash or slug, so repeated runs don't create duplicates. Clean up the existing duplicate row before soft-launch testing.

2. **Module lifecycle gating** — the single most important new piece of Module A. Today, once `loadToOrg()` provisions agents they run forever regardless of subscription state. If an org upgrades from ClientPulse → Full tier (adding ~14 more agents), then downgrades back to ClientPulse, the extra agents silently keep running and consuming budget. This must be designed for **now**, not retrofitted later. Minimal design:
   - Add `source_template_id` column to `agents` table (nullable; existing agents untouched, fully backwards-compatible). Stamped by `loadToOrg()`.
   - Add `org_active_templates (org_id, template_id, activated_at, deactivated_at)` — or equivalent column on the subscription row — tracking which templates are currently active per org.
   - Check "is source template active" at **three enforcement points**:
     - **Scheduling:** `agentScheduleService.enqueue()` skips agents whose `source_template_id` is not in the org's active templates.
     - **Execution:** on dequeue, re-check. If the template was deactivated between enqueue and execute, abort cleanly with a `skipped_module_disabled` run status.
     - **UI / API:** default agent-list query filters out inactive-template agents (optional `?includeInactive=true` for system admin debugging).
   - **Never delete or soft-delete agents on downgrade.** They go dormant. Configs, memory, and run history persist. On re-upgrade, the `org_active_templates` row flips back to active and agents resume — no re-provisioning, no duplication.

3. **Sidebar-in-template-config** — the config template's operational defaults should include a `sidebar` array declaring which nav items the end user sees. This is how Module E (below) avoids ever touching core UI code for a new template. Zero if-statements, entirely data-driven.

4. **Visibility gating for system agents** — with `source_template_id` in place, agent list queries can filter to "agents belonging to this org's active templates." Non-template-provisioned agents (legacy or org-created) remain visible normally.

**Without Module A's lifecycle gating, the upgrade / downgrade bug is guaranteed to ship.**

### Module B — ClientPulse *(the actual thing the customer pays for)*

**The agent shape is deliberately minimal: one agent, org-scoped, iterates over subaccounts in its own run loop.** No orchestrator, no BA agent, no sub-agent handoffs, no per-subaccount agent provisioning. This is simpler and cheaper than the 3-agent model in `tasks/ghl-agency-development-brief.md` (which should be updated to match) and matches the read-only positioning of ClientPulse v1.

A module that, when enabled, exposes:

- **The Reporting Agent — one row, org-scoped.** Provisioned by `loadToOrg()` as a single `agents` row with `isSystemManaged: true`, `executionScope: 'org'`, `source_template_id` stamped. **No `subaccountAgents` links are created.** The other ~14 system agents remain defined in `systemAgents` but are never linked into the org via this template.
- The Reporting Agent skill bundle already shipped in core: `compute_health_score`, `compute_churn_risk`, `detect_anomaly`, `generate_portfolio_report`, `trigger_account_intervention`, `query_subaccount_cohort`, `read_org_insights`, `write_org_insight`, etc.
- **Per-client iteration inside the agent run loop.** The agent lists the org's active GHL-linked subaccounts via `canonicalDataService`, iterates client-by-client, computes health score / churn risk / anomalies per client, emits per-client sections of the portfolio report. Single run, single scheduled task, single cost record. No handoff mechanism, no per-client sub-runs.
- **One org-level weekly scheduled task** (not per-subaccount) running on a heartbeat/cron. Scale with client count is linear inside the loop, not multiplicative across scheduled tasks.
- **Report viewer routes** and a dashboard page (see Module E).
- **HTML email delivery** (see Module F — PDF is deferred).

Important: the customer never sees the Reporting Agent as "an agent." They see **Reports** and **Alerts** and a **Dashboard**. The agent is invisible infrastructure. Module A's visibility gating + Module E's template-driven sidebar are what make that hiding clean rather than hacky.

**Upgrade path note:** when a customer later upgrades to the full Synthetos tier, `loadToOrg()` runs with the full-tier template and provisions additional agents (Orchestrator, BA Agent, action-taking specialists, etc.) alongside the existing Reporting Agent. Downgrading back flips those extra agents dormant via Module A's lifecycle gating — the Reporting Agent continues running because its source template is still active.

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

### Module G — Billing & Metering *(new subsystem)*

- Stripe subscriptions — tiers named **Starter / Growth / Scale** (deliberately generic; avoids vertical-specific words like "Agency" so the same tier shape reuses for future templates)
- Metered dimension: number of active monitored subaccounts
- Subscription status drives Module A's `org_active_templates` — an expired or downgraded subscription deactivates the template, and Module A's lifecycle gating takes over (agents go dormant, no re-provisioning on re-upgrade)
- Billing portal link
- Trial-to-paid conversion flow
- Optional future fourth tier: **Enterprise** (human-touch, custom SLAs, SSO) above Scale

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
- ~~How to hide operator UI from ClientPulse users~~ — **template-driven sidebar**. Config template declares the sidebar array; existing UI reads it. Zero if-statements.
- ~~Upgrade / downgrade agent lifecycle~~ — **`source_template_id` stamping + `org_active_templates` + three enforcement points** (scheduling / execution / UI). Agents go dormant on downgrade, resume on re-upgrade, no destructive ops.

**Still open:**

1. **Template config format** — operational_defaults JSONB (current) is fine for runtime, but should new templates be authored as YAML in repo (code-reviewed, diffable) and imported into the DB, or authored directly as DB records via an admin UI? Paperclip already supports the import path. Recommendation: YAML in repo for canonical templates; admin UI for ad-hoc edits.
2. **GHL Marketplace approval path** — does soft launch wait for marketplace approval, or launch with a private OAuth app and migrate design partners later?
3. **Minimum viable GHL data subset for a useful first report** — recommendation: contacts + opportunities + calendars + campaigns. Skip call tracking and reviews in v1.
4. **Soft-launch audience** — invite-only with ~10 design partners, or public self-serve from day one? Invite-only is lower risk and gives tighter feedback.
5. **Legacy-org migration** — how does `loadToOrg` interact with orgs that pre-date the lifecycle gating? Grandfather as "no source template" (the `null` case, unfiltered) so existing orgs are unaffected.
6. **Seed-script hygiene** — where does "GHL Agency Intelligence" get seeded, and is the master seed script the right home for it? Duplicate row in the current UI suggests repeat runs without upsert. Resolve before soft-launch testing.
7. **Where do `org_active_templates` and subscription state reconcile?** — does the Stripe webhook write directly to `org_active_templates`, or does it write to a subscription row that Module A reads? Recommendation: subscription row is the source of truth; `org_active_templates` is derived.

---

## 7. Suggested build order

1. **Module A** — `source_template_id` column + `org_active_templates` + three enforcement points + seed-script hygiene + sidebar-in-template-config. Everything downstream depends on this.
2. **Module C (GHL Connector)** — finish real data ingestion (`fetchContacts`, `fetchOpportunities`, `fetchConversations`, `fetchRevenue`) per `tasks/ghl-agency-development-brief.md` Phase 2. Parallelisable with later A work.
3. **Module B (ClientPulse wiring)** — wire intelligence executors to canonical data, finalise 1-agent template definition, cleanup duplicate seed row.
4. **Module F (HTML email delivery)** — standalone, parallelisable with B.
5. **Module E (Dashboard + Reports pages + template-driven sidebar)** — parallelisable with B/F once Module A's sidebar config shape lands.
6. **Module D (Self-serve onboarding)** — needs A + C + B + G.
7. **Module G (Billing)** — can start in parallel with D; Stripe webhooks write to subscription state that Module A reads.
8. **Soft launch to ~10 design-partner GHL agencies.**

---

## 8. Success criteria for soft launch

- 10 paying GHL agencies onboarded with real data
- End-to-end signup → first report in under 10 minutes (stretch target: 5)
- Weekly reports delivered reliably for 4 consecutive weeks
- At least one documented case study (quantified churn catch, retention win, or reporting-time saved)
- Zero data leakage between orgs (RLS + scope assertions hold)
- **Template system validated by adding a second template** (e.g. `generic-agency.yaml`) with zero changes to core code — this is the real architectural proof, not just that ClientPulse works
