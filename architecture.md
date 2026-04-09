# Automation OS — Architecture Guide

Read this before making any backend changes. It documents the conventions, patterns, and systems that make up this codebase.

---

## Project Structure

```
server/
├── routes/          Route files — one per domain (~67 files)
├── services/        Business logic — one per domain (~117 files, includes *Pure.ts companions)
├── db/schema/       Drizzle ORM table definitions (~97 files)
├── middleware/      Express middleware (auth, validation, correlation, org scoping)
├── lib/             Shared utilities (asyncHandler, permissions, scopeAssertion, orgScopedDb, etc.)
├── config/          Environment, action registry, system limits, RLS manifest, topic registry
├── skills/          File-based skill definitions (53 built-in skills as .md files)
├── jobs/            Background jobs (cleanup, regression replay, security event pruning)
├── tools/           Internal tool implementations (askClarifyingQuestion, readDataSource)
└── index.ts         Express app setup, route mounting

client/
├── src/pages/       ~74 page components (lazy-loaded)
├── src/components/  Reusable UI components (~21 files)
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
| `tokenBudgetPerRun` / `maxToolCallsPerRun` / `timeoutSeconds` / `maxCostPerRunCents` / `maxLlmCallsPerRun` | Hard ceilings enforced by `runCostBreaker` and the execution loop. `maxCostPerRunCents` plugs into the shared cost circuit breaker (`server/lib/runCostBreaker.ts`). |
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

---

## Skill System

### File-based definitions

Skills are defined as Markdown files in `server/skills/*.md`. There are 53 built-in system skills:

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
| Reporting Agent | `read_inbox`, `read_org_insights`, `write_org_insight`, `query_subaccount_cohort`, `compute_health_score`, `compute_churn_risk`, `detect_anomaly`, `generate_portfolio_report`, `trigger_account_intervention`, `review_ux`, `analyse_42macro_transcript` |
| Playbook Studio | `playbook_read_existing`, `playbook_validate`, `playbook_simulate`, `playbook_estimate_cost`, `playbook_propose_save` |

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

`read_data_source` and `update_memory_block` are injected into every agent run via the universal skills list in `server/config/universalSkills.ts`.

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

### Critique gate

`server/services/middleware/critiqueGate.ts` / `critiqueGatePure.ts` — separate from the pipeline, invoked at specific decision points to run a second-opinion evaluation before committing to an action. Used by the playbook step review flow.

---

## Policy Engine

`policyRules` table defines constraints on agent behaviour. `policyEngineService` evaluates rules during execution — can restrict actions, require escalation, or block execution. Evaluated before skill execution in the processor pipeline. Sprint 3 adds `confidence_threshold` and `guidance_text` columns (migration 0085) enabling decision-time guidance — the middleware injects guidance when a rule matches but confidence is above the threshold.

---

## Row-Level Security (RLS) — Three-Layer Fail-Closed Data Isolation

Sprint 2 introduces a defence-in-depth data isolation model. All three layers are required; no single layer is sufficient alone.

### Layer 1 — Postgres RLS policies

10 tables protected (migrations 0079–0081): `tasks`, `actions`, `agent_runs`, `agent_run_snapshots`, `review_items`, `review_audit_records`, `workspace_memories`, `llm_requests`, `audit_events`. Each has a `CREATE POLICY` keyed on `current_setting('app.organisation_id', true)`.

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

---

## Event-Driven Architecture

- **pg-boss** — job queue for all async work (handoffs, heartbeats, scheduled tasks)
- **WebSocket (Socket.IO)** — real-time updates to client. Rooms: subaccount tasks, agent runs
- **`useSocket` hook** — client subscribes to subaccount-scoped room for live updates
- **Audit events** — all significant actions logged to `auditEvents` with actor, action, resource
- **Correlation IDs** — `correlation.ts` middleware generates per-request IDs for log tracing

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

20 test files in `server/services/__tests__/` (~4200 lines). Key coverage:
- `agentExecution.smoke.test.ts` — end-to-end agent execution
- `rls.context-propagation.test.ts` — iterates `rlsProtectedTables.ts` to assert Layer B holds
- `agentExecutionServicePure.checkpoint.test.ts` — crash-resume parity
- `policyEngineService.scopeValidation.test.ts` — scope violation detection
- Pure helper tests: `critiqueGatePure.test.ts`, `reflectionLoopPure.test.ts`, `trajectoryServicePure.test.ts`, etc.

Test infrastructure: `server/lib/__tests__/llmStub.ts` — shared LLM mock for deterministic testing. `server/services/__tests__/fixtures/loadFixtures.ts` — fixture loader.

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

92 migrations (0001–0090, plus down-migrations). Schema changes go through SQL migration files in `migrations/`. **Migrations are run by the custom forward-only runner at `scripts/migrate.ts`** (`npm run migrate`) — drizzle-kit migrate is no longer used for production. The runner is forward-only by design; rollback is manual against the corresponding `*.down.sql` file in local environments only.

Recent migrations:
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

### Schema (migration 0076)

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
