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
| Code | `review_code`, `write_patch`, `search_codebase` |
| Integration | `web_search`, `fetch_url`, `send_email` |
| Admin | `triage_intake`, `draft_architecture_plan`, `draft_tech_spec`, `report_bug` |
| Execution | `run_command`, `trigger_process`, `capture_screenshot` |

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

41 migrations (0001–0041). Schema changes go through Drizzle migration files in `migrations/`. Never write raw SQL schema changes outside migrations.

Recent migrations:
- `0042` — playbooks: templates, versions, runs, step runs (Playbooks feature)
- `0041` — heartbeat offset minutes (minute-precision scheduling)
- `0040` — agent run idempotency key
- `0039` — GitHub App schema
- `0037` — workspace memory + workflow schema
- `0036` — review queue + OAuth tables

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

**Editing mid-run** — when a user edits a completed step's output, engine invalidates all downstream step runs (sets them back to `pending`) and re-ticks. This is the "reusing information from previous prompts, but sometimes there is some new information" loop.

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
- Editing a completed step's output invalidates all transitively dependent downstream step runs.
- `agent_call` steps respect the full budget, handoff depth, and policy engine rules — the engine never bypasses existing guardrails.
- Org scoping applies to templates (`organisationId`) and runs (`organisationId` via subaccount).
