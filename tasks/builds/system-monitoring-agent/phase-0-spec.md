# System Monitoring Agent — Phase 0 + 0.5 Spec

**Status:** v4 — second reviewer pass incorporated; implementation-ready
**Owner:** Platform
**Scope:** Server + client + migrations
**Not included in this spec:** Phase 0.75 (email/Slack notifications — requires new outbound infrastructure), Phase 1 (synthetic checks), Phase 2 (monitoring agent), Phase 3 (auto-remediation), Phase 4 (dev-agent handoff). Future phases have stub sections at the end for context only.

---

## 0. Decisions log

v1 left 8 questions open and 5 prerequisites unverified. v2 resolved them. v3 incorporates reviewer feedback — 2 critical fixes, 5 high-impact improvements, 4 medium-impact refinements (see §0.5). Any decision the user wants to override is a simple edit to this section; downstream sections cross-reference back to here.

### 0.1 Prerequisites — verified against the current codebase

| ID | Question | Finding | Effect on spec |
|---|---|---|---|
| P1 | Is correlation ID propagation end-to-end? | **Partial.** Route middleware at `server/middleware/correlation.ts` attaches `req.correlationId`. But `agent_runs` has NO `correlationId` column, and pg-boss job payloads do not carry one by convention. | `correlationId` on `system_incidents` stays nullable. Route-source incidents always have it; agent/job/connector-source may have null initially. Phase 0 includes a prerequisite mini-migration adding `correlation_id` to `agent_runs` and a convention (documented in architecture.md) that new pg-boss job payloads include a `correlationId` field. Existing jobs are left alone — no bulk refactor. |
| P2 | Is email delivery available? | **Not available.** No nodemailer/sendgrid/postmark/mailgun/resend dependency or service. | **Email moves out of Phase 0.5.** See §0.2 Q-Notifications. |
| P3 | Is Slack outbound available? | **Not available.** No Slack SDK or outbound pattern. (Inbound webhook handling exists, not outbound.) | **Slack moves out of Phase 0.5.** See §0.2 Q-Notifications. |
| P4 | Do `tasks.linkedEntityKind` / `linkedEntityId` columns exist? | **No.** | Phase 0.5 migration adds both columns (nullable text + nullable uuid). |
| P5 | Does `user_settings` have notification preferences? | **No.** | Since email/Slack defer to Phase 0.75, the notification-preferences column also defers — it is added in Phase 0.75, not Phase 0.5. Phase 0.5 has no per-user preferences surface. |

### 0.2 Open questions — resolved

| ID | Question | Decision | Reasoning |
|---|---|---|---|
| Q1 | Table/domain naming | `system_incidents` (keep current naming) | Matches existing conventions: `system_admin`, `system_agents`, `requireSystemAdmin`, `SystemTaskQueuePage`, `SystemSkillsPage`. Consistency wins. |
| Q2 | Escalation target subaccount (§10.3) | **Option 3 hybrid, locked in.** Org-scoped incidents escalate inside their own org's sentinel subaccount (the existing pattern used by Orchestrator). System-level incidents escalate to a new seeded `System Operations` org + sysadmin subaccount, flagged `isSystemOrg: true` on `organisations`. Seeded via migration. | Keeps org-local context for org-specific faults (specialists have the data). Isolates system-wide faults into a dedicated surface that doesn't pollute tenant org task boards. |
| Q3 | Severity defaults per source (§5.5) | Keep table defaults as specified, with one addition: when `source='agent'` AND the run's agent is `isSystemManaged=true`, bump default severity to `high`. | Failures of system-managed agents (Orchestrator, Portfolio Health Agent, and the future monitor itself) are infrastructure failures, not tenant work failures. They deserve higher default attention. |
| Q4 | Notification `minSeverity` default | Deferred to Phase 0.75 (when notifications exist). For Phase 0.5 the question doesn't apply — no push notifications ship. | See Q-Notifications. |
| Q5 | Admin page polling interval (§8.5) | **10 seconds when tab visible; pause when backgrounded (Page Visibility API); manual refresh button in header; auto-refresh toggle.** | Active triage needs low latency; idle tabs should not burn DB. Giving the admin a toggle covers the edge case where someone wants to stop polling entirely. |
| Q6 | Daily digest in Phase 0.5 or later | **Not in Phase 0.5. Not in Phase 0.75. Phase 1 or later.** Low-priority incidents get NO push notification in this scope — they are visible on the admin page and in Pulse only. | Batching that doesn't deliver is a bug. Skip batching entirely at the Phase 0 scope; revisit once the page has run in production and we know whether a digest is actually wanted. |
| Q7 | Hard cap on permanent suppressions | **No hard cap. Warning banner above 25 active permanent suppressions. Monthly audit event emitted for permanent suppressions with no `linkedPrUrl` or `resolutionNote`.** | Hard caps in SRE tooling get worked around; social pressure via visibility is more effective. |
| Q8 | Test-incident trigger button | **Yes — include. "Trigger test incident" button at the top of the admin page.** Fires an incident with fingerprint prefix `test:manual:{timestamp}`, severity `low`, `isTestIncident: true` column. Default list filter hides test incidents; toggle to show. | Useful for post-deploy smoke testing and for verifying notification/escalation wiring in staging. Cost: tiny. |

### 0.3 Q-Notifications — scope-change decision

**Problem:** Phase 0.5 as v1-drafted assumed email + Slack were available infrastructure. P2 and P3 show they are not.

**Options considered:**

1. Build email + Slack outbound infrastructure as part of Phase 0.5 (SMTP config, Slack app registration, per-channel adapters, user preferences UI). **Rejected** — expands Phase 0.5 scope by ~40%, adds dependencies that aren't needed for the core observability value.
2. Stub email + Slack and ship Phase 0.5 with no-op notification channels. **Rejected** — ships dead code paths that pretend to work, creates confusion about what's real.
3. Carve email + Slack out into a new **Phase 0.75** that ships after Phase 0.5, before Phase 1. **Chosen.** Phase 0.5 is in-app only (admin page + Pulse + in-app bell badge in the header). Phase 0.75 adds email, Slack, user preferences UI, and the fatigue-guard refactor.

**Effect on Phase 0.5 scope:** removes §9.4 (email), §9.5 (Slack), §9.6 (user preferences), §9.9 (SMS stub), the email/Slack adapter files, and the notification-preferences schema change. Keeps §9.2 (notify job — still useful for in-app Pulse surfacing and future fan-out), §9.3 (fatigue guard — extract the base class now so Phase 0.75 can reuse it), §9.8 (observability of notifications in the event log).

**Effect on Phase 0.5 user experience:** sysadmins see incidents on the admin page, in Pulse, and via a red-dot badge on the Layout nav entry. They do NOT receive pushed email or Slack alerts. For in-development / in-staging monitoring that is sufficient.

### 0.4 Decisions that did NOT change from v1

The three-table schema, ingestor design shape, 7 integration points, principal-context Option A, incident lifecycle, escalate-to-agent via Orchestrator, and the broader rollout + risk framing all stand.

### 0.5 v3 changes — final-spec pass (reviewer feedback incorporated)

v2 went to an external reviewer. All blocking and high-impact findings are now incorporated. v3 is the last doc iteration before implementation begins.

**Critical fixes (blocking before v3):**

- **#1 Scope contradiction in §1 Summary.** v2 summary still claimed "multi-channel notifications (email + Slack)" even though §0.3 had carved those out. Summary now reads "in-app incident surfacing (admin page, Pulse, nav badge)" with explicit pointer to Phase 0.75 for push channels.
- **#2 Smoke-test step 6 referenced email/Slack delivery** which Phase 0.5 explicitly doesn't have. §12.3 replaced with Pulse visibility + nav-badge + WebSocket + admin page checks. Email/Slack smoke tests deferred to Phase 0.75's test plan.

**High-impact design improvements:**

- **#3 Fingerprint fragility under deploy-time volatility.** `topFrameOf()` in v2 included line numbers and column positions, which shift on every deploy → "same issue, new fingerprint, incident explosion." v3 introduces `topFrameSignature()` that strips `:line:col` suffixes, preserving function + file path only. Also added `IncidentInput.fingerprintOverride` so integrations with domain-stable identifiers (agent slug + error code, connector provider type + error code, etc.) bypass stack-derived fingerprinting entirely. See §5.2 for the override table.
- **#4 Severity never-de-escalates inflation risk.** Added explicit per-lifecycle-scope clarification to §5.6. Existing "new row after resolve" design already handles the long-term case correctly; v3 just documents it so operators don't think "once critical, always critical."
- **#5 Ingest-in-request-path latency risk.** v3 pre-wires a sync/async mode toggle via `SYSTEM_INCIDENT_INGEST_MODE=sync|async` env var, with `NODE_ENV=test` forcing sync. Async mode enqueues to a `system-monitor-ingest` pg-boss queue and runs identical ingestion logic in a worker. Shipping the toggle from day one avoids the emergency-refactor failure mode.
- **#6 Suppression silent failure mode.** v2 suppressions discarded signal entirely — no DB row, only a `logger.warn`. v3 adds `suppressed_count` and `last_suppressed_at` columns to `system_incident_suppressions`. Each blocked occurrence increments the counter. The admin suppressions UI surfaces the counts so operators can triage "is this suppression still useful or should it be lifted?"
- **#7 Unbounded manual escalation.** v2 allowed a user to escalate the same incident any number of times, each creating a new Orchestrator task. v3 adds `escalation_count` + `previous_task_ids[]` columns on `system_incidents`, a soft guardrail (409 + confirmation modal) when an incident is already escalated with a still-open prior task, a hard cap at 3 escalations per incident, and a 60-second per-incident rate limit. Blocked attempts write `escalation_blocked` events for observability. Full design in new §10.2.5.

**Medium-impact refinements:**

- **#8 Correlation ID promises.** Reframed §6.9 from "must be end-to-end before ship" to "best-effort enrichment, not required for correctness." Realistic timeline documented (incomplete for months, not days). No downstream system should critically depend on correlation IDs being present.
- **#9 Event-log derived fields.** Noted as a future denormalisation (`last_event_type` / `last_actor_kind` on `system_incidents`) if list-view performance degrades. Not built in Phase 0.5 — premature per CLAUDE.md §6.
- **#10 Pulse flood under incident storms.** Pulse getter now uses `DISTINCT ON (fingerprint)` with acknowledgement gating so: (a) five concurrent incidents sharing a fingerprint show as one card, (b) acked fingerprints don't re-surface on occurrence-count increments, only on severity escalations.
- **#11 Self-check noise threshold.** Added threshold + cooldown to §5.7. Self-incident fires only if ≥5 ingest failures in a 5-minute window AND no self-incident in the last 30 minutes. Env-configurable. Prevents noise from transient DB hiccups and the self-incident-storm failure mode.

**Schema additions in v3 (beyond what v2 already spec'd):**

| Table | Column | Purpose |
|---|---|---|
| `system_incidents` | `escalation_count integer NOT NULL DEFAULT 0` | #7 escalation guardrail |
| `system_incidents` | `previous_task_ids uuid[] NOT NULL DEFAULT '{}'` | #7 escalation history |
| `system_incident_suppressions` | `suppressed_count integer NOT NULL DEFAULT 0` | #6 suppression visibility |
| `system_incident_suppressions` | `last_suppressed_at timestamp` | #6 suppression visibility |

All four columns are additive; the core schema from v2 is unchanged.

**New env vars introduced in v3:**

| Name | Default | Purpose |
|---|---|---|
| `SYSTEM_INCIDENT_INGEST_MODE` | `sync` | #5 sync/async ingest toggle |
| `SYSTEM_INCIDENT_INGEST_ENABLED` | `true` | Kill switch (already in v2, retained) |
| `SYSTEM_MONITOR_SELF_CHECK_THRESHOLD_COUNT` | `5` | #11 self-check firing threshold |
| `SYSTEM_MONITOR_SELF_CHECK_COOLDOWN_MINUTES` | `30` | #11 self-check cooldown |
| `SYSTEM_INCIDENT_NOTIFY_MILESTONES` | `10,100,1000` | Notification recurrence thresholds (already in v2, retained) |

No v3 change rolls back any v2 decision. All v3 additions are additive refinements on the existing design shape.

### 0.6 v4 changes — second reviewer pass

v3 went back to the reviewer. Verdict: "implementation-ready, no architectural blockers." All concrete actionable findings are now incorporated; items the reviewer flagged as "future-proofing / no change required now" are captured as deferred-enhancement notes in-section rather than built.

**Applied in v4:**

- **#1 Async ingest ordering semantics (§5.8.2 new).** Made explicit: upsert + event append + notify-enqueue happen inside one transaction; WebSocket push fires only from the notify job handler (post-commit); client UI must tolerate eventual consistency and must treat WS events as hints, not source of truth. WebSocket payload now carries `incidentId + fingerprint + severity + status + occurrenceCount` for targeted client-side refresh (avoids full-page refetch during incident storms).
- **#2 Fingerprint override governance contract (§5.2).** Overrides promoted from guidance to binding contract: must match regex `^[a-z_]+:[a-z0-9_.-]+(:[a-z0-9_.-]+)+$` (domain + error identifier minimum), rejected overrides log and fall back to stack-derived fingerprinting, per-integration unit tests required. Prevents fragmentation / collision drift.
- **#5 Resolution feedback loop (§4.2, §7.2).** New `resolution_linked_to_task` event type. Emitted when `resolveIncident` runs against an incident that had been escalated — captures the escalation→resolution outcome as a training signal for Phase 2. Nullable `wasSuccessful` field reserved for a future UI prompt; not populated in Phase 0.5.
- **#6 Pulse blast-radius awareness (§10.1).** Dedupe query extended with a `distinct_org_count` aggregate. Subtitle surfaces it when > 1 org is affected: "agent · 120× · 8 orgs · 2m ago". Makes cross-org systemic issues impossible to hide behind single-card dedupe.
- **#7 Test-incident triggerNotifications flag (§8.9).** Test trigger gains an optional full-pipeline mode (default OFF) that lets the operator exercise the WebSocket + Pulse + nav-badge flow end-to-end. Rate-limited to 2/hour, confirmed via modal, summary tagged `[TEST]`, never auto-escalates.
- **#9 Queue naming consistency (§5.7, §5.8.1, §9.2, elsewhere).** All pg-boss queues renamed from `systemMonitor.*` (camelCase, inconsistent with existing codebase) to `system-monitor-*` (kebab-case, matching existing convention — verified against `connector-polling-sync`, `iee-run-completed`, `skill-analyzer`). Four queues affected: `system-monitor-ingest`, `system-monitor-notify`, `system-monitor-self-check`, `system-monitor-triage` (Phase 2).

**Deferred in v4 (reviewer explicitly said no change required now):**

- **#3 Peak vs current severity** — noted in §5.6 as a future enhancement; revisit after 4 weeks in production when oscillation data exists.
- **#4 Suppression blast-radius (`distinctResourceCount`)** — noted in §4.3 as a future enhancement; revisit if suppression volume ever trips the Q7 monthly audit.
- **#8 Cascading-failure heartbeat detection** — noted in §5.7 as a future enhancement; revisit 2 weeks after production cutover when ingest rate baselines become stable.

**Schema additions in v4 (beyond v3):**

None. All v4 changes are behavioural / naming / contract-level — no new columns, no new tables. Schema footprint matches v3.

**Event-type additions in v4:**

- `resolution_linked_to_task` (§4.2, per #5)

**No rollbacks of v2 or v3 decisions.** v4 is purely additive / refining.

---

## Table of contents

0. [Decisions log](#0-decisions-log)
1. [Summary](#1-summary)
2. [Context](#2-context)
3. [Goals, non-goals, success criteria](#3-goals-non-goals-success-criteria)
4. [Phase 0 — Schema](#4-phase-0--schema)
5. [Phase 0 — Ingestion service](#5-phase-0--ingestion-service)
6. [Phase 0 — Integration points](#6-phase-0--integration-points)
7. [Phase 0.5 — Routes, permissions, principal context](#7-phase-05--routes-permissions-principal-context)
8. [Phase 0.5 — Admin UI](#8-phase-05--admin-ui)
9. [Phase 0.5 — In-app notifications](#9-phase-05--in-app-notifications)
10. [Phase 0.5 — Pulse integration + manual-escalate-to-agent](#10-phase-05--pulse-integration--manual-escalate-to-agent)
11. [File inventory](#11-file-inventory)
12. [Testing strategy](#12-testing-strategy)
13. [Rollout plan](#13-rollout-plan)
14. [Dependencies and assumptions](#14-dependencies-and-assumptions)
15. [Risk register](#15-risk-register)
16. [Future phases (summary only)](#16-future-phases-summary-only)

---

<!-- Sections below are written in chunks via Edit. -->

## 1. Summary

Build the observability foundation required to support a future system-level monitoring agent, without building the agent itself. Phases 0 and 0.5 deliver:

- A single **central incident sink** that captures every system-fault across the platform (routes, jobs, agent runs, connectors, skill executions, LLM calls).
- A **system admin incident page** that lists active incidents, supports ack/resolve/suppress, and gives sysadmins one place to triage faults.
- **In-app incident surfacing**: the admin page, Pulse (internal lane), a Layout nav red-dot badge, and a WebSocket push that refreshes those surfaces sub-second on new incidents. **Push channels (email / Slack / SMS) defer to Phase 0.75** — this codebase has no outbound email or Slack SDK today; adding them is a separable follow-up phase.
- A **manual "Escalate to agent" affordance** that hands an incident to the existing Orchestrator pipeline for on-demand agent-led diagnosis — no new autonomous agent yet.

Phase 0/0.5 explicitly does NOT include: push notifications (Phase 0.75), automated agent triage, auto-remediation, synthetic/heartbeat checks, or dev-agent handoff. Those are deferred to Phases 0.75–4, scoped after 2–4 weeks of real production incident data have accrued in the new sink.

## 2. Context

### 2.1 Vision recap

The long-term goal is a system-managed monitoring agent — scope `system`, not `org` — that watches the whole platform in real time, self-diagnoses issues, self-fixes simple ones (retry, throttle, flag-flip), and escalates anything requiring human judgement. Eventually, persistent defects hand off to a development agent. This spec covers the first two phases only: observability foundation + manual triage surface.

### 2.2 Why not build the agent now

Four reasons drive the phased approach:

1. **No real incident data yet.** Pre-production, errors are transient dev-time artefacts, not patterns worth designing remediations for.
2. **Primitives are still moving.** Recent merge renamed `processes → automations`, `playbooks → workflows`, `workflow_runs → flow_runs` (migrations 0219–0222). An agent wired into moving surfaces becomes a maintenance liability.
3. **Agent value scales with saved human-hours.** Pre-production the saved hours are zero; post-production they are meaningful.
4. **Auto-remediation against an unstable app masks signal.** During stabilisation we want raw unremediated error streams, not an agent papering over bugs.

Phase 0 gives immediate value regardless of whether the agent ever ships: stabilisation sessions stop hunting errors across stdout, `agent_runs.errorMessage`, `connector_configs.lastSyncError`, `pgboss.job`, and `workspace_health_findings` — it's all in one table.

### 2.3 What already exists (merge-aware)

The audit + post-merge review found strong primitives to reuse and one critical gap:

**Reuse (do not rebuild):**

| Primitive | Location | How we use it |
|---|---|---|
| JSON logger with correlation IDs | `server/lib/logger.ts` | Ingestion service calls `logger.error()` alongside DB write for durability |
| Global Express error handler | `server/index.ts:343–385` | Extend to call ingestor before responding |
| `asyncHandler` error capture | `server/lib/asyncHandler.ts` | Extend `unhandled_route_error` path to ingest |
| Error classification taxonomy | `server/services/middleware/errorHandling.ts` | Reuse `ErrorCategory` enum for `classification` column |
| DLQ monitor | `server/services/dlqMonitorService.ts` | Ingest from `job_dlq` logger event path |
| Workspace health findings pattern | `server/services/workspaceHealth/` | Schema precedent for `detector + severity + resource + message + recommendation + resolvedAt` |
| `AlertFatigueGuard` | `server/services/alertFatigueGuard.ts` | Extract generic base class; reuse for notification dedupe |
| Severity taxonomy `low \| medium \| high \| critical` | `anomaly_events`, Portfolio Health Agent | Adopt identical enum — no new taxonomy |
| System-managed agent pattern | Orchestrator (migration 0157) + Portfolio Health Agent (migration 0068) | Blueprint for Phase 2 agent; Phase 0.5 manual-escalate reuses Orchestrator routing |
| Pulse supervision home | `server/services/pulseService.ts` (already has `failed_run` kind) | Add `system_incident` kind for sysadmin lane |
| System admin route pattern | `server/routes/jobQueue.ts` with `requireSystemAdmin` | Mirror for `systemIncidents.ts` |
| System admin UI precedent | `JobQueueDashboardPage.tsx` | Mirror layout/interactions for `SystemIncidentsPage.tsx` |

**Critical gap (the thing this spec fixes):**

There is no central error/incident table. Errors live in five different surfaces (`agent_runs.errorMessage`, `connector_configs.lastSyncError`, `pgboss.job`, `workspace_health_findings`, stdout logs) with no cross-surface aggregation, no dedupe, no lifecycle, and no sysadmin UI. The global error handler at `server/index.ts:343` writes to stdout and discards the error. Phase 0 closes this gap.

## 3. Goals, non-goals, success criteria

### 3.1 Goals

**Phase 0:**

- G0.1 Every system-fault error across the platform is written to a single `system_incidents` table within 100ms of the error occurring.
- G0.2 Errors are deduplicated by fingerprint so one recurring problem appears as one incident with a rising `occurrence_count`, not N separate rows.
- G0.3 Errors are classified `user_fault` vs `system_fault` at ingest time. Only `system_fault` incidents are eligible for notification or agent escalation.
- G0.4 Every occurrence, status change, and human action against an incident is captured in an immutable `system_incident_events` append-only log.
- G0.5 The ingestion path never blocks or breaks the caller: a failed ingest write logs an error and returns silently; the original request/job completes normally.

**Phase 0.5:**

- G0.5.1 Sysadmins have one page (`/system/incidents`) showing all open incidents, sortable and filterable by severity, source, status, classification, org.
- G0.5.2 Sysadmins can ack / resolve / suppress / escalate-to-agent incidents from that page.
- G0.5.3 Critical and high severity system-fault incidents surface in-app via (a) Pulse under a new `system_incident` kind, (b) a red-dot badge on the Layout nav entry, and (c) the admin page's filtered default view. **Email and Slack push notifications defer to Phase 0.75** (see §0.3).
- G0.5.4 System incidents appear in Pulse for sysadmin users under a new `system_incident` kind (same mechanism as G0.5.3 — called out separately because Pulse is a distinct surface).
- G0.5.5 The "Escalate to agent" action creates a task scoped per §10.3 (org-scoped incidents → own org sentinel; system-level incidents → seeded `System Operations` subaccount), which the existing Orchestrator routes to an appropriate agent for diagnosis. No new system agent is created in this phase.
- G0.5.6 System admins can trigger a deliberate test incident from the admin page (§8.9) for pipeline verification. Test incidents are hidden from the default list.

### 3.2 Non-goals

- NG1 **No automated agent triage.** The `system-monitor-triage` pg-boss job pattern from the audit is deferred to Phase 2.
- NG2 **No auto-remediation.** No skills that retry jobs, disable flags, restart connectors, etc. Those are Phase 3.
- NG3 **No synthetic/heartbeat checks.** Phase 1.
- NG4 **No dev-agent handoff.** Phase 4.
- NG5 **No log persistence layer.** `logger.ts` keeps writing to stdout; we do not add a `system_logs` table in Phase 0. Incidents are the persistent record; full log bodies live in `errorDetail`/`payload` on the event row.
- NG6 **No user-facing incident surface.** Phase 0.5 is system-admin only. Customer orgs do not see system incidents.
- NG7 **No external observability integration** (Sentry, Datadog, Loki). Out of scope for this phase — can layer on later by hooking the same ingestion service.
- NG7.5 **No email, Slack, or SMS push notifications in Phase 0.5** — defers to Phase 0.75 per §0.3. The in-app Pulse + badge + admin-page surfaces cover Phase 0.5's supervision needs.
- NG7.6 **No per-user notification preferences in Phase 0.5** — deferred to Phase 0.75 with the push channels.
- NG8 **No replacement of existing per-surface error columns.** `agent_runs.errorMessage`, `connector_configs.lastSyncError`, etc. remain as they are — the new sink is additive. Don't rip up working code.
- NG9 **No migration of existing historical errors.** The table starts empty on deploy.
- NG10 **No breaking changes to the `asyncHandler` or global error handler public shape.** Response payloads to the client are unchanged; ingestion is a side-effect.

### 3.3 Success criteria (observable, measurable)

**Phase 0 is done when:**

- SC0.1 Triggering a 500 from any route writes a row to `system_incidents` with `source='route'` and the correlation ID linked.
- SC0.2 A failed pg-boss job that lands in a DLQ writes an incident with `source='job'` and the queue name in `affected_resource`.
- SC0.3 An `agent_runs` row transitioning to `status='failed'` writes an incident with `source='agent'` and the run ID linked.
- SC0.4 A connector poll failure writes an incident with `source='connector'` and the connection ID linked.
- SC0.5 A skill execution that classifies as non-retryable system-fault writes an incident with `source='skill'`.
- SC0.6 The same error fired 10 times in succession produces 1 incident row with `occurrence_count = 10` and 10 event rows.
- SC0.7 A `validation_error` or `permission_failure` does NOT produce an incident (user-fault filter works).
- SC0.8 Ingestion failure mode test: forcing the ingestor write to throw does NOT cause the original request to fail — it logs a `logger.error('incident_ingest_failed', ...)` and the caller sees a normal error response.

**Phase 0.5 is done when:**

- SC0.5.1 A sysadmin navigating to `/system/incidents` sees the list with correct filters and lifecycle actions working.
- SC0.5.2 Triggering a critical system-fault surfaces in the Pulse feed within one polling tick (10s), and the Layout nav entry shows a red-dot badge. (Email / Slack validation moves to Phase 0.75 SC set.)
- SC0.5.3 Firing the same critical incident 20 times in 5 minutes produces one incident row with `occurrence_count = 20` and 20 `occurrence` event rows. (Notification fatigue-guard validation is deferred to Phase 0.75 where push channels exist.)
- SC0.5.4 The "Escalate to agent" button creates a task in the correct subaccount per §10.3, Orchestrator routes it, and an agent run is created against the incident's context. The incident's status flips to `escalated` and an event row is written.
- SC0.5.5 Pulse for a sysadmin user shows a `system_incident` card for each open non-acked critical/high incident in their visible orgs.
- SC0.5.6 The "Trigger test incident" button (§8.9) creates an incident with `isTestIncident=true`, hidden from the default list; toggling "Show test incidents" reveals it.

### 3.4 Explicit non-requirements that often get scope-crept in

- We do NOT need real-time push (WebSocket) on the incidents page for Phase 0.5 — polling on a 10s interval is acceptable. Real-time can come in a later phase.
- We do NOT need a per-org view of system incidents — this is a single system-admin surface. Org admins see their issues through existing workspace health findings and agent-run failure surfaces.
- We do NOT need a mobile-optimised incident page. Sysadmin tooling is desktop.
- We do NOT need incident export (CSV/JSON). Add it when someone asks.
- We do NOT need SLA/response-time tracking. Defer until we have a reason.

## 4. Phase 0 — Schema

Three new tables. All created in a single migration. Column shapes aligned with existing conventions (`anomaly_events`, `workspace_health_findings`).

### 4.1 `system_incidents`

The canonical incident record. One row per unique fingerprint. Recurrence increments `occurrence_count`.

```ts
// server/db/schema/systemIncidents.ts
export const systemIncidents = pgTable(
  'system_incidents',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // Identity & dedupe
    fingerprint: text('fingerprint').notNull(),               // see §5.2 for algorithm
    source: text('source').notNull()                          // where the error came from
      .$type<'route' | 'job' | 'agent' | 'connector' | 'skill' | 'llm' | 'synthetic' | 'self'>(),
    severity: text('severity').notNull().default('medium')    // same taxonomy as anomaly_events
      .$type<'low' | 'medium' | 'high' | 'critical'>(),
    classification: text('classification').notNull().default('system_fault')
      .$type<'user_fault' | 'system_fault' | 'persistent_defect'>(),

    // Status lifecycle
    status: text('status').notNull().default('open')
      .$type<'open' | 'investigating' | 'remediating' | 'resolved' | 'suppressed' | 'escalated'>(),

    // Counts & timestamps
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    occurrenceCount: integer('occurrence_count').notNull().default(1),

    // Scope
    organisationId: uuid('organisation_id').references(() => organisations.id),  // NULLABLE — system-level incidents have no org
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),        // NULLABLE

    // Resource linkage (denormalised for quick UI rendering)
    affectedResourceKind: text('affected_resource_kind'),     // e.g. 'agent_run', 'flow_run', 'integration_connection', 'pg_boss_queue'
    affectedResourceId: text('affected_resource_id'),         // UUID or other string identifier

    // Error content (snapshot of the most recent occurrence)
    errorCode: text('error_code'),                            // e.g. 'CLASSIFICATION_PARSE_FAILURE', 'RECONCILIATION_REQUIRED', 'ECONNRESET'
    summary: text('summary').notNull(),                       // short human-readable headline (max 240 chars)
    latestErrorDetail: jsonb('latest_error_detail'),          // full structured error from the most recent occurrence
    latestStack: text('latest_stack'),                        // most recent stack trace (normalised)
    latestCorrelationId: text('latest_correlation_id'),

    // Human lifecycle metadata
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedByUserId: uuid('acknowledged_by_user_id').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id),
    resolutionNote: text('resolution_note'),
    linkedPrUrl: text('linked_pr_url'),

    // Escalation metadata
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    escalatedTaskId: uuid('escalated_task_id').references(() => tasks.id),  // most recent escalation's task ID
    escalationCount: integer('escalation_count').notNull().default(0),      // v3: total escalation attempts on this incident
    previousTaskIds: uuid('previous_task_ids').array().notNull().default(sql`'{}'`),  // v3: history of prior escalation tasks

    // Test-incident flag (per Q8 §0.2) — set by the admin UI test-trigger; excluded from default list + push notifications
    isTestIncident: boolean('is_test_incident').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // One active incident per fingerprint. Resolved/suppressed incidents stay in the table but do not block new 'open' rows.
    uniqueActiveFingerprint: uniqueIndex('system_incidents_active_fingerprint_idx')
      .on(table.fingerprint)
      .where(sql`${table.status} IN ('open', 'investigating', 'remediating', 'escalated')`),
    statusSeverityIdx: index('system_incidents_status_severity_idx').on(table.status, table.severity, table.lastSeenAt),
    sourceIdx: index('system_incidents_source_idx').on(table.source, table.status),
    orgIdx: index('system_incidents_org_idx').on(table.organisationId, table.status)
      .where(sql`${table.organisationId} IS NOT NULL`),
    classificationIdx: index('system_incidents_classification_idx').on(table.classification, table.status),
  })
);
```

**Design notes:**

- `organisationId` is **nullable** because some incidents are system-level (e.g. a pg-boss queue depth problem affecting all orgs, or a platform config error). Non-null org means "happened inside this tenant's workload."
- The partial unique index on `fingerprint` where status is "active" enforces dedupe: you cannot have two open incidents with the same fingerprint. Once resolved, a new occurrence will open a fresh incident row — this is intentional, it lets you see recurrence-after-fix as a distinct event for pattern analysis.
- `summary` is a short headline for list rendering. Full detail lives in `latestErrorDetail` (snapshot) and the `system_incident_events` append log (history).
- `classification = 'persistent_defect'` is set by the ingestor when the same fingerprint recurs within N minutes AFTER a remediation attempt. In Phase 0/0.5 we never set this — no remediation attempts happen — but the column shape is designed for Phase 3.
- `escalatedTaskId` lets us trace which task (and therefore which agent run) was spawned by manual escalation.

### 4.2 `system_incident_events`

Append-only log of every event against an incident. Immutable. This is the audit trail.

```ts
// server/db/schema/systemIncidentEvents.ts
export const systemIncidentEvents = pgTable(
  'system_incident_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    incidentId: uuid('incident_id').notNull().references(() => systemIncidents.id, { onDelete: 'cascade' }),

    eventType: text('event_type').notNull()
      .$type<'occurrence'                  // the fingerprint fired again
          | 'status_change'                // lifecycle transition
          | 'ack'                          // human acknowledged
          | 'resolve'                      // human resolved
          | 'suppress'                     // human suppressed
          | 'unsuppress'                   // suppression lifted (auto or manual)
          | 'escalation'                   // manual escalate-to-agent, or Phase 2 auto-escalation
          | 'escalation_blocked'           // v3: guardrail refused an escalation attempt
          | 'resolution_linked_to_task'    // v4: resolve happened on an escalated incident — links resolver to the task
          | 'notification_surfaced'        // Phase 0.5 in-app notification fired
          | 'remediation_attempt'          // Phase 3: something tried to fix
          | 'remediation_outcome'          // Phase 3: result of the attempt
          | 'diagnosis'                    // Phase 2: agent annotated diagnosis
          | 'note'                         // free-form human note
      >(),

    actorKind: text('actor_kind').notNull()
      .$type<'system' | 'user' | 'agent'>(),
    actorUserId: uuid('actor_user_id').references(() => users.id),          // set when actorKind='user'
    actorAgentRunId: uuid('actor_agent_run_id').references(() => agentRuns.id), // set when actorKind='agent'

    payload: jsonb('payload'),                                // event-type-specific structured data
    correlationId: text('correlation_id'),                    // propagated from the originating request/job

    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    incidentTimeIdx: index('system_incident_events_incident_time_idx').on(table.incidentId, table.occurredAt),
    eventTypeIdx: index('system_incident_events_event_type_idx').on(table.eventType, table.occurredAt),
  })
);
```

**Design notes:**

- No UPDATE or DELETE on this table. Rows are append-only. Enforce at the service layer; optionally add a DB trigger later if we find bypasses.
- `payload` shape varies by `eventType`. Documented in the ingestor module as TypeScript discriminated union types (see §5.4).
- Cascading delete from `system_incidents`: if an incident is deleted (administratively), its event log goes too. We do not expose an incident-delete action in Phase 0.5 UI — resolve/suppress covers needs.

**Future optimisation (v3 note — not built in Phase 0.5):**

The incident list view renders `lastEventType` and `lastActorKind` alongside each row. Computing these requires a `MAX(occurredAt)`-style sub-query against `system_incident_events` per listed incident, which is O(N) on list render. If the list ever grows slow, denormalise these two fields onto `system_incidents` itself as `last_event_type` / `last_actor_kind` columns, updated by the same transaction that appends the event.

Not a Phase 0.5 priority because:

- The list view doesn't render these fields yet (covered by `status` + `lastSeenAt` + severity).
- Premature denormalisation before measuring would violate "don't design for hypothetical future requirements" from CLAUDE.md §6.

Revisit if p95 incident-list render time ever exceeds 300ms under real load.

### 4.3 `system_incident_suppressions`

Named suppression rules that prevent specific fingerprints from creating new incidents. Used for known-issue muting.

```ts
// server/db/schema/systemIncidentSuppressions.ts
export const systemIncidentSuppressions = pgTable(
  'system_incident_suppressions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fingerprint: text('fingerprint').notNull(),
    organisationId: uuid('organisation_id').references(() => organisations.id), // NULLABLE — null = suppress everywhere
    reason: text('reason').notNull(),                         // why this is suppressed (mandatory — no anonymous mutes)
    expiresAt: timestamp('expires_at', { withTimezone: true }),  // nullable = permanent suppression

    // Visibility feedback loop (v3) — without these we'd lose sight of how often
    // suppressed failures are actually happening, which defeats the purpose of
    // being able to triage "should this suppression be lifted?"
    suppressedCount: integer('suppressed_count').notNull().default(0),  // total occurrences blocked by this rule
    lastSuppressedAt: timestamp('last_suppressed_at', { withTimezone: true }),  // most recent block

    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    fingerprintIdx: index('system_incident_suppressions_fingerprint_idx').on(table.fingerprint, table.expiresAt),
    orgFingerprintUnique: uniqueIndex('system_incident_suppressions_fp_org_unique')
      .on(table.fingerprint, table.organisationId),
  })
);
```

**Design notes:**

- Suppression is checked BEFORE incident upsert in the ingestor. A suppressed fingerprint does NOT create an incident row, BUT the suppression row is updated: `suppressedCount += 1` and `lastSuppressedAt = NOW()`. The ingestor also emits `logger.warn('incident_suppressed', { fingerprint, reason, suppressedCount })` for log-based observability.
- `reason` is mandatory — we require the operator to document why, so future sysadmins see the rationale.
- `expiresAt` null = permanent; set = auto-expire at that time (checked on ingestor read). No background job needed in Phase 0.5 — the check is lazy.
- Unique constraint on `(fingerprint, organisationId)`: one suppression rule per fingerprint per org-or-global scope.

**Suppression visibility surface (v3):**

The admin page's Suppressions tab (exposed by `GET /api/system/incidents/suppressions` from §7.1) renders `suppressedCount` and `lastSuppressedAt` per rule. Operators can instantly see:

- "This permanent suppression has blocked 12,483 incidents in the last week — still want it on?"
- "That suppression expires in 2 days and has blocked 0 incidents since created — probably safe to let expire."

The monthly audit job referenced in §14.2 (Q7) flags permanent suppressions where `suppressedCount > 1000` AND there is no `linkedPrUrl` on the suppression record (v3 adds that optional column below implicitly via the incident's resolution link — the audit checks whether any incident resolved with a PR link shares this fingerprint; if not, the suppression is "suppress and forget"). That audit is a Phase 1 follow-up; Phase 0.5 only guarantees the counters are incremented and visible.

**What this buys you vs. the v2 design:**

- Degraded systems hidden behind "low-signal" suppressions become visible (`suppressedCount` climbs).
- Suppressions that were added for a genuine one-time spike get flagged as unused (`suppressedCount` stays at 0).
- You can make informed decisions about which suppressions to lift without needing to search log files.

**Future enhancement note (v4 — NOT built in Phase 0.5): blast-radius awareness on suppressions.** `suppressedCount` tells you volume but not spread. 10,000 suppressed events across 1 agent is fine (localised and known); 10,000 suppressed events across 500 agents is a major issue being silently masked. A `distinctResourceCount` field would close this gap. Deferred because Phase 0.5 suppressions are simple-string keyed (fingerprint + org) and computing spread requires joining against the non-row occurrences — we only have the counter, not the source rows. Viable extensions when implementing: (a) add a lightweight `suppressed_occurrence_log` table with rolling 30-day retention, or (b) during §5.1 step 3 suppression-check, also increment a `distinct_resource_id_set` aggregate (requires hashed-set storage). Revisit if suppression volume ever trips the monthly audit described in §14.2 Q7.

### 4.4 Migration

Single migration file: `migrations/NNNN_system_incidents.sql` where NNNN is the next free sequence (currently 0223+).

The migration:

1. Creates all three tables with columns + defaults + indexes.
2. Adds RLS policies: system admins bypass RLS; non-system users cannot read/write these tables. (Details in §7.3.)
3. Registers the tables in `server/config/rlsProtectedTables.ts`.
4. Does NOT backfill any data.

No down migration required for Phase 0 — tables are additive. Drizzle will generate the `_down` file automatically; it can be a no-op DROP.

## 5. Phase 0 — Ingestion service

### 5.1 Responsibilities

One module, `server/services/incidentIngestor.ts`, with one public function:

```ts
export async function recordIncident(input: IncidentInput): Promise<void>;
```

That function does, in order:

1. **Classify.** Determine `user_fault` vs `system_fault` from error shape + `ErrorCategory`.
2. **Fingerprint.** Compute a stable hash identifying this type of error.
3. **Suppression check.** If a matching `system_incident_suppressions` row is active, log `incident_suppressed` and return.
4. **Upsert.** Insert a new `system_incidents` row, or increment `occurrence_count` + update `lastSeenAt` on an existing active row with the same fingerprint.
5. **Append event.** Write an `occurrence` row to `system_incident_events`.
6. **Emit notification signal.** Enqueue a `system-monitor-notify` pg-boss job if the incident crossed a notification threshold (first open of a high/critical severity, or configured recurrence multiple). Phase 0.5 consumes this.

All of the above wrapped in a try/catch that logs but never throws. Ingestion failure must never break the caller.

### 5.2 Fingerprinting algorithm

Goals: (a) same real-world problem produces the same fingerprint, (b) unrelated problems do not collide, (c) fingerprint is stable across code refactors where the error meaning hasn't changed.

```ts
function computeFingerprint(input: IncidentInput): string {
  // Per-integration override wins — integrations that have a strongest-signal
  // identifier (e.g. agent.slug + errorCode, connector providerType + errorCode)
  // should pass fingerprintOverride to bypass stack-derived volatility entirely.
  if (input.fingerprintOverride) {
    return hashFingerprint(input.fingerprintOverride);
  }

  // Default algorithm: layered stabilisation — errorCode (most stable) +
  // function signature (stable across edits) + normalised message.
  const parts = [
    input.source,                                    // 'route' | 'job' | ...
    input.errorCode ?? 'no_code',                    // typed error codes are the strongest signal
    normaliseMessage(input.summary),                 // strip UUIDs, timestamps, numeric IDs
    topFrameSignature(input.stack),                  // function signature only — line numbers stripped
    input.affectedResourceKind ?? 'no_resource',     // 'agent_run', 'integration_connection', etc.
  ].join('|');
  return hashFingerprint(parts);
}

function hashFingerprint(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function normaliseMessage(msg: string): string {
  return msg
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    .replace(/\b\d{4,}\b/g, '<num>')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.Z+-]+/g, '<timestamp>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

// Returns the top meaningful frame with LINE NUMBERS AND COLUMN NUMBERS STRIPPED.
// This stabilises the fingerprint across deploys and minor refactors that shift
// frames by a few lines. Function and file path are preserved — the actual code
// location changes only when the function is renamed or moved between files.
function topFrameSignature(stack: string | undefined): string {
  if (!stack) return 'no_stack';
  const lines = stack.split('\n').map(l => l.trim()).filter(l => l.startsWith('at '));
  const meaningful = lines.find(l => !l.includes('incidentIngestor') && !l.includes('lib/logger'));
  const frame = meaningful ?? lines[0] ?? 'no_stack';
  // Strip ":line:col" suffix from "at fn (path/to/file.ts:42:18)" → "at fn (path/to/file.ts)"
  return frame
    .replace(/:\d+:\d+\)/g, ')')
    .replace(/:\d+:\d+$/g, '')
    .replace(/:\d+\)/g, ')')
    .replace(/:\d+$/g, '')
    .slice(0, 200);
}
```

**Why this shape:**

- `source` separates same-error-in-different-places so a DB timeout in a job doesn't collapse with a DB timeout in a route.
- `errorCode` is the strongest signal when available (typed errors like `ParseFailureError`, `ReconciliationRequiredError`). Always prefer it.
- `normaliseMessage` strips high-cardinality substrings (UUIDs, numeric IDs, timestamps) that would otherwise defeat dedupe.
- `topFrameSignature` anchors to the actual code location via **function + file path only** — line numbers, column numbers, and frame-shift from refactors do NOT change the fingerprint. This prevents the "same error, new deploy → new fingerprint → incident explosion" failure mode. Minification / bundling (future) would still require revisiting the stack normalisation rules.
- `affectedResourceKind` keeps resource-type separation without using the specific resource ID (which would defeat dedupe — we WANT "40 failing agent runs" to collapse to one incident).
- 16 hex chars = 64 bits, collision probability is negligible at the scale we'll see.

**Per-integration fingerprint override (added v3, governed v4):**

The `IncidentInput` interface accepts an optional `fingerprintOverride: string` that bypasses stack-derived fingerprinting entirely. Callers that have a strongest-signal identifier specific to their domain pass it here instead of relying on stack normalisation:

| Integration | Required `fingerprintOverride` format |
|---|---|
| Agent run failures | `agent:${agent.slug}:${errorCode ?? 'generic'}` — stable across refactors of the agent service |
| Connector polling | `connector:${providerType}:${errorCode ?? errorName}` — ties dedupe to the provider + typed error, not the polling code |
| LLM router | `llm:${model}:${errorCode}` — dedupes on model + error type; stack is less useful here |
| DLQ jobs | `job:${queueName}:${errorCode ?? 'exhausted'}` — queue + error type is the dedupe axis |
| Skill executor | `skill:${skillSlug}:${errorCode}` — stable across skill-infrastructure refactors |
| Routes, self-source | No override — default stack-based fingerprint is appropriate |

The override pattern is documented once here and each integration section (§6) references this table rather than restating the logic.

**Stack-based fallback is still the default** for sources where no strongest-signal identifier is appropriate (route handlers, self-source). Override is an opt-in, not a requirement.

**Override governance contract (v4 — binding):**

Unstructured overrides fragment the fingerprint space. To prevent drift:

1. **Every override MUST include at least two components joined by `:`** — a **domain identifier** (agent slug, provider type, queue name, skill slug, model name) AND an **error identifier** (error code, error name, or the literal token `generic` if nothing more specific is available).
2. **Overly broad overrides are rejected at ingest time.** A runtime validator in `incidentIngestor` enforces the regex `^[a-z_]+:[a-z0-9_.-]+(:[a-z0-9_.-]+)+$`. Examples:
    - ✅ `agent:orchestrator:CLASSIFICATION_PARSE_FAILURE`
    - ✅ `connector:gohighlevel:rate_limit`
    - ✅ `job:agent-execution-queue:exhausted`
    - ❌ `agent:error` — rejected; no error identifier component
    - ❌ `my-thing` — rejected; no domain+error structure
    - ❌ `agent:orchestrator` — rejected; missing error identifier (use `agent:orchestrator:generic` if nothing specific applies)
3. **On validation failure, the ingestor logs `logger.warn('incident_fingerprint_override_rejected', { override, caller })` and falls back to stack-derived fingerprinting.** The incident is still captured — the override is dropped, not the incident.
4. **Unit test coverage required.** Every integration site that uses `fingerprintOverride` gets a test that asserts the override passes validation against real sample inputs. Failure of any such test blocks merge.
5. **This is a contract, not guidance.** Future changes to override shapes require an explicit spec amendment and a migration plan for existing fingerprints (e.g. dual-fingerprint write during transition).

### 5.3 Classification

Reuse the existing `ErrorCategory` taxonomy from `server/services/middleware/errorHandling.ts`:

```ts
const USER_FAULT_CATEGORIES: ErrorCategory[] = [
  'validation_error',
  'auth_error',
  'permission_failure',
  'not_found',
];

const SYSTEM_FAULT_CATEGORIES: ErrorCategory[] = [
  'timeout',
  'network_error',
  'rate_limit',
  'db_error',
  'execution_failure',
  'unknown',
];

function classify(input: IncidentInput): 'user_fault' | 'system_fault' {
  if (input.classification) return input.classification;       // explicit override from caller
  if (input.errorCategory && USER_FAULT_CATEGORIES.includes(input.errorCategory)) return 'user_fault';
  if (input.statusCode && input.statusCode >= 400 && input.statusCode < 500) return 'user_fault';
  return 'system_fault';
}
```

**Default is system-fault** — err on the side of capture. Callers who know a specific error is user-fault (e.g. `asyncHandler` catching a `ZodError`) can set `classification: 'user_fault'` explicitly to bypass the heuristic.

User-fault incidents still get captured in the table — they just never trigger notifications or agent escalation. We keep them for volumetric pattern analysis ("we're seeing a spike of validation errors on endpoint X; maybe the docs are wrong").

### 5.4 `IncidentInput` type

```ts
export interface IncidentInput {
  source: 'route' | 'job' | 'agent' | 'connector' | 'skill' | 'llm' | 'synthetic' | 'self';
  severity?: 'low' | 'medium' | 'high' | 'critical';           // default: inferred from source + statusCode, see §5.5
  classification?: 'user_fault' | 'system_fault';              // override auto-classification

  // Error content
  errorCode?: string;                                          // preferred — use typed error codes
  errorCategory?: ErrorCategory;                               // from errorHandling.ts
  statusCode?: number;                                         // for route-source incidents
  summary: string;                                             // max 240 chars
  stack?: string;
  errorDetail?: Record<string, unknown>;                       // full structured detail for UI

  // Scope
  organisationId?: string | null;                              // null = system-level
  subaccountId?: string | null;

  // Resource linkage
  affectedResourceKind?: string;                               // 'agent_run', 'flow_run', 'integration_connection', etc.
  affectedResourceId?: string;

  // Tracing
  correlationId?: string;

  // Fingerprint override (v3) — bypasses stack-derived fingerprinting.
  // Integrations with a strongest-signal identifier (agent slug, connector
  // provider type, etc.) pass a domain-stable string here. See §5.2 table.
  fingerprintOverride?: string;
}
```

### 5.5 Default severity inference

Callers should set severity when they know it. When they don't:

| Condition | Default severity |
|---|---|
| `source='route'` and `statusCode >= 500` | `medium` |
| `source='route'` and `statusCode in [408, 409, 429]` | `low` |
| `source='job'` (landed in DLQ, retries exhausted) | `high` |
| `source='agent'` (run terminal-failed), agent is **not** system-managed | `medium` |
| `source='agent'` (run terminal-failed), agent has `isSystemManaged=true` (per Q3 §0.2) | `high` |
| `source='connector'` (poll failure) | `low` on first, `medium` on recurrence — handled in ingestor |
| `source='skill'` with retryable error exhausted | `medium` |
| `source='llm'` with `parse_failure` or `reconciliation_required` | `high` |
| `source='self'` | `high` — see §5.7 |
| Unknown | `medium` |

### 5.6 Upsert mechanics

```ts
// Pseudo-SQL
INSERT INTO system_incidents (fingerprint, source, severity, classification, status, ...)
VALUES ($1, $2, $3, $4, 'open', ...)
ON CONFLICT (fingerprint) WHERE status IN ('open', 'investigating', 'remediating', 'escalated')
DO UPDATE SET
  occurrence_count = system_incidents.occurrence_count + 1,
  last_seen_at = NOW(),
  latest_error_detail = EXCLUDED.latest_error_detail,
  latest_stack = EXCLUDED.latest_stack,
  latest_correlation_id = EXCLUDED.latest_correlation_id,
  severity = GREATEST_SEVERITY(system_incidents.severity, EXCLUDED.severity),  -- escalate, never de-escalate
  updated_at = NOW()
RETURNING id, occurrence_count, (xmax = 0) AS was_inserted;
```

Drizzle doesn't natively support partial-index conflicts, so we write this as a raw SQL call wrapped in a Drizzle service method. The `(xmax = 0)` trick returns `true` on INSERT and `false` on UPDATE — we use this to decide whether to emit `status_change` events and `system-monitor-notify` jobs.

**Severity never de-escalates *within a single incident lifecycle*.** If an incident starts as `low` and later occurrences come in as `critical`, the row flips to `critical`. The reverse cannot happen automatically — only human resolution flips it.

**Severity scope is per-lifecycle, not across recurrences (v3 clarification).** The "never de-escalate" rule applies *only while an incident remains active*. Once a human resolves or suppresses an incident, the fingerprint's next occurrence creates a **new incident row** (enforced by the partial unique index on active status in §4.1). The new row starts fresh — it is NOT seeded with the resolved incident's final severity. This means:

- An incident that ran hot for a week, got resolved, then recurs a month later starts fresh at its natural severity for that new occurrence.
- There is no permanent "once critical, always critical" inflation.
- If the operator wants to retain severity across the resolve boundary (e.g. "this has always been critical; start the new one at critical too"), that's a deliberate human action — they can manually set severity on the new row via a future API (not in Phase 0.5 scope).

This design choice trades minor UX inconvenience (fresh row on recurrence) for durable signal quality (severity reflects current reality, not historical baggage).

**Future enhancement note (v4 — NOT built in Phase 0.5):** add derived fields `peakSeverity` (highest severity ever observed during this lifecycle — the current `severity` column) and `latestSeverity` (severity of the most recent occurrence, potentially lower). Together they reveal oscillation patterns: "started critical, settled into medium noise" vs "was always critical." Useful signal for Phase 2 agent diagnosis and for noise detection in the admin UI. Deferred because the minor operational value doesn't justify the extra column until we have real oscillation data to validate the design. Revisit after 4 weeks in production.

### 5.7 Self-source protection

The ingestor itself can fail (DB down, constraint violation, bug). If the ingestor errors while being called from a path that already handles errors, we must NOT recurse.

Rule: the ingestor **never calls itself**. Internal errors are logged with `logger.error('incident_ingest_failed', ...)` and return. A dedicated pg-boss job on a 5-minute cron (`system-monitor-self-check`, Phase 0) scans the last 5 minutes of logs for `incident_ingest_failed` events and, **if the failure rate crosses a threshold**, writes a single `source='self'` incident directly via a raw SQL path that bypasses the normal ingestor. This is the "who monitors the monitor" loop.

**Thresholding (v3 addition):** a transient DB hiccup that drops one ingest write is noise, not an incident. The self-check job fires ONLY when:

```
ingest_failures_in_window >= SELF_CHECK_THRESHOLD_COUNT (default 5)
  AND
window_duration_minutes == 5 (the scan window)
  AND
no self-source incident opened within the last SELF_CHECK_COOLDOWN_MINUTES (default 30)
```

Concretely: "at least 5 ingest failures in the last 5 minutes, and we haven't already fired one of these in the last 30 minutes." Both numbers are env-configurable (`SYSTEM_MONITOR_SELF_CHECK_THRESHOLD_COUNT`, `SYSTEM_MONITOR_SELF_CHECK_COOLDOWN_MINUTES`).

This threshold+cooldown pattern:

- Ignores single transient failures.
- Catches sustained ingestor outages quickly (within a 5-minute window).
- Prevents self-incident storms when the ingestor genuinely breaks (one incident per 30 minutes, not one every 5).
- Avoids the infinite-loop failure mode where a broken ingestor generates a self-incident, which generates another self-incident, etc.

Self-sourced incidents:

- Always severity `high`.
- Always require HITL — never eligible for agent escalation in Phase 2+. Hard-coded guard.
- Bypass the fatigue guard for the first occurrence (the operator must know the monitor is broken). The cooldown window above is a separate mechanism from the fatigue guard — it governs self-check firing specifically, not general notification throttling.

**Future enhancement note (v4 — NOT built in Phase 0.5): cascading-failure detection via ingest heartbeat.** The current self-check is log-scan based — if the ingestor fails so catastrophically that no `incident_ingest_failed` logs are emitted (e.g. logger itself broken, process crashed before log flush), the self-check never fires. A heartbeat metric comparing *expected ingest rate vs actual* would catch silent total-system failures. Concretely: record a 1-minute rolling aggregate of `recordIncident` call count; if that count drops >80% from the rolling 24h mean without a known deploy/scale-down event, fire a synthetic self-incident. Deferred because (a) we lack prior-art baselines to know what the "natural" ingest rate is, and (b) in Phase 0.5 pre-production traffic, the ingest rate is too noisy to baseline. Revisit 2 weeks after production cutover.

### 5.8 Performance characteristics and mode toggle

Ingestion happens synchronously in the caller's request path **by default**. Budget: p95 < 30ms, p99 < 100ms.

Measurements to take at ingest:

- Fingerprint compute time (pure CPU, should be sub-ms).
- Suppression check (single indexed SELECT).
- Upsert (single SQL statement against indexed table).
- Event append (single INSERT).

Total: 2 SELECTs + 2 INSERTs in the worst case. This is fine on a warm DB.

### 5.8.1 Pre-wired sync/async mode toggle (v3)

To avoid an emergency refactor if ingest latency ever becomes a problem in production, **the ingestor ships from day one with a pre-wired sync/async mode toggle**. This is not a fallback we build later — it's a runtime switch that exists at launch.

```ts
// server/services/incidentIngestor.ts
type IngestMode = 'sync' | 'async';

function getIngestMode(): IngestMode {
  // Force sync in tests so integration tests can assert DB state immediately.
  if (process.env.NODE_ENV === 'test') return 'sync';
  // Force sync if ingest is disabled (belt-and-braces with the top-level kill switch).
  if (process.env.SYSTEM_INCIDENT_INGEST_ENABLED === 'false') return 'sync';
  const configured = process.env.SYSTEM_INCIDENT_INGEST_MODE;
  return configured === 'async' ? 'async' : 'sync';
}

export async function recordIncident(input: IncidentInput): Promise<void> {
  if (process.env.SYSTEM_INCIDENT_INGEST_ENABLED === 'false') return;   // fast-path kill switch

  if (getIngestMode() === 'async') {
    // Enqueue to pg-boss; return immediately. The worker runs the same
    // ingestion logic — identical classify / fingerprint / upsert code path.
    await enqueue('system-monitor-ingest', safeSerialize(input));
    return;
  }

  // Sync path: inline the classify → fingerprint → suppression → upsert → event flow.
  await ingestInline(input);
}
```

**Runtime behaviour:**

- **Default: `sync`.** Lower operational complexity; errors captured immediately; integration tests can assert state without flake.
- **`SYSTEM_INCIDENT_INGEST_MODE=async`.** Ingestor enqueues the input to a pg-boss queue (`system-monitor-ingest`) and returns. A worker consumes the queue and calls `ingestInline`. Adds ~50–200ms end-to-end delay but removes all DB work from the request path.
- **`SYSTEM_INCIDENT_INGEST_ENABLED=false`.** Full ingestor no-op. Top-level kill switch from §13.6.

**Why pre-wire this now, even though we don't expect to need it:**

1. The per-caller API contract (fire-and-forget; no return value consumed) is identical in both modes. Writing the code once with a toggle is cheap.
2. If production ingest latency degrades, flipping an env var restores the caller's request budget in minutes. Refactoring under pressure — which is when you'd be doing it without pre-wiring — is exactly when bugs land in production.
3. The async mode is also useful for load-testing the sink without stressing request handlers: flip to async, fire 100k incidents, watch the worker drain.

**What doesn't change between modes:**

- Same classify / fingerprint / suppression / upsert / event-append code path (shared `ingestInline` function).
- Same test assertions (tests force sync via `NODE_ENV=test`).
- Same observability hooks.

**What does change in async mode:**

- Caller cannot observe ingestion failure. Any errors in the worker path are logged by `logger.error('incident_ingest_failed', ...)` and picked up by the self-check job (§5.7) if they recur.
- The `recordIncident` call no longer blocks; return values / promises resolve immediately after enqueue.

### 5.8.2 Ordering invariants for async mode (v4)

When `SYSTEM_INCIDENT_INGEST_MODE=async` is active, the caller's request returns before the incident is visible in the DB or the UI. This introduces ordering guarantees the implementation must preserve and the UI must tolerate.

**Server-side invariants (binding contract):**

1. **Upsert before event append.** The `system_incidents` row MUST be written (or its counters incremented) before any `system_incident_events` row referencing it is written. Foreign key enforces this at the DB layer.
2. **Upsert + event before notify enqueue.** The `system-monitor-notify` job MUST NOT be enqueued until the upsert and the `occurrence` event are both durably committed. All three operations (upsert, event append, notify-enqueue) happen inside a single transaction. If the transaction rolls back, nothing escapes — the caller receives no notification, no WebSocket push, no Pulse card.
3. **WebSocket push fires only from the notify job handler**, never from the ingestor itself. The notify job reads the incident from the DB before emitting the WebSocket event. This means the DB row is guaranteed visible to other connections by the time the WebSocket event lands.

**Client-side tolerance (binding for Phase 0.5 UI code):**

- The admin page MUST treat the WebSocket event as a hint to refetch, not as the source of truth. The page always re-queries the API for the authoritative state.
- The admin page MUST NOT assume `incident.lastSeenAt` strictly increases across polling ticks — under async mode with high concurrency, a poll can land between two ingests and see intermediate state.
- Pulse items MUST cope with a card briefly "appearing empty" if the Pulse refresh lands before the notify job completes its WebSocket push. The polling fallback will fill it in.

**WebSocket payload shape (v4 improvement):**

Rather than emitting a bare `system_incident:updated` signal that forces a full refetch, include the incident ID in the payload so the client can do a targeted refresh:

```ts
// server side, in the notify job
socket.to('sysadmin').emit('system_incident:updated', {
  incidentId: incident.id,
  fingerprint: incident.fingerprint,
  severity: incident.severity,
  status: incident.status,
  occurrenceCount: incident.occurrenceCount,
});
```

The client-side handler:

1. If the incident is currently rendered in the list → update it in place (no refetch).
2. If the incident is new to the list → prepend it and refetch the count badges (cheap).
3. If Pulse is currently visible → invalidate the Pulse query so it re-fetches.

Targeted refresh reduces DB load during incident storms: fan-out of 100 incidents triggers 100 targeted WS events, not 100 full-page refetches.

## 6. Phase 0 — Integration points

Seven integration points wire the ingestor into the existing error paths. Each is a minimal, additive change — no existing behaviour removed.

### 6.1 Global Express error handler

**File:** `server/index.ts:343-385`

**Change:** Before the existing `res.status(...).json(...)` call, add:

```ts
await recordIncident({
  source: 'route',
  statusCode,
  errorCode: err.errorCode,
  errorCategory: classifyError(err).category,
  severity: statusCode >= 500 ? 'medium' : 'low',
  summary: truncateSummary(err.message ?? 'Unhandled route error'),
  stack: err.stack,
  errorDetail: { path: req.path, method: req.method, ...safeSerializeError(err) },
  organisationId: req.orgId ?? null,
  subaccountId: req.subaccountId ?? null,
  correlationId: req.correlationId,
}).catch(ingestErr => logger.error('incident_ingest_failed', { from: 'global_error_handler', error: ingestErr?.message }));
```

The existing `logger.error('unhandled_error', ...)` call stays — we add capture, not replace logging.

### 6.2 `asyncHandler`

**File:** `server/lib/asyncHandler.ts`

**Change:** On the `unhandled_route_error` path (errors that slip past the service-error shape), call `recordIncident` the same way as §6.1. Explicit service-shaped errors (`{ statusCode, message, errorCode }`) are treated as the caller's deliberate response — we still capture them but with `classification: 'user_fault'` when `statusCode < 500`.

### 6.3 pg-boss DLQ handler

**File:** `server/services/dlqMonitorService.ts:24-45`

**Change:** Inside the DLQ worker callback, after the existing `logger.error('job_dlq', ...)` call, add:

```ts
await recordIncident({
  source: 'job',
  severity: 'high',
  summary: `pg-boss job landed in DLQ: ${sourceQueue}`,
  errorCode: job.data?.errorCode,
  errorDetail: { queue: sourceQueue, jobId: job.id, payload: safeSerialize(payload), attempts: job.retrycount },
  affectedResourceKind: 'pg_boss_queue',
  affectedResourceId: sourceQueue,
  organisationId: payload?.organisationId ?? null,
  subaccountId: payload?.subaccountId ?? null,
  correlationId: payload?.correlationId,
}).catch(/* same swallow pattern */);
```

### 6.4 Agent run terminal-failed transition

**File:** `server/services/agentExecutionService.ts` (terminal state transition point — find by searching for `status: 'failed'` or `status: 'timeout'`)

**Change:** Immediately after writing a terminal-failed `agent_runs` row, call `recordIncident`:

```ts
await recordIncident({
  source: 'agent',
  severity: agent.isSystemManaged ? 'high' : 'medium',   // per Q3 §0.2
  summary: truncateSummary(`Agent run failed: ${agent.slug}`),
  errorCode: run.errorDetail?.code,
  errorDetail: run.errorDetail,
  affectedResourceKind: 'agent_run',
  affectedResourceId: run.id,
  organisationId: run.organisationId,
  subaccountId: run.subaccountId,
  correlationId: run.correlationId ?? null,              // agent_runs correlationId added by prereq migration (§14.1 P1)
}).catch(/* swallow */);
```

Terminal statuses that ingest: `failed`, `timeout`, `budget_exceeded`, `loop_detected`. Non-error terminals (`completed`, `cancelled`, `awaiting_clarification`) do NOT ingest.

### 6.5 Connector polling failures

**File:** `server/services/connectorPollingService.ts:43-80`

**Change:** In the failure branch where `updateSyncStatus(id, orgId, { lastSyncStatus: 'error', ... })` is called, add:

```ts
await recordIncident({
  source: 'connector',
  severity: 'low',                      // auto-bumped to 'medium' on recurrence via severity-never-de-escalates rule
  summary: `Connector ${connection.providerType} poll failed for org ${orgId}`,
  errorDetail: { connectionId: connection.id, providerType: connection.providerType, lastSyncError: err.message },
  affectedResourceKind: 'integration_connection',
  affectedResourceId: connection.id,
  organisationId: orgId,
  correlationId: req?.correlationId,
}).catch(/* swallow */);
```

### 6.6 Skill execution failures

**File:** `server/services/skillExecutor.ts` (find by searching for non-retryable error emission)

**Change:** When `executeWithRetry` exhausts retries and classifies the final error as a `system_fault` category, call `recordIncident` with `source: 'skill'`. Retryable categories that succeed on retry do NOT ingest — only terminal failures.

### 6.7 LLM router ledger failures

**File:** `server/services/llmRouter.ts` (or equivalent — follow the `llm_requests` write path)

**Change:** When writing an `llm_requests` row with `status='parse_failure'` or raising `ReconciliationRequiredError`, call `recordIncident` with `source='llm'`:

```ts
await recordIncident({
  source: 'llm',
  severity: 'high',                     // LLM failures are expensive and indicate real problems
  errorCode: 'CLASSIFICATION_PARSE_FAILURE' | 'RECONCILIATION_REQUIRED',
  summary: `LLM request failed: ${errorCode}`,
  errorDetail: { idempotencyKey, runtimeKey, model, provider },
  affectedResourceKind: 'llm_request',
  affectedResourceId: llmRequestId,
  organisationId,
  correlationId,
}).catch(/* swallow */);
```

### 6.8 Not-yet-integrated error sources (deferred)

The following surfaces emit errors today but are NOT integrated in Phase 0 because they either already have good surfacing or ingesting them would create noise:

- **`workspace_health_findings`** — already has a detector pattern and UI. Phase 0 does NOT mirror these into `system_incidents`. We can cross-link in Phase 1 if useful.
- **Scheduled task failures** — these flow through `agent_runs`, so they're covered by §6.4.
- **WebSocket errors** — local to one user's session; not a system fault.
- **Client-side errors** — out of scope until we add a telemetry endpoint (not planned).
- **Migration failures** — happen at deploy time, not runtime. Out of scope.

### 6.9 Correlation ID — best-effort, not required for correctness (v3)

Correlation IDs enhance grouping and debugging ergonomics but **are not required for incident correctness**. The ingestor works regardless of whether a correlation ID is present.

**What v3 actually commits to in Phase 0:**

1. Route-source incidents always have a correlation ID (the middleware runs on every route).
2. `agent_runs.correlation_id` column is added via prereq migration (§14.1 P1). New agent runs populate it; existing runs have null.
3. New pg-boss jobs added from this PR onward include a `correlationId` field in their payload by convention (documented in `architecture.md`).
4. Existing pg-boss jobs are NOT bulk-refactored. They continue to produce incidents with `correlationId = null`.

**Realistic timeline:** correlation-ID coverage will be incomplete for months, not days. Every new job or service touch tends to add it; retrofitting the existing codebase in a single PR is out of scope.

**What this means for incident analysis:**

- "Group by correlation ID" queries return useful results only within the subset of incidents that have one.
- The admin UI shows the correlation ID when present and gracefully omits the field when null.
- Phase 2 agent diagnosis uses correlation IDs when present, but its tooling does NOT require them — it falls back to fingerprint + time-window queries.

**Explicit non-promise:** do NOT design any downstream system that critically depends on correlation IDs being present. Treat them as a helpful enrichment, not a guaranteed contract.

This is a deliberate engineering tradeoff: requiring end-to-end correlation before Phase 0 ships would triple the scope. Shipping Phase 0 without it loses ~20% of analytical capability on legacy job paths and 0% on route paths — acceptable cost.

### 6.10 Testing hook

The ingestor exports a `__resetForTest()` function and accepts a dependency-injected clock + DB in test mode. Every integration point above gets a test that verifies `recordIncident` was called with the right shape. Test details in §12.

## 7. Phase 0.5 — Routes, permissions, principal context

### 7.1 Route file

**New file:** `server/routes/systemIncidents.ts` (mirrors `server/routes/jobQueue.ts` pattern)

Every route uses `authenticate` then `requireSystemAdmin`. No org scoping — system admin sees everything. Organisation filter is a query parameter, not an enforced scope.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/system/incidents` | List incidents with filters |
| `GET` | `/api/system/incidents/:id` | Detail view with event log |
| `POST` | `/api/system/incidents/:id/ack` | Acknowledge (no resolution, just "I've seen it") |
| `POST` | `/api/system/incidents/:id/resolve` | Mark resolved; body `{ resolutionNote?, linkedPrUrl? }` |
| `POST` | `/api/system/incidents/:id/suppress` | Create a suppression rule; body `{ reason, duration: '24h' \| '7d' \| 'permanent' }` |
| `POST` | `/api/system/incidents/:id/escalate` | Manual-escalate-to-agent; see §10 |
| `GET` | `/api/system/incidents/suppressions` | List active suppressions |
| `DELETE` | `/api/system/incidents/suppressions/:id` | Remove a suppression rule |

**Query parameters for list endpoint:**

- `status` — filter by one or more statuses (CSV)
- `severity` — filter by severity
- `source` — filter by source
- `classification` — `system_fault` / `user_fault` / `persistent_defect`
- `organisationId` — filter by org (optional — defaults to all)
- `limit`, `offset` — pagination; default limit 50, max 200
- `sort` — `last_seen_desc` (default), `first_seen_desc`, `occurrence_count_desc`, `severity_desc`

**Response shapes** are plain JSON, not wrapped. Error response follows the project convention `{ error: { code, message }, correlationId }`.

### 7.2 Service file

**New file:** `server/services/systemIncidentService.ts`

Public methods:

```ts
listIncidents(filters: IncidentListFilters): Promise<{ incidents: SystemIncident[]; total: number }>;
getIncident(id: string): Promise<{ incident: SystemIncident; events: SystemIncidentEvent[] }>;
acknowledgeIncident(id: string, userId: string): Promise<SystemIncident>;
resolveIncident(id: string, userId: string, note?: string, linkedPrUrl?: string): Promise<SystemIncident>;
suppressIncident(id: string, userId: string, reason: string, duration: SuppressionDuration): Promise<SystemIncident>;
escalateIncidentToAgent(id: string, userId: string): Promise<{ incident: SystemIncident; taskId: string }>;
listSuppressions(filter?: { activeOnly?: boolean }): Promise<SystemIncidentSuppression[]>;
removeSuppression(id: string, userId: string): Promise<void>;
```

All methods that mutate state also write a `system_incident_events` row inside the same transaction.

No direct DB access in the route file — route calls service, service calls DB. This matches architecture.md §Route Conventions.

**Resolution feedback loop (v4):**

When `resolveIncident` is called on an incident that has `escalatedTaskId IS NOT NULL` (i.e. the incident had previously been escalated to an agent), the service writes **two** events inside the same transaction:

1. `resolve` event — the standard resolution record.
2. `resolution_linked_to_task` event with payload:
    ```ts
    {
      taskId: incident.escalatedTaskId,
      taskStatus: <looked up at resolve time>,
      escalationCount: incident.escalationCount,
      previousTaskIds: incident.previousTaskIds,
      resolvedByUserId: userId,
      resolutionNote: note ?? null,
      linkedPrUrl: linkedPrUrl ?? null,
      // Optional, future: wasSuccessful — whether resolution was driven by agent's diagnosis.
      // In Phase 0.5 this is null; a later API will let the operator flag it.
      wasSuccessful: null,
    }
    ```

**Why this matters now, even though Phase 2 doesn't exist yet:**

Every resolution that follows an escalation is a training signal for the future monitoring agent (Phase 2). Capturing it in the event log from day one means Phase 2's design has real data to work against ("of 500 escalations, 120 resulted in human resolution within 24h — those are the patterns the agent should learn"). Without capture, Phase 2 starts blind.

The `wasSuccessful` field is deliberately nullable and unpopulated in Phase 0.5 — a future UI will ask the resolver "did the agent's diagnosis help?" as an optional prompt. Not building that UI now, but reserving the field prevents schema churn later.

### 7.3 Permissions

**Change to** `server/lib/permissions.ts`:

Add a new system-level permission key group:

```ts
export const SYSTEM_PERMISSIONS = {
  // existing ...
  INCIDENT_VIEW: 'system:incident:view',
  INCIDENT_ACK: 'system:incident:ack',
  INCIDENT_RESOLVE: 'system:incident:resolve',
  INCIDENT_SUPPRESS: 'system:incident:suppress',
  INCIDENT_ESCALATE: 'system:incident:escalate',
} as const;
```

System admin users bypass all permission checks (existing behaviour per `permissions.ts` line 6), so these keys primarily exist for future non-sysadmin delegation and for audit-trail labels on events. In Phase 0.5 all endpoints require `requireSystemAdmin` middleware directly; granular permission checks layer on later.

### 7.4 Principal context / RLS

**Decision required (see §14):** How does the ingestor write rows when there's no authenticated user? E.g. a pg-boss DLQ failure has no `req` context.

Two options:

**Option A — Bypass RLS for system_incidents tables.** Mark `system_incidents`, `system_incident_events`, `system_incident_suppressions` as NOT in `rlsProtectedTables.ts`. Service writes go through a dedicated DB client that runs as the app owner role. Simple; consistent with how `pgboss.job` is accessed.

**Option B — System principal context.** Extend `server/db/withPrincipalContext.ts` to support a `'system'` principal type that sets `app.current_principal_type = 'system'`. Add RLS policies that permit system-principal reads/writes. More principled; aligns with the eventual Phase 2 monitoring agent needing a system principal anyway.

**Recommendation: Option A for Phase 0/0.5, Option B for Phase 2.** Phase 0 ingestion is not user-triggered and the tables are system-admin-only at the read surface — RLS adds ceremony without benefit. When Phase 2 introduces an agent that needs to query these tables (and other tables across orgs) with proper audit trails, we build the system principal then. This is a deliberate not-yet-build decision, not a shortcut; revisit flag in Phase 2 design.

### 7.5 Rate limiting

Standard route rate-limiting via existing middleware. System admin tier — generous. No per-user or per-IP incident-specific limits needed.

### 7.6 Audit events

All lifecycle actions (ack, resolve, suppress, escalate) also write to the existing `audit_events` table (`server/db/schema/auditEvents.ts`) for cross-system audit compliance. The `system_incident_events` log is the incident-specific timeline; `audit_events` is the org-wide compliance ledger. Writing to both is cheap and correct.

## 8. Phase 0.5 — Admin UI

### 8.1 Page layout

**New file:** `client/src/pages/SystemIncidentsPage.tsx`
**Route:** `/system/incidents` (registered in `client/src/App.tsx` alongside `SystemTaskQueuePage`, `JobQueueDashboardPage`)

Modelled on `JobQueueDashboardPage.tsx`:

- Lazy-loaded via `lazy(() => import('./pages/SystemIncidentsPage'))`
- Header with page title, count badges (open / ack / resolved), "Clear all filters" button
- Filter bar: status multi-select, severity multi-select, source multi-select, classification toggle (system-fault default; include user-fault = off), org search-filter
- Column-header sort per architecture rule (ref: `SystemSkillsPage.tsx` pattern — `ColHeader` component, `Set<T>`-based filter state)
- Main table with one row per incident
- Row click opens a **detail drawer** (side panel), NOT a full navigation

### 8.2 List columns

| Column | Sortable | Filterable | Notes |
|---|---|---|---|
| Severity | yes | yes | Coloured pill (red/orange/yellow/grey matching severity) |
| Source | yes | yes | Small icon + label (route, job, agent, connector, skill, llm, synthetic, self) |
| Status | yes | yes | Pill — open is bold red; escalated is purple; resolved is muted |
| Summary | no | no | Headline — truncate at 80 chars, full text in drawer |
| Org | yes | yes (search) | Shows "—" for system-level incidents |
| Occurrences | yes | no | Count with trend arrow if occurrence delta > 0 in last 5 minutes |
| Last seen | yes (default desc) | no | Relative time — "2m ago" |
| Actions | no | no | Icon buttons: ack, resolve, suppress, escalate-to-agent |

**Default sort:** `last_seen_desc` with status filter `{open, investigating, escalated}` pre-applied. The "inbox" view — what needs attention right now.

### 8.3 Detail drawer

Opens when a row is clicked. Right-side panel, not a route change (no URL update on open). Drawer shows:

- **Header:** severity pill, summary, status pill, close X
- **Metadata block:** fingerprint (monospace, copyable), first-seen, last-seen, occurrences, classification, correlation ID (copyable, clickable to filter logs — deferred to later phase)
- **Scope block:** org (linked if set), subaccount (linked if set), affected resource kind + linked resource (if the resource supports deep linking — e.g. `agent_run` → agent run detail page)
- **Error detail block:** `summary` in bold, then `latestErrorDetail` rendered as collapsible JSON, then `latestStack` in a `<pre>` code block (collapsed by default — long stacks)
- **Event timeline:** append-only list of `system_incident_events`, newest first, with actor (system / user name / agent run link), event type, timestamp, payload (collapsible JSON)
- **Action bar (bottom-sticky):** same actions as row but bigger — Acknowledge, Resolve (with note input), Suppress (with reason + duration), Escalate to Agent (with confirmation modal), and a "Close" link

**Resolve modal:** textarea for `resolutionNote`, optional text input for `linkedPrUrl`, submit + cancel.

**Suppress modal:** textarea for `reason` (required), radio group for duration (24h / 7d / Permanent), submit + cancel. Shows a warning box if the fingerprint has had > 10 occurrences in the last 7 days ("High-volume fingerprint — consider fixing the root cause instead of suppressing").

**Escalate-to-agent modal:** preview of the task that will be created (title, description), "Escalate" confirm button, cancel. See §10 for mechanics.

### 8.4 Empty states

- No incidents at all: celebratory message "No active system incidents" with small "view resolved" toggle link.
- Filters return nothing: "No incidents match these filters" with "clear filters" button.
- Loading: skeleton rows.
- Error fetching: inline error with retry button.

### 8.5 Real-time behaviour (per Q5 §0.2)

- **Polling interval: 10 seconds** when the tab is visible.
- **Pauses when tab is backgrounded** via the Page Visibility API — no DB burn on idle tabs.
- **Manual refresh button** in the page header for immediate refetch.
- **Auto-refresh toggle** in the page header lets admins disable polling entirely (useful when viewing a frozen snapshot while triaging).
- **WebSocket push for new/updated incidents** via the `system_incident:updated` event emitted from the notify job (§9.4). Sub-second latency when something significant happens; polling is the fallback for less-critical changes (occurrence count increments on existing incidents).
- Drawer does NOT refetch detail on a tick. A manual "refresh" icon at the top of the event timeline refetches on demand.

### 8.6 Navigation registration

Add entry to `client/src/components/Layout.tsx` system-admin nav section (mirror the existing "Task Queue" and "Job Queues" entries):

```
System Admin
  ├── Settings
  ├── Task Queue
  ├── Job Queues
  ├── Incidents          <-- new
  ├── ...
```

Icon suggestion: alert-triangle outline. Shows a red dot badge on the nav entry when there are open critical-severity incidents.

### 8.7 Accessibility + style

- Keyboard navigation through table rows (arrow keys, enter to open drawer).
- Escape closes drawer.
- All action buttons have `aria-label`.
- Tailwind utility classes matching existing pages (no new design tokens).
- Severity colours from existing palette — do not introduce a new red/orange.

### 8.8 Client-side filter state

Per CLAUDE.md architecture rule ("Tables: column-header sort + filter by default"): use the `ColHeader` / `Set<T>`-based filter pattern from `SystemSkillsPage.tsx`. Sorts are client-side on the current page; filters that need server-side support (status, severity, source, org) pass through to the API; filters that are UI-only (ack-within-last-hour etc.) are client-side on the fetched page.

Active filter indicator on column headers (indigo dot). Active sort indicator (up/down arrow). "Clear all filters" button appears when any non-default sort/filter is applied.

### 8.9 Test-incident trigger (per Q8 §0.2, flag-extended v4)

A **"Trigger test incident"** button sits in the page header next to the refresh controls. Clicking it:

1. Opens a small form: severity radio (default `low`), source dropdown (default `synthetic`), optional free-form `summary` (default "Manual test incident from admin UI"), **and a "Trigger full notification pipeline" checkbox (default OFF)**.
2. Submits to `POST /api/system/incidents/test` (new endpoint, `requireSystemAdmin`).
3. The endpoint calls `recordIncident` with `isTestIncident: true` column set, fingerprint `test:manual:{userId}:{timestamp}` so each click produces a distinct incident, and `triggerNotifications: <checkbox value>`.
4. Returns the new incident to the client; the page redirects to the detail drawer.

**Schema addition:** `system_incidents.is_test_incident boolean NOT NULL DEFAULT false`. Added in the Phase 0 migration from the start (avoids a Phase 0.5 schema change).

**Default list filter:** the admin page filters `isTestIncident = false` by default. A "Show test incidents" toggle in the filter bar flips it.

**Notification behaviour (v4 — refined):**

Test incidents have TWO modes:

| Mode | `triggerNotifications` | Effect |
|---|---|---|
| **Sink-only verification** (default) | `false` | Bypasses the notify job entirely. No WebSocket push, no Pulse card, no Layout nav badge update. Row appears in the DB and in the admin page's "test incidents" filter. Useful for: verifying ingestion, suppression, dedupe. |
| **Full pipeline verification** | `true` | Notify job runs normally. WebSocket push fires. Pulse card appears. Layout nav badge updates. Phase 0.75 email/Slack would also fire. Useful for: verifying end-to-end user-visible flow before production notifications go live. |

**Guardrails on full-pipeline mode:**

1. Rate limit: max 2 full-pipeline test incidents per sysadmin per hour (separate from the sink-only limit of 10/hour). Prevents accidental alert storms during testing.
2. UI confirmation: checking the box shows a warning "This will trigger real notifications to all sysadmins with notifications enabled. Continue?" — require explicit confirmation.
3. Subject/summary tagged: when `triggerNotifications=true`, the incident's `summary` is prefixed with `[TEST]` automatically so recipients see at a glance it's not real.
4. Never auto-escalated. Even in full-pipeline mode, test incidents are ineligible for agent escalation (the escalate button is hidden in the drawer for test incidents).

**Rate limit (sink-only):** max 10 test incidents per system-admin per hour — prevents misuse and accidental spam during rapid testing.

**Why split modes:** v3 made test incidents invisible to the notification pipeline entirely, which meant the WebSocket + Pulse + nav-badge flow could not be tested without reproducing a real error. v4 restores that capability behind an explicit, confirmed, heavily-rate-limited flag. The default is still safe (no notifications); the opt-in exists for pre-production verification.

## 9. Phase 0.5 — In-app notifications

### 9.1 Scope (revised per §0.3)

Phase 0.5 ships **in-app only** notification surfaces. Email, Slack, and SMS push channels — along with per-user preferences — defer to **Phase 0.75** (see §16.1).

In-app surfaces in Phase 0.5:

1. **Admin incidents page** (`/system/incidents`) — default view shows open + investigating + escalated incidents. Primary triage surface.
2. **Pulse** — `system_incident` kind in the `internal` lane for sysadmin users.
3. **Layout nav badge** — red dot on the "Incidents" nav entry when there are open critical or high incidents. Numeric badge for count when > 0.
4. **Event log** — every notification-surfacing event (opened, severity-escalated, etc.) appends to the incident's `system_incident_events` timeline, so Phase 0.75's push channels can consume the same signal without adding new observability hooks.

Sysadmins are the only recipients. Non-sysadmin users see no system-incident surfaces.

### 9.2 Notification trigger job (Phase 0.5 role)

**New pg-boss job:** `system-monitor-notify`

Enqueued by the ingestion service (§5.1 step 6) when an incident crosses a notification threshold:

1. An incident is newly opened AND severity is `high` or `critical`.
2. An incident occurrence count crosses `10`, `100`, or `1000` (configurable via `SYSTEM_INCIDENT_NOTIFY_MILESTONES`).
3. An incident's severity escalates via the "never-de-escalate" rule (e.g. existing `medium` incident receives a `high` occurrence).

Consumed by a new handler: **`server/jobs/systemIncidentNotifyJob.ts`**

In Phase 0.5 the job does:

1. Fetches the incident.
2. Checks suppression — if `system_incident_suppressions` matches, skip.
3. Writes a `notification_surfaced` event to the incident's event log.
4. Emits a WebSocket `system_incident:updated` event to all connected sysadmin sessions so the admin page + nav badge refresh without waiting for the 10-second poll tick.
5. *(Phase 0.75 extends this handler to fan out to email/Slack after the fatigue-guard check.)*

Job idempotency key: `incident-notify:${incidentId}:${severity}:${occurrenceCount}`. Guards against duplicate events from retries.

**Why build the job now even though Phase 0.5 doesn't push anywhere:** (a) the ingestion service already emits the signal, (b) the WebSocket fan-out is a legitimate Phase 0.5 feature, (c) it leaves Phase 0.75 as a small diff that only adds channel adapters. The job is not dead code.

### 9.3 Fatigue guard — reuse AlertFatigueGuard

**Refactor:** Extract the generic parts of `server/services/alertFatigueGuard.ts` into a base class.

```ts
// server/services/alertFatigueGuardBase.ts  (new)
export abstract class AlertFatigueGuardBase {
  protected alertsThisRun = 0;
  protected abstract queryTodayCount(key: string): Promise<number>;
  protected abstract getLimits(): AlertLimits;

  async shouldDeliver(key: string, severity: Severity): Promise<{ deliver: boolean; reason?: string }> {
    // ... common logic: batch-low-priority check, per-run cap, per-key daily cap
  }
}
```

Then:

- Existing `AlertFatigueGuard` extends the base (wired to `anomaly_events` + `accountId`). **Behaviour preserved byte-for-byte.** This is a safe refactor — Portfolio Health Agent's limits, count queries, and delivery decisions remain identical.
- A **`SystemIncidentFatigueGuard` subclass is created but not invoked in Phase 0.5** (no push channels to gate). It is wired up in Phase 0.75.

**Why extract now even though we don't use it:** Phase 0.75 will add email + Slack channels and immediately need the guard. Extracting the base class in Phase 0.5 keeps the Portfolio Health refactor isolated in a smaller commit and avoids bundling an unrelated refactor into Phase 0.75's notification PR. It also gives Phase 0.5 a place to document the behavioural contract.

Default limits for system incidents (referenced by Phase 0.75):

```ts
const SYSTEM_INCIDENT_ALERT_LIMITS: AlertLimits = {
  maxAlertsPerRun: 5,
  maxAlertsPerKeyPerDay: 6,            // per fingerprint per calendar day
  batchLowPriority: false,             // revisit in Phase 1 with daily digest
  criticalBypass: true,                // critical incidents can exceed maxAlertsPerKeyPerDay by 2
};
```

`self`-source incidents (§5.7) bypass the fatigue guard on first occurrence per UTC day (applies in Phase 0.75 when guard is active).

### 9.4 WebSocket fan-out

Extend the existing WebSocket infrastructure (`client/src/hooks/useSocket.ts` + server-side emitter) to emit a `system_incident:updated` room-scoped event to users with `system_admin = true`.

The admin page + Layout nav subscribe to this event and refetch. This cuts user-visible latency from the 10s polling interval down to sub-second on new incidents — without pushing anything outside the browser.

### 9.5 Observability of notifications

Every notification-surfacing event writes a `notification_surfaced` row to the incident's `system_incident_events` log. Phase 0.75 will additionally write `email_sent`, `slack_sent`, `email_throttled`, etc. events using the same timeline — a sysadmin reading the incident detail drawer always sees "what was done about this, when, by whom" in one place.

### 9.6 What's NOT in Phase 0.5 (explicit)

- No email.
- No Slack.
- No SMS.
- No per-user notification preferences.
- No daily digest.
- No fatigue-guard invocation (the class exists; nothing calls it).

All of the above are in Phase 0.75 (§16.1).

## 10. Phase 0.5 — Pulse integration + manual-escalate-to-agent

### 10.1 Pulse integration

**File change:** `server/services/pulseService.ts`

Extend the `PulseItem` kind union:

```ts
kind: 'review' | 'task' | 'failed_run' | 'health_finding' | 'system_incident';
```

Extend the `source` union:

```ts
source: 'reviews' | 'tasks' | 'runs' | 'health' | 'system_incidents';
```

**New getter in pulseService:** `getSystemIncidents(userId: string): Promise<PulseItemDraft[]>`

Returns open (non-acked) system incidents that a user should attend to:

- If user is a system admin: critical + high incidents with `status in ('open', 'investigating', 'escalated')`, **deduplicated per fingerprint** (v3) — see below.
- Otherwise: no system incidents (they don't see them).

**Lane assignment:** system incidents go to the `internal` lane. They are never `client` or `major` lane items.

**Fingerprint dedupe with blast-radius awareness (v3 / v4):** Pulse is a supervision surface, not an incident log. If the same fingerprint produces five concurrent open incidents — for example, across multiple orgs during a cross-cutting outage — Pulse shows **one card, not five**, but the subtitle surfaces the **distinct organisation count** so cross-org systemic issues don't hide behind single-card dedupe.

Implementation (conceptual shape — actual query uses Drizzle):

```sql
WITH active AS (
  SELECT id, fingerprint, severity, summary, last_seen_at,
         occurrence_count, organisation_id
  FROM system_incidents
  WHERE status IN ('open', 'investigating', 'escalated')
    AND severity IN ('high', 'critical')
    AND acknowledged_at IS NULL
    AND is_test_incident = false
),
-- Winning row per fingerprint (highest severity, most recent)
winners AS (
  SELECT DISTINCT ON (fingerprint) *
  FROM active
  ORDER BY fingerprint, severity DESC, last_seen_at DESC
),
-- Aggregates per fingerprint
aggregates AS (
  SELECT fingerprint,
         COUNT(*) AS group_count,
         COUNT(DISTINCT organisation_id) AS distinct_org_count,
         SUM(occurrence_count) AS total_occurrences
  FROM active
  GROUP BY fingerprint
)
SELECT w.*, a.group_count, a.distinct_org_count, a.total_occurrences
FROM winners w JOIN aggregates a USING (fingerprint)
ORDER BY w.severity DESC, w.last_seen_at DESC;
```

The card links to the winning incident. Subtitle composition (v4):

| Condition | Subtitle shape |
|---|---|
| `groupCount = 1` | `${source} · ${occurrenceCount}× · ${timeAgo}` |
| `groupCount > 1`, `distinctOrgCount = 1` | `${source} · ${totalOccurrences}× · ${groupCount} incidents · ${timeAgo}` |
| `groupCount > 1`, `distinctOrgCount > 1` | `${source} · ${totalOccurrences}× · ${groupCount} incidents · ${distinctOrgCount} orgs · ${timeAgo}` |

**Why the org count matters:** 10,000 occurrences concentrated in one org suggests a tenant-specific configuration issue (contact the tenant). 10,000 occurrences spread across 500 orgs suggests a platform-wide regression (halt deploys, find the root cause). The subtitle surfaces that distinction at a glance — no drill-down required.

**Edge case: system-level incidents (organisationId IS NULL):** counted under `distinctOrgCount` as a single bucket (treated as "system" org for aggregation). This means `distinctOrgCount = 1` for a purely system-level fingerprint; `distinctOrgCount = 4` for three tenants plus system-level.

**Surfacing thresholds (v3):** to avoid Pulse churn from noisy incidents, only surface a Pulse card when:

1. **First open** of a fingerprint (new card appears).
2. **Severity escalation** of an existing fingerprint (card re-appears if previously acked, or gets a "severity escalated" annotation if still active).

Incremental occurrence-count increments do NOT re-surface a card that was previously acknowledged. The sysadmin already knows about the fingerprint — they don't need Pulse to shout about it again every 30 seconds.

This is implemented in the query above via the `acknowledged_at IS NULL` filter: once a sysadmin acks the highest-severity incident for a fingerprint, Pulse stops showing cards for it until either a new fingerprint appears or the severity escalates.

**Item shape:**

```ts
{
  kind: 'system_incident',
  source: 'system_incidents',
  id: incident.id,
  title: `[${severity.toUpperCase()}] ${incident.summary}`,
  subtitle: `${incident.source} · ${incident.occurrenceCount}× · ${timeAgo(incident.lastSeenAt)}`,
  lane: 'internal',
  urgency: severityToUrgency(incident.severity),   // critical=10, high=8, medium=5, low=2
  href: `/system/incidents/${incident.id}`,
}
```

### 10.2 Manual escalate-to-agent

The "Escalate to agent" button on the incident detail drawer (§8.3) is the Phase 0.5 usability feature that lets the user **experiment with agent-led diagnosis on real incidents without building a dedicated system-monitor agent**. It reuses the existing Orchestrator pipeline.

**Endpoint:** `POST /api/system/incidents/:id/escalate` (§7.1)

**Service method:** `systemIncidentService.escalateIncidentToAgent(incidentId, userId)`

**Mechanics:**

1. Load the incident.
2. Validate: incident status is `open`, `investigating`, or `escalated` (resolved/suppressed incidents cannot be escalated).
3. **Guardrail: duplicate escalation check (v3 addition — see §10.2.5 for full detail).**
4. Resolve the **designated system-admin subaccount** for escalation context. See §10.3 for what this is.
5. Create a task via `taskService.createTask` with shape:
   - `title`: `[Incident ${shortFingerprint}] ${incident.summary}` (add `· re-escalation #N` suffix if `escalationCount > 1` per §10.2.5)
   - `description`: a rendered template including incident details (see §10.4)
   - `organisationId`: the system-admin org (see §10.3)
   - `subaccountId`: the system-admin subaccount
   - `createdByUserId`: the escalating sysadmin
   - `createdByAgentId`: `null` (matters — Orchestrator eligibility predicate checks this)
   - `status`: `'inbox'` (required for Orchestrator trigger)
   - `parentTaskId`: `null`
6. Update incident: `status = 'escalated'`, `escalatedAt = NOW()`, `escalatedTaskId = <new task id>`, `escalationCount += 1` (v3).
7. Append `escalation` event to `system_incident_events` with `actorKind='user'`, `payload: { taskId, incidentId, escalationCount, previousTaskIds: [...] }`.
8. Return `{ incident, taskId, isReEscalation: boolean }` to the caller.

The existing `orchestratorFromTaskJob.ts` job is automatically enqueued by `taskService.createTask` (per architecture.md §Orchestrator Capability-Aware Routing). It picks up the task, routes it through the four-path decision model, and either resolves it directly, hands it to an appropriate specialist agent, or opens a clarifying question back to the escalating user via the normal task UI.

**Crucially: no new agent is built for Phase 0.5.** The escalation leverages existing routing infrastructure. If Orchestrator doesn't know what to do with "diagnose this incident" — which it likely won't on day one — the sysadmin will see a "no capable agent" response and learn the system's current limits. This is useful diagnostic information for designing Phase 2.

### 10.2.5 Escalation guardrails (v3)

The v2 design allowed unlimited escalations on a single incident, producing unbounded duplicate tasks. v3 adds explicit guardrails.

**Schema addition:** `system_incidents.escalation_count integer NOT NULL DEFAULT 0`. Added in the Phase 0 migration alongside the other incident columns.

**Schema addition:** `system_incidents.previous_task_ids uuid[] NOT NULL DEFAULT '{}'`. Records the history of escalated task IDs — the current `escalatedTaskId` plus every prior escalation's task ID. Supports auditing "how many times did we throw this at an agent before giving up?"

**Endpoint behaviour:**

`POST /api/system/incidents/:id/escalate` accepts an optional body `{ force?: boolean }`.

| State | `force` | Result |
|---|---|---|
| `escalatedTaskId IS NULL` (first escalation) | any | Proceed. Creates task, sets `escalationCount = 1`. |
| `escalatedTaskId IS NOT NULL`, `escalationCount < 3`, previous task is still open/in-progress | `false` / absent | **Return `409 Conflict`** with shape `{ error: { code: 'ALREADY_ESCALATED', message, existingTaskId, existingTaskStatus } }`. UI shows a confirmation modal; user must click "Escalate again anyway". |
| Same as above | `true` | Proceed. Appends previous `escalatedTaskId` to `previous_task_ids`, creates new task, sets `escalatedTaskId = <new>`, increments `escalationCount`. |
| `escalatedTaskId IS NOT NULL`, previous task is `completed` / `cancelled` / `closed_*` | any | Proceed automatically (previous escalation has finished; new escalation is legitimate). Updates as above. |
| `escalationCount >= 3` | any | **Return `429 Too Many Requests`** with shape `{ error: { code: 'ESCALATION_LIMIT_REACHED', message: 'Incident has been escalated 3 times. Resolve the incident or contact a platform engineer to lift the cap.' } }`. Hard stop. Requires an admin action to reset (set `escalationCount = 0` via the API in a future phase; for Phase 0.5, an incident that hits the cap requires manual intervention — resolve it or mark it as a known issue and suppress). |

**Rate limit (independent of the count cap):** per incident, one escalation request every 60 seconds. Prevents double-clicks on the Escalate button from creating two parallel tasks. Implemented as a simple DB check of `escalatedAt > NOW() - INTERVAL '60 seconds'`.

**UI behaviour (admin page detail drawer):**

- If `escalationCount === 0`: button reads "**Escalate to agent**".
- If `escalationCount === 1` and previous task still open: button reads "**Escalate again**" with tooltip showing the existing task link + status.
- If `escalationCount >= 2`: button reads "**Escalate again (N×)**" in amber; click opens a confirmation modal explicitly listing previous escalations and their outcomes.
- If `escalationCount >= 3`: button is **disabled** with explainer tooltip: "Escalation limit reached (3). Resolve or suppress this incident, or contact a platform engineer."

**Why these specific thresholds:**

- **Soft limit at 1** (confirmation required): catches the accidental double-click and the "oh, I already did that" amnesia. Minor friction, prevents task-spam.
- **Hard limit at 3**: three escalations without resolution means the incident is either unfixable by the current agent infrastructure (Phase 2 problem) or the user is misusing the button. Either way, no amount of re-escalating will help.
- **60-second rate limit**: empirically tight enough to block UI races; loose enough that a human actually deciding to re-escalate is never blocked.

**Event log:** each escalation attempt — including blocked ones — writes an event. Blocked attempts use `eventType='escalation_blocked'` with `payload: { reason: 'ALREADY_ESCALATED' | 'RATE_LIMIT' | 'LIMIT_REACHED', existingTaskId }`. This closes the observability loop: "why couldn't I escalate?" is answerable from the drawer without checking server logs.

### 10.3 Designated escalation target (per Q2 §0.2 — decided)

**Decision: Option 3 (hybrid) with a new seeded "System Operations" org for the system-level fallback.**

**Resolution logic at escalation time:**

```ts
if (incident.organisationId) {
  // Org-scoped incident — escalate inside the affected org's sentinel subaccount
  // (same pattern Orchestrator uses for task routing today)
  target = { orgId: incident.organisationId, subaccountId: sentinelSubaccountOf(incident.organisationId) };
} else {
  // System-level incident — escalate to the seeded System Operations org
  target = { orgId: SYSTEM_OPS_ORG_ID, subaccountId: SYSTEM_OPS_SUBACCOUNT_ID };
}
```

**System Operations org seeding:**

- New column: `organisations.is_system_org boolean NOT NULL DEFAULT false`. Added in the Phase 0.5 migration.
- Seed migration creates one row with `is_system_org = true`, name `"System Operations"`, slug `system-ops`. Only one such row allowed system-wide (enforced by a partial unique index: `UNIQUE(is_system_org) WHERE is_system_org = true`).
- Seeds one sentinel subaccount inside it (`"System Ops"`), modelled on the existing org-sentinel subaccount pattern used by Orchestrator.
- The System Operations org is **hidden from non-sysadmin users** — any org-listing endpoint must filter `is_system_org = false` unless the caller has `system_admin = true`. Add this filter to existing org-listing services as a prerequisite to this migration.
- `SYSTEM_OPS_ORG_ID` and `SYSTEM_OPS_SUBACCOUNT_ID` are resolved at app boot into a runtime config cache; they are not env vars (avoid per-env drift).

**Why a seeded org and not a flag on an existing org:**

1. No existing org is shaped to be "infrastructure" — picking one would couple incident escalations to a tenant.
2. The System Operations org can later host: the monitor agent (Phase 2) which runs with no natural tenant, the dev agent (Phase 4), and any other platform-level agents. We'd end up needing this anyway.
3. Isolation is stronger: incident tasks never pollute a tenant's task board, and visibility gating is a single column check, not ad-hoc.

**Why not use Orchestrator's existing sentinel pattern system-wide:**

Orchestrator's sentinel lives inside each tenant org. There's no canonical "system" org to place a system-wide sentinel in. The seeded `System Operations` org *is* the system-wide sentinel — it is the structural answer to "where do platform-level agents live?"

### 10.4 Task description template

```markdown
## System Incident Escalation

**Severity:** {severity}
**Source:** {source}
**Fingerprint:** `{fingerprint}`
**Occurrences:** {occurrenceCount}
**First seen:** {firstSeenAt} ({timeAgoFirstSeen})
**Last seen:** {lastSeenAt} ({timeAgoLastSeen})

### Summary
{summary}

### Error detail
```json
{latestErrorDetail | JSON.stringify, indent=2, truncate=4000 chars}
```

### Stack trace
```
{latestStack | truncate=4000 chars}
```

### Affected resource
{if affectedResourceKind}
- Kind: {affectedResourceKind}
- ID: {affectedResourceId}
- Link: {deepLinkIfAvailable}
{else}
No specific resource affected.
{endif}

### Correlation ID
`{latestCorrelationId}`

### Action requested
Please diagnose the root cause and recommend a remediation. Do NOT take any corrective action — this is a diagnosis request only. When complete, add a comment summarising:
1. Root cause
2. Recommended fix (code change, config update, or "requires human intervention")
3. Estimated severity if not remediated
4. Confidence level

System admin link: [/system/incidents/{incidentId}]({adminBaseUrl}/system/incidents/{incidentId})
```

This template is authored with Orchestrator's Path D (clarifying question back to user) and Path B (handoff to specialist) both in mind. The "do NOT take corrective action" line is load-bearing — it keeps the escalation read-only.

### 10.5 Back-link from task to incident

When viewing the task in the normal task UI, the description renders the system-admin-incident link. Additionally, the task's `linkedEntityKind = 'system_incident'` and `linkedEntityId = incident.id` so that future UI can render a back-reference pill. Check `server/db/schema/tasks.ts` to confirm the linked-entity columns exist; if not, this is a small schema addition (one column each) and is included in the Phase 0.5 migration.

### 10.6 What happens after escalation

- The incident stays in `escalated` status while the task is being worked.
- If the task completes (`completed` status), the incident stays in `escalated` — a human must explicitly transition it via Resolve or re-open. Auto-transitions are a scope-creep trap; keep human in the loop.
- If the task is cancelled, the incident goes back to `investigating`.
- If the incident recurs (same fingerprint, new occurrence) while in `escalated` status, the `occurrence_count` increments and an `occurrence` event is appended, but the status does NOT change and no new escalation task is created. The escalating admin sees recurrence pressure in the drawer without duplicate work.

### 10.7 What Phase 0.5 does NOT enable

To avoid ambiguity: manual escalate-to-agent is a **one-click human trigger**, not an automated loop. It does NOT:

- Auto-escalate high-severity incidents.
- Send the task to any specific agent (Orchestrator decides).
- Grant the agent any remediation permissions (it can only read).
- Create a feedback loop where the agent's response affects incident status automatically (a human resolves/acks).

These are all intentional Phase 2 boundaries.

## 11. File inventory

### 11.1 New files

**Migrations:**

- `migrations/NNNN_system_incidents.sql` — three tables + indexes + RLS manifest update

**Server — schema:**

- `server/db/schema/systemIncidents.ts`
- `server/db/schema/systemIncidentEvents.ts`
- `server/db/schema/systemIncidentSuppressions.ts`
- Re-export all three from `server/db/schema/index.ts`

**Server — services:**

- `server/services/incidentIngestor.ts` — the core ingestion function (§5)
- `server/services/incidentIngestorPure.ts` — pure logic companion (fingerprint, classify, normalise) — test target
- `server/services/systemIncidentService.ts` — CRUD-ish service (§7.2)
- `server/services/alertFatigueGuardBase.ts` — extracted base class (§9.3)
- `server/services/systemIncidentFatigueGuard.ts` — subclass declared in Phase 0.5; **invoked in Phase 0.75**

**Deferred to Phase 0.75 (NOT in Phase 0.5):**

- ~~`server/services/notificationService.ts`~~ — Phase 0.75
- ~~`server/services/notifications/emailChannel.ts`~~ — Phase 0.75
- ~~`server/services/notifications/slackChannel.ts`~~ — Phase 0.75
- ~~`server/services/notifications/smsChannelStub.ts`~~ — Phase 0.75

**Server — routes:**

- `server/routes/systemIncidents.ts` (§7.1)

**Server — jobs:**

- `server/jobs/systemIncidentNotifyJob.ts` (§9.2)
- `server/jobs/systemMonitorSelfCheckJob.ts` — 5-minute self-check (§5.7)
- Register both in `server/jobs/index.ts`

**Server — tests (pure):**

- `server/services/__tests__/incidentIngestorPure.test.ts` — fingerprint determinism, classification, normalisation
- `server/services/__tests__/systemIncidentFatigueGuardPure.test.ts` — per-run cap, per-key cap, batching, critical bypass
- `server/services/__tests__/systemIncidentServicePure.test.ts` — lifecycle state machine

**Server — tests (integration):**

- `server/services/__tests__/incidentIngestorIntegration.test.ts` — DB upsert, event append, suppression, self-source protection
- `server/routes/__tests__/systemIncidents.test.ts` — route auth, filter behaviour, action endpoints
- `server/jobs/__tests__/systemIncidentNotifyJob.test.ts` — threshold triggers, fatigue guard, channel fan-out

**Client — pages:**

- `client/src/pages/SystemIncidentsPage.tsx`
- `client/src/components/system-incidents/IncidentDetailDrawer.tsx`
- `client/src/components/system-incidents/ResolveModal.tsx`
- `client/src/components/system-incidents/SuppressModal.tsx`
- `client/src/components/system-incidents/EscalateModal.tsx`
- `client/src/components/system-incidents/incidentsTablePure.ts` — sort/filter/pagination pure helpers
- `client/src/components/system-incidents/__tests__/incidentsTablePure.test.ts`

### 11.2 Modified files

| File | Change |
|---|---|
| `server/index.ts:343-385` | Add `recordIncident` call to global error handler |
| `server/lib/asyncHandler.ts` | Add `recordIncident` on `unhandled_route_error` path |
| `server/services/dlqMonitorService.ts` | Add `recordIncident` in DLQ callback |
| `server/services/agentExecutionService.ts` | Add `recordIncident` on terminal-failed transitions |
| `server/services/connectorPollingService.ts` | Add `recordIncident` in poll failure branch |
| `server/services/skillExecutor.ts` | Add `recordIncident` on retry exhaustion with system-fault |
| `server/services/llmRouter.ts` | Add `recordIncident` for parse-failure + reconciliation-required |
| `server/services/pulseService.ts` | Add `system_incident` kind + `getSystemIncidents` getter |
| `server/services/alertFatigueGuard.ts` | Refactor to extend new base class (behaviour preserved byte-for-byte) |
| `server/lib/permissions.ts` | Add `SYSTEM_PERMISSIONS.INCIDENT_*` keys |
| `server/config/rlsProtectedTables.ts` | Explicitly omit the 3 new tables (Option A per §7.4) |
| `server/db/schema/index.ts` | Re-export 3 new schema files |
| `server/db/schema/agentRuns.ts` | Add `correlation_id` column (prereq P1 per §0.1) |
| `server/db/schema/tasks.ts` | Add `linkedEntityKind` + `linkedEntityId` columns (prereq P4 per §0.1) |
| `server/db/schema/organisations.ts` | Add `isSystemOrg` boolean column + partial unique index (§10.3) |
| `server/jobs/index.ts` | Register 2 new jobs (`systemIncidentNotifyJob`, `systemMonitorSelfCheckJob`) |
| `server/services/taskService.ts` | Accept `linkedEntityKind` + `linkedEntityId` in createTask |
| `server/services/organisationService.ts` (or equivalent org-listing service) | Filter `is_system_org = false` for non-sysadmin callers (§10.3) |
| `client/src/App.tsx` | Add `/system/incidents` route + lazy import |
| `client/src/components/Layout.tsx` | Add nav entry under System Admin section with red-dot badge (§9.1) |
| `client/src/hooks/useSocket.ts` (or equivalent) | Subscribe to `system_incident:updated` room event (§9.4) |
| `architecture.md` | New section: System Incidents + Monitoring Foundation |
| `docs/capabilities.md` | Add "System Incident Monitoring" entry under Support-facing section (editorial rules §1) |

**Deferred to Phase 0.75 (NOT in Phase 0.5):**

- ~~`server/db/schema/userSettings.ts`~~ — no `notificationPreferences` column in Phase 0.5 (push channels don't exist)

### 11.3 Not changed (explicit non-changes)

- `connector_configs`, `workspace_health_findings` schemas — unchanged. The sink is additive.
- `agent_runs` — only a nullable `correlation_id` column is added (prereq P1); no behavioural changes.
- `tasks` — only `linkedEntityKind` + `linkedEntityId` columns are added (prereq P4); no behavioural changes.
- Global error handler's client response shape — unchanged.
- Existing `asyncHandler` behaviour — unchanged (ingestion is side-effect).
- `anomaly_events` table — unchanged; it stays for its own purpose (business-metric anomalies for ClientPulse).
- Portfolio Health Agent — unchanged. Its `AlertFatigueGuard` refactors to extend the new base class, but behaviour is preserved byte-for-byte and verified by a regression test.
- All existing org-listing endpoints — behaviour unchanged for sysadmin users. For non-sysadmins, a new `is_system_org = false` filter is added; since only the newly-seeded System Operations row has `is_system_org = true`, existing orgs are unaffected.

## 12. Testing strategy

### 12.1 Pure tests (unit, fast, deterministic)

**Fingerprint:** given a canonical `IncidentInput`, verify `computeFingerprint` returns the expected 16-char hash. Test UUID stripping, timestamp stripping, numeric-ID stripping, top-frame selection across stacks that include ingestor/logger noise. One test per normalisation rule.

**Classification:** matrix test of `(source, errorCategory, statusCode, classificationOverride)` → expected classification. Include explicit override cases.

**Severity default:** matrix test of source + statusCode → expected default severity per §5.5 table.

**Fatigue guard:** port the existing `AlertFatigueGuard` tests, add system-incident subclass tests for per-fingerprint daily cap + critical bypass.

**Table sort/filter (client):** standard `ColHeader` pattern tests, mirror `SystemSkillsPage` tests.

**Lifecycle state machine:** valid/invalid transitions for `open → investigating → escalated → resolved`, `open → suppressed`, etc.

### 12.2 Integration tests (DB required)

**Ingestor DB:**

- Upsert increments `occurrence_count` for existing active fingerprints.
- Partial unique index prevents a second open row with the same fingerprint.
- Resolving an incident then firing the same fingerprint creates a NEW incident row.
- Severity never de-escalates on subsequent occurrences.
- Suppression check short-circuits writes.
- `self`-source incidents bypass fatigue guard on first fire per UTC day.
- Concurrent ingests of the same fingerprint serialise correctly (two workers firing simultaneously produce one row with `occurrence_count = 2`).

**Integration points:**

- Route 500 produces route-source incident.
- Route 4xx does NOT produce system-fault incident (user-fault classification).
- DLQ job produces job-source incident with correct queue + payload.
- Agent run terminal-fail produces agent-source incident.
- Connector poll failure produces connector-source incident.

**Lifecycle route tests:** ack / resolve / suppress / escalate each produce correct state + event rows + audit events.

**Escalate-to-agent:** creates a task with correct shape, task has `linkedEntityKind/Id` set, incident flips to `escalated`, event row written.

### 12.3 End-to-end smoke (manual, pre-ship)

One-time scripted run after deploy. Phase 0.5 has no push channels (per §9 and §0.3); smoke tests validate in-app surfaces only. The email/Slack smoke steps move to Phase 0.75's test plan.

1. Trigger a contrived route 500 via a test endpoint — verify incident appears on `/system/incidents`.
2. Click Acknowledge — verify incident shows "Acknowledged" state.
3. Click Resolve with note — verify resolved.
4. Trigger same fingerprint again — verify NEW incident opens.
5. Suppress it — verify next occurrence does not create a new incident AND increments `suppressed_count` on the suppression row (per §4.3 suppression visibility).
6. Trigger a critical system-fault incident — verify:
    a. Appears in Pulse (`internal` lane, `system_incident` kind) for the sysadmin user.
    b. Layout nav entry shows a red-dot badge.
    c. Admin page receives a WebSocket `system_incident:updated` event within 1 second — no manual refresh needed.
    d. Default admin page view shows the incident at the top of the list.
7. Trigger an incident that's already been acked — confirm badge does NOT re-fire.
8. Click Escalate on an incident — confirm task appears in the correct subaccount per §10.3 (own org sentinel for org-scoped, System Operations for system-level) and Orchestrator picks it up.
9. Click Escalate again on the same incident — confirm the duplicate-escalation guardrail (§10.2.5) either blocks or requires explicit confirmation.
10. Use the test-incident trigger (§8.9) — verify the incident is hidden from the default list, visible when "Show test incidents" is toggled, and does NOT produce a WebSocket push or Pulse card.

### 12.4 Load/performance test

One scripted load test, run before ship:

- Fire 10,000 incidents across 100 unique fingerprints over 60 seconds.
- Verify: 100 rows in `system_incidents`, aggregate `occurrence_count = 10000`, p95 ingest latency < 100ms, no request errors on the caller side.

If p95 > 100ms, enable async mode (§5.8) before shipping.

### 12.5 Testing what we're NOT testing in Phase 0

- No test for the agent-led diagnosis quality (there is no dedicated agent yet).
- No test for auto-remediation (not in scope).
- No test for synthetic check correctness (Phase 1).

## 13. Rollout plan

### 13.1 Branch + PR strategy

- Single PR on the designated branch `claude/system-monitoring-agent-PXNGy`.
- Single atomic deliverable — Phase 0 ingestion + Phase 0.5 UI + notifications ship together.
- Reasoning: ingestion without UI is invisible; UI without ingestion is empty. Ship them together for a complete feature.

### 13.2 Phased roll-in (inside the PR)

Commits in order:

1. Prereq mini-migrations (P1 agent_runs.correlation_id, P4 tasks.linkedEntityKind/Id, §10.3 organisations.isSystemOrg + System Operations seed row)
2. Core schema + migration + RLS manifest (three new incident tables + isTestIncident column)
3. Ingestor service + pure tests
4. Ingestor integration points (one commit per integration: route, asyncHandler, DLQ, agent, connector, skill, LLM)
5. Routes + service + permissions
6. AlertFatigueGuardBase extraction (Portfolio Health refactor, behaviour-preserving)
7. Notify job (in-app + WebSocket fan-out, no push channels)
8. Self-check job
9. Admin UI page + components + test-incident trigger + client tests
10. Pulse integration + Layout nav badge
11. Manual escalate-to-agent service + task shape + System Operations org wiring
12. Org-listing service filter for non-sysadmin visibility (§10.3)
13. Architecture.md + capabilities.md updates (per CLAUDE.md §11 "docs stay in sync")

### 13.3 Deployment

- Ship to staging first. Let it run 48 hours. Hunt for unexpected ingest spikes.
- Verify `system_incidents` counts by source align with expected error distribution (if route-source count is 10× what you expect, the ingestion path is double-firing).
- Then production.

### 13.4 Feature flag

No feature flag for ingestion — if we deploy it, we want it running. CLAUDE.md §Core Principles: "Don't use feature flags or backwards-compatibility shims when you can just change the code."

In Phase 0.5 there are no outbound push channels (per §9), so there is no notification kill switch at this phase — WebSocket fan-out + in-app surfacing are always on.

The single kill switch in Phase 0.5 is `SYSTEM_INCIDENT_INGEST_ENABLED` (env var, default `true`) — a safety valve on the ingestor itself per §13.6. All other behaviour is gated by status, suppression, and the `isTestIncident` flag.

Phase 0.75 will re-introduce `SYSTEM_INCIDENT_NOTIFICATIONS_ENABLED` as the push-channel kill switch.

### 13.5 Post-deploy monitoring

For the first week:

- Daily check of `system_incidents` counts: are we capturing what we expected?
- Watch for fingerprint collisions (two unrelated errors collapsing into one incident). If seen, tune the normalisation rules.
- Watch for fingerprint explosions (one error producing many distinct fingerprints due to insufficient normalisation). If seen, add a stripping rule.
- Confirm p95 ingest latency stays < 100ms.

### 13.6 Rollback plan

If a critical regression is found:

- The ingestion call sites are all try/catch wrapped with `.catch(() => ...)` — they cannot break the caller.
- Emergency rollback: set `SYSTEM_INCIDENT_INGEST_ENABLED = false` env var (add this as a kill switch at the top of `recordIncident`); ingestor becomes a no-op.
- Full rollback: revert the PR. Migration down is safe — tables drop cleanly; no dependent data.

### 13.7 Post-merge follow-up tasks (triaged, not blocking)

- Slack interactive buttons (deferred from §9.5).
- User preferences UI surface (deferred from §9.6).
- Daily digest delivery (deferred from §9.7).
- External observability integration (Sentry/Datadog/Loki hook — a 50-line adapter).

## 14. Dependencies and assumptions

All v1 open questions are resolved in §0.2. All v1 prerequisites are investigated in §0.1. This section retains the remaining runtime-only assumptions and the prerequisite work required inside the Phase 0 PR.

### 14.1 Prerequisite work bundled into the Phase 0 PR

None of these are separate PRs; they are included as preparatory commits within the Phase 0 PR.

- **P1 — `agent_runs.correlation_id` column.** Added via mini-migration + schema update. Populated on new rows only — no backfill.
- **P1 — pg-boss payload convention.** Document in `architecture.md` that new pg-boss job payloads SHOULD include a `correlationId` field. Do not bulk-refactor existing jobs. New jobs added from this PR onward follow the convention.
- **P4 — `tasks.linkedEntityKind/Id` columns.** Added via Phase 0.5 migration.
- **§10.3 — `organisations.isSystemOrg` column.** Added via Phase 0.5 migration. One-time seed row for "System Operations" org + sentinel subaccount.

Prerequisites that dropped OUT of this spec (per §0.3):

- ~~P2 (email)~~ — moved to Phase 0.75
- ~~P3 (Slack)~~ — moved to Phase 0.75
- ~~P5 (user notification preferences)~~ — moved to Phase 0.75

### 14.2 Resolved decisions

See §0.2 for the full 8-question decision table. All Q1–Q8 are answered; no outstanding user-input items gate Phase 0 or Phase 0.5 implementation.

### 14.3 Assumptions (runtime-only, cannot be verified until deployed)

| ID | Assumption | Risk if wrong |
|---|---|---|
| A1 | Existing `AlertFatigueGuard` behaviour is preserved byte-for-byte through the base-class extraction. | Portfolio Health Agent alerting regresses. Mitigated by integration test that runs the refactored guard against the same inputs the original test uses and expects identical outputs. |
| A2 | The Orchestrator's existing routing logic can handle "diagnose an incident" tasks well enough to be useful — or at minimum fail clearly with a readable "no capable agent" response. | Escalate-to-agent button produces unhelpful output. Acceptable failure mode — it's manual-trigger only, and the failure teaches us what Phase 2 needs to build. |
| A3 | Ingest p95 latency < 100ms is achievable with current DB shape. | Request latency regresses for the caller. Mitigated by the async fallback mode (§5.8) if measurements show otherwise. |
| A4 | 16-char fingerprint hash provides sufficient dedupe resolution at our scale. | Collisions group unrelated errors. Mitigated by post-deploy monitoring (§13.5) and the normalisation-rule tuning plan. |
| A5 | New correlation ID propagation is sufficient for grouping; the absence of correlation IDs on pre-existing pg-boss jobs does not significantly degrade incident analysis. | Phase 2 agent diagnosis has thinner context than ideal for job-source incidents. Acceptable — correlation IDs will organically spread as new jobs are added and existing ones are edited. |
| A6 | The existing org-listing services can be cleanly filtered by `is_system_org = false` for non-sysadmins. | Potential visibility leak of System Operations org. Mitigated by an explicit audit of every org-listing service at implementation time, and by a test that verifies a non-sysadmin user does not see the System Operations org in any listing endpoint. |

## 15. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Ingestion spike from runaway error loop floods the table | Medium | High | Suppression + fatigue guard + `SYSTEM_INCIDENT_INGEST_ENABLED` kill switch |
| Fingerprint collisions group unrelated errors | Medium | Medium | Post-deploy monitoring + normalisation-rule tuning; partial unique index lets us detect by inspecting one incident with odd stacks |
| Fingerprint explosion (one error → many fingerprints) | Medium | Medium | Same; watch for fingerprint count outpacing unique error types |
| Ingestor latency degrades request times | Low | High | p95 budget + async fallback mode |
| DB write failures from ingestor break the caller | Low | Critical | All calls wrapped in `.catch(() => ...)` swallow; integration test proves it |
| Notifications storm sysadmins | High (without fatigue guard) | High | Fatigue guard from day 1; `minSeverity: 'high'` default |
| Slack integration unavailable | Medium | Low | Adapter stubs out cleanly; email-only still works |
| Escalate-to-agent creates noisy tasks | Medium | Medium | Dedicated subaccount per §10.3 isolates the noise; the button's intended low-frequency use (experimental tool) |
| Manual-escalate abused to spam agent system | Low | Low | Rate-limit route; system-admin only; audit logged |
| RLS option A bites us in Phase 2 | Medium | Medium | Option A documented as Phase 0-only decision; revisit in Phase 2 design (recorded in §7.4) |
| Self-source incident creates infinite loop | Low | Critical | Hard guard: ingestor never self-calls; self-check job writes via raw SQL bypass (§5.7) |
| Ingestion adds 100MB/day DB growth nobody planned for | Medium | Low | Monitor table size in week-1 observability; add retention policy (e.g. hard-delete resolved > 90 days) as follow-up if needed |
| Orchestrator routes escalations badly, burning LLM budget | Medium | Medium | Manual trigger only — admins see the cost per click; not automated |

## 16. Future phases (summary only)

Included for context; NOT in scope for this spec.

### 16.1 Phase 0.75 — Email + Slack push notifications

**Prerequisite for:** production deployment. Phase 0.75 is the phase that turns the in-app-only observability from Phase 0.5 into a real pager, suitable for production use where sysadmins aren't staring at the admin page.

Scope:

- Add email outbound infrastructure. Choose a provider (likely **Resend** or **Postmark** for simplicity; **SendGrid** if there's already a billing relationship). Add the SDK dependency, SMTP/API credentials to env config, and a minimal email-sending abstraction. Do NOT build a full email templating system — plain-text emails are sufficient for Phase 0.75.
- Add Slack outbound. Choose between (a) incoming-webhook-per-channel — simplest, no app install needed, limited to one channel — and (b) a Slack app with a bot token and `chat.postMessage`. Recommendation: (a) for Phase 0.75, (b) for Phase 2 when interactive buttons matter.
- Build `server/services/notificationService.ts` with the channel-adapter shape specified in v1 of this spec.
- Wire `SystemIncidentFatigueGuard` into the `systemIncidentNotifyJob` so it actually decides delivery.
- Add `user_settings.notificationPreferences` column and a minimal UI surface on an existing user-settings page (channels on/off + min severity).
- Default preferences for sysadmin users: email+Slack enabled, `minSeverity: 'high'`.
- Default for non-sysadmins: all disabled.
- Event log additions: `email_sent`, `email_throttled`, `slack_sent`, `slack_throttled`, `email_failed`, `slack_failed`.

Dependencies: Phase 0 + 0.5 shipped.
Not in scope for 0.75: SMS (still a stub), daily digest, Slack interactive buttons. Those are Phase 1+.

Estimated size: ~3-5 days of focused work once provider choice is made. Small compared to Phase 0.5 because all the observability wiring already exists — this phase only adds channel adapters.

### 16.2 Phase 1 — Synthetic checks (proactive monitoring)

- `system-monitor-synthetic-checks` pg-boss job on 1-minute tick.
- Checks for absence-of-events: job queue stalls, no agent runs in N minutes, stale connectors, heartbeat probes.
- Writes incidents with `source='synthetic'`.
- Enables detection of silent failures that error-driven monitoring misses.
- Depends on Phase 0 sink.

### 16.3 Phase 2 — The monitoring agent (read-only)

- New system-managed agent `system_monitor`. Scope `system` (requires Option B principal context from §7.4).
- Auto-triggered by `system-monitor-triage` pg-boss job (enqueued by ingestor when incident opens with `severity >= medium`).
- Diagnosis-only skills: read recent logs, read job queue health, read failed agent runs, read DLQ jobs, read connector status.
- Annotation + escalation skills: annotate diagnosis on incident, escalate to human, propose (not execute) remediation.
- Modelled on Portfolio Health Agent's prompt shape.
- Rate-limited: max 2 invocations per incident fingerprint; persistent recurrence auto-escalates to human.
- Kill switch: `SYSTEM_MONITOR_ENABLED` env var.

### 16.4 Phase 3 — Auto-remediation (whitelist-only)

- New remediation skills, each with strict safety envelope: retry failed job, requeue agent run, disable feature flag, throttle connector, circuit-break skill.
- All `destructiveHint: true`; all logged as `remediation_attempt` + `remediation_outcome` event pairs.
- Rate limit: max 2 remediation attempts per fingerprint; recurrence after attempts auto-classifies `persistent_defect`.
- No remediation without explicit playbook match — agent cannot invent fixes.

### 16.5 Phase 4 — Dev-agent handoff (deferred)

- When incident classifies `persistent_defect`, emit structured bug report (repro, stack, affected files, proposed fix).
- Hand to a (not-yet-designed) development agent for code change authorship.
- Requires Phase 2 + 3 stable and a dev-agent spec of its own.
- Structured bug-report shape designed in Phase 3 to avoid refactor later.

---

**End of Phase 0 + 0.5 specification (v4 — final, implementation-ready).**

- v1 open questions: resolved (§0.2).
- v1 prerequisites: verified against the live codebase (§0.1).
- v2 scope conflict (push notifications): carved out into Phase 0.75 (§0.3, §9, §16.1).
- v3 reviewer feedback: all 2 critical + 5 high-impact + 4 medium-impact findings incorporated (§0.5).
- v4 second reviewer pass: 6 concrete findings applied; 3 future-proofing items captured as in-section deferred notes (§0.6).

Reviewer's final verdict on v3: "implementation-ready, no architectural blockers, green light." v4 closes the remaining tightening items before coding begins.

Next gate: `architect` (file-by-file implementation plan + structural validation) → then implementation.










