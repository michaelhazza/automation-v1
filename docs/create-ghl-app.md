# Creating a GHL Marketplace App for Synthetos / ClientPulse

**Status:** Work-in-progress instructional document. Captures the steps completed so far plus the parts we hit blockers on. Sections marked **[PENDING]** are steps we haven't fully navigated yet or where GHL's UI was ambiguous. Resume from the "Known ambiguities" list when returning to this.

**Purpose:** A reproducible reference for creating, re-creating, or updating the GHL Marketplace app registration for ClientPulse. Use this when bringing a new team member up to speed, when re-registering the app, or when preparing for marketplace submission.

**Related docs:**
- `docs/clientpulse-ghl-dev-brief.md` — the product + architecture brief
- `tasks/ghl-agency-development-brief.md` — the phase-by-phase build plan
- `server/adapters/ghlAdapter.ts` — the existing OAuth + webhook + ingestion code this app registration needs to match

---

## Contents

1. Overview
2. Prerequisites
3. Create App dialog
4. Profile → Basic Info
5. Profile → other sub-tabs
6. Advanced Settings → Auth (OAuth + Redirect URLs)
7. Advanced Settings → Webhooks
8. Advanced Settings → External Authentication
9. Modules section (GHL's concept, not Synthetos modules)
10. Pricing
11. Codebase changes required to match registered URLs
12. Compliance rules — the "no HighLevel references" constraint
13. Private app limits and marketplace submission path
14. Known ambiguities — things to resolve when returning
15. Appendix A — OAuth scopes for ClientPulse v1
16. Appendix B — Webhook events to enable
17. Appendix C — Logo prompt for AI image generation

---

## 1. Overview

This document covers creating an **Agency**-type, **Private**-distribution, **White-label**-listing app in the GHL Marketplace for ClientPulse — Synthetos' first publicly-distributable product. The app's purpose is:

- OAuth install at the agency level (one install → access to all sub-accounts under that agency)
- Enumerate sub-accounts ("locations" in GHL terminology) via `/locations/search`
- Pull canonical CRM data (contacts, opportunities, conversations, revenue) from each sub-account
- Receive near-real-time webhook events for lead / opportunity / conversation / payment changes
- Never write to GHL in v1 — **strictly read-only**

The app is **not** a GHL extension. It does not add Custom Pages, Workflows, Payment Providers, or any in-GHL UI. It is a pure external data-consumer that stores data in Synthetos' own database for health scoring, anomaly detection, and portfolio reporting.

For the broader product context see `docs/clientpulse-ghl-dev-brief.md`.

---

## 2. Prerequisites

Before starting:

- **A GHL developer account** at `marketplace.gohighlevel.com/app-dashboard`. Free. Sign up with a valid email. (The exact URL has shifted over the years; this was correct as of 2026-04-12.)
- **The Synthetos brand name and domain** (`synthetos.ai`) live and resolving — even as a placeholder landing page. The website field will fail validation if the URL is unreachable or contains HighLevel references.
- **A logo file** — PNG, SVG, JPEG, JPG, or GIF. Minimum 400×400, maximum 800×800 pixels. Maximum 500KB file size. Aspect ratio 1:1 (square). See Appendix C for a prompt you can feed to an AI image generator to produce candidates.
- **Access to the Synthetos codebase** — because the OAuth redirect path and webhook path you register in GHL must match the Express routes in the codebase, updates to both sides need to happen in lockstep.

---

## 3. Create App dialog

From the App Dashboard, click **+ Create App**. Fill in the modal:

| Field | Value | Notes |
|---|---|---|
| **App Name** | `ClientPulse by Synthetos` | Anchors the parent brand in the name itself so the tagline can focus on value |
| **App Type** | **Private** | Public requires marketplace review. Private lets us ship without approval but caps at **5 active external agencies** (see Section 13). Flip to Public only when ready for marketplace review. |
| **Target user** | **Agency** | NOT "Sub-Account". Agency-type apps install once at agency level and access all sub-accounts via a single OAuth install — critical for ClientPulse. Sub-Account-type apps would force per-client installation and ruin the onboarding UX. |
| **Listing Type** | **White-label (Recommended)** | Makes the app installable from both the official HighLevel marketplace AND white-label agency marketplaces. A huge chunk of GHL agencies run in SaaS Mode / white-label — Standard would hide the app from them. Functionally identical, distribution-wise different. |

Click **Create App**. You'll land in the app builder with the left sidebar showing **Profile / Pricing / Modules / Advanced Settings**.

### Key constraint surfaced on this dialog — 5-agency cap on Private apps

Per the warning shown directly in the Create App modal when Private is selected:

> *Private is for small pilots. If your app is active in more than 5 external agencies, new installs are blocked until you publish.*

This is enforced by GHL and has direct impact on your soft-launch plan — see Section 13 for the ramp strategy.

---

## 4. Profile → Basic Info

Click **Profile → Basic Info** in the sidebar. This is the public-facing listing metadata.

### Category

**Analytics & data** — the closest fit. ClientPulse is a monitoring / reporting tool, not a CRM extension, not a marketing tool, not an e-commerce integration.

### Tagline

**Recommended:** `Weekly client health reports and churn-risk alerts, powered by AI`

Rationale:
- Leads with what the customer *gets* (reports, alerts), not abstract features
- Concrete target audience implied (customers with multiple clients to monitor)
- No HighLevel / GoHighLevel references (required for white-label approval)
- ~65 characters — fits cleanly in marketplace card layouts without truncation

Alternatives, ranked:

1. `AI-powered client health monitoring and portfolio reports for multi-client agencies` (~85 chars — more descriptive, explicitly names the audience)
2. `Monitor every client 24/7. Get weekly health reports. Catch churn early.` (~72 chars — punchier, three-clause structure, slightly more sales-y)
3. `Know which clients are at risk before they tell you.` (~52 chars — pain-led, less category-descriptive)

**Do NOT** reference HighLevel, GoHighLevel, or LeadConnector anywhere in the tagline. It's rejected by the validator and violates the white-label compliance rule.

### Business Niche

Pick the closest match to **Marketing Agency** or **Agency**. Fallback in priority order:

1. Marketing Agency
2. Agency
3. Consulting / Business Consulting
4. Business Services
5. SaaS / Software

The niche should describe *who your customer is* (the agency buying ClientPulse), not *what kind of data you analyse*. When in doubt, pick the option that best matches "agencies managing multiple clients."

### Company

`Synthetos`

Use the full registered legal entity name if you have one (e.g. `Synthetos Pty Ltd`). Otherwise, the trading name is fine. GHL's review team may cross-check this against the website footer and contact information, so keep it consistent across all surfaces.

### Website

**Recommended:** `https://synthetos.ai/clientpulse` (or `https://synthetos.ai` if the `/clientpulse` subpage isn't live yet)

**CRITICAL compliance rule** — quoted verbatim from the field's own warning text:

> *Website guidelines for white-label friendly apps: Avoid Highlevel or Gohighlevel references to ensure approval.*

This applies to two things:

1. **The URL itself** — must not contain `highlevel`, `gohighlevel`, `hl`, or `leadconnector`. The `synthetos.ai` domain is clean.
2. **The landing page content at that URL** — when GHL's review team or white-label agencies visit the page, it must not prominently use the HighLevel brand as marketing language:
   - ❌ "ClientPulse monitors your Go High Level sub-accounts..."
   - ✅ "ClientPulse monitors every client in your agency's CRM platform..."
   - ✅ "Designed for agencies managing multiple clients on a centralised platform."

Inside the authenticated Synthetos app (after the customer has installed), you can use GHL's brand names freely. The restriction is specifically on the public marketing surface and the marketplace metadata.

### Logo

Required. Technical specs:
- Format: PNG, SVG, JPEG, JPG, or GIF
- Aspect ratio: 1:1 (square)
- Dimensions: minimum 400×400, maximum 800×800 pixels
- File size: maximum 500KB

See Appendix C for a detailed AI image generation prompt. Recommendation: generate the mark-only version first (no wordmark), then create a horizontal lockup with the wordmark separately.

---

## 5. Profile → Other sub-tabs

**[PENDING]** — not yet walked through. The left sidebar under Profile contains these sub-tabs:

- **Listing Configuration** — likely marketplace card metadata, category filters, tags
- **App Profiles** — likely the long-form description shown on the app detail page (screenshots, feature bullets, "what does it do")
- **Support Details** — support email, documentation URL, developer contact
- **Getting Started Guide** — onboarding instructions shown to users post-install

**When we return, recommended content for each:**

- **Listing Configuration:** confirm Analytics & data category. Add tags for `reporting`, `monitoring`, `health-score`, `churn-prediction`, `agency-tools`, `portfolio-management`.
- **App Profiles:** long-form description covering health monitoring, portfolio reports, churn risk detection. Include screenshots of the Synthetos Dashboard and a sample report once they exist. Be sure all copy respects the "no HighLevel references" rule from Section 12.
- **Support Details:** `support@synthetos.ai`, link to future support docs at `https://synthetos.ai/support` or similar.
- **Getting Started Guide:** short walkthrough — "Click Install → approve scopes → you'll be redirected to Synthetos to select which clients to monitor → first report in ~5 minutes."

---

## 6. Advanced Settings → Auth (OAuth + Redirect URLs)

Click **Advanced Settings → Auth** in the left sidebar.

### Redirect URLs

Click into the **Redirect URLs** section. You must add at least one URL before the app can be saved / published.

**Recommended:** `https://app.synthetos.ai/oauth/callback`

Rationale:
- Standard OAuth 2.0 pattern
- Generic path — future connectors (Google Ads, Meta, HubSpot, Stripe) can all share the same callback URL, disambiguated via the OAuth `state` parameter
- No brand references — passes GHL's validator

**GHL's validator will reject any URL containing `ghl`, `gohighlevel`, `highlevel`, `hl`, or `leadconnector`.** Stick to generic paths: `/oauth/callback`, `/integrations/connect/callback`, `/integrations/crm/callback`.

If rejected, you'll see the exact error:
> *The redirect uri contains a Highlevel reference. Please remove any Highlevel references to save.*

### Scopes declaration

**[PENDING — INCOMPLETE INVESTIGATION]** The scope configuration screen was not located during our initial walkthrough. The **Modules** sidebar section contains only GHL-extension module types (Conversation AI, Custom JS, Custom Page, Conversation Providers, Payment Providers, Widgets, Workflows, Snapshots, Voice AI) — none of which apply to ClientPulse as a pure external data-consumer.

**Most likely locations for scope declaration**, in priority order:

1. **Advanced Settings → Auth** — below the Redirect URLs section on the same page. Scroll to the bottom; the scope picker may be there.
2. **Advanced Settings → External Authentication** — untested, but the name suggests OAuth-related config.
3. **Profile → Listing Configuration** — GHL sometimes bundles scope declarations as listing metadata.
4. **Top-level app settings** — there may be a main app configuration screen accessible via a gear icon or the app name at the top.

**Action when resuming:** find the scopes screen, update this section with the exact navigation path, then declare the scopes from Appendix A.

### Why scopes matter for the rest of the setup

Webhook events on the next screen are **strictly gated by scopes**. You cannot enable a `ContactCreate` webhook toggle until `contacts.readonly` is declared. If you visit the Webhooks screen before declaring scopes, every toggle is greyed out — the "Scope Required" column shows you what's missing, but doesn't tell you where to go to fix it. That's the dependency loop we hit on first walkthrough.

---

## 7. Advanced Settings → Webhooks

Click **Advanced Settings → Webhooks** in the left sidebar.

### Default Webhook URL

**Recommended:** `https://app.synthetos.ai/webhooks/ingest`

Same rules as redirect URLs:
- No `ghl`, `gohighlevel`, `highlevel`, `hl`, or `leadconnector` in the path
- Must be publicly routable HTTPS
- Generic naming so future connectors can share the endpoint family (optionally sub-pathed as `/webhooks/ingest/:connector`)

Leave all **Custom Webhook URL** fields blank on individual events. The default URL catches everything, matching how `server/routes/webhooks/ghlWebhook.ts` is designed — one endpoint, one handler, simpler ops.

### Enabling events

The event list is a table with toggle switches per event. Each row shows a **Scope Required** column.

**If all toggles are greyed out**, it's because no scopes have been declared for the app yet. Return to Section 6 and declare the scopes from Appendix A first. Webhook events are strictly downstream of scopes.

See **Appendix B** for the full list of events to enable and events to explicitly leave off.

**Save button constraint:** the Save button on this screen requires at least one webhook event enabled. If you can't enable any (because no scopes), you're in a dependency loop — don't try to save this screen; instead navigate away without saving, resolve scopes first, then come back.

### Webhook signing secret

GHL signs webhook deliveries with HMAC-SHA256 using a shared secret. The secret is generated by GHL — copy it into the Synthetos environment as `GHL_APP_WEBHOOK_SECRET`. The existing handler in `server/routes/webhooks/ghlWebhook.ts` uses this secret via `ghlAdapter.webhook.verifySignature()` to verify every inbound delivery.

---

## 8. Advanced Settings → External Authentication

**[PENDING]** — not yet explored. Based on the section name, it likely configures how external systems authenticate *to* your app rather than how your app authenticates to GHL. Probably not relevant for ClientPulse v1.

**Action when resuming:** open the section, screenshot it, update this entry with what's actually there. If scopes turn out to live here (see Section 6's scope investigation), this section becomes the primary place to configure OAuth permissions.

---

## 9. Modules section (GHL's concept)

The **Modules** section in the app builder is for apps that **extend GHL's own UI or functionality from inside**. The module types offered are:

- Conversation AI
- Custom JS
- Custom Page
- Conversation Providers
- Payment Providers
- Widgets
- Workflows
- Snapshots
- Voice AI

**None of these apply to ClientPulse.** ClientPulse is a pure external data-consumer — it doesn't add a page inside GHL, doesn't provide payment, doesn't hook into workflows, doesn't provide voice AI. It only reads data via OAuth and stores it in Synthetos' own database.

### ⚠️ Terminology collision warning

"**Modules**" in GHL's app builder means something entirely different from "**modules**" in the Synthetos architecture. Keep them separate:

| Term | Context | Meaning |
|---|---|---|
| GHL **Modules** | Inside GHL app builder | In-GHL UI extensions (pages, widgets, workflows, etc.) |
| Synthetos **modules** | Inside Synthetos architecture | Subscription entitlement units (`client_pulse`, `full_access`) |

Same word, entirely different concepts. When inside GHL's app builder, "modules" = in-GHL extensions. When inside the Synthetos codebase or ClientPulse brief, "modules" = subscription entitlements.

**Action:** skip the Modules section entirely during GHL app creation. Do not create any module types for ClientPulse. The entire section is irrelevant to our use case.

---

## 10. Pricing

**[NOT STARTED]** — we haven't walked through the Pricing section yet.

For a Private-type app, pricing in the GHL Marketplace is generally optional — customers install via direct link and billing is handled by Synthetos' own Stripe integration (see `docs/clientpulse-ghl-dev-brief.md` Module G). GHL's Pricing section is primarily relevant for public marketplace listings that bill through GHL's own billing system.

**Recommendation for now:** leave Pricing blank or mark as "external billing" if such an option exists. ClientPulse bills via Stripe directly, not via GHL.

**Action when resuming:** verify whether Private apps can skip Pricing entirely, or whether GHL requires a nominal value even for privately-distributed, externally-billed apps. Screenshot the Pricing screen and update this section.

---

## 11. Codebase changes required to match registered URLs

Whatever URLs you register in GHL's app builder, the Express routes in the Synthetos codebase must serve those exact paths. Register first, then update the code — or vice versa — but keep them in lockstep.

### OAuth callback route

- **Registered in GHL as:** `https://app.synthetos.ai/oauth/callback`
- **Codebase change needed:** create or rename a route at `/oauth/callback` that handles OAuth code-for-token exchange. Dispatch to the right adapter (starting with `ghlAdapter`) based on the OAuth `state` parameter, so future connectors can share the endpoint.
- **Current state:** the codebase likely still has `/integrations/ghl/callback` or similar. Needs to be renamed to `/oauth/callback` with state-based dispatch.

### Webhook ingestion route

- **Registered in GHL as:** `https://app.synthetos.ai/webhooks/ingest`
- **Codebase change needed:** rename the mount path in `server/index.ts` where `ghlWebhook.ts` is mounted. The internal filename (`ghlWebhook.ts`) can stay — GHL never sees internal filenames — but the registered Express path must match what's entered in GHL's Webhook URL field.
- **Current state:** `server/routes/webhooks/ghlWebhook.ts` exists and handles HMAC verification + event normalisation via `ghlAdapter.webhook`. Only the mount path needs to change.

### Environment variables to set

| Variable | Source | Purpose |
|---|---|---|
| `GHL_APP_CLIENT_ID` | GHL app builder (top of app settings) | OAuth client identifier |
| `GHL_APP_CLIENT_SECRET` | GHL app builder (top of app settings) | OAuth client secret — treat as sensitive, never commit |
| `GHL_APP_WEBHOOK_SECRET` | GHL app builder (Webhooks section) | HMAC signing secret for webhook verification |
| `GHL_APP_REDIRECT_URI` | Hardcoded to match registered URL | `https://app.synthetos.ai/oauth/callback` |

Update `server/config/env.ts` to read these if not already wired.

---

## 12. Compliance rules — the "no HighLevel references" constraint

This rule is enforced in multiple places in GHL's app builder (redirect URL validator, webhook URL validator, website field warning), and it's more than a nuisance — it's a **white-label approval requirement**. Agencies running in white-label / SaaS Mode present a rebranded version of GHL to their own clients, where the HighLevel brand is hidden. If your app's public surfaces reference HighLevel, those agencies can't safely install it because their clients would see references to a brand their agency is trying to obscure.

### The rule

Do NOT use the strings `highlevel`, `gohighlevel`, `hl`, or `leadconnector` in any of:

- App name
- Tagline
- Business Niche (if free-text)
- Company name
- Website URL
- Redirect URLs
- Webhook URLs
- Public-facing landing page content at the registered website
- Marketing copy in Listing Configuration / App Profile
- Screenshot captions
- Getting Started Guide copy

### Where these strings ARE permitted

- Inside the authenticated Synthetos app (after the customer has installed) — the back office UI
- Internal documentation (including this doc)
- Code comments, variable names, file names, internal adapter names (GHL has zero visibility into your codebase)
- Private support docs not publicly linked from the marketplace listing
- Internal issue trackers, slack, etc.

The review team only sees the public-facing surface. Anything behind the Synthetos login can use GHL brand names freely.

### Practical phrasing patterns

When you need to describe the integration without using brand names, use generic language:

- ❌ "monitors your Go High Level sub-accounts"
- ✅ "monitors every client in your agency's CRM platform"
- ✅ "connects to your agency's centralised client platform"
- ✅ "designed for agencies managing multiple client accounts on a single CRM"
- ✅ "integrates with your existing agency software"

---

## 13. Private app limits and marketplace submission path

### The 5-agency cap

Per the warning shown directly on the Create App modal when Private is selected:

> *Private is for small pilots. If your app is active in more than 5 external agencies, new installs are blocked until you publish.*

What this means in practice:

- The cap is on **active external agencies** — not sub-accounts, and likely not on installs on your own developer agency account
- Agencies that uninstall free up slots
- There's no cap on the number of sub-accounts per agency — one agency with 200 sub-accounts still counts as 1 active agency
- Hitting the cap blocks **new** installs; existing installs continue working

### The ramp plan

| Phase | Action | External agency count |
|---|---|---|
| 0 | Install the app on your own test agency. Verify OAuth flow + data pull end-to-end. | 0 external (internal only) |
| 1 | Closed beta with 3–5 design-partner agencies on the private app | 3–5 |
| 2 | Submit for marketplace review (in parallel with closed beta — do not wait) | Still 3–5 |
| 3 | Marketplace approval lands → flip to Public → scale past 5 | Unlimited |

**Submission timing is critical:** start the marketplace review process **before** you hit the 5-cap, not after. Review timelines are non-trivial and unknown, so front-load the submission so approval arrives when you're actually ready to scale, not after you've been blocked.

### What marketplace submission involves

**[PENDING — DETAIL WHEN WE REACH THIS STEP]** — we haven't submitted yet, but based on general marketplace review patterns, expect GHL to want:

- Complete Listing Configuration (description, screenshots, feature bullets)
- Complete Support Details (support email, docs URL)
- Complete Getting Started Guide
- Demo video or detailed walkthrough showing the install and first-use flow
- Privacy policy URL (public-facing)
- Terms of service URL (public-facing)
- Confirmation that the scope list is minimal and justified
- Confirmation that the app doesn't violate white-label or compliance rules
- Possibly a review call with GHL's partnership team

Build all of this **before** you hit 5 active agencies, ideally before you hit 3, so that submission happens with no scrambling.

---

## 14. Known ambiguities — things to resolve when returning

Flagged during the initial walkthrough, need resolution on the next session:

1. **Scopes screen location.** Not found in Modules (those are in-GHL UI extension types, not OAuth scopes). Most likely in **Advanced Settings → Auth** below the Redirect URLs section — scroll the entire screen. If not there, try **External Authentication** or **Profile → Listing Configuration**. Update Section 6 with the exact path once found.

2. **Webhook event dependency on scopes.** Confirmed behaviour: events are greyed out until their required scope is declared, and the Save button requires at least one event enabled — causing a dependency loop if you try to configure Webhooks before Scopes. Always do scopes first, then come back to Webhooks.

3. **Direct agency token vs location-token exchange.** The existing `server/adapters/ghlAdapter.ts` assumes the agency-level OAuth token can directly call per-location endpoints with `locationId` as a query parameter. Whether this works for every endpoint in the current GHL API version is unverified. **Verify by installing against a real GHL agency with 3–5 sub-accounts** and calling `fetchContacts`, `fetchOpportunities`, `fetchConversations`, `fetchRevenue`. If any fail, add a `getLocationToken(connection, locationId)` helper that POSTs to `/oauth/locationToken` with the agency token and caches per-location tokens.

4. **Pricing section for private apps.** Unknown whether GHL requires a non-empty Pricing configuration for private-mode apps, or whether it can be left blank. Verify on next session.

5. **Internal vs external agency count against the 5-cap.** Unclear whether installs on the developer's own agency (the one the app was created in) count against the 5 active external agencies limit. Test by installing on own agency first and seeing if the count increments.

6. **External Authentication section purpose.** Unexplored. Screenshot when we return; could contain scope configuration (primary possibility) or unrelated external-callback auth config (secondary possibility).

7. **Listing Configuration, App Profiles, Support Details, Getting Started Guide sub-tabs under Profile.** Not yet filled in. Low priority until approaching marketplace submission, but worth drafting the content in advance so it's ready to paste when the time comes.

8. **Exact private-install URL format.** The approximate pattern is:
   ```
   https://marketplace.gohighlevel.com/oauth/chooselocation
     ?response_type=code
     &client_id={CLIENT_ID}
     &redirect_uri={REDIRECT_URI}
     &scope={space-separated scopes}
   ```
   Verify the exact format in GHL's developer documentation once the app has a Client ID. There may be additional required parameters.

9. **Webhook event naming variations.** Some GHL documentation uses `OpportunityStageUpdate` and `OpportunityStatusUpdate` as separate events; other versions may use `OpportunityUpdate` as a combined event. Enable whatever shows up in the UI that matches the semantics — the existing `ghlAdapter.ts` `mapGhlEventType` function (see `server/adapters/ghlAdapter.ts:308`) handles the canonical names and silently drops anything unrecognised.

10. **Install lifecycle event names.** The INSTALL / UNINSTALL event names may appear as `AppInstall` / `AppUninstall` or similar in the webhook list. Enable whatever the UI calls them — these are critical for knowing when agencies come and go.

---

## 15. Appendix A — OAuth scopes for ClientPulse v1

Seven scopes, all read-only. Declare these in whichever screen GHL's app builder exposes scope configuration (pending investigation per Section 6).

| Scope | Purpose |
|---|---|
| `locations.readonly` | List sub-accounts under the agency at install time via `/locations/search`. Required for the enumeration step after OAuth. |
| `contacts.readonly` | Read contact records + enable `ContactCreate` / `ContactUpdate` / `ContactDelete` webhooks. Drives lead volume and contact growth metrics. |
| `opportunities.readonly` | Read opportunity / deal records + enable `OpportunityCreate` / `OpportunityStageUpdate` / `OpportunityStatusUpdate` / `OpportunityDelete` webhooks. Drives pipeline velocity and stale deal detection. |
| `conversations.readonly` | Read conversation metadata + enable `ConversationCreated` / `ConversationUpdated` / `ConversationInactive` webhooks. Drives engagement metrics. |
| `conversations/message.readonly` | Read message-level details inside conversations. Some GHL plans require this as a separate scope. |
| `payments/orders.readonly` | Read payment order records + enable `InvoiceCreated` / `PaymentReceived` webhooks. Drives revenue trend metric. Degrades gracefully if the agency's plan doesn't expose `/payments/orders`. |
| `businesses.readonly` | Read business metadata per sub-account (name, timezone, address). Used for labeling clients in reports. |

### Do NOT request

- Any `.write` scopes — ClientPulse v1 is strictly read-only
- `calendars.readonly` / `calendars/events.readonly` — appointments are not scored in v1
- `associations.readonly` — internal GHL contact-to-entity relationships, not useful for health scoring
- `campaigns.readonly` / `forms.readonly` / `surveys.readonly` — noise for v1
- `users.readonly` — not needed
- `medias.readonly` / `files.readonly` — not needed

### Why lean scope lists matter

1. **Consent screen trust.** Agencies see the scope list when they install. Over-requesting feels invasive and damages trust — even if the extra scopes are "just in case for future features."
2. **Review velocity.** When you eventually submit for marketplace approval, lean scope lists clear review faster. Each additional scope is something the reviewer has to justify.
3. **Security blast radius.** Every scope is something a compromised Synthetos deployment could abuse. Read-only + minimum-necessary is the correct security posture.

---

## 16. Appendix B — Webhook events to enable

Enable these on the Webhooks screen once scopes are declared. All events flow to the default URL (`https://app.synthetos.ai/webhooks/ingest`) — leave all Custom Webhook URL fields blank.

### Contact lifecycle (requires `contacts.readonly`)

- `ContactCreate` — new lead captured, drives lead volume metric
- `ContactUpdate` — stage / tag changes, drives freshness signal
- `ContactDelete` — keeps counts accurate

### Opportunity lifecycle (requires `opportunities.readonly`)

- `OpportunityCreate` — new deal, drives pipeline volume
- `OpportunityStageUpdate` — stage transitions, drives pipeline velocity
- `OpportunityStatusUpdate` — status changes (won / lost / abandoned), drives close-rate metric
- `OpportunityDelete` — if present, keeps counts accurate

### Conversation lifecycle (requires `conversations.readonly`)

- `ConversationCreated` — drives engagement metric
- `ConversationUpdated` — message activity, drives response-time metric
- `ConversationInactive` — disengagement signal, if present in the UI

### Revenue / Payment (requires `payments/orders.readonly`)

- `InvoiceCreated` — drives revenue trend, may not fire on all GHL plans
- `PaymentReceived` — or whichever payment-completion event appears in the UI
- `InvoicePaid` — if present

### App lifecycle (CRITICAL — no scope typically required)

- `INSTALL` — fired when an agency installs the app. Triggers initial `/locations/search` + canonical-account creation + first-sync job. **Do not skip this one.**
- `UNINSTALL` — fired when an agency removes the app. Triggers cleanup of stored tokens, disabling of scheduled runs, marking of `integration_connections` as disconnected. **Also critical.**

### Location / sub-account lifecycle (if present)

- `LocationCreate` — new sub-account added to an existing installed agency. Triggers creation of a new `canonical_accounts` row and starts monitoring it immediately, without waiting for the next scheduled re-enumeration.
- `LocationUpdate` — sub-account metadata changed (rename, timezone change).

### Leave DISABLED — noise, not needed for v1

- All `Appointment*` events (AppointmentCreate / AppointmentUpdate / AppointmentDelete) — calendar data not scored in v1
- All `Association*` events (AssociationCreate / AssociationUpdate / AssociationDelete) — internal GHL relationships, not useful for health
- All `Campaign*` events — too noisy
- All `Form*` / `Survey*` events — not scored in v1
- All `Note*` / `Tag*` events — internal CRM noise
- All `Call*` / `Voicemail*` events — not scored in v1
- Anything you don't recognise — default OFF. You can always enable later once the scoring logic uses it.

The existing `ghlAdapter.ts` `mapGhlEventType` function (`server/adapters/ghlAdapter.ts:308`) recognises the critical events and silently drops anything unrecognised, so enabling extra events won't crash anything — but it adds log noise and consumes inbound rate-limit budget, so stick to the minimum list.

---

## 17. Appendix C — Logo prompt for AI image generation

Paste the following into ChatGPT, Claude, Midjourney, DALL·E, or any comparable image generation model to produce logo candidates for Synthetos.

### Primary prompt

```
Create a modern, minimalist logo for a technology company called
"Synthetos.ai". Synthetos is an AI operating system platform — it
orchestrates a team of AI agents that work together to run business
operations. The name comes from "synthesis" (composition, bringing
parts together into a whole) with a classical Greek feel.

Style requirements:
- Clean, geometric, minimalist — suitable for a SaaS product
- Must work as a square app icon (1:1 aspect ratio, 400x400 to 800x800)
- Must be recognizable at small sizes (favicon, marketplace thumbnail)
- Professional and trustworthy, not playful or cartoonish
- Feels modern and AI-forward without being cliche
  (no circuit-board patterns, no brain icons, no robot faces)

Concept direction: an abstract geometric mark suggesting "synthesis"
or "orchestration" — for example, multiple distinct shapes converging
into a unified whole, nested or interlocking forms, or a stylized
letter "S" constructed from geometric segments that come together.
The mark should feel like something is being composed or built from
parts.

Color palette: deep navy or near-black background, with a single
accent color — either electric blue, deep violet, or teal. Limit to
two colors total for versatility.

Deliverables:
1. The primary square icon mark (no text) — this is the priority
2. A horizontal lockup with "Synthetos" wordmark next to the icon,
   in a clean sans-serif like Inter, Geist, or similar
3. Both light-background and dark-background variants

Avoid: gradients, glows, 3D effects, drop shadows, any mention of
"AI" in the mark itself, human figures, clocks, gears.
```

### Alternative concept directions

Swap the "Concept direction" paragraph in the primary prompt with any of these:

**Option B — constellation:**
> An abstract constellation or network diagram: a small number of nodes (3–5) connected by clean lines, arranged in a balanced geometric pattern. One node larger or differently-coloured, suggesting an orchestrator agent coordinating the others. Feels like a star chart or a distributed system diagram.

**Option C — nested orchestrator:**
> Nested or concentric geometric shapes — a large outer form containing smaller aligned forms, suggesting hierarchy and coordination. Could be hexagons, circles, or abstract polygons. Feels like something at the centre directing what's around it.

**Option D — pulse:**
> A stylized "S" where the letterform contains or becomes a clean abstract waveform or pulse. Ties subtly to the ClientPulse product line. Subtle and geometric, not literal.

### Iteration tips

- **Ask for the mark without text first.** Wordmarks at small sizes get unreadable fast. Lock in the geometry, then add typography in a separate pass.
- **When close but not right, ask for 4 variations** of the specific mark the model produced, varying only geometry. Faster than regenerating from scratch.
- **Ignore colour in the first pass.** Get the shape right first, then recolour the winner.
- **Export at 1024×1024 minimum.** GHL requires 400×400 to 800×800, so starting larger gives cleaner downscales. Save the original high-res for future uses (website hero, favicon, social OG images, etc.).
- **Test at small sizes before committing.** View the mark at 32×32 pixels — if it's unrecognisable, simplify further. Marketplace thumbnails and favicons are merciless on detail.

---

## Change log

**2026-04-12 — Initial capture.** Covers: Create App dialog (name, type, target user, listing type), Profile → Basic Info (category, tagline, business niche, company, website, logo), Advanced Settings → Auth (Redirect URLs only — scope location still under investigation), Advanced Settings → Webhooks (default URL rule + discovery of the scope-gating dependency loop), Modules section (determined not applicable to external data-consumer apps), compliance rules around HighLevel references, the 5-agency Private cap, codebase route-matching requirements, full OAuth scope list for ClientPulse v1, full webhook event list, logo prompt with four concept directions.

**Not yet covered** — return in a future session:
- Exact location of the OAuth scopes declaration screen (likely Advanced Settings → Auth below the Redirect URLs box)
- Advanced Settings → External Authentication section purpose
- Profile → Listing Configuration, App Profiles, Support Details, Getting Started Guide sub-tabs
- Pricing section (whether private apps require any pricing config)
- End-to-end verification against a real GHL agency account
- Direct-token vs location-token exchange behaviour on `/contacts`, `/opportunities`, `/conversations` endpoints
- Exact private-install URL format (verify once the app has a Client ID)
- Marketplace submission checklist and review process

