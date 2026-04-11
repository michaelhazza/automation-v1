# ClientPulse for GHL Agencies — Development Brief

**Status:** Draft, high-level brief only. Full dev spec to follow once in-flight code improvements land.
**Goal:** Soft launch ClientPulse as a Synthetos product tier targeted at Go High Level agencies — positioned as "the missing agency dashboard GHL forgot to build."

---

## Contents

1. Strategic framing
2. Guiding architectural principle — templates are the abstraction
3. Module breakdown
   - Module A — Template & Module Gating System
   - Module B — ClientPulse
   - Module C — GHL Data Connector
   - Module D — Self-Serve Onboarding
   - Module E — Consumer UI Shell
   - Module F — PDF Reports & Email Delivery
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

The single most important architectural change in this brief is the introduction of a **Configuration Template system**. It is what keeps GHL, ClientPulse, and every future flavour out of core code.

A Template is versioned config that declares, in one place:

- Which **system agents** are linked into the org (not all of them by default)
- Which **skills** are visible and enabled
- Which **modules** are turned on
- Default **scheduled tasks** and heartbeat cadences
- Required **data source connectors**
- Default **permission sets** for org and subaccount roles
- **Onboarding flow** (which OAuth providers to prompt, which fields to collect)
- **Branding** (product name shown to end user, PDF report chrome)
- **Billing tiers** available

Template catalog lives as versioned config (YAML under `server/config/templates/` is the recommended first shape — code-reviewed, source-controlled, trivially diffable). Applied on org creation; re-applied on upgrade when new modules join a template.

**First template to ship:** `ghl-agency.yaml`. Every other go-to-market flavour is a future template that reuses the same mechanism.

**Crucial constraint for this work:** today, every new org implicitly inherits every system agent and every system skill. That has to stop. The template system must be the *only* path that decides what an org sees, so that a ClientPulse-GHL org shows the Reporting Agent and nothing else — no orchestrator, no dev agent, no other system agents leaking in.

---

## 3. Module breakdown

Each module is a unit of functionality a template can opt into. MVP ships these seven:

### Module A — Template & Module Gating System *(new core, build first)*

Foundation for everything else. New shape:

- `org_templates` table — tracks which template an org was built from, version, applied timestamp
- `org_enabled_modules` table — which modules are active on which orgs
- **Module manifest format** (YAML): id, display name, system agents included, skills included, permissions included, routes exposed, default data sources
- **Middleware / service filters** that read enabled modules and hide system agents / skills / routes not included
- `createOrgFromTemplate(templateId)` service that hydrates a new org from a template declaration
- Migration path for existing orgs (either grandfathered as "legacy" or retro-assigned to a "generic" template)

**Without Module A, everything downstream has to be hardcoded. It is the unlock.**

### Module B — ClientPulse *(the actual thing the customer pays for)*

A module that, when enabled, exposes:

- The **Reporting Agent** seeded into the org as read-only (not editable by the user, not shown in agent lists)
- The Reporting Agent skill bundle already shipped in core: `compute_health_score`, `compute_churn_risk`, `detect_anomaly`, `generate_portfolio_report`, `trigger_account_intervention`, etc.
- Per-subaccount **weekly portfolio report** scheduled task
- **Report viewer routes** and dashboard pages
- **PDF export** pipeline (see Module F)

Important: the customer never sees the Reporting Agent as "an agent." They see **Reports** and **Alerts**. The agent is invisible infrastructure. Module gating (Module A) is what makes that hiding clean rather than hacky.

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

### Module E — Consumer UI Shell *(new frontend)*

The existing admin UI is an operator interface. End users should never land in it.

- Marketing / landing page (`synthetos.ai/clientpulse`)
- Clean signup, login, billing pages
- **Dashboard** — list of monitored clients with red / yellow / green status
- **Report viewer** — HTML view + downloadable PDF
- **Settings** — report cadence, recipient emails, notification prefs
- **Billing portal** link (Stripe)

The admin UI continues to exist for `system_admin` / `org_admin` power users. End users never see it because Module A gates routes.

### Module F — PDF Reports & Email Delivery *(new capability)*

- PDF template rendered by **Puppeteer on the existing browser worker**
- Takes Reporting Agent structured output → branded PDF
- Email delivery via existing `send_email` skill
- Also stored in-app for dashboard viewing
- Synthetos-branded for MVP; white-label is a later module

### Module G — Billing & Metering *(new subsystem)*

- Stripe subscriptions (Starter / Growth / Agency tiers)
- Metered dimension: number of active monitored subaccounts
- Subscription status gates module access (enforced by Module A)
- Billing portal link
- Trial-to-paid conversion flow

---

## 4. What we are leveraging — already built

These exist today and require zero or minimal new work:

- Three-tier org / subaccount data model — maps 1:1 onto agency / GHL-location
- Reporting Agent skill bundle
- `agent_data_sources` cascade with eager / lazy loading and budget enforcement
- Scheduled tasks + heartbeat via pg-boss (with minute-precision offsets so 100+ orgs don't thundering-herd)
- HITL review gates (for future action-taking tier)
- RLS three-layer tenant isolation + scope assertions
- Run traces, cost breakers, budget reservations
- Memory blocks (per-agency preferences, voice, thresholds)
- Browser worker (for Puppeteer PDF rendering and paywalled fetching)
- `send_email`, `send_to_slack`, `transcribe_audio` skills

This is why the brief feels small — most of the platform is already done. The new work is almost entirely the **template system + the GHL connector + the customer-facing shell**.

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

1. **Template config format** — YAML in repo (recommended for v1) vs DB-managed records? YAML is simpler, version-controlled, code-reviewed; DB is flexible per-org but invites drift.
2. **GHL Marketplace approval path** — does soft launch wait for marketplace approval, or launch with a private OAuth app and migrate design partners later?
3. **Pricing commitment** — lock the Starter / Growth / Agency structure before Stripe integration, or keep it loose?
4. **Minimum viable GHL data subset for a useful first report** — recommendation: contacts + opportunities + calendars + campaigns. Skip call tracking and reviews in v1.
5. **Soft-launch audience** — invite-only with ~10 design partners, or public self-serve from day one? Invite-only is lower risk and gives tighter feedback.
6. **Legacy-org migration** — how does `createOrgFromTemplate` interact with orgs that already exist? Grandfather as "legacy" template, or retro-assign?
7. **Which agent list does the Reporting Agent live in** — cloned as an org agent under the template, or rendered as system-managed with template-level visibility? The latter avoids duplication but needs Module A to handle visibility gating.

---

## 7. Suggested build order

1. **Module A (Template & Module Gating)** — everything else depends on it
2. **Module C (GHL Connector)** — validates the plugin architecture; parallelisable with later A work
3. **Module B (ClientPulse wiring)** — small once A + C exist
4. **Module F (PDF + email delivery)** — standalone, parallelisable with B
5. **Module D (Onboarding flow)** — needs A + C + B
6. **Module G (Billing)** — parallelisable with D
7. **Module E (Consumer UI shell)** — glues D + B + G together
8. **Soft launch to ~10 design-partner GHL agencies**

---

## 8. Success criteria for soft launch

- 10 paying GHL agencies onboarded with real data
- End-to-end signup → first report in under 10 minutes (stretch target: 5)
- Weekly reports delivered reliably for 4 consecutive weeks
- At least one documented case study (quantified churn catch, retention win, or reporting-time saved)
- Zero data leakage between orgs (RLS + scope assertions hold)
- **Template system validated by adding a second template** (e.g. `generic-agency.yaml`) with zero changes to core code — this is the real architectural proof, not just that ClientPulse works
