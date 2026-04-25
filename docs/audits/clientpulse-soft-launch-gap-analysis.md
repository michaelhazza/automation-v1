# ClientPulse Soft-Launch Gap Analysis
**Automation OS × ClientPulse — Capability Audit**
**Date:** 2026-04-25
**Auditor:** Claude Code (read-only pass — no implementation code written)
**Branch:** `claude/clientpulse-capability-audit-BT6pZ`

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Section 1 — USP Audit (Moats vs Agent Studio)](#2-section-1--usp-audit-moats-vs-agent-studio)
3. [Section 2a — ClientPulse Diagnostic Capability Audit](#3-section-2a--clientpulse-diagnostic-capability-audit)
4. [Section 2b — ClientPulse Action Capability Audit](#4-section-2b--clientpulse-action-capability-audit)
5. [Section 3 — GHL Integration Audit](#5-section-3--ghl-integration-audit)
6. [Section 4 — Other Considerations](#6-section-4--other-considerations)
7. [Section 5 — Recommended Priority List](#7-section-5--recommended-priority-list)
8. [Section 6 — Open Questions](#8-section-6--open-questions)

## 8. Section 6 — Open Questions

These are items that could not be verified from the codebase alone. Each is a specific question requiring human resolution before the relevant finding can be upgraded from UNCLEAR.

---

**Q1 — GHL agency OAuth initiation URL**

The `chooselocation` endpoint in `oauthProviders.ts` is documented as the sub-account chooser. Is this the same URL used for an Agency-type app install, or is there a separate agency-level initiation URL? GHL's Marketplace docs for Company/Agency-type apps should clarify. This must be resolved before any design-partner install attempt.

*Affects:* Section 1 Moat 1, Section 3.1.

---

**Q2 — GHL webhook receiver cross-tenant routing**

The webhook normalisation layer extracts `locationId` from the payload. The receiver route (not read in this audit) must resolve `locationId` → `organisation_id` via a DB lookup. Does the webhook receiver perform this lookup from `connector_configs` or `canonical_accounts` without trusting any client-provided header? If the routing uses a client-provided `x-organisation-id` header (or similar), this is a cross-tenant data leak vector.

*Affects:* Section 3.5.

---

**Q3 — Default policy_rules seeding for new organisations**

When a new organisation is created, is the `policy_rules` table pre-populated with any default rules (e.g., a wildcard `tool_slug='*', decision='review'`)? Or does a new org have zero rows and fall through to a hardcoded default in the policy resolution service? If the latter, what is that hardcoded default, and is it documented as the intended behaviour for design-partner day 1?

*Affects:* Section 1 Moat 3, Section 2b (gate model reliability for all action capabilities).

---

**Q4 — HubSpot adapter dispatch guard**

`connectorPollingService.ts` dispatches to `adapters[config.connector_type]`. HubSpot is in `connector_configs.connector_type` but has no entry in `adapters/index.ts`. If a `connector_config` row with `connector_type='hubspot'` is created, the dispatch returns `undefined` and `adapter?.ingestion` is falsy. The comment "Stub — adapters will be wired here in P4+" suggests this is known. Is there a guard in the service that catches this case and logs a warning rather than silently skipping? Or does the code just skip (`if (!adapter?.ingestion) { return; }`) without logging?

*Affects:* Section 1 Moat 2.

---

**Q5 — IEE as a playbook DAG step**

Is there a planned or in-progress spec for adding an IEE step type to the playbook workflow DAG? The brief requires `dev_task` be "invokable as a step in playbook DAGs." Currently IEE is an agent-run execution mode, not a composable step. If there is a spec or upcoming build for this, the PARTIAL rating becomes a timing issue rather than an architectural gap.

*Affects:* Section 1 Moat 4.

---

**Q6 — INSTALL/UNINSTALL webhook handling**

`docs/create-ghl-app.md` line 510 marks the `INSTALL` webhook as critical: it should trigger initial `/locations/search` enumeration and first-sync job. Is there a webhook receiver handler for `INSTALL` events that: (a) creates `canonical_accounts` for all sub-accounts, (b) triggers a `connector-polling-sync` job for each, and (c) handles the 100-location pagination gap in `listAccounts`? The ghlAdapter normalises `INSTALL`/`UNINSTALL` events as `entityType='account'` mutations but the action taken by the receiver is in the route handler (not audited).

*Affects:* Section 3.5, Section 3.7.

---

**Q7 — Reporting agent skill registration**

The `client-reporting-agent` and `business-analyst` agents are referenced in the action audit. The `report_generation`, `brand_resolution`, `narrative_synthesis`, and `qbr_synthesis` skills listed in the brief — are these registered as `system_skills` rows in the DB (populated by `scripts/seed.ts`)? Or are they planned-but-not-seeded? This requires checking the `system_skills` table against the agent AGENTS.md skill lists.

*Affects:* Section 2b-1, Section 2b-6.

---

*Audit completed: 2026-04-25. No implementation code written. One file created: `docs/audits/clientpulse-soft-launch-gap-analysis.md`.*

---

## 7. Section 5 — Recommended Priority List

Top 5 gaps to close before soft launch, by impact on launch narrative and effort to close.

---

### P1 — Baseline snapshot table and ROI delta computation `[L]`

**Gap:** No `baseline_snapshots` table. No ROI delta computation. The brief calls ROI delta tracking "non-negotiable for the soft-launch story."

**Required work:**
- New schema: `baseline_snapshots` with `(organisation_id, subaccount_id, engagement_start_date, metrics JSONB, captured_at, is_immutable)`. Add RLS, indexes.
- Migration with immutability constraint (no UPDATE path after `is_immutable = true`).
- Baseline capture job: runs once at onboarding (or manually triggered), writes snapshot from current `canonical_metrics` values.
- ROI delta computation: a function or materialized query that joins `baseline_snapshots` to `canonical_metrics.current_value` per metric slug, emitting `(metric, baseline_value, current_value, delta, delta_pct)` per sub-account.
- Wire into the reporting agent and portfolio rollup job.

**Effort estimate:** Large. New table, migration, capture job, computation logic, reporting integration. 3–5 days.

---

### P2 — GHL agency-level OAuth verification and missing scopes `[M]`

**Gap:** `authUrl` uses the sub-account chooser endpoint (`chooselocation`). `companies.readonly` scope is absent. Agency-token-vs-location-token exchange is documented as unverified. Three scopes for write actions and revenue are missing.

**Required work:**
- Verify the correct agency-level OAuth initiation URL with GHL (may be the same `chooselocation` endpoint with different app configuration — requires a real agency install test).
- Add `companies.readonly` to `server/config/oauthProviders.ts` GHL scopes.
- Add `conversations.write` and `opportunities.write` if CRM write-back actions are in scope for soft launch.
- Add `payments/orders.readonly` if revenue trend metric is required.
- End-to-end test against a real GHL developer agency account with 3+ sub-accounts: verify `listAccounts`, `fetchContacts`, `fetchOpportunities`, `fetchConversations`, `fetchRevenue` all return data.
- If agency token cannot directly call per-location endpoints, implement `getLocationToken(connection, locationId)` helper.

**Effort estimate:** Medium. Primarily testing and verification with targeted code changes. 1–2 days plus time to arrange a test agency account.

---

### P3 — Rate limiter shared-state backend `[M]`

**Gap:** `server/lib/rateLimiter.ts` is in-memory, not shared across server instances. A multi-instance Replit deploy results in each instance maintaining its own token bucket, multiplying GHL API request throughput by the instance count.

**Required work:**
- Replace the in-memory bucket with a Redis-backed token bucket (or use Replit's key-value store if available), or implement a rate-limit proxy pattern using pg-boss for serialised GHL dispatch.
- Alternative (simpler for soft launch at 1–2 agencies): document and enforce single-instance deployment during soft launch so the in-memory limiter is safe. Flag this as a pre-public-launch hard requirement.

**Effort estimate:** Medium if Redis is available; Small if single-instance deployment constraint is formally accepted as a soft-launch constraint.

---

### P4 — `audit_events` subaccount_id column `[S]`

**Gap:** `audit_events` has no `subaccount_id` column, making per-client audit log queries require a multi-step JOIN. This affects the "audit trail visible to the agency per client" requirement and the design-partner demo story ("what did you do for client X this month?").

**Required work:**
- Migration: add `subaccount_id uuid REFERENCES subaccounts(id)` to `audit_events`.
- Update the audit event write path to populate `subaccount_id` when the context includes one (most agent-triggered events will have subaccount context).
- Add index `(subaccount_id, created_at)`.

**Effort estimate:** Small. Schema change + write-path update. 0.5–1 day.

---

### P5 — Proactive token refresh background job `[S]`

**Gap:** Token refresh is lazy (at request time). A GHL token that has expired during an inactive period will cause a synchronous refresh on the first post-gap polling call. For a design-partner agency that goes a weekend without agent activity, Monday morning's first sync will stall on token refresh before proceeding.

**Required work:**
- pg-boss cron job (e.g., every 30 minutes) that sweeps `integration_connections WHERE connection_status = 'active' AND token_expires_at < now() + interval '30 minutes'` and calls `connectionTokenService.refreshIfExpired` for each.
- Handle refresh failure: update `connection_status = 'error'` and `oauth_status = 'expired'`, emit an audit event, optionally notify the org admin via `notify_operator`.

**Effort estimate:** Small. New job + existing service reuse. 0.5–1 day.

---

## 6. Section 4 — Other Considerations

---

### 4a — Test environment and design-partner readiness

**Synthetic data generation**

**Rating: PARTIAL**

`scripts/seed.ts` creates:
- System org + admin user (Phase 1)
- 16 system agents (Phase 2)
- Playbook templates (Phase 4)
- Dev fixtures: Synthetos org, Synthetos Workspace subaccount, Breakout Solutions subaccount (2 sub-accounts total), 1 reporting agent, integration connection placeholders.

The seed script creates **2 sub-accounts**, not 8–10. `tests/trajectories/portfolio-health-3-subaccounts.json` exercises 3 sub-accounts in a pre-recorded trajectory test, but this is a replay fixture, not a seed that provisions realistic CRM data (contacts, opportunities, conversations, historical activity).

There is no seed script that creates a realistic agency with populated canonical_metrics, canonical_metric_history, or client_pulse_signal_observations spanning a time period. This means end-to-end manual testing of health scoring and churn assessment requires either (a) real GHL data from a test agency account or (b) a seed script that does not yet exist.

**Gap for soft launch:** Without a multi-subaccount seed with realistic CRM data, the health score, churn assessment, and ROI narratives cannot be manually validated in a dev environment.

---

**Time-acceleration in testing**

**Rating: PARTIAL**

`canonical_metric_history.is_backfill: boolean` exists — explicitly designed for inserting backdated records. This allows a seed or fixture to write metric history with past `period_start`/`period_end` timestamps, which would make rolling health scores compute as if time has passed.

There is no explicit time-travel API or test-mode clock override. But the schema supports backdated data insertion, which is the practical equivalent for testing trend logic.

---

**Sandbox vs production GHL accounts**

**Rating: UNCLEAR**

`integration_connections` has no `is_sandbox: boolean` or `environment: 'sandbox' | 'production'` column. There is no mechanism in the current schema to mark a GHL connection as a test account vs a live-money account.

`docs/create-ghl-app.md` discusses using the developer's own test agency (Phase 0) vs external design-partner agencies (Phase 1), but this distinction is operational — no code-level flag prevents actions on a test vs production connection. For a design-partner onboarding where one connection is real and another is a test, there is no safety rail.

---

### 4b — Observability and ops

**Per-tenant audit log queryable by agency**

`audit_events` is indexed by `(organisation_id, created_at)`. Queryable at org level. ✓

`agent_runs` is indexed by `(subaccount_id, status)`. Per-client run history queryable. ✓

Gap: `audit_events` has no `subaccount_id` column (noted in 2a-7). Agency cannot directly query "all actions for client X" without a multi-step JOIN.

---

**Cost tracking surfaced to agency**

`cost_aggregates` with `entity_type='subaccount'` provides per-client LLM cost aggregation. ✓

`iee_runs` costs are tracked separately via `ieeUsageService`. ✓

Gap: No unified per-client "total cost" view that combines LLM costs + IEE costs + external API fees into a single number the agency can see per client per billing period. The data is available in separate tables; no aggregation endpoint or view joins them.

---

**Failure mode visibility**

`system_incidents`, `system_incident_events`, `system_incident_suppressions` schemas exist. `systemMonitorSelfCheckJob` runs. ✓

`agent_runs` status `'failed' | 'timeout' | 'loop_detected' | 'budget_exceeded'` indexed per org. Agency can query failed runs. ✓

Gap: No per-org alerting surface that notifies the agency owner when a scheduled agent run fails. The `notify_operator` action type exists but must be explicitly configured as a response to a failure event. There is no default "agent run failed" → "notify org admin" pipeline out of the box.

---

**Backups and disaster recovery**

Neon provides point-in-time recovery (PITR). This cannot be verified from the codebase; it is an infrastructure configuration question.

The codebase has no backup-automation scripts, no restore-test fixtures, and no documented recovery SLA. For a design partner with real data, this is a gap that needs an answer outside the code — but the absence of any backup-related code means there is no application-layer backup supplement if Neon PITR is the only mechanism.

---

### 4c — White-label, branding, and agency reseller mechanics

**Per-organisation branding configuration**

`organisations` schema: `logo_url`, `brand_color` (hex), `agent_persona_label` (default 'COO'). ✓

These fields are present and data-driven.

Gap: Email `from` name and `from` address are not per-org configurable fields in the schema. Client-facing report emails would use a system default sender. For agencies that want their clients to receive reports from "Acme Agency Reports" at a custom domain, this is not supported at v1.

---

**Sub-account-level branding overrides**

**Rating: ABSENT**

`subaccounts` schema has no `logo_url`, `brand_color`, or any branding column. Sub-account-level branding (agencies with individual clients branded differently) is not supported in the current schema. Org-level branding applies uniformly to all sub-accounts.

---

**Agency reseller pricing model**

`org_margin_configs`: margin multiplier + fixed fee per org. Supports pass-through cost with markup. ✓

`org_subscriptions`: per-org Stripe subscription lifecycle. ✓

Gap: No per-client billing visibility for the agency owner. An agency cannot see "client X cost us $12 in agent invocations this month" through a first-class UI — the data exists in `cost_aggregates` but there is no per-sub-account billing statement or invoice generation path. Explicitly flagged as out of scope for soft launch in the brief.

---

### 4d — Documentation and onboarding

**Design-partner onboarding runbook**

**Rating: ABSENT as a runbook**

`docs/create-ghl-app.md` covers GHL app registration step-by-step. `docs/setup-42macro-reporting-agent.md` covers setting up a specific reporting agent. Neither is a "new agency from signed up to first ROI report rendered" end-to-end runbook.

The steps that would be in such a runbook (as a precondition to soft launch):
1. Create agency org in Automation OS
2. Install GHL Marketplace app → OAuth flow → token stored
3. Sub-account enumeration triggered (INSTALL webhook)
4. Initial connector sync → canonical accounts + metrics populated
5. Health score computed for each sub-account
6. Portfolio Health Agent activated
7. First portfolio rollup report generated
8. Agency owner reviews and optionally sends to clients

No document covers steps 2–8 end-to-end. Gap.

---

**Internal documentation hygiene**

`CLAUDE.md` at root: current (reviewed in this session, references architecture.md, docs/capabilities.md, agents, etc.). ✓

`architecture.md`: not read in full in this audit but referenced correctly from CLAUDE.md. No staleness signals visible.

`docs/capabilities.md`: updated 2026-04-21 per its own header. Actively maintained. ✓

`docs/AGENTS.md`: present in `docs/` directory. Content not read in this audit. **UNCLEAR** if current.

---

**Decision log for soft-launch vs deferred**

**Rating: ABSENT as a single document**

`tasks/todo.md` and `docs/deferred-work.md` exist. Neither is a single "feature X: soft-launch | deferred | out of scope | reasoning" registry. The brief's `Section 4e` lists explicit deferrals but these live only in the brief itself, not in a project-tracked decision document.

---

### 4e — Out of scope for soft launch

Per the brief, the following are explicitly deferred and were not audited:

- HubSpot connector (full CRM-level) — consistent with ABSENT adapter finding in Moat 2
- ClientPulse-only HubSpot adapter (read-only metrics) — deferred
- Cross-agency benchmarks — consistent with ABSENT finding in 2a-5
- Public app listing and GHL security review — consistent with "Private" rating in 3.8
- Voice AI integration — not in scope

---

## 5. Section 3 — GHL Integration Audit

Primary sources: `server/config/oauthProviders.ts`, `server/adapters/ghlAdapter.ts`, `server/db/schema/integrationConnections.ts`, `server/db/schema/connectorConfigs.ts`, `server/services/connectionTokenService.ts`, `server/lib/rateLimiter.ts`, `docs/create-ghl-app.md`.

---

### 3.1 — OAuth target user type (Agency vs Sub-account)

**Rating: UNCLEAR — launch blocker**

**What is documented:**
- `docs/create-ghl-app.md` (line 71) explicitly states: target user = **Agency**. "Agency-type apps install once at agency level and access all sub-accounts via a single OAuth install — critical for ClientPulse."
- The same document lists this as the correct architectural choice and warns that Sub-Account type would "force per-client installation and ruin the onboarding UX."

**What is in code:**
- `server/config/oauthProviders.ts` line 53: `authUrl: 'https://marketplace.leadconnectorhq.com/oauth/chooselocation'`
- `chooselocation` is the GHL sub-account chooser endpoint. The agency-level OAuth initiation URL is different (exact URL unverified from this codebase — it is not present in any source file read).
- `docs/create-ghl-app.md` line 422 explicitly flags: "Whether this works for every endpoint in the current GHL API version is unverified. **Verify by installing against a real GHL agency with 3–5 sub-accounts** and calling `fetchContacts`, `fetchOpportunities`, `fetchConversations`, `fetchRevenue`. If any fail, add a `getLocationToken` helper."

**Conclusion:** The intent is agency-level but the configured `authUrl` matches the sub-account flow. The intent-vs-implementation gap has not been closed by an end-to-end test against a real agency account. This is a launch blocker for the fleet-level value prop.

---

### 3.2 — OAuth scopes

**Current scopes (from `server/config/oauthProviders.ts`):**

| Scope | Status |
|---|---|
| `contacts.readonly` | Present ✓ |
| `contacts.write` | Present ✓ |
| `opportunities.readonly` | Present ✓ |
| `locations.readonly` | Present ✓ |
| `users.readonly` | Present ✓ |
| `calendars.readonly` | Present ✓ |
| `funnels.readonly` | Present ✓ |
| `conversations.readonly` | Present ✓ |
| `conversations/message.readonly` | Present ✓ |
| `businesses.readonly` | Present ✓ |
| `saas/subscription.readonly` | Present ✓ |

**Missing scopes (required per brief):**

| Scope | Required for | Status |
|---|---|---|
| `companies.readonly` | Discovering sub-accounts under the agency after install | **ABSENT** |
| `conversations.write` | Sending messages via Email Outreach Agent CRM actions | **ABSENT** |
| `opportunities.write` | Pipeline stage updates, deal value write-backs | **ABSENT** |
| `payments/orders.readonly` | Revenue trend metric (InvoiceCreated / PaymentReceived webhooks) | Not listed in scopes — `fetchRevenue` in ghlAdapter calls `/payments/orders` anyway, but scope is missing |

**Note:** The `locations.readonly` scope is present and used in `listAccounts` for sub-account enumeration. However, without `companies.readonly`, the agency-company-level lookup (needed before enumerating locations) is not scoped correctly for an agency install.

---

### 3.3 — Token storage and encryption

**Rating: PRESENT**

- `integration_connections.access_token` and `refresh_token`: stored as encrypted text fields. `connectionTokenService.encryptToken` / `decryptToken` uses AES-256-GCM (inferred from `client_id_enc` / `client_secret_enc` field naming convention; encryption key from environment). ✓
- `connection_token_service.ts` line 18: `const REFRESH_BUFFER_MS = 5 * 60 * 1000` (5-minute proactive buffer). ✓
- Multiple installs per org: `integration_connections` can have multiple rows per `(organisation_id, provider_type)` differentiated by `label`. ✓
- `connection_status` column: `'active' | 'revoked' | 'error'`. Revoked install observable. ✓
- `oauth_status` column: `'active' | 'expired' | 'error' | 'disconnected'`. Fine-grained status. ✓
- Isolation by org_id: FK enforced, RLS protected. ✓

---

### 3.4 — Token refresh strategy

**Rating: PARTIAL**

**What exists:**
- `connectionTokenService.refreshIfExpired`: checks `token_expires_at` with a 5-minute buffer before the call. Proactive relative to each request — not just on 401. ✓
- `performTokenRefresh` has GHL-specific branch (inferred from `gmail` and `hubspot` branches in the grep output; GHL refresh path follows same pattern). ✓
- Refresh token encrypted on update. ✓

**What is missing:**
- Refresh is **lazy** (triggered at request time). If an agency's GHL connection has no agent activity for >24 hours, the access token expires and is only refreshed on the next request. For long-running intervals (e.g., a weekend with no scheduled runs), the first post-gap request will incur a synchronous refresh before proceeding.
- **No background proactive refresh job.** A cron that sweeps `integration_connections WHERE token_expires_at < now() + interval '30 minutes' AND connection_status = 'active'` and refreshes pre-emptively does not exist. This is a production stability gap for reliable polling cadence.

---

### 3.5 — Webhook receiver: signature validation and per-org routing

**Rating: PARTIAL**

**What exists:**
- `ghlAdapter.webhook.verifySignature` (`server/adapters/ghlAdapter.ts` line 254): HMAC-SHA256 signature verification using `crypto.timingSafeEqual`. ✓
- `connector_configs.webhook_secret` field: per-connector webhook secret stored. ✓
- `ghlAdapter.webhook.normaliseEvent`: extracts `locationId` from payload to route the event to the correct sub-account. ✓
- `ghlAdapter.webhook.normaliseEvent` returns `null` for unknown event types (safe default). ✓

**What is missing / UNCLEAR:**
- The webhook receiver route itself (likely `server/routes/webhooks.ts` or similar) was not read in this audit. The question of whether the receiver: (a) looks up `locationId` → `organisation_id` from the DB without trusting client headers, and (b) applies RLS-scoped queries, is **UNCLEAR**. The normalisation layer correctly extracts `locationId`, but the resolution step is in the route handler.
- `docs/create-ghl-app.md` line 510 notes `INSTALL` and `UNINSTALL` webhook events are critical for triggering initial sync and cleanup respectively. Whether these are handled in the receiver is **UNCLEAR** from this audit.

---

### 3.6 — Rate-limit handling

**Rating: PARTIAL — architecturally weak for production**

**What exists:**
- `getProviderRateLimiter('ghl')` called before every GHL HTTP call in `ghlAdapter.ts`. Keyed per-location (`locationKey`). ✓
- `acquireGhlToken('global')` for agency-wide calls. ✓
- `rateLimiter.ts` `onThreshold` callback for warning at <20% tokens remaining. ✓
- `classifyAdapterError` returns `{ code: 'rate_limited', retryable: true }` on HTTP 429. Caller can retry. ✓
- `connectorPollingSync.ts` uses `withBackoff` with `maxAttempts: 3`. ✓

**What is missing / architecturally weak:**
- **In-memory only.** `server/lib/rateLimiter.ts` header: "In-memory for MVP (not shared across server instances)." Rate-limit bucket state is per-process. On a multi-instance deploy (Replit scales horizontally under load), each instance maintains its own token bucket, multiplying effective throughput by the instance count. An agency with 50 active sub-accounts and 3 server instances would send 3× the intended rate.
- **No daily request counter.** GHL enforces 200,000 API requests per day per app per resource. There is no counter tracking daily request volume against this ceiling. With 50 sub-accounts syncing every hour at ~10 API calls per sub-account, that is ~12,000 calls/day — well within the limit at small scale, but untracked.
- **No circuit breaker.** Sustained 429 responses from GHL would not trip a circuit breaker; the system would retry on each `withBackoff` attempt and eventually mark the sync as errored, but would not pause all outgoing calls while degraded.

---

### 3.7 — Bulk install behaviour (agency with many sub-accounts)

**Rating: PARTIAL**

**What exists:**
- `connectorPollingTick.ts` (`server/jobs/connectorPollingTick.ts`): cross-org cron sweep every minute, fans out one `connector-polling-sync` job per connection. Uses `singletonKey: connector-polling-sync-${connectionId}` — idempotent, no duplicate jobs. ✓
- `connectorPollingSync.ts`: lease-based sync with `sync_lock_token` to prevent concurrent syncs on the same connection. ✓
- `orgSubaccountMigrationJob.ts` exists — handles org-level subaccount migration/enumeration. Likely the hook for initial sub-account sync at install.

**What is missing / UNCLEAR:**
- The `INSTALL` webhook handler that triggers initial `/locations/search` enumeration and canonical-account creation for all sub-accounts at install time is not confirmed. If a 60-sub-account agency installs the app and the install webhook does not trigger a backgrounded bulk enumeration job, sub-accounts would only be discovered over the first polling cycle (potentially 60 minutes before all are known).
- `listAccounts` in ghlAdapter uses `limit: 100` (hardcoded). For an agency with >100 sub-accounts, pagination is not implemented. This is a correctness gap for large agencies.

---

### 3.8 — Private vs public app

**Rating: PRESENT** (by documented intent)

- `docs/create-ghl-app.md` line 76: "Key constraint surfaced on this dialog — 5-agency cap on Private apps."
- Lines 387–390: phase plan for staying Private (0 external agencies at phase 0, 3–5 at closed beta).
- Plan to pursue public listing review before the third design partner is documented. ✓
- 5-agency cap understanding is accurate and documented with migration path. ✓

---

## 4. Section 2b — ClientPulse Action Capability Audit

Agent layer source: `companies/automation-os/agents/`, `server/skills/`, `server/jobs/`. Gate model source: `server/db/schema/policyRules.ts`, `server/jobs/proposeClientPulseInterventionsJob.ts`.

---

### 2b-1 — Auto-generate monthly client-facing ROI report with white-label branding

**Rating: PARTIAL**

**What exists:**
- `client-reporting-agent` system agent defined in `companies/automation-os/agents/client-reporting-agent/AGENTS.md`. ✓
- `reports` table (`server/db/schema/reports.ts`): `html_content`, `report_type` ('portfolio_health' | 'ad_hoc'), `total_clients`, `healthy_count`, `attention_count`, `at_risk_count`, per-org indexing. ✓
- Org-level branding: `organisations.logo_url`, `organisations.brand_color` (hex), `organisations.agent_persona_label`. Applied at org level. ✓
- `portfolioRollupJob` produces weekly reports. ✓
- Gate model: auto-send if confidence high / review gate if anomalies — achievable via `policy_rules` but requires configuration.

**What is missing:**
- **No ROI narrative synthesis.** Reports are portfolio health summaries (healthy/attention/at-risk counts). Without a baseline snapshot, an "ROI since engagement start" narrative cannot be generated.
- `report_generation`, `brand_resolution`, `narrative_synthesis` skills: not found as verifiable system skill slugs in the schema from this audit pass. The agent definition file was not read to confirm skill registration. **UNCLEAR.**
- Sub-account-level branding overrides: `subaccounts` table has no `logo_url`, `brand_color` columns. Agencies that brand individual clients differently cannot do so at v1.
- Email sender name / from-address: not present as per-org configurable fields in `organisations` schema. Sender identity for client-facing reports is not data-driven.

---

### 2b-2 — Trigger re-engagement campaign when a client account shows churn-risk signals

**Rating: PARTIAL**

**What exists:**
- `proposeClientPulseInterventionsJob` evaluates churn assessments and generates action proposals. ✓
- CRM action primitives: `crmSendEmailServicePure`, `crmSendSmsServicePure`, `crmFireAutomationServicePure` (`server/skills/`). GHL-backed. ✓
- `email-outreach-agent` system agent exists. ✓
- `crm-pipeline-agent` system agent exists. ✓
- Gate: `gateLevel='review'` hardcoded in the job ("locked contract (b)"). Review gate enforced by default. ✓
- Idempotency: `buildScenarioDetectorIdempotencyKey` prevents duplicate proposals per churn assessment + template. ✓

**What is missing:**
- "Block gate if signals contradict each other": not implemented. There is no signal-contradiction check in `proposeClientPulseInterventionsPure`. The proposer suppresses proposals via cooldown and quota, not via signal consistency evaluation.
- Audience segmentation at the contact level within a sub-account (the brief's `audience_segmentation` skill): not verifiable from this audit. The action payload targets a sub-account, not a filtered contact segment within it.
- Campaign sequencing (multi-step drip): `crm.fire_automation` fires a GHL automation, which can be multi-step — but the orchestration lives on the GHL side, not within a platform playbook DAG.

---

### 2b-3 — Notify agency owner when client health drops below threshold

**Rating: PRESENT**

**What exists:**
- `clientPulseOperatorAlertServicePure.ts` (`server/skills/clientPulseOperatorAlertServicePure.ts`): `notify_operator` action type (renamed from `clientpulse.operator_alert`). ✓
- `operatorAlertPayloadSchema`: `title`, `message`, `severity` ('info' | 'warn' | 'urgent'), `recipients` (preset or custom), `channels` (['in_app', 'email', 'slack']). ✓
- `filterChannelsAgainstAvailability`: respects which channels are actually configured for the org. ✓
- Alert itself routes `auto`; any agency-side action it suggests would be `review`. Appropriate gate split. ✓
- `proposeClientPulseInterventionsJob` calls this via `enqueueInterventionProposal` with `source='scenario_detector'`. ✓

---

### 2b-4 — Suggest specific remediation playbooks based on diagnosed risk pattern

**Rating: PARTIAL**

**What exists:**
- `proposeClientPulseInterventionsPure` (`server/services/clientPulseInterventionProposerPure.ts` — inferred from job import): template-based proposal engine. Evaluates templates against band + health score. ✓
- Intervention templates are per-org configurable via `orgConfigService.getInterventionTemplates`. ✓
- Always review gate for suggestions ("decision-support, not autonomous action"). ✓

**What is missing:**
- "Pattern_matching against historical resolutions": not implemented. Playbook recommendation is template-driven (org configures templates, the scorer selects matching ones). There is no ML or similarity-based pattern matching against `intervention_outcomes` to recommend "the playbook that historically worked best for this risk pattern."
- `intervention_outcomes` table (`server/db/schema/interventionOutcomes.ts`) tracks `health_score_before`, `health_score_after`, `outcome` ('improved' | 'unchanged' | 'worsened'). The data structure for learning from outcomes exists, but no feedback loop reads it to influence future template selection.

---

### 2b-5 — Capture and normalise prior-period baseline data at client onboarding

**Rating: ABSENT**

**What exists:**
- `onboarding-agent` system agent exists in `companies/automation-os/agents/onboarding-agent/AGENTS.md`. ✓
- `subaccount_onboarding_state` schema exists. ✓

**What is missing:**
- No `baseline_intake` skill in the onboarding agent's skill list (agent definition not fully read — UNCLEAR — but no `baseline_snapshots` table exists to write to, so the skill would have nowhere to persist data regardless).
- No data validation or normalisation pipeline for prior-period manually-entered numbers.
- Block gate on incomplete baseline: not implementable without the table and skill.

---

### 2b-6 — Generate quarterly business reviews packaged for agency-to-client delivery

**Rating: PARTIAL**

**What exists:**
- `client-reporting-agent` + `business-analyst` system agents both exist. ✓
- `reports` table with `html_content`. ✓
- `portfolioRollupJob` runs sweeps that feed report generation. ✓

**What is missing:**
- No `qbr_synthesis` skill verifiable from this audit.
- Review gate enforcement for QBR specifically: `policy_rules` would need to be configured with a QBR-specific tool slug rule. No default QBR policy rule exists at org creation (same seeding gap noted in Moat 3).
- "Final document goes to agency owner for approval before delivery": delivery mechanism (email attachment, portal link) is not present. `reports.emailed_at` column exists but email delivery integration is not verified.

---

## 3. Section 2a — ClientPulse Diagnostic Capability Audit

Schema audit source: `server/db/schema/`. Agent layer source: `companies/automation-os/agents/` and `server/jobs/`.

---

### 2a-1 — Per-client baseline capture

**Rating: ABSENT**

**Required by brief:** Tables for `baseline_snapshots` tied to `client_id` and `engagement_start_date`. Immutable once captured. Baseline capture worker that runs once at onboarding.

**What exists:**
- `canonical_metric_history` (`server/db/schema/canonicalMetrics.ts`): append-only metric history with `is_backfill: boolean`. This provides rolling history but is not an engagement-start snapshot. No `engagement_start_date` column. Rows are mutable by overwrite via the dedup index.
- `canonical_entities` (`server/db/schema/canonicalEntities.ts`): has `baseline_value: numeric` on individual entity rows. This is a single field per entity, not a portfolio-wide point-in-time snapshot.
- `onboarding-agent` exists in the system agent registry.

**What is missing:**
- No `baseline_snapshots` table with `client_id`, `engagement_start_date`, and immutability semantics (no UPDATE path after insert).
- No baseline capture worker. The onboarding-agent has no `baseline_intake` skill registered in its AGENTS.md.
- No prior-period manual entry path for agencies with pre-existing clients.

**Org/subaccount isolation:** N/A — table does not exist.

---

### 2a-2 — Rolling client health score

**Rating: PRESENT**

**What exists:**
- `client_pulse_health_snapshots` (`server/db/schema/clientPulseCanonicalTables.ts`): `score` (integer), `factor_breakdown` (JSONB array of `{factor, score, weight}`), `trend` ('improving' | 'stable' | 'declining'), `confidence` (doublePrecision), `algorithm_version`, `observed_at`. Time series via `(subaccount_id, observed_at)` index.
- Org-level rollup index: `(organisation_id, observed_at)`. Portfolio-level query supported. ✓
- Portfolio Health Agent schedules every 4 hours (`schedule: "*/4 * * *"`).
- `portfolioRollupJob` (`server/jobs/portfolioRollupJob.ts`): weekly sweep (Mon briefing, Fri digest) across all orgs. ✓

**Org/subaccount isolation:** `organisation_id` + `subaccount_id` both required, not null. RLS enabled per spec reference in the schema file header. ✓

---

### 2a-3 — Churn-risk early warning

**Rating: PRESENT** (with one architectural note)

**What exists:**
- `client_pulse_churn_assessments` (`server/db/schema/clientPulseCanonicalTables.ts`): `risk_score`, `band` ('healthy' | 'watch' | 'atRisk' | 'critical'), `drivers` (JSONB array), `intervention_type`, `config_version`. ✓
- Org-level band index: `(organisation_id, band, observed_at)` for "show me all 'critical' clients across the portfolio" queries. ✓
- `proposeClientPulseInterventionsJob` (`server/jobs/proposeClientPulseInterventionsJob.ts`): event-driven off churn assessment, evaluates templates, applies cooldown and quota, writes proposals to `actions` table with `gate_level='review'`. ✓
- Cooldown checked against both `intervention_outcomes` (historical) and `actions` table (in-window). Two-source check is correct.
- Per-org configurable intervention templates via `orgConfigService.getInterventionTemplates(organisationId)`.
- `clientPulseOperatorAlertServicePure.ts` (`server/skills/clientPulseOperatorAlertServicePure.ts`): `notify_operator` action type, multi-channel fan-out (in_app, email, slack), severity classification. ✓

**Architectural note:** Churn threshold bands ('watch', 'atRisk', 'critical') are evaluated by the pure scorer. Per-org threshold overrides for when a client transitions between bands are configurable via intervention templates, but the band cut-points themselves (e.g., `score < 40 = atRisk`) appear to be hardcoded in the scorer, not stored in the DB as per-org configurable values. This is not a launch blocker but limits per-agency customization.

**Org/subaccount isolation:** Both columns required, not null. ✓

---

### 2a-4 — ROI delta tracking

**Rating: ABSENT**

**Required by brief:** Computed views or materialised tables joining `baseline_snapshots` to `current_metrics`. Per-client and per-portfolio rollups. Normalised for seasonality where possible.

**What exists:**
- `canonical_metrics` (`server/db/schema/canonicalMetrics.ts`): `current_value` + `previous_value` for rolling period-over-period delta. Covers e.g. "contacts grew 12% vs last 30d."
- `canonical_metric_history`: append-only history for baseline computation. `is_backfill` flag present.
- GHL adapter computes 5 metric slugs: `contact_growth_rate`, `pipeline_velocity`, `stale_deal_ratio`, `conversation_engagement`, `avg_response_time`, `revenue_trend`, `platform_activity` (`server/adapters/ghlAdapter.ts` lines 358–366).

**What is missing:**
- No `baseline_snapshots` table (as noted in 2a-1) — so there is no engagement-start anchor.
- No computed view or job that calculates "current metric vs baseline at engagement start."
- No per-portfolio rollup of ROI delta across all clients.
- Seasonality normalisation: not present anywhere in the codebase.

---

### 2a-5 — Cross-client benchmark (peer cohort comparison)

**Rating: ABSENT**

**Required by brief:** Cohort definitions, anonymised aggregate metrics, privacy-preserving rollups.

**What exists:**
- `integration_detections` and `integration_fingerprints` (`server/db/schema/clientPulseCanonicalTables.ts`): detects which third-party integrations a sub-account uses (e.g., "uses Stripe, Calendly"). This provides a lightweight cohort signal for "clients with similar toolstacks."
- `query_subaccount_cohort` is listed as a skill in the Portfolio Health Agent's AGENTS.md.

**What is missing:**
- No `cohort_definitions` table.
- No anonymised aggregate metrics table.
- No benchmark computation job.
- The `query_subaccount_cohort` skill is listed in the agent definition but no corresponding system skill handler is verifiable from the schema alone (skill handler keys live in `system_skills` which is DB-populated at seed time).

**Consistent with brief's deferred list:** Cross-agency benchmarks are explicitly deferred post-launch (requires data volume from multiple design partners). ABSENT is the correct state.

---

### 2a-6 — Agency-effort tracking

**Rating: PARTIAL**

**What exists:**
- `cost_aggregates` (`server/db/schema/costAggregates.ts`): `entity_type` supports `'organisation' | 'subaccount' | 'run' | 'agent'` among others. Per-subaccount LLM cost aggregation is available. ✓
- `agent_runs` with `input_tokens`, `output_tokens`, `total_tokens`, `duration_ms` per run, indexed by `(subaccount_id, status)`. Task counts (`tasks_created`, `tasks_updated`, `deliverables_created`) per run. ✓
- IEE costs tracked via `iee_runs` and surfaced in `ieeUsageService.ts`. ✓

**What is missing:**
- "Message volume per client" (inbound SMS/email volume handled by the agency) is not tracked as an effort metric. The CRM ingestion pipeline writes `canonical_conversations` counts but not an "agency sent N messages to client X's contacts" tally distinct from client activity.
- "Time per client" (human effort): no time-tracking concept exists in the schema. Agency effort is modelled as agent invocation cost, not human hours.
- Extension to all agent invocation costs (not just IEE): `cost_aggregates` covers LLM costs via `entity_type='run'`. Non-LLM costs (browser execution, voice, external API fees) are not represented.

**Org/subaccount isolation:** `entity_id` carries the scoped UUID. ✓

---

### 2a-7 — Audit trail of every agent action visible to the agency

**Rating: PARTIAL**

**What exists:**
- `audit_events` (`server/db/schema/auditEvents.ts`): `organisation_id`, `actor_id`, `actor_type` ('user' | 'system' | 'agent'), `action`, `entity_type`, `entity_id`, `correlation_id`, `created_at`. Indexed by `(organisation_id, created_at)`. ✓
- `agent_runs` with full status lifecycle, `organisation_id`, `subaccount_id`. ✓
- `review_audit_records`: HITL gate decisions logged. ✓
- `agent_execution_events` (`server/db/schema/agentExecutionEvents.ts`): live per-run event stream per the Live Agent Execution Log spec. ✓
- `actions` table: every agent-proposed action (including intervention proposals) with `gate_decision`, `status`, `organisation_id`, `subaccount_id`. ✓

**What is missing:**
- `audit_events` has **no `subaccount_id` column**. Filtering the audit log "for client X only" requires knowing which entity IDs (agent run IDs, action IDs, etc.) belong to that client — a multi-step JOIN, not a direct filter. For a design-partner demo where an agency wants to see "what did you do for client X this month", this is a UX friction point.
- `agent_execution_events` is per-run (in-flight). It is not a durable audit log queryable at portfolio level.
- Gate decision logging (`review_audit_records`): has `organisation_id` but needs confirmation of `subaccount_id` presence (not read in this audit; UNCLEAR).

---

## 2. Section 1 — USP Audit (Moats vs Agent Studio)

Rating scale: **PRESENT** (implemented and verifiable) | **PARTIAL** (core exists, named gaps) | **ABSENT** (not in codebase) | **UNCLEAR** (human resolution needed)

---

### Moat 1 — Fleet-level governance across many sub-accounts

**Rating: PARTIAL**

**What exists:**
- `organisations` is the agency entity. `subaccounts` has `organisation_id` FK, indexed. Every schema table that holds client data carries `organisation_id` + `subaccount_id`.
- `agent_runs` is indexed by `(organisation_id, status)` and `(subaccount_id, status)`, enabling org-wide failure-rate queries.
- `cost_aggregates` uses an `entity_type` / `entity_id` model supporting `entityType='organisation'` and `entityType='subaccount'` for per-client cost attribution (`server/db/schema/costAggregates.ts`).
- `portfolioRollupJob` (`server/jobs/portfolioRollupJob.ts`) sweeps all orgs weekly (Mon briefing, Fri digest) and writes portfolio-level inbox items.
- `reports` table (`server/db/schema/reports.ts`) stores org-level portfolio reports with per-org indexing.
- Per-org concurrency cap on GHL bulk ops via `organisations.ghlConcurrencyCap`.

**What is missing / architecturally weak:**
- `audit_events` (`server/db/schema/auditEvents.ts`) has `organisation_id` but **no `subaccount_id` column**. Per-client audit log queries require a JOIN through `agent_runs` or `review_audit_records`. Not directly queryable at portfolio level per client. This is a gap for the "per-client action log visible to agency" requirement.
- No explicit fleet-level dashboard surfacing per-client agent failure rates across the portfolio in a single query surface. The infrastructure is there (indexes, cost_aggregates) but no aggregation endpoint or materialized view for failure-rate-by-client is present.
- Agency-wide audit logs: `audit_events.actor_type` captures 'user' | 'system' | 'agent' but action routing to a specific sub-account requires knowing the `entity_id` ahead of time — no direct sub-account filter.

---

### Moat 2 — Cross-system orchestration

**Rating: PARTIAL**

**What exists:**
- `IntegrationAdapter` interface (`server/adapters/integrationAdapter.ts`) defines a pluggable contract: `crm`, `payments`, `ticketing`, `messaging`, `ingestion`, `webhook` capability groups. ✓
- Implemented adapters: `ghlAdapter`, `stripeAdapter`, `teamworkAdapter`, `slackAdapter` — all registered in `server/adapters/index.ts`. Three of four are non-GHL, confirming the abstraction is used, not just defined.
- `integration_connections.provider_type` enum: `'gmail' | 'github' | 'hubspot' | 'slack' | 'ghl' | 'stripe' | 'teamwork' | 'web_login' | 'custom'`. Multiple providers at the schema layer.
- `connector_configs.connector_type` at the polling layer: `'ghl' | 'hubspot' | 'stripe' | 'slack' | 'teamwork' | 'custom'`.
- Integrations live at `server/adapters/` (platform layer), not as agent skills. ✓

**What is missing / architecturally weak:**
- **HubSpot has no adapter implementation.** `hubspot` appears in `integration_connections.provider_type`, `connector_configs.connector_type`, and `server/config/oauthProviders.ts` (OAuth scopes defined: `contacts`, `content`, `deals`). But there is no `hubspotAdapter.ts` and no entry in `server/adapters/index.ts`. If a connector_config with `connector_type='hubspot'` exists, `connectorPollingService.ts` will dispatch to `adapters['hubspot']` which is `undefined` — a silent runtime failure.
- The `connectorPollingService.ts` comment "Stub — adapters will be wired here in P4+" (line 35) indicates HubSpot ingestion is intentionally deferred but the routing code does not guard against undefined adapter dispatch.
- No ClickUp, QuickBooks, Gusto, or Zendesk adapter — consistent with the brief's "at least one non-GHL integration scaffolded" criterion. Slack/Stripe/Teamwork satisfy this for soft launch.

---

### Moat 3 — Evaluation, rollback, and HITL governance at scale

**Rating: PARTIAL**

**What exists:**
- `policy_rules` (`server/db/schema/policyRules.ts`): `decision` column is `'auto' | 'review' | 'block'`, stored in DB per-org and optionally per-subaccount, with priority ordering and wildcard support. Gate model is **data-driven, not hardcoded**. ✓
- `policyRules.confidenceThreshold` overrides the global confidence gate per-rule. Per-org policy resolution via priority-ordered first-match evaluation.
- `regression_cases` schema exists. `regressionReplayJob` (`server/jobs/regressionReplayJob.ts`) exists.
- `review_audit_records` and `review_items` schemas exist for HITL decision logging.
- Intervention proposals are locked to `gateLevel='review'` in `proposeClientPulseInterventionsJob.ts` (line 9 comment: "locked contract (b)").

**What is missing / architecturally weak:**
- No evidence of org-wide eval suites that span multiple tenants. `regression_cases` is per-org (each org's regression ring buffer is isolated). There is no cross-org regression detection infrastructure.
- Default gate model seeding: the `policyRules` table is empty for new orgs at creation (no seeding call found in `scripts/seed.ts` for default wildcard rules). This means a new org has no `policy_rules` rows and falls through to hardcoded defaults in the policy resolution service. The "config not code" guarantee is only effective after an admin configures rules. **Architecturally weak** for day-1 orgs.
- Staging/production environment parity per agent: not present. Agents exist in `draft | active | inactive` states but there is no per-agent staging environment concept.

---

### Moat 4 — Run-code escape hatch (IEE / dev_task)

**Rating: PARTIAL**

**What exists:**
- IEE is implemented: `iee_runs`, `iee_steps`, `iee_artifacts` schemas; `ieeRunCompletedHandler.ts`; `agentRuns.execution_mode` includes `'iee_browser' | 'iee_dev'`.
- `worker/` directory contains IEE execution infrastructure.
- IEE usage service exists (`server/services/ieeUsageService.ts`) with per-org cost attribution.

**What is missing / architecturally weak:**
- IEE is **not wired as a step type in playbook DAGs**. The three workflow templates in `server/workflows/` (`event-creation.workflow.ts`, `intelligence-briefing.workflow.ts`, `weekly-digest.workflow.ts`) contain no IEE step type. The workflow step engine dispatches to agent runs; IEE is an alternative execution mode on an `agent_run`, not a composable DAG node.
- To invoke IEE within a playbook, the current path is: create an agent_run with `executionMode='iee_dev'` — which means the entire agent run is IEE, not a single step within a multi-step playbook. The brief's requirement that dev_task be "invokable as a step in playbook DAGs" is not met.
- `agentRuns.workflowStepRunId` exists (reverse link to a workflow step run) but this links an agent run back to its originating playbook step, not forward to IEE as a step.

---

### Moat 5 — Skill-driven agent behaviour

**Rating: PRESENT**

**What exists:**
- `skills` table (`server/db/schema/skills.ts`): three-tier (system / org / subaccount) with `skill_type: 'built_in' | 'custom'`. Agency-authored skills: `organisationId` set, `subaccountId` null. ✓
- `skill_versions` (`server/db/schema/skillVersions.ts`): immutable version history with `change_type`, `simulation_pass_count`, `regression_ids`. ✓
- `skill_embeddings` (`server/db/schema/skillEmbeddings.ts`): pgvector `vector(1536)` with content-hash dedup. Semantic search infrastructure is present. ✓
- `skill_analyzer_jobs`, `skill_analyzer_config`, `skill_analyzer_results` schemas. `skillAnalyzerJob.ts` exists. ✓
- `system_skills` with `handler_key` uniqueness enforced at write time and validated at boot. ✓
- `server/config/universalSkills.ts` for org-agnostic universal skill config. ✓
- Per-organisation enablement: agents reference `defaultSkillSlugs`; `subaccount_agents` copies skill slugs at link time. Effective at runtime.

**Architecturally weak (flag, not a blocking gap):**
- Per-org skill enablement is managed at the agent level via `defaultSkillSlugs`, not as a first-class toggle table per `(org_id, skill_id)`. A global toggle for "enable/disable skill X for all agents in org Y" requires updating each agent. This is a UX friction point for agency-authored skill catalogues, not a correctness issue.

---

### Moat 6 — Portfolio Health and ROI proof (ClientPulse)

**Rating: PARTIAL**

**What exists:**
- Portfolio Health Agent defined in `companies/automation-os/agents/portfolio-health-agent/AGENTS.md`: `slug: portfolio-health-agent`, skills: `compute_health_score`, `detect_anomaly`, `compute_churn_risk`, `generate_portfolio_report`, `query_subaccount_cohort`, `read_org_insights`, `write_org_insight`, `trigger_account_intervention`. ✓
- `client_pulse_health_snapshots` (`server/db/schema/clientPulseCanonicalTables.ts`): `score`, `factor_breakdown`, `trend`, `confidence`, `observed_at`. Time series per subaccount. ✓
- `client_pulse_churn_assessments`: `risk_score`, `band` ('healthy' | 'watch' | 'atRisk' | 'critical'), `drivers`, `intervention_type`. ✓
- `client_pulse_signal_observations`: multi-signal timeseries per subaccount, `signal_slug`, `numeric_value`, `availability`. ✓
- `subaccount_tier_history`: GHL subscription tier tracking per sub-account. ✓
- `proposeClientPulseInterventionsJob`: end-to-end wired. ✓
- `clientPulseOperatorAlertServicePure`: notify_operator action type. ✓

**What is missing (launch-blocking):**
- **No `baseline_snapshots` table.** The brief requires immutable per-client baselines captured at engagement start. `canonical_metric_history` is rolling (append-only), not point-in-time engagement-start. No `engagement_start_date` concept exists anywhere in the schema. ROI delta computation (`current - baseline`) has no baseline to anchor to.
- **No ROI delta computation.** `canonical_metrics` has `current_value` and `previous_value` (rolling period-over-period), not an engagement-start delta. No computed view or job that emits "ROI since onboarding" exists.

---



### Soft-Launch Readiness Rating: **CONDITIONAL**

The platform has solid bones for the ClientPulse launch story. The core data pipeline (GHL ingestion → canonical tables → health scoring → churn assessment → intervention proposals) is implemented end-to-end. The Portfolio Health Agent exists in the system agent registry, policyRules stores gate decisions in the database (not code), and four of six action primitives (notify_operator, crm.send_email, crm.send_sms, crm.fire_automation) are wired. The GHL adapter supports multi-location ingestion, token encryption, rate limiting, and webhook signature verification.

However, three gaps block the launch narrative as written:

### Top 3 Findings (present and solid)

1. **Health scoring and churn assessment pipeline is real.** `client_pulse_health_snapshots`, `client_pulse_churn_assessments`, and `client_pulse_signal_observations` are live schema with correct org/subaccount isolation and time-series indexing. The `proposeClientPulseInterventionsJob` is wired end-to-end with cooldown, quota, and HITL gate logic.
2. **HITL gate model is data-driven, not hardcoded.** `policyRules` stores `auto / review / block` decisions per-org with per-tool override. The brief's requirement for config-not-code is met.
3. **IntegrationAdapter interface is pluggable at the platform layer.** GHL, Slack, Stripe, and Teamwork adapters exist. HubSpot is registered in the schema and OAuth config but has no adapter implementation.

### Top 3 Gaps (blocking or launch-critical)

1. **No baseline snapshot table.** The brief declares ROI delta tracking "non-negotiable for the soft-launch story." There is no `baseline_snapshots` table with `engagement_start_date` and immutability semantics. `canonical_metric_history` tracks rolling history but not an immutable engagement-start baseline. ROI computation is structurally absent.
2. **GHL OAuth agency-level flow is unverified.** The `authUrl` in `server/config/oauthProviders.ts` uses `https://marketplace.leadconnectorhq.com/oauth/chooselocation` — the sub-account chooser endpoint. `docs/create-ghl-app.md` documents the intent to use Agency target type, explicitly flags that the agency-token-vs-location-token exchange is "unverified," and notes direct testing against a real agency has not been done. The `companies.readonly` scope (needed for sub-account enumeration) is absent from the registered scopes.
3. **In-memory rate limiter is not production-safe.** The GHL rate limiter (`server/lib/rateLimiter.ts`) is in-memory with no Redis or shared-state backend. Its own comment says "In-memory for MVP (not shared across server instances)." On a multi-instance deploy, rate-limit state resets per instance, risking GHL API throttling with no circuit-breaking.

---

