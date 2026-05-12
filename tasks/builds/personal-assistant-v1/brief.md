**Status:** DRAFT (2026-05-12) — awaiting operator sign-off before spec authoring
**Date:** 2026-05-12
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** `personal-assistant-v1`
**Successor placeholder:** `tasks/builds/personal-assistant-v2-operator/brief.md` (V2 upgrade — Operator Controller, depends on Spec D)
**Locked predecessor:** `tasks/builds/user-owned-agents/brief.md` (foundation spec — `agents.owner_user_id` column + owner-aware credential broker + admin redaction policy; EA V1 is the first consumer)
**Concurrent with:** Spec D `tasks/builds/operator-backend/brief.md` (no file overlap; V2 depends on Spec D, V1 does not)
**Strategic parent:** `docs/synthetos-governed-agentic-os-brief-v1.2.md` §16.1 (Executive Assistant use case), §6.3 (Native Controller), §17 (use-case coverage matrix)

# Personal Assistant V1 — Build Brief

## Contents

- [0. Naming decision (read first)](#0-naming-decision-read-first)
- [0.5 Strategic framing + decision rationale (read second)](#05-strategic-framing--decision-rationale-read-second)
- [1. Purpose](#1-purpose)
- [2. What's locked from upstream](#2-whats-locked-from-upstream)
- [3. What this spec must define](#3-what-this-spec-must-define)
  - [3.1 Google Calendar OAuth integration](#31-google-calendar-oauth-integration)
  - [3.2 Google Calendar actions](#32-google-calendar-actions)
  - [3.3 Slack agent actions](#33-slack-agent-actions)
  - [3.4 Executive Assistant system-agent definition](#34-executive-assistant-system-agent-definition)
  - [3.5 Default skill bundle for the EA](#35-default-skill-bundle-for-the-ea)
  - [3.6 Trigger layer for "always-on" behaviour](#36-trigger-layer-for-always-on-behaviour)
  - [3.7 Use-case shortlist for V1](#37-use-case-shortlist-for-v1)
  - [3.8 Connection UI surfacing](#38-connection-ui-surfacing)
  - [3.9 Notification + delivery surfaces](#39-notification--delivery-surfaces)
  - [3.10 Multi-user consumption (consumes `user-owned-agents`)](#310-multi-user-consumption-consumes-user-owned-agents)
  - [3.11 Voice Profile primitive (introduced by EA V1, designed for reuse)](#311-voice-profile-primitive-introduced-by-ea-v1-designed-for-reuse)
  - [3.12 First-run setup context attachment](#312-first-run-setup-context-attachment)
  - [3.13 Personal nav group in sidebar + home Personal zone (both data-driven)](#313-personal-nav-group-in-sidebar--home-personal-zone-both-data-driven)
  - [3.14 EA provisioning (explicit consent, not automatic)](#314-ea-provisioning-explicit-consent-not-automatic)
  - [3.15 Spending budgets (pooled to subaccount)](#315-spending-budgets-pooled-to-subaccount)
  - [3.16 Connection card "Personal" chip labelling](#316-connection-card-personal-chip-labelling)
  - [3.17 Display name customisation](#317-display-name-customisation)
  - [3.18 Capability grouping for the connection UI](#318-capability-grouping-for-the-connection-ui)
  - [3.19 Live-fetch vs canonical data decision](#319-live-fetch-vs-canonical-data-decision)
  - [3.20 Home-widget contribution contract (introduced by EA V1, designed for reuse)](#320-home-widget-contribution-contract-introduced-by-ea-v1-designed-for-reuse)
  - [3.21 Failure modes for triggered runs](#321-failure-modes-for-triggered-runs)
- [4. Open architectural questions (for operator ratification)](#4-open-architectural-questions-for-operator-ratification)
- [5. Out of scope (explicit non-goals)](#5-out-of-scope-explicit-non-goals)
- [6. What unblocks when this ships](#6-what-unblocks-when-this-ships)
- [7. Sequencing](#7-sequencing)

## 0. Naming decision (read first)

The v1.2 master brief uses **"Executive Assistant"** as the canonical agent name for the standing personal-and-business-assistant role (master brief §16.1). The slug `personal-assistant-v1` in this build directory refers to the **build effort**, not the agent name. Inside the product:

| Surface | Canonical |
|---|---|
| Agent slug in `server/config/c.ts` | `executive-assistant` |
| Display name (system agent template default) | `Executive Assistant` |
| Operator-facing UI label (configurable per subaccount) | `Personal Assistant` (default override) |
| Build directory + commit messages | `personal-assistant-v1` (build effort identifier) |

The agent role per master brief §5.1 is an **organisational entity** — "who owns this work" — not an execution concept. V1 ships the Executive Assistant agent restricted to `controllerStyle: 'native'`. V2 adds `controllerStyle: 'operator'` to the same agent (master brief §5.2 — one organisational agent, multiple controllers).

## 0.5 Strategic framing + decision rationale (read second)

This build is NOT primarily an Executive Assistant product. It is the **first consumer of the user-owned agents primitive** (`tasks/builds/user-owned-agents/brief.md`). The reviewer should evaluate this brief through that lens — EA V1 succeeds if the user-owned agents primitive is proven, not if the EA wins on personal-productivity features alone.

### 0.5.1 Why this distinction matters

A challenge round (2026-05-12) examined whether SynthetOS should build personal-assistant features at all when Claude / ChatGPT / Codex are absorbing that market with native Gmail / Calendar / Drive / Slack connectors. The conclusion: SynthetOS should NOT compete head-on as a generic personal-productivity assistant — that race goes to whoever has the best foundation model and the deepest connector library, and the rate of feature shipping there is faster than SynthetOS can match.

But there IS a SynthetOS-shaped use case: **agents that act under a specific user's identity inside the org's audit / policy / orchestration boundary**. That capability does not exist in Claude / ChatGPT / Codex (those are single-user productivity tools, not multi-tenant governed platforms). It is the strategic asset — and EA is the first proof.

### 0.5.2 Explicit non-goal

> V1 does not attempt to replace Claude, ChatGPT, Codex, Microsoft Copilot, or other general-purpose personal AI assistants. SynthetOS only owns the parts where individual-user automation must be governed, auditable, policy-controlled, connected to SynthetOS-native workflows, and aware of organisation/subaccount context.

This non-goal is binding on V1 scope decisions: features that look like "compete with Claude on personal productivity richness" should be cut; features that prove "governed user-owned agency works end-to-end inside SynthetOS" should ship.

### 0.5.3 Reuse acceptance criterion

The user-owned agents primitive is only worth the engineering investment if it earns its keep with at least one second consumer beyond EA. The build must satisfy the following:

> A stub second user-owned agent (e.g. a placeholder Dev Agent template) must be able to:
> - appear in the Personal nav group + home Personal zone
> - render a home-widget contribution via the same contract
> - open the same Workspace / Activity / Settings tabbed shell
> - resolve only the owning user's credentials via the broker
> - emit user-owned run activity scoped to the owner
> - expose admin metadata without private content
>
> All without EA-specific code branching.

The stub does not need to be a full second product — it can be a minimal template registration. The point is to prove the primitive is reusable, not to ship two agents in V1.

### 0.5.4 Tightened V1 scope (what this build will NOT do)

Per the challenge-round decision to constrain V1 to "prove the primitive, don't out-compete Claude":

| Feature | V1 posture |
|---|---|
| Read inbox / calendar / drive / slack | yes (live-fetch, no canonical mirror) |
| Drafts on outbound email | yes (review-gated, never auto-send to third parties) |
| Send email to operator's own inbox or self-DM on Slack | auto-allowed |
| Send email to third parties | always review-gated (Tier 6 sends require approval) |
| Slack post to channels / DMs to others | per the auto-send scope dropdown (default: only DMs to me auto, all else review) |
| Calendar reads | yes |
| Calendar writes (create / update events, respond to invites) | yes — **all review-gated** (Tier 3–4, mandatory approval). Aligned with existing workspace-adapter capability surface; risk control via review gates, not capability removal. |
| Calendar `delete_event` | **deferred** to V1.5 — destructive, not in workspace adapter today either |
| Google Drive writes (Docs / Sheets editing) | **deferred** — no V1 use case requires it; 3 dev-days real cost (Docs / Sheets batch-update APIs); workspace adapter doesn't have these capabilities today either, so deferral creates no inconsistency. V1.5 add when a real use case emerges. |
| Voice-profile derivation from sent mail | yes (default on with one-click opt-out) |
| Memory (user context blocks via `update_memory_block`) | yes (per-agent, not shared across agents) |
| Briefing schedule + meeting-prep triggers + inbox-poll triggers | yes |
| Autonomous "investigate this complex situation" multi-turn behaviour | NO — that's V2 (Operator Mode, depends on Spec D) |

This tightening is documented as ratification of the challenge-round decision, plus the later capability-alignment correction. The final V1 posture is not Calendar read-only: Calendar reads ship auto, Calendar `create_event` / `update_event` / `respond_to_invite` ship review-gated, and only destructive `delete_event` is deferred. This keeps the user-owned EA aligned with the existing `WorkspaceAdapter` capability surface while preserving safety through mandatory review gates on writes.

### 0.5.5 Decision provenance

Recorded in chat transcript on branch `claude/synthetos-personal-assistant-0kaIM` (2026-05-12):

1. **Schema simplification.** Move from `principal_type` / `principal_id` / `scope_type` abstraction to a single `agents.owner_user_id` column. Same strategic outcome, ~40% of the schema work. Detail: `tasks/builds/user-owned-agents/brief.md` §0.
2. **Strategic framing.** This build is foundation primitive proof, not EA product. Explicit non-goal vs Claude / Codex.
3. **Tightened V1 scope.** Third-party sends review-gated; auto-send only to self.
4. **Capability-alignment correction (later same day).** Restored Calendar write actions to V1 (`create_event`, `update_event`, `respond_to_invite`) after a capability audit found the existing `WorkspaceAdapter` contract already exposes these for subaccount-owned agents. Deferring on user-owned agents would have created an artificial capability regression. All restored actions are review-gated (Tier 3–4 with mandatory approval); only `delete_event` remains deferred. Drive writes (Docs / Sheets editing) explicitly considered and deferred — no V1 use case, ~3 dev-days real cost, no inconsistency with workspace adapter (which also lacks them).

Reviewer should read `tasks/builds/user-owned-agents/brief.md` §0 first to understand the foundation rationale, then this section, then the rest of this brief.

## 1. Purpose

Ship the first concrete personal-assistant agent — a standing Executive Assistant that runs in short deterministic bursts on schedules, webhooks, and platform events. After this lands, the customer-facing capability is:

> Connect Gmail, Calendar, Drive, and Slack. The Executive Assistant runs scheduled briefings, watches inbound email, prepares meeting context, and posts summaries — always-on via reliable triggering, no long-lived process.

V1 is the **personal dogfood** of the Executive Assistant use case (master brief §16.1). It does not productise the assistant for customers. It does not ship the operator-mode upgrade. Both come later.

This brief locks scope. The spec is authored next.

## 2. What's locked from upstream

| Capability | Source | Status |
|---|---|---|
| `controllerStyle` field on `agent_runs` (`native` / `operator`) | SynthetOS Phase 1 foundation refactor | merged #279 |
| Risk Tier 0–6 annotation across action registry + `verify-risk-tier-assigned` CI gate | Phase 1 foundation | merged #279 |
| Credential Broker facade (`CredentialBrokerService`) + sub-account scoped retrieval | Phase 1 foundation | merged #279 |
| Policy Envelope per-run snapshot (`agent_runs.policy_envelope_v1`) | Phase 1 foundation | merged #279 |
| Run Trace virtual view over 7 ledger tables | Phase 1 foundation | merged #279 |
| Gmail OAuth provider + `send_email` (Tier 6, review-gated) + `read_inbox` (Tier 2, auto) | `server/config/oauthProviders.ts`, `server/config/actionRegistry.ts` | shipped |
| Google Drive OAuth provider + read-only resolver | `server/config/oauthProviders.ts`, `server/services/resolvers/googleDriveResolver.ts` | shipped |
| Slack OAuth provider + outbound delivery (`channels:read`, `chat:write`, `chat:write.public`, `users:read`, `files:write`) | `server/config/oauthProviders.ts` | shipped (no agent-callable read actions yet) |
| Web actions (`web_search`, `fetch_url`, `scrape_url`, `scrape_structured`, `monitor_webpage`) | `server/config/actionRegistry.ts` | shipped |
| System-agent registry pattern (`SystemAgentEntry` in `server/config/c.ts`, mirrored from DB migration) | shipped (migration 0256) | shipped |
| Scheduled-task engine (RRULE-based, IANA-timezone aware) | `server/services/scheduledTaskService.ts` | shipped |
| Agent triggers engine (event types `task_created` / `task_moved` / `agent_completed`) | `server/services/triggerService.ts`, `server/db/schema/agentTriggers.ts` | shipped |
| Webhook ingestion pattern (per-org HMAC, replay nonces) | `server/routes/webhooks/` (GHL, Slack, Stripe, Teamwork) | shipped |
| HITL approval workflow + Slack-approval delivery channel | shipped | shipped |
| Three-tier agent model (System / Org / Subaccount) + hierarchical delegation | shipped | shipped |
| User-owned agents (`agents.owner_user_id` + owner-scoped credential broker + admin redaction policy) | `tasks/builds/user-owned-agents/brief.md` | LOCKED PREDECESSOR — must merge before EA V1 build starts |

Nothing on the foundation is in flux. V1 is a pure composer of existing primitives plus the user-owned agents primitive plus two new connector surfaces (Calendar OAuth + actions, Slack agent actions) plus one new trigger primitive (external-source triggers) plus the generic `VoiceProfile` primitive (introduced in this build, designed for reuse by future agents).

## 3. What this spec must define

### 3.1 Google Calendar OAuth integration

- New provider entry in `server/config/oauthProviders.ts` keyed `google_calendar`. Same shape as `gmail` and `google_drive`: `authUrl`, `tokenUrl`, scopes, `extra: { access_type: 'offline', prompt: 'consent' }` for refresh-token issuance.
- Default scopes — V1 spec picks final list, recommendation:
  - Read-only first decision (see §4 question 1): `https://www.googleapis.com/auth/calendar.readonly`, `https://www.googleapis.com/auth/calendar.events.readonly`
  - Read + write second decision: add `https://www.googleapis.com/auth/calendar.events` (write to user's primary + accepted calendars)
- Slug registered in `REQUIRED_INTEGRATION_SLUGS` and the `RequiredIntegrationSlug` type union in `server/config/actionRegistry.ts`.
- Appears in the existing Connections page (`client/src/pages/govern/ConnectionsPage.tsx`) with no new visual surface — same row pattern as Gmail / Drive / Slack.
- OAuth callback handler reuses `server/routes/oauthIntegrations.ts`. No new route surface required.
- Env var convention: `OAUTH_GOOGLE_CALENDAR_CLIENT_ID`, `OAUTH_GOOGLE_CALENDAR_CLIENT_SECRET` (matches existing pattern in `getProviderClientId`).

### 3.2 Google Calendar actions

**V1 ships read + review-gated write.** Earlier round 2 tightened this to read-only V1; a subsequent capability-alignment check (2026-05-12, after the workspace-adapter capability audit) restored write actions to V1 because the existing `WorkspaceAdapter` contract already exposes `createEvent` and `respondToEvent` for subaccount-owned agents with workspace identities. Deferring writes on user-owned agents would have created an artificial capability regression. The risk control (no autonomous writes to shared resources) is achieved via review-gating at the action tier, not by removing the capability.

Minimum action set for V1 in `server/config/actionRegistry.ts` (each with parameter Zod schema, `riskTier`, `defaultGateLevel`, `verify` or null-with-justification, `requiredIntegration: 'google_calendar'`, MCP annotations, retry policy):

| Action | Read/Write | Risk tier | Default gate | Verify shape |
|---|---|---|---|---|
| `list_events` | read | 2 | auto | `row_exists` (event id returned) |
| `get_event` | read | 2 | auto | `row_exists` |
| `find_free_slot` | read (compute over read) | 2 | auto | `api_status_2xx` |
| `create_event` | write | 4 | **review** | `row_exists` |
| `update_event` | write | 4 | **review** | `row_exists` |
| `respond_to_invite` | write | 3 | **review** | `api_status_2xx` |

Deferred to V1.5 follow-on (NOT in this build):

| Action | Read/Write | Risk tier | Reason for deferral |
|---|---|---|---|
| `delete_event` | write (destructive) | 5 | Irreversible; not currently in workspace adapter either; defer until V1 write patterns prove reliable. |

The deferred-write list is now MUCH shorter than round 2 — just `delete_event`. `create_event`, `update_event`, `respond_to_invite` are V1 with review gates, matching what subaccount-owned agents already do via the workspace adapter.

Risk-tier rationale per Phase 1 foundation refactor §4.2.3:
- Tier 2 — external API reads (no customer-facing side effect).
- Tier 4 — internal record changes that the user sees but no third party is messaged.
- Tier 5 — destructive write (irreversible).
- Tier 6 — client-messaging external sends; reserved for `send_email` on customer-bound mail. Internal calendar events to colleagues don't escalate to Tier 6 (judgement call — spec confirms).

`createsBoardTask: false` for all calendar actions. `isExternal: true`. `topics: ['calendar']` (new topic — add to `server/config/topicRegistry.ts`).

### 3.3 Slack agent actions

OAuth is already wired. The bot scopes today (`chat:write`, `channels:read`, `users:read`, `files:write`) cover most V1 read actions. Spec confirms whether additional scopes are needed for thread-history reads (`channels:history`, `groups:history`, `im:history`, `mpim:history`).

Minimum action set:

| Action | Read/Write | Recommended risk tier | Default gate | Notes |
|---|---|---|---|---|
| `slack.list_channels` | read | 2 | auto | Reuses `channels:read` |
| `slack.read_channel` | read | 2 | auto | Requires `channels:history` scope — spec confirms scope add |
| `slack.search_messages` | read | 2 | auto | May require Slack workspace scope `search:read` (paid plans only — spec flags) |
| `slack.summarise_thread` | read + LLM call | 2 | auto | Calls LLM via existing `llmRouter`, no extra scope |
| `slack.post_message` | write (channel) | 6 | review | Already supported via `chat:write` — promoted from "delivery channel" to first-class action |
| `slack.post_dm` | write (user DM) | 6 | review | Required scope `im:write` (spec adds) |

Risk-tier rationale: Slack messages are client/colleague-visible external sends. Tier 6 per the §4.2.3 max-tier rule for "client-messaging actions that land in a customer inbox/feed."

V1 spec confirms whether `slack.post_message` and `slack.post_dm` default to `review` or `auto` for the EA's own posts to the operator (self-directed delivery is arguably lower-risk than third-party messaging — see §4 question 2).

`topics: ['slack']` (new topic). `requiredIntegration: 'slack'`.

### 3.4 Executive Assistant system-agent definition

New entry in `server/config/c.ts` mirroring the established `SystemAgentEntry` pattern. The DB seed migration is authoritative (`migrations/0256_system_agents_human_names.sql` is the precedent — V1 ships a new migration adding the row).

Recommended shape:

```ts
{ slug: 'executive-assistant', name: 'Personal Assistant', agentRole: 'Specialist', executionScope: 'subaccount' }
```

V1 is single-subaccount dogfood; `executionScope: 'subaccount'` is the appropriate scope. The seed migration sets the default system prompt, default skill allowlist, default policy envelope, and risk-tier ceiling. Spec defines:

- **System prompt** — voice, escalation rules, when to ask vs act, default delivery target.
- **Default skill allowlist** — Gmail (`send_email`, `read_inbox`), Calendar (the V1 action set per §3.2), Slack (the V1 action set per §3.3), Drive (existing resolver), Web (`web_search`, `fetch_url`, `scrape_structured`), platform skills (`ask_clarifying_question`, `request_clarification`, `read_workspace`, `update_memory_block`, `notify_operator`).
- **`controllerStyle`** locked to `'native'` for V1. V2 adds `'operator'` as a second allowed style.
- **Risk-tier ceiling** — recommendation `5` (allows Tier 4 with review, allows Tier 5 with review, blocks Tier 6 sends entirely OR allows with mandatory review — see §4 question 3).
- **Default approval policy** — Tier 0–3 auto, Tier 4–5 review, Tier 6 review-required.
- **Capability map** — agent declares ability to operate Native Controller on API + Tool Environment only. No Browser, no Sandbox, no Operator Controller in V1.

### 3.5 Default skill bundle for the EA

The "what ships enabled out-of-the-box" set the spec must enumerate. Recommended starting set (spec confirms):

- **Email** — `read_inbox`, `send_email`
- **Calendar** — V1 action set per §3.2
- **Slack** — V1 action set per §3.3
- **Drive** — existing read-only resolver via `read_data_source` action
- **Web** — `web_search`, `fetch_url`, `scrape_structured`
- **Platform meta-skills** — `ask_clarifying_question`, `request_clarification`, `read_workspace`, `update_memory_block`, `notify_operator`, `read_priority_feed`, `search_agent_history`

Universal skills per `server/config/universalSkills.ts` are always available regardless of allowlist — the spec confirms this list is unchanged for V1.

### 3.6 Trigger layer for "always-on" behaviour

The EA's "always-on" feel comes from three trigger types firing short deterministic Native runs. The spec consolidates and extends the existing primitives:

**Type A — Scheduled triggers (RRULE / cron).** Reuses `server/services/scheduledTaskService.ts`. Each scheduled run produces an `agent_runs` row with `triggerContext: { source: 'schedule', scheduledTaskId, occurrenceAt }`. Spec confirms no schema change required — the existing engine already handles agent invocation. Examples: daily 07:00 briefing, weekly Friday 16:00 review.

**Type B — Webhook triggers from external connectors (NEW primitive).** Spec defines a new sub-type of agent trigger sourced from external HTTPS callbacks, not internal platform events. V1 must define:

- **Trigger event types added to the `agent_triggers.event_type` enum:** `gmail_message_received`, `calendar_event_imminent`, `slack_mention`. The current enum in `server/services/triggerService.ts` is `'task_created' | 'task_moved' | 'agent_completed'` — V1 extends it. Spec writes the migration.
- **Source-routing pattern.** The existing webhook routes (`server/routes/webhooks/*.ts`) parse the inbound payload and emit a typed internal event. V1 adds a `googleWebhook.ts` route handling Gmail push notifications + Calendar event reminders. The handler:
  1. Verifies the request signature / channel token per provider docs.
  2. Resolves the target subaccount via the integration connection's `vendor_account_id` field.
  3. Emits the typed event into `triggerService.fireTriggers(subaccountId, eventType, eventData)`.
- **Gmail push notifications vs polling.** Recommended path: **5-minute polling fallback** for V1 (simpler, no Pub/Sub topic provisioning), with a flag-gated push path (Gmail Watch API → Cloud Pub/Sub) for later (see §4 question 6). Polling uses the existing `recurringTasksService` pattern at the subaccount level — one `gmail_inbox_poll` recurring job per connected Gmail account.
- **Calendar event reminders.** Use Calendar push notifications channel (single endpoint, no Pub/Sub) keyed by the user's primary calendar — Calendar supports webhook channels natively without Pub/Sub. Default lookahead: fire `calendar_event_imminent` 15 minutes before the event start. Spec confirms lookahead value and whether multiple lookahead horizons are supported (e.g. 24 hours for next-day prep, 15 minutes for meeting prep).
- **Slack mentions.** Slack Events API webhook (`event_callback` with `app_mention` event type). Existing `server/routes/webhooks/slackWebhook.ts` is extended — current code handles approval-callback events only.

**Type C — Internal event-driven triggers (existing).** No change. The EA can subscribe to `task_created`, `task_moved`, `agent_completed` via the existing trigger pattern.

**Trigger uniformity contract:** every triggered run (A, B, or C) writes the same shape to `agent_runs.triggerContext` and produces a Run Trace event `trigger.fired` at run start. Failure to fire (rate-cap, missing agent, auth-expired credential) writes a typed `trigger.suppressed` Run Trace event with reason.

**Rate caps:** existing `MAX_TRIGGERED_RUNS_PER_MINUTE` (in `triggerService.ts`) applies. Spec confirms whether external-source triggers need a separate cap (Gmail can deliver hundreds of webhooks/minute during a burst; existing internal-event cap is `task_created`-tuned).

### 3.7 Use-case shortlist for V1

The spec picks **3 to 5** deterministic always-on workflows the EA reliably runs. Candidates ranked by leverage-vs-complexity for the operator (recommendation: ship 1, 2, 3, then add 4 / 5 if remaining budget):

1. **Daily briefing assembly** — 07:00 cron, posts to operator's Slack DM. Sources: calendar (today's events), inbox (overnight unread, classified urgent/normal), Slack mentions (overnight). Output: one structured Slack message. No external sends. Low risk, high signal.
2. **Daily inbox triage + draft replies** — 07:15 cron + `gmail_message_received` webhook. Reads inbox, classifies, drafts replies to known patterns (acks, calendar requests, simple Qs), routes uncertain mail to operator review. Drafts are review-gated (`send_email` is Tier 6). No outbound until approved.
3. **Meeting prep summary** — `calendar_event_imminent` trigger 15 min before each event. Pulls attendee context from Drive + recent inbox + Slack history with attendees. Posts a one-paragraph summary to operator DM. No external sends.
4. **Slack thread summary on mention** — `slack_mention` trigger. Reads the thread the EA was mentioned in, posts a structured summary back to the thread. Self-directed; arguably auto-gated even at Tier 6.
5. **Weekly review summary** — Friday 16:00 cron. Posts to operator DM: completed events, sent emails, unclosed threads, calendar load for next week. No external sends.

Deferred candidates (not V1, surface explicitly): calendar conflict detection + reschedule suggestions, expense receipt extraction from Drive, subscription / renewal tracker. Reason — each needs additional schema (canonical receipt table, subscription tracker), out of V1 scope.

### 3.8 Connection UI surfacing

- **Google Calendar** appears as a new row in `client/src/pages/govern/ConnectionsPage.tsx`. Reuses the existing `Connection` row shape (`name`, `authMethod: 'oauth'`, `status`, action buttons). No new visual surface or mockup — column structure, status pills, disconnect-confirm dialog, test button all already exist.
- **Slack** existing row gets no visual change. The capability matrix shown per connection (if any) is data-driven from the action registry's `requiredIntegration` field; new Slack actions register automatically.
- **Gmail, Drive** existing rows unchanged.
- One-time orientation copy on the EA agent-detail page calling out which connectors are required — reuses the existing "missing integration" pattern from agent-as-employee. No new component.

### 3.9 Notification + delivery surfaces

Where the EA's output lands per use case:

| Use case | Default delivery | Configurable |
|---|---|---|
| Daily briefing (3.7 #1) | Slack DM to operator | Yes, Slack DM / email / both |
| Inbox triage drafts (3.7 #2) | Gmail Drafts (no send) + Slack DM summary of drafts awaiting review | No (drafts go to Gmail Drafts by definition) |
| Meeting prep summary (3.7 #3) | Slack DM to operator | Yes, Slack DM / email |
| Slack thread summary (3.7 #4) | Thread reply (self-directed) | No (target is implied by trigger) |
| Weekly review (3.7 #5) | Slack DM to operator | Yes, Slack DM / email / both |

Configuration lives on the EA agent's per-subaccount config (existing agent-edit UI; no new surface). Defaults shipped in the seed migration.

Operator's email address and Slack user-id are resolved via the operator's identity binding on the subaccount, no new field. If Slack DM delivery is configured but Slack is not yet connected, the EA falls back to email and writes a `delivery_fallback` Run Trace event.

### 3.10 Multi-user consumption (consumes `user-owned-agents`)

The EA is a **user-owned agent** per the predecessor spec. Each user who wants an EA provisions their own agent row from the system template, bound to their `user_id` via `agents.owner_user_id`. Credentials, runs, and admin visibility all key off the owner automatically (the predecessor spec handles the plumbing).

V1 build implications:

- The EA seed migration creates **one EA agent row per active user in the dogfood subaccount** (each row carries that user's `owner_user_id`), not a single subaccount-scoped row. Phase 3 may automate provisioning; V1 seeds the operator's user explicitly, additional users seed when the dogfood expands.
- The Connections page eventually distinguishes "Acme Co's Gmail" (subaccount connection, `owner_user_id IS NULL`) from "Michael's Gmail" (user connection, `owner_user_id = michael`). V1 ships the data model; the UI label add (§3.16) is a small follow-on inside the EA build.
- Run Trace per-user scoping (predecessor §3.5 RLS clause) means each user sees their own EA's runs by default; org admins see metadata only with content redacted (predecessor §3.6). No new UI for V1; the existing RunTracePage gains a filter chip in a follow-on.
- Slack DM delivery resolves the operator's Slack user-id from the agent's `owner_user_id`. Each user gets their own briefing in their own DM.
- The EA agent's display name (`Personal Assistant` by default) is per-instance customisable, but each user's EA is a distinct agent row — no shared agent across users.

### 3.11 Voice Profile primitive (introduced by EA V1, designed for reuse)

The EA adopts the operator's writing voice from existing content. Implemented as a **generic `VoiceProfile` primitive** the platform can reuse for Riley (brand outreach voice), Helena (client-report voice), Sarah (analyst-report voice), and future content/marketing agents.

New resource:

```ts
voice_profiles: {
  id: uuid,
  organisation_id: uuid,
  scope_type: 'user' | 'subaccount' | 'org',     // parallel to principal model
  scope_id: uuid,
  name: text,                                     // display, e.g. "Michael — personal email voice"
  source: 'gmail_sent_sampler' | 'drive_doc_sampler' | 'manual',
  source_config: jsonb,                           // sampler-specific: { last_n: 50, since_days: 90, gmailLabelFilter?: ... }
  profile_json: jsonb,                            // distilled features: greeting/signoff patterns, sentence-length stats, formality score, em-dash usage, common phrases, signature line
  sample_size: int,
  last_derived_at: timestamptz,
  refresh_policy: 'manual' | 'periodic' | 'on_send_count',
  refresh_config: jsonb,                          // e.g. { days: 30 } or { every_n_sends: 50 }
  opt_out_at: timestamptz | null,                 // user opted out — profile not derived/used
  created_at, updated_at
}
```

New service: `VoiceProfileService` with pluggable samplers:

- `gmail_sent_sampler` — pulls last N sent messages from `read_inbox` adapter, runs feature distillation, writes profile.
- `drive_doc_sampler` — reads specified Drive doc(s) as the source material (for brand-voice cases where the brand has a style guide doc).
- `manual` — operator pastes example content, profile derives from it.

Agent configs declare which voice profile to use via a `voice_profile_id` field. The EA defaults to a user-scoped Gmail-sampled profile for its principal user. Riley defaults to a subaccount-scoped profile (existing brand-voice configuration in his system prompt becomes data, not prose). Future agents pick their profile at config time.

Prompt integration: every generated draft conditions on the profile JSON. Existing prompt builder gains a `<voice>` block injected before the task prompt when the agent has a configured profile.

Refresh: V1 picks "periodic every 30 days OR every 50 sent messages, whichever first" as the EA default. Manual refresh button on the EA settings page calls `VoiceProfileService.refresh(profileId)`.

Opt-out: per-profile flag in user settings. Recommendation: **default on, with a clear explanation at first-run setup that the EA will read your sent folder to learn your voice; one-click opt-out available.** Spec confirms the exact onboarding copy.

Privacy: derived `profile_json` is feature-level (greeting patterns, sentence-length stats, signature lines) — NOT verbatim content. Source content is read transiently, not stored on the profile.

### 3.12 First-run setup context attachment

When a user provisions their EA for the first time, the EA needs context about the user to do its job. Memory remains per-agent per `user-owned-agents` §3.4 — each user's EA has its own `memory_blocks` rows by virtue of being a separate agent row (no separate scope abstraction). Context answers are stored as memory blocks on the user's EA agent.

First-run wizard collects (5–10 fields max, one screen):

- Timezone (auto-detected from browser, user confirms)
- Working hours start / end (defaults 9am–6pm Mon–Fri)
- Preferred briefing delivery (Slack DM / email / both — see §4 q4)
- Preferred briefing time (defaults 07:00)
- Default meeting length preference (defaults 30 min)
- Close colleagues / family the EA might encounter (free-text, optional)
- Recurring people-or-projects to always flag in briefings (free-text, optional)
- Anything else worth knowing on day one (free-text, optional)

Each field writes to a `memory_blocks` row with `scope_type: 'user'`, `scope_id: current_user.id`, a structured `key` (e.g., `'ea.working_hours'`, `'ea.timezone'`), and the value. The EA reads these at every run via the principal-aware `runContextLoader`.

Users can edit / delete blocks later via the EA settings page (§3.17 mockup #3). No new admin UI for memory management.

Mockup: `prototypes/personal-assistant-v1/01-first-run-setup.html` — single-screen wizard with the OAuth connection step, the context questionnaire, and the voice-profile derivation confirmation.

### 3.13 Personal nav group in sidebar + home Personal zone (both data-driven)

User-principal agents need to be discoverable in the sidebar without hardcoding any specific agent name or mode-switch. Approach:

- Extend `client/src/config/sidebar.ts` `buildNavItems` factory with a new nav GROUP keyed `personal`.
- Group is rendered at the top of the sidebar, ABOVE Operate / Build / Govern.
- Entries in the group are **data-driven** from the user's user-owned agents (`SELECT * FROM agents WHERE owner_user_id = current_user.id`).
- Group is visible only when the user has at least one user-owned agent provisioned (zero entries → group hidden entirely).
- Each entry uses the agent's configured display name. Default display name is "Personal Assistant"; user can rename per §3.17.
- Group is visible regardless of which Workspace / Org / System view-mode is active. The view-mode switcher continues to control ORGANISATIONAL scope; the Personal group is orthogonal to that, providing always-accessible navigation to user-owned agents.

**Why this is better than a "Personal" view mode:** view modes today (Workspace / Org / System) control organisational scope. A "Personal" mode would mix two orthogonal axes — agent ownership vs organisational scope — and introduce confusion (auto-switching, "how do I get back," semantic overloading). A persistent nav group keeps the EA one click away in any view mode without UX confusion.

**Phase 3 forward-compat:** when Dev Agent ships as a second user-owned agent, it appears in the same Personal nav group automatically. Zero hardcoding, no nav refactor.

**Pair: home page Personal zone.** Discoverability and "what does my assistant want me to look at this morning?" cannot rely on the sidebar alone — users need a glanceable summary when they land. The existing user home page gains a new **Personal zone** at the top that renders one card per user-owned agent the user owns. Cards are contributed by each agent via the home-widget contract in §3.20.

EA's home card shows: today's briefing one-liner + count of drafts awaiting review + next meeting prep + "Open" link. Click → goes to the per-agent detail page (Workspace / Activity / Settings tabs per §3.17 mockup).

No dedicated "EA home page" exists — that would be page proliferation. The sidebar entry navigates to a per-agent detail page (deeper work surfaces); the home zone surfaces glanceable summaries. Both data-driven from `agents WHERE owner_user_id = current_user.id`.

Mockup: `prototypes/personal-assistant-v1/02-my-ea-home.html` shows the existing home layout with the new Personal zone at top.

### 3.14 EA provisioning (explicit consent, not automatic)

EAs are NOT auto-created for every user in the org. Each user provisions their own via an explicit "Set up my Personal Assistant" entry point. Reasons:

- Avoids running cost (LLM tokens + scheduled jobs + recurring polls) on EAs nobody is using.
- Matches the principle of explicit consent for personal-data features (the EA reads your inbox; you opt in).
- Keeps the Personal nav group empty (and hidden) for users who don't want an EA.

Provisioning entry point: a "Set up my Personal Assistant" card on the user's home page (visible when the Personal group is empty). Click → opens the first-run setup wizard (§3.12). Wizard completion: creates the user-owned EA agent row (`owner_user_id = current_user.id`), seeds default skills + risk-tier ceiling per §3.4, kicks off voice-profile derivation, fires the first briefing on next 07:00.

### 3.15 Spending budgets (pooled to subaccount)

EA token spend rolls up into the existing subaccount budget. No new per-user budget primitive in V1. Reasons:

- Today's spending budget is subaccount-scoped — splitting per-user adds significant complexity for marginal benefit.
- The Personal Assistant is a productivity tool, not a billable customer surface. The buyer pays for total subaccount usage; how it splits between staff is the buyer's internal accounting question, not SynthetOS's.

Existing budget alert (`spendAlertConfig.ts`) fires at the subaccount level and applies to EA runs the same as any other agent. Spec confirms no schema or service change.

Per-user budget caps are a Phase 1.5 follow-on IF customer demand emerges. Not in V1.

### 3.16 Connection card "Personal" chip labelling

When a user-owned agent connects their own account (e.g. Michael connects "his" Gmail), the connection card on the Connections page (`client/src/pages/govern/ConnectionsPage.tsx`) distinguishes it from a subaccount-level connection.

Visual: a small chip next to the connection name. Chip text derives from whether `integration_connections.owner_user_id` is set:

- `Personal` — user-owned connection, `owner_user_id IS NOT NULL` (e.g., Michael's Gmail)
- `Subaccount` — subaccount-owned connection, `owner_user_id IS NULL` (e.g., Acme Co's CRM) — most existing connections

Subaccount-level admins see all subaccount connections, no chip change. Users see their own Personal connections plus any subaccount connections they have access to via existing RLS. Per `user-owned-agents` §3.5 + §3.6, users do NOT see other users' Personal connections; admin redaction policy applies to content visibility.

No new component — minor edit to the existing `ConnectionsPage` row template.

### 3.17 Display name customisation

The EA's display name is per-instance, defaulting to `Personal Assistant`. Users can rename to anything (e.g., `Jarvis`, `Friday`, `Aria`) in the EA settings page. The display name is used:

- Sidebar nav entry under the Personal group (§3.13)
- Run Trace event headers ("Your Personal Assistant ran ...")
- Delivery surfaces (Slack DM signature, email From-name where allowed)
- Confirmation modals ("Approve Personal Assistant's draft?")

Stored in `agents.name` (existing column). No new schema. Mockup #3 shows the rename field.

### 3.18 Capability grouping for the connection UI

Aligns with existing infrastructure — does NOT introduce a new abstraction layer:

- **Existing capability taxonomy** lives in `docs/integration-reference.md` (read/write capability slugs with aliases) and is CI-enforced by `scripts/verify-integration-reference.ts`.
- **Existing per-agent capability map** lives in `subaccount_agents.capability_map` JSONB, computed by `capabilityMapService.ts` from skill links crossed with the integration reference.
- **Existing backend-agnostic adapter** for email + calendar: `WorkspaceAdapter` (`shared/types/workspaceAdapterContract.ts`) with two backends today — `'synthetos_native'` and `'google_workspace'`. Outlook / M365 slots in as a future backend.

What this build adds: **a small UI grouping layer over existing capability slugs.** One new file `server/config/capabilityGroups.ts` defining four user-facing groups → existing capability slugs:

```ts
export const CAPABILITY_GROUPS = {
  email:     { label: 'Email',     slugs: ['inbox_read', 'email_body_read', 'send_email', 'modify_labels', 'classify_email'] },
  calendar:  { label: 'Calendar',  slugs: ['calendar_read', 'calendar_event_create'] },
  files:     { label: 'Files',     slugs: ['page_read', 'spreadsheet_read'] },
  team_chat: { label: 'Team chat', slugs: ['channel_messages_read', /* + post-message slug to be added to taxonomy */] },
} as const;
```

CI gate validates every referenced slug exists in the integration-reference taxonomy. The wizard renders four capability cards; clicking "Email" surfaces providers that declare any of the email slugs (today: `gmail` + Google Workspace identity backend). Future Outlook lands by adding an `outlook` block to `integration-reference.md` declaring `inbox_read` + `send_email` etc. — the wizard auto-discovers via the same grouping.

User never sees raw slugs in the wizard. Operators / system admins see them on the Connections page (existing) and in agent capability-map debug surfaces (existing).

### 3.19 Live-fetch vs canonical data decision

The codebase already supports both paths via `readPath: 'liveFetch' | 'canonical'` on each action. EA V1 makes the decision explicit:

| Data | Storage | Why |
|---|---|---|
| Email content (bodies, threads, headers) | **Live-fetch** | Storage cost (GB per user); privacy escalation; no V1 use case requires cross-source SQL. Existing `read_inbox` action is already live-fetch. |
| Calendar event content | **Live-fetch** | Same reasoning. |
| Drive file content | **Live-fetch** | Existing read-only resolver pattern. |
| Slack message content | **Live-fetch** | Same reasoning. |
| Voice profile (derived features) | **Canonical** | Feature-level summary, small, valuable persistence, opt-out enforced. |
| User context memory blocks | **Canonical** | Already how memory works. |
| Run trace + run history | **Canonical** | Already canonical (foundation primitive). |
| Drafts the EA generated awaiting your review | **Canonical** | Needs to survive across sessions; "show me pending drafts" is a primary UX. New `ea_drafts` table — small, ~5–10 cols, indexed by `(organisation_id, user_id, status)`. |

What we DO NOT build in V1:
- Inbox ingestion / sync jobs
- Calendar event mirror table
- File content cache
- Cross-source unified search index

Defer to Phase 1.5 IF a real use case requires cross-source SQL (Revenue Ops Assistant uses canonical for invoices because invoice reconciliation needs it; EA V1 has no equivalent need).

### 3.20 Home-widget contribution contract (introduced by EA V1, designed for reuse)

Generic primitive that any user-owned agent template uses to contribute a card to the user's home Personal zone (§3.13). Designed for reuse by Dev Agent (Phase 3), future personal-research agents, etc.

Contract on the system-agent template:

```ts
home_widget: {
  type: 'summary_card' | 'queue_card' | 'metric_card',  // extensible
  title_template: string,
  body_provider_skill: string,  // slug of a skill that, when invoked, returns WidgetData
  refresh_policy: 'on_login' | 'every_5m' | 'on_demand',
} | null  // null = agent does not surface to home
```

The home page reads `agents WHERE owner_user_id = current_user.id`, looks up each agent's `home_widget` declaration on its system-agent template, invokes the `body_provider_skill`, renders the resulting `WidgetData` inside a consistent visual frame.

EA's contribution (V1):

```ts
home_widget: {
  type: 'summary_card',
  title_template: '${agent.display_name}',
  body_provider_skill: 'ea.home_widget.summary',  // new skill, returns: { briefingOneLiner, draftCount, nextMeetingPrep, runRecency }
  refresh_policy: 'on_login',
}
```

Visual frame is a single component on the home page; agents only return data, not markup. This prevents agents from rendering arbitrary HTML and keeps the home page consistent.

`WidgetData` shape per type is defined in `shared/types/homeWidget.ts`. New types can be added as future agents need them; the frame component handles each type's rendering.

Foundation cost: ~1 dev-day. Pays off the day a second user-owned agent ships.

### 3.21 Failure modes for triggered runs

The spec defines behaviour for the four failure classes:

1. **Auth-expired credential mid-run** — broker returns `revoked` / `expired_refresh_token`. EA emits `notify_operator` with severity `warning`, marks the connection `expired` (existing connection-status state), writes a `trigger.suppressed` Run Trace event with reason `credential_unavailable`. Skipped runs are visible on the EA agent page (existing run history). Subsequent triggers stay suppressed until reconnection.
2. **External API timeout / 5xx** — retries per the action's `retryPolicy`. If the run is a triggered briefing, the briefing posts with partial sources marked "data unavailable" rather than failing the run entirely. Spec defines a "best-effort partial output" pattern for read-heavy briefings.
3. **Rate-cap suppression** — `MAX_TRIGGERED_RUNS_PER_MINUTE` exceeded. Existing pattern logs and skips. Spec adds an operator-visible alert when suppression-rate exceeds a daily threshold (e.g., >10 suppressions / 24h = degraded-state notification).
4. **Approval timeout** — Tier 6 send drafted but no human approval within 24 hours. Existing approval-stall job (`workflowGateStallNotifyJob.ts`) handles this; spec confirms the EA reuses it with appropriate stall thresholds.

All four failure paths are visible in the EA's Run Trace view (existing surface).

## 4. Open architectural questions (for operator ratification)

Status legend: **LOCKED** = ratified by operator on 2026-05-12 chat; **OPEN** = awaiting decision.

1. **Calendar write-scope V1.** **LOCKED — read + review-gated write.** This question went through three positions: round 1 (read + write V1), round 2 challenge-round tightening (read-only V1), and the capability-alignment correction (back to read + write V1 with mandatory review gates on writes). Final shape: `list_events` / `get_event` / `find_free_slot` auto; `create_event` / `update_event` / `respond_to_invite` review-gated; `delete_event` deferred. Rationale: the existing `WorkspaceAdapter` already exposes write capabilities for subaccount-owned agents — deferring on user-owned agents created an artificial regression. Risk control achieved via review gates, not capability removal. Detail in §0.5.4 and §3.2.

2. **Slack write-scope V1 — user-facing config.** **LOCKED.** Read + write V1. Auto-send scope is a per-instance setting with three options, default `Only me (DMs)`:
   - **Only me (DMs)** — every message to a channel or other person needs operator approval (default).
   - **My own channels** — auto-post to channels I'm a member of; DMs to others and external channels need approval.
   - **Anywhere** — auto-post to any channel; only DMs to people other than me need approval.
   Surfaced as a single dropdown on the EA settings page. The same enum is reused on any future agent that gains Slack post capability (Riley, future content agents).

3. **Risk-tier ceiling for the EA agent.** **LOCKED:** Tier 5 hard ceiling. Tier 6 sends (`send_email`, `slack.post_message` to third parties) allowed but require review (except as gated by question 2 for self-directed Slack). Drafting / scheduling / internal-record updates run auto.

4. **Daily briefing delivery default.** **LOCKED:** Slack DM as default, email as alternate, both available; operator picks at first-run setup.

5. **Use-case shortlist for V1.** **LOCKED.** Ship #1 (daily briefing 07:00 cron + Slack DM), #2 (inbox triage + drafted replies), #3 (15-min-before meeting prep summary). Defer #4 (Slack mention summary) and #5 (weekly review) to a fast follow-on if the trio lands cleanly. Confirmed: existing briefing/summary workflows in the codebase are subaccount-focused; the EA briefings are user-focused (new templates, reuses workflow engine).

6. **Gmail push notifications vs polling.** **LOCKED.** 5-minute polling V1. Confirmed: polling job is a Gmail `users.history.list` API call (no LLM cost; 288 calls/day per connected account, inside Google's free quota). LLM cost stays zero until a new message arrives AND the EA decides to act. Push path (Gmail Watch → Pub/Sub) is a flag-gated Phase 1.5 add if 5-min latency becomes felt.

7. **Multi-user EA owner binding.** **LOCKED.** EA is a user-owned agent per the predecessor spec `tasks/builds/user-owned-agents/brief.md` (simpler than the originally-proposed `principal-scoped-agents` — single `agents.owner_user_id` column, no principal abstraction). Each user provisions their own EA agent row bound to their `user_id`. Credentials, runs, and admin redaction honour the ownership model. V1 UI surfaces the operator's own instance; multi-user UI surfaces are a fast follow-on. EA V1 build does not invent new schema for this — it consumes the foundation primitive shipped by the predecessor.

8. **Voice and tone — dynamic, not static.** **LOCKED.** EA voice is data-driven from the operator's own sent mail (per §3.11 — Voice Profile primitive). No static system-prompt tone. Voice profile derives at first-run setup from the last 50 sent emails in the past 90 days, refreshes every 30 days or every 50 new sent emails (whichever first). Manual refresh button on EA settings. **Opt-out default LOCKED: default on, clear explanation at first-run setup, one-click opt-out.** Same primitive is reusable across Riley (brand voice, subaccount-scoped), Helena (client-report voice), Sarah (analyst voice), and future content agents.

## 5. Out of scope (explicit non-goals)

| Out of scope | Belongs in |
|---|---|
| `controllerStyle: 'operator'` on the EA agent | V2 (`personal-assistant-v2-operator`), depends on Spec D |
| Long-running autonomous sessions (multi-turn investigations) | V2 |
| ChatGPT OAuth as operator-session identity for the EA | V2 (consumes Spec C + Spec D) |
| Notion connector + actions | Operator-deferred; not in v1.2 brief scope |
| Outlook / Microsoft 365 connector + actions | Operator-deferred; brief §16.1 mentions but V1 dogfood is Google stack |
| Cross-session durable memory beyond existing `memory_blocks` / `update_memory_block` | Phase 3 (master brief §13) |
| Calendar conflict detection + automated reschedule | Fast follow-on, not V1 |
| Expense receipt extraction from Drive | Phase 1.5 (depends on canonical receipt schema) |
| Subscription / renewal tracker | Phase 1.5 |
| Travel + itinerary management | Phase 3 (master brief §16.1) |
| Customer productisation (multi-customer EA tier) | Not in roadmap; V1 is internal dogfood |
| Cost-savings dashboard for operator-mediated runs | Phase 3.5 (OpenClaw strategic analysis Phase 3) |
| Routing policy explainability (which controller chose what) | Separate spec (OpenClaw strategic analysis Phase 2) |
| Browser Environment usage by the EA (e.g. logging into web portals) | Phase 2 or V2 (Operator Controller on Browser) |

## 6. What unblocks when this ships

- The Executive Assistant agent exists in the system-agent registry — V2 can layer Operator Controller on top of an existing agent, not a greenfield one.
- Google Calendar is a registered OAuth provider — every downstream use case (Phase 1.5 Revenue Ops, Phase 2 richer scheduling) reuses the same connection.
- Slack agent actions exist as registered, risk-tiered actions — any future agent that needs to read/post to Slack consumes the same actions, not a one-off integration.
- External-source webhook triggers exist as a first-class trigger primitive — future connectors (Outlook events, Notion changes, Stripe events as agent triggers) plug into the same engine.
- The operator-facing "always-on personal assistant" capability is real — proves the foundation primitives (controllerStyle, risk tiers, credential broker, policy envelope, run trace, scheduled tasks, triggers, HITL approvals) compose end-to-end on a non-trivial agent.

## 7. Sequencing

**Mockups required for V1: yes, three.** The multi-user EA design (consuming the `user-owned-agents` foundation) introduces genuinely new user-facing surfaces that warrant visual design before build:

| File | Purpose |
|---|---|
| `prototypes/personal-assistant-v1/01-first-run-setup.html` | OAuth connections + context questionnaire + voice-profile derivation wizard. New flow, ~5–10 fields, single screen. |
| `prototypes/personal-assistant-v1/02-my-ea-home.html` | The user's home view with the new Personal zone. Sidebar shows the data-driven Personal nav group with the EA at top; main content shows existing home layout plus the Personal zone (morning briefing card, drafts awaiting review, today's meeting prep). |
| `prototypes/personal-assistant-v1/03-ea-settings.html` | Per-instance EA configuration: voice profile status + manual refresh + opt-out toggle, briefing delivery preference, Slack auto-send scope dropdown (3 options per §4 q2), display-name field, trigger schedule, context-memory edit. |

**Reused without new mockups:**

- Connections page row (Calendar) — uses existing `ConnectionsPage.tsx` pattern + the new "Personal" chip from §3.16.
- System-agent template — shipped via DB seed migration like Sarah/Johnny/Helena (no new visual surface).
- Triggers — Scheduled uses `RecurringTasksPage`, event-driven uses `AgentTriggersPage`, both unchanged.
- Run Trace — existing `RunTracePage.tsx` with the redaction policy from `user-owned-agents` §3.6 enforced at the API layer (no new UI surface required for the redaction itself).
- Slack briefing rendering — Slack message formatting, no SynthetOS UI surface.

Visual conventions inherit from `prototypes/consolidation-2026-05-06/_shared.css` (the foundation visual baseline) and `prototypes/operator-backend/_shared.css` (extended pills, time strips, progress patterns).

**Build sequencing:**

1. Operator reviews this brief, locks §4 decisions (ratifies all 8).
2. Operator clones the same branch pattern as Spec D (`claude/personal-assistant-v1-{nonce}` off post-#279 main) in a new Claude Code session.
3. Session adopts `spec-coordinator`: brief intake (this doc) → spec authoring → `spec-reviewer` (Codex loop) → `chatgpt-spec-review` (manual rounds) → handoff to `feature-coordinator`.
4. Build session ships: OAuth provider entry, Calendar action handlers + registry rows, Slack agent action handlers + registry rows, EA system-agent seed migration + `c.ts` mirror, external-trigger event-type extension + Google webhook route, Gmail polling recurring-task seed, three V1 use-case workflows (daily briefing, inbox triage, meeting prep) as named native workflows, system-prompt + skill bundle defaults.
5. Phase 3 (`finalisation-coordinator`) ships the canonical doc-sync sweep + KNOWLEDGE.md patterns + `current-focus.md` → MERGE_READY + the ready-to-merge label.

**Concurrency with Spec D:** V1 runs fully concurrent to Spec D. Code areas claimed by V1:

- `server/config/oauthProviders.ts` (one new entry: `google_calendar`)
- `server/config/actionRegistry.ts` (new Calendar + Slack action rows; new topic `'calendar'`, `'slack'`)
- `server/config/topicRegistry.ts` (two new topics)
- `server/config/c.ts` (one new entry: `executive-assistant`)
- `server/db/schema/agentTriggers.ts` (event-type enum extension, likely additive, drizzle-safe)
- New files: `server/routes/webhooks/googleWebhook.ts`, `server/services/triggers/externalSourceTriggers.ts`, `server/services/calendar/*` (action handlers), `server/services/slack/*` (action handlers beyond outbound notify), `server/jobs/gmailInboxPollJob.ts`
- New migration: EA system-agent seed + agent-triggers event-type extension + (if push path lands later) `gmail_watch_subscriptions` table, but the polling-first recommendation keeps V1 migration count at one or two.

Spec D claims `server/services/operatorBackend*`, `server/db/schema/operatorRuns`, `infra/sandbox-templates/operator-session/`. Zero overlap.

**V2 dependency note:** V2 (Operator Mode upgrade on the EA) touches `server/config/c.ts` to add `controllerStyle: 'operator'` to the EA's allowed-controllers set. If V1 and V2 are in flight simultaneously, V2 rebases on V1; this brief flags the coordination explicitly so V2 authoring doesn't double-write the EA's controller-set field.

**Branch:** `claude/personal-assistant-v1-{nonce}` off post-Phase-1-foundation `main` (any commit at or after #279).

## End of brief
