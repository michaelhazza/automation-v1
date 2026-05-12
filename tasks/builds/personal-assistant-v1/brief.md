**Status:** DRAFT (2026-05-12) — awaiting operator sign-off before spec authoring
**Date:** 2026-05-12
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** `personal-assistant-v1`
**Successor placeholder:** `tasks/builds/personal-assistant-v2-operator/brief.md` (V2 upgrade — Operator Controller, depends on Spec D)
**Concurrent with:** Spec D `tasks/builds/operator-backend/brief.md` (no file overlap; V2 depends on Spec D, V1 does not)
**Strategic parent:** `docs/synthetos-governed-agentic-os-brief-v1.2.md` §16.1 (Executive Assistant use case), §6.3 (Native Controller), §17 (use-case coverage matrix)

# Personal Assistant V1 — Build Brief

## Contents

- [0. Naming decision (read first)](#0-naming-decision-read-first)
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
  - [3.10 Failure modes for triggered runs](#310-failure-modes-for-triggered-runs)
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

Nothing on the foundation is in flux. V1 is a pure composer of existing primitives plus two new connector surfaces (Calendar OAuth + actions, Slack agent actions) plus one new trigger primitive (external-source triggers).

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

Minimum action set in `server/config/actionRegistry.ts` (each with parameter Zod schema, `riskTier`, `defaultGateLevel`, `verify` or null-with-justification, `requiredIntegration: 'google_calendar'`, MCP annotations, retry policy):

| Action | Read/Write | Recommended risk tier | Default gate | Verify shape |
|---|---|---|---|---|
| `list_events` | read | 2 | auto | `row_exists` (event id returned) |
| `get_event` | read | 2 | auto | `row_exists` |
| `find_free_slot` | read (compute over read) | 2 | auto | `api_status_2xx` |
| `create_event` | write | 4 | review (Tier 4+ default) | `row_exists` |
| `update_event` | write | 4 | review | `row_exists` |
| `delete_event` | write (destructive) | 5 | review | `row_exists` (returns 404 after delete) |
| `respond_to_invite` | write | 3 | review | `api_status_2xx` |

Write actions deferred entirely if §4 question 1 resolves to read-only V1.

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

### 3.10 Failure modes for triggered runs

The spec defines behaviour for the four failure classes:

1. **Auth-expired credential mid-run** — broker returns `revoked` / `expired_refresh_token`. EA emits `notify_operator` with severity `warning`, marks the connection `expired` (existing connection-status state), writes a `trigger.suppressed` Run Trace event with reason `credential_unavailable`. Skipped runs are visible on the EA agent page (existing run history). Subsequent triggers stay suppressed until reconnection.
2. **External API timeout / 5xx** — retries per the action's `retryPolicy`. If the run is a triggered briefing, the briefing posts with partial sources marked "data unavailable" rather than failing the run entirely. Spec defines a "best-effort partial output" pattern for read-heavy briefings.
3. **Rate-cap suppression** — `MAX_TRIGGERED_RUNS_PER_MINUTE` exceeded. Existing pattern logs and skips. Spec adds an operator-visible alert when suppression-rate exceeds a daily threshold (e.g., >10 suppressions / 24h = degraded-state notification).
4. **Approval timeout** — Tier 6 send drafted but no human approval within 24 hours. Existing approval-stall job (`workflowGateStallNotifyJob.ts`) handles this; spec confirms the EA reuses it with appropriate stall thresholds.

All four failure paths are visible in the EA's Run Trace view (existing surface).

## 4. Open architectural questions (for operator ratification)

Flag the operator answer in §4 of the spec before lock.

1. **Calendar write-scope V1.** Read + write, or read-only first? Recommendation: **read + write V1.** The meeting-prep + conflict-detection use cases lose half their value without write. Mitigation: write actions ship review-gated (Tier 4+ default-review per Phase 1 risk-tier policy).

2. **Slack write-scope V1.** Post + DM, or read-only first? Recommendation: **read + write V1, with self-directed posts (DMs to operator, thread-summary self-replies) auto-gated; third-party channel posts review-gated.** This needs a finer policy than "Tier 6 = always review", the spec defines a `policy_envelope_v1` clause that auto-gates posts whose recipient resolves to the connected operator user-id.

3. **Risk-tier ceiling for the EA agent.** Recommendation: **Tier 5 hard ceiling for V1.** Tier 6 sends (`send_email`, `slack.post_message` to third parties) are allowed but require review. Drafting / scheduling / internal-record updates run auto. This matches the master brief's principle: "Native Controller is default. Operator Controller is escalation."

4. **Daily briefing delivery default.** Slack DM, email, both, or operator-selectable at setup? Recommendation: **Slack DM as default**, email as alternate, both available; operator picks at first-run setup.

5. **Use-case shortlist for V1.** Recommendation: **ship #1 (daily briefing), #2 (inbox triage), #3 (meeting prep) — the always-on trio.** Defer #4 (Slack mention summary) and #5 (weekly review) to a fast follow-on if the trio lands cleanly.

6. **Gmail push notifications vs polling.** Recommendation: **5-minute polling V1.** Push notifications require provisioning a Google Cloud Pub/Sub topic and subscription per Google account, which is operational overhead the dogfood doesn't need yet. The polling path is one recurring task per subaccount with the existing engine. A flag-gated push path is a Phase 1.5 add if polling latency becomes a felt problem.

7. **Operator's identity binding for V1.** The EA needs to know "which operator am I summarising for?", spec confirms this maps cleanly to the existing `users.id` on the subaccount-owner relation, or whether a dedicated `eaOperatorBinding` field is needed for cases where the EA serves a delegated team member rather than the subaccount owner. Recommendation: **subaccount-owner V1, dedicated binding deferred** until multi-operator dogfood is needed.

8. **System-prompt voice and tone.** Out of scope for this brief, locked at spec authoring. Flag if the operator has a non-default tone preference (e.g., terse vs conversational, em-dash usage, time-zone framing).

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

**Mockups required for V1: no.** Every V1 UI surface reuses an existing visual pattern:

- Connections page row (Calendar) — pattern is `client/src/pages/govern/ConnectionsPage.tsx`, no new visual decisions.
- System agent definition (EA template) — pattern is the existing `SUBACCOUNT_AGENTS` set (Sarah, Johnny, Helena, Patel, Riley, Dana), shipped via DB seed migration.
- Triggers — Scheduled uses `RecurringTasksPage`, event-driven uses `AgentTriggersPage`, webhook-sourced is mechanical wiring with no new operator surface.
- Delivery surfaces (Slack DM, email) — existing notification surfaces, no new UI.
- Run Trace + run history for triggered EA runs — existing `RunTracePage.tsx` surface unchanged.

If the operator wants a sample of what the morning Slack briefing looks like as plain text, a one-page text mock (no HTML, no clickable prototype) is sufficient and can be inlined into the spec rather than authored as a separate prototype.

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
