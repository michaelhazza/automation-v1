# System Monitoring Agent — Phase 0 + 0.5 Spec

**Status:** Draft — pre-architect-review
**Owner:** Platform
**Scope:** Server + client + migrations
**Not included in this spec:** Phase 1 (synthetic checks), Phase 2 (monitoring agent), Phase 3 (auto-remediation), Phase 4 (dev-agent handoff). Those phases have stub sections at the end for context only.

---

## Table of contents

1. [Summary](#1-summary)
2. [Context](#2-context)
3. [Goals, non-goals, success criteria](#3-goals-non-goals-success-criteria)
4. [Phase 0 — Schema](#4-phase-0--schema)
5. [Phase 0 — Ingestion service](#5-phase-0--ingestion-service)
6. [Phase 0 — Integration points](#6-phase-0--integration-points)
7. [Phase 0.5 — Routes, permissions, principal context](#7-phase-05--routes-permissions-principal-context)
8. [Phase 0.5 — Admin UI](#8-phase-05--admin-ui)
9. [Phase 0.5 — Notifications](#9-phase-05--notifications)
10. [Phase 0.5 — Pulse integration + manual-escalate-to-agent](#10-phase-05--pulse-integration--manual-escalate-to-agent)
11. [File inventory](#11-file-inventory)
12. [Testing strategy](#12-testing-strategy)
13. [Rollout plan](#13-rollout-plan)
14. [Dependencies and open questions](#14-dependencies-and-open-questions)
15. [Risk register](#15-risk-register)
16. [Future phases (summary only)](#16-future-phases-summary-only)

---

<!-- Sections below are written in chunks via Edit. -->

## 1. Summary

Build the observability foundation required to support a future system-level monitoring agent, without building the agent itself. Phases 0 and 0.5 deliver:

- A single **central incident sink** that captures every system-fault across the platform (routes, jobs, agent runs, connectors, skill executions, LLM calls).
- A **system admin incident page** that lists active incidents, supports ack/resolve/suppress, and gives sysadmins one place to triage faults.
- **Multi-channel notifications** (email + Slack) for high-severity incidents, with fatigue-guarding to prevent operator burnout.
- A **manual "Escalate to agent" affordance** that hands an incident to the existing Orchestrator pipeline for on-demand agent-led diagnosis — no new autonomous agent yet.

Phase 0/0.5 explicitly does NOT include: automated agent triage, auto-remediation, synthetic/heartbeat checks, or dev-agent handoff. Those are deferred to Phases 1–4, scoped after 2–4 weeks of real production incident data have accrued in the new sink.

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
- G0.5.3 Critical and high severity system-fault incidents trigger email and Slack notifications, deduplicated by the reusable fatigue guard.
- G0.5.4 System incidents appear in Pulse for sysadmin users under a new `system_incident` kind.
- G0.5.5 The "Escalate to agent" action creates a task scoped to a nominated system admin subaccount, which the existing Orchestrator routes to an appropriate agent for diagnosis. No new system agent is created in this phase.

### 3.2 Non-goals

- NG1 **No automated agent triage.** The `incident.triage` pg-boss job pattern from the audit is deferred to Phase 2.
- NG2 **No auto-remediation.** No skills that retry jobs, disable flags, restart connectors, etc. Those are Phase 3.
- NG3 **No synthetic/heartbeat checks.** Phase 1.
- NG4 **No dev-agent handoff.** Phase 4.
- NG5 **No log persistence layer.** `logger.ts` keeps writing to stdout; we do not add a `system_logs` table in Phase 0. Incidents are the persistent record; full log bodies live in `errorDetail`/`payload` on the event row.
- NG6 **No user-facing incident surface.** Phase 0.5 is system-admin only. Customer orgs do not see system incidents.
- NG7 **No external observability integration** (Sentry, Datadog, Loki). Out of scope for this phase — can layer on later by hooking the same ingestion service.
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
- SC0.5.2 Triggering a critical system-fault delivers an email (if SMTP configured) and a Slack message (if Slack integration active) to the sysadmin notification channel within 60s.
- SC0.5.3 Firing the same critical incident 20 times in 5 minutes delivers at most `N` notifications where `N` is configured by the fatigue guard (default 3).
- SC0.5.4 The "Escalate to agent" button creates a task in the designated system-admin subaccount, Orchestrator routes it, and an agent run is created against the incident's context. The incident's status flips to `escalated` and an event row is written.
- SC0.5.5 Pulse for a sysadmin user shows a `system_incident` card for each open non-acked critical/high incident in their visible orgs.

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
    escalatedTaskId: uuid('escalated_task_id').references(() => tasks.id),  // set by manual-escalate-to-agent button

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
      .$type<'occurrence'           // the fingerprint fired again
          | 'status_change'         // lifecycle transition
          | 'ack'                   // human acknowledged
          | 'resolve'               // human resolved
          | 'suppress'              // human suppressed
          | 'unsuppress'            // suppression lifted (auto or manual)
          | 'escalation'            // manual escalate-to-agent, or Phase 2 auto-escalation
          | 'remediation_attempt'   // Phase 3: something tried to fix
          | 'remediation_outcome'   // Phase 3: result of the attempt
          | 'diagnosis'             // Phase 2: agent annotated diagnosis
          | 'note'                  // free-form human note
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

- Suppression is checked BEFORE incident upsert in the ingestor. A suppressed fingerprint still gets a `logger.warn('incident_suppressed', { fingerprint, reason })` but no DB row.
- `reason` is mandatory — we require the operator to document why, so future sysadmins see the rationale.
- `expiresAt` null = permanent; set = auto-expire at that time (checked on ingestor read). No background job needed in Phase 0.5 — the check is lazy.
- Unique constraint on `(fingerprint, organisationId)`: one suppression rule per fingerprint per org-or-global scope.

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
6. **Emit notification signal.** Enqueue a `incident.notify` pg-boss job if the incident crossed a notification threshold (first open of a high/critical severity, or configured recurrence multiple). Phase 0.5 consumes this.

All of the above wrapped in a try/catch that logs but never throws. Ingestion failure must never break the caller.

### 5.2 Fingerprinting algorithm

Goals: (a) same real-world problem produces the same fingerprint, (b) unrelated problems do not collide, (c) fingerprint is stable across code refactors where the error meaning hasn't changed.

```ts
function computeFingerprint(input: IncidentInput): string {
  // Normalise each component, hash with sha256, take first 16 hex chars
  const parts = [
    input.source,                                    // 'route' | 'job' | ...
    input.errorCode ?? 'no_code',                    // typed error codes are the strongest signal
    normaliseMessage(input.summary),                 // strip UUIDs, timestamps, numeric IDs
    topFrameOf(input.stack),                         // one line: "at fooService (server/services/fooService.ts:42)"
    input.affectedResourceKind ?? 'no_resource',     // 'agent_run', 'integration_connection', etc.
  ].join('|');
  return crypto.createHash('sha256').update(parts).digest('hex').slice(0, 16);
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

function topFrameOf(stack: string | undefined): string {
  if (!stack) return 'no_stack';
  const lines = stack.split('\n').map(l => l.trim()).filter(l => l.startsWith('at '));
  // Skip ingestor/logger frames to avoid self-referential fingerprints
  const meaningful = lines.find(l => !l.includes('incidentIngestor') && !l.includes('lib/logger'));
  return (meaningful ?? lines[0] ?? 'no_stack').slice(0, 200);
}
```

**Why this shape:**

- `source` separates same-error-in-different-places so a DB timeout in a job doesn't collapse with a DB timeout in a route.
- `errorCode` is the strongest signal when available (typed errors like `ParseFailureError`, `ReconciliationRequiredError`). Always prefer it.
- `normaliseMessage` strips high-cardinality substrings (UUIDs, numeric IDs, timestamps) that would otherwise defeat dedupe.
- `topFrameOf` anchors to the actual code location so two different DB queries timing out don't collapse.
- `affectedResourceKind` keeps resource-type separation without using the specific resource ID (which would defeat dedupe — we WANT "40 failing agent runs" to collapse to one incident).
- 16 hex chars = 64 bits, collision probability is negligible at the scale we'll see.

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
}
```

### 5.5 Default severity inference

Callers should set severity when they know it. When they don't:

| Condition | Default severity |
|---|---|
| `source='route'` and `statusCode >= 500` | `medium` |
| `source='route'` and `statusCode in [408, 409, 429]` | `low` |
| `source='job'` (landed in DLQ, retries exhausted) | `high` |
| `source='agent'` (run terminal-failed) | `medium` |
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

Drizzle doesn't natively support partial-index conflicts, so we write this as a raw SQL call wrapped in a Drizzle service method. The `(xmax = 0)` trick returns `true` on INSERT and `false` on UPDATE — we use this to decide whether to emit `status_change` events and `incident.notify` jobs.

**Severity never de-escalates.** If an incident starts as `low` and later occurrences come in as `critical`, the row flips to `critical`. The reverse cannot happen automatically — only human resolution.

### 5.7 Self-source protection

The ingestor itself can fail (DB down, constraint violation, bug). If the ingestor errors while being called from a path that already handles errors, we must NOT recurse.

Rule: the ingestor **never calls itself**. Internal errors are logged with `logger.error('incident_ingest_failed', ...)` and return. A dedicated pg-boss job on a 5-minute cron (`systemMonitor.selfCheck`, Phase 0) scans the last 5 minutes of logs for `incident_ingest_failed` events and, if found, writes a single `source='self'` incident directly via a raw SQL path that bypasses the normal ingestor. This is the "who monitors the monitor" loop.

Self-sourced incidents:

- Always severity `high`.
- Always require HITL — never eligible for agent escalation in Phase 2+. Hard-coded guard.
- Bypass the fatigue guard for the first occurrence (the operator must know the monitor is broken).

### 5.8 Performance characteristics

Ingestion happens synchronously in the caller's request path. Budget: p95 < 30ms, p99 < 100ms.

Measurements to take at ingest:

- Fingerprint compute time (pure CPU, should be sub-ms).
- Suppression check (single indexed SELECT).
- Upsert (single SQL statement against indexed table).
- Event append (single INSERT).

Total: 2 SELECTs + 2 INSERTs in the worst case. This is fine on a warm DB. If DB latency degrades and ingest p95 climbs past 100ms, we move to an **async queue mode** (enqueue the incident input to pg-boss, consume asynchronously). Schema supports this — the change is purely in the calling contract. Not needed for Phase 0; measure and revisit.

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
  severity: run.status === 'timeout' ? 'medium' : 'medium',
  summary: truncateSummary(`Agent run failed: ${agent.slug}`),
  errorCode: run.errorDetail?.code,
  errorDetail: run.errorDetail,
  affectedResourceKind: 'agent_run',
  affectedResourceId: run.id,
  organisationId: run.organisationId,
  subaccountId: run.subaccountId,
  correlationId: run.correlationId,
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

### 6.9 Correlation ID prerequisite check

The ingestor assumes correlation IDs propagate from route → service → job → agent run → skill call. The audit flagged this as needing verification. Before merging Phase 0, confirm:

1. `req.correlationId` is set by a middleware on every route (should exist — check `server/middleware/`).
2. pg-boss job payloads carry `correlationId` when enqueued from a route — audit `server/jobs/*.ts` for this field.
3. `agent_runs` rows have a correlation ID column (check `server/db/schema/agentRuns.ts`).

If any of these is missing, fix it as a prerequisite PR before Phase 0 ships. Without end-to-end correlation, grouping "these 40 errors are one request" is impossible — and that's a core use case.

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

### 8.5 Real-time behaviour

**Phase 0.5 is polling-based**, not WebSocket. Page refetches the list every 10 seconds while visible (use existing polling primitive — look for patterns in `JobQueueDashboardPage`). Drawer does NOT refetch detail on a tick — the user can press a refresh button if they want the latest event timeline. Real-time WebSocket integration is a later phase, optional.

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

## 9. Phase 0.5 — Notifications

### 9.1 Scope

Notifications are **system-admin-only** in Phase 0.5. Customer orgs don't see system incidents; they don't get notified. Only users with `system_admin = true` who have opted into notifications receive them.

Channels: **email** and **Slack**. SMS is **stubbed** (interface defined, no implementation) — add the provider later.

### 9.2 Notification trigger job

**New pg-boss job:** `systemMonitor.notify`

Enqueued by the ingestion service (§5.1 step 6) when an incident crosses a notification threshold. Consumed by a new handler:

**New file:** `server/jobs/systemIncidentNotifyJob.ts`

Thresholds that enqueue:

1. An incident is newly opened AND severity is `high` or `critical`.
2. An incident occurrence count crosses `10`, `100`, or `1000` (configurable via `SYSTEM_INCIDENT_NOTIFY_MILESTONES`).
3. An incident's severity escalates via the "never-de-escalate" rule (e.g. existing `medium` incident receives a `high` occurrence).

The job handler:

1. Fetches the incident.
2. Checks suppression — if `system_incident_suppressions` matches, skip.
3. Checks fatigue guard (§9.3).
4. Fans out to configured channels (§9.4, §9.5).
5. Appends a `notification_sent` event to the incident's event log for each channel dispatched.
6. If all channels suppressed by fatigue guard, appends a `notification_throttled` event with the guard's reason.

Job idempotency key: `incident-notify:${incidentId}:${severity}:${occurrenceCount}`. Guards against duplicate notifications from retries.

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

- Existing `AlertFatigueGuard` extends the base (wired to `anomaly_events` + `accountId`).
- **New `SystemIncidentFatigueGuard`** extends the base (wired to `system_incident_events` with `event_type='notification_sent'` + `fingerprint` as the dedupe key).

Default limits for system incidents:

```ts
const SYSTEM_INCIDENT_ALERT_LIMITS: AlertLimits = {
  maxAlertsPerRun: 5,                  // per invocation of the notify job
  maxAlertsPerKeyPerDay: 6,            // per fingerprint per calendar day (critical bypass: +2)
  batchLowPriority: true,              // low-severity incidents batched into daily digest
  criticalBypass: true,                // critical incidents can exceed maxAlertsPerKeyPerDay by 2
};
```

`self`-source incidents (§5.7) bypass the fatigue guard on first occurrence per UTC day.

### 9.4 Email channel

**Service:** `server/services/notificationService.ts` (new) — generic notification abstraction with per-channel adapters.

**Email adapter:** reuse existing email infrastructure (find by searching for `sendEmail`, SMTP config, or SendGrid/Postmark integration). If no email infra exists, add a stub that logs `notification_email_stub` and document as a known gap — do NOT add SMTP config in this PR.

Email shape:

- **Subject:** `[SEV-CRITICAL] <summary>` (or HIGH, MEDIUM, LOW — matching severity)
- **Body:** plaintext — summary, fingerprint, first-seen, occurrences, direct link to `/system/incidents/:id` in the admin UI, raw error-detail preview (truncated)
- **Recipient:** system-admin users with `notificationPreferences.systemIncidents.email = true` (see §9.6)

### 9.5 Slack channel

**Slack adapter:** reuse existing Slack integration (look for `server/services/slack*` or `server/routes/slack*`). Project already has Slack inbound jobs, so outbound infrastructure likely exists.

Slack shape:

- Post to a configured system-admin channel (ID stored in `systemConfig` table or env var `SYSTEM_INCIDENT_SLACK_CHANNEL_ID`).
- Message uses Slack Block Kit: severity-coloured header, summary as title, fingerprint + source + occurrences as fields, link button to admin UI, and quick-action buttons (`Ack`, `Resolve`, `Suppress 24h`) that POST to a webhook endpoint in `server/routes/slackIncidentActions.ts` (new — out of scope for detailed design in this spec; stub the interaction handler and note it as a Phase 0.5 follow-up).

**Minimum viable Slack:** block-kit message + link button to admin UI. Quick-action buttons are nice-to-have; ship if time permits, defer if not.

### 9.6 User notification preferences

**Schema change:** extend `users` table OR add a `user_notification_preferences` table (existing `user_settings` table can accommodate — check `server/db/schema/userSettings.ts`).

Shape:

```ts
interface UserNotificationPreferences {
  systemIncidents: {
    email: boolean;
    slack: boolean;
    minSeverity: 'low' | 'medium' | 'high' | 'critical';  // filter — never notify below this
  };
}
```

**Default for system-admin users:** email + Slack enabled, `minSeverity: 'high'`. This prevents day-1 pager fatigue.

**Default for non-system-admin users:** all disabled. Non-admins don't receive system-incident notifications.

UI for preferences: a section on an existing user settings page — do NOT build a new settings page. If no appropriate user-settings page exists, note as a follow-up and add preferences via API-only in Phase 0.5 (read the defaults, no UI toggle).

### 9.7 Daily digest (deferred)

Batched low-priority notifications (per the fatigue guard's `batchLowPriority` flag) accumulate into a daily digest email. Phase 0.5 scope: **write to a "pending digest" queue, do NOT send**. Digest delivery is a Phase 1 follow-up. This prevents low-severity incidents from silently disappearing while keeping scope contained.

### 9.8 Observability of notifications

Every notification attempt (delivered or suppressed) writes an event to the incident's `system_incident_events` log. This closes the loop: when debugging "did we get paged for incident X?" the answer is in one place — the incident's event timeline.

### 9.9 SMS (stub)

Interface defined in `notificationService.ts`:

```ts
interface NotificationChannel {
  send(payload: NotificationPayload): Promise<void>;
  name: 'email' | 'slack' | 'sms';
}
```

No SMS adapter implementation. Register a `SmsChannelStub` that throws `NotImplementedError`. When SMS provider is chosen, implement the adapter and register it — no further refactor needed.

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

- If user is a system admin: all critical + high incidents with `status in ('open', 'investigating', 'escalated')`.
- Otherwise: no system incidents (they don't see them).

**Lane assignment:** system incidents go to the `internal` lane. They are never `client` or `major` lane items.

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
2. Validate: incident status is `open` or `investigating` (can't escalate resolved/suppressed incidents).
3. Resolve the **designated system-admin subaccount** for escalation context. See §10.3 for what this is.
4. Create a task via `taskService.createTask` with shape:
   - `title`: `[Incident ${shortFingerprint}] ${incident.summary}`
   - `description`: a rendered template including incident details (see §10.4)
   - `organisationId`: the system-admin org (see §10.3)
   - `subaccountId`: the system-admin subaccount
   - `createdByUserId`: the escalating sysadmin
   - `createdByAgentId`: `null` (matters — Orchestrator eligibility predicate checks this)
   - `status`: `'inbox'` (required for Orchestrator trigger)
   - `parentTaskId`: `null`
5. Update incident: `status = 'escalated'`, `escalatedAt = NOW()`, `escalatedTaskId = <new task id>`.
6. Append `escalation` event to `system_incident_events` with `actorKind='user'`, `payload: { taskId, incidentId }`.
7. Return `{ incident, taskId }` to the caller.

The existing `orchestratorFromTaskJob.ts` job is automatically enqueued by `taskService.createTask` (per architecture.md §Orchestrator Capability-Aware Routing). It picks up the task, routes it through the four-path decision model, and either resolves it directly, hands it to an appropriate specialist agent, or opens a clarifying question back to the escalating user via the normal task UI.

**Crucially: no new agent is built for Phase 0.5.** The escalation leverages existing routing infrastructure. If Orchestrator doesn't know what to do with "diagnose this incident" — which it likely won't on day one — the sysadmin will see a "no capable agent" response and learn the system's current limits. This is useful diagnostic information for designing Phase 2.

### 10.3 Designated system-admin subaccount

For the escalation to produce a task that the Orchestrator can route, the task needs a concrete org + subaccount context. Three options:

**Option 1: Use the system-admin user's primary org + subaccount.** Simple; the task shows up in the admin's own Tasks page. Risk: the admin's org becomes cluttered with incident tasks unrelated to their own work.

**Option 2: Dedicated "System Operations" org + subaccount.** Seeded via migration. All incident escalations route there. Cleanest separation; requires a new seeded org.

**Option 3: Per-incident resolution:** if `incident.organisationId` is set, use that org + subaccount; if null, fall back to Option 1 or 2.

**Recommendation: Option 3 with Option 2 as fallback.** Org-scoped incidents escalate inside the affected org (makes sense — the specialists there have the context). System-level incidents escalate to a dedicated System Ops subaccount. This requires a new migration to seed `System Operations` as an org + subaccount.

**Open question (see §14):** does this warrant a new seeded org, or do we store escalations against a designated "system" flag on an existing infrastructure org? Needs user input before migration design.

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
- `server/services/notificationService.ts` — generic multi-channel notification abstraction (§9.4)
- `server/services/notifications/emailChannel.ts`
- `server/services/notifications/slackChannel.ts`
- `server/services/notifications/smsChannelStub.ts`
- `server/services/alertFatigueGuardBase.ts` — extracted base class (§9.3)
- `server/services/systemIncidentFatigueGuard.ts` — subclass for system incidents

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
| `server/services/alertFatigueGuard.ts` | Refactor to extend new base class |
| `server/lib/permissions.ts` | Add `SYSTEM_PERMISSIONS.INCIDENT_*` keys |
| `server/config/rlsProtectedTables.ts` | Explicitly omit the 3 new tables (Option A per §7.4) |
| `server/db/schema/index.ts` | Re-export 3 new schema files |
| `server/jobs/index.ts` | Register 2 new jobs |
| `server/db/schema/tasks.ts` | Add `linkedEntityKind` + `linkedEntityId` if missing (§10.5) |
| `server/db/schema/userSettings.ts` OR `users.ts` | Add `notificationPreferences` JSON column (§9.6) |
| `server/services/taskService.ts` | Accept `linkedEntityKind` + `linkedEntityId` in createTask |
| `client/src/App.tsx` | Add `/system/incidents` route + lazy import |
| `client/src/components/Layout.tsx` | Add nav entry under System Admin section |
| `architecture.md` | New section: System Incidents + Monitoring Foundation |
| `docs/capabilities.md` | Add "System Incident Monitoring" entry under Support-facing section (editorial rules §1) |

### 11.3 Not changed (explicit non-changes)

- `agent_runs`, `connector_configs`, `workspace_health_findings` schemas — unchanged. The sink is additive.
- Global error handler's client response shape — unchanged.
- Existing `asyncHandler` behaviour — unchanged (ingestion is side-effect).
- `anomaly_events` table — unchanged; it stays for its own purpose (business-metric anomalies for ClientPulse).
- Portfolio Health Agent — unchanged; its fatigue guard refactors to the base class but the existing behaviour is preserved byte-for-byte.

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

One-time scripted run after deploy:

1. Trigger a contrived route 500 via a test endpoint — verify incident appears on `/system/incidents`.
2. Click Acknowledge — verify incident shows "Acknowledged" state.
3. Click Resolve with note — verify resolved.
4. Trigger same fingerprint again — verify NEW incident opens.
5. Suppress it — verify next occurrence does not create a row.
6. Trigger a critical incident, confirm email + Slack delivered.
7. Click Escalate on an incident, confirm task appears in admin org's task board and Orchestrator picks it up.

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

1. Schema + migration + RLS manifest
2. Ingestor service + pure tests
3. Ingestor integration points (one commit per integration: route, asyncHandler, DLQ, agent, connector, skill, LLM)
4. Routes + service
5. Notifications service + fatigue guard refactor
6. Notify job + self-check job
7. Admin UI page + components + client tests
8. Pulse integration
9. Manual escalate-to-agent service + task shape
10. Architecture.md + capabilities.md updates (per CLAUDE.md §11 "docs stay in sync")

### 13.3 Deployment

- Ship to staging first. Let it run 48 hours. Hunt for unexpected ingest spikes.
- Verify `system_incidents` counts by source align with expected error distribution (if route-source count is 10× what you expect, the ingestion path is double-firing).
- Then production.

### 13.4 Feature flag

No feature flag for ingestion — if we deploy it, we want it running. CLAUDE.md §Core Principles: "Don't use feature flags or backwards-compatibility shims when you can just change the code."

The **only** flag: `SYSTEM_INCIDENT_NOTIFICATIONS_ENABLED` (env var, default `false`) — gates outbound email/Slack dispatch. Lets staging ingest without paging. Flip to `true` in production after a day of observation.

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

## 14. Dependencies and open questions

### 14.1 Prerequisites (must be resolved before Phase 0 ships)

- **P1 — Correlation ID propagation audit (§6.9).** Confirm `req.correlationId` on every route, propagation into pg-boss payloads, presence on `agent_runs` rows. If missing, add as a prerequisite PR.
- **P2 — Email delivery capability.** Confirm the project has working email infrastructure. If not, stub only (§9.4).
- **P3 — Slack outbound capability.** Confirm working Slack outbound. If not, stub only (§9.5).
- **P4 — `tasks.linkedEntityKind/Id` columns.** Confirm exist; add if not (§10.5).
- **P5 — User notification preferences storage.** Confirm `user_settings` or `users` can accommodate; add column if not (§9.6).

### 14.2 Open questions for user input

| Q | Question | Owner decision needed |
|---|---|---|
| Q1 | Naming: call it `system_incidents` or `platform_incidents` or `operational_incidents`? | User |
| Q2 | Designated system-admin subaccount for escalation (§10.3): new seeded org, or use an existing infrastructure org with a flag? | User |
| Q3 | Severity defaults per source (§5.5) — is the table's judgement about right? (Primarily: should agent-run failure default to `medium` or `high`?) | User |
| Q4 | Notification `minSeverity` default (§9.6) — is `high` the right floor, or should low-traffic projects get `medium`? | User |
| Q5 | Phase 0.5 polling interval (§8.5) — 10s, 30s, 60s? Tradeoff: responsiveness vs DB load. | User |
| Q6 | Should Phase 0.5 include a daily digest delivery (§9.7), or is deferring to Phase 1 OK? | User |
| Q7 | Should suppressions have a hard upper limit (e.g. max 50 permanent suppressions system-wide) to prevent "suppress our way out of bugs"? | User |
| Q8 | Do we want a `tests/` helper skill for system-admins to deliberately trigger a test incident from the UI (for end-to-end verification)? | User |

### 14.3 Assumptions (documented so they can be challenged)

- **A1** — The existing `AlertFatigueGuard` is the right pattern to reuse. If the Portfolio Health team plans to rewrite it, this spec needs adjustment.
- **A2** — The Orchestrator's existing routing logic can handle "diagnose an incident" tasks well enough to be useful, or at minimum fail clearly. Not validated — depends on §10.2 behaviour in practice.
- **A3** — Ingest p95 latency < 100ms is achievable with current DB shape. If tests show otherwise, switch to async mode per §5.8.
- **A4** — 16-char fingerprint is sufficient dedupe resolution at our scale. Revisit if collision rate > 0.1%.
- **A5** — Correlation IDs propagate reliably through pg-boss and agent runs. Validated by P1 audit.

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

### Phase 1 — Synthetic checks (proactive monitoring)

- `systemMonitor.syntheticChecks` pg-boss job on 1-minute tick.
- Checks for absence-of-events: job queue stalls, no agent runs in N minutes, stale connectors, heartbeat probes.
- Writes incidents with `source='synthetic'`.
- Enables detection of silent failures that error-driven monitoring misses.
- Depends on Phase 0 sink.

### Phase 2 — The monitoring agent (read-only)

- New system-managed agent `system_monitor`. Scope `system` (requires Option B principal context from §7.4).
- Auto-triggered by `incident.triage` pg-boss job (enqueued by ingestor when incident opens with `severity >= medium`).
- Diagnosis-only skills: read recent logs, read job queue health, read failed agent runs, read DLQ jobs, read connector status.
- Annotation + escalation skills: annotate diagnosis on incident, escalate to human, propose (not execute) remediation.
- Modelled on Portfolio Health Agent's prompt shape.
- Rate-limited: max 2 invocations per incident fingerprint; persistent recurrence auto-escalates to human.
- Kill switch: `SYSTEM_MONITOR_ENABLED` env var.

### Phase 3 — Auto-remediation (whitelist-only)

- New remediation skills, each with strict safety envelope: retry failed job, requeue agent run, disable feature flag, throttle connector, circuit-break skill.
- All `destructiveHint: true`; all logged as `remediation_attempt` + `remediation_outcome` event pairs.
- Rate limit: max 2 remediation attempts per fingerprint; recurrence after attempts auto-classifies `persistent_defect`.
- No remediation without explicit playbook match — agent cannot invent fixes.

### Phase 4 — Dev-agent handoff (deferred)

- When incident classifies `persistent_defect`, emit structured bug report (repro, stack, affected files, proposed fix).
- Hand to a (not-yet-designed) development agent for code change authorship.
- Requires Phase 2 + 3 stable and a dev-agent spec of its own.
- Structured bug-report shape designed in Phase 3 to avoid refactor later.

---

**End of Phase 0 + 0.5 specification.**

Ready for `spec-reviewer` iteration before architect/implementation begins (note: `spec-reviewer` requires the local Codex CLI per CLAUDE.md, and must be invoked by the user explicitly — not auto-invoked).










