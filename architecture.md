# Automation OS — Architecture Guide

Read this before making any backend changes. It documents the conventions, patterns, and systems that make up this codebase.

---

## Project Structure

```
server/
├── routes/          Route files — one per domain (~70 files)
├── services/        Business logic — one per domain (~125 files, includes *Pure.ts companions)
├── db/schema/       Drizzle ORM table definitions (~101 files)
├── middleware/      Express middleware (auth, validation, correlation, org scoping)
├── lib/             Shared utilities (asyncHandler, permissions, scopeAssertion, orgScopedDb, etc.)
├── config/          Environment, action registry, system limits, RLS manifest, topic registry
├── skills/          File-based skill definitions (101 built-in skills as .md files)
├── jobs/            Background jobs (cleanup, regression replay, security event pruning, priority feed, slack inbound, agent briefing, memory dedup, org subaccount migration)
├── tools/           Internal tool implementations (askClarifyingQuestion, readDataSource)
└── index.ts         Express app setup, route mounting

shared/
└── runStatus.ts     Canonical agent run status enum, terminal/in-flight/awaiting sets, type guards

client/
├── src/pages/       ~76 page components (lazy-loaded)
├── src/components/  Reusable UI components (~21 files)
├── src/hooks/       useSocket.ts (WebSocket integration)
└── src/lib/         api.ts, auth.ts, socket.ts, formatMoney.ts, runStatus.ts, runPlanView.ts
```

---

## Route Conventions

### Use `asyncHandler` — never write manual try/catch in routes

Every route handler uses the `asyncHandler` wrapper from `server/lib/asyncHandler.ts`. Service-layer errors shaped as `{ statusCode, message, errorCode }` are caught automatically and returned as JSON.

```typescript
import { asyncHandler } from '../lib/asyncHandler.js';

router.get('/api/foo', authenticate, asyncHandler(async (req, res) => {
  const data = await fooService.getData(req.orgId!);
  res.json(data);
}));
```

The manual try/catch pattern is **deprecated and must not be used**.

### One file per domain, max ~200 lines

Route files are focused on a single domain. If a file exceeds ~200 lines, split it.

| Domain | File |
|--------|------|
| Org agents | `agents.ts` |
| System agents | `systemAgents.ts` |
| Subaccount agent linking | `subaccountAgents.ts` |
| Agent runs | `agentRuns.ts` |
| Agent triggers | `agentTriggers.ts` |
| Skills (org) | `skills.ts` |
| Skills (system) | `systemSkills.ts` |
| Tasks & activities | `tasks.ts` |
| Board config | `boardConfig.ts` |
| Workspace memory | `workspaceMemory.ts` |
| Memory blocks | `memoryBlocks.ts` |
| Scheduled tasks | `scheduledTasks.ts` |
| GitHub webhook | `githubWebhook.ts` |
| Auth | `auth.ts` |
| Users | `users.ts` |
| Subaccounts | `subaccounts.ts` |
| Permission sets | `permissionSets.ts` |
| Processes | `processes.ts` |
| Executions | `executions.ts` |
| Integration connections | `integrationConnections.ts` |
| LLM usage | `llmUsage.ts` |
| Web login connections (Reporting Agent) | `webLoginConnections.ts` |
| Agent inbox | `agentInbox.ts` |
| Goals | `goals.ts` |
| Playbook runs | `playbookRuns.ts` |
| Playbook templates | `playbookTemplates.ts` |
| Playbook studio | `playbookStudio.ts` |
| Activity | `activity.ts` |
| Pulse | `pulse.ts` |
| Skill studio | `skillStudio.ts` |
| Client Pulse reports | `clientpulseReports.ts` |
| GoHighLevel (GHL) OAuth | `ghl.ts` |
| Modules & subscriptions | `modules.ts` |
| GEO audits | `geoAudits.ts` |
| Onboarding | `onboarding.ts` |

### Shared route helpers

- **`asyncHandler(fn)`** — `server/lib/asyncHandler.ts`. Wraps async handlers; catches service errors.
- **`resolveSubaccount(subaccountId, orgId)`** — `server/lib/resolveSubaccount.ts`. Validates subaccount exists and belongs to the org. Throws 404 if not. Use in every route that takes `:subaccountId`.
- **`authenticate`** — middleware that verifies JWT and populates `req.user` and `req.orgId`.

---

## Service Layer

- Services contain all business logic. Routes are thin wrappers.
- Services throw errors as `{ statusCode: number, message: string, errorCode?: string }` — `asyncHandler` catches these.
- One service per domain. Target max ~500 lines; `skillExecutor.ts` (65KB) is the exception.
- Never access `db` directly in a route — call a service.

---

## Auth & Permissions

### Middleware chain

```typescript
authenticate                          // always first — populates req.user, req.orgId
requireOrgPermission('key')           // check org-level permission
requireSubaccountPermission('key')    // check subaccount-level permission
requireSystemAdmin                    // system_admin only
```

### Request extensions

```typescript
req.user: { id, organisationId, role, email }  // from JWT
req.orgId: string                              // resolved org (may differ from user.organisationId for system_admin)
```

### Two-tier permission model

1. **Org-level**: `org_user_roles` → `permission_sets` → `permission_set_items` → `permissions`
2. **Subaccount-level**: `subaccount_user_assignments` → `permission_sets` → `permission_set_items` → `permissions`

Permission checks are cached per-request (`req._orgPermissionCache`). System_admin and org_admin bypass all checks.

### System admin org override

System admin can scope into any org via the `X-Organisation-Id` header. This is audit-logged to `audit_events`.

---

## Three-Tier Agent Model

This is the core data model. Understand it before touching anything agent-related.

```
System Agent (systemAgents table)
  — Platform IP; masterPrompt hidden from org admins
  — Default system skills attached
  — Heartbeat blueprint (schedule template)
        ↓ spawns / seeds
Org Agent (agents table)
  — Org-created OR system-managed (isSystemManaged: true)
  — System-managed agents inherit masterPrompt; only additionalPrompt is editable by org
  — Org-created agents own their full masterPrompt
  — Heartbeat config at org level
        ↓ linked per client
Subaccount Agent (subaccountAgents table)
  — Links an org agent to a specific subaccount
  — Can override heartbeat interval, execution limits, skills
  — Has parentSubaccountAgentId for subaccount-level hierarchy
```

### Key agent fields

| Field | Where | Meaning |
|-------|-------|---------|
| `isSystemManaged` | agents | Cannot edit masterPrompt; only additionalPrompt |
| `systemAgentId` | agents | Living reference to the system agent template |
| `heartbeatEnabled` | all tiers | Whether this agent runs on schedule |
| `heartbeatIntervalHours` | all tiers | Run interval |
| `heartbeatOffsetMinutes` | all tiers | Minute-level offset for staggering runs (migration 0041) |
| `agentRole` | agents, subaccountAgents | Role in hierarchy (orchestrator, specialist, etc.) |
| `parentAgentId` | agents | Org-level hierarchy parent |
| `parentSubaccountAgentId` | subaccountAgents | Subaccount-level hierarchy parent |

### Subaccount agent link overrides

`subaccountAgents` is not a thin join table — it carries a full set of per-link overrides so the same org agent can behave differently in each subaccount without cloning the agent definition. Overrides are edited from `/admin/subaccounts/:subaccountId/agents/:linkId/manage` (`SubaccountAgentEditPage`), which presents four tabs: **Skills**, **Instructions**, **Budget**, **Scheduling**.

| Column | Override semantics |
|--------|--------------------|
| `skillSlugs` | Per-link skill list. `null` means "inherit the agent's `defaultSkillSlugs`"; an array replaces it entirely. The skill picker (`SkillPickerSection`) shows org skills and system skills side by side. |
| `customInstructions` | Appended to the agent's `additionalPrompt` at run time. Scoped per subaccount — lets an org agent speak the subaccount's language without org-wide edits. Max 10 000 chars. |
| `tokenBudgetPerRun` / `maxToolCallsPerRun` / `timeoutSeconds` / `maxCostPerRunCents` / `maxLlmCallsPerRun` | Hard ceilings enforced by `runCostBreaker` and the execution loop. `maxCostPerRunCents` plugs into the shared cost circuit breaker (`server/lib/runCostBreaker.ts`). Callers: Slack + Whisper via `assertWithinRunBudget` (cost_aggregates rollup); the LLM router via the direct-ledger sibling `assertWithinRunBudgetFromLedger` (reads `llm_requests` to avoid aggregation lag — Hermes Tier 1 Phase C, `tasks/hermes-audit-tier-1-spec.md` §7.4.1). |
| `heartbeatEnabled` / `heartbeatIntervalHours` / `heartbeatOffsetMinutes` | Per-subaccount schedule. Overrides the org agent's heartbeat so different clients can run at different cadences / offsets. |
| `scheduleCron` / `scheduleEnabled` / `scheduleTimezone` | Cron-based schedule (alternative to heartbeat interval). Schedule changes go through `agentScheduleService.updateSchedule` — **never mutate these columns directly**, or the pg-boss cron registration drifts from the DB. |
| `concurrencyPolicy` / `catchUpPolicy` / `catchUpCap` / `maxConcurrentRuns` | Concurrency and missed-run behaviour for the scheduler. |

**Skill resolution cascade.** `skillService.getTools()` now falls back from the org `skills` table to `systemSkillService` (file-based system skills under `server/skills/*.md`) when a requested slug has no org-tier override. This means a subaccount link can reference system skills by slug directly without requiring an org to shadow-copy every platform skill.

**Route conventions.** All subaccount agent override endpoints live in `server/routes/subaccountAgents.ts`:
- `POST /api/subaccounts/:subaccountId/agents` — link an agent (duplicate link → `409` via `{ statusCode: 409, message }`, never a raw Postgres `23505`)
- `GET /api/subaccounts/:subaccountId/agents/:linkId/detail` — fetch a single link (note: the `/detail` suffix avoids shadowing the `/tree` route on the same prefix)
- `PATCH /api/subaccounts/:subaccountId/agents/:linkId` — update any subset of the override columns above; schedule fields are forwarded to `agentScheduleService` before the DB update

Every override column is validated by `server/schemas/subaccountAgents.ts` (Zod) with `.partial()` on the update body, and the handler uses the `'key' in req.body` pattern so explicit `null` writes (e.g. clearing `customInstructions`) are distinguishable from "not sent".

---

## Orchestrator Capability-Aware Routing

System-managed agent that classifies inbound tasks into one of four deterministic routes. Full spec at [`docs/orchestrator-capability-routing-spec.md`](./docs/orchestrator-capability-routing-spec.md). Implemented in migrations 0156 (schema), 0157 (agent seed), 0158 (hardening), 0159 (revert forever-unique index).

### Four routing paths

Every task picked up by the Orchestrator is classified atomically:

| Path | Trigger | Action |
|------|---------|--------|
| **A** — already configured | A linked agent's `capabilityMap` covers every required capability AND every integration has an active connection AND every required scope is granted (all three, single agent) | `reassign_task` to the existing agent |
| **B** — configurable, narrow | Platform supports all required capabilities but no agent has them; request pattern is client-specific | `reassign_task` to the Configuration Assistant with structured `handoffContext` |
| **C** — configurable, broad | Same as B, but request pattern matches a `broadly_useful_patterns` entry in the Integration Reference | Path B handoff AND `request_feature` with `category: 'system_promotion_candidate'` |
| **D** — unsupported | At least one required capability absent from the Integration Reference, with `reference_state: healthy` | `request_feature` with `category: 'new_capability'`; task status → `blocked_on_feature_request` |

### Decomposition pipeline (before classification)

The LLM never decides a route directly. Every run runs a three-stage pipeline:

1. **Draft** — LLM extracts `[{kind, slug, rationale}]` from task text. `list_platform_capabilities` is called first so the canonical taxonomy is in view during drafting.
2. **Normalise + validate** — `check_capability_gap` resolves aliases against the capability taxonomy, validates each canonical slug against the live reference, and returns per-capability availability.
3. **One-shot retry** — if any slug is `unknown` or `not_found`, the LLM re-runs once with the taxonomy explicitly in view. After the single retry, unknowns are treated as genuinely absent (Path D).

Classification is then a pure function of the `check_capability_gap` verdict.

### Integration Reference (machine-readable capability catalogue)

`docs/integration-reference.md` — one fenced `yaml integration` block per integration plus a `capability_taxonomy` block. Parsed at runtime by `server/services/integrationReferenceService.ts` (60s TTL in-process cache). Schema validated against the parser's `REQUIRED_INTEGRATION_FIELDS` list; drift between the doc and the code-level `OAUTH_PROVIDERS` + `MCP_PRESETS` is caught by `scripts/verify-integration-reference.mjs` at CI time (exit 1 blocking, exit 2 warning).

Every integration carries a runtime-computed `confidence`: `high` (fully_supported + verified in last 30 days), `stale` (otherwise), `unknown` (malformed `last_verified`). The rollup `reference_state` (`healthy` / `degraded` / `unavailable`) is surfaced on every `list_platform_capabilities` response.

When `reference_state === 'unavailable'`, routing falls back to legacy keyword patterns and files an `infrastructure_alert` feature request — it never blocks every task as Path D on a broken reference.

### Capability map (per agent, derived)

`subaccountAgents.capabilityMap` is a derived JSON column (added in migration 0156) mirroring the shape `{ computedAt, referenceLastUpdated, integrations[], read_capabilities[], write_capabilities[], skills[], primitives[] }`. Computed by `server/services/capabilityMapService.ts`:

- **Synchronously** on skill-link changes (`addSkill` / `removeSkill` / `setSkills` / `setAllowedSkillSlugs`).
- **Asynchronously** on reference-version change via `recomputeOrgCapabilityMaps(orgId)`.

`NULL` = not yet computed; `check_capability_gap` treats a null map as zero-capability so Path A cannot fire against uncomputed state. The stored `referenceLastUpdated` is string-exact-compared against the current reference's `schema_meta.last_updated`; mismatch disqualifies the map from Path A and forces Path B (re-verification by the Configuration Assistant).

### Capability discovery skills

Four new system skills, all `idempotencyStrategy: 'read_only'` except `request_feature` (`keyed_write`). Registered in `server/config/actionRegistry.ts` and dispatched in `server/services/skillExecutor.ts`. Handlers at `server/tools/capabilities/`.

| Skill | Purpose |
|-------|---------|
| `list_platform_capabilities` | Return the parsed Integration Reference — catalogue, taxonomy, reference_state |
| `list_connections` | Active integration connections for an org or subaccount (subaccount scope inherits org-level connections; subaccount-specific rows override). Never returns secrets. |
| `check_capability_gap` | Atomic Path A determination: capability subset + active connection + granted scopes across a single candidate agent. Returns verdict + per-capability detail + candidate agents with `combined_coverage_possible` flag |
| `request_feature` | Writes a `feature_requests` row with per-org 30-day dedupe (advisory lock + app-level lookup), fires Slack/email/Synthetos-task notifications |

All four decrement `SkillExecutionContext.capabilityQueryCallCount`. When the counter exceeds `systemSettings.orchestrator_capability_query_budget` (default 8), the skill returns `{ error: 'capability_query_budget_exhausted' }` so the Orchestrator halts the decomposition loop rather than burning tokens. Identical in-run calls are cached on `sha256(skill_name + stableStringify(input))` at zero budget cost.

### Orchestrator link resolution (org sentinel model)

The Orchestrator is linked ONCE per org, attached to the org's sentinel subaccount (seeded in migration 0157). When a task fires the `org_task_created` trigger, `server/jobs/orchestratorFromTaskJob.ts` uses a two-step link lookup:

1. If the task has a `subaccountId`, prefer an active Orchestrator link on that exact subaccount (supports future per-subaccount Orchestrators).
2. Fall back to any active Orchestrator link for the org, ordered by `(createdAt, id)` for deterministic selection.

The task's `subaccountId` is passed through `triggerContext.taskSubaccountId` so downstream capability queries can scope correctly even when the Orchestrator itself runs from its org-level link.

### Feature request pipeline

`feature_requests` table (migration 0156): per-org signal with 30-day dedupe keyed on canonical capability slugs. The dedupe hash is computed over post-normalisation canonical slugs so aliases collapse (`inbox_read` and `email_read` produce the same hash). Race-safe via `pg_advisory_xact_lock(orgId + dedupeHash)` inside the insert transaction.

Categories: `new_capability` (Path D), `system_promotion_candidate` (Path C), `infrastructure_alert` (reference-parse failures). Notifications fire in parallel via `featureRequestNotificationService`:

- **Slack** — incoming webhook via `SYNTHETOS_INTERNAL_SLACK_WEBHOOK` env var
- **Email** — `emailService.sendGenericEmail` to the address in `systemSettings.feature_request_email_address`
- **Synthetos-internal task** — cross-org admin-bypass insert (`withAdminConnection` + `admin_role`) into the subaccount configured via `systemSettings.synthetos_internal_subaccount_id`. The task's `createdByAgentId` is set so the `org_task_created` trigger handler drops the event (no auto-routing of feature-request tasks).

### Routing outcomes + observability

`routing_outcomes` table (migration 0156) pairs decision records to downstream outcomes for the feedback loop (§9.5.2 of the spec). Every capability discovery skill emits structured logs at `info` level — `check_capability_gap` in particular emits the full decision telemetry (`verdict`, `required_capabilities`, `missing_for_configurable`, `missing_for_unsupported`, `candidate_agent_count`, `configured_by_agent_id`, `combined_coverage_possible`, `budget_used`). These feed the Orchestrator decision distribution queries.

### Trigger wiring

`taskService.createTask` fires `enqueueOrchestratorRoutingIfEligible(task)` (non-blocking) after the existing `triggerService.checkAndFire`. Eligibility predicate (`isEligibleForOrchestratorRouting`): `status === 'inbox'` AND `assignedAgentId === null` AND `!isSubTask` AND `createdByAgentId === null` AND description ≥ 10 chars. The pg-boss worker for `orchestrator-from-task` is registered in `server/services/queueService.ts`; the sender is injected via `setOrchestratorJobSender` at startup.

Eligibility is re-checked inside `processOrchestratorFromTask` before dispatch so a task that was reassigned or moved out of inbox between enqueue and execution drops silently.

### Versioned idempotency

The Orchestrator dispatch idempotency key is `orchestrator-from-task:${taskId}:${task.updatedAt.getTime()}` — user edits to the task description produce a fresh run rather than dedup-ing against a stale one. Pure pg-boss replays (same task + same updatedAt) still dedup.

### Task status values

Migration 0156 does not constrain the `tasks.status` text column, so new statuses land additively via client-side rendering in `client/src/lib/statusBadge.tsx`:

- `routed`, `awaiting_configuration`, `blocked_on_feature_request` (outcomes)
- `routing_failed`, `routing_timeout` (failure states — distinct reasons for ops)
- `configuration_partial`, `configuration_failed` (post-handoff verification outcomes)

---

## Task System

### Core schema

- `tasks` — Kanban cards. Key fields: `title`, `status`, `priority`, `assignedAgentId`, `isSubTask`, `parentTaskId`, `handoffSourceRunId`, `reviewRequired`
- `taskActivities` — Immutable activity log per task
- `taskDeliverables` — Deliverables produced by agents for a task

### Subtask & Reactive Orchestration

Tasks can be subtasks (`isSubTask: true`, `parentTaskId` set). When a subtask moves to `done`, `subtaskWakeupService` automatically triggers the orchestrator agent for that subaccount with completion context.

This turns the orchestrator from a timed polling model into an event-driven reactive model — the orchestrator wakes on meaningful state changes rather than on a fixed schedule.

---

## Heartbeat Scheduling

Agent scheduling uses **pg-boss** (PostgreSQL-based job queue), managed by `agentScheduleService`.

- Org agents and subaccount agents each have independent heartbeat config
- `heartbeatOffsetMinutes` allows minute-precision staggering (prevents thundering herd)
- `agentScheduleService` reads heartbeat config and enqueues runs into pg-boss
- Idempotency keys prevent duplicate runs on retry (see below)

---

## Handoff & Sub-agent System

Agents can spawn sub-agents via the `spawn_sub_agents` skill.

- `handoffDepth` tracks nesting. Hard limit: `MAX_HANDOFF_DEPTH = 5` (see `server/config/limits.ts`)
- Sub-agents share parent token budget
- `agentRuns` records: `handoffDepth`, `parentRunId`, `isSubAgent`, `parentSpawnRunId`
- Sub-agent errors are bounded — parent run continues with error context
- Handoff jobs enqueued to `agent-handoff-run` queue in pg-boss

> **Note on terminology:** "Handoff" in this section refers to the parent → child sub-agent spawn. The "structured run handoff document" (next section) is a different concept — it is the JSON summary an agent emits when its OWN run finishes, used to seed continuity for the next run of the same agent.

---

## Run Continuity & Workspace Health

A continuity layer that lets agents "remember" prior runs and surfaces planning state to humans, plus a workspace health audit subsystem that flags configuration drift.

### Structured run handoff

Every completed run produces a JSON handoff document persisted to `agent_runs.handoffJson` (jsonb). Built best-effort by `buildHandoffForRun()` after the run completion is committed — a build failure logs and leaves the column null but never fails the run.

Service: `server/services/agentRunHandoffService.ts` (impure, Drizzle) + `server/services/agentRunHandoffServicePure.ts` (pure shape derivation, fully unit-tested).

Shape:

```ts
interface HandoffJson {
  accomplished: string[];        // bullet list of what the run did
  blockers: string[];            // unresolved issues
  nextRecommendedAction: string; // single-sentence "do this next"
  openQuestions: string[];       // anything pending HITL
  artefacts: { kind: string; ref: string; label: string }[];
}
```

Endpoints:

- `GET /api/org/agents/:agentId/latest-handoff` — most recent handoff for the org-scoped agent
- `GET /api/subaccounts/:subaccountId/agents/:agentId/latest-handoff` — same, scoped to a subaccount
- `getLatestHandoffForAgent(agentId, orgId, subaccountId?)` — service helper used by future continuity flows

Frontend: `client/src/components/HandoffCard.tsx` is rendered at the top of `RunTraceViewerPage` whenever `run.handoffJson` is populated, and `client/src/components/SessionLogCardList.tsx` extracts the `nextRecommendedAction` for the "Next: …" line on each card.

### Planning prelude

Before the main agentic loop runs, every agent now executes a planning prelude that produces a structured `plan_json` blob persisted to `agent_runs.planJson`. The plan is a list of intended tool calls with reasons:

```ts
interface PlanJson {
  actions: { tool: string; reason: string }[];
}
```

Frontend: `client/src/components/ExecutionPlanPane.tsx` renders the plan as a right-side pane on `RunTraceViewerPage` with progress derived by cross-referencing `plan_json` against `toolCallsLog`. The pure helper `client/src/lib/runPlanView.ts` computes "done / current / pending" status per planned action.

### Session log surfacing

`SessionLogCardList` is a compact, scannable run-history component used in two places:

1. `AgentChatPage` — shows the most recent runs of the active agent inline so the user can see "what has this agent been doing"
2. `AgentRunHistoryPage` (`/admin/agents/:agentId/runs` and `/admin/subaccounts/:subaccountId/agents/:agentId/runs`) — full-page paginated history with status filter

The status filter is wired through to `agentActivityService.listRuns({ status })`. The two new history routes (`/api/org/agents/:agentId/runs` and `/api/subaccounts/:subaccountId/agents/:agentId/runs`) accept `status`, `limit`, `offset` query params.

`agentActivityService.listRuns()` now also returns `handoffJson` in each row payload so the cards can render the "Next: …" line without a per-run fetch.

### Workspace health audit

A scheduled audit subsystem that surfaces configuration drift and operational issues across an org's subaccounts.

**Schema:** `health_findings` table (resourceKind, resourceId, detector, severity, message, recommendation, detectedAt, resolvedAt). Findings are deduped by `(orgId, detector, resourceKind, resourceId)`.

**Detector framework:** `server/services/workspaceHealth/detectors/`. Each detector exports:

```ts
{
  name: string;            // unique key, e.g. 'agent_no_recent_runs'
  severity: 'info' | 'warning' | 'critical';
  detect(orgId, db): Promise<DetectedFinding[]>;
}
```

Currently shipping detectors:

| Detector | Severity | Flags |
|---|---|---|
| `agentNoRecentRuns` | warning | active agents with no run in the last 14 days |
| `processBrokenConnectionMapping` | critical | triggers/processes pointing at deleted connections |
| `processNoEngine` | warning | processes with no engine assigned |
| `subaccountAgentNoSchedule` | info | agents with no scheduled tasks AND no triggers |
| `subaccountAgentNoSkills` | warning | agents with zero enabled skills |
| `systemAgentLinkNeverSynced` | info | system-managed agents that never received their first masterPrompt sync |

Detectors are registered via `server/services/workspaceHealth/detectors/index.ts` — adding a new detector means dropping a file in the detectors folder and re-exporting it from the index.

**Service:** `workspaceHealthService.ts` (impure orchestrator) + `workspaceHealthServicePure.ts` (pure dedup/upsert decision logic, unit-tested).

- `runAudit(orgId)` — runs all detectors, reconciles findings (insert new, mark resolved if no longer detected)
- `listActiveFindings(orgId)` — lists unresolved findings ordered by severity then detectedAt
- `resolveFinding(id, orgId)` — manual resolve

**Routes:** `server/routes/workspaceHealth.ts`

- `POST /api/org/health-audit/run` — `org.health_audit.view`
- `GET  /api/org/health-audit/findings` — `org.health_audit.view`
- `POST /api/org/health-audit/findings/:id/resolve` — `org.health_audit.resolve`

The view/resolve permission split is intentional — read-only stakeholders can browse findings but cannot dismiss them.

**Frontend:** `client/src/pages/AdminHealthFindingsPage.tsx` lists findings grouped by severity. The "Mark resolved" button is hidden for users without `org.health_audit.resolve` (honoring `__system_admin__` / `__org_admin__` sentinels from `/api/my-permissions`). `client/src/components/HealthAuditWidget.tsx` renders a compact summary on the dashboard.

> **Resolved:** `AdminHealthFindingsPage` now has a sidebar nav entry under the Organisation section (gated by `org.health_audit.view`). Health findings also surface in the Pulse History tab as `health_finding` activity type.

### Pulse — Supervision Home

Replaces the legacy dashboard, inbox, and activity pages with a single operational command centre. Migration `0160`.

**Lane classifier:** `server/services/pulseLaneClassifier.ts` (pure). Deterministic waterfall: `irreversible > cross_subaccount > cost_per_action > cost_per_run → major | client | internal`. Fully unit-tested (`pulseLaneClassifierPure.test.ts`, 26 tests).

**Config:** `server/config/pulseThresholds.ts` (defaults), `server/services/pulseConfigService.ts` (reads org overrides from `organisations.pulseMajorThreshold` jsonb column).

**Service:** `server/services/pulseService.ts` — `getAttention()` fans out to review items, failed runs, health findings, and tasks via `Promise.allSettled` with 2s timeout. Returns `{ lanes, counts, warnings[], isPartial }`.

**Routes:** `server/routes/pulse.ts`
- `GET /api/pulse/attention` — org-scoped attention feed (`org.review.view`)
- `GET /api/subaccounts/:id/pulse/attention` — subaccount-scoped (`subaccount.review.view`)
- `GET /api/pulse/counts` — nav badge counts (`org.review.view`)
- `GET /api/subaccounts/:id/pulse/counts` — subaccount nav badge (`subaccount.review.view`)
- `GET /api/pulse/item/:kind/:id` — single-item lookup for WebSocket follow-up

**Approval flow:** `server/routes/reviewItems.ts` — approve handler checks 409 `ALREADY_RESOLVED` guard, checks 412 `MAJOR_ACK_REQUIRED` for major-lane items, bulk-approve returns `{ approved, blocked, alreadyResolved }`.

**Frontend:** `client/src/pages/PulsePage.tsx` with Attention/History tabs. Components at `client/src/components/pulse/` — `Lane.tsx`, `Card.tsx`, `ActionBar.tsx`, `MajorApprovalModal.tsx`, `HistoryTab.tsx`. Hook: `client/src/hooks/usePulseAttention.ts` (REST fetch + WebSocket merge + optimistic removal).

---

## Idempotency Keys

Agent runs accept an `idempotencyKey` (migration 0040). Prevents duplicate execution on client retry.

Format: `{runType}:{agentId}:{subaccountId}:{userId}:{taskId}:{timeWindow}`

System agents generate keys automatically. External callers should provide a deterministic key.

### Test-run idempotency — `server/lib/testRunIdempotency.ts`

Inline Run Now test runs use a server-derived idempotency key built from canonical JSON serialization of the input payload. Client-supplied UUID is downgraded to a hint that participates in the hash but cannot control it.

**Canonical JSON:** `canonicalStringify()` sorts object keys recursively, drops `undefined` values in objects, replaces `undefined` in arrays and non-finite numbers with `null`. This ensures logically-equivalent payloads (same data, different key order) produce the same hash.

**Dual-bucket acceptance:** Keys are time-bucketed (10s windows). `deriveTestRunIdempotencyCandidates()` returns `[currentBucketKey, previousBucketKey]` — the execution service checks both via `inArray()` on SELECT but inserts only the current-bucket key. This eliminates false misses when a retry straddles a bucket boundary.

**Execution service integration:** `agentExecutionService.executeRun()` accepts `idempotencyCandidateKeys?: string[]`. When present, the SELECT deduplication check uses `inArray(agentRuns.idempotencyKey, candidates)` instead of a single `eq()`. All four test-run route files (`agents.ts`, `skills.ts`, `subaccountAgents.ts`, `subaccountSkills.ts`) use `deriveTestRunIdempotencyCandidates`.

Tests: `server/lib/__tests__/testRunIdempotencyPure.test.ts` — 20 tests covering canonical serialization, key derivation, and dual-bucket boundary behaviour.

### Test-run rate limiting — `server/lib/testRunRateLimit.ts`

In-memory per-user rate limiter for test-run endpoints. Phase 1 design — process-local `Map<userId, timestamps[]>` with explicit limitations documented:

- **Hard cap:** `MAX_TRACKED_USERS` (10,000) prevents unbounded memory growth; oldest entries evicted LRU-style when exceeded.
- **Eviction metric:** `evictionCount` tracks total evictions; logs at threshold intervals (every 100) for operational visibility. `getTestRunRateLimitMetrics()` exposes current counts for health endpoints.
- **Scaling note:** Effective rate multiplies by instance count under horizontal scaling. Replace with Redis/DB backing before multi-instance deployment.

Tests: `server/services/__tests__/testRunRateLimitPure.test.ts` — 7 tests covering limits, boundary, window expiry, and per-user independence.

### Test fixtures — `server/services/agentTestFixturesService.ts`

Saved prompt/input payloads for the inline Run Now test panel. Scoped per org/subaccount with a polymorphic target (`scope: 'agent' | 'skill'`, `targetId`). No FK to `agents`/`skills` — the service handles integrity at two layers:

- **Read-time filter:** `listFixtures()` verifies the polymorphic target still exists and is not soft-deleted before returning results. Orphaned fixtures are hidden on read and logged as `agentTestFixtures.orphan_target` for background cleanup.
- **Cleanup helper:** `cleanupOrphanedFixtures(orgId)` soft-deletes fixtures whose target is missing or soft-deleted. Intended for periodic background jobs.
- **Cascade on target delete:** `softDeleteByTarget()` called from agent/skill delete flows to proactively clean up fixtures.

---

## Agent Run Messages & Crash-Resume (Sprint 3)

Migration 0084 adds `agent_run_checkpoints` and `agent_run_messages` — the infrastructure for crash-resume (Sprint 3A/3B).

### Agent run messages

`agent_run_messages` stores every message in the agentic loop as an append-only log with a unique `(run_id, sequence_number)` constraint. Service: `agentRunMessageService.ts` (impure, Drizzle) + `agentRunMessageServicePure.ts` (pure decision logic).

Write discipline: `appendMessage()` must be called inside `withOrgTx(...)`. Acquires a row-level lock on the owning `agent_runs` row via `SELECT ... FOR UPDATE` before computing the next sequence number — cheap insurance against future multi-writer resume paths.

Read: `streamMessages(runId, fromSequence?, toSequence?)` — used by Sprint 3B resume to rebuild the in-memory `messages[]` array.

### Agent run cleanup

`server/jobs/agentRunCleanupJob.ts` — nightly job that prunes terminal runs older than each org's retention window (`organisations.run_retention_days`, default from `DEFAULT_RUN_RETENTION_DAYS` in `server/config/limits.ts`). Cascade-protected children (`agent_run_snapshots`, `agent_run_messages`) removed by `ON DELETE CASCADE` FK. Uses `withAdminConnection` + `SET LOCAL ROLE admin_role` to bypass RLS for cross-org sweep. Pure decision logic in `agentRunCleanupJobPure.ts`.

Terminal statuses pruned: `completed`, `failed`, `timeout`, `cancelled`. `loop_detected` and `budget_exceeded` are left for manual review.

### New agent fields

- `agent_runs.plan` (migration 0089) — structured plan field for the agent planning phase
- `agents.complexity_hint` (migration 0090) — agent complexity classification for execution routing

### Live Agent Execution Log (migration 0192 / spec: tasks/live-agent-execution-log-spec.md)

Per-run timeline of every material agent decision — prompt assembly, context-source load, memory retrieval, rule evaluation, skill invocation, LLM call bookends, handoff, clarification, lifecycle start/end. Three new tables:

- `agent_execution_events` — durable typed event log, keyed `UNIQUE (run_id, sequence_number)`. Sequence allocation is atomic against `agent_runs.next_event_seq` via a single `UPDATE … RETURNING` — no MAX scan. Every event carries `source_service`, `duration_since_run_start_ms`, an event-typed `payload jsonb`, and optional `linked_entity_{type,id}` (null-together, enforced by both the service validator and a DB `CHECK` constraint as belt-and-braces). `permissionMask` is **never persisted** — it's computed at read time from the caller's current permissions, closing the privilege-drift hazard where a revoked grant would still read `canEdit: true` on historical rows.
- `agent_run_prompts` — fully-assembled `system_prompt` + `user_prompt` + `tool_definitions` + `layer_attributions` per run assembly. Closes the audit gap where only `systemPromptTokens` (count, not content) was persisted. Surrogate `id uuid PK` lets `agent_execution_events.linked_entity_id` point at prompts like any other entity; the `(run_id, assembly_number)` UNIQUE is still the drilldown key.
- `agent_run_llm_payloads` — full request + response per `llm_requests.id` (1:1). Keyed by `llm_request_id`; carries a nullable denormalised `run_id` FK to `agent_runs` (null for non-agent callers — skill-analyzer, config assistant) for cheap per-run scans. Written through the redaction → tool-policy → size-cap pipeline in `server/services/agentRunPayloadWriter.ts::buildPayloadRow`. Defence-in-depth: pattern-based redaction in `server/lib/redaction.ts` scrubs bearer tokens + common secret shapes; per-tool `payloadPersistencePolicy: 'full' | 'args-redacted' | 'args-never-persisted'` lets credential-handling skills opt into stricter persistence. `redacted_fields` records pattern hits; `modifications` records everything else (truncation, tool-policy substitution) with original field sizes. Hard per-row cap at `AGENT_EXECUTION_LOG_MAX_PAYLOAD_BYTES` (1 MB default) with greatest-first truncation — TOAST compresses what's left transparently.

Sequence-allocation semantics:

- **Critical events** (`run.started` / `run.completed` / `llm.requested` / `llm.completed` / `handoff.decided` / `run.event_limit_reached`) bypass the cap — a lifecycle bookend always emits. `run.started` is **awaited** (`emitAgentEvent`, not `tryEmitAgentEvent`) so it always claims `sequence_number = 1` before any later emission can steal a lower number. Exactly-one retry with fixed 50 ms backoff on transient DB failure; persistent failure increments `agent_exec_log.critical_drops_total` and never fails the agent run.
- **Non-critical events** use the `next_event_seq < AGENT_EXECUTION_LOG_MAX_EVENTS_PER_RUN` guard in the `UPDATE`. Over the cap: drop + metric increment + one-shot `run.event_limit_reached` signal via atomic-claim on `agent_runs.event_limit_reached_emitted`. The claim + the signal-event insert run inside a single `tx.transaction(...)` so a DB failure on the insert rolls back the claim and allows a retry rather than losing the signal permanently.
- **Orchestrator dispatch ordering.** `orchestrator.routing_decided` is emitted **inside `executeRun`** (sequence 2, immediately after `run.started`) rather than from the dispatch job after awaiting the run to completion — the earlier shape put the event after `run.completed` on the dispatched run's timeline, breaking the "timeline represents actual execution order" invariant. The job passes an `orchestratorDispatch` field on `AgentRunRequest` to signal the emit.

Visibility model (spec §7):

- View gate (`canView`) inherits from `ORG_PERMISSIONS.AGENTS_VIEW` at the run's tier; subaccount membership is enforced upstream via `resolveSubaccount`. Single-source-of-truth resolver: `server/lib/agentRunVisibility.ts::resolveAgentRunVisibility`.
- Payload-read gate (`canViewPayload`) tightens to `AGENTS_EDIT` — raw system prompts + tool inputs can carry secrets past redaction, so the audience is the narrower "agent-editor" set. Redaction is defence-in-depth, not a security boundary.
- Per-event edit links inherit from each linked entity's existing edit permission (WORKSPACE_MANAGE, SKILLS_MANAGE, AGENTS_EDIT, etc.). System-managed agents and immutable entities (`prompt`, `llm_request`, `action`) always return `canEdit: false`.

Read path — `GET /api/agent-runs/:runId/events?fromSeq=&limit=` returns a 1000-row-capped page; `GET …/prompts/:assemblyNumber` returns one assembly; `GET …/llm-payloads/:llmRequestId` is stricter (AGENTS_EDIT) and double-gates via both the `llm_requests.run_id` upstream pre-check AND the denormalised `agent_run_llm_payloads.run_id` secondary check. Live stream via the existing `agent-run:${runId}` socket room and new `agent-run:execution-event` event kind; socket `join:agent-run` runs the full `resolveAgentRunVisibility` AGENTS_VIEW check (not just org-membership) so the push channel matches the pull channel's gate. Client dedup uses the existing 500-entry LRU on `${runId}:${sequenceNumber}:${eventType}` event IDs.

Client timeline (`AgentRunLivePage`) — snapshot + socket merge keyed on event `id` + sorted by `sequenceNumber`. Monotonic guard drops socket events with `sequenceNumber <= lastSeenSeq`; sliding-window cap at `TIMELINE_WINDOW_SIZE = 2000` bounds UI memory while the server-side snapshot endpoint remains the authoritative history. A cap-reached banner surfaces on any timeline that contains a `run.event_limit_reached` event, with a "View run trace →" deep-link for the full LLM ledger. Process-local counters `sequenceGapsTotal` + `sequenceCollisionsTotal` (exported via `getAgentRunLiveClientMetrics()`) complement the per-incident `console.warn` lines for diagnosing upstream invariant breaks.

Retention (P3 follow-up — not yet implemented): `AGENT_EXECUTION_LOG_HOT_MONTHS` / `_WARM_MONTHS` / `_COLD_YEARS` env defaults 6 / 12 / 7 match the ledger archive shape from migration 0188.

---

## Universal Brief (spec: `docs/universal-brief-dev-spec.md`)

The chat-first entry point for converting user intent (typed free-text, voice transcript, etc.) into structured work. Shipped as PR #176. Delivers: fast-path classifier → Orchestrator capability-aware routing → structured artefact output (`structured` / `approval` / `error`) → rule-capture loop. Cross-cuts four domains via a polymorphic conversation model.

### Mutation-path skeleton (applies to every write-class feature in this subsystem)

Every write that lands user-or-capability content follows the same six layers — documented at length in `KNOWLEDGE.md` under *"Mutation-path skeleton for any write that lands user or capability content"*. In order:

1. **Pure** — `*Pure.ts` module with no I/O. Pure decisions, plain inputs, plain outputs. Examples: `briefArtefactValidatorPure.ts`, `briefArtefactLifecyclePure.ts` (client), `ruleCapturePolicyPure.ts`.
2. **Validate** — per-item schema + enum check independent of state. `validateArtefactForPersistence` wraps the pure validator and substitutes a `BriefErrorResult` on failure so the caller never sees raw contract violations.
3. **Guard** — state-dependent invariant at write time. Pure core + async fetch wrapper. Scoped narrowly to invariants unambiguous regardless of arrival order. Reference: `validateLifecycleWriteGuardPure` + `validateLifecycleChainForWrite` enforce "a parent artefact can only be superseded once"; orphan parents stay an eventual-consistency case the UI's `resolveLifecyclePure` resolves.
4. **Write** — single insertion point. Every caller goes through `writeConversationMessage` in `briefConversationWriter.ts`. No bypass routes. Validate → guard run in order; rejects drop via the existing log+counter pattern before the DB is touched.
5. **Signal** — structured return shape + in-memory counters. `WriteMessageResult` carries `messageId`, `artefactsAccepted`, `artefactsRejected`, `assistantPending`, and (optional) `lifecycleConflicts: LifecycleConflictSignal[]`. Counters via `getBriefConversationWriterMetrics()` follow the `getAgentExecutionLogMetrics` pattern — structured log events remain source of truth; counters give dashboards a cheap aggregate.
6. **Test** — per-layer, not per-integration. Pure tests run directly (`server/services/__tests__/briefArtefactValidatorPure.test.ts` — 41 tests; `ruleCapturePolicyPure.test.ts` — 10 tests). A dedicated *mixed valid + invalid in the same batch* test pins the partial-success contract so the write path is never accidentally all-or-nothing.

Any new mutation-class feature (approval dispatch, rule idempotency keys, CRM writes) starts from this skeleton. If a feature cannot slot into all six layers cleanly, that is a design smell worth pausing on.

### Conversation model

Polymorphic `conversations` table (`server/db/schema/conversations.ts`, migration 0194) with `scopeType ∈ {'agent' | 'brief' | 'task' | 'agent_run'}` and unique `(scope_type, scope_id)`. Hard boundary — **conversations are transport only; domain logic must not depend on conversation structure**. The boundary comment lives at the table declaration; violations are blocking at code review. `findOrCreateBriefConversation` in `server/services/briefConversationService.ts` is the single create/read primitive. `conversation_messages` denormalises `organisation_id` + `subaccount_id` onto every row for RLS — message writes never need to re-read the parent conversation to establish scope.

### Fast-path classifier

`server/services/briefFastPathClassifier.ts` short-circuits obvious cases before the Orchestrator runs:

- `simple_reply` — canned responses for conversational chatter that do not require a capability (greetings, acks).
- `cheap_answer` — deterministic low-cost reply paths (see `briefSimpleReplyGeneratorPure.ts`). Note S4 in deferred items — current generator emits `source: 'canonical'` placeholder rows; this is a known pre-production gap.
- `needs_clarification` — ambiguous intent dimensions; escalates to the `ask_clarifying_questions` skill at Orchestrator time.
- `needs_orchestrator` — normal path; Orchestrator capability-aware routing handles everything.

Classifier confidence + route are persisted to `fast_path_decisions` (migration 0195). `fastPathDecisionsPruneJob.ts` ages out old rows; `fastPathRecalibrateJob.ts` is scaffolded for future threshold tuning.

### Artefact contract + lifecycle

`shared/types/briefResultContract.ts` defines the discriminated union (`structured` / `approval` / `error`) every capability emits. Base shape carries `artefactId`, `status`, `parentArtefactId`, `confidenceSource`, `budgetContext`. Client-side lifecycle resolution (`client/src/lib/briefArtefactLifecyclePure.ts`) handles superseded chains, orphans, out-of-order arrival so the UI always renders the correct tip. Backend chain-integrity enforced at write time by the write-guard above — see also §"Key files per domain" for the full file inventory.

**Defensive cap.** `MAX_ARTEFACTS_PER_WRITE = 25` in `briefConversationWriter.ts` rejects overflow explicitly via the existing rejection pattern (log `artefacts_over_limit` + increment `artefactsOverLimitTotal`). No silent truncation — runaway capability emission surfaces as an observable signal.

### Orchestrator integration + Phase 4 gates

The Orchestrator (see §"Orchestrator Capability-Aware Routing") consumes the fast-path decision and routes by capability availability. Two Universal Brief skills land in the action registry:

- `ask_clarifying_questions` — drafts up to 5 ranked questions when Orchestrator confidence `< 0.85`. Read-only; `idempotencyStrategy: 'read_only'`.
- `challenge_assumptions` — adversarial analysis for high-stakes actions. Read-only; `idempotencyStrategy: 'read_only'`.

Both are wired in `SKILL_HANDLERS`. Note S2 in deferred items — the file-based skill definition markdown (`server/skills/*.md` with frontmatter) for these two has not yet been authored; handlers run but the skills are invisible to the config assistant and Skill Studio UIs until the `.md` files land.

### Rule capture + conflict detection + auto-pause policy

`server/services/ruleCaptureService.ts::saveRule` is the single insertion point for rules harvested from approvals (or drafted manually). Conflict detection runs first via `ruleConflictDetectorServicePure.ts`; rules with conflicts return `saved: false` unless the caller passes `options.allowConflicts`. Status on insert is governed by `ruleCapturePolicyPure.ts::shouldAutoPauseRulePure`:

- Approval-suggestion origin (`originatingArtefactId` set) → `pending_review` (pause for human review).
- Explicit confidence `< AUTO_PAUSE_CONFIDENCE_THRESHOLD` (0.8) → `pending_review`.
- Everything else → `active`.

The policy module isolates the thresholds so future dimensions (source type, per-org overrides) land in one place instead of growing inline conditions in `saveRule`. `ruleAutoDeprecateJob.ts` handles decay of stale rules. Note B10 in deferred items — this job plus `fastPathDecisionsPruneJob` and `fastPathRecalibrateJob` currently read `memory_blocks`/`fast_path_decisions` outside the `withAdminConnection` / `withOrgTx` contract, so they are silent no-ops until the wrap lands; the feature paths still work end-to-end.

### Client entry points

- **Hook**: `client/src/hooks/useConversation.ts::useConversation(scopeType, scopeId)` is the single abstraction for every chat pane. Manages `conversationId`, `messages`, `sending`, `assistantPending` state. Includes a synchronous `useRef` lock that closes the double-send race React state cannot cover. `assistantPending` flips true on user POST, auto-clears when the next assistant message arrives, and has a 15s timeout fallback to prevent stuck-forever UI.
- **Panes**: `TaskChatPane.tsx` + `AgentRunChatPane.tsx` consume the hook. Extracting a shared `ConversationPane` shell component is deferred as CGF4b — revisit when a third pane emerges.
- **Brief detail page**: `client/src/pages/BriefDetailPage.tsx` renders the conversation stream + per-artefact cards (`ApprovalCard.tsx`, `StructuredResultCard.tsx`, `ErrorCard.tsx`, `ClarifyingQuestionsCard.tsx` — all with `*Pure.ts` companions so render logic is testable).
- **Budget context**: `client/src/components/brief-artefacts/BudgetContextStrip.tsx` + `BudgetContextStripPure.ts` — centralised `shouldShowSource` trust logic so multiple surfaces cannot disagree.

### Deferred (tracked in `tasks/todo.md`)

- **B10** — admin/org-tx wrap for `ruleAutoDeprecateJob` / `fastPathDecisionsPruneJob` / `fastPathRecalibrateJob`.
- **S2** — skill definition `.md` files for `ask_clarifying_questions` + `challenge_assumptions`.
- **S3** — stronger tests for `ruleConflictDetectorServicePure.parseConflictReportPure` malformed-input cases.
- **S4** — remove or re-label `cheap_answer` canned replies currently emitting `source: 'canonical'` placeholder rows.
- **S6** — trajectory tests for Phase 4 orchestrator gates (clarify / challenge).
- **S8** — move conversation-message websocket emits to a post-commit boundary (tx-outbox).
- **N1–N7** — nit-level polish: UUID validation on artefactId, org-scoped index on `conversations_unique_scope`, clock injection in pure modules, `GET /api/briefs/:briefId/artefacts` pagination, etc.
- **DR1** — `POST /api/rules/draft-candidates` route to wire `ApprovalSuggestionPanel` to `ruleCandidateDrafter.draftCandidates`; panel exists but is currently dark.
- **DR2** — re-invoke fast path + Orchestrator on follow-up conversation messages (spec §7.11/§7.12).
- **DR3** — wire `onApprove` / `onReject` on `ApprovalCard` artefacts; approvals currently render but the buttons are no-ops.
- **CGF4b** — extract shared `ConversationPane` shell component.
- **CGF6** — idempotency key for `saveRule` to dedupe retries (separate from the existing semantic-conflict path).
- **CGF1** — *closed* in the final review pass via the write-guard shipped in this PR.

---

## CRM Query Planner (spec: `tasks/builds/crm-query-planner/spec.md`)

A deterministic-first natural-language CRM read layer shipped as PR #177. Staged pipeline: registry match → plan cache → LLM fallback → validator → canonical / live / hybrid executor. Read-only by structural import restriction (CI guard `scripts/verify-crm-query-planner-read-only.sh`) — the planner cannot reach the write-side of `canonicalDataService` or any write helper.

### Pipeline stages

1. **Stage 1 (`registryMatcherPure.ts`)** — normalised intent tokens are matched against a curated canonical query registry (`executors/canonicalQueryRegistry.ts` + `canonicalQueryRegistryMeta.ts`). Zero AI cost, sub-second latency, returns `null` on miss. Aliases are normalised + collision-detected at module load.

2. **Stage 2 (`planCache.ts` + `planCachePure.ts`)** — LRU in-process cache keyed on `(intentHash, subaccountId)`. TTL tiers per `cacheConfidence` — high/medium = 60s, low = 15s. Cache key prefix includes `NORMALISER_VERSION` so any change to intent normalisation bumps cached entries automatically. Only `stageResolved === 3` plans are cached — Stage 1 hits never write cache. `.get()` returns a discriminated `{ hit: true, plan, entry } | { hit: false, reason: 'not_present' | 'expired' | 'principal_mismatch' }` so `planner.stage2_cache_miss` carries the specific miss reason.

3. **Stage 3 (`llmPlanner.ts` + `llmPlannerPromptPure.ts`)** — LLM fallback with single-escalation retry. Hybrid-detection heuristic short-circuits directly to escalation tier (spec §10.4). Both escalation branches pass `wasEscalated: true` + `escalationReason` ('hybrid_detected' | 'low_confidence') on the router context so `getPlannerMetrics.escalationRate` populates correctly. Prompt packing is pure — schema context truncated at `schemaTokensDefault` / `schemaTokensEscalated` from `systemSettingsService`.

4. **Stage 4 (`validatePlanPure.ts`)** — 10-rule validator. Rule 8 (canonical precedence) has three cases: promote `live → canonical` when no live-only filters present; promote `live → hybrid canonical_base_with_live_filter` when exactly one live-only filter present; stay `live` otherwise. The promotion guard additionally requires every non-live-only filter, sort, projection, and aggregation field to exist in the registry entry's `allowedFields` — otherwise `FieldOutOfScopeError` would escape canonical dispatch as a 500.

5. **Executor dispatch** — `canonicalExecutor.ts` (routes through `canonicalDataService` with principal session context), `liveExecutor.ts` (rate-limiter keyed on real GHL `locationId` resolved via `resolveGhlContext` — **NOT** `context.subaccountLocationId` which is deprecated), `hybridExecutor.ts` (row-count guard before live dispatch; warn-logs `hybrid_base_at_plan_limit` when base hits the plan's row limit).

### Key invariants

- **RLS wrapping (§16.4).** `runQuery` wraps its pipeline in `withPrincipalContext(toPrincipalContext(context), …)` when an outer `withOrgTx` is active (HTTP auth middleware provides it). Programmatic callers without an outer org-tx skip the wrap (`getOrgTxContext()` guard) rather than triggering the primitive's throw. `withPrincipalContext` itself snapshots prior `app.current_*` values and restores in `finally` so the planner's nested context does not leak forward into a longer-lived parent transaction (the agent-run → `crm.query` → `runQuery` path).

- **One terminal event per run.** `plannerEvents.ts` forwards `planner.result_emitted` / `planner.error_emitted` to `agentExecutionEventService` exactly once — `planner.classified` is NOT terminal for agent-log purposes. This prevents double-counting `skill.completed` when a run emits both classification and result/error.

- **Budget-error classification.** `isBudgetExceededError` discriminates on `code === 'BUDGET_EXCEEDED'` for the plain-object 402 shape — `{ statusCode: 402, code: 'RATE_LIMITED' }` (router reservation-side rate limiting) falls through to `ambiguous_intent`. Also matches `BudgetExceededError` instance (legacy) and `FailureError` with `failureDetail === 'cost_limit_exceeded'` (post-ledger `runCostBreaker`).

- **Error subcategory split (§16.2).** External artefact stays `ambiguous_intent` for UX stability, but `planner.error_emitted` payload carries `errorSubcategory: 'parse_failure' | 'rate_limited' | 'planner_internal_error' | 'validation_failed'` — operators distinguish internal failures from true user ambiguity without touching the user-facing copy.

- **PlannerTrace accumulator (§6.7 + §17.1).** Every terminal emit carries a deep-frozen `PlannerTrace` snapshot with top-level `executionMode: 'stage1' | 'stage2_cache' | 'stage3_live'` + per-stage slots + `mutations[]` + `terminalOutcome` + `terminalErrorCode`. `freezeTrace()` + `finaliseTracePlan()` live in the service. Cache-reuse vs fresh-dispatch is unambiguously visible at the trace top level.

- **Capability gate.** Route-level via `listAgentCapabilityMaps(orgId, subaccountId)` — unions `capabilityMap.skills + read_capabilities` across all enabled subaccount agents; missing `crm.query` returns `403 { error: 'missing_permission', requires: 'crm.query' }`. Skill-executor surface adds `allowedSubaccountIds` enforcement mirroring `executeQuerySubaccountCohort` so agents cannot escalate horizontally via `input.subaccountId`. Forward-looking `canonical.*` slugs are skipped at the validator per §12.1 with a `canonical.capability_skipped` debug log for observability.

- **Cache-write AFTER validation.** `planCache.set` is only called after `validatePlanPure` resolves successfully — structurally invalid plans never enter the cache.

### Observability surfaces

- Structured logs from `plannerEvents.ts` (13 event kinds).
- Agent execution log — exactly one `skill.completed` per planner run, via `planner.result_emitted` or `planner.error_emitted` only.
- `PlannerTrace` on every terminal event payload — top-level `executionMode` + per-stage slots.
- Dashboard: `getPlannerMetrics` in `systemPnlService.ts` + `/api/admin/llm-pnl/planner-metrics` + `SystemPnlPage.tsx` panel.
- `cost_prediction_drift` warn log when `actualCostCents.total > costPreview.predictedCostCents * 2`.

### Dual invocation surface

- **HTTP**: `POST /api/crm-query-planner/query` (`routes/crmQueryPlanner.ts`) — user-facing, goes through `authenticate` → `resolveSubaccount` → subaccount-capability gate → `runQuery`.
- **Agent skill**: `'crm.query'` in `SKILL_HANDLERS` (`server/services/skillExecutor.ts`) — agent-facing, gated upstream by the agent's own `capabilityMap`, with `allowedSubaccountIds` enforcement in-handler. `principalType: 'agent'`, `principalId: context.agentId`, `runId: context.runId` (so per-run cost breaker binds).

### Deferred (in `tasks/todo.md`)

- ID-scoped live fetch for hybrid execution (current: canonical base → full-limit live list → in-memory intersect; future: pass canonical IDs into live query)
- Runtime read-only enforcement at the adapter layer (complements the structural CI guard)
- Live executor retry taxonomy (retryable vs terminal error classification, cross-provider primitive)
- Principal `teamIds` resolution (all HTTP call-sites currently pass `[]` — zero production impact today since canonical rows default to `shared_subaccount`, but a proper resolver is cross-cutting and belongs with auth middleware)

---

## Skill System

### File-based definitions

Skills are defined as Markdown files in `server/skills/*.md`. There are 107 built-in system skills:

| Category | Skills |
|----------|--------|
| Agent collaboration | `spawn_sub_agents`, `request_approval`, `ask_clarifying_question` |
| Workspace | `read_workspace`, `write_workspace`, `read_codebase` |
| Context & Memory | `read_data_source`, `update_memory_block` |
| Task management | `create_task`, `move_task`, `update_task`, `reassign_task`, `add_deliverable` |
| Testing | `run_tests`, `run_playwright_test`, `write_tests` |
| Code | `review_code`, `write_patch`, `search_codebase`, `create_pr` |
| Integration | `web_search`, `fetch_url`, `fetch_paywalled_content`, `send_email`, `send_to_slack`, `transcribe_audio` |
| Admin | `triage_intake`, `draft_architecture_plan`, `draft_tech_spec`, `report_bug` |
| Execution | `run_command`, `trigger_process`, `capture_screenshot` |
| Pages (CMS-style) | `create_page`, `update_page`, `publish_page`, `analyze_endpoint` |
| Reporting Agent | `read_inbox`, `read_org_insights`, `write_org_insight`, `query_subaccount_cohort`, `compute_health_score`, `compute_churn_risk`, `compute_staff_activity_pulse`, `scan_integration_fingerprints`, `detect_anomaly`, `generate_portfolio_report`, `trigger_account_intervention`, `review_ux`, `analyse_42macro_transcript` |
| GEO (AI Search) | `audit_geo`, `geo_citability`, `geo_crawlers`, `geo_schema`, `geo_platform_optimizer`, `geo_brand_authority`, `geo_llmstxt`, `geo_compare` |
| Playbook Studio | `playbook_read_existing`, `playbook_validate`, `playbook_simulate`, `playbook_estimate_cost`, `playbook_propose_save` |
| Skill Studio | `skill_read_existing`, `skill_read_regressions`, `skill_validate`, `skill_simulate`, `skill_propose_save` |
| Priority Feed | `read_priority_feed` (universal — list/claim/release) |
| Cross-Agent Memory | `search_agent_history` (universal — search/read) |

`send_to_slack`, `transcribe_audio`, and `fetch_paywalled_content` were added with the Reporting Agent feature (migrations 0072–0074). All three go through `withBackoff` for retries and `runCostBreaker` for cost ceilings. The LLM router (`llmRouter.routeCall`) was added as a breaker caller in Hermes Tier 1 Phase C, via the new direct-ledger sibling `assertWithinRunBudgetFromLedger` — Slack + Whisper continue to use the original `assertWithinRunBudget` (cost_aggregates-backed).

### Skill visibility cascade (migration 0074)

Skills now use a three-state visibility cascade `system → organisation → subaccount`. At every level the owner sets `visibility`:

| Value | Effect on lower tiers |
|-------|----------------------|
| `none` | Skill is invisible — filtered from lists entirely |
| `basic` | Name + one-line description visible; body fields stripped |
| `full` | Everything visible (instructions, methodology, full definition) |

Helpers in `server/lib/skillVisibility.ts`:

- `isVisibleToViewer()` — should this skill appear in the viewer's list?
- `canViewContents()` — may the viewer read body fields?
- `canManageSkill()` — separate permission check; visibility never grants edit rights.

Owner-tier viewers always see `full` regardless of the visibility value. Visibility only restricts; it never expands.

### Skill executor & processor hooks

`skillExecutor.ts` implements a three-phase pipeline for every skill execution:

1. **`processInput`** — before permission gate: validate and transform input
2. **`processInputStep`** — after gate, before execute: prepare execution context
3. **`processOutputStep`** — after execute: transform and handle results

Processors can throw `TripWire` (from `server/lib/tripwire.ts`) to signal a retryable error — the job queue will retry rather than fail permanently.

### Skill scoping

| Scope | Table | Visibility |
|-------|-------|------------|
| System | `systemSkills` | Platform-only; not shown in org UI |
| Org | `skills` | Org admin can create/manage |
| Subaccount | inherited from org assignment | Subaccount-specific overrides |

System skills are now DB-backed (migrations 0097–0099). `server/skills/*.md` files are seed sources only. `systemSkillService` manages the DB rows; the backfill script (`scripts/backfill-system-skills.ts`) populates initial data. Every active system skill has a `handlerKey` wired to a TypeScript handler in `skillExecutor.ts`'s `SKILL_HANDLERS` map, enforced at server boot by `validateSystemSkillHandlers()`.

**Skill versioning** (migration 0101): `skill_versions` stores immutable snapshots of skill definitions. The Skill Studio (Feature 3) creates new versions on every save, supporting rollback to any prior version. See the Agent Coworker Features section for full details.

---

## Context Data Sources

Reference material attached to agents, scheduled tasks, or task instances. Loaded into the system prompt at run start, with cascading scope precedence and on-demand retrieval via the `read_data_source` skill. Migration 0078. Full spec at [`docs/cascading-context-data-sources-spec.md`](./docs/cascading-context-data-sources-spec.md).

### Four scopes

A single `agent_data_sources` row can be scoped one of four ways. Higher precedence wins when the same name appears across scopes.

| Scope | Where attached | Precedence |
|-------|---------------|------------|
| **task_instance** | `task_attachments` on a fired board task (text formats only) | 0 (highest) |
| **scheduled_task** | `agent_data_sources.scheduled_task_id` set | 1 |
| **subaccount** | `agent_data_sources.subaccount_agent_id` set | 2 |
| **agent** | `agent_data_sources.agent_id` only (no narrowing scope) | 3 (lowest) |

A CHECK constraint on `agent_data_sources` enforces that `subaccount_agent_id` and `scheduled_task_id` are mutually exclusive — they're orthogonal scoping axes.

### Eager vs lazy loading

Each `agent_data_sources` row has a `loading_mode` (default `eager`):

- **Eager** — content is fetched at run start and rendered into the `## Your Knowledge Base` block of the system prompt, subject to `MAX_EAGER_BUDGET` (60k tokens).
- **Lazy** — only a manifest entry (name, scope, size) appears in the system prompt under `## Available Context Sources`. The agent fetches the actual content on demand by calling the `read_data_source` skill.

Lazy mode is the scaling escape hatch for runs with many or large reference files. Manifest entries are capped at `MAX_LAZY_MANIFEST_ITEMS_IN_PROMPT` (25) for prompt size; the full list is always available via `read_data_source op='list'`.

### Same-name override resolution

When two sources across scopes share a normalised name (lowercase, trimmed), the highest-precedence scope wins as an explicit override. The losing source is suppressed: it does not appear in the prompt, is invisible to the `read_data_source` skill, but is persisted in the run snapshot with `suppressedByOverride: true` so the debug UI can explain why it wasn't used.

### Unified loader

`server/services/runContextLoader.ts` is the single entry point. It:

1. Pulls sources from all four scopes in one DB round-trip via `fetchDataSourcesByScope` + `loadTaskAttachmentsAsContext`
2. Resolves scheduled task `description` → `taskInstructions` for the new system prompt layer
3. Sorts by scope precedence then per-scope priority
4. Assigns `orderIndex` to the full sorted pool BEFORE override suppression (so suppressed entries have stable indices)
5. Resolves same-name overrides
6. Splits eager / lazy
7. Walks the eager budget upstream, marking `includedInPrompt: true/false` deterministically
8. Caps the lazy manifest for in-prompt rendering

The downstream `buildSystemPrompt` character-level truncation is now a safety net only — the upstream walk is the primary budget mechanism.

### Task Instructions layer

When a run is fired by a scheduled task (`triggerContext.source === 'scheduled_task'`), the scheduled task's `description` field becomes a dedicated `## Task Instructions` layer in the system prompt, placed between `## Additional Instructions` and the team roster. This lets non-developers configure project-specific reporting workflows by editing the scheduled task description in the UI — no new skill files needed.

### `read_data_source` skill

Single retrieval interface across all four scopes. Two ops:

- `list` — returns the manifest of all active (non-suppressed) sources, including which are already in the Knowledge Base and which are lazy
- `read` — fetches a specific source's content with optional `offset` / `limit` for chunked walks of large sources

Enforced limits (in `server/config/limits.ts`):

| Constant | Default | Purpose |
|----------|---------|---------|
| `MAX_EAGER_BUDGET` | 60000 | Total tokens in the `## Your Knowledge Base` block |
| `MAX_READ_DATA_SOURCE_CALLS_PER_RUN` | 20 | Per-run cap on `op: 'read'` calls |
| `MAX_READ_DATA_SOURCE_TOKENS_PER_CALL` | 15000 | Per-call clamp on the `limit` parameter |
| `MAX_LAZY_MANIFEST_ITEMS_IN_PROMPT` | 25 | Lazy manifest entries rendered into the prompt |

The skill is auto-injected onto every agent run via `agentExecutionService` step 5a — no per-agent configuration needed.

### Run-time snapshot

`agent_runs.context_sources_snapshot` (JSONB) captures every source considered at run start, including winners, suppressed losers, eager-but-budget-excluded, and lazy manifest entries. Each entry carries `orderIndex`, `includedInPrompt`, `suppressedByOverride`, `suppressedBy`, and `exclusionReason` for debugging. Frozen after run start; surfaced in the run trace viewer's Context Sources panel.

### Permissions

- `org.scheduled_tasks.data_sources.manage` — required to attach/edit/delete data sources on a scheduled task. Org Admin inherits via `Object.values(ORG_PERMISSIONS)`. Scheduled task base CRUD (create/update/delete the task itself) continues to use `org.agents.edit`.

### Routes

| Route | File | Purpose |
|-------|------|---------|
| `GET /api/subaccounts/:subaccountId/scheduled-tasks/:stId/data-sources` | `scheduledTasks.ts` | List sources |
| `POST .../data-sources` | `scheduledTasks.ts` | Create from URL |
| `POST .../data-sources/upload` | `scheduledTasks.ts` | Multipart file upload |
| `PATCH .../data-sources/:sourceId` | `scheduledTasks.ts` | Update |
| `DELETE .../data-sources/:sourceId` | `scheduledTasks.ts` | Delete |
| `POST .../data-sources/:sourceId/test` | `scheduledTasks.ts` | Test fetch |
| `GET .../reassignment-preview?newAgentId=...` | `scheduledTasks.ts` | Cascade preview for UI confirmation when changing the assigned agent |

The agent-level data source routes at `/api/agents/:id/data-sources` are unchanged.

---

## Scraping Engine

Multi-tier web scraping with automatic escalation, adaptive CSS selector healing, and recurring change monitoring. Lives in `server/services/scrapingEngine/`.

### Architecture overview

```
scrape_url / scrape_structured / monitor_webpage   ← skill handlers (skillExecutor.ts)
        │
        ▼
  scrapingEngine.scrape()                          ← orchestrator (index.ts)
        │
        ├── Pre-flight: domain allow/blocklist, rate limiter, robots.txt
        │
        ├── Tier 1: httpFetcher.ts         (plain HTTP, fastest)
        ├── Tier 2: browserFetcher.ts      (stealth Playwright via IEE)
        └── Tier 3: scraplingFetcher.ts    (Scrapling MCP sidecar, anti-bot)
                                            ↑ only when _mcpCallContext present
```

### Tier escalation

Each request starts at Tier 1. If a tier fails (non-2xx, empty body, bot-blocked), the engine escalates to the next tier up to `effectiveMax`. JSON output or CSS selectors cap `effectiveMax` at Tier 2 (need rendered DOM). Tier 3 requires `_mcpCallContext` from the agent run — without it, the engine stops at Tier 2.

| Tier | Module | Mechanism | When used |
|------|--------|-----------|-----------|
| 1 | `httpFetcher.ts` | Plain `fetch()` with UA rotation | Always tried first |
| 2 | `browserFetcher.ts` | Headless Playwright via IEE worker | When Tier 1 fails or selectors/JSON requested |
| 3 | `scraplingFetcher.ts` | Scrapling MCP sidecar (`uvx scrapling mcp`) | When Tiers 1+2 fail, text/markdown only, MCP context available |

### Pre-flight checks

Run before any tier:

1. **Domain allowlist/blocklist** — `OrgScrapingSettings.allowedDomains` / `blockedDomains`. Phase 1 uses hardcoded defaults; Phase 4 loads from DB.
2. **Rate limiter** — `rateLimiter.ts`, per-domain token bucket, process-local. Multi-process deployments multiply effective rate.
3. **robots.txt** — `isAllowedByRobots()` with in-process cache (24h TTL). Only when `respectRobotsTxt` is true. Checks root-path disallow only (full path parser deferred).

### Content extraction

`contentExtractor.ts` provides:

- `extractContent(html, url, format, selectors)` — HTML → text/markdown/JSON via Readability + Turndown
- `computeContentHash(content)` — SHA-256 for change detection
- `canonicalizeFieldKey(field)` — normalises field names (lowercase, underscores, strip non-alphanumeric)

### Scrapling MCP sidecar (Tier 3)

Optional anti-bot bypass via the Scrapling Python package. Transport: `stdio` via `uvx scrapling mcp`. MCP preset registered in `mcpPresets.ts` (slug: `scrapling`).

- `scraplingFetch(url, mcpContext)` tries `mcp.scrapling.stealthy_fetch`, falls back to `mcp.scrapling.get`
- Returns `{ available: false }` when the org hasn't configured Scrapling
- Content capped at 100KB

### Adaptive selector engine

Self-healing CSS selector matching in `adaptiveSelector.ts`. When a stored selector fails (site redesigned), the engine fingerprints all page elements and relocates the target via weighted similarity scoring. Zero LLM calls — pure DOM comparison.

**ElementFingerprint** (stored in `scraping_selectors.element_fingerprint` JSONB):

```typescript
{
  tagName, id, classList, attributes,
  textContentHash, textPreview,
  domPath,        // ancestor chain
  parentTag, siblingTags, childTags,
  position: { index, total }  // nth-of-type
}
```

**Similarity scoring** — weighted sum of 9 features:

| Feature | Weight | Method |
|---------|--------|--------|
| tagName | 0.15 | Exact match |
| id | 0.10 | Exact match |
| classList | 0.15 | Jaccard set similarity |
| attributes | 0.10 | Key-value overlap ratio |
| textSim | 0.15 | Token Jaccard on preview |
| domPath | 0.15 | LCS ratio |
| parentTag | 0.10 | Exact match |
| siblings | 0.05 | Jaccard |
| children | 0.05 | Jaccard |

**Thresholds**: ≥ 0.85 confident match, 0.6–0.85 uncertain (agent may ask for confirmation), < 0.6 no match.

**Algorithm**: O(n) scan over all elements. Pre-filtered by `tagName` when page has >5000 elements. Uses native DOM APIs via jsdom (`Document`/`Element`) — no cheerio dependency.

`resolveSelector(document, cssSelector, storedFingerprint)` tries the original selector first; falls back to adaptive scan only if the selector misses or fingerprint has drifted below the confident threshold.

### Selector persistence

`selectorStore.ts` wraps the `scraping_selectors` table:

- `saveSelector(params)` — select-first-then-update upsert (avoids Drizzle `onConflictDoUpdate` limitations with nullable unique index columns using NULLS NOT DISTINCT)
- `loadSelectors(params)` — load by org + subaccount + urlPattern + selectorGroup
- `incrementHit(id)` / `incrementMiss(id)` — atomic counter updates
- `updateSelector(id, newCss, newFingerprint)` — after adaptive re-match

Unique index: `(organisationId, subaccountId, urlPattern, selectorGroup, selectorName)` with NULLS NOT DISTINCT.

### Schema (migration 0108)

| Table | Purpose |
|-------|---------|
| `scraping_selectors` | Adaptive selector storage with hit/miss tracking |
| `scraping_cache` | Per-URL content cache with TTL (Phase 4 — not yet read by `scrape()`) |

### Skill handlers

Three skill handlers in `skillExecutor.ts`:

**`scrape_url`** — basic scraping. Passes `_mcpCallContext` from `SkillExecutionContext` to enable Tier 3. Returns content, contentHash, tierUsed.

**`scrape_structured`** — structured field extraction with adaptive selectors:

1. Check `selectorStore.loadSelectors()` for existing selectors
2. If stored: parse HTML via jsdom, extract with `resolveSelector()` per field (per-field try/catch — one broken selector doesn't discard the rest), track hits/misses, apply adaptive updates
3. If new: send focused DOM to LLM via `routeCall()`, parse field arrays + CSS selectors from response, save selectors via `selectorStore.saveSelector()` if `remember=true`
4. Returns parallel arrays per field + `selector_confidence` + `adaptive_match_used` + `content_hash`

**`monitor_webpage`** — recurring change detection:

1. Deduplication: queries existing scheduled tasks for same URL + subaccount + agent — returns existing task ID if found
2. Parses frequency via `parseFrequencyToRRule()` (daily, weekly, every N hours, every [weekday])
3. Initial scrape: `executeScrapeStructured` for fields-based monitoring, `scrapingEngine.scrape()` for hash-based
4. Creates scheduled task via `scheduledTaskService.create()` with `MonitorBriefConfig` brief (JSON in `scheduledTasks.brief`)
5. On each scheduled run: `runContextLoader.ts` detects `"type": "monitor_webpage_run"` in the brief, loads `## Scheduled Run Instructions` from `server/skills/monitor_webpage.md`, injects into agent `taskInstructions`

### Scheduled run protocol injection

`runContextLoader.ts` supports skill-typed scheduled tasks:

1. Parses the task `brief` as JSON
2. If `parsed.type` matches `/<skill>_run$/` (e.g. `monitor_webpage_run`), extracts the skill slug
3. Loads `server/skills/<slug>.md`, finds `## Scheduled Run Instructions` section
4. Appends section content to `taskInstructions` — the agent sees these instructions in its system prompt

### Key invariants

- Tier 3 requires `_mcpCallContext` — never attempted in contexts without MCP access (e.g. API-only calls)
- `selectorStore` uses select-then-update, not `onConflictDoUpdate`, because the unique index contains nullable columns
- `monitor_webpage` enforces deduplication by URL — calling it twice for the same URL returns the existing task
- Baseline metadata fields (`adaptive_match_used`, `selector_uncertain`) are stripped before storage to prevent false-positive change detection
- `buildCssSelector` recursion is depth-capped at 15 levels
- Rate limiter is process-local — multi-process deployments see N× the configured rate

---

## Review Gates & HITL

Tasks can set `reviewRequired: true`. When an agent acts on such a task, actions escalate to the review queue before executing.

- Review queue: `reviewItems` table
- Human approves or rejects via UI
- Integrates with `hitlService` for human-in-the-loop workflows
- Review decisions logged to `reviewAuditRecords`
- All review actions emit audit events

### Slack HITL Integration (Agent Coworker Feature 4)

When a review item is created, `reviewService` optionally calls `slackConversationService.postReviewItemToSlack()` if the org has a Slack connector with a configured `reviewChannel`. This posts a Block Kit message with Approve / Reject / Ask buttons. Button clicks flow back through `slackWebhook.ts`'s `block_actions` handler, which resolves the Slack user to an org user (`users.slack_user_id`) before authorizing the HITL action. Unlinked Slack users get an ephemeral "link your account" message.

---

## GitHub App Integration

`githubWebhook.ts` is intentionally **unauthenticated** — GitHub cannot provide JWT tokens.

Security model: HMAC-SHA256 signature verification against `GITHUB_APP_WEBHOOK_SECRET`.

Flow:
1. GitHub sends event (issue created, comment added, etc.)
2. Webhook verifies HMAC signature
3. Resolves subaccount from `installation_id` stored in `integrationConnections.configJson`
4. Creates a task on the subaccount board

---

## Board Config Hierarchy

```
Board Template (system_admin managed)
        ↓ initialises
Org Board Config (one per org, column array)
        ↓ "Push to All Clients" copies explicitly
Subaccount Board Config (per-client copy, independently editable)
```

Subaccount configs are **copies**, not live references. Changes to org config don't auto-propagate. Subaccount admins can override their board independently.

---

## Workspace Memory

- `workspaceMemoryEntries` table stores agent-written facts (type, content, embedding `vector(1536)`, `quality_score`, `tsv` for full-text)
- `workspaceMemoryService` handles CRUD, hybrid retrieval, entity extraction, and LLM-assisted deduplication
- `memoryDecayJob` prunes entries with `quality_score < 0.3` and fewer than 3 accesses after 90 days
- Embeddings support semantic search via HNSW index; retrieval upgraded to a hybrid RRF pipeline (see below)
- Used by agents to accumulate cross-run context, exposed to humans via the Activity page memory search

### Provenance, Lifecycle, and Quality-Score Boundary (migration 0150)

The Memory & Briefings PR review hardening pass added five durable invariants to `workspace_memory_entries`:

1. **Lifecycle timestamps** — `embeddingComputedAt`, `qualityComputedAt`, `decayComputedAt`. Each async job sets its timestamp on every row it touches so downstream jobs can verify ordering. The utility-adjust job checks `decayComputedAt IS NOT NULL` before running, which guarantees decay always precedes utility adjustment.
2. **Citation provenance at the write boundary** — `provenanceSourceType` (`agent_run | manual | playbook | drop_zone | synthesis`), `provenanceSourceId`, optional `provenanceConfidence`, and `isUnverified` (true when no provenance is supplied). High-trust paths (synthesis, utility-adjust) filter `isUnverified` rows out.
3. **Quality-score mutation guard** — `qualityScoreUpdater` column (`initial_score | system_decay_job | system_utility_job`). Every UPDATE that changes `qualityScore` must set this field to an allowed value; a Postgres trigger declared in migration 0150 raises otherwise.
4. **Architectural test enforces the §4.4 invariant** — `server/services/__tests__/qualityScoreMutationBoundaryTest.ts` walks the TypeScript sources and fails CI if any file outside the allowlist contains a write to `qualityScore`. The trigger and the test together close the boundary at both DB and code levels.
5. **Allowed writers** are exclusively `memoryEntryQualityService.ts` (`applyDecay`, `adjustFromUtility`) plus `workspaceMemoryService.ts` for the initial insert path. Any new writer requires reviewer sign-off and an allowlist entry in the boundary test.

### Content-Hash-Based Embedding Invalidation (migration 0151)

Workspace memory entries can be mutated in-place by the dedup UPDATE path. Without a drift signal, the embedding silently goes stale relative to the new content and vector search starts returning matches against text that no longer exists in the row. Migration 0151 closes this:

- **`content_hash`** — `TEXT GENERATED ALWAYS AS (md5(content)) STORED`. Auto-maintained by Postgres on every content mutation. Read-only at the application layer.
- **`embedding_content_hash`** — set on every embedding write to the hash of the content used to compute that embedding. When `content_hash IS DISTINCT FROM embedding_content_hash`, the embedding is stale.
- **Partial stale-index** — `workspace_memory_entries_stale_embedding_idx ON (subaccount_id) WHERE embedding IS NOT NULL AND embedding_content_hash IS DISTINCT FROM content_hash`. A backfill job can scan in O(stale) instead of O(rows).
- **`reembedEntry({ id, content, resetContext })`** in `workspaceMemoryService.ts` — the canonical re-embed helper. Dedups concurrent re-embeds for the same entry id via a process-local `inFlightReembeds: Set<string>`. Sets `embedding`, `embeddingComputedAt`, and `embeddingContentHash` atomically; clears `embeddingContext` when `resetContext` is true.
- **Phase 1 / Phase 2 embedding flow** — Phase 1 writes a content-only embedding immediately on insert; Phase 2 asynchronously re-embeds with the LLM-generated `embeddingContext` prefix. The Phase 2 enrichment UPDATE includes a CAS predicate (`AND content_hash = ${snapshotContentHash} AND embedding_context IS NULL`) so a concurrent Phase 1 write that mutated the content does not get overwritten with stale enrichment text.
- **Ops helpers** — `getStaleEmbeddingsBatch({ subaccountId?, limit? })` returns up to 1000 stale rows; `recomputeStaleEmbeddings({ subaccountId?, limit? })` walks the batch and calls `reembedEntry` per row, returning `{ scanned, recomputed, skipped }`. Both filter `deleted_at IS NULL`.

Treat `reembedEntry` as the only sanctioned write path for the embedding column outside of the initial insert. New callers must not write `embedding` directly without also writing `embedding_content_hash` to the matching content hash.

### Outcome-Gated Entry-Type Promotion (Hermes Tier 1 Phase B)

`workspaceMemoryService.extractRunInsights` takes a `RunOutcome` ({ `runResultStatus`, `trajectoryPassed`, `errorMessage` }) and uses it to gate how insights enter the memory store. The decision matrix lives in `server/services/workspaceMemoryServicePure.ts`:

- **`selectPromotedEntryType(rawType, outcome)`** — on `success + trajectoryPassed=true`, observations may be promoted to patterns; on `failed`, observations/decisions/patterns get demoted to `issue` (preferences demote to `observation`). `success + trajectoryPassed=false` is pass-through (no modifier).
- **`scoreForOutcome(baseScore, entryType, outcome)`** — applies an outcome-dependent score modifier per type (e.g. `success+true` bumps `pattern` / `decision` / `preference` scores; `failed` demotes everything). The +0.00 / 0.00 cases for `success+false` are pinned by tests.
- **`computeProvenanceConfidence(outcome)`** — outcome-derived confidence floor for `isUnverified` classification. Anything sourced from a non-success run is unverified by default; `outcomeLearningService` passes explicit `overrides` to mark human-curated lessons verified regardless of outcome.
- **`applyOutcomeDefaults(outcome, options, runId)`** — single pure helper that returns `{ provenanceConfidence, isUnverified, provenanceSourceType, provenanceSourceId }`. The service calls it in one place so the override chain (`overrides?.x ?? default`) is testable and cannot drift between the success and failure branches.

**`runResultStatus`** is written exactly once per run at three terminal sites (`agentExecutionService.ts` normal path, `agentExecutionService.ts` catch path, `agentRunFinalizationService.ts` IEE path). Every write includes `AND run_result_status IS NULL` in the WHERE plus `.returning({id})` so a write-skipped case is observable via the `runResultStatus.write_skipped` warn log. The derivation is pinned by `agentExecutionServicePure.ts::computeRunResultStatus(finalStatus, hasError, hadUncertainty, hasSummary)`; `hadUncertainty` is sourced from `runMetadata` jsonb (not the column — the dedicated column has no writers).

**Per-entryType half-life decay** — `memoryEntryQualityServicePure.ts::computeDecayFactor` now switches on entry type. Known types use an exponential `0.5^(days/halfLife)` decay (observation 7d, issue 14d, preference 30d, pattern/decision 60d). Unknown types fall back to the pre-existing linear `DECAY_WINDOW_DAYS` path.

Deferred: `runResultStatus='partial'` currently demotes a `completed` run whenever `hasSummary=false`, which couples outcome classification to summary-generation reliability. Tracked as H3 in `tasks/todo.md`; revisit before Tier 2 memory promotion work.

### Hybrid RRF Retrieval Pipeline (Agent Intelligence Upgrade Phases B2–B4)

`workspaceMemoryService._hybridRetrieve()` is the canonical path for injecting memory into agent prompts. It replaces the former single-CTE vector search with a multi-stage Reciprocal Rank Fusion pipeline:

1. **Candidate pool** — up to `MAX_MEMORY_SCAN` (1000) entries filtered by scope, quality threshold, domain tag, and `VECTOR_SEARCH_RECENCY_DAYS` (90-day window).
2. **HyDE query expansion** (Phase B4) — queries shorter than `HYDE_THRESHOLD` (100 chars) trigger a cheap LLM call that produces a hypothetical document, improving recall for terse inputs. Result cached per run.
3. **Domain classification** — query text mapped to a domain tag (`customer_success`, `revenue`, etc.) to pre-filter the candidate pool.
4. **Semantic retrieval** — cosine distance ranking over embedded candidates; top `N × RRF_OVER_RETRIEVE_MULTIPLIER` kept.
5. **Full-text retrieval** — `plainto_tsquery` over the `tsv` tsvector column; scores merged when valid tokens are present.
6. **RRF fusion** — `rrf_score = SUM(1 / (k + rank_i))` per entry across both retrieval sources; entries below `RRF_MIN_SCORE` dropped.
7. **Combined score** — `rrf_score × 0.70 + quality_score × 0.15 + recency_score × 0.15`.
8. **Optional reranking** (Phase B3) — when `RERANKER_PROVIDER` is set, a Cohere reranker re-scores the top candidates. Capped at `RERANKER_MAX_CALLS_PER_RUN` per run.
9. **Statement timeout** — the RRF query runs under `SET statement_timeout = '200ms'`; the reset is guaranteed by `try/finally` so pool connections are never left with a shortened timeout on error.

All tunable constants live in `server/config/limits.ts` under the `── Hybrid Search / RRF`, `── Reranking`, and `── Query Expansion / HyDE` sections.

### Memory Deduplication Job (Phase 2B)

`server/jobs/memoryDedupJob.ts` exports `runMemoryDedup()`, registered as a scheduled pg-boss job. Each sweep:

1. Collects distinct subaccounts with at least one embedded entry.
2. Self-joins `workspace_memory_entries` on cosine distance `< 0.15` (≈85% similarity) per subaccount.
3. Hard-deletes the lower-quality entry from each near-duplicate pair (tie-broken by `id` for determinism).
4. Runs via `withAdminConnection` + `SET LOCAL ROLE admin_role` to bypass RLS (cross-org maintenance path).

### Cross-Agent Memory Search (Agent Coworker Feature 5)

`search_agent_history` is a universal skill that exposes `workspaceMemoryEntries` via semantic vector search. Agents can query what other agents in their org have learned — not just their own memory.

- **Service:** `workspaceMemoryService.semanticSearchMemories()` — generates embedding for query text, runs cosine similarity (`<=>`) against `workspaceMemoryEntries.embedding`, joins `agents` for source agent names. `getMemoryEntry()` fetches a single entry by ID with org-scope guard.
- **Skill:** `search_agent_history` in `actionRegistry.ts` (`isUniversal: true`). Two ops: `search` (semantic vector search) and `read` (fetch single entry). Handler in `SKILL_HANDLERS` auto-enables org-wide search when no subaccountId context.
- **No schema changes** — uses existing `embedding vector(1536)` column and HNSW index on `workspaceMemoryEntries`.

---

## Agent Briefing (Agent Intelligence Upgrade Phase 2D)

A compact, cross-run orientation document automatically maintained per agent-subaccount pair and injected into the system prompt at every run start.

### Schema

`agent_briefings` table (`server/db/schema/agentBriefings.ts`) — one row per `(organisationId, subaccountId, agentId)` (unique index). Stores `content` (text), `tokenCount`, `sourceRunIds` (uuid[]), and `version`.

### How it works

1. **Generation** — after every run completes, `agentExecutionService` enqueues an `agent-briefing-update` pg-boss job (fire-and-forget). The handler `runAgentBriefingUpdate` in `server/jobs/agentBriefingJob.ts` calls `agentBriefingService.updateAfterRun()`.
2. **Update** — `updateAfterRun` loads the previous briefing + the latest `handoffJson` + up to `BRIEFING_MEMORY_ENTRIES_LIMIT` (5) recent high-quality memory entries, then calls the LLM to produce a rolling summary. Output is truncated to `BRIEFING_TOKEN_HARD_CAP` (1200 tokens) and upserted.
3. **Injection** — at run start, `agentBriefingService.get()` fetches the current briefing. If present, it is appended to the system prompt as a `## Your Briefing` section in the dynamic suffix (see Stable/Dynamic Prompt Split below).

**Non-blocking contract:** a briefing failure never blocks the agent run. Both the enqueue and the `get()` call are wrapped in try/catch.

The `handoffJson` block in the briefing LLM prompt is delimited by `<run-outcome-data>` tags to prevent prompt injection from agent-generated content.

---

## Agent Beliefs (Phase 1)

Discrete, confidence-scored facts per agent-subaccount — individually addressable, auto-extracted from run outcomes, designed for Phase 2 state evolution.

### Schema

`agent_beliefs` table (`server/db/schema/agentBeliefs.ts`) — one row per belief. Partial unique index on `(organisationId, subaccountId, agentId, beliefKey)` where `deletedAt IS NULL AND supersededBy IS NULL` ensures one active belief per key. RLS-protected.

### Key columns

`beliefKey` (stable slug), `category` (general|preference|workflow|relationship|metric), `subject`, `value`, `confidence` (0-1), `evidenceCount`, `source` (agent|user_override), `confidenceReason`, `lastReinforcedAt`, `supersededBy`/`supersededAt` (nullable Phase 1, wired Phase 2).

### How it works

1. **Extraction** — after every run, the `agent-briefing-update` job calls `agentBeliefService.extractAndMerge()` (fire-and-forget, after briefing). An LLM call extracts up to 10 beliefs with actions: add/update/reinforce/remove.
2. **Merge** — authoritative merge logic. LLM action is a hint; the service determines the effective action from DB state. Key normalization via `KEY_ALIASES` map. Semantic value comparison prevents false updates. Optimistic concurrency with per-belief retry. User-override beliefs are never modified by agents.
3. **Injection** — at run start, `agentBeliefService.getActiveBeliefs()` fetches beliefs ordered by category/confidence/key, budget-truncated to `BELIEFS_TOKEN_BUDGET` (1500 tokens). Injected as `## Your Beliefs` in the dynamic suffix, after briefing.
4. **User override** — PUT route sets `source: 'user_override'` with `confidence: 1.0`. Agent extraction skips user-override beliefs entirely.
5. **Post-merge cleanup** — beliefs below `BELIEFS_CONFIDENCE_FLOOR` (0.1) soft-deleted. Excess above `BELIEFS_MAX_ACTIVE` (50) trimmed by lowest confidence.

### Files

- Service: `server/services/agentBeliefService.ts`
- Schema: `server/db/schema/agentBeliefs.ts`
- Migration: `migrations/0112_agent_beliefs.sql`
- Limits: `server/config/limits.ts` (BELIEFS_* constants)
- Routes: `server/routes/subaccountAgents.ts` (GET/PUT/DELETE)
- Spec: `docs/beliefs-spec.md`

---

## Subaccount State Summary (Agent Intelligence Upgrade Phase 3B)

A structured operational snapshot injected into the system prompt so agents have immediate situational awareness without running data-fetching tool calls first.

### Service

`server/services/subaccountStateSummaryService.ts` — `getOrGenerate(orgId, subaccountId)`. Assembles the summary from live DB data (task counts by status, recent agent run stats, high-signal memory entries) with **no LLM calls**. Result is cached in `subaccount_state_summaries` with a 4-hour TTL.

- **Cache hit** — returns the stored text directly.
- **Cache miss / stale** — regenerates, upserts, then returns.

Injected into the system prompt as a dynamic section after `## Current Board`. Non-fatal if generation fails.

---

## Stable/Dynamic Prompt Split (Agent Intelligence Upgrade Phase 0C)

The system prompt is split into two parts to enable multi-breakpoint prompt caching:

| Part | Contents | Caching behaviour |
|------|----------|-------------------|
| `stablePrefix` | Sections 1–6 (master prompt, sub-prompt, additional instructions, task instructions context) + team roster | Cached across runs — changes only on agent config edit |
| `dynamicSuffix` | Agent briefing, task instructions, lazy manifest, workspace memory, workspace entities, current board, subaccount state summary, autonomous instructions | Dynamic — rebuilt each run |

The `runAgenticLoop` call receives `systemPrompt` as `{ stablePrefix, dynamicSuffix }` so the LLM gateway can route each part to the appropriate cache breakpoint tier.

---

## Memory Blocks (Letta Pattern)

Sprint 5 P4.2. Named, shared context blocks that can be attached to multiple agents. Unlike workspace memory (per-subaccount, agent-written), memory blocks are admin-managed persistent context that agents can read and (if permitted) write during runs.

### Schema (migration 0088)

- `memory_blocks` — `name`, `content`, `ownerAgentId` (nullable), `isReadOnly`, org/subaccount scoped, soft delete
- `memory_block_attachments` — join table linking blocks to agents with `permission` (`read` | `read_write`)

### How it works

1. **Read path** — `memoryBlockService.getBlocksForAgent(agentId, orgId)` loads all attached blocks in deterministic name order at run start. Cached in `MiddlewareContext`.
2. **Write path** — `update_memory_block` skill calls `memoryBlockService.updateBlock()` — validates attachment permission, ownership, and read-only flag.
3. **Admin CRUD** — `memoryBlocks.ts` routes: create, update, delete, attach/detach blocks to agents, list blocks.

### Universal skills integration

`read_data_source` and `update_memory_block` are injected into every agent run via the universal skills list in `server/config/universalSkills.ts`. The Agent Coworker Features added two more universal skills: `search_agent_history` (cross-agent memory search) and `read_priority_feed` (prioritized work queue).

---

## Agent Execution Middleware Pipeline

The agent execution loop runs every tool call through a three-phase middleware chain defined in `server/services/middleware/index.ts`. The pipeline is the central quality/safety filter for all agent behaviour.

### Phase 1 — preCall (before the LLM call)

Runs once per iteration, before the model is called:

1. **contextPressureMiddleware** — monitors context window usage, triggers compaction
2. **budgetCheckMiddleware** — enforces token/cost/call budgets
3. **topicFilterMiddleware** (Sprint 5 P4.1) — classifies the user message by topic (keyword rules in `server/config/topicRegistry.ts`), soft-reorders or hard-removes tools to narrow the agent's action space. Universal skills (`server/config/universalSkills.ts`: `ask_clarifying_question`, `read_workspace`, `web_search`, `read_codebase`) are always re-injected after filtering.

### Phase 2 — preTool (before each tool call executes)

Runs per tool call, in order:

1. **proposeActionMiddleware** (Sprint 2 P1.1 Layer 3) — universal authorisation hook. Evaluates the tool call against policy rules, writes to `tool_call_security_events`, blocks or allows. Decision cached on `MiddlewareContext.preToolDecisions` for replay idempotency.
2. **confidenceEscapeMiddleware** (Sprint 5 P4.1) — if the agent's self-reported confidence is below `MIN_TOOL_ACTION_CONFIDENCE`, blocks the tool call and forces `ask_clarifying_question` instead.
3. **toolRestrictionMiddleware** — enforces per-agent tool allowlists/blocklists.
4. **loopDetectionMiddleware** — detects repeated identical tool calls, prevents infinite loops.
5. **decisionTimeGuidanceMiddleware** (Sprint 3 P2.3) — when a policy rule matches and has `guidance_text` with confidence above `confidence_threshold`, injects the guidance into the tool call context. Runs last so blocked calls never receive guidance.

### Phase 3 — postTool (after each tool call completes)

1. **reflectionLoopMiddleware** (Sprint 3 P2.2) — enforces "no `write_patch` without prior `APPROVE` from `review_code`" contract. Escalates to HITL after `MAX_REFLECTION_ITERATIONS` blocked review attempts.
2. **hallucinationDetectionMiddleware** (Agent Intelligence Upgrade Phase 3C) — extracts entity-like references from the latest assistant message (quoted strings, capitalised multi-word phrases), cross-checks them against `workspace_entities` for the current subaccount, and injects an advisory message when unmatched references are found. Entity lookup is cached per run to avoid per-tool-call DB queries.

### Critique gate

`server/services/middleware/critiqueGate.ts` / `critiqueGatePure.ts` — separate from the pipeline, invoked at specific decision points to run a second-opinion evaluation before committing to an action. Used by the playbook step review flow.

---

## Policy Engine

`policyRules` table defines constraints on agent behaviour. `policyEngineService` evaluates rules during execution — can restrict actions, require escalation, or block execution. Evaluated before skill execution in the processor pipeline. Sprint 3 adds `confidence_threshold` and `guidance_text` columns (migration 0085) enabling decision-time guidance — the middleware injects guidance when a rule matches but confidence is above the threshold.

---

## Canonical Data Platform

Normalised data layer that consolidates provider-specific records into a shared canonical schema. Full spec: `docs/canonical-data-platform-roadmap.md`. Implementation details: `docs/canonical-data-platform-p1-p2-p3-impl.md`.

### P1 — Scheduled polling infrastructure (migrations 0161)

Every connector polls on a configurable schedule without operator intervention.

- **Tick job** (`server/jobs/connectorPollingTick.ts`) — 1-minute pg-boss cron. Queries all active connections with valid `syncPhase` (`backfill | transition | live`), delegates to `connectorPollingSchedulerPure.ts` to decide which are due, enqueues a sync job per connection.
- **Sync job** (`server/jobs/connectorPollingSync.ts`) — per-connection job with lease-based concurrency control. Acquires a tokened lease via `sync_lock_token` (atomic `UPDATE...RETURNING`), releases in a `finally` block scoped to the acquired token. Safety window: `DEFAULT_POLL_INTERVAL_MINUTES × SYNC_LEASE_SAFETY_MULTIPLIER` (30 min) auto-expires stale locks.
- **Ingestion stats** (`integration_ingestion_stats` table) — one row per sync execution. Tracks API calls, rows ingested, duration, phase, errors. Dedup via `UNIQUE(connection_id, sync_started_at)` with `ON CONFLICT DO UPDATE` for pg-boss retry safety.
- **Stale-connector detector** (`server/services/workspaceHealth/detectors/`) — workspace health finding when a connection exceeds 5× its poll interval without a successful sync or has a recent error.

### P2 — Read-path consolidation & data dictionary (migrations 0162)

- **Canonical schema** — `canonical_fields`, `canonical_row_versions`, `canonical_metric_history` tables normalise provider data. Convention: `UNIQUE(organisation_id, provider_type, external_id)` per table for idempotent upsert.
- **Read-path tagging** — every action in `server/config/actionRegistry.ts` declares `readPath: 'canonical' | 'liveFetch' | 'none'`. Static gate `verify-skill-read-paths.sh` enforces all entries have a value; `verify-canonical-read-interface.sh` ensures no raw Drizzle queries on `canonical_*` tables outside `canonicalDataService`.
- **Data dictionary skill** — `canonical_dictionary` action registered in `actionRegistry.ts`. `CANONICAL_DICTIONARY_REGISTRY` in `server/config/canonicalDictionary.ts` is the machine-readable catalogue of tables, columns, relationships, and freshness expectations. Static gate `verify-canonical-dictionary.sh` keeps registry and schema in sync.

### P3A — Connection ownership & principal model (migrations 0162–0165)

New tables: `service_principals`, `teams`, `team_members`, `delegation_grants`, `canonical_row_subaccount_scopes`.

New columns on `integration_connections`: `ownership_scope` (`user | subaccount | organisation`), `owner_user_id`, `classification` (`personal | shared_mailbox | service_account`), `visibility_scope` (`private | shared_team | shared_subaccount | shared_org`), `shared_team_ids`.

New columns on canonical tables: `owner_user_id`, `visibility_scope`, `shared_team_ids`, `source_connection_id`.

New columns on `agent_runs`: `principal_type` (`user | service | delegated`), `principal_id`, `acting_as_user_id`, `delegation_grant_id`.

Multi-subaccount rows (e.g. emails CC'd to multiple clients) use `canonical_row_subaccount_scopes` linkage table with attribution (`primary | mentioned | shared`).

### P3B — Principal-scoped RLS (migrations 0167–0169)

RLS policies on all canonical and integration tables enforcing visibility based on principal type and scope. See the [RLS section](#row-level-security-rls--three-layer-fail-closed-data-isolation) for policy details.

### P3C — ClientPulse canonical tables (migrations 0170–0177)

ClientPulse Phases 0–3 + Phase 1 follow-ups add 12 new canonical and ClientPulse-specific tables. All land under the Canonical Data Platform contract: `UNIQUE(organisation_id, provider_type, external_id)` on canonical tables (global uniqueness), RLS + `canonical_writer` bypass, `rlsProtectedTables.ts` entry, `canonicalDictionaryRegistry.ts` entry.

**Playbook engine scope refactor (migration 0171).** `playbook_runs.subaccount_id` becomes nullable; a new `scope` enum (`subaccount` | `org`) on both `playbook_runs` and `system_playbook_templates` disambiguates org-level vs sub-account-level runs. A CHECK constraint enforces valid scope/entity combinations. Callers requiring a sub-account use the `requireSubaccountId()` helper instead of asserting non-null.

**Six canonical CRM-agnostic tables (migration 0172).** `canonical_subaccount_mutations` (per-mutation write log feeding the Staff Activity Pulse), `canonical_conversation_providers`, `canonical_workflow_definitions` (includes `actionTypes` + `outboundWebhookTargets` for fingerprint scanning), `canonical_tag_definitions`, `canonical_custom_field_definitions`, `canonical_contact_sources`. All share the column header `(organisation_id, subaccount_id, provider_type, external_id, observed_at, last_seen_at)` and the same RLS policy shape. Each is written by the connector-polling service; reads go through the ingestion + scanner services.

**Three ClientPulse-specific timeseries (migrations 0172–0174).** `client_pulse_signal_observations` (8-signal observation timeseries), `client_pulse_health_snapshots` (health-score timeseries), `client_pulse_churn_assessments` (churn-band evaluations). Health snapshots + churn assessments are dual-written by the existing `compute_health_score` (`skillExecutor.ts:1269`) and `compute_churn_risk` (`:1279`) handlers — both write to the legacy `health_snapshots` table *and* the new ClientPulse-specific tables during the deprecation window. The legacy writes are scheduled for removal in a post-V1 cleanup.

**Integration fingerprint scanner (migration 0177, bumped from 0176 after merge-conflict with IEE 0176).** `integration_fingerprints` (two-tier library — `scope='system'` rows are seeded and cross-tenant-readable; `scope='org'` rows are tenant-isolated and represent agency-specific learnings promoted from triaged unclassified signals), `integration_detections` (per-subaccount integration matches, non-partial unique on `(org, subaccount, integration_slug)`), `integration_unclassified_signals` (novel observations queue awaiting operator triage, with occurrence-count-based importance score). CloseBot + Uphex are seeded as `scope='system'` rows. The scanner runs via the new `scan_integration_fingerprints` skill; the observation-insert is the atomic win-gate against retry-driven counter inflation.

**Two new skill handlers (Phase 1 follow-up).** `compute_staff_activity_pulse` (weighted-sum activity score from `canonical_subaccount_mutations` over configurable lookback windows; excludes automation users via outlier-volume classifier reading `operational_config.staffActivity.automationUserResolution`) and `scan_integration_fingerprints` (see above). Both use `idempotencyStrategy: 'keyed_write'` — poll cycles dedupe via `sourceRunId`; agent-skill invocations without a `sourceRunId` append fresh timeseries points by design.

**Webhook handler expansion.** `server/routes/webhooks/ghlWebhook.ts` now writes `canonical_subaccount_mutations` for 10 GHL event types: the 6 existing canonical-upsert handlers (`ContactCreate`, `ContactUpdate`, `OpportunityStageUpdate`, `OpportunityStatusUpdate`, `ConversationCreated`, `ConversationUpdated`) are extended, and 4 new lifecycle handlers (`INSTALL`, `UNINSTALL`, `LocationCreate`, `LocationUpdate`) land as `entityType='account'` events. Outbound-message guard on conversation events: write only when `direction='outbound' AND userId IS NOT NULL AND conversationProviderId IS NULL`.

**OAuth scope SSoT (locked contract g).** Expanded GHL scope list lives in `server/config/oauthProviders.ts` only — the duplicate in `server/routes/ghl.ts` was removed as part of Phase 0. `server/routes/ghl.ts` builds its authorisation URL from `OAUTH_PROVIDERS.ghl.scopes.join(' ')`. Expanded scopes apply to new authorisations only; existing tokens keep their originally-granted endpoints, and endpoints requiring new scopes gate themselves and mark observations `unavailable_missing_scope` when absent.

**`operational_config` JSON Schema (Phase 0 ship-gate B4).** `server/services/operationalConfigSchema.ts` ships the JSON Schema for `hierarchyTemplates.operationalConfig` with `sensitive` flags on intervention-template paths. `SENSITIVE_CONFIG_PATHS` is the exported enumeration consumed by the (Phase 4.5) Configuration Agent's sensitive-path routing gate. Schema enforces weight-sum constraints (`healthScoreFactors` sums to 1.00) via Zod refinements.

### Key files

| File | Purpose |
|------|---------|
| `server/jobs/connectorPollingTick.ts` | 1-min cron — selects due connections |
| `server/jobs/connectorPollingSync.ts` | Per-connection sync with lease lifecycle |
| `server/services/connectorPollingSchedulerPure.ts` | Pure logic: which connections are due |
| `server/services/connectorPollingService.ts` | Adapter-level sync execution |
| `server/config/connectorPollingConfig.ts` | Poll intervals, safety multiplier |
| `server/config/canonicalDictionary.ts` | Machine-readable data dictionary registry |
| `server/db/withPrincipalContext.ts` | Sets RLS session variables for principal |
| `server/config/rlsProtectedTables.ts` | Canonical manifest of all RLS-protected tables |

---

## Row-Level Security (RLS) — Three-Layer Fail-Closed Data Isolation

Sprint 2 introduces a defence-in-depth data isolation model. All three layers are required; no single layer is sufficient alone.

### Layer 1 — Postgres RLS policies

**Org-level (migrations 0079–0081):** 10 tables protected: `tasks`, `actions`, `agent_runs`, `agent_run_snapshots`, `review_items`, `review_audit_records`, `workspace_memories`, `llm_requests`, `audit_events`. Each has a `CREATE POLICY` keyed on `current_setting('app.organisation_id', true)`. Migration `0188` extends this to `llm_requests_archive` with the same org-scoped policy + `FORCE ROW LEVEL SECURITY`; the nightly retention job routes through `withAdminConnection` + `SET LOCAL ROLE admin_role` to perform the cross-org move (see LLM router contract → LLM ledger retention).

**Principal-scoped (migrations 0167–0169):** P3B extends org-level RLS with visibility predicates on canonical data and integration tables. Tables: `integration_connections`, `integration_ingestion_stats`, `canonical_fields`, `canonical_row_versions`, `canonical_metric_history`, `canonical_row_subaccount_scopes`, `service_principals`, `teams`, `team_members`, `delegation_grants`, `agent_runs` (extended). Policies enforce:

**ClientPulse canonical + derived tables (migrations 0172–0177)** are also registered in `rlsProtectedTables.ts` with org-scoped RLS + `canonical_writer` bypass: `canonical_subaccount_mutations`, `canonical_conversation_providers`, `canonical_workflow_definitions`, `canonical_tag_definitions`, `canonical_custom_field_definitions`, `canonical_contact_sources`, `client_pulse_signal_observations`, `client_pulse_health_snapshots`, `client_pulse_churn_assessments`, `integration_fingerprints` (two-tier: system scope cross-tenant-readable, org scope tenant-isolated), `integration_detections`, `integration_unclassified_signals`. See the [ClientPulse Phase 1 follow-ups section](#p3c--clientpulse-canonical-tables-migrations-01700177) for the full roster.


- **Org isolation** — all rows scoped to `app.organisation_id`
- **Visibility predicates** — `private` rows visible only to `app.current_principal_id`; `shared_team` rows visible when `shared_team_ids && app.current_team_ids`; `shared_subaccount` and `shared_org` rows visible to all principals in scope
- **Service principal restriction** — service principals (`app.current_principal_type = 'service'`) never see `private` or `shared_team` user data
- **Delegation grants** — delegated principals see the grantor's private data within the grant's scope and expiry

Session variables are set via `server/db/withPrincipalContext.ts` which wraps `withOrgTx` and sets `app.current_principal_type`, `app.current_principal_id`, `app.current_team_ids`.

**Legacy compat (migration 0169):** Fallback policies allow access when `app.current_principal_type` is NULL/empty, covering callers not yet migrated to `withPrincipalContext`. These will be removed in P3C when all callers are migrated.

The canonical manifest lives in `server/config/rlsProtectedTables.ts`. Every new tenant-owned table must be added to this manifest in the same commit as its `CREATE POLICY` migration. CI gate `verify-rls-coverage.sh` fails if the manifest references a table without a corresponding policy in any migration.

### Layer A / 1B — Service-layer org-scoped DB

`server/lib/orgScopedDb.ts` — `getOrgScopedDb(source)` returns the Drizzle transaction handle from the current `withOrgTx(...)` block. Throws `failure('missing_org_context')` if called outside a transaction. This is the **first line of defence** — the intent is to catch bugs at the service layer before RLS silently returns empty result sets.

Non-org-scoped access paths (migrations, cron, admin tooling) use `server/lib/adminDbConnection.ts` → `withAdminConnection()` which acquires a connection bound to the `admin_role` Postgres role (BYPASSRLS) and logs every invocation to `audit_events`.

### Layer 2 — Scope assertions at retrieval boundaries

`server/lib/scopeAssertion.ts` — `assertScope(items, { organisationId, subaccountId? }, source)` validates that every returned row matches the expected tenant. Throws `scope_violation` failure on mismatch. Used at every boundary that loads data into an LLM context window (system prompt assembly, workspace memory, document retrieval, attachments). Pure, synchronous, side-effect-free.

### Layer 3 — Tool call security events

`proposeActionMiddleware` (preTool pipeline) evaluates every tool call against policy rules and writes an audit row to `tool_call_security_events` (migration 0082). High-volume, idempotent via partial unique index on `(agent_run_id, tool_call_id)`. Separate table from `audit_events` due to different write volume and retention requirements.

`server/jobs/securityEventsCleanupJob.ts` prunes events beyond retention. `scripts/prune-security-events.ts` is the manual equivalent.

### CI gates

- `verify-rls-coverage.sh` — every `rlsProtectedTables.ts` entry has a matching `CREATE POLICY`
- `verify-rls-contract-compliance.sh` — verifies the three-layer contract is wired end-to-end

---

## Cost Tracking & Budgets

- `budgetReservations` — pre-allocate token budget before a run starts
- `costAggregates` — actual spend tracked after run completes
- `budgetService` — enforces per-run and per-org limits; throws if exceeded
- `llmPricing` table — model + provider pricing reference
- `llmRequests` table — every LLM call logged with tokens, cost, model

### MCP Tool Invocations (migration 0154)

Append-only ledger (`mcp_tool_invocations`) for every MCP tool call attempt, one row per attempt including retries. Key design points:

- **`mcpClientManager.writeInvocation()`** — fire-and-forget, never throws, never blocks the agent loop. Called from four sites: pre-execution exits (budget-blocked, invalid slug, connect failure), catch (retry path — writes the first attempt before recursing), and finally (covers success + non-retryable errors).
- **`wroteInCatch` flag** — prevents double-write: when catch writes the first attempt's row and recurses, the outer finally skips its write. The retry gets its own row via its own finally.
- **`callIndex`** — canonical ordering key within a run; null for pre-execution exits (avoids UNIQUE constraint); incremented before the try block so a retry gets `callIndex = N+1` with no collision.
- **`isRetry`** — `true` only in the finally block when `retryCount > 0`; pre-execution exits and the catch-path write for the first attempt always use `false`.
- **`failureReason`** — `'pre_execution_failure'` for routing failures (invalid slug, no connected instance); transport failure values (`timeout`, `process_crash`, `invalid_response`, `auth_error`, `rate_limited`, `unknown`) for error/timeout rows. DB CHECK enforces `null` for `success`/`budget_blocked`, non-null for `error`/`timeout`.
- **`isTestRun`** — denormalised from `agentRun.isTestRun`; test-run rows skip `mcp_org`/`mcp_subaccount`/`mcp_server` aggregate writes to keep P&L clean.
- **`budget_blocked`** — policy exit (not infra failure); `failure_reason IS NULL`, `duration_ms = 0`, excluded from `errorCount` in all aggregate and summary queries.
- **`responseSizeBytes` / `wasTruncated`** — `Buffer.byteLength(serialised, 'utf8')` is the basis for both; char count diverges for multibyte characters.
- **`mcpAggregateService.upsertMcpAggregates()`** — called fire-and-forget after each successful ledger insert. Reuses `cost_aggregates` with four MCP-specific entityTypes: `mcp_org` (monthly+daily), `mcp_subaccount` (monthly+daily), `mcp_run` (lifetime), `mcp_server` (monthly, org-scoped). Only `requestCount` and `errorCount` carry signal; LLM cost columns are zero.
- **Deduplication** — `onConflictDoNothing()` on `(run_id, call_index)` unique index prevents double-writes; aggregate upsert is skipped when no row was inserted, preserving the "recomputable from ledger" guarantee.
- **`mcpCallSummary`** in `agentActivityService.getRunDetail()` — grouped by `server_slug`, `errorCount` uses `filter (where status in ('error', 'timeout'))` — `budget_blocked` excluded.

---

## Event-Driven Architecture

- **pg-boss** — job queue for all async work (handoffs, heartbeats, scheduled tasks, slack inbound, priority feed cleanup)
- **WebSocket (Socket.IO)** — real-time updates to client. Rooms: subaccount tasks, agent runs, playbook runs
- **`useSocket` / `useSocketRoom`** — client subscribes to scoped rooms for live updates (see room patterns below)
- **Audit events** — all significant actions logged to `auditEvents` with actor, action, resource
- **Correlation IDs** — `correlation.ts` middleware generates per-request IDs for log tracing

### WebSocket room patterns

| Room | Format | Events | Consumer |
|------|--------|--------|----------|
| Subaccount | `subaccount:{id}` | Task/board updates | Board pages, activity feed |
| Agent run | `agent-run:{runId}` | `agent:run:started`, `agent:run:progress`, `agent:run:completed`, `agent:run:failed` | `RunTraceViewerPage`, `TestPanel` |
| Playbook run | `playbook-run:{runId}` | Step dispatch, step completion, approval state, form-input requests, run-level transitions | `PlaybookRunDetailPage` |

**Client hook:** `useSocketRoom(namespace, id, eventHandlers, onJoin)` from `client/src/hooks/useSocket.ts`. Joins the room on mount, leaves on unmount, invokes handlers per event. Typical pattern: each handler calls a REST refresh to maintain payload consistency (socket as notification, REST as source of truth).

**Backstop polling:** Components that use WebSocket rooms also run a `setInterval` backstop — 15s when connected, 5s when disconnected — to cover reconnect windows. The backstop is a safety net, not the primary update path.

---

## Regression Capture & Trajectory Testing

### Regression capture (Sprint 2 P1.2)

When a review item is rejected (human HITL rejects an agent-proposed action), the system automatically captures a regression case. Schema: `regression_cases` table (migration 0083).

Flow: rejection fires a `regression-capture` pg-boss job → `regressionCaptureService` loads the rejected run state → `regressionCaptureServicePure.materialiseCapture()` builds a structured snapshot → inserts into `regression_cases`. Per-agent ring buffer caps the number of active cases (default: `DEFAULT_REGRESSION_CASE_CAP` from `server/config/limits.ts`).

Best-effort: if the source run/snapshot/action was pruned before the job runs, the capture is silently skipped. Regression capture is additive, not on the critical path.

`scripts/run-regression-cases.ts` replays captured cases for regression testing.

### Trajectory testing (Sprint 4 P3.3)

Structural comparison of agent execution trajectories against reference patterns. A trajectory is the ordered sequence of `(actionType, args)` events from an agent run.

- `server/services/trajectoryService.ts` — loads trajectories from the `actions` table by `agentRunId`
- `server/services/trajectoryServicePure.ts` — pure `compare()` and `formatDiff()` functions
- `shared/iee/trajectorySchema.ts` — Zod schemas for `TrajectoryEvent`, `ReferenceTrajectory`, `TrajectoryDiff`
- `tests/trajectories/*.json` — reference trajectory fixtures (e.g. `intake-triage-standard.json`, `portfolio-health-3-subaccounts.json`)
- `scripts/run-trajectory-tests.ts` — CI-runnable trajectory test runner

---

## Quality Infrastructure — Static Gates & Testing Posture

The codebase runs a deliberate **static-gates-over-runtime-tests** posture. 33 `verify-*.sh` scripts enforce architectural invariants at CI time. Runtime unit tests follow the pure helper convention (below). There are zero frontend/E2E tests by design at this stage.

### Static gates

`scripts/run-all-gates.sh` runs all 33 verify scripts in sequence and reports pass/warn/fail. Gates are classified as **Tier 1** (hard fail — blocks CI) or **Tier 2** (warning only). Key gates:

| Gate | What it checks |
|------|---------------|
| `verify-async-handler.sh` | Every route handler uses `asyncHandler` |
| `verify-subaccount-resolution.sh` | Every `:subaccountId` route calls `resolveSubaccount` |
| `verify-org-scoped-writes.sh` | Service writes filter by `organisationId` |
| `verify-no-db-in-routes.sh` | Routes never import `db` directly |
| `verify-rls-coverage.sh` | Every `rlsProtectedTables.ts` entry has a matching `CREATE POLICY` |
| `verify-rls-contract-compliance.sh` | Three-layer RLS contract wired end-to-end |
| `verify-pure-helper-convention.sh` | `*Pure.ts` files have no impure imports |
| `verify-idempotency-strategy-declared.sh` | Jobs declare idempotency strategy |
| `verify-job-idempotency-keys.sh` | Job enqueue calls include idempotency keys |
| `verify-action-registry-zod.sh` | Action registry entries have Zod schemas |
| `verify-reflection-loop-wired.sh` | Reflection loop middleware is wired for review_code → write_patch |
| `verify-tool-intent-convention.sh` | Tool calls declare intent metadata |

### Pure helper convention

Services with complex logic are split into an impure file (DB reads/writes) and a `*Pure.ts` companion (pure decision logic, no imports from `db/`, no side effects). The pure file is trivially unit-testable with fixture data. Gate: `verify-pure-helper-convention.sh` checks that `*Pure.ts` files have no impure imports.

Examples: `agentExecutionServicePure.ts`, `regressionCaptureServicePure.ts`, `critiqueGatePure.ts`, `reflectionLoopPure.ts`, `trajectoryServicePure.ts`, `policyEngineServicePure.ts`.

### Runtime tests

23+ test files in `server/services/__tests__/` and `server/lib/__tests__/`. Key coverage:
- `agentExecution.smoke.test.ts` — end-to-end agent execution
- `rls.context-propagation.test.ts` — iterates `rlsProtectedTables.ts` to assert Layer B holds
- `agentExecutionServicePure.checkpoint.test.ts` — crash-resume parity
- `policyEngineService.scopeValidation.test.ts` — scope violation detection
- `testRunIdempotencyPure.test.ts` — canonical JSON, key derivation, dual-bucket boundary (20 tests)
- `testRunRateLimitPure.test.ts` — rate limit windows, eviction, per-user independence (7 tests)
- `runStatusDriftPure.test.ts` — shared↔client enum drift detection (5 tests)
- `scheduleCalendarServicePure.test.ts` — heartbeat/cron/RRULE projection, sort, cost estimation (23 tests)
- Pure helper tests: `critiqueGatePure.test.ts`, `reflectionLoopPure.test.ts`, `trajectoryServicePure.test.ts`, `priorityFeedServicePure.test.ts`, etc.

Test infrastructure: `server/lib/__tests__/llmStub.ts` — shared LLM mock for deterministic testing. `server/services/__tests__/fixtures/loadFixtures.ts` — fixture loader.

---

## Client Patterns

- **Lazy loading** — all page components use `lazy()` with `Suspense` fallback
- **Permissions-driven nav** — `Layout.tsx` loads `/api/my-permissions` and `/api/subaccounts/:id/my-permissions` to show/hide nav items
- **Real-time updates** — `useSocketRoom` for per-entity rooms (agent runs, playbook runs); `useSocket` for subaccount-scoped board updates. WebSocket is the primary update path; backstop polling covers reconnect windows (see Event-Driven Architecture above).
- **API wrapper** — all HTTP calls go through `src/lib/api.ts`
- **Shared client utilities** — `formatMoney.ts` (currency display), `runStatus.ts` (run state enum + guards), `runPlanView.ts` (execution plan rendering). New client-wide helpers go in `src/lib/`.

---

## Key Patterns

- **Soft deletes** — most tables use `deletedAt`. Always filter with `isNull(table.deletedAt)`.
- **Org scoping** — all data queries filter by `organisationId`. This comes from `req.orgId` (not `req.user.organisationId` — they differ for system_admin).
- **Service error shape** — `{ statusCode: number, message: string, errorCode?: string }`. Never throw raw strings.
- **No direct db access in routes** — routes call services only.
- **No manual try/catch in routes** — use `asyncHandler`.
- **Lazy imports** — client uses `lazy()` for all page components.
- **resolveSubaccount** — call this before any route logic that takes `:subaccountId`.

---

## Migrations

109+ migrations (0001–0109 plus 0170–0177 for ClientPulse Phases 0–3 + Phase 1 follow-ups, and 0176 for IEE Phase 0 delegation lifecycle, plus down-migrations). Schema changes go through SQL migration files in `migrations/`. **Migrations are run by the custom forward-only runner at `scripts/migrate.ts`** (`npm run migrate`) — drizzle-kit migrate is no longer used for production. The runner is forward-only by design; rollback is manual against the corresponding `*.down.sql` file in local environments only.

Recent migrations:
- `0177` — ClientPulse Phase 1 follow-up: `integration_fingerprints`, `integration_detections`, `integration_unclassified_signals` (bumped from 0176 after merge with IEE 0176)
- `0176` — IEE Phase 0: denormalised `agent_runs.iee_run_id` column + in-flight partial index
- `0170–0175` — ClientPulse Phases 0–3: template extension, playbook scope refactor, canonical mutation/artifact tables, health snapshots, churn assessments, ingestion idempotency
- `0109` — `skill_analyzer_results.classificationFailed` + `classificationFailureReason` — distinguish API failure from genuine partial-overlap in Skill Analyzer Phase 3
- `0108` — `scraping_selectors` + `scraping_cache` — learned element fingerprints and HTTP response cache for the Scraping Engine
- `0107` — unique constraint on `workspace_memory_entries` — deduplication key for org subaccount memory migration idempotency
- `0106` — org subaccount refactor — every org gets a permanent default subaccount for org-level agent execution
- `0105` — agent intelligence upgrade (Phases 0–3) — `agent_briefings` + related tables for search, memory, context, and briefing
- `0104` — ClientPulse + module system — `modules`, `subscriptions`, `org_subscriptions`, `reports` tables; slug on `system_hierarchy_templates`
- `0103` — `users.slack_user_id` — Slack user ↔ org user identity linkage (Feature 4)
- `0102` — `slack_conversations` — thread → agent conversation mapping (Feature 4)
- `0101` — `skill_versions` — immutable version history for skill definitions (Feature 3)
- `0100` — `priority_feed_claims` — optimistic claim locks for work feed entries (Feature 2)
- `0099` — `skill_analyzer_merge_updated_at` — updatedAt on merge records
- `0098` — `skill_analyzer_v2_columns` — agent embeddings, skill analyzer v2 fields
- `0097` — `system_skills_db_backed` — visibility + handler_key on system_skills; skills-to-DB migration
- `0090` — `agents.complexity_hint` — agent complexity classification for execution routing
- `0089` — `agent_runs.plan` — structured plan field for agent run planning phase
- `0088` — memory blocks: `memory_blocks` + `memory_block_attachments` (Letta-pattern shared context)
- `0087` — `organisations.ghl_concurrency_cap` — per-org GoHighLevel concurrency limit
- `0086` — `playbook_runs.run_mode` — playbook run mode (standard / replay / dry_run)
- `0085` — `policy_rules.confidence_threshold` + `policy_rules.guidance_text` — decision-time guidance
- `0084` — `agent_run_checkpoints` + `agent_run_messages` — crash-resume infrastructure
- `0083` — `regression_cases` — regression capture from rejected review items
- `0082` — `tool_call_security_events` — P1.1 Layer 3 audit trail for preTool authorisation
- `0081` — RLS on `llm_requests`, `audit_events` (Layer 1 batch 3)
- `0080` — RLS on `review_items`, `review_audit_records`, `workspace_memories` (Layer 1 batch 2)
- `0079` — RLS on `tasks`, `actions`, `agent_runs`, `agent_run_snapshots` (Layer 1 batch 1)
- `0078` — `agent_data_sources.scheduled_task_id` — context data sources for scheduled tasks
- `0077` — `hierarchy_templates.system_template_id` — closes schema/code drift
- `0076` — playbooks: templates, versions, runs, step runs (Playbooks feature — shipped in PR #87)
- `0075` — drop stale connection unique indexes (integration connection cleanup)
- `0074` — `skills.visibility` three-state cascade (`none` / `basic` / `full`)
- `0073` — Reporting Agent paywall workflow
- `0041` — heartbeat offset minutes (minute-precision scheduling)
- `0040` — agent run idempotency key

---

## Shared Infrastructure (use these — do not reinvent)

The following modules exist as **single-emit-point** primitives. New features must reuse them; bypassing them is a blocking issue in code review. Several are enforced by lint rules.

### Retry / backoff — `server/lib/withBackoff.ts`

Unified retry helper. **All external-call retries (LLM, integrations, webhooks, future engines) must go through this** rather than per-call `setTimeout`/`Math.pow` loops. Lint rule bans ad-hoc backoff outside this file.

```typescript
withBackoff({
  label: 'whisper.transcribe',
  isRetryable: (err) => isTransient(err),
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  retryAfterMs: (err) => parseRetryAfterHeader(err),
}, async () => callExternal())
```

Honours `Retry-After` headers, exponential backoff with full jitter, structured logging per attempt.

### Run cost circuit breaker — `server/lib/runCostBreaker.ts`

Hard ceiling on per-run spend. Reads `subaccount_agents.maxCostPerRunCents` (default 100¢). Throws via the unified failure helper on overage. **Every cost-incurring boundary must call the breaker** — LLM router after each call, external integrations before each call. Prevents runaway loops from racking up real spend.

**Five exports, two data-source contracts:**

| Export | Reads from | Canonical caller(s) |
|--------|------------|---------------------|
| `resolveRunCostCeiling(ctx)` | `subaccount_agents.maxCostPerRunCents` + fallback via `agent_runs.subaccountAgentId` | Both breaker variants |
| `getRunCostCents(runId)` | `cost_aggregates` (async rollup) | `sendToSlackService`, `transcribeAudioService` |
| `assertWithinRunBudget(ctx)` | `cost_aggregates` via `getRunCostCents` | `sendToSlackService`, `transcribeAudioService` |
| `getRunCostCentsFromLedger(runId)` | `llm_requests` directly | `llmRouter.routeCall` |
| `assertWithinRunBudgetFromLedger(ctx)` | `llm_requests` via `getRunCostCentsFromLedger` | `llmRouter.routeCall` |

The direct-ledger pair exists because `cost_aggregates` is updated asynchronously by `routerJobService.enqueueAggregateUpdate`, so a rollup-based read lags by up to one aggregation interval. The LLM router is the dominant cost surface; it cannot tolerate that lag. Slack and Whisper stay on the rollup path because their per-call magnitudes dwarf the lag and their concurrency profiles are low. The ledger helper takes `insertedLedgerRowId` as a REQUIRED parameter and fails closed on null or row-not-visible — a structural guarantee that a future refactor cannot re-order the call above the ledger insert. See `tasks/hermes-audit-tier-1-spec.md` §7.3.1 / §7.4.1.

**Atomic visibility + SUM (ledger helper).** `assertWithinRunBudgetFromLedger` merges the row-visibility check and the cost aggregate into a single scan: one query returns both `SUM(cost_with_margin_cents)` and a `COALESCE(MAX(CASE WHEN id = $insertedId THEN 1 ELSE 0 END), 0)` flag under the same `WHERE run_id = $runId AND status IN ('success','partial')` predicate. This makes the decision atomic (no race window between visibility and aggregation), catches cross-run contamination (wrong-run insert fails visibility), and catches caller misuse (non-counted-status row fails visibility). Future refactors must keep these merged — splitting them re-opens the race window. See `tasks/hermes-audit-tier-1-spec.md` §7.3.1 "Implementation note — atomic aggregate".

**Hard-ceiling `>=` semantics.** Both sibling helpers trip at `spent >= limit` (not `>`). The breaker runs **after** each cost is recorded; `>=` means the call that first hits the ceiling is the last one allowed, and the next call is refused. `>` would allow spend to equal the ceiling and only trip on the *following* call — a one-call overshoot window. Hard-ceiling semantics are the contract callers expect.

### Per-run cost visibility — `client/src/components/run-cost/`

The `RunCostPanel` component renders per-run LLM spend on every run-detail surface (`SessionLogCardList` compact row, `RunTraceView` full panel, `AdminAgentEditPage` compact row). Branch decisions + formatted strings live in `RunCostPanelPure.ts` so the full §9.1 rendering matrix (loading / error / zero / in-progress / data with compact + full breakdowns) is pinned by pure tests — the project does not ship React Testing Library, so the component is a thin shell around the pure module.

The shared response type `RunCostResponse` (`shared/types/runCost.ts`) and the `/api/runs/:runId/cost` handler (`server/routes/llmUsage.ts`) return:

- `totalCostCents` — from `cost_aggregates` (includes failed-call cost for accounting completeness).
- `llmCallCount`, `totalTokensIn`, `totalTokensOut`, `callSiteBreakdown: { app, worker }` — from the archive-safe `llm_requests_all` view under a success/partial filter.

The asymmetry between `totalCostCents` (rollup, includes failures) and the new fields (ledger, success/partial only) is intentional; the H1 deferred follow-up in `tasks/todo.md` proposes adding an explicit `successfulCostCents` field to remove the UI-interpretation trap.

`formatCost` in the pure module handles the full range from zero to thousands-of-dollars, including a scientific-notation fallback for sub-penny values (`toPrecision(2)` emits `"1.2e-7"` below ~1e-6 — the fallback re-renders via `toFixed(12)` with trailing-zero trim so the UI never shows scientific notation).

### Failure helper — `shared/iee/failure.ts`

**Single emit point for structured failures.** Every failure persisted to `agent_runs`, `execution_runs`, `execution_steps`, or any future run-like table must be constructed via `failure(reason, detail, metadata?)`. Inline `{ failureReason: '...' }` literals are banned by lint rule and a Zod check at the persistence boundary. Enriches metadata with `runId` + `correlationId` from AsyncLocalStorage.

```typescript
import { failure } from '../../shared/iee/failure.js';
throw failure('cost_exceeded', 'whisper_call_blocked', { spentCents, limitCents });
```

`FailureReason` is a closed enum in `shared/iee/failureReason.ts` — adding new reasons requires a schema update.

### Skill visibility — `server/lib/skillVisibility.ts`

Drives whether a skill's output body is surfaced to downstream consumers (`skills.contentsVisible` flag, migration 0072). New skills decide visibility explicitly; default is hidden.

### URL canonicalisation — `server/lib/canonicaliseUrl.ts`

Single canonicalisation path for URLs across the system (deduplication, comparison, idempotency keys). Use it when storing or hashing URLs.

### Agent run status enum — `shared/runStatus.ts`

Single source of truth for the 12 agent run statuses: `pending`, `running`, `delegated`, `completed`, `failed`, `timeout`, `cancelled`, `loop_detected`, `budget_exceeded`, `awaiting_clarification`, `waiting_on_clarification`, `completed_with_uncertainty`. Exports `TERMINAL_RUN_STATUSES`, `IN_FLIGHT_RUN_STATUSES`, `AWAITING_RUN_STATUSES` as `readonly arrays` (a single private `TERMINAL_SET` backs the hot-path `isTerminalRunStatus` check), plus type guards `isTerminalRunStatus()`, `isInFlightRunStatus()`, `isAwaitingRunStatus()`.

**`delegated`** (IEE Phase 0, `docs/iee-delegation-lifecycle-spec.md`): non-terminal. The run has been handed off to a delegated execution backend (IEE worker today; OpenClaw in future). Detail lives on the backend's row (`iee_runs`). Transitions to a terminal value via `server/services/agentRunFinalizationService.ts::finaliseAgentRunFromIeeRun` when the worker publishes the `iee-run-completed` event, or via the `maintenance:iee-main-app-reconciliation` cron if the event is lost. Included in `IN_FLIGHT_RUN_STATUSES`.

**Client duplicate:** `client/src/lib/runStatus.ts` is a structural copy — the client tsconfig does not reach `shared/`. Drift between the two is caught by `server/services/__tests__/runStatusDriftPure.test.ts` (5 assertions: dict match, terminal/in-flight/awaiting array match, `isTerminalRunStatus` agreement for every value).

**Usage:** Import from `shared/runStatus.ts` on the server; from `client/src/lib/runStatus.ts` on the client. Both `runPlanView.ts` and `TestPanel.tsx` use `isTerminalRunStatus` instead of local helpers.

### Currency formatting — `client/src/lib/formatMoney.ts`

Shared client-side money formatter. Values are in whole dollars (fractional), not cents. Default: 2dp. Opt-in `micro: true` renders sub-cent values at 4dp so costs below $0.01 are not shown as "$0.00". Handles null/undefined (returns "—"), zero, negatives. Used by `ScheduleCalendar` (per-occurrence micro, totals at standard 2dp) and available to any surface displaying dollar amounts.

### Other shared primitives

| Module | Purpose |
|--------|---------|
| `server/lib/inlineTextWriter.ts` | Append-only text artefacts inside runs |
| `server/lib/reportingAgentInvariant.ts` | End-of-run invariant checks (T25 pattern — assert run reached a terminal state with a structured outcome) |
| `server/lib/reportingAgentRunHook.ts` | Reporting Agent post-run hook |
| `server/services/fetchPaywalledContentService.ts` | Paywall-aware fetch (uses stored web login connection + browser worker) |
| `worker/src/browser/captureStreamingVideo.ts` | Snoop-and-refetch video downloader for the `capture_video` mode of `browserTask` (HLS / DASH support) |
| `scripts/migrate.ts` | Custom forward-only SQL migration runner — replaces `drizzle-kit migrate` for deploys |
| `scripts/seed-42macro-reporting-agent.ts` | Reference seeder pattern for system-managed agents + skill bundles |

---

---

## Configuration Assistant

A system-managed org-tier agent (`slug: configuration-assistant`, seeded by migration 0115) that turns natural-language requests into structured configuration changes — creating agents, linking them to subaccounts, setting skills and schedules, attaching data sources, and running health checks. It is the conversational front end to the `config_*` action registry; all mutations still flow through the same services the UI uses, so there is only one write path.

### Execution shape

- **Scope:** `org` — runs at org level, targets any subaccount by name lookup
- **Agent loop:** standard `agentExecutionService` — no bespoke runner
- **Model:** `claude-sonnet-4-6` (see migration seed); tokenBudget 60000, maxToolCalls 40
- **Heartbeat:** disabled — invoked on demand from the Configuration Assistant page
- **Master prompt:** not editable by org admins (`isSystemManaged: true`); only `additionalPrompt` overrides allowed

### Tool surface (29 skills, all file-backed in `server/skills/config_*.md`)

| Group | Count | Skills |
|-------|-------|--------|
| Mutation — agents & links | 9 | `config_create_agent`, `config_update_agent`, `config_activate_agent`, `config_link_agent`, `config_update_link`, `config_set_link_skills`, `config_set_link_instructions`, `config_set_link_schedule`, `config_set_link_limits` |
| Mutation — subaccounts & tasks | 3 | `config_create_subaccount`, `config_create_scheduled_task`, `config_update_scheduled_task` |
| Mutation — data sources | 3 | `config_attach_data_source`, `config_update_data_source`, `config_remove_data_source` |
| Mutation — ClientPulse operational_config | 1 | `config_update_hierarchy_template` (Phase 4.5; sensitive paths route through review queue per `SENSITIVE_CONFIG_PATHS`) |
| Read | 9 | `config_list_agents`, `config_list_subaccounts`, `config_list_links`, `config_list_scheduled_tasks`, `config_list_data_sources`, `config_list_system_skills`, `config_list_org_skills`, `config_get_agent_detail`, `config_get_link_detail` |
| Plan / validation | 2 | `config_preview_plan`, `config_run_health_check` |
| History | 2 | `config_view_history`, `config_restore_version` |

Handlers live in `server/tools/config/configSkillHandlers.ts`. Every mutation re-uses the canonical service (e.g. `config_link_agent` calls the same `subaccountAgentService.link()` the Companies UI calls).

### Plan-approve-execute flow

The assistant is constrained by its master prompt to a three-phase loop:

1. **Discovery** — list / detail tools only. At most 5 clarification rounds; after that, propose a plan with `[needs confirmation]` markers rather than looping indefinitely.
2. **Plan preview** — call `config_preview_plan` with the proposed step list. This returns a deterministic, human-readable diff; the UI blocks execution until the user clicks Approve.
3. **Execute** — the same step list is replayed server-side one step at a time. Each step's handler computes an idempotency key and writes a `config_history` entry. Final step is always `config_run_health_check` (skipped if no mutations ran).

### Idempotency key

Each mutation step computes:

```
sha256(sessionId + ":" + stepNumber + ":" + entityType + ":" + entityId + ":" + canonicalJSON(normalizedParameters))
```

Stored on the `agentRuns` row's tool-call record. Replaying the same approved plan is a no-op; editing the plan mid-execution produces different keys and is rejected at the route layer.

### Knowledge loading

On session start the assistant eagerly loads `architecture.md` and `docs/capabilities.md` as context data sources, so it can answer questions like *"what is a subaccount?"* or *"what does a link override do?"* from the canonical documentation without drift. Keeping those two files accurate is part of the Configuration Assistant's correctness contract, not an optional nicety.

### Explicitly out of scope

The assistant must refuse and surface the right UI for:

- User / permission management
- Integration connections (OAuth, API keys) — handled in Connectors
- Playbook authoring or execution
- Skill Studio (custom skill creation / analysis)
- Memory Blocks / Knowledge page curation
- Agent triggers
- Org budgets & workspace limits

This list is enforced in the master prompt and each group has a dedicated UI.

### Files

| Path | Purpose |
|------|---------|
| `migrations/0115_config_assistant_agent.sql` | System agent seed + module + subscription wiring |
| `server/skills/config_*.md` | 28 skill definitions (master of truth for tool contracts) |
| `server/tools/config/configSkillHandlers.ts` | Skill handler implementations |
| `server/routes/subaccountAgents.ts` | Route that creates a Configuration Assistant session and executes approved plans |
| `client/src/pages/ConfigAssistantPage.tsx` | Chat UI with plan preview + approve button |

---

## Config History & Config Backups

Every mutation to a configurable entity writes a versioned snapshot so the whole platform has a single audit / rollback substrate. Used by the UI (undo), the Configuration Assistant (plan replay + restore), the Skill Analyzer (bulk rollback), and the Admin History view.

### Tracked entity types (14)

Defined in `CONFIG_HISTORY_ENTITY_TYPES` (`server/services/configHistoryService.ts`):

```
agent, subaccount_agent, scheduled_task, agent_data_source,
skill, policy_rule, permission_set, subaccount,
workspace_limits, org_budget, mcp_server_config,
agent_trigger, connector_config, integration_connection
```

Adding a new configurable entity? Add its slug to `CONFIG_HISTORY_ENTITY_TYPES` **and** call `configHistoryService.record()` from the mutation service. The list is enforced — writes with an unknown `entityType` throw.

### Schema (migrations 0114, 0116, 0117)

| Table | Purpose |
|-------|---------|
| `config_history` (migration 0114, org-scope uniqueness tightened in 0116) | One row per (entity, version). JSONB `snapshot` of the entity post-change. `version` auto-increments per `(org, entityType, entityId)` via unique constraint + retry-on-conflict. `changeSource` ∈ `ui / api / config_agent / system_sync / restore`. Optional `sessionId` links rows written by one Configuration Assistant run. |
| `config_backups` (migration 0117) | Point-in-time snapshot **sets** — bulk operations (Skill Analyzer apply, Configuration Assistant plan apply) write one `config_backups` row containing the pre-mutation state of every affected entity. `scope` ∈ `skill_analyzer / manual / config_agent`. `status` tracks `active / restored / expired`. |

### Write path

```
mutation service → configHistoryService.record({entityType, entityId, snapshot, changedBy, changeSource, sessionId?})
  ↓
  1. acquire advisory lock on `${entityType}:${entityId}`
  2. read current max(version) for (org, entityType, entityId)
  3. diff previous snapshot → deterministic changeSummary (no LLM)
  4. insert row at version+1; retry once on unique-constraint violation
```

Sensitive fields are redacted at the service layer before snapshotting — see `SENSITIVE_FIELDS` in `configHistoryService.ts` (access tokens, encrypted secrets, webhook secrets, api keys). System agents additionally redact master-prompt content for non-system admins on read.

### Restore

`configHistoryService.restore(entityType, entityId, targetVersion)` replays the target snapshot back onto the entity's canonical service, then writes a **new** history entry with `changeSource: 'restore'`. The old versions stay in the table — restore is forward-only, never destructive.

`configBackupService.restoreBackup({ backupId, organisationId, restoredBy })` is the bulk counterpart used by Skill Analyzer (and Configuration Assistant plan replay). It iterates every entity in the backup row, replays it via the canonical service for that entity type, flips the `config_backups.status` from `active` to `restored`, and returns a per-scope counter object. For the `skill_analyzer` scope the returned counters are `{ skillsReverted, skillsDeactivated, agentsReverted, agentsSoftDeleted }`. See the Skill Analyzer section for the specific entity-type shapes and back-compat handling.

`configBackupService.describeRestore({ backupId, organisationId })` is a read-only dry-run that returns the same counter object a real restore would produce, without mutating anything. Used by the Skill Analyzer UI to preview impact before confirming.

### UI surfaces

- **Config Session History** page (`/admin/config-history`) — browse every mutation grouped by Configuration Assistant session, with filter by entity type and user
- Per-entity version list surfaced via `config_view_history` skill in the Configuration Assistant chat
- Restore is available from the same page and from the chat via `config_restore_version`

### Files

| Path | Purpose |
|------|---------|
| `server/db/schema/configHistory.ts` | `config_history` table |
| `server/db/schema/configBackups.ts` | `config_backups` table |
| `server/services/configHistoryService.ts` | `record()`, `restore()`, `list()`, change-summary generator, redaction |
| `server/services/configBackupService.ts` | Bulk snapshot + restore used by Skill Analyzer and Configuration Assistant |
| `client/src/pages/ConfigSessionHistoryPage.tsx` | Admin history browser grouped by session |

---

## ClientPulse Intervention Pipeline (Phases 4 + 4.5 + Session 2)

The end-to-end loop that turns a churn assessment into an operator-approved CRM action and measures the outcome 24h later. Closes ship-gates **B2** (outcome attribution), **B3** (config_history audit), **B5** (sensitive-path gating); Session 2 closes **S2-6.1** (real adapter dispatch), **S2-6.3** (drilldown), **S2-8.1** (outcome-weighted recommendation), **S2-8.3** (notify_operator fan-out).

### Architectural commitments (locked, do not violate)

- **No parallel intervention table.** Interventions are `actions` rows + `intervention_outcomes` rows. Anything that looks like it needs a `client_pulse_interventions` table is wrong.
- **All 5 primitives are review-gated.** Operators are the only execution path in V1. The scenario detector proposes; it never auto-fires.
- **Single lifecycle entry point.** Every intervention proposal — operator-driven OR scenario-detector — flows through `enqueueInterventionProposal()` in `server/services/clientPulseInterventionContextService.ts`. Drift between the two paths is structurally impossible.
- **Deterministic idempotency keys.** No timestamps in the key. Same logical intervention → same key, regardless of caller / retry / concurrent worker. See `clientPulseInterventionIdempotencyPure.ts`.
- **Typed metadata contract.** `validateInterventionActionMetadata()` runs on every metadata write; the JSONB column has a schema even though Postgres doesn't enforce it.

### The 5 namespaced action primitives

Registered in `server/config/actionRegistry.ts`. All `defaultGateLevel='review'`, `idempotencyStrategy='keyed_write'`. Namespaced to avoid collision with the existing unprefixed `send_email` / `create_task`.

| Action type | Category | Handler shape |
|-------------|----------|---------------|
| `crm.fire_automation` | api | Fires a CRM workflow on a contact. Payload: `{ automationId, contactId, scheduleHint, scheduledFor? }` |
| `crm.send_email` | api | Sends an email via the client's CRM. Resolves merge-fields server-side before provider call. |
| `crm.send_sms` | api | Sends an SMS via the client's CRM. Resolves merge-fields + segment-counts. |
| `crm.create_task` | api | Creates a task on the client's CRM (distinct from the internal board `create_task`). |
| `notify_operator` | worker | Internal operator-facing notification. Session 2 ships real channel fan-out across in-app (review queue), email (`emailService.sendGenericEmail`), and Slack (org-configured webhook on `organisations.settings.slackWebhookUrl`) via `notifyOperatorFanoutService`. Per-channel delivery results land on `actions.metadata_json.fanoutResults` for audit. |

Each handler ships a Pure module (`server/skills/<slug>ServicePure.ts`) covering payload validation, idempotency-key shape, and provider-call construction.

### apiAdapter dispatch (Session 2 §2)

Approved `crm.*` actions flow through `executionLayerService.executeAction()` → precondition gate → `apiAdapter.execute()` → GHL REST API. The Phase-1A stub is gone.

**Precondition gate (spec §2.6, contract (u)):** four checks run before dispatch:

1. `actions.status === 'approved'` — enforced by `actionService.lockForExecution()` which atomically transitions to `executing`.
2. Validation-digest re-check — if `metadata_json.validationDigest` was captured at propose-time (via `computeValidationDigest(payload)` SHA-256), it's recomputed and compared; drift → `blocked` with `blockedReason: 'drift_detected'`.
3. PG advisory lock per `(organisation_id, subaccount_id)` — serialises dispatch within a subaccount; contention → `blocked: 'concurrent_execute'`.
4. Timeout budget — if `metadata_json.timeoutBudgetMs` is already depleted, → `blocked: 'timeout_budget_exhausted'`.

Fail-cases write to `actions.status='blocked'` with the reason on `metadata_json.blockedReason` via `actionService.markBlocked()`. No retry. Every block emits a structured `executionLayer.precondition_block` log line keyed on `actionId` + `organisationId` + `subaccountId` + `blockedReason` so ops can distinguish engine-side blocks (never reached the adapter) from provider-side failures (via the separate `apiAdapter.dispatch` log).

**Dispatcher:** `apiAdapter.execute()` resolves the GHL endpoint via `GHL_ENDPOINTS[actionType]` (`server/services/adapters/ghlEndpoints.ts`), substitutes `{contactId}` / `{workflowId}` placeholders, forwards the caller's `idempotencyKey` as the `Idempotency-Key` header, and dispatches. GHL's OAuth access token is read directly from `integration_connections.accessToken` (scoped by `organisationId` + `subaccountId` + `providerType='ghl'` + `connectionStatus='active'`); the subaccount's location is `configJson.locationId`. Token expiry is monitored via `tokenExpiresAt` — a past or near-expiry (<5 min) token logs `apiAdapter.token_expired` / `apiAdapter.token_near_expiry` before dispatch. Full OAuth refresh-on-expire deferred to the upcoming `ghlOAuthService.getValidToken()` wiring (Session 3).

**Retry classifier:** `classifyAdapterOutcome()` (`apiAdapterClassifierPure.ts`) is a pure function mapping `{ status }` | `{ networkError, timedOut }` to `terminal_success | retryable | terminal_failure`. Rules: 2xx → success; 429 → retryable (rate_limit); 502/503 → retryable (gateway); network timeout / error → retryable; 401/403 → terminal (auth); 404 → terminal (not_found); 422 → terminal (validation); other 5xx → retryable (outer loop's `maxRetries` caps); other 4xx → terminal. 10 pure-test cases pin every branch.

**Return shape:** adapter returns `{ success, resultStatus, error?, errorCode?, retryable? }` where `retryable` drives the engine's retry decision. `executionLayerService` passes `retryable` into `actionService.markFailed()` which bumps `retry_count` and emits `retry_scheduled` when under `max_retries`.

**notify_operator short-circuit:** `notify_operator` has `internal: true` in `GHL_ENDPOINTS` — the adapter does not cross the wire; `skillExecutor.ts`'s `notify_operator` case invokes `fanoutOperatorAlert()` directly on approve.

**Migration 0185 — `actions.replay_of_action_id`:** pre-documented per contract (s) to support a future replay runtime. Nullable, indexed, stays NULL through Session 2.

### Outcome-weighted recommendation (Session 2 §5)

`clientPulseInterventionContextService.buildInterventionContext()` now derives `recommendedActionType` + `recommendedReason` from aggregated `intervention_outcomes` rows:

- `aggregateOutcomesByTemplate(orgId, currentBand)` groups by `(templateSlug, bandBefore)` and computes `trials`, `improvedCount` (`bandChanged AND NOT executionFailed`), `avgScoreDelta` (`deltaHealthScore`).
- Pure `pickRecommendedTemplate()` (`recommendedInterventionPure.ts`) returns `{ pickedSlug, reason: 'outcome_weighted' | 'priority_fallback' | 'no_candidates' }`. Rules: if ≥ N trials, score = `(improvedCount / trials) * 100 + avgScoreDelta`, sorted by score desc, trials desc, priority, slug; otherwise highest-priority wins.
- Threshold N is tunable via `operationalConfig.interventionDefaults.minTrialsForOutcomeWeight` (default 5, non-sensitive leaf).

`recommendedReason` surfaces to the client so `ProposeInterventionModal` can badge "Recommended · outcome-weighted" vs "Recommended · priority fallback".

### Per-client drilldown (Session 2 §4)

Route: `GET /clientpulse/clients/:subaccountId`. Minimal surface per Q5 scope lock — header (band + health score + 7d delta), signal panel (top drivers from latest churn assessment), band-transitions table (90d window derived from consecutive `clientPulseChurnAssessments` rows), intervention history table with outcome badges, contextual "Open Configuration Assistant" trigger seeded with subaccount-aware prompt, "Propose intervention" launcher.

Backed by four GETs on `server/routes/clientpulseDrilldown.ts` (all `requireOrgPermission(AGENTS_VIEW)`): `/drilldown-summary`, `/signals`, `/band-transitions`, `/interventions`. Orchestration in `drilldownService.ts`; outcome-badge derivation in `drilldownOutcomeBadgePure.ts` (11 test cases).

### Live-data pickers (Session 2 §3)

Five subaccount-scoped GHL read endpoints back the intervention editors, replacing Session 1's free-text ID inputs: `/crm/automations`, `/crm/contacts`, `/crm/users`, `/crm/from-addresses`, `/crm/from-numbers`. All require `AGENTS_VIEW` + `resolveSubaccount`. Responses canonicalised in `crmLiveDataService.ts` (60 s in-memory cache, Redis upgrade deferred). On GHL 429 the service returns `{ rateLimited: true, retryAfterSeconds }` which the `<LiveDataPicker>` surfaces as a "retry in N seconds" banner + disabled input.

`<LiveDataPicker>` (`client/src/components/clientpulse/pickers/`) is a reusable debounced-search dropdown (200 ms debounce, keyboard nav ↑/↓/Enter/Esc, preloadOnFocus variant for from-addresses / from-numbers).

### Merge-field resolver (V1 grammar)

`server/services/mergeFieldResolverPure.ts`. Strict — no fallback syntax, no conditionals. Five namespaces: `contact`, `subaccount`, `signals`, `org`, `agency`. Unknown tokens stay as literals AND surface in `unresolved: string[]` for the editor to highlight. Malformed grammar (unmatched `{{`, empty `{{}}`) throws.

The I/O wrapper (`mergeFieldResolver.ts`) loads namespace inputs from canonical tables + the latest snapshot. HTTP preview at `POST /api/clientpulse/merge-fields/preview`.

### Scenario detector — `proposeClientPulseInterventionsJob`

Event-driven. Enqueued from the tail of `executeComputeChurnRisk` per sub-account on queue `clientpulse:propose-interventions`. Per tick:

1. Load latest churn assessment + health snapshot for `(orgId, subaccountId)`.
2. Load intervention templates from `operational_config.interventionTemplates[]` (cached per org across the loop).
3. Build cooldown state by scope (deterministic — separate query per `executed` / `proposed` / `any_outcome` semantic; no shared `.limit(1)` ambiguity).
4. Build quota state — count Phase-4 actions in the rolling 24h window per subaccount + per org.
5. Delegate to `proposeClientPulseInterventionsPure()` for the matcher (band-targeting → cooldown → priority → quota).
6. For each returned proposal: `enqueueInterventionProposal()` writes the `actions` row + creates the matching `review_items` row.

### Outcome measurement — `measureInterventionOutcomeJob` (B2)

Hourly cron (`7 * * * *`) on queue `clientpulse:measure-outcomes`. Selects Phase-4 intervention actions with `status IN ('completed','failed')`, `executed_at` between 1h and 14d ago, no existing `intervention_outcomes` row. Honours per-template `measurementWindowHours` (default 24).

Pure decision logic in `measureInterventionOutcomeJobPure.ts` — `decideOutcomeMeasurement()` returns `'measure' | 'too_early' | 'no_post_snapshot'`. The B2 ship-gate fixture exercises the synthetic `atRisk → watch` band-change path end-to-end.

`interventionService.recordOutcome()` writes the row including `bandBefore` / `bandAfter` / `bandChanged` / `executionFailed` (failed executions still get an outcome row so cooldown logic respects them).

### Idempotency — three layers, aligned

| Layer | Mechanism | Catches |
|-------|-----------|---------|
| App | Deterministic key derivation (scenario / operator) | Caller-side dedup: same logical intent → same key |
| Service | `actionService.proposeAction` SELECT-then-INSERT | Read-side dedup against existing rows |
| DB | `actions_idempotency_idx` UNIQUE(subaccount_id, idempotency_key) + `actions_org_idempotency_idx` partial unique for org-scoped + `actions_intervention_cooldown_day_idx` partial unique on (org, sub, templateSlug, day) | Write-side race protection — concurrent workers can't both succeed |

Sensitive-path config writes additionally catch Postgres 23505 from `actionService.proposeAction` and re-look-up the existing row (because `actionService` itself doesn't yet wrap its insert in ON CONFLICT for the org-scope path).

### Canonical JSON (idempotency + drift)

Both the action-idempotency hash (`hashActionArgs`) and the Session-2 validation digest (`computeValidationDigest`) feed a single `canonicaliseJson` walker in `actionService.ts` so two logically-identical payloads always produce the same bytes regardless of JS surface accidents.

Rules:

1. **Recursive key sort.** Object keys are sorted alphabetically at every depth, not just the top level. This closed a latent bug where `JSON.stringify(x, Object.keys(x).sort())` — whose 2nd arg is an allowlist applied at every depth — was silently dropping nested keys.
2. **Array order preserved.** Arrays are positional; order matters (e.g. `channels: ['in_app', 'email']` vs `['email', 'in_app']` are distinct by design).
3. **`undefined` omitted; `null` distinct.** Object properties with `undefined` are filtered out before emit, matching `JSON.stringify`'s default behaviour. This closes the present-vs-absent trap where `{ x: 1 }` and `{ x: 1, y: undefined }` would otherwise hash differently for the same logical intent. Explicit `null` stays distinct because null is semantically meaningful ("explicitly unset"), whereas undefined-vs-absent is a JS surface accident.

Pinned by `actionServiceCanonicalisationPure.test.ts` (9 cases). Any future changes to the canonicaliser must keep the present-vs-absent collapse + null-distinction + array-positional semantics.

### Retry vs replay boundary

Pinned contract (documented inline on `buildActionIdempotencyKey`):

- **Retry** (same logical attempt) → same `runId` + `toolCallId` + `args` → **same key**. Existing `actions` row reused; `markFailed` bumps `retry_count`; no new row inserted.
- **Replay** (new attempt after a terminal failure) → new `runId` or new `toolCallId` → **new key**. New `actions` row inserted with `replay_of_action_id` set to the original row. Migration 0185 (ClientPulse Session 2) added the column; the runtime that writes it lands in a future session.

Anyone touching the key derivation later must preserve this distinction. Collapsing them (e.g. deriving from payload only, ignoring `runId`) would break both retry-idempotency (re-runs would bypass the dedup row) and replay auditability (a replay would silently clobber the original row).

### Lifecycle event

Every proposal — created or deduped — emits one structured log:

```
clientpulse.intervention.enqueued
  { orgId, subaccountId, actionType, source, idempotencyKey,
    outcome: 'created' | 'deduped', actionId, churnAssessmentId, templateSlug }
```

Single debugging anchor + analytics base. All previous per-path `*_deduped` events were collapsed into this.

### Configuration Assistant extension (Phase 4.5 — closes B3 + B5)

Adds tool #29: `config_update_hierarchy_template`. The skill applies a single dot-path patch to a hierarchy template's `operational_config`. Validation order:

1. **Path allow-list** — `isValidConfigPath()` rejects unknown root keys (typo guard; `operationalConfigSchema` uses `passthrough()` so unknown roots would otherwise validate).
2. **Schema-validate the merged proposed config** — catches sum-constraint violations (e.g. `healthScoreFactors` weights ≠ 1.00).
3. **Classify the path** via `isSensitiveConfigPath()`:
   - **Non-sensitive** → direct merge into `hierarchy_templates.operational_config` + `config_history` row written in the same transaction (B3).
   - **Sensitive** → insert `actions` row with `gateLevel='review'`, status `proposed`, `metadataJson.validationDigest` snapshot (B5). Approval-execute handler re-validates against current config (drift check) before committing.

The `validationDigest` is a stable hash of the proposed full config; if the live config drifts between proposal and approval, the action transitions to `failed` with `errorCode='DRIFT_DETECTED'` and the operator must re-propose.

### Routes

| Route | Owner | Purpose |
|-------|-------|---------|
| `GET /api/clientpulse/subaccounts/:id/intervention-context` | `clientPulseInterventionContextService.buildInterventionContext` | Modal context payload (band, score, top-signals, recent interventions, cooldown, recommendedActionType) |
| `POST /api/clientpulse/subaccounts/:id/interventions/propose` | `clientPulseInterventionContextService.createOperatorProposal` | Operator submit from §10.D editors |
| `POST /api/clientpulse/merge-fields/preview` | `mergeFieldResolver.previewMergeFields` | Editor live preview |
| `POST /api/clientpulse/config/apply` | `configUpdateHierarchyTemplateService.applyHierarchyTemplateConfigUpdate` | Configuration Assistant chat popup confirm path |

All routes use `resolveSubaccount(subaccountId, orgId)` + `authenticate` + (config route additionally) `requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT)`.

### Migrations

| # | Purpose |
|---|---------|
| 0178 | Indexes on `actions.metadata_json->>'triggerTemplateSlug'` for proposer queries; partial composite index for the outcome-measurement query; partial unique index on `(organisation_id, idempotency_key)` for org-scoped actions; `intervention_outcomes` extended with `band_before` / `band_after` / `band_changed` / `execution_failed` |
| 0179 | Defensive partial unique index on `(org, subaccount, triggerTemplateSlug, date_trunc('day', created_at))` — DB-level safety net so future code paths can't bypass the daily cooldown invariant |

### Files

| Path | Purpose |
|------|---------|
| `server/skills/crm{Fire,SendEmail,SendSms,CreateTask}*ServicePure.ts` + `clientPulseOperatorAlertServicePure.ts` | 5 primitive payload-shapers |
| `server/services/mergeFieldResolverPure.ts` + `mergeFieldResolver.ts` | V1 grammar + I/O wrapper |
| `server/services/clientPulseInterventionProposerPure.ts` | Pure scenario-detector matcher |
| `server/jobs/proposeClientPulseInterventionsJob.ts` | Event-driven proposer worker |
| `server/jobs/measureInterventionOutcomeJob.ts` + `measureInterventionOutcomeJobPure.ts` | Hourly outcome-measurement (B2) |
| `server/services/clientPulseInterventionContextService.ts` | Single lifecycle entry point — `enqueueInterventionProposal`, `buildInterventionContext`, `createOperatorProposal` |
| `server/services/clientPulseInterventionIdempotencyPure.ts` | Deterministic key derivers + `canonicalStringify` |
| `server/services/interventionActionMetadata.ts` | Typed metadata contract (zod) + `validateInterventionActionMetadata` |
| `server/services/configUpdateHierarchyTemplate{,Pure}.ts` | Configuration Assistant write path (B3 + B5) |
| `server/skills/config_update_hierarchy_template.md` | Skill definition (tool #29) |
| `server/routes/clientpulse{Interventions,MergeFields,Config}.ts` | HTTP boundaries (thin — service layer owns the work) |
| `client/src/components/clientpulse/{ProposeInterventionModal,FireAutomation,EmailAuthoring,SendSms,CreateTask,OperatorAlert}Editor.tsx` | Operator submit UI |
| `client/src/components/clientpulse/ConfigAssistantChatPopup.tsx` | Configuration Assistant chat surface |

---

## Skill Analyzer

System-admin tool for ingesting external skill libraries (upload / paste / GitHub) and merging them into the platform skill catalogue with human review. Produces a per-candidate merge proposal + structured warnings; reviewer approves / rejects / edits; Execute applies approved rows atomically with a pre-mutation backup.

Pipeline stages (`server/jobs/skillAnalyzerJob.ts`):

1. **Parse** — `skillParserService` extracts candidate skills from uploaded zips / pasted JSON / GitHub repos.
2. **Hash** — SHA-256 of normalized content; used for embedding cache and idempotent retries.
3. **Embed** — OpenAI text-embedding-3-large per candidate and per library skill; results cached on `skill_embeddings`.
4. **Compare** — cosine similarity produces a single best-match per candidate; banded into `likely_duplicate` (>0.92) / `ambiguous` (0.60–0.92) / `distinct` (<0.60).
5. **Classify + merge** — Claude Sonnet 4.6 produces classification (DUPLICATE / IMPROVEMENT / PARTIAL_OVERLAP / DISTINCT) and, for overlap classifications, a `proposedMerge` object. See §Rule-based fallback below when the classifier is unavailable.
6. **Validate** — pure post-processing in `skillAnalyzerServicePure.validateMergeOutput` emits structured warnings (scope expansion, invocation-block loss, HITL-gate loss, table-row drops, required-field demotion, capability overlap, name mismatch, output-format loss).
7. **Agent propose** (DISTINCT only) — cosine rank of the candidate against existing system agents; top-K persisted to `agentProposals` with optional Haiku enrichment.
8. **Cluster recommend** — if ≥3 DISTINCT candidates lack a good agent home, Sonnet proposes a new agent and retro-injects a synthetic proposal into each affected result's `agentProposals`.

### v2 bug-fix cycle (migration 0155)

The v2 cycle closed seven correctness holes in the Review + Execute flow. Key additions:

- **Canonical approval evaluator.** `skillAnalyzerServicePure.evaluateApprovalState(warnings, resolutions, tierMap)` is the single source of truth for whether a result can be approved. Server is authoritative; `client/src/components/skill-analyzer/mergeTypes.ts` mirrors it for optimistic UI preview. The server re-runs the evaluator on both `PATCH /results/:id` (approve) and `POST /execute`.
- **Warning tier system** (config-driven). Tiers are `informational` | `standard` | `decision_required` | `critical`, mapped per warning code via `skill_analyzer_config.warning_tier_map`. Tier dictates the Approve-button gate: structured resolution (per-field accept/restore for demoted required fields; use-library / use-incoming for name mismatch; scope-down / flag-other / accept-overlap for graph collisions); single-click acknowledgment; or critical-phrase typed confirmation.
- **Rule-based fallback merger.** When the LLM classifier is unavailable or returns an invalid proposal, `buildRuleBasedMerge` produces a deterministic merge (library-dominant name for DB slug stability; definition-bearing skill wins schema; H2-section union for instructions). Always emits `CLASSIFIER_FALLBACK` warning + low-confidence banner requiring reviewer acknowledgment. No more `proposedMerge=null` dead rows.
- **Name consistency cascade.** `detectNameMismatch` compares top-level `name`, `definition.name`, and bare-identifier references in description/instructions. When a reviewer resolves via `use_library_name` / `use_incoming_name`, the chosen name cascades atomically into `proposedMergedContent.name`, `definition.name`, and `execution_resolved_name`; Execute reads `execution_resolved_name` as the canonical source to survive drift.
- **Three-phase staged Execute.** `executeApproved` in `server/services/skillAnalyzerService.ts` runs (1) soft-create proposed agents with DB `status='draft'` (idempotent by slug), (2) per-result skill transactions attaching to draft agents, (3) promote agents to `active` whose skills succeeded. Drafts with zero successful attachments persist as `pendingDraftAgents[]` in the response for manual review.
- **Execution lock.** Atomic `UPDATE ... WHERE execution_lock=false` at Execute entry prevents double-runs; released in `finally`. Stale-lock recovery via `POST /jobs/:jobId/execute/unlock` (systemAdmin only) gated by `execution_lock_stale_seconds`. Auto-unlock is config-flagged and default-off to avoid zombie-process double-execution.
- **Config snapshot isolation.** `jobs.config_snapshot` captures the full `skill_analyzer_config` row at job start; validator, collision detector, and Execute all read the snapshot. Mid-job config changes never apply to in-flight jobs.
- **Approval freeze + drift detection.** `approved_at` locks a result against merge/resolution edits (409 RESULT_LOCKED); reviewer must unapprove (`action=null`) to edit. `approval_decision_snapshot` + `approval_hash` are captured at approve time; Execute compares the live evaluator result against `approval_hash` and emits a non-blocking `skill_analyzer.approval_drift_detected` log when they differ.
- **Resolution invalidation on merge edit.** Any write to `proposedMergedContent` (`PATCH /merge`, `POST /merge/reset`) atomically wipes `warning_resolutions`, `execution_resolved_name`, `approved_at`, `approval_decision_snapshot`, and `approval_hash`. Response carries `resolutionsCleared: true` so the UI can surface a "Review decisions reset" toast.
- **Concurrency on resolve-warning.** `PATCH /resolve-warning` strictly requires `If-Unmodified-Since`; server derives the canonical row timestamp as `mergeUpdatedAt ?? createdAt` and rejects mismatches > ±2s (`409 STALE_RESOLVE`). Verified by pure tests in `skillAnalyzerServicePureFallbackAndTables.test.ts`.
- **Proposed-new-agent coupling.** Cluster recommendations write to `skill_analyzer_jobs.proposed_new_agents` (array, supports N-per-job) AND retro-inject synthetic entries into each affected DISTINCT result's `agentProposals`. UI banner renders per-agent Confirm/Reject; confirmed proposals become the top-ranked chip in per-skill assignment panels.
- **Table drop remediation.** `remediateTables` runs before `validateMergeOutput` and auto-appends missing rows with `[SOURCE: library|incoming]` markers. Guards: column-count mismatch, cross-source first-column-key conflict, pre-marked rows, and `max_table_growth_ratio` aggregate cap.
- **Skill-graph collision detection.** `detectSkillGraphCollision` splits merged instructions into `##` heading fragments, pre-filters library skills by bigram overlap (top-K + 200-pair budget), and emits `SKILL_GRAPH_COLLISION` warnings when fragment similarity exceeds `collision_detection_threshold`.

### Revert previous execution

Every successful Execute writes a pre-mutation `config_backups` row (`scope: 'skill_analyzer'`) containing the full pre-Execute state of every affected skill and system agent. The Skill Analyzer Results step (and the Execute step when reopening a finished job) surfaces a **Revert previous execution** button whenever an `active` backup exists for the job. Clicking it dry-runs the restore, shows the four counts in a confirmation dialog, then runs the real restore on confirm.

Backup entity shapes emitted by `configBackupService.captureSkillAnalyzerEntities`:

| Entity type | Payload |
|-------------|---------|
| `system_skill` | Full skill snapshot for every skill that existed before Execute |
| `system_agent` | Full mutable-field snapshot per affected system agent: `defaultSystemSkillSlugs`, `status`, `name`, `description`, `masterPrompt`, `agentRole`, `agentTitle`, `parentSystemAgentId` |

`restoreSkillAnalyzerEntities` interprets the snapshot as follows:

- **Skills** — rows present in the backup are replayed onto `system_skills` (counted as `skillsReverted`); rows absent from the backup but present live are deactivated via `isActive = false` rather than hard-deleted (counted as `skillsDeactivated`).
- **Agents** — each `system_agent` entity is replayed in full onto `system_agents` (counted as `agentsReverted`). Agents present live but absent from the backup (i.e. created by the Execute that is now being reverted) are soft-deleted via `deletedAt = now()` — **not** via `status` (counted as `agentsSoftDeleted`). Soft-delete preserves the row for audit and is reversible; hard-delete would orphan history and config-backup references.

**Legacy back-compat.** Backups written before this extension used a `system_agent_skills` entity type carrying only `defaultSystemSkillSlugs`. The restore path still accepts those entities and replays the slug array, but the post-backup soft-delete step is skipped for legacy-shape backups (there is no way to know which live agents existed at backup time from a slug-only payload). `agentsSoftDeleted` will be `0` for any legacy-shape restore.

**Dry-run route.** `POST /api/system/skill-analyser/jobs/:jobId/restore?dryRun=true` calls `configBackupService.describeRestore` instead of `restoreBackup` and returns the same `{ skillsReverted, skillsDeactivated, agentsReverted, agentsSoftDeleted }` counters without mutating anything. Strict string comparison — only the literal `'true'` triggers dry-run mode; any other value (including `'1'`, `'yes'`, missing) runs the real restore.

### Schema (migration 0155)

| Table / column | Purpose |
|----------------|---------|
| `skill_analyzer_config` (new singleton, key='default') | Admin-tunable thresholds: `classifier_fallback_confidence_score`, `scope_expansion_standard_threshold`, `scope_expansion_critical_threshold`, `collision_detection_threshold`, `collision_max_candidates`, `max_table_growth_ratio`, `execution_lock_stale_seconds`, `execution_auto_unlock_enabled`, `critical_warning_confirmation_phrase`, `warning_tier_map`. Bumps `config_version` on every update. |
| `skill_analyzer_results.warning_resolutions` | JSONB array of reviewer decisions, deduped by `(warningCode, details.field)`. Wiped on merge edit. |
| `skill_analyzer_results.classifier_fallback_applied` | True when rule-based merger produced the proposal. |
| `skill_analyzer_results.execution_resolved_name` | Canonical name chosen via NAME_MISMATCH resolution; authoritative at Execute. |
| `skill_analyzer_results.approved_at` | Lock timestamp; presence blocks merge/resolution edits. |
| `skill_analyzer_results.approval_decision_snapshot` + `approval_hash` | Debug trace + drift-detection at Execute. |
| `skill_analyzer_results.was_approved_before` | UI surfaces "modified after previous approval" badge. |
| `skill_analyzer_jobs.proposed_new_agents` | JSONB array supporting N proposed-agent entries per job, with `status` lifecycle. |
| `skill_analyzer_jobs.config_snapshot` + `config_version_used` | Frozen config at job start; immutable post-INSERT. |
| `skill_analyzer_jobs.execution_lock` + `execution_started_at` + `execution_finished_at` | Atomic concurrency guard for Execute. |

### Config validation rules

`skillAnalyzerConfigService.updateConfig` enforces:
- Ratio/probability fields (`classifier_fallback_confidence_score`, scope-expansion thresholds, `collision_detection_threshold`) in `[0, 1]`.
- `max_table_growth_ratio` in `[1, 10]`.
- `collision_max_candidates` ∈ positive integer; `execution_lock_stale_seconds` same.
- `critical_warning_confirmation_phrase` ≥ 3 characters.
- Cross-field invariant: `scope_expansion_standard_threshold < scope_expansion_critical_threshold` with `MIN_THRESHOLD_DELTA = 0.05` gap to prevent degenerate collapses.
- Every successful update emits `skill_analyzer_config_updated` structured log with `{ changedFields, before, after, configVersion }`.

### Files

| File | Role |
|------|------|
| `migrations/0155_skill_analyzer_v2_fixes.sql` | Schema additions + singleton seed |
| `server/db/schema/skillAnalyzerConfig.ts` | Drizzle schema for the config singleton |
| `server/db/schema/skillAnalyzerJobs.ts` | Jobs table (+ v2 columns) |
| `server/db/schema/skillAnalyzerResults.ts` | Results table (+ v2 columns) |
| `server/services/skillAnalyzerServicePure.ts` | Pure logic — `evaluateApprovalState`, `buildRuleBasedMerge`, `detectNameMismatch`, `remediateTables`, `detectSkillGraphCollision`, `sortWarningsBySeverity`, `checkConcurrencyStamp`, warning codes, tier map, validator |
| `server/services/skillAnalyzerService.ts` | Stateful — `createJob`, `getJob`, `setResultAction`, `patchMergeFields`, `resetMergeToOriginal`, `resolveWarning`, `updateProposedAgent`, `executeApproved` (3-phase staged pipeline) |
| `server/services/skillAnalyzerConfigService.ts` | Singleton config reader/updater with 30s in-memory cache + diff logging |
| `server/routes/skillAnalyzer.ts` | REST surface: jobs / results / merge / resolve-warning / proposed-agents / config |
| `server/jobs/skillAnalyzerJob.ts` | 8-stage pipeline handler |
| `client/src/components/skill-analyzer/MergeReviewBlock.tsx` | Three-column merge view + `WarningResolutionBlock` with per-warning resolution controls |
| `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx` | Review screen, `AgentChipBlock`, `ProposedAgentBanner` with Confirm/Reject |
| `client/src/components/skill-analyzer/mergeTypes.ts` | Browser-safe mirror of the approval evaluator + warning types |

### Tests

Pure tests live in `server/services/__tests__/skillAnalyzerServicePure*.test.ts` — runnable via `npx tsx <path>`. v2 cycle coverage is in `skillAnalyzerServicePureFallbackAndTables.test.ts` (fallback merger, table remediation with row-conflict / growth-cap guards, name-mismatch detection, collision detection, approval evaluator, concurrency guard). All 115 tests pass.

---

## Playbooks (Multi-Step Automation)

Playbooks automate longer-form, multi-step processes (e.g. "create a new event" — 15 steps producing landing page copy, email templates, social posts, etc.) as a reusable, versioned, distributable template. A Playbook is a **DAG of steps** — each step is a prompt, an agent call, a user-input form, an approval gate, or a conditional — executed against a subaccount with a growing shared context.

### Terminology

| Term | Meaning |
|------|---------|
| **DAG** | Directed Acyclic Graph. Steps declare `dependsOn` on earlier step ids. Engine topologically sorts and runs independent branches in parallel. No cycles permitted. |
| **Playbook Template** | The definition — steps, dependencies, prompts, schemas. Versioned and immutable once published. |
| **Playbook Version** | A frozen snapshot of a template. Runs lock to the version they started with. |
| **Playbook Run** | An execution instance against a specific subaccount. Has its own growing context blob. |
| **Step Run** | Execution record for a single step within a run. Has own status, inputs, outputs, and (optionally) a linked `agentRun`. |
| **Run Context** | A single growing JSON blob keyed by step id. Steps reference prior outputs via templating (`{{ steps.event_basics.output.eventName }}`). |

### Three-tier distribution model

Mirrors the three-tier agent model:

```
System Playbook Template (systemPlaybookTemplates)
  — Platform-shipped; read-only master definition
  — Versioned; new versions trigger opt-in upgrades for forked orgs
        ↓ fork / clone
Org Playbook Template (playbookTemplates)
  — Org-authored OR forked from system template (forkedFromSystemId, forkedVersion)
  — Org owns the definition; editable by permission holders
  — Immutable versions (playbookTemplateVersions) — publish increments version
        ↓ execute against a subaccount
Playbook Run (playbookRuns)
  — Scoped to a single subaccount
  — Locked to a specific playbookTemplateVersionId
  — Survives template edits in flight
```

**Playbooks are authored at the org tier, executed at the subaccount tier.** Subaccounts never own template definitions — this avoids template drift across subaccounts. If a subaccount needs a variant, fork the template at org level and tag applicability.

### Schema (migration 0076)

| Table | Purpose |
|-------|---------|
| `systemPlaybookTemplates` | Platform-shipped templates. Mirrors `systemAgents`. |
| `systemPlaybookTemplateVersions` | Immutable version snapshots of system templates. |
| `playbookTemplates` | Org-owned templates. `forkedFromSystemId`, `forkedFromVersion` nullable. |
| `playbookTemplateVersions` | Immutable published versions of org templates. `definitionJson` holds the full DAG. |
| `playbookRuns` | Run instances. `subaccountId` (nullable since migration 0171), `templateVersionId`, `status`, `contextJson`, `startedBy`, `startedAt`, `completedAt`, `scope` (`subaccount` \| `org`). CHECK constraint enforces scope/entity consistency: `subaccount` scope requires `subaccount_id`; `org` scope requires `subaccount_id IS NULL`. |
| `playbookStepRuns` | Per-step execution records. `runId`, `stepId`, `status`, `inputJson`, `outputJson`, `agentRunId` (nullable link), `dependsOn[]`, `startedAt`, `completedAt`, `error`. |
| `playbookStepReviews` | Human approval gate records for steps with `humanReviewRequired: true`. Links to `reviewItems`. |
| `portalBriefs` | Published outputs surfaced on the sub-account portal card. Upserted by `config_publish_playbook_output_to_portal` on each run. Unique per `run_id`. Columns: `id`, `organisation_id`, `subaccount_id`, `run_id`, `playbook_slug`, `title`, `bullets text[]`, `detail_markdown`, `is_portal_visible`, `published_at`, `retracted_at`. (Migration 0123.) |
| `subaccountOnboardingState` | Completion tracking per `(subaccount_id, playbook_slug)` for onboarding runs. Upserted on every terminal transition by the engine via `upsertSubaccountOnboardingState`. Status values: `in_progress`, `completed`, `failed`. Columns: `id`, `organisation_id`, `subaccount_id`, `playbook_slug`, `status`, `last_run_id`, `started_at`, `completed_at`. Unique on `(subaccount_id, playbook_slug)`. (Migration 0124.) |

Soft deletes on templates (`deletedAt`). Runs are append-only history.

`modules.onboarding_playbook_slugs` (`text[]`, added migration 0122) lists playbook slugs that should be started or offered during sub-account onboarding for any sub-account whose org holds an active subscription to that module. The union of slugs across all active modules drives the Onboarding tab. `subaccountOnboardingService.autoStartOwedOnboardingPlaybooks()` is called fire-and-forget on sub-account creation.

### Step definition shape (stored in `definitionJson`)

```typescript
interface PlaybookStep {
  id: string;                    // stable within template version
  name: string;
  type: 'prompt' | 'agent_call' | 'action_call' | 'user_input' | 'approval' | 'conditional' | 'agent_decision';
  dependsOn: string[];           // ids of prior steps
  sideEffectType: 'none' | 'idempotent' | 'reversible' | 'irreversible'; // mandatory on all steps
  humanReviewRequired?: boolean; // pause for edit/approve before downstream consumes output
  outputSchema: JSONSchema;      // zod-validated; downstream steps rely on shape
  retryPolicy?: { maxAttempts: number };

  // type: prompt / agent_call
  prompt?: string;                               // prompt with {{ templating }}
  model?: string;                                // optional model override for type: prompt
  agentRef?: { kind: 'system' | 'org'; slug: string }; // for type: agent_call
  agentInputs?: Record<string, string>;          // map of paramName -> template expression

  // type: action_call — invokes a skill handler from the actionCallAllowlist
  actionSlug?: string;                           // must be in ACTION_CALL_ALLOWED_SLUGS
  actionInputs?: Record<string, string>;         // template expressions resolved against run context
  idempotencyScope?: 'run' | 'entity';           // 'entity' required for singleton-resource actions
  entityKey?: string;                            // stable key for entity-scoped idempotency

  // type: user_input
  formSchema?: JSONSchema;                       // renders as form in UI
  condition?: string;                            // for type: conditional — JSONLogic expression

  // type: agent_decision
  decisionPrompt?: string;                       // the question the agent must answer (templated)
  branches?: AgentDecisionBranch[];              // 2–8 predeclared branches; agent picks one
  defaultBranchId?: string;                      // fallback branch if all retries are exhausted
  minConfidence?: number;                        // [0,1] threshold; below this → HITL escalation
}

interface PlaybookDefinition {
  slug: string;
  name: string;
  version: number;
  steps: PlaybookStep[];
  initialInputSchema: JSONSchema;   // what the user provides when kicking off the run

  // Onboarding-playbooks spec (§10–§11)
  autoStartOnOnboarding?: boolean;  // engine auto-starts this playbook in supervised mode for new sub-accounts
  portalPresentation?: {            // drives the §9.4 portal card
    cardTitle: string;
    headlineStepId: string;         // step whose output provides the card headline
    headlineOutputPath: string;     // dot-path into that step's outputSchema
    detailRoute?: string;           // optional deep-link; run modal is the fallback
  };
  knowledgeBindings?: Array<{       // write step output back to Workspace Memory on completion
    stepId: string;
    outputPath: string;             // dot-path into the step's outputSchema
    blockLabel: string;             // Memory Block label (1–80 chars)
    mergeStrategy: 'replace' | 'merge' | 'append';
    firstRunOnly?: boolean;         // only write on the first successful run per subaccount+slug
  }>;
}
```

### Side-effect classification (mandatory)

Every step declares a `sideEffectType`: `none` | `idempotent` | `reversible` | `irreversible`. This drives mid-run editing safety — `none`/`idempotent` re-run automatically, `reversible` requires confirmation, `irreversible` is **default-blocked** with a "skip and reuse previous output" option. Snapshotted to `playbook_step_runs.side_effect_type` so it can't drift after the run starts.

### `agent_decision` step type

An `agent_decision` step lets an agent pick between predeclared downstream branches in the playbook DAG. It is the branching primitive for conditional multi-path playbooks.

**Key properties:**
- `branches` — array of 2–8 `AgentDecisionBranch` objects (`id`, `label`, `description`, `entrySteps`). Each `entrySteps` list names the first step(s) that belong to that branch; they must declare `dependsOn: [decisionStepId]`.
- `decisionPrompt` — the templated question the agent answers. Rendered against run context before dispatch.
- `defaultBranchId` — optional fallback branch when the agent exhausts retries. If absent, exhausted retries fail the step.
- `minConfidence` — optional `[0,1]` threshold. When the agent returns a `confidence` value below this, the decision is escalated to HITL rather than applied automatically.

**Dispatch flow:**
1. Engine renders a *decision envelope* (via `renderAgentDecisionEnvelope()`) — a structured system prompt addendum that describes the decision, lists the branches, and includes the JSON output schema the agent must return.
2. An `agentRun` is created with `systemPromptAddendum = envelope` and `allowedToolSlugs = []` (tool-free; agents read only the context already in the conversation).
3. `agent_decision` always has `sideEffectType: 'none'`. Irreversible side effects are never valid.

**Completion flow (handled by `handleDecisionStepCompletion`):**
1. Parse agent output as `{ chosenBranchId, rationale, confidence? }` via `parseDecisionOutput()`.
2. On parse failure: retry up to `MAX_DECISION_RETRIES` (3) times with a retry envelope that includes the prior-attempt error and raw output wrapped in a code fence (security: `spec §22.3`).
3. On success: call `computeSkipSet(def, stepId, chosenBranchId)` → the set of non-chosen branch steps to skip.
4. Single DB transaction: mark step completed, insert `skipped` rows for the skip set, update run context.

**Skip set algorithm (`computeSkipSet`)** — O(V+E) forward BFS:
- Seed set: entry steps of all non-chosen branches.
- A step is added to the skip set only if it has no live (chosen-branch) ancestor — the "live ancestor short-circuit" keeps convergence steps alive.
- Convergence steps (depending on multiple branches) remain `pending` and run normally once the chosen-branch steps complete.

**Pure module:** `server/lib/playbook/agentDecisionPure.ts` is the single source of truth for all decision logic. It is synchronous, deterministic, and side-effect-free. The engine delegates; it never re-implements.

### Parameterization (Phase 1.5, column reserved in Phase 1)

`playbook_templates.params_json` exists from migration 0042 but stays empty in Phase 1. Phase 1.5 introduces a layered distribution model: orgs configure system templates via parameters (`paramsSchema` declared on the definition) instead of forking, so they auto-upgrade when the platform ships new template versions. Forking is reserved as an escape hatch.

### Execution engine

`playbookEngineService` is a state machine. Each run progresses through:

```
pending → running → (awaiting_input | awaiting_approval) → running → completed
                                                                    ↘ failed | cancelled
```

**Per-tick algorithm (triggered by pg-boss job `playbook-run-tick`):**

1. Load run + all step runs.
2. Compute ready set: steps whose `dependsOn` are all `completed` and whose own status is `pending`.
3. For each ready step, resolve its `inputs` by templating against `run.contextJson`.
4. Dispatch in parallel:
   - `prompt` / `agent_call` → enqueue an `agentRun` (reuses existing agent infrastructure, idempotency keys, budget reservations); step run links via `agentRunId`.
   - `user_input` → set status `awaiting_input`, emit WebSocket event to inbox.
   - `approval` → create `reviewItem`, set status `awaiting_approval`.
   - `conditional` → evaluate JSONLogic synchronously, write output, mark `completed`.
   - `agent_decision` → enqueue an `agentRun` with `systemPromptAddendum` (decision envelope) and empty `allowedToolSlugs`. On completion, parse `chosenBranchId`, compute skip set via `computeSkipSet()`, atomically mark chosen-branch steps pending and non-chosen-branch steps `skipped`.
5. On any step completion (webhook from agent run, form submission, approval decision), validate output against `outputSchema`, merge into `run.contextJson`, re-enqueue a tick.
6. Materialise pending step run rows for newly-unblocked steps (deps all terminal) at the start of every tick. Transitively-skipped steps get a `skipped` row directly.
7. If all steps `completed` or `skipped`, mark run `completed`. If any non-retryable failure and no alternative branch, mark `failed`.

**Parallelism is free** — multiple ready steps dispatch simultaneously. Linear runs are just DAGs where every step depends on its predecessor.

**Resumability** — all state lives in the DB. Engine can crash and resume on next tick with no loss.

**Editing mid-run** — when a user edits a completed step's output, engine computes the transitive downstream set, blocks on `irreversible` and `reversible` step types pending user confirmation, then invalidates and re-runs the safe set. **Output-hash firewall:** if a re-executed step produces a byte-identical output to the previous attempt, invalidation stops propagating — prevents cost explosions when an "edit" is actually a no-op save. In-flight downstream steps receive an `AbortController` cancel signal.

### Concurrency: defense in depth

Three layers, all required:

1. **Queue deduplication** — every tick job uses pg-boss `singletonKey: runId` + `useSingletonQueue: true`. Ten parallel step completions collapse to one tick job in the queue, before any handler runs.
2. **Non-blocking advisory lock** — tick handler runs `pg_try_advisory_xact_lock(hashtext('playbook-run:' || runId)::bigint)`. If contended, handler exits silently — never block waiting for the lock (would exhaust the connection pool).
3. **Optimistic state guards** — step run status transitions check a `version` column to catch the rare case where two handlers both pass the lock.

### Watchdog sweep

`playbook-watchdog` cron job runs every 60 seconds. Finds runs whose dependencies are met but have no pending tick (catches the "step completed but tick enqueue failed" race) and re-enqueues. Also fails step runs that exceed their `expireInSeconds` timeout. Self-healing safety net.

### Reuse of existing systems

- **Agent runs** — `agent_call` step type creates an `agentRun` with `playbookStepRunId` set (new column on `agentRuns` added alongside migration 0076). The full three-tier agent model, skill system, handoff, and budget tracking are reused unchanged. The `prompt` step type uses the same dispatch path (unified via `agent_call/prompt dispatch` in deferred #1) — a `prompt` step is a zero-skill agent call against the org's default model.
- **Input-hash reuse** — dispatch derives an input hash per step from `(stepId, resolvedInputs)`. If a previous step run in the same run (or a prior run under the same `idempotencyKey` scope) has a matching hash and a valid output, the engine reuses the output instead of dispatching. (Deferred #1.)
- **Review queue** — `approval` step type creates a `reviewItem`. HITL flow is unchanged.
- **pg-boss** — engine ticks are jobs on the `playbook-run-tick` queue. Same infrastructure as heartbeats. Job config lives in `server/config/jobConfig.ts`.
- **Idempotency keys** — step-level agent runs use `playbook:{runId}:{stepId}:{attempt}` as the key.
- **WebSocket rooms** — run updates broadcast on the subaccount room; a dedicated `playbook-run:{runId}` room streams per-step progress to detail UI. Emitters live in `server/websocket/emitters.ts` and `server/websocket/rooms.ts`; events cover step dispatch, step completion, approval state changes, form-input requests, and run-level state transitions. (Deferred #4.)
- **Audit events** — run start, step completion, edits, approvals, template publish all emit audit events.

### Routes

| Route | File | Purpose |
|-------|------|---------|
| `/api/system/playbook-templates` | `playbookTemplates.ts` | System admin: list/read platform templates + versions |
| `/api/system/playbook-templates/:slug` | `playbookTemplates.ts` | System admin: read a single platform template |
| `/api/system/playbook-templates/:slug/versions` | `playbookTemplates.ts` | System admin: list versions for a platform template |
| `/api/playbook-templates` | `playbookTemplates.ts` | Org: list templates (authored + forked) |
| `/api/playbook-templates/:id` | `playbookTemplates.ts` | Org: read/delete a template |
| `/api/playbook-templates/:id/versions` | `playbookTemplates.ts` | Org: list/get versions |
| `/api/playbook-templates/fork-system` | `playbookTemplates.ts` | Org: fork a system template into the org |
| `/api/playbook-templates/:id/publish` | `playbookTemplates.ts` | Org: publish a new immutable version |
| `/api/subaccounts/:subaccountId/playbook-runs` | `playbookRuns.ts` | List / start runs for a subaccount |
| `/api/playbook-runs/:runId` | `playbookRuns.ts` | Run detail, context, step runs |
| `/api/playbook-runs/:runId/cancel` | `playbookRuns.ts` | Cancel an in-flight run |
| `/api/playbook-runs/:runId/replay` | `playbookRuns.ts` | Replay-mode rerun (hard external block — see deferred #3) |
| `/api/playbook-runs/:runId/steps/:stepRunId/input` | `playbookRuns.ts` | Submit form input for `user_input` step |
| `/api/playbook-runs/:runId/steps/:stepRunId/output` | `playbookRuns.ts` | Edit a completed step's output (invalidates downstream) |
| `/api/playbook-runs/:runId/steps/:stepRunId/approve` | `playbookRuns.ts` | Approve/reject an `approval` step |
| `/api/system/playbook-studio/sessions` | `playbookStudio.ts` | System admin chat authoring: list/create/read sessions |
| `/api/system/playbook-studio/sessions/:id` | `playbookStudio.ts` | Update chat-session candidate file contents |
| `/api/system/playbook-studio/sessions/:id/save-and-open-pr` | `playbookStudio.ts` | Trust-boundary: validate + render + commit + open PR (server is the only producer of the file body) |
| `/api/system/playbook-studio/playbooks` | `playbookStudio.ts` | List on-disk `server/playbooks/*.playbook.ts` slugs |
| `/api/system/playbook-studio/playbooks/:slug` | `playbookStudio.ts` | Read a specific on-disk playbook file |
| `/api/system/playbook-studio/validate` | `playbookStudio.ts` | `validate_candidate` tool — returns canonical `definitionHash` on success |
| `/api/system/playbook-studio/simulate` | `playbookStudio.ts` | `simulate_run` tool — dry-run side-effect classification |
| `/api/system/playbook-studio/estimate` | `playbookStudio.ts` | `estimate_cost` tool — optimistic/pessimistic cost bounds |
| `/api/system/playbook-studio/render` | `playbookStudio.ts` | Deterministic file preview — what the save endpoint would commit |
| `/api/subaccounts/:subaccountId/onboarding/owed` | `subaccountOnboarding.ts` | List playbooks owed by this sub-account's active modules (with latest run status) |
| `/api/subaccounts/:subaccountId/onboarding/start` | `subaccountOnboarding.ts` | Start a specific owed onboarding playbook (idempotent — returns existing run if already active) |
| `/api/portal/:subaccountId/playbook-runs` | `portal.ts` | List portal-visible playbook runs for the sub-account portal card |
| `/api/portal/:subaccountId/playbook-runs/:runId/run-now` | `portal.ts` | Start a fresh run of the same template (portal-visible), requires `PLAYBOOK_RUNS_START` |

All routes follow the standard conventions: `asyncHandler`, `authenticate`, `resolveSubaccount` where applicable, org scoping via `req.orgId`, no direct `db` access, service errors as `{ statusCode, message, errorCode }`.

### Services

| Service | Responsibility |
|---------|---------------|
| `playbookTemplateService` | CRUD, fork from system, version publishing, validation of DAG (no cycles, all deps resolvable, output schemas valid) |
| `playbookEngineService` | State machine ticks, step dispatch, context merging, downstream invalidation, mid-run edit cascade with output-hash firewall |
| `playbookRunService` | Run lifecycle — start, cancel, replay, query, surface to UI |
| `playbookAgentRunHook` | Post-run hook that bridges `agent_call` step completion back into the engine tick |
| `playbookStudioService` | Chat authoring back-end: sessions, `validate`/`simulate`/`estimate`/`render` tools, `saveAndOpenPr` trust boundary |
| `playbookStudioGithub` | Real GitHub PR creation path used by `saveAndOpenPr` (deferred #5) |
| `subaccountOnboardingService` | Resolves owed onboarding playbooks for a sub-account (`listOwedOnboardingPlaybooks`, `startOwedOnboardingPlaybook`, `autoStartOwedOnboardingPlaybooks`). Called fire-and-forget from sub-account creation. Idempotent via 23505 unique-violation catch on the partial unique index `(subaccount_id, playbook_slug) WHERE active_statuses`. |

The templating/validator/renderer/hash primitives live under `server/lib/playbook/` (`templating.ts`, `validator.ts`, `renderer.ts`, `canonicalJson.ts`, `hash.ts`, `definePlaybook.ts`) so they can be imported by both the engine and the Studio tools without pulling in service layer state. They are pure and unit-tested (`server/lib/playbook/__tests__/playbook.test.ts`).

### Permissions

New permission keys:

- `playbook_templates.read` / `playbook_templates.write` / `playbook_templates.publish` (org-level)
- `playbook_runs.read` / `playbook_runs.start` / `playbook_runs.cancel` / `playbook_runs.edit_output` / `playbook_runs.approve` (subaccount-level)

Integrate into the existing permission set UI.

### Client UI

**Run execution UI (shipped):**

- `/playbooks` — `PlaybooksLibraryPage` — list of available templates (org + forked from system), "Start Run" picker. Permission-gated on `org.agents.view` OR `org.playbook_templates.read`.
- `/playbook-runs/:runId` — `PlaybookRunDetailPage` — run detail: vertical stepper showing DAG, each step expandable with inputs/output, edit button on completed steps, inline forms for `user_input` steps, approval UI for `approval` steps, live updates via WebSocket (deferred #4).
- "Needs your input" is surfaced through the standard Inbox page — paused playbook runs route through `reviewItems` for approvals and through a dedicated inbox entry for `user_input` steps.

**Playbook Studio (shipped — system-admin chat authoring):**

- `/system/playbook-studio` — `PlaybookStudioPage` — chat-driven authoring experience. Backed by the `playbook-author` system agent (`server/agents/playbook-author/master-prompt.md`) with the five `playbook_*` skills (`playbook_read_existing`, `playbook_validate`, `playbook_simulate`, `playbook_estimate_cost`, `playbook_propose_save`). Read-only file preview is rendered server-side via `/render` — the client never constructs the file body.

**Author agent (deferred #6):** The Playbook Author is a system-managed agent — cannot be edited or deleted at org tier. Seeded via `scripts/seed-playbook-author.ts`. It is the only caller of the Studio tools; org agents do not get access to Studio endpoints (blocked by `requireSystemAdmin`).

**Seeded templates:** Phase 1 ships with `server/playbooks/event-creation.playbook.ts` as the reference system template. `npm run playbooks:validate` runs DAG validation on every seeded file in CI; `npm run playbooks:seed` loads them into `systemPlaybookTemplates`.

### Invariants (non-negotiable)

- DAG validation must run on every template publish — reject cycles, unresolved `dependsOn`, or template expressions referencing nonexistent steps.
- A run is locked to its `templateVersionId`. Editing the template never mutates in-flight runs.
- Step output is validated against `outputSchema` before merging into run context.
- **Every step declares a `sideEffectType`.** No defaults. CI fails if any seeded playbook has a step without one.
- Mid-run editing **never auto-re-executes `irreversible` steps** — user must explicitly opt in per step or choose skip-and-reuse.
- **Output-hash firewall on invalidation** — when a re-executed step produces a byte-identical output (canonical-JSON hash) to the previous attempt, invalidation stops propagating. Prevents cost explosions when an "edit" is a no-op save. (Deferred #2.)
- Templating resolver **must use `Object.create(null)` contexts** and blocklist `__proto__`/`constructor`/`prototype`. Whitelist allowed top-level prefixes (`run.input.`, `run.subaccount.`, `run.org.`, `steps.`).
- Tick jobs **must be enqueued with `singletonKey: runId`** to prevent tick storms.
- Tick handlers **must use the non-blocking advisory lock variant**. Blocking is forbidden.
- Step completion + tick enqueue happen in a single DB transaction; the watchdog is the safety net, not the primary mechanism.
- `agent_call` steps respect the full budget, handoff depth, and policy engine rules — the engine never bypasses existing guardrails.
- **Replay mode is hard-blocked from external side effects.** When a run is started in replay mode, any step with `sideEffectType !== 'none' && sideEffectType !== 'idempotent'` is refused at dispatch — not just warned. (Deferred #3.)
- **Playbook Studio save endpoint is the trust boundary.** The server is the only producer of the `.playbook.ts` file body: the endpoint accepts the validated `definition` object only, and deterministically renders the file via `validateAndRender`. There is no field on the endpoint that a caller can use to inject arbitrary file content. (Deferred #5, PR #87 round 3.)
- **Definition hash is stamped into the committed file** as a `@playbook-definition-hash` magic comment so drift between the `definitionJson` and the file body is detectable post-commit.
- Org scoping applies to templates (`organisationId`) and runs (`organisationId` via subaccount).

---

## Agent Coworker Features

Five features shipped together (spec: `docs/agent-coworker-features-spec.md`) to transform agents from tools into autonomous coworkers. Migrations 0097–0103.

### Activity (Feature 1)

A unified, filter-driven activity table at three scopes (subaccount / org / system), replacing the need to bounce between run history, inbox, review queue, and health findings.

**Service:** `activityService.ts` — fans out to 6 data sources in parallel (`agentRuns`, `reviewItems`, `workspaceHealthFindings`, `actions` (pending approval), `playbookRuns`, `executions`), normalises each to `ActivityItem`, merge-sorts by requested order (default: `attention_first`), paginates. Soft-delete filters on all agent/subaccount joins.

**Routes:** `activity.ts` — 3 endpoints:

| Route | Auth |
|-------|------|
| `GET /api/subaccounts/:subaccountId/activity` | `requireSubaccountPermission(EXECUTIONS_VIEW)` |
| `GET /api/activity` | `requireOrgPermission(EXECUTIONS_VIEW)` |
| `GET /api/system/activity` | `requireSystemAdmin` |

Query params: `type`, `status`, `from`, `to`, `agentId`, `severity`, `assignee`, `q`, `sort`, `limit`, `offset`.

**Frontend:** `ActivityPage.tsx` — filter bar + ColHeader sort/filter table (matches `SystemSkillsPage` pattern). Client-side exclusion-set column filters, 10s polling. Routes: `/admin/activity`, `/system/activity`, `/admin/subaccounts/:subaccountId/activity`.

### Prioritized Work Feed (Feature 2)

A scored, ranked queue of open work items that heartbeat agents consume at run start. No user-facing UI — agents are the sole consumer.

**Schema:** `priority_feed_claims` (migration 0100) — optimistic claim locks with TTL. Unique on `(item_source, item_id)`. Cascade delete from `agent_runs`.

**Service:** `priorityFeedService.ts` (impure) + `priorityFeedServicePure.ts` (pure scoring).

Scoring formula: `score = severity_weight × age_factor × assignment_relevance`
- `severity_weight`: critical=1.0, warning=0.6, info=0.3
- `age_factor`: linear ramp 1.0→2.0 over 7 days, capped
- `assignment_relevance`: 1.0 same subaccount, 0.5 org-wide, 0.1 cross-subaccount

Sources: health findings, pending reviews, open tasks, failed runs, playbook runs awaiting input. Excludes items with active (non-expired) claims.

**Skill:** `read_priority_feed` (`isUniversal: true`). Ops: `list` (scored feed), `claim` (lock item), `release` (unlock). Handler delegates to `priorityFeedService`.

**Job:** `priority-feed-cleanup` — daily pg-boss job at 5am UTC, prunes expired claims.

### Skill Studio (Feature 3)

A chat-driven authoring surface for refining skill definitions and master prompts, backed by regression capture data. Mirrors Playbook Studio.

**Schema:** `skill_versions` (migration 0101) — immutable version history. Each row snapshots the full definition at that version. CHECK constraint ensures exactly one of `system_skill_id` or `skill_id` is set.

**Service:** `skillStudioService.ts` — `listSkillsForStudio()`, `getSkillStudioContext()`, `validateSkillDefinition()`, `simulateSkillVersion()`, `saveSkillVersion()` (atomic: version row + skill row update), `listSkillVersions()`, `rollbackSkillVersion()`.

**Routes:** `skillStudio.ts` — 11 endpoints across system (`/api/system/skill-studio/...`) and org (`/api/admin/skill-studio/...`) scopes. System routes require `requireSystemAdmin`; org routes require `requireOrgPermission('org.agents.view'/'org.agents.edit')`.

**Studio agent skills:** 5 skills (`skill_read_existing`, `skill_read_regressions`, `skill_validate`, `skill_simulate`, `skill_propose_save`) registered in `SKILL_HANDLERS`. These are the tools the `skill-author` system agent uses to read regressions, propose fixes, simulate, and save.

**Frontend:** `SkillStudioPage.tsx` — two-pane layout: left = skill list sorted by regression count, right = definition editor + instructions editor + simulation results + version history with rollback. Routes: `/system/skill-studio`, `/admin/skill-studio`.

### Slack Conversational Surface (Feature 4)

Extends the existing multi-tenant Slack webhook to dispatch inbound messages to agent runs via pg-boss. Adds thread-persistent conversations, @mention routing, and interactive HITL buttons.

**Schema:**
- `slack_conversations` (migration 0102) — maps `(workspace_id, channel_id, thread_ts)` to an agent conversation. Unique index on thread coordinates.
- `users.slack_user_id` (migration 0103) — links Slack user identity to org user for HITL authorization. Partial unique index where not null.

**Service:** `slackConversationService.ts` — `resolveConversation()`, `createConversation()`, `resolveSlackUser()`, `postReviewItemToSlack()`.

**Webhook extensions** in `slackWebhook.ts` (after existing HMAC verification + dedup):
- `app_mention` — parse @AgentName, resolve agent, create conversation, enqueue `slack-inbound` job
- `message.im` — DM to bot, create/resume conversation
- `message.channels/groups` with `thread_ts` — thread stickiness, resume if tracked
- `block_actions` — HITL buttons (`hitl:{reviewItemId}:{approve|reject|ask}`), resolves Slack user → org user

**Job:** `slack-inbound` — pg-boss worker for async Slack message processing. Loads conversation, dispatches to agent-run infrastructure, posts response back to thread.

**Review integration:** `reviewService.createReviewItem()` optionally calls `postReviewItemToSlack()` (fire-and-forget, non-blocking).

---

## IEE — Integrated Execution Environment

IEE is a deterministic, multi-tenant execution context for **stateful agentic loops** over a browser or a dev workspace. Where the skill system is request/response, IEE is **iterative**: the LLM observes environment state, decides on an action, executes it, observes the result, and loops until `done`, `failed`, the step limit, or the wall-clock timeout. Costs are attributed per run for billing.

The full spec lives in [`docs/iee-development-spec.md`](./docs/iee-development-spec.md). This section is the architectural overview.

### Topology

```
Main app (Replit/Express)        Worker (Docker, DigitalOcean)
  ├─ enqueues IEE jobs              ├─ pulls jobs from pg-boss
  ├─ inserts ieeRuns rows           ├─ runs the execution loop (Playwright / shell)
  └─ serves usage/cost APIs         └─ updates ieeRuns, writes ieeSteps
              ↓                                ↑
              └────── shared Postgres + pg-boss ──────┘
```

**Database is the only integration point.** No HTTP between app and worker.

### Schema (migrations 0070, 0071, 0176)

| Table | Purpose |
|-------|---------|
| `ieeRuns` | One row per IEE job. Fields: `agentRunId`, `type` (`browser`\|`dev`), `status` (`pending`\|`running`\|`completed`\|`failed`\|`cancelled`), `failureReason` (shared `FailureReason` enum), `idempotencyKey`, `correlationId`, `goal`, `task` (JSONB), `resultSummary`, `stepCount`, `llmCostCents`, `runtimeCostCents`, `totalCostCents`, `workerInstanceId`, `lastHeartbeatAt`, `eventEmittedAt`. Soft delete. Unique partial index on `idempotencyKey WHERE deletedAt IS NULL`. |
| `ieeSteps` | Append-only per-step log. Fields: `ieeRunId`, `stepNumber`, `actionType`, `input`, `output`, `success`, `failureReason` (shared `FailureReason` enum), `durationMs`. Unique on `(ieeRunId, stepNumber)` to prevent retry double-writes. |
| `ieeArtifacts` | Metadata for files/downloads emitted by a run. v1 stores metadata only; contents live on worker disk. |

**LLM attribution** — `llmRequests` table gains `ieeRunId` (nullable FK) and `callSite` (`app`\|`worker`). Database CHECK constraint: `source_type <> 'iee' OR iee_run_id IS NOT NULL`.

**Parent agent_run linkage** — migration 0176 adds `agent_runs.iee_run_id` (nullable, no FK) as a denormalised cache populated at delegation time by `agentExecutionService`. The run-detail API (`GET /api/agent-runs/:id`) and live-progress polling read it directly so callers never JOIN `iee_runs` at read time. Migration 0176 also adds a partial in-flight index `agent_runs_inflight_org_idx ON (organisation_id) WHERE status IN ('pending', 'running', 'delegated')` for hot-path live-count / dashboard queries.

### Routing — how a task reaches IEE

Decision happens in `agentExecutionService.executeAgentRun`:

```typescript
if (effectiveMode === 'iee_browser' || effectiveMode === 'iee_dev') {
  if (!request.ieeTask) throw { statusCode: 400, message: 'ieeTask required' };
  const { enqueueIEETask } = await import('./ieeExecutionService.js');
  const enqueueResult = await enqueueIEETask({ task, organisationId, subaccountId, agentId, agentRunId, correlationId });
  // Park the parent agent_run in the non-terminal 'delegated' status (NOT
  // a synthetic completion) and persist enqueueResult.ieeRunId on the
  // denormalised iee_run_id column. Real terminal transition lands later
  // via the iee-run-completed event handler (see §IEE delegation lifecycle).
}
```

`executionMode` is one of `api` | `headless` | `claude-code` | `iee_browser` | `iee_dev`. The IEE branch parks the agent run and lets the worker drive the actual execution.

### IEE delegation lifecycle (Phase 0 — `docs/iee-delegation-lifecycle-spec.md`)

The IEE branch does NOT mark the parent `agent_run` complete at handoff time (the previous "synthetic completion" pattern lost real outcomes). Instead:

1. **Delegate** — `agentExecutionService` writes `status='delegated'` + `iee_run_id` on the parent and returns. The parent stays non-terminal while the worker executes. Live-progress polling on `GET /api/iee/runs/:ieeRunId/progress` (visibility-paused, exponential-backoff schedule `[3s, 5s, 10s]`, 15-minute cap, early-exit on terminal worker status) surfaces step count + heartbeat age to the run-trace UI.
2. **Worker terminal write** — `worker/src/persistence/runs.ts::finalizeRun` performs the terminal write on `iee_runs` under `AND status IN ('pending','running')` guard, then publishes the `iee-run-completed` pg-boss event (versioned payload, `version: 1`).
3. **Main-app finalisation** — `server/jobs/ieeRunCompletedHandler.ts` consumes the event, re-reads `iee_runs` (payload is hint only), and calls `server/services/agentRunFinalizationService.ts::finaliseAgentRunFromIeeRun`. That service:
   - Acquires a `SELECT ... FOR UPDATE` lock on the parent `agent_run` row.
   - Aggregates `llm_requests` token counts inside the same transaction (so late inserts up to the lock are included).
   - Updates the parent with terminal status, summary, error fields, durationMs, token totals — gated on `status IN ('pending','running','delegated') AND completed_at IS NULL` for defence-in-depth.
   - Emits `agent:run:completed` (run room) and `live:agent_completed` (subaccount room) post-commit so dashboards and sidebar counters decrement.
4. **Reconciliation backstop** — `maintenance:iee-main-app-reconciliation` cron (every 2 min, registered in `queueService.ts`) calls `reconcileStuckDelegatedRuns()` to catch the "Class 2 orphan" case: parent stuck in `delegated` while `iee_runs` is already terminal (event handler crashed or event lost). 120-second grace window before reconciliation kicks in.

Pure helpers live in `agentRunFinalizationServicePure.ts` (`mapIeeStatusToAgentRunStatus`, `buildSummaryFromIeeRun`) so the mapping table is testable without a DB. Tests in `server/services/__tests__/agentRunFinalizationServicePure.test.ts` cover the full Appendix A mapping matrix plus summary-formatting edge cases.

### Services & Routes

| Service | Responsibility |
|---------|----------------|
| `ieeExecutionService` | Enqueue task. Idempotent insert (ON CONFLICT on `idempotencyKey`), budget reservation, pg-boss send, tracing. |
| `ieeUsageService` | Per-run cost breakdown and aggregated usage queries (system / org / subaccount scope). Joins `ieeRuns` ⨝ `llmRequests`. |

| Route | File | Purpose |
|-------|------|---------|
| `GET /api/iee/runs/:ieeRunId/cost` | `iee.ts` | Per-run cost breakdown (app vs worker LLM, runtime) |
| `GET /api/iee/runs/:ieeRunId/progress` | `iee.ts` | Live worker progress for a delegated run (step count, heartbeat age, status, failure reason). Subaccount-scoped boundary check via `?subaccountId=` query param. Backed by `ieeUsageService.getIeeRunProgress`. |
| `GET /api/iee/usage/system` | `iee.ts` | System-wide explorer (system_admin) |
| `GET /api/orgs/:orgId/iee/usage` | `iee.ts` | Org-scoped explorer |
| `GET /api/subaccounts/:subaccountId/iee/usage` | `iee.ts` | Subaccount-scoped explorer |

Usage routes support filters: `from`, `to`, `agentIds`, `subaccountIds`, `statuses`, `types`, `failureReasons`, `minCostCents`, `search`, `sort`, `order`, `limit`, `cursor`.

Standard conventions apply: `asyncHandler`, `authenticate`, org scoping via `req.orgId`, no direct `db` access.

### Worker service

Lives in [`worker/`](./worker/), separate process, packaged via [`worker/Dockerfile`](./worker/Dockerfile) (Playwright base image) and run as the `worker` service in [`docker-compose.yml`](./docker-compose.yml). Resource limits: `IEE_WORKER_MEM_LIMIT` (default 3g), `IEE_WORKER_CPUS` (default 2). Persistent volume for browser sessions at `/var/browser-sessions`.

| File | Purpose |
|------|---------|
| `worker/src/index.ts` | Bootstrap: pg-boss, Drizzle, tracing, reconcile orphans, register handlers, SIGTERM handling |
| `worker/src/bootstrap.ts` | Pre-flight checks at boot — Playwright package version + Chromium binary presence verification (fails fast if the worker image was built without browsers) |
| `worker/src/handlers/browserTask.ts` | Subscribes to `iee-browser-task` queue |
| `worker/src/handlers/devTask.ts` | Subscribes to `iee-dev-task` queue |
| `worker/src/handlers/runHandler.ts` | Shared lifecycle: parse, mark running, run loop, finalize, sum costs |
| `worker/src/handlers/cleanupOrphans.ts` | Periodic: stale workspaces, browser sessions, expired reservations |
| `worker/src/handlers/costRollup.ts` | Periodic: aggregate `llmRequests` cost into `ieeRuns` denormalized columns |
| `worker/src/loop/executionLoop.ts` | The four-exit-path loop |
| `worker/src/browser/executor.ts` | Playwright actions: navigate, click, type, extract, download |
| `worker/src/dev/executor.ts` | Workspace, shell, git, file I/O |

### The execution loop

```
runExecutionLoop():
  while not terminal:
    1. observe()                          → structured env state (capped sizes)
    2. build prompt + observation
    3. callRouter()                       → LLM call (sourceType='iee', callSite='worker', ieeRunId set)
    4. parse + zod-validate the action
    5. execute action
    6. write ieeSteps row
    7. heartbeat (lastHeartbeatAt)
```

**Exactly four exit paths** — no other terminations are valid:
1. Action `done` → success
2. Action `failed` → voluntary failure
3. Step count exceeds `MAX_STEPS_PER_EXECUTION` → `step_limit_reached`
4. Wall clock exceeds `MAX_EXECUTION_TIME_MS` → `timeout`

`FailureReason` enum is the canonical taxonomy in `shared/iee/failureReason.ts`. Both `ieeRuns.failureReason` and `ieeSteps.failureReason` reference the shared enum directly (no inline subsets). Core IEE execution-loop reasons: `timeout` | `step_limit_reached` | `execution_error` | `environment_error` | `auth_failure` | `budget_exceeded` | `worker_terminated` | `unknown`. The full enum also includes connector reasons (`connector_timeout`, `rate_limited`, `data_incomplete`, `internal_error`), tenant-isolation reasons (`scope_violation`, `missing_org_context`), and playbook decision-step reasons (see `shared/iee/failureReason.ts`). `worker_terminated` is distinct from `cancelled` — it indicates the worker process died mid-run (e.g. SIGTERM during a deploy, container eviction, orphan detection) rather than a user-initiated cancel; the latter sets `iee_runs.status='cancelled'`.

### Idempotency & deduplication

Pattern in `ieeExecutionService`:

1. Derive deterministic `idempotencyKey` from `(orgId, agentRunId, agentId, taskHash)`.
2. `INSERT ... ON CONFLICT (idempotencyKey) WHERE deletedAt IS NULL DO NOTHING RETURNING id`.
3. If no row returned, `SELECT` existing and apply:

| Existing status | Behaviour |
|-----------------|-----------|
| `completed` | Return existing `resultSummary` immediately. **Do not enqueue.** |
| `running` | Return run id; let in-flight worker finish. |
| `pending` | Return run id; queued job will pick it up. |
| `failed` | If retry policy allows: soft-delete, insert new, enqueue. Else return failed row. |
| `cancelled` | Treat like `failed` for retry-policy purposes. The retry-sweep on the worker (`worker/src/persistence/runs.ts`) also includes `cancelled` so the parent agent_run gets finalised on the next pass. |

The worker also defensively bails if the row's status is not `pending` on receipt — guards against pg-boss double-delivery.

### Cost attribution & billing

Denormalized cost columns on `ieeRuns`:

- `llmCostCents` — sum of `llm_requests.cost_with_margin_cents WHERE iee_run_id = run.id`
- `llmCallCount`
- `runtimeWallMs`, `runtimeCpuMs`, `runtimePeakRssBytes`
- `runtimeCostCents` = `IEE_COST_CPU_USD_PER_SEC × cpuSec + IEE_COST_MEM_USD_PER_GB_HR × memGbHr + IEE_COST_FLAT_USD_PER_RUN`
- `totalCostCents` = llm + runtime

`costRollup` job aggregates from `llmRequests` after run completion. `ieeUsageService` joins these for the Usage Explorer.

**Soft budget reservation** — created at enqueue (`IEE_RESERVATION_TTL_MINUTES`), released at finalization. Cleanup job sweeps expired reservations.

### LLM router contract

`llmRouter.routeCall` is the **only** supported entry point to any LLM provider. Direct imports of `anthropicAdapter` / `openaiAdapter` / `geminiAdapter` / `openrouterAdapter` from anywhere outside `llmRouter.ts` are forbidden:

- **Static gate** — `scripts/verify-no-direct-adapter-calls.sh` (registered in `run-all-gates.sh`) fails CI on any direct import of a provider adapter from outside the router. Audit log: `tasks/direct-adapter-audit-2026-04-20.md`.
- **Runtime assertion** — every adapter entry point calls `assertCalledFromRouter()` (`server/services/providers/callerAssert.ts`), walking the V8 stack frame to confirm `llmRouter.ts` is an ancestor caller. Bypass attempts throw `RouterContractError` before a single byte of payload leaves the process.

`llmRouter.routeCall` enforces, at runtime:

```typescript
if (ctx.sourceType === 'iee' && !ctx.ieeRunId)  throw new RouterContractError(...);
if (ctx.callSite   === 'worker' && !ctx.ieeRunId) throw new RouterContractError(...);
```

The database CHECK constraint on `llmRequests` is the belt-and-braces backstop.

#### Ledger attribution contract (spec §5.1)

Every LLM call is observable. The ledger row carries enough dimensions that cost-per-feature, cost-per-source-type, and cost-per-call-site rollups are a single `GROUP BY` away. Every callable surface — agent loop, analyzer, process execution, IEE worker, system background — contributes a row.

**Required `LLMCallContext` fields** (Zod-enforced in `llmRouter.ts`):

| Field | Purpose |
|-------|---------|
| `sourceType` | `agent_run` \| `process_execution` \| `iee` \| `analyzer` \| `system` |
| `sourceId` | UUID of the originating entity (`agent_run.id`, `execution.id`, `iee_run.id`, analyzer invocation id, or a stable system caller id). `null` for `sourceType='system'` is legal only when `systemCallerPolicy='respect_routing'` is set. |
| `featureTag` | Stable short string (`'memory_compile'`, `'skill_classify'`, `'orchestrator_pick'`). Becomes a grouping dimension in System P&L. |
| `callSite` | `'web' \| 'worker' \| 'job'` — where the call runs, not who requested it. |
| `executionPhase` | Optional: `'plan' \| 'act' \| 'reflect' \| 'postprocess'`. Now nullable at the DB level; system/analyzer callers leave it null. |
| `systemCallerPolicy` | `'respect_routing' \| 'override_to'` — when `'override_to'` is set, the system caller bypasses capability-tier routing. Defaulted to `'respect_routing'` at runtime. |

**Row-level attribution columns** added by migration `0185` (`migrations/0185_llm_requests_generalisation.sql`):

- `source_type text NOT NULL` — same five enum values above.
- `source_id uuid` — polymorphic pointer; no FK because the target table varies by `sourceType`.
- `feature_tag text NOT NULL DEFAULT 'unknown'`.
- `execution_phase text` — now nullable (was `NOT NULL`; relaxed for system/analyzer callers).
- Composite indexes on `(source_type, billing_month)`, `(feature_tag, billing_month)`, `(source_type, organisation_id, billing_month)` for the P&L rollups.
- CHECK constraints mirror the router guards: `iee` requires `iee_run_id`; `agent_run` requires `run_id`; `process_execution` requires `execution_id`.

#### Margin + budget contract for system callers

`system` and `analyzer` source types represent platform overhead — work Synthetos performs on its own behalf (memory compilation, skill classification, orchestrator hints). They have no customer to bill:

- `pricingService.resolveMarginMultiplier()` returns **1.0×** for `sourceType ∈ {'system', 'analyzer'}` — no margin applied. The `cost_with_margin` column equals `cost_raw`, and `cost_with_margin_cents` equals the raw-cost rounding.
- `budgetService.checkAndReserve` returns **`string | null`** — a reservation id for customer-billable calls, `null` for system/analyzer. The commit and release paths tolerate the null id and no-op.
- The System P&L page surfaces these as the "Platform Overhead" row and subtracts them from gross profit to derive net profit.

#### Structured parse failures

Callers that need schema-validated output pass a `postProcess` hook:

```typescript
const result = await llmRouter.routeCall({
  ...ctx,
  postProcess: (raw) => schema.parse(JSON.parse(raw)),  // may throw ParseFailureError
});
```

`ParseFailureError` (`server/lib/parseFailureError.ts`) is a distinct error class. The router catches it, writes `status='parse_failed'` to the ledger, and stores a UTF-8-safe ≤2 KB excerpt of the raw response in `parse_failure_raw_excerpt` — never the full payload. The truncation utility (`server/lib/utf8Truncate.ts`) backs up through multi-byte continuation bytes so the excerpt is always valid UTF-8.

#### Cancellation + client-disconnect handling

Every router call accepts an `AbortSignal`. Adapters thread the signal into `fetch`, and `adapterErrors.ts::mapAbortError` inspects `signal.reason` to distinguish:

- `'caller_timeout'` — the caller imposed a deadline.
- `'caller_cancel'` — the caller proactively aborted (e.g. client disconnected mid-stream).

The ledger row records the distinction in `abort_reason`. `isNonRetryableError` treats `CLIENT_DISCONNECTED` as non-retryable — no point retrying a call whose consumer has gone away.

#### Provider-call timeout contract (April 2026 hardening)

A separate internal timeout guards every provider call. `callWithTimeout` (`server/services/llmRouterTimeoutPure.ts`) owns the contract:

- **Merged abort signal.** Creates an internal `AbortController`, merges it with the caller's signal via `AbortSignal.any([...])`, and passes the merged signal to the adapter factory. When the timer fires, the fetch is genuinely cancelled — the earlier `Promise.race` pattern left orphaned fetches running and caused provider-side double-billing when the retry loop fired a second concurrent call.
- **Typed error.** On timer fire, the merged signal aborts with a `ProviderTimeoutError` (`code: 'PROVIDER_TIMEOUT'`, `statusCode: 504`). `callWithTimeout` re-throws that typed error rather than the generic `AbortError` so the router's classifier can distinguish internal timeouts from caller aborts.
- **Non-retryable.** `isNonRetryableError` treats `PROVIDER_TIMEOUT` the same as `CLIENT_DISCONNECTED` — ambiguous state; the provider may have completed generation server-side, so a retry under the same idempotency key could double-bill at the provider. The caller decides whether to replay under a new idempotency key.
- **Ledger row on every terminal attempt.** Non-retryable errors now `break providerLoop` and fall through to the shared ledger-write-on-failure path rather than `throw err`-ing out immediately. The pure classifier `classifyRouterError` in `server/services/llmRouterErrorMappingPure.ts` owns the error → status mapping (`timeout` / `client_disconnected` / `aborted_by_caller` / `provider_unavailable` / `provider_not_configured` / `parse_failure` / `error`), and is the single source of truth: every failure mode produces exactly one ledger row, and `status='error'` is the fallthrough — never a skip. This closes an April 2026 observability gap where `PROVIDER_TIMEOUT` + `PROVIDER_NOT_CONFIGURED` + auth errors produced no ledger row at all and became invisible to the System P&L surface.
- **Generous cap.** `PROVIDER_CALL_TIMEOUT_MS` is **600 s** (`server/config/limits.ts`) — above every documented provider ceiling including OpenAI reasoning models. The earlier 30 s cap routinely tripped on legitimate long generations inside the skill analyzer, which was the original trigger for the LLM observability work.

See spec §17 for why this is the internal mitigation rather than a provider-header fix: no LLM provider currently documents an idempotency header on its generation endpoints (verified April 2026 — Anthropic, OpenAI, OpenRouter, Gemini). Test pins live in `server/services/__tests__/llmRouterTimeoutPure.test.ts` (timeout guard) and `server/services/__tests__/llmRouterErrorMappingPure.test.ts` (ledger-status classifier — 14 cases, including the defensive "classifier never returns an undefined status" property test).

#### LLM in-flight registry (spec `tasks/llm-inflight-realtime-tracker-spec.md`)

The ledger is append-only and only observable after a call completes. The in-flight registry fills the gap between dispatch and completion for system admins — a real-time view of every LLM call currently running, with attribution and elapsed time.

- **Interception point.** `registry.add()` fires inside the provider-retry loop in `llmRouter.ts`, **after** budget reservation and **immediately before** each `providerAdapter.call()` dispatch. `registry.remove()` fires (a) per intermediate retry failure with `terminalStatus='error'` + `ledgerRowId=null`, and (b) once at the end with `ledgerRowId` + `ledgerCommittedAt` populated after the ledger upsert. Pre-dispatch terminal states (`budget_blocked`, `rate_limited`) never add — they write the blocked-row and throw without a registry footprint.
- **Runtime key.** `runtimeKey = ${idempotencyKey}:${attempt}:${startedAt}`. Crash-restart safe (same idempotencyKey + attempt but different startedAt → different runtimeKey), retry safe (same idempotencyKey + startedAt but different attempt → different runtimeKey).
- **State machine (pure).** `server/services/llmInflightRegistryPure.ts` owns the add / remove / incoming-Redis-event transitions. Monotonic `stateVersion` ladder — `1=active, 2=removed` — plus a `startedAt` anchor so a late duplicate add can never resurrect a removed entry. Every transition's outcome tag drives a structured debug log (`add_noop_already_exists`, `remove_noop_already_removed`, `remove_noop_missing_key`, `event_stale_ignored`) so steady-state rates are visible and fanout loops diagnosable.
- **Multi-instance fanout.** `server/services/llmInflightRegistry.ts` optionally connects to Redis pub/sub on channel `llm-inflight` when `REDIS_URL` is set and the `ioredis` module is installed. Local-only mode is the default — the feature works single-instance without Redis. Instances skip their own messages via an `origin` tag. On Redis partition, clients recover cross-fleet consistency via the snapshot endpoint (authoritative read) rather than server-side event replay.
- **Bounded memory.** `MAX_INFLIGHT_ENTRIES = 5_000` (`server/config/limits.ts`). On overflow, the oldest `active` slot is force-evicted and the removal emission carries `terminalStatus: 'evicted_overflow'` + `evictionContext: { activeCount, capacity }` — sized at 100× steady-state headroom so any eviction is a real signal.
- **Deadline-based sweep.** Every slot carries `deadlineAt = startedAt + timeoutMs + INFLIGHT_DEADLINE_BUFFER_MS` (30 s). A `60s ± 5s` jittered sweep reaps entries past `deadlineAt` as `terminalStatus: 'swept_stale'` + `sweepReason: 'deadline_exceeded'`. In practice this only fires on crashes between `add()` and `remove()` — the router's own `callWithTimeout` already aborts at `timeoutMs`.
- **Admin surfaces.**
  - `GET /api/admin/llm-pnl/in-flight?limit=500` — authoritative snapshot for first paint + reconnect resync. Hard cap 500; sort `startedAt DESC, runtimeKey DESC` for stable repeat reads.
  - Socket room `system:llm-inflight` — events `llm-inflight:added` / `llm-inflight:removed`. Join handler in `server/websocket/rooms.ts` silently rejects non-`system_admin` sockets.
  - `/system/llm-pnl` → In-Flight tab (`client/src/components/system-pnl/PnlInFlightTable.tsx`). Physically first, default-selected view stays on P&L.
- **Ledger reconciliation.** The final-attempt removal carries `ledgerRowId` + `ledgerCommittedAt`. When a terminal upsert hits its `where: status = 'started'` guard and finds a non-started row (idempotency replay / sweep pre-empted), `.returning()` comes back empty; the UI falls back to idempotencyKey-based fetch.
- **Active-count gauge.** Every add/remove emits `llm.inflight.active_count` via `createEvent` with `byCallSite` + `byProvider` breakdowns — stuck workers or provider-specific hangs are spottable without digging logs.
- **Pure tests pin every state-machine invariant:** `server/services/__tests__/llmInflightRegistryPure.test.ts`.

#### Partial-external-success protection (provisional `'started'` row)

The gap the tracker couldn't close on its own: `providerAdapter.call()` succeeds (provider has billed and generated tokens) → `db.insert(llmRequests)` fails for any reason (DB blip, constraint violation, crash) → caller retries under the same `idempotencyKey` → the pre-dispatch idempotency check finds no row → router dispatches a second concurrent call → **double-bill at the provider with no ledger trace of the first success**. No LLM provider currently ships a request-level dedup header.

The `llm_requests.status` enum has a provisional value `'started'` (migration `0190_llm_requests_started_status.sql` — partial index on `created_at WHERE status = 'started'`). Flow:

1. **Atomic idempotency check + provisional INSERT.** `llmRouter.routeCall` step 4+7 runs a single `db.transaction`. It does `SELECT … FOR UPDATE` on `idempotencyKey`; if a `'success'` row exists it returns the cached response; if a `'started'` row exists it returns an `inflight` marker; otherwise it INSERTs a fresh `'started'` row inside the same transaction (with `onConflictDoUpdate` on any non-success state so a retry after terminal-error resets `createdAt` to `now()` — preventing the revived row from being immediately sweep-eligible). A concurrent second caller blocks on the unique-constraint conflict; when the first tx commits, the second's own `FOR UPDATE` returns the `'started'` row and correctly takes the reconciliation branch.
2. **`ReconciliationRequiredError` thrown on `inflight`.** `server/lib/reconciliationRequiredError.ts` — typed error class, `statusCode: 409`, `code: 'RECONCILIATION_REQUIRED'`, carries `idempotencyKey`. **The router never auto-retries this.** The caller decides (surface banner, poll, fail) — auto-retry inside the router would re-open the exact double-dispatch window this mechanism exists to prevent.
3. **Single-terminal-transition invariant.** All three terminal writes in `llmRouter.routeCall` — success upsert, failure upsert, budget-blocked upsert — use `where: status = 'started'` (not `!= 'success'`). A mismatch means another transition already happened (sweep fired and claimed as `provisional_row_expired`, or sibling raced). The tightened guard preserves the earlier terminal signal; a ghost log (`llm_router.{budget_block,failure,success}_upsert_ghost` at warn level) surfaces the case so operators can reconcile rather than silently losing the audit trail.
4. **DB-level sweep backstop.** `server/jobs/llmStartedRowSweepJob.ts` (+ pure cutoff math in `llmStartedRowSweepJobPure.ts`) runs every 2 minutes under `maintenance:llm-started-row-sweep`. It reaps `'started'` rows older than `PROVIDER_CALL_TIMEOUT_MS + STARTED_ROW_SWEEP_BUFFER_MS` (60 s) via a `UPDATE … SET status = 'error', error_message = 'provisional_row_expired'` with `FOR UPDATE SKIP LOCKED`. Admin-bypass (`withAdminConnection` + `SET LOCAL ROLE admin_role`). Telescopes with the in-memory sweep (30 s past timeout) — registry reaps first, DB reaps second.
5. **Aggregation exclusion.** `systemPnlServicePure.ts::COUNTABLE_COST_STATUSES = ['success', 'partial']`. `contributesToCostAggregate()` is the predicate every P&L query uses in spirit (`status IN ('success','partial')`). Pure test pins the set; any future status-enum expansion trips the test if `'started'` (or another non-success status) accidentally lands inside the countable set.

#### Idempotency-key versioning

`server/lib/idempotencyVersion.ts` ships `IDEMPOTENCY_KEY_VERSION = 'v1'` prepended to every idempotency key produced by `llmRouter.generateIdempotencyKey` (extracted to `server/services/llmRouterIdempotencyPure.ts`) and `actionService.buildActionIdempotencyKey`. Any change to hash inputs, input ordering, or canonicalisation must bump the version in the same commit — without the bump, retries issued before the change don't match their originating rows (provider double-bill, duplicate action execution).

- **Load-time assert** — `/^v\d+$/` check on the constant at module load. Catches the "still a string, but empty/null/unprefixed" failure mode that the type-level `as const` can't express.
- **Deploy-boundary tradeoff** is explicit and documented: a request in-flight at the moment of a prefix bump will, on retry, hash to the new prefix and not match its prior attempt's row. Narrow window; acceptable risk given the rarity.
- **Pure test pins** — both `llmRouterIdempotencyPure.test.ts` and `actionServiceCanonicalisationPure.test.ts` pin the `v1:`-prefixed output against a known-good fixture. Accidental prefix removal trips both suites.

#### Queueing-delay + fallback visibility

`InFlightEntry` carries four additional observability fields beyond the base registry contract:

| Field | Populated at | Surface |
|-------|--------------|---------|
| `queuedAt` | Top of `routeCall()`, before budget/cooldown/resolver | Paired with `dispatchDelayMs` on the entry |
| `dispatchDelayMs` | `startedAt - queuedAt`, clamped ≥0 | "Queued" column on the In-Flight tab (>1 s amber, >5 s red) |
| `attemptSequence` | Monotonic across the entire `routeCall`, ticks once per attempt | Attempt column shows `#${attemptSequence}` when it diverges from the per-provider `attempt` |
| `fallbackIndex` | 0 for primary provider, 1+ for each fallback | Small `↳fb#N` badge next to the attempt label |

These close the "why is this call slow?" and "which attempt of the logical call is this?" gaps the base tracker left open.

#### Historical archive + soft circuit breaker

`llm_inflight_history` (migration `0191_llm_inflight_history.sql`) captures every add/remove event with its full payload. Retention: `env.LLM_INFLIGHT_HISTORY_RETENTION_DAYS` days (default 7). Daily sweep via `maintenance:llm-inflight-history-cleanup` at 04:15 UTC.

Writes are **fire-and-forget** — a DB hiccup must not delay the sub-second socket emit. Gated by a soft circuit breaker from `server/lib/softBreakerPure.ts`:

- **Sliding-window** — 50 samples, 50% failure threshold, 5-minute open state. Below threshold: debug log per failure. On trip: single `inflight.history_breaker_opened` warn log. While open: silent drop. At expiry: half-open probe on next event.
- **Pure state machine** — `createBreakerState` / `shouldAttempt(state, nowMs)` / `recordOutcome(state, success, nowMs, config)` returning `{ trippedNow }`. No clock/logger injection — the calling code owns those. **Reusable**: any future fire-and-forget persistence path (payment webhooks, outbound integration events) can adopt the same primitive.
- **Env kill-switch** — `LLM_INFLIGHT_HISTORY_ENABLED=false` disables writes without a code deploy.

Admin read: `GET /api/admin/llm-pnl/in-flight/history?from=…&to=…&runtimeKey=…&idempotencyKey=…&limit=…` — system-admin-only, 1 000-row hard cap.

#### Per-caller live payload drawer

`server/services/llmInflightPayloadStore.ts` — in-memory LRU keyed by `runtimeKey`. Cap 100 entries / 200 KB per payload (measured against the full stored object, not just `messages`). On truncation the snapshot carries `originalSizeBytes: number` so the admin can distinguish a 201 KB payload from a 50 MB one. Captured at dispatch in `routeCall` right after `inflightRegistry.add()`; cleared on every `remove()` / `updateLedgerLink()` path.

Admin route: `GET /api/admin/llm-pnl/in-flight/:runtimeKey/payload` — 410 Gone when the entry has already completed or been evicted (with a user-friendly message directing to the ledger link). `PnlInFlightPayloadDrawer.tsx` opens on row-click, uses `AbortController` + a `currentRuntimeKey` closure check so a fast row-switch doesn't allow stale responses to overwrite the drawer.

Process-local by design — multi-instance deployments see 410 for calls on sibling nodes. Extending to Redis is out of scope; the ledger detail is the authoritative post-completion surface.

#### Token-level streaming progress (infrastructure only)

The adapter contract (`server/services/providers/types.ts::LLMProviderAdapter`) has an optional streaming hook:

```typescript
stream?(params: ProviderCallParams): AsyncIterable<StreamTokenChunk> & {
  done: Promise<ProviderResponse>;
};
```

Router wiring in `llmRouter.ts`: when `params.stream === true` AND the adapter implements `stream()`, the router iterates tokens, throttles progress emissions at 1 Hz per runtimeKey via `llmInflightRegistry.emitProgress()`, and returns `await iterable.done` (with a pre-installed `.catch(() => {})` to silence the dangling rejection if the `for-await` exits via exception). Adapters without `stream()` transparently fall through to `call()`.

Socket event: `llm-inflight:progress` carrying `InFlightProgress = { runtimeKey, idempotencyKey, tokensSoFar, lastTokenAt }`. Client merges into a per-runtimeKey `Map<string, InFlightProgress>`; token count renders inline with the Elapsed cell on both desktop table and mobile card.

**No provider adapter implements `stream()` yet.** The infrastructure ships; the adapter wiring is the next-session handoff. Tripwires per `tasks/llm-inflight-deferred-items-brief.md` §5: cap per-stream memory, cap process-total-buffered-tokens, abort-safe cost attribution, postProcess semantics on partial streams. The §1 partial-external-success protection is a **hard prerequisite** — streaming exposes a new partial-success window (tokens billed but stream aborted), and the `'started'` row is the durable reconciliation layer for that case too.

### Cost aggregate dimensions (spec §6.2)

`cost_aggregates` is the pre-rolled read model for every P&L dashboard. Entity types:

`'organisation' \| 'subaccount' \| 'run' \| 'agent' \| 'task_type' \| 'provider' \| 'platform' \| 'execution_phase' \| 'source_type' \| 'feature_tag'`

The last two — `source_type` and `feature_tag` — were added by spec §6.2 so platform-overhead, per-feature, and per-source-type rollups don't require live scans of `llm_requests`. `cost_aggregates` is NOT RLS-protected (it carries aggregated totals, not PII), which keeps the existing admin usage routes working without bypass wiring.

### LLM ledger retention (spec §12.4 / §15.5)

`llm_requests` rows older than `env.LLM_LEDGER_RETENTION_MONTHS` (default `12`) are moved to `llm_requests_archive` by the nightly `maintenance:llm-ledger-archive` pg-boss job (`server/jobs/llmLedgerArchiveJob.ts`, 03:45 UTC):

- **10k-row chunks** — bounded transaction size keeps lock footprint small.
- **Atomic move** — one CTE chain `SELECT FOR UPDATE SKIP LOCKED → INSERT ON CONFLICT DO NOTHING → DELETE RETURNING`. A row is either in the live table OR the archive, never both and never neither.
- **Admin-bypass RLS** — both `llm_requests` and `llm_requests_archive` have `FORCE ROW LEVEL SECURITY`. The job runs under `withAdminConnection({ source: 'llmLedgerArchiveJob' }, …)` + `SET LOCAL ROLE admin_role` (BYPASSRLS). Direct `db.transaction` would fail closed.
- **Cutoff math** is pure in `llmLedgerArchiveJobPure.ts::computeArchiveCutoff` so retention behaviour is test-pinned.

`systemPnlService.getCallDetail()` UNIONs the archive so the detail drawer keeps working for rows moved out of the live table.

### System P&L page (spec §11)

`/system/llm-pnl` is the one UI that is intentionally cross-tenant. Routes (`server/routes/systemPnl.ts`) enforce `requireSystemAdmin`; the service (`server/services/systemPnlService.ts`) runs every read inside `adminRead(reason, fn)` — a thin wrapper over `withAdminConnection({source:'systemPnlService', reason}, tx => { await tx.execute(sql\`SET LOCAL ROLE admin_role\`); return fn(tx); })`. Cross-org reads without the role switch fail closed against the FORCE RLS policy on `llm_requests` + archive.

Data split:

- **Scalar KPIs + per-org / per-subaccount rollups** read `cost_aggregates` (sub-100 ms, no live scan).
- **Source-type / provider+model rollups, top calls, call detail** read `llm_requests` live — bounded by the indexed `billing_month` scan.
- **Daily trend** reads `cost_aggregates` (`entity_type='platform'`, `period_type='daily'`).

Pure math — margin %, profit cents, KPI change % / pp, aggregated overhead row — lives in `systemPnlServicePure.ts` so every computation is test-pinned independently of SQL.

### Frontend

[`client/src/pages/UsagePage.tsx`](./client/src/pages/UsagePage.tsx) gains an `iee` tab alongside `overview` / `agents` / `models` / `runs` / `routing`. Loads `ieeRows`, `ieeSummary` from the scoped usage endpoint, with filters for type, status, search, failure reason, min cost. Per-run cost panel hits `/api/iee/runs/:ieeRunId/cost`.

A Usage Explorer link appears in the left nav at all three scopes (system / org / subaccount), permission-gated.

### Permissions

| Scope | Key |
|-------|-----|
| Org | `org.billing.iee.view` |
| Subaccount | `subaccount.billing.iee.view` |

### Shared contracts (`shared/iee/`)

Zod schemas + typed errors imported by both server and worker:

- `IEEJobPayload`, `BrowserTaskPayload`, `DevTaskPayload`, `ResultSummary`
- `ExecutionAction` union (`navigate` | `click` | `type` | `extract` | `download` | `run_command` | `write_file` | `read_file` | `git_clone` | `git_commit` | `done` | `failed`)
- `Observation` (`url`, `pageText`, `clickableElements`, `inputs`, `files`, `lastCommandOutput`, `lastCommandExitCode`, `lastActionResult`)
- `FailureReason` enum and typed errors: `TimeoutError`, `StepLimitError`, `SafetyError`, `BudgetExceededError`, `RouterContractError`

### Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `MAX_STEPS_PER_EXECUTION` | 25 | Hard step ceiling per run |
| `MAX_EXECUTION_TIME_MS` | 300000 | Wall-clock ceiling |
| `MAX_COMMAND_TIME_MS` | 30000 | Per-shell-command ceiling (dev mode) |
| `IEE_BROWSER_CONCURRENCY` | 1 | pg-boss `teamSize` for browser queue |
| `IEE_DEV_CONCURRENCY` | 2 | pg-boss `teamSize` for dev queue |
| `IEE_HEARTBEAT_INTERVAL_MS` | 10000 | Worker heartbeat write cadence |
| `IEE_HEARTBEAT_DEAD_AFTER_S` | 60 | Reconciler "dead worker" threshold |
| `IEE_SESSION_TTL_DAYS` | 30 | Browser session lifetime |
| `IEE_SESSION_AUTO_PRUNE` | false | Opt-in auto-delete of expired sessions |
| `IEE_RESERVATION_TTL_MINUTES` | 15 | Soft budget reservation lifetime |
| `IEE_MAX_STEPS` | 25 | Used for upfront budget estimation |
| `IEE_AVG_LLM_COST_CENTS_PER_STEP` | 5 | Estimation only |
| `IEE_FLAT_RUNTIME_COST_CENTS` | 20 | Estimation only |
| `IEE_COST_CPU_USD_PER_SEC` | 0 | Runtime cost pricing |
| `IEE_COST_MEM_USD_PER_GB_HR` | 0 | Runtime cost pricing |
| `IEE_COST_FLAT_USD_PER_RUN` | 0 | Runtime cost pricing |
| `IEE_GIT_AUTHOR_NAME` / `IEE_GIT_AUTHOR_EMAIL` | — | Commit author for dev tasks |
| `BROWSER_SESSION_DIR` | `/var/browser-sessions` | Persistent session storage |
| `WORKSPACE_BASE_DIR` | `/tmp/workspaces` | Ephemeral dev workspace root |

### Job config (`server/config/jobConfig.ts`)

```typescript
'iee-browser-task': { retryLimit: 3, expireInMinutes: 10, retentionDays: 7, dlq: 'iee-browser-task__dlq' }
'iee-dev-task':     { retryLimit: 2, expireInMinutes: 10, retentionDays: 7, dlq: 'iee-dev-task__dlq' }
```

### Invariants (non-negotiable)

- **Database is the only integration point** between app and worker. No HTTP, no shared filesystem assumptions beyond the worker's own volumes.
- **Idempotency is database-level** — unique partial index plus ON CONFLICT logic. Never compute it in application memory alone.
- **Terminal status finality** — once `completed` or `failed`, only `eventEmittedAt`, `deletedAt`, and reconciliation cleanup may touch the row. Cost and result columns are frozen. Protects billing accuracy.
- **Worker ownership assertion** — before destructive ops, `assertWorkerOwnership()` verifies `workerInstanceId` matches. Prevents double-execution after a crash + reassignment.
- **Four exit paths only** — `done`, `failed`, `step_limit_reached`, `timeout`. The loop cannot terminate any other way.
- **Observations are structured and capped** — never raw HTML or unbounded command output. `pageText` ≤ 8KB, ≤ 80 clickable elements, command output ≤ 4KB.
- **Action schema validation before execute** — every LLM-emitted action is zod-parsed before any executor call. Invalid actions are a failed step, not a thrown exception.
- **`source_type='iee'` requires `iee_run_id`** — enforced by both router runtime guard and database CHECK constraint.
- **Tenant scoping on every query** — all cost/usage queries unconditionally filter by `organisationId`. System_admin scope override is an explicit parameter, never an implicit bypass.
- **`iee_browser` / `iee_dev` execution modes** respect existing budget reservation, policy engine, and audit event flows — IEE never bypasses platform guardrails.

---

## Local Development Setup

**Do not use `docker compose up app` for active development.** The app image is baked at build time — source changes require a full rebuild and container restart, which makes the feedback loop unusable.

### Correct local dev workflow

Run the app locally, Docker only for the worker. **Open a terminal and keep it open for the session** — do not try to background these processes or manage them via Claude's bash tool (PM2 does not work reliably on Windows for this).

```bash
# 1. Stop the Docker app container (keep worker running)
docker compose stop app

# 2. Open a terminal in the project root and run:
npm run dev
# Keep this terminal open.
```

`npm run dev` runs two processes concurrently:
- `dev:server` — `tsx watch server/index.ts` on port 3000 (Express + hot-restart on save)
- `dev:client` — Vite on port 5000 with HMR (instant browser updates on save)

Vite proxies all `/api`, `/health`, and `/socket.io` requests to `localhost:3000`, so the client and server share a single origin from the browser's perspective.

**`tsx watch` is slow to start on first boot** (~20–30s to compile the full server). Once running, file-change restarts are fast. Do not assume it failed if there's no output for the first 30 seconds.

### Ports

| Port | Service |
|------|---------|
| 3000 | Express API server (local) |
| 5000 | Vite dev server / frontend (local) |
| 5432 | PostgreSQL (local, native install) |

### Worker

The `worker` Docker service stays in Docker permanently. It connects to the local Postgres via `host.docker.internal:5432` (already configured in `docker-compose.yml`). No changes needed there.

### OAuth / ngrok

Slack OAuth requires an HTTPS redirect URI. In local dev, use ngrok:

```bash
./ngrok http 3000
```

Set `OAUTH_CALLBACK_BASE_URL` in `.env` to the ngrok HTTPS URL. `APP_BASE_URL` stays as `http://localhost:5000` (where the browser lands after auth). These two vars are intentionally separate — they only diverge in local dev.

### Switching machines

`.env` is gitignored. Each machine needs its own `.env`. The only values that differ between machines are:
- `OAUTH_CALLBACK_BASE_URL` — ngrok URL (regenerates each session unless you have a reserved domain)
- `DATABASE_URL` — if Postgres is not on localhost on the other machine

Everything else in `.env` is portable.

---

## Key files per domain

Quick reference for "where do I start when adding X". This is the index, not the deep reference — see the relevant sections above in this document for full architectural details.

| Task | Start here |
|------|------------|
| Modify the Universal Brief (chat-first COO entry) | `server/services/briefCreationService.ts` (create/update briefs) + `server/services/briefConversationWriter.ts` (persist artefacts) + `server/routes/briefs.ts` + `server/routes/conversations.ts` + `shared/types/briefResultContract.ts` (artefact discriminated union, READ-ONLY) + `client/src/pages/BriefDetailPage.tsx` + `client/src/components/brief/` + `server/websocket/emitters.ts` (brief + conversation rooms). Artefact lifecycle: `client/src/lib/briefArtefactLifecyclePure.ts`. Validator prep: `server/services/briefArtefactValidator.ts` wired in `agentExecutionService.ts`. Tables: `conversations`, `conversation_messages` (migration 0194). |
| Add a task-scoped conversation pane | `client/src/components/task-chat/TaskChatPane.tsx` renders the chat UI; calls `GET /api/conversations/task/:taskId` (find-or-create, defined in `server/routes/conversations.ts`). Embedded in `TaskModal.tsx` as the "Conversation" tab. `scopeType='task'` row is created by `findOrCreateBriefConversation` in `server/services/briefConversationService.ts`. |
| Add an agent-run-scoped conversation pane | `client/src/components/agent-run-chat/AgentRunChatPane.tsx` + `GET /api/conversations/agent-run/:runId` in `server/routes/conversations.ts`. Same `findOrCreateBriefConversation` with `scopeType='agent_run'`. |
| Modify the Learned Rules citation trail | `server/services/memoryCitationDetector.ts::scoreRunBlocks` (scores applied memory blocks post-run) + `server/services/memoryBlockCitationDetectorPure.ts::detectBlockCitationsPure` (pure scorer). Called at run-completion in `agentExecutionService.ts` for `finalStatus='completed'` runs. Results land in `agent_runs.applied_memory_block_citations`. UI: `client/src/components/brief-artefacts/RulesAppliedPanel.tsx`. |
| Modify Brief UI artefact cards | `client/src/components/brief-artefacts/StructuredResultCard.tsx` (table card) + `ApprovalCard.tsx` (approval-gate card). Pure data-transform helpers extracted to `StructuredResultCardPure.ts` + `ApprovalCardPure.ts` in the same directory; tests under `__tests__/`. |
| Add a new agent skill | `server/skills/`, `server/config/actionRegistry.ts` |
| Add a new tool action | `server/config/actionRegistry.ts`, `server/services/skillExecutor.ts` |
| Add a new ClientPulse intervention primitive | `server/config/actionRegistry.ts` (namespace as `crm.*` or `clientpulse.*`), `server/services/skillExecutor.ts` (review-gated via `proposeReviewGatedAction`), `server/skills/<slug>ServicePure.ts` (payload validator + provider-call builder), update `INTERVENTION_ACTION_TYPES` in `server/services/clientPulseInterventionContextService.ts` + the `actionType` enum in `server/services/interventionActionMetadata.ts` |
| Modify the ClientPulse intervention proposer | `server/jobs/proposeClientPulseInterventionsJob.ts` (orchestration) + `server/services/clientPulseInterventionProposerPure.ts` (matcher logic) — never bypass `enqueueInterventionProposal()` |
| Modify the outcome measurement job | `server/jobs/measureInterventionOutcomeJob.ts` + `measureInterventionOutcomeJobPure.ts` (decision pure fn) — band attribution + cooldown integrity hinge on the args passed to `interventionService.recordOutcome()` |
| Add a Configuration Assistant config-write skill | `server/skills/<slug>.md` + service in `server/services/<slug>Service.ts` + pure validation in `<slug>Pure.ts` — sensitive paths must route through `actions` row with `gateLevel='review'` per `SENSITIVE_CONFIG_PATHS` |
| Add a new database table | `server/db/schema/`, `migrations/` (next free sequence number) |
| Add a new pg-boss job | `server/jobs/`, `server/jobs/index.ts` (registration) |
| Add an LLM consumer (non-agent) | `llmRouter.routeCall({ context: { sourceType: 'system' \| 'analyzer', sourceId, featureTag, systemCallerPolicy, ... } })` — NEVER import a provider adapter directly (the `verify-no-direct-adapter-calls.sh` gate + runtime `assertCalledFromRouter()` block this). Use `postProcess` + `ParseFailureError` for schema-validation failures; AbortController for cancellation. Callers must also handle `ReconciliationRequiredError` (`server/lib/reconciliationRequiredError.ts`, `statusCode: 409`, `code: 'RECONCILIATION_REQUIRED'`) — thrown when a retry under an `idempotencyKey` finds a provisional `'started'` row. The router never auto-retries this; the caller decides (surface banner, poll, fail). |
| Touch the idempotency-key derivation | Single version constant in `server/lib/idempotencyVersion.ts` (`IDEMPOTENCY_KEY_VERSION = 'v1'`) prepends every key from `llmRouter.generateIdempotencyKey` (pure at `server/services/llmRouterIdempotencyPure.ts`) and `actionService.buildActionIdempotencyKey`. Any change to hash inputs, ordering, or canonicalisation MUST bump the version in the same commit. Load-time assert enforces `/^v\d+$/`. Pure tests in `llmRouterIdempotencyPure.test.ts` + `actionServiceCanonicalisationPure.test.ts` pin the current shape. |
| Modify the partial-external-success guard | `server/services/llmRouter.ts` §4+7 (idempotency-check transaction atomically writes provisional `'started'` row + throws `ReconciliationRequiredError` on retry). All three terminal writes (success, failure, budget-blocked) use `where: status = 'started'` — a mismatch fires `llm_router.{budget_block,failure,success}_upsert_ghost` at warn level. DB-side sweep: `server/jobs/llmStartedRowSweepJob.ts` + `llmStartedRowSweepJobPure.ts` reap aged-out rows at `PROVIDER_CALL_TIMEOUT_MS + 60s` (constant `STARTED_ROW_SWEEP_BUFFER_MS`); registered in `queueService.ts` as `maintenance:llm-started-row-sweep` every 2 min. Migration 0190 adds partial index on `created_at WHERE status = 'started'`. |
| Modify the in-flight registry or its UI | In-memory registry at `server/services/llmInflightRegistry.ts` + `llmInflightRegistryPure.ts`. Router wiring in `llmRouter.ts` captures `queuedAt`, `attemptSequence`, `fallbackIndex` on every add; payload snapshot in `server/services/llmInflightPayloadStore.ts` (LRU 100 / 200 KB cap with `originalSizeBytes` metadata on truncation); history fire-and-forget into `llm_inflight_history` (migration 0191) gated by a soft circuit breaker from `server/lib/softBreakerPure.ts` (50-sample window, 50% threshold, 5-min open). Client at `client/src/components/system-pnl/PnlInFlightTable.tsx` + `PnlInFlightPayloadDrawer.tsx` (row-click opens live payload; mobile card layout under `md:` breakpoint). Admin routes: snapshot + history + payload all on `server/routes/systemPnl.ts`. |
| Add a fire-and-forget persistence path | Use `server/lib/softBreakerPure.ts` — pure sliding-window breaker (config: `windowSize`, `minSamples`, `failThreshold`, `openDurationMs`). Pattern: wrap the write with `shouldAttempt(state, now)` before + `recordOutcome(state, success, now, config)` after; log exactly once on `trippedNow: true`. Example: `persistHistoryEvent` in `llmInflightRegistry.ts`. Never block the primary path on the breaker — it only gates the write, not the caller. |
| Stream tokens from a provider adapter | Adapter contract in `server/services/providers/types.ts` — optional `stream?(): AsyncIterable<StreamTokenChunk> & { done: Promise<ProviderResponse> }`. Router opt-in via `RouterCallParams.stream: true`. Server-side 1 Hz throttle per runtimeKey in `llmInflightRegistry.emitProgress()`; socket event `llm-inflight:progress`. Tripwires per `tasks/llm-inflight-deferred-items-brief.md` §5: cap per-stream memory, cap process-total-buffered-tokens, abort-safe cost attribution. No provider ships `stream()` yet — adding it is the hand-off from this branch. |
| View System-level LLM P&L | `/system/llm-pnl` (system-admin only). Service: `server/services/systemPnlService.ts`; routes: `server/routes/systemPnl.ts`; shared types: `shared/types/systemPnl.ts`; P&L math: `systemPnlServicePure.ts`. Reference UI: `prototypes/system-costs-page.html`. |
| Modify the per-run cost panel | `client/src/components/run-cost/RunCostPanel.tsx` (thin shell) + `RunCostPanelPure.ts` (branch decisions + formatters) + `shared/types/runCost.ts` (response type) + `server/routes/llmUsage.ts` (`/api/runs/:runId/cost` handler). Panel is hosted on `SessionLogCardList`, `RunTraceView`, and `AdminAgentEditPage`. Pure module covers the full §9.1 rendering matrix. |
| Modify the per-run cost breaker | `server/lib/runCostBreaker.ts` — five exports: `resolveRunCostCeiling`, `getRunCostCents` / `assertWithinRunBudget` (rollup-based; Slack + Whisper), `getRunCostCentsFromLedger` / `assertWithinRunBudgetFromLedger` (ledger-based; LLM router). Ledger helper uses a **merged visibility + SUM aggregate** (single scan returning both) — do not split; see `tasks/hermes-audit-tier-1-spec.md` §7.3.1. Hard-ceiling `>=` semantics (not `>`). |
| Modify outcome-gated entry-type promotion | `server/services/workspaceMemoryServicePure.ts` (`selectPromotedEntryType` / `scoreForOutcome` / `computeProvenanceConfidence` / `applyOutcomeDefaults`) + `workspaceMemoryService.ts::extractRunInsights` (wires outcome through). `runResultStatus` is derived by `agentExecutionServicePure.ts::computeRunResultStatus` and written exactly once at 3 terminal sites (normal + catch in `agentExecutionService.ts`; IEE in `agentRunFinalizationService.ts`) with `AND run_result_status IS NULL` guard. Per-entryType half-life decay lives in `memoryEntryQualityServicePure.ts::computeDecayFactor`. |
| Modify LLM ledger retention | `env.LLM_LEDGER_RETENTION_MONTHS` (default 12). Archive job: `server/jobs/llmLedgerArchiveJob.ts` + `llmLedgerArchiveJobPure.ts` (pure cutoff math). Registered in `server/services/queueService.ts` as `maintenance:llm-ledger-archive` at 03:45 UTC. |
| Add a new agent execution log event type | Extend the union in `shared/types/agentExecutionLog.ts` (AgentExecutionEventType + AgentExecutionEventPayload + AGENT_EXECUTION_EVENT_CRITICALITY) and add a validator branch in `server/services/agentExecutionEventServicePure.ts::validateEventPayload`. Emit via `tryEmitAgentEvent` in `server/services/agentExecutionEventEmitter.ts`. If the new type links to a new entity kind, extend `LinkedEntityType` + the mask branch in `server/lib/agentRunEditPermissionMaskPure.ts` + the batched label resolver in `server/lib/agentRunEditPermissionMask.ts`. Pure tests under `server/services/__tests__/agentExecutionEventServicePure.test.ts`. Spec: `tasks/live-agent-execution-log-spec.md` §5.3a. |
| Modify the Live Agent Execution Log read path | `server/routes/agentExecutionLog.ts` (3 GETs) + `server/services/agentExecutionEventService.ts` (`streamEvents` / `getPrompt` / `getLlmPayload`) + `server/lib/agentRunVisibility.ts` (canView / canViewPayload rules) + `server/lib/agentRunPermissionContext.ts` (user-context hydration). Migration 0192 carries the three new tables (`agent_execution_events`, `agent_run_prompts`, `agent_run_llm_payloads`) + adds `next_event_seq` + `event_limit_reached_emitted` to `agent_runs`. |
| Modify the Live Agent Execution Log payload writer | `server/services/agentRunPayloadWriter.ts::buildPayloadRow` — redaction → tool-policy → greatest-first truncation pipeline. Patterns in `server/lib/redaction.ts` (bearer / openai / anthropic / github / slack / aws / google). Per-tool opt-in via `payloadPersistencePolicy: 'full' \| 'args-redacted' \| 'args-never-persisted'`. Size cap: `AGENT_EXECUTION_LOG_MAX_PAYLOAD_BYTES` (default 1 MB). Pure tests in `server/services/__tests__/agentRunPayloadWriterPure.test.ts`. Modifications recorded in `agent_run_llm_payloads.modifications` + `redacted_fields` (separate columns — never overloaded). |
| Modify the Live Agent Execution Log client timeline | `client/src/pages/AgentRunLivePage.tsx` (snapshot+live merge, sliding-window cap `TIMELINE_WINDOW_SIZE = 2000`, cap-reached banner, sequence-gap + collision counters via `getAgentRunLiveClientMetrics()`) + `client/src/components/agentRunLog/{Timeline,EventRow,EventDetailDrawer}.tsx`. Socket hookup via `useSocketRoom('agent-run', runId, ...)`; server emitter `emitAgentExecutionEvent` in `server/websocket/emitters.ts`; room-join gate in `server/websocket/rooms.ts` runs the full `resolveAgentRunVisibility` AGENTS_VIEW check. |
| Add a new agent middleware | `server/services/middleware/`, `server/services/middleware/index.ts` |
| Add a new client page | `client/src/pages/`, router config in `client/src/App.tsx` |
| Add a new permission key | `server/lib/permissions.ts` |
| Add a new static gate | `scripts/verify-*.sh`, `scripts/run-all-gates.sh` |
| Add a new run-time test | `server/services/__tests__/` (pure file pattern: `*Pure.test.ts`) |
| Modify the agent execution loop | `server/services/agentExecutionService.ts`, `agentExecutionServicePure.ts` |
| Add a new workspace health detector | `server/services/workspaceHealth/detectors/`, then re-export from `detectors/index.ts` |
| Add a new feature or skill (docs) | `docs/capabilities.md` — update in the same commit as the code change |
| Add or update an integration capability | `docs/integration-reference.md` (structured YAML block) + update `OAUTH_PROVIDERS` in `server/config/oauthProviders.ts` or `MCP_PRESETS` in `server/config/mcpPresets.ts` — `scripts/verify-integration-reference.mjs` catches drift in CI |
| Modify Orchestrator routing logic | `migrations/0157_orchestrator_system_agent.sql` (masterPrompt), `server/jobs/orchestratorFromTaskJob.ts` (trigger handler), `server/tools/capabilities/` (discovery skill handlers) |
| Add a capability discovery skill | `server/tools/capabilities/` + register in `server/config/actionRegistry.ts` + `server/services/skillExecutor.ts` + decrement `SkillExecutionContext.capabilityQueryCallCount` |
| Add a canonical data table | `server/db/schema/`, migration with `UNIQUE(organisation_id, provider_type, external_id)`, add to `rlsProtectedTables.ts`, add RLS policy, update `server/config/canonicalDictionary.ts` |
| Add a connector adapter | `server/services/connectorPollingService.ts` (adapter wiring), `server/config/connectorPollingConfig.ts` (intervals) |
| Modify principal/RLS context | `server/db/withPrincipalContext.ts`, `server/config/rlsProtectedTables.ts`, migration for new policies |
| Modify a ClientPulse adapter dispatch path | `server/services/adapters/apiAdapter.ts` (dispatch) + `apiAdapterClassifierPure.ts` (retry classifier) + `ghlEndpoints.ts` (5 endpoint mappings) + `executionLayerService.ts` (precondition gate + per-subaccount advisory lock) |
| Modify canonical-JSON or idempotency-key derivation | `server/services/actionService.ts` — `canonicaliseJson`, `hashActionArgs`, `buildActionIdempotencyKey`, `computeValidationDigest`. Pinned by `actionServiceCanonicalisationPure.test.ts` — nested-key sort + present-vs-absent collapse + null-distinction + array-positional semantics. Retry-vs-replay contract is non-negotiable (see `buildActionIdempotencyKey` header comment) |
| Modify the ClientPulse drilldown | `server/routes/clientpulseDrilldown.ts` (4 routes) + `server/services/drilldownService.ts` + `server/services/drilldownOutcomeBadgePure.ts` (badge rules) + `client/src/pages/ClientPulseDrilldownPage.tsx` + `client/src/components/clientpulse/drilldown/` — always scope reads by `organisationId` + `subaccountId` |
| Modify a ClientPulse live-data picker | `server/services/crmLiveDataService.ts` (60s in-memory cache, MAX_CACHE_ENTRIES=500) + `server/services/adapters/ghlReadHelpers.ts` (scoped GHL calls) + `client/src/components/clientpulse/pickers/LiveDataPicker.tsx` (debounce + keyboard + 429 backoff) |
| Modify notify_operator fan-out | `server/services/notifyOperatorFanoutService.ts` (orchestrator) + `server/services/notifyOperatorChannels/*.ts` (in-app/email/slack) + pure `availabilityPure.ts` + `server/services/skillExecutor.ts` notify_operator case |
| Modify the CRM Query Planner | Spec: `tasks/builds/crm-query-planner/spec.md`. Orchestration: `server/services/crmQueryPlanner/crmQueryPlannerService.ts` (§3 / §19; wraps pipeline in `withPrincipalContext` per §16.4 when outer `withOrgTx` is active; `runLlmStage3` seam on `RunQueryDeps` for test stubbing). Pure layer: `normaliseIntentPure.ts`, `registryMatcherPure.ts`, `validatePlanPure.ts` (10-rule validator + three-case canonical-precedence — case b uses `isLiveOnlyField` from `liveExecutorPure.ts`), `planCachePure.ts`, `approvalCardGeneratorPure.ts`, `plannerCostPure.ts`, `resultNormaliserPure.ts`, `schemaContextPure.ts`, `llmPlannerPromptPure.ts`. Executors: `executors/canonicalExecutor.ts` (skip-unknown-capability rule §12.1 + debug `canonical.capability_skipped`), `executors/liveExecutor.ts` + `liveExecutorPure.ts` (rate-limiter keyed on real GHL `locationId` from `resolveGhlContext`, NOT `context.subaccountLocationId`), `executors/hybridExecutor.ts` + `hybridExecutorPure.ts` (row-count guard before live dispatch), `executors/canonicalQueryRegistry.ts` + `canonicalQueryRegistryMeta.ts`. LLM fallback: `llmPlanner.ts` (single-escalation retry; passes `wasEscalated: true` + `escalationReason` on router context so `getPlannerMetrics.escalationRate` populates). Cache: `planCache.ts` (LRU with discriminated `{ hit, plan, entry } \| { hit: false, reason }` result). Events: `plannerEvents.ts` (forwards ONLY `planner.result_emitted` / `planner.error_emitted` to agent execution log — exactly one `skill.completed` per planner run). Budget classification: `isBudgetExceededError` helper discriminates `{statusCode: 402, code: 'BUDGET_EXCEEDED'}` vs `RATE_LIMITED`; `classifyStage3FallbackSubcategory` splits `parse_failure` / `rate_limited` / `planner_internal_error` / `validation_failed` on `errorSubcategory` (external `ambiguous_intent` unchanged). Route: `server/routes/crmQueryPlanner.ts` (authenticate → `resolveSubaccount` → `listAgentCapabilityMaps` union for `crm.query` gate). Skill surface: `'crm.query'` handler in `server/services/skillExecutor.ts` with `allowedSubaccountIds` enforcement mirroring `executeQuerySubaccountCohort`. Observability: `getPlannerMetrics` in `server/services/systemPnlService.ts` + route in `server/routes/systemPnl.ts` + `SystemPnlPage.tsx` panel. Trace: `PlannerTrace` accumulator threaded through pipeline with top-level `executionMode: 'stage1' \| 'stage2_cache' \| 'stage3_live'` + deep-frozen at terminal emission. CI guard: `scripts/verify-crm-query-planner-read-only.sh` (import-restriction enforcement; read-only is structural). |

---

## Architecture Rules (Automation OS specific)

These are non-negotiable. Violations are blocking issues in any code review.

### Server
- **Routes** call services only — never access `db` directly in a route
- **`asyncHandler`** wraps every async handler — no manual try/catch in routes
- **Service errors** throw as `{ statusCode, message, errorCode? }` — never raw strings
- **`resolveSubaccount(subaccountId, orgId)`** called in every route with `:subaccountId`
- **Auth middleware** — `authenticate` always first, then permission guards as needed
- **Org scoping** — all queries filter by `organisationId` using `req.orgId` (not `req.user.organisationId`)
- **Soft deletes** — always filter with `isNull(table.deletedAt)` on soft-delete tables
- **Schema changes** — Drizzle migration files only; never raw SQL schema changes

### Agent system
- **Three-tier model** (System → Org → Subaccount) must be respected in all agent-related changes
- **System-managed agents** — `isSystemManaged: true` means masterPrompt is not editable; only additionalPrompt
- **Idempotency keys** — all new agent run creation paths must support deduplication
- **Heartbeat changes** — account for `heartbeatOffsetMinutes` (minute-level precision)
- **Handoff depth** — check `MAX_HANDOFF_DEPTH` (5) in `server/config/limits.ts`

### Client
- **Lazy loading** — all page components use `lazy()` with `Suspense` fallback
- **Permissions-driven UI** — visibility gated by `/api/my-permissions` or `/api/subaccounts/:id/my-permissions`
- **Real-time updates** — new features that update state use WebSocket rooms via `useSocket`
- **Tables: column-header sort + filter by default** — every data table must have Google Sheets-style column headers: clicking a header opens a dropdown with sort (A→Z / Z→A) and, for columns with a finite value set, filter checkboxes. Sort applies to all columns. Filters apply to columns whose values are categorical (status, visibility, boolean flags, etc.). Active sort shows ↑/↓ next to the label; active filters show an indigo dot. A "Clear all" button appears in the page header when any sort or filter is active. Implementation pattern: `SystemSkillsPage.tsx` — `ColHeader` + `NameColHeader` components, `Set<T>`-based filter state, client-side sort/filter computed before render.
