# Automation OS — Architecture Guide

Read this before making any backend changes. It documents the conventions, patterns, and systems that make up this codebase.

---

## Project Structure

```
server/
├── routes/          Route files — one per domain (~41 files)
├── services/        Business logic — one per domain (~73 files)
├── db/schema/       Drizzle ORM table definitions (~62 files)
├── middleware/      Express middleware (auth, validation, correlation)
├── lib/             Shared utilities (asyncHandler, permissions, logger, etc.)
├── config/          Environment, action registry, system limits
├── skills/          File-based skill definitions (29 built-in skills as .md files)
└── index.ts         Express app setup, route mounting

client/
├── src/pages/       30+ page components (lazy-loaded)
├── src/components/  Reusable UI components (~13 files)
├── src/hooks/       useSocket.ts (WebSocket integration)
└── src/lib/         api.ts, auth.ts, socket.ts
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

---

## Idempotency Keys

Agent runs accept an `idempotencyKey` (migration 0040). Prevents duplicate execution on client retry.

Format: `{runType}:{agentId}:{subaccountId}:{userId}:{taskId}:{timeWindow}`

System agents generate keys automatically. External callers should provide a deterministic key.

---

## Skill System

### File-based definitions

Skills are defined as Markdown files in `server/skills/*.md`. There are 29 built-in system skills:

| Category | Skills |
|----------|--------|
| Agent collaboration | `spawn_sub_agents`, `request_approval` |
| Workspace | `read_workspace`, `write_workspace`, `read_codebase` |
| Task management | `create_task`, `move_task`, `update_task`, `reassign_task`, `add_deliverable` |
| Testing | `run_tests`, `run_playwright_test`, `write_tests` |
| Code | `review_code`, `write_patch`, `search_codebase`, `create_pr` |
| Integration | `web_search`, `fetch_url`, `fetch_paywalled_content`, `send_email`, `send_to_slack`, `transcribe_audio` |
| Admin | `triage_intake`, `draft_architecture_plan`, `draft_tech_spec`, `report_bug` |
| Execution | `run_command`, `trigger_process`, `capture_screenshot` |
| Pages (CMS-style) | `create_page`, `update_page`, `publish_page`, `analyze_endpoint` |
| Reporting Agent | `read_inbox`, `read_org_insights`, `write_org_insight`, `query_subaccount_cohort`, `compute_health_score`, `compute_churn_risk`, `detect_anomaly`, `generate_portfolio_report`, `trigger_account_intervention`, `review_ux` |

`send_to_slack`, `transcribe_audio`, and `fetch_paywalled_content` were added with the Reporting Agent feature (migrations 0072–0074). All three go through `withBackoff` for retries and `runCostBreaker` for cost ceilings.

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

---

## Review Gates & HITL

Tasks can set `reviewRequired: true`. When an agent acts on such a task, actions escalate to the review queue before executing.

- Review queue: `reviewItems` table
- Human approves or rejects via UI
- Integrates with `hitlService` for human-in-the-loop workflows
- Review decisions logged to `reviewAuditRecords`
- All review actions emit audit events

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

- `workspaceMemories` table stores entities (type, content, tags, embedding)
- `workspaceMemoryService` handles CRUD and retrieval
- `memoryDecayJob` clears stale memories on a schedule
- Embeddings supported for semantic search across memories
- Used by orchestrator agent to accumulate cross-run context

---

## Policy Engine

`policyRules` table defines constraints on agent behaviour. `policyEngineService` evaluates rules during execution — can restrict actions, require escalation, or block execution. Evaluated before skill execution in the processor pipeline.

---

## Cost Tracking & Budgets

- `budgetReservations` — pre-allocate token budget before a run starts
- `costAggregates` — actual spend tracked after run completes
- `budgetService` — enforces per-run and per-org limits; throws if exceeded
- `llmPricing` table — model + provider pricing reference
- `llmRequests` table — every LLM call logged with tokens, cost, model

---

## Event-Driven Architecture

- **pg-boss** — job queue for all async work (handoffs, heartbeats, scheduled tasks)
- **WebSocket (Socket.IO)** — real-time updates to client. Rooms: subaccount tasks, agent runs
- **`useSocket` hook** — client subscribes to subaccount-scoped room for live updates
- **Audit events** — all significant actions logged to `auditEvents` with actor, action, resource
- **Correlation IDs** — `correlation.ts` middleware generates per-request IDs for log tracing

---

## Client Patterns

- **Lazy loading** — all page components use `lazy()` with `Suspense` fallback
- **Permissions-driven nav** — `Layout.tsx` loads `/api/my-permissions` and `/api/subaccounts/:id/my-permissions` to show/hide nav items
- **Real-time updates** — `useSocket` hook subscribes to WebSocket rooms for live board/run updates
- **API wrapper** — all HTTP calls go through `src/lib/api.ts`

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

74 migrations (0001–0074). Schema changes go through SQL migration files in `migrations/`. **Migrations are run by the custom forward-only runner at `scripts/migrate.ts`** (`npm run migrate`) — drizzle-kit migrate is no longer used for production. The runner is forward-only by design; rollback is manual against the corresponding `*.down.sql` file in local environments only.

Recent migrations:
- `0075` — playbooks: templates, versions, runs, step runs (Playbooks feature — planned)
- `0074` — `skills.visibility` three-state cascade (`none` / `basic` / `full`) replacing the boolean `contentsVisible`
- `0073` — Reporting Agent paywall workflow (web login connections, IEE artifacts/runs/steps extensions, agent run extensions)
- `0072` — original `skills.contentsVisible` flag (superseded by 0074 three-state cascade)
- `0041` — heartbeat offset minutes (minute-precision scheduling)
- `0040` — agent run idempotency key
- `0039` — GitHub App schema
- `0037` — workspace memory + workflow schema
- `0036` — review queue + OAuth tables

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

### Schema (migration 0042)

| Table | Purpose |
|-------|---------|
| `systemPlaybookTemplates` | Platform-shipped templates. Mirrors `systemAgents`. |
| `systemPlaybookTemplateVersions` | Immutable version snapshots of system templates. |
| `playbookTemplates` | Org-owned templates. `forkedFromSystemId`, `forkedFromVersion` nullable. |
| `playbookTemplateVersions` | Immutable published versions of org templates. `definitionJson` holds the full DAG. |
| `playbookRuns` | Run instances. `subaccountId`, `templateVersionId`, `status`, `contextJson`, `startedBy`, `startedAt`, `completedAt`. |
| `playbookStepRuns` | Per-step execution records. `runId`, `stepId`, `status`, `inputJson`, `outputJson`, `agentRunId` (nullable link), `dependsOn[]`, `startedAt`, `completedAt`, `error`. |
| `playbookStepReviews` | Human approval gate records for steps with `humanReviewRequired: true`. Links to `reviewItems`. |

Soft deletes on templates (`deletedAt`). Runs are append-only history.

### Step definition shape (stored in `definitionJson`)

```typescript
interface PlaybookStep {
  id: string;                    // stable within template version
  name: string;
  type: 'prompt' | 'agent_call' | 'user_input' | 'approval' | 'conditional';
  dependsOn: string[];           // ids of prior steps
  humanReviewRequired?: boolean; // pause for edit/approve before downstream consumes output
  outputSchema: JSONSchema;      // zod-validated; downstream steps rely on shape

  // type-specific
  prompt?: string;                               // prompt with {{ templating }}
  agentId?: string;                              // for type: agent_call — references org or system agent
  formSchema?: JSONSchema;                       // for type: user_input — renders as form in UI
  condition?: string;                            // for type: conditional — JSONLogic expression
  inputs?: Record<string, string>;               // map of paramName -> template expression
}

interface PlaybookDefinition {
  steps: PlaybookStep[];
  initialInputSchema: JSONSchema;  // what the user provides when kicking off the run
}
```

### Side-effect classification (mandatory)

Every step declares a `sideEffectType`: `none` | `idempotent` | `reversible` | `irreversible`. This drives mid-run editing safety — `none`/`idempotent` re-run automatically, `reversible` requires confirmation, `irreversible` is **default-blocked** with a "skip and reuse previous output" option. Snapshotted to `playbook_step_runs.side_effect_type` so it can't drift after the run starts.

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
5. On any step completion (webhook from agent run, form submission, approval decision), validate output against `outputSchema`, merge into `run.contextJson`, re-enqueue a tick.
6. If all steps `completed`, mark run `completed`. If any non-retryable failure and no alternative branch, mark `failed`.

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

- **Agent runs** — `agent_call` step type creates an `agentRun` with `playbookStepRunId` set. The full three-tier agent model, skill system, handoff, and budget tracking are reused unchanged.
- **Review queue** — `approval` step type creates a `reviewItem`. HITL flow is unchanged.
- **pg-boss** — engine ticks are jobs on the `playbook-run-tick` queue. Same infrastructure as heartbeats.
- **Idempotency keys** — step-level agent runs use `playbook:{runId}:{stepId}:{attempt}` as the key.
- **WebSocket rooms** — run updates broadcast on the subaccount room; a dedicated `playbook-run:{runId}` room streams per-step progress to detail UI.
- **Audit events** — run start, step completion, edits, approvals, template publish all emit audit events.

### Routes

| Route | File | Purpose |
|-------|------|---------|
| `/api/system/playbook-templates` | `systemPlaybookTemplates.ts` | System admin CRUD on platform templates |
| `/api/playbook-templates` | `playbookTemplates.ts` | Org CRUD, fork from system, publish version |
| `/api/playbook-templates/:id/versions` | `playbookTemplates.ts` | List/get versions |
| `/api/subaccounts/:subaccountId/playbook-runs` | `playbookRuns.ts` | List, start, cancel runs |
| `/api/playbook-runs/:runId` | `playbookRuns.ts` | Run detail, context, step runs |
| `/api/playbook-runs/:runId/steps/:stepRunId/input` | `playbookRuns.ts` | Submit form input for `user_input` step |
| `/api/playbook-runs/:runId/steps/:stepRunId/output` | `playbookRuns.ts` | Edit a completed step's output (invalidates downstream) |
| `/api/playbook-runs/:runId/steps/:stepRunId/approve` | `playbookRuns.ts` | Approve/reject an `approval` step |

All routes follow the standard conventions: `asyncHandler`, `authenticate`, `resolveSubaccount` where applicable, org scoping via `req.orgId`, no direct `db` access, service errors as `{ statusCode, message, errorCode }`.

### Services

| Service | Responsibility |
|---------|---------------|
| `playbookTemplateService` | CRUD, fork from system, version publishing, validation of DAG (no cycles, all deps resolvable, output schemas valid) |
| `playbookEngineService` | State machine ticks, step dispatch, context merging, downstream invalidation |
| `playbookRunService` | Run lifecycle — start, cancel, query, surface to UI |
| `playbookTemplatingService` | Resolves `{{ steps.x.output.y }}` expressions against run context; pure function, unit-testable |

### Permissions

New permission keys:

- `playbook_templates.read` / `playbook_templates.write` / `playbook_templates.publish` (org-level)
- `playbook_runs.read` / `playbook_runs.start` / `playbook_runs.cancel` / `playbook_runs.edit_output` / `playbook_runs.approve` (subaccount-level)

Integrate into the existing permission set UI.

### Client UI

**Phase 1 — Run execution UI (ship with engine):**

- `/playbooks` — list of available templates (org + forked from system), "Start Run" picker
- `/subaccounts/:id/playbook-runs` — list of runs for a subaccount, status + progress (e.g. 7/15)
- `/playbook-runs/:runId` — run detail: vertical stepper showing DAG, each step expandable with inputs/output, edit button on completed steps, inline forms for `user_input` steps, approval UI for `approval` steps, live updates via WebSocket
- "Needs your input" inbox surfacing all paused runs across subaccounts the user has access to

**Phase 2 — Visual template builder:**

- `/playbook-templates/:id/edit` — canvas-based DAG editor (nodes = steps, edges = dependencies)
- Sidebar for editing each step (type, prompt, agent, input mapping, output schema)
- Version history + diff view
- Test-run mode against a dummy subaccount

Phase 1 ships with templates seeded from code/JSON. Phase 2 is a separate feature-coordinator pipeline.

### Invariants (non-negotiable)

- DAG validation must run on every template publish — reject cycles, unresolved `dependsOn`, or template expressions referencing nonexistent steps.
- A run is locked to its `templateVersionId`. Editing the template never mutates in-flight runs.
- Step output is validated against `outputSchema` before merging into run context.
- **Every step declares a `sideEffectType`.** No defaults. CI fails if any seeded playbook has a step without one.
- Mid-run editing **never auto-re-executes `irreversible` steps** — user must explicitly opt in per step or choose skip-and-reuse.
- Templating resolver **must use `Object.create(null)` contexts** and blocklist `__proto__`/`constructor`/`prototype`. Whitelist allowed top-level prefixes (`run.input.`, `run.subaccount.`, `run.org.`, `steps.`).
- Tick jobs **must be enqueued with `singletonKey: runId`** to prevent tick storms.
- Tick handlers **must use the non-blocking advisory lock variant**. Blocking is forbidden.
- Step completion + tick enqueue happen in a single DB transaction; the watchdog is the safety net, not the primary mechanism.
- `agent_call` steps respect the full budget, handoff depth, and policy engine rules — the engine never bypasses existing guardrails.
- Org scoping applies to templates (`organisationId`) and runs (`organisationId` via subaccount).

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

### Schema (migrations 0070, 0071)

| Table | Purpose |
|-------|---------|
| `ieeRuns` | One row per IEE job. Fields: `agentRunId`, `type` (`browser`\|`dev`), `status` (`pending`\|`running`\|`completed`\|`failed`), `idempotencyKey`, `correlationId`, `goal`, `task` (JSONB), `resultSummary`, `stepCount`, `llmCostCents`, `runtimeCostCents`, `totalCostCents`, `workerInstanceId`, `lastHeartbeatAt`, `eventEmittedAt`. Soft delete. Unique partial index on `idempotencyKey WHERE deletedAt IS NULL`. |
| `ieeSteps` | Append-only per-step log. Fields: `ieeRunId`, `stepNumber`, `actionType`, `input`, `output`, `success`, `failureReason`, `durationMs`. Unique on `(ieeRunId, stepNumber)` to prevent retry double-writes. |
| `ieeArtifacts` | Metadata for files/downloads emitted by a run. v1 stores metadata only; contents live on worker disk. |

**LLM attribution** — `llmRequests` table gains `ieeRunId` (nullable FK) and `callSite` (`app`\|`worker`). Database CHECK constraint: `source_type <> 'iee' OR iee_run_id IS NOT NULL`.

### Routing — how a task reaches IEE

Decision happens in `agentExecutionService.executeAgentRun`:

```typescript
if (effectiveMode === 'iee_browser' || effectiveMode === 'iee_dev') {
  if (!request.ieeTask) throw { statusCode: 400, message: 'ieeTask required' };
  const { enqueueIEETask } = await import('./ieeExecutionService.js');
  const enqueueResult = await enqueueIEETask({ task, organisationId, subaccountId, agentId, agentRunId, correlationId });
  // Return synthetic loopResult — canonical state lives on the ieeRuns row.
}
```

`executionMode` is one of `api` | `headless` | `claude-code` | `iee_browser` | `iee_dev`. The IEE branch parks the agent run and lets the worker drive the actual execution.

### Services & Routes

| Service | Responsibility |
|---------|----------------|
| `ieeExecutionService` | Enqueue task. Idempotent insert (ON CONFLICT on `idempotencyKey`), budget reservation, pg-boss send, tracing. |
| `ieeUsageService` | Per-run cost breakdown and aggregated usage queries (system / org / subaccount scope). Joins `ieeRuns` ⨝ `llmRequests`. |

| Route | File | Purpose |
|-------|------|---------|
| `GET /api/iee/runs/:ieeRunId/cost` | `iee.ts` | Per-run cost breakdown (app vs worker LLM, runtime) |
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

`FailureReason` enum: `timeout` | `step_limit_reached` | `execution_error` | `environment_error` | `auth_failure` | `budget_exceeded` | `unknown`.

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

`llmRouter.routeCall` enforces, at runtime:

```typescript
if (ctx.sourceType === 'iee' && !ctx.ieeRunId) throw new RouterContractError(...);
if (ctx.callSite === 'worker' && !ctx.ieeRunId) throw new RouterContractError(...);
```

The database CHECK constraint on `llmRequests` is the belt-and-braces backstop.

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
