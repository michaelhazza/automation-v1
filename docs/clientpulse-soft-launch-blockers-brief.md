# ClientPulse Soft-Launch Blockers — Development Brief

**Date:** 2026-04-25
**Status:** For review before technical spec
**Context:** Three items from the ClientPulse soft-launch gap analysis that block either the launch narrative or production stability. Each section covers the problem, the proposed approach, what we're not doing, expected outcomes, and open questions. Technical spec follows once the approach is approved.

---

## Contents

- [Item 1 — Client Baseline Capture & ROI Delta](#item-1--client-baseline-capture--roi-delta)
- [Item 2 — GHL Agency-Level OAuth Flow](#item-2--ghl-agency-level-oauth-flow)
- [Item 3 — Rate Limiter Stability for Production](#item-3--rate-limiter-stability-for-production)

---

## Item 1 — Client Baseline Capture & ROI Delta

### The problem

When an agency brings on a new client, two conversations define the relationship: the one at the start ("here is what we're going to do for you") and the one at renewal ("here is what we did for you"). The renewal conversation lives or dies on the gap between those two points.

Right now we have no way to capture the starting point. We continuously record how a client's metrics are moving — leads, pipeline value, response times, revenue — but we never stamp a permanent record of where things stood on day one. Without day one, we cannot compute the delta. Without the delta, every report we generate describes activity (we ran these campaigns, we fired these automations) instead of outcomes (your pipeline grew 40% since you hired this agency).

The audit flagged ROI delta tracking as non-negotiable for the soft-launch story. An agency demo that cannot answer "what have you actually achieved for your clients?" is not a compelling pitch to design partners.

### What we're proposing

**Baseline capture at onboarding.** When a client sub-account is first connected and their CRM data has been ingested for the first time, we take a permanent snapshot of their key metrics at that moment. This snapshot is write-once — it can never be modified or overwritten. It becomes the anchor point for every ROI calculation going forward.

**Baseline readiness condition.** The snapshot is only triggered when: (1) the sub-account's first full sync has completed, (2) all required metrics are present and non-null, and (3) ingestion coverage spans at least five calendar days. A partial or in-progress sync does not trigger baseline capture — a corrupted starting point is worse than no starting point.

The snapshot uses data we are already pulling. Metrics are tiered by reporting importance: **Tier 1 — headline metrics** (pipeline value, revenue) that appear in every client report and must be present before baseline capture completes; **Tier 2 — supporting metrics** (lead count, average response time, conversation engagement) that enrich the picture and are captured when available. No new data sources required. We are stamping what we already know at a specific point in time.

**ROI delta computation.** Once the baseline exists, the delta is arithmetic: current metric minus baseline metric, as an absolute number and a percentage. This feeds into the reporting agent — which already exists — so reports can say things like "since you connected this client in January, their pipeline has grown from $120k to $183k."

**Manual entry for existing clients.** A design-partner agency will almost certainly have clients they've worked with for months or years before installing the platform. For those clients we need a simple way to enter prior-period numbers manually — what their metrics looked like on the day the agency relationship started, even if that was 18 months ago. The baseline table accepts both automated captures and manual entries equally.

**Manual entry validation.** To prevent garbage inputs from corrupting what is supposed to be the most trusted number in the system, manual entries are validated against reasonable numeric ranges (no negative pipeline values, no lead counts above the sub-account's all-time recorded high). Required fields: pipeline value and revenue (Tier 1). Supporting metrics are optional. Each manual entry records the submitting user, the submission timestamp, and a `source` flag ('manual' vs 'auto') so future reports can distinguish agency-entered numbers from system-captured ones. A `confidence_level` field ('confirmed' vs 'estimated') lets the agency flag numbers that are best-available approximations rather than exact figures.

**Baseline failure handling.** Because the snapshot is write-once, the failure case requires care. If a baseline capture attempt fails (sync incomplete, required metrics missing, network error), the sub-account is assigned a `baseline_status` of `pending`. The system retries on the next completed sync. If three consecutive attempts fail, `baseline_status` is set to `failed` and the agency owner is notified to either trigger a retry or enter the baseline manually. A sub-account with `baseline_status = failed` still works normally — it simply shows no ROI delta until a baseline exists.

### What we're not doing

- No seasonality normalisation in v1. If a client's business has strong Q4 peaks, the delta reflects that — we do not adjust for it.
- No full historical data import. The manual entry covers the engagement-start numbers only, not a complete backfill.
- No changes to how we collect metrics. The GHL adapter already pulls everything we need.

### Expected outcome

Every client report can include an "since day one" section with concrete before-and-after numbers. The agency has a defensible, data-grounded answer at renewal. The weekly portfolio rollup can include ROI highlights across the whole portfolio rather than just health scores.

### Open questions for your feedback

1. **Trigger for baseline capture:** Should the snapshot be taken automatically the moment a sub-account's first sync completes? Or should it be a deliberate action the agency triggers — "lock in the baseline for this client"? Automatic is simpler operationally. Deliberate gives the agency control over the starting point (useful if the first sync happens to land on an unusual week).

2. **Scope of manual entry:** For clients the agency has had for a while, how many fields do we ask them to enter? Just the headline metrics (pipeline value, lead count, revenue) or all seven metrics we track? More fields = more complete picture but also more friction at onboarding.

3. **Visibility:** Should the baseline and the delta be visible to the end client in the client portal, or is this agency-internal only?

### Definition of done

- [ ] Baseline snapshot captured automatically on first completed sync for a new sub-account
- [ ] Baseline readiness condition enforced (full sync, Tier 1 metrics present, 5-day coverage)
- [ ] `baseline_status` lifecycle (pending → complete → failed) implemented with retry logic
- [ ] Manual entry form accepts Tier 1 required fields, validates numeric ranges, records submitting user and source
- [ ] ROI delta (absolute and percentage) computed and surfaced in at least one report section
- [ ] Manual entry round-trip tested end-to-end with a design-partner agency

**UX surface:** Agency-internal only in v1. The baseline and ROI delta are visible to the agency in the client detail view and portfolio rollup. Not exposed to the end client in the client portal unless explicitly enabled per open question 3.

---

## Item 2 — GHL Agency-Level OAuth Flow

### The problem

The way we connect to GoHighLevel determines how much access we get and how painful the setup is for agencies.

GHL offers two installation models. In the first, the app is installed per client account — the agency owner picks one client location, grants access, and must repeat the whole process for every other client. In the second, the app is installed once at the agency level, and we immediately gain access to every client location underneath. Our entire value proposition — portfolio-level health scoring, fleet-wide agent activity, one dashboard for 30 clients — depends on the second model.

The audit found two specific problems with how this is currently configured.

**The OAuth entry point may be wrong.** The URL we send users to when they start the GHL connection flow is the location chooser — the screen where a user picks a single client account. That is the sub-account install flow. An agency-level install works differently: the user grants access at the company level and all locations are included. Whether this requires a different URL or just a different app registration setting in GHL's developer portal is not yet confirmed — we have not tested it against a real agency account.

**A required permission is missing.** After a successful agency-level OAuth, we need to call a GHL endpoint that lists all the sub-accounts (client locations) under that agency. The permission that allows this — `companies.readonly` — is not in our current permission list. Without it, even a correctly configured agency install cannot enumerate the client locations we're supposed to be managing.

Beyond those two, the write permissions needed for agents to take action on the CRM side (sending messages, updating pipeline stages) are also missing from the declared scope. We're calling those endpoints in some places already; we just haven't declared the permissions formally.

Neither problem has been caught yet because we've only ever tested against our own internal accounts, not a real external agency account with multiple client sub-accounts.

### What we're proposing

**Confirm and fix the app registration.** GHL's developer portal has a setting for whether an app targets individual locations or agency-level companies. We verify this is set to agency/company, understand what effect that has on the OAuth URL, and update the code to match.

**Add the missing permissions.** Add `companies.readonly` (sub-account enumeration), `conversations.write` and `opportunities.write` (agent write-back actions), and `payments/orders.readonly` (revenue data for the ROI metric, which we already pull but haven't declared the scope for).

**Test against a real external agency account.** Install the app from scratch against a GHL developer agency that has at least 3–5 sub-accounts. Confirm that after install: all sub-accounts are visible, all data fetches return data, and no API calls fail with permission errors. This test also tells us whether the agency-level token can directly call per-location endpoints (straightforward) or whether we need to exchange it for per-location tokens before making location-specific calls (one extra step, already documented as a known possible requirement).

**Go/no-go gate.** This item has a binary success condition: after a clean agency-level OAuth against a real external agency account, all sub-accounts must be enumerable and all data fetches must return data without permission errors. If the flow cannot reliably enumerate sub-accounts — regardless of the cause — soft launch is blocked until it can. There is no fallback mode; a partial connection is worse than no connection from a reliability standpoint.

**Handle the install webhook.** When an agency installs the app, GHL fires an event. We need to confirm our system handles that event by: automatically listing all the agency's sub-accounts, creating records for each, and kicking off the initial data sync in the background. We also need to handle the uninstall event cleanly (revoke the token, stop all syncs, notify the agency owner).

### What we're not doing

- No per-sub-account install fallback. The architecture is agency-level. We are not building a compatibility mode for single-location installs.
- No public marketplace listing. We stay private with the 5-agency cap during soft launch.
- No changes to the core data model. The existing schema already handles multi-location connections correctly.

### Expected outcome

A design-partner agency with 30 clients connects in a single OAuth flow — one login, one permission grant. Within minutes, all 30 sub-accounts appear in their dashboard and data syncs begin automatically in the background. The onboarding sequence from "install the app" to "first health scores visible" is end-to-end verified before the first design partner is onboarded.

### Open questions for your feedback

1. **Test agency access:** Do we have a GHL developer account with multiple sub-accounts we can use for testing? If not, what's the fastest path to getting one — is there a GHL sandbox, or do we need to create a real agency account?

2. **Location token exchange:** If GHL's agency token cannot directly call per-location endpoints (we won't know until we test), we'll need to add a step that mints a location-specific token before each location API call. This is documented and supported by GHL — it's just an extra call per location. Is this an acceptable approach or would you want to explore alternatives?

3. **Install webhook handling:** Is the install webhook handler something we need to build from scratch, or does something already exist that needs to be extended? (The audit flagged this as unclear.)

### Definition of done

- [ ] App registration confirmed as agency/company target in GHL developer portal
- [ ] All four missing permission scopes added (`companies.readonly`, `conversations.write`, `opportunities.write`, `payments/orders.readonly`)
- [ ] Tested against a real external GHL agency account with at least 3 sub-accounts: OAuth completes, all sub-accounts visible, no permission errors
- [ ] Install webhook handler confirmed or built: sub-accounts auto-listed and data sync started on install event
- [ ] Uninstall event handled: token revoked, syncs stopped, agency owner notified
- [ ] Agency-level token vs location-token exchange question resolved and implementation confirmed

**UX surface:** Agency-facing only. The OAuth flow and post-install sub-account enumeration are part of the agency onboarding sequence. No end-client visibility into the connection mechanism.

---

## Item 3 — Rate Limiter Stability for Production

### The problem

GHL limits how many API requests our application can make per day across all agencies. To stay within that limit, we built a rate limiter — a counter that tracks outgoing requests and slows them down if we're approaching the ceiling.

The rate limiter is correctly designed for a server running as a single copy. The problem is that the counter lives inside the server's own memory. When the platform runs as two simultaneous copies — which happens automatically under load — each copy has its own independent counter. They have no awareness of each other. So if copy A has made 80,000 requests and copy B has made 80,000 requests, we have sent 160,000 requests today. But each copy thinks its number is 80,000, which is still comfortably within GHL's limit. The real number is not.

At current scale — one or two agencies, low request volume — this is unlikely to cause a problem in practice. We are nowhere near GHL's daily ceiling. But the failure mode, when it does occur, is severe: every GHL API call across every agency starts failing simultaneously, every agent run that depends on CRM data stops working, and nothing recovers until GHL's rate limit resets the following day. That is an all-day outage that is very difficult to explain to a paying design partner.

There is also a secondary issue: we have no visibility into how much of our daily GHL allowance we are consuming. We are flying without a fuel gauge.

### What we're proposing

There are two paths. We recommend choosing one before the technical spec.

**Option A — Constrained deployment (practical for soft launch).** At one or two design-partner agencies with modest data volumes, a single server instance is more than sufficient to handle the load. We formally document that the soft-launch deployment runs on a single instance, which means the in-memory counter is accurate by definition. We add a monitoring alert to detect if a second instance starts. We treat this as a hard constraint to revisit before a third design partner or any public launch.

Option A is only valid if two infrastructure conditions are enforced, not just documented: (1) the deployment platform is configured to run exactly one server instance (no auto-scaling), and (2) background job concurrency is capped so a sync spike cannot be mistaken for multi-instance activity. If either condition cannot be enforced at the infrastructure level, Option B is the only safe choice.

This costs almost nothing to implement and resolves the risk for soft launch. The trade-off is that it is a manually enforced constraint rather than a technical guarantee.

**Option B — Shared counter (the durable fix).** Replace the in-memory counter with one backed by a data store that all server instances share — each request increments a single counter that every instance reads from. This makes the rate limiter accurate regardless of how many copies are running. It is the architecturally correct solution for any scale beyond a tightly controlled single-instance deployment.

Regardless of which option is chosen, we also add a daily request counter with visibility — a simple running total of how many GHL API calls we have made today, surfaced in our internal ops view. This is basic operational hygiene: know your headroom before it becomes a problem, not after.

### What we're not doing

- No changes to how we call GHL. The rate limiter wraps the existing calls; only where the counter state lives changes.
- No full circuit breaker in this pass. If we go with Option B, a circuit breaker is a natural follow-on, but not required for soft launch.
- No changes to GHL's rate limits. This is about our enforcement of them, not negotiating different terms.

### Expected outcome

Predictable GHL API behaviour regardless of how many server instances are running. A visible daily request counter so we can see our headroom at a glance. Confidence that a sync spike or platform scaling event cannot produce an all-day GHL outage for design-partner agencies.

### Open questions for your feedback

1. **Option A vs Option B:** Given a soft-launch timeline of 1–2 agencies, is the single-instance deployment constraint sufficient, or do you want this solved properly from day one? Option A is faster; Option B is more robust. The answer may depend on how confident we are in staying single-instance through soft launch.

2. **If Option B:** What shared data infrastructure is available in the current Replit setup? The simplest implementation uses a single database row as an atomic counter — no new infrastructure required, just a new table. A Redis-based implementation is faster but requires Redis to be provisioned.

3. **Daily counter visibility:** Should request volume be surfaced in the agency-facing dashboard, or is this internal-only for our own ops team? An agency that understands they're on a shared API might appreciate seeing the headroom; but it could also create unnecessary anxiety or support questions.

### Definition of done

- [ ] Option A or B decision confirmed
- [ ] If Option A: single-instance constraint enforced at infra level (not just documented), job concurrency cap set, monitoring alert live for second-instance detection
- [ ] If Option B: shared counter implemented and tested under simulated two-instance load
- [ ] Daily GHL request counter visible in internal ops view with current usage and daily ceiling
- [ ] Counter confirmed accurate across all agency connections in a load test

**UX surface:** Internal ops only. Daily request counter is surfaced in the internal ops view, not in the agency-facing dashboard. Agencies are not exposed to headroom metrics in v1.

---

## Delivery dependencies and sequencing

These three items are not independent. The order matters.

1. **GHL OAuth (Item 2) is a prerequisite for everything else.** Without a working agency-level connection, there is no data to baseline and no production load to rate-limit. This must be resolved and tested first.
2. **Baseline capture (Item 1) depends on Item 2.** Baseline capture is only meaningful once the agency OAuth flow works and sub-accounts are auto-enrolled. The readiness condition (full sync complete, Tier 1 metrics present) cannot be met without a working connector.
3. **Rate limiter (Item 3) is independent in implementation** but must be in place before the first real agency is onboarded. A working OAuth and baseline offer no protection if the API layer can fail silently under load.

## Key instrumentation events

For each item, the minimum observable signal that the feature is working correctly in production.

| Item | Event name | What it signals |
|------|-----------|----------------|
| Baseline capture | `baseline.captured` | First successful immutable snapshot written for a sub-account |
| Baseline capture | `baseline.failed` | Three consecutive capture attempts failed — requires manual action |
| Manual entry | `baseline.manual_entry_submitted` | Agency user submitted a manual baseline |
| GHL OAuth | `ghl.agency_oauth_completed` | Agency-level OAuth completed, sub-account list returned |
| GHL OAuth | `ghl.subaccount_enrolled` | Individual sub-account record created post-install |
| Rate limiter | `ghl.rate_limit_threshold_reached` | Daily request count crossed 80% of ceiling |
| Rate limiter | `ghl.second_instance_detected` | (Option A only) Monitoring alert fired — constraint violated |

---

*For each item the approach is approved, a technical spec will be written covering exact schema changes, service boundaries, migration plan, and test criteria.*

