# Development Brief v2: Human-in-the-Loop Autonomous Agent Platform

## Part 1: Critical Analysis & Current State Assessment

**Date:** 2026-03-29
**Context:** Review of the v6 Unified Production Spec against what actually exists in the codebase.

---

## 1. What Already Exists (The Brief Ignores This)

The v6 spec reads as if we're starting from zero. We are not. Here's what's already built and working:

### 1.1 Agent Runtime (Substantial)

| Component | Status | Location |
|-----------|--------|----------|
| Agent definitions (org-scoped) | **Built** | `server/db/schema/agents.ts` |
| System agents (platform IP layer) | **Built** | `server/db/schema/systemAgents.ts` |
| Agent-to-workspace linking | **Built** | `server/db/schema/subaccountAgents.ts` with per-client overrides |
| Agent run records | **Built** | `server/db/schema/agentRuns.ts` — status, tokens, duration, tool calls, summary |
| Agentic loop | **Built** | `server/services/agentExecutionService.ts` — full LLM loop with tool execution |
| 3-layer prompt assembly | **Built** | System prompt → org prompt → subaccount instructions |
| Middleware pipeline | **Built** | `server/services/middleware/` — budget check, loop detection, tool restriction, error handling |
| Skill/tool system | **Built** | `server/services/skillExecutor.ts` — 8 skills: create_task, move_task, add_deliverable, reassign_task, spawn_sub_agents, web_search, read_workspace, write_workspace |
| System skills (hidden from orgs) | **Built** | `server/services/systemSkillService.ts` |
| Token budget enforcement | **Built** | Per-run budgets with wrap-up on exhaustion |
| Agent handoffs | **Built** | Agent-to-agent task handoff via pg-boss queue, max depth 5 |
| Sub-agent spawning | **Built** | `spawn_sub_agents` tool with budget splitting, max 3 children |

### 1.2 Task / Board System (Built)

| Component | Status | Location |
|-----------|--------|----------|
| Tasks (kanban items) | **Built** | `server/db/schema/tasks.ts` — status, priority, assignment, brief |
| Task activities (audit log) | **Built** | `server/db/schema/taskActivities.ts` |
| Task deliverables | **Built** | `server/db/schema/taskDeliverables.ts` |
| Board config (columns) | **Built** | `server/db/schema/boardConfigs.ts` with org + subaccount hierarchy |
| Board templates | **Built** | System-level board column templates |
| Kanban UI | **Built** | `client/src/pages/WorkspaceBoardPage.tsx` with drag-and-drop |
| Task modal (create/edit) | **Built** | `client/src/components/TaskModal.tsx` |

### 1.3 Memory System (Built)

| Component | Status | Location |
|-----------|--------|----------|
| Workspace memories (summaries) | **Built** | `server/db/schema/workspaceMemories.ts` |
| Memory entries (raw observations) | **Built** | Per-run insight extraction |
| Memory extraction post-run | **Built** | `workspaceMemoryService.extractRunInsights()` |
| Memory summarisation | **Built** | Periodic summarisation after N runs |
| Memory injection into prompts | **Built** | `workspaceMemoryService.getMemoryForPrompt()` |
| Memory UI | **Built** | `client/src/pages/WorkspaceMemoryPage.tsx` |

### 1.4 Scheduling (Built)

| Component | Status | Location |
|-----------|--------|----------|
| Scheduled tasks (RRULE + cron) | **Built** | `server/db/schema/scheduledTasks.ts` |
| pg-boss queue integration | **Built** | `server/services/queueService.ts` + `agentScheduleService.ts` |
| Retry policies | **Built** | Max retries, backoff, pause on consecutive failures |
| Manual + scheduled + triggered runs | **Built** | `runType` field on agent runs |

### 1.5 Multi-Tenancy & Permissions (Built)

| Component | Status | Location |
|-----------|--------|----------|
| Organisations (tenant root) | **Built** | Org-scoped everything |
| Subaccounts (workspaces) | **Built** | Client/workspace entities within orgs |
| 5-role hierarchy | **Built** | system_admin → org_admin → manager → user → client_user |
| Permission sets | **Built** | Fine-grained permission_sets + permission_set_items |
| JWT auth | **Built** | 24h tokens, middleware enforcement |
| Invite-only onboarding | **Built** | No self-registration |

### 1.6 Integrations (Partial)

| Component | Status | Location |
|-----------|--------|----------|
| Email (SendGrid/Resend/SMTP) | **Built** | `server/services/emailService.ts` — platform emails only (invites, resets). Not exposed as agent skill. |
| File storage (R2/S3) | **Built** | `server/services/fileService.ts` |
| Data sources (HTTP, Google Docs, Dropbox, R2/S3, file upload) | **Built** | `server/db/schema/agentDataSources.ts` — caching, fallback, email alerts on failure |
| Workflow engines (n8n adapter) | **Built** | `server/services/engineService.ts` |
| LLM (Anthropic Claude) | **Built** | `server/services/llmService.ts` — Sonnet 4.6 default, configurable per agent |
| Web search (Tavily) | **Built** | Optional agent skill |
| External service connections (Gmail, GitHub, CRM, ad platforms) | **NOT built** | No stored connection model, no provider auth |

### 1.7 Frontend (54 Pages)

Key pages already built:
- Agent list, chat, admin edit pages
- Kanban board with drag-and-drop
- Execution history and detail
- Scheduled task management
- Workspace memory UI
- System admin pages (agents, skills, orgs, users, activity, queue)
- Admin pages (agents, tasks, subaccounts, skills, users, settings, board config)
- Portal pages (client-facing)

---

## 2. What's Actually Missing

The v6 brief proposes ~30 new tables and services. Most duplicate what already exists. Here's the **genuine delta**:

### 2.1 Action System (The Core Gap)

**Currently:** Agents execute tools directly via `skillExecutor`. There is no intermediate "proposed action" object. When an agent calls `create_task` or `move_task`, it happens immediately with no gate, no approval step.

**What's needed:**
- `actions` table — proposed work units with structured payload
- Action state machine: `proposed → pending_approval → approved → executing → completed/failed/rejected`
- Gate levels per action type: `auto | review | block`
- `is_external` flag — internal vs boundary actions
- Idempotency keys — prevent duplicate execution
- `action_events` table — audit trail of every state transition

### 2.2 Execution Layer with Adapter Pattern

**Currently:** `skillExecutor.ts` is a switch statement where each case directly executes. No separation between "propose" and "execute", no adapter abstraction.

**What's needed:**
- Execution service that dispatches approved actions to adapters
- Adapter registry: action_type → adapter (API adapter for Phase 1; browser/devops later)
- Adapter interface: validate → idempotency check → execute → capture result
- Provider abstraction for external services (EmailProvider, etc.)

### 2.3 Review / Approval System

**Currently:** Agents move kanban tasks to "review" status. Humans see them on the board. No structured review queue, no approve/reject/edit flow, no backend enforcement preventing execution without approval.

**What's needed:**
- `review_items` table (projection of actions requiring human sign-off)
- Review queue UI — dedicated page, not the kanban board
- Approve / Edit+Approve / Reject from UI
- Backend enforcement: `gate_level=review` actions cannot execute without an approval record
- Review payload: original context, agent reasoning, proposed payload, edit capability

### 2.4 Integration Connections

**Currently:** No stored connection model for external services agents would consume.

**What's needed:**
- `integration_connections` table — subaccount-scoped, provider_type, encrypted credential ref
- Provider interfaces (EmailProvider at minimum for Phase 1)
- Connection management UI
- Strict tenant isolation

### 2.5 Processed Resources / Deduplication

**Currently:** No mechanism to track "we already processed Gmail message X" across runs.

**What's needed:**
- `processed_resources` table — integration_type, resource_type, external_id, subaccount-scoped
- Checked before agent processes any external input
- Prevents duplicate work across scheduled runs

### 2.6 Missing Agent Skills

The current 8 skills cover internal board operations only. Real workflows need:

| Skill | Priority | Needed For |
|-------|----------|------------|
| `send_email` | Critical | Any outbound communication (support replies, notifications) |
| `read_inbox` | Critical | Support agent inbox polling |
| `request_approval` | Critical | Agent signals it needs human sign-off mid-run |
| `fetch_url` | High | Reading external URLs, lightweight API calls |
| `search_records` / `update_record` | High | CRM/support context lookup and update |

Note: `emailService` already exists in the backend — it just needs a skill wrapper and a gate.

### 2.7 Observability Gaps

**Currently:** Run data is in the database. No trace viewer, no cost attribution, limited error context in UI.

**What's needed:**
- Run trace viewer — system prompt snapshot, each LLM call, tool calls, token counts
- Cost estimate per run (approximate $/run)
- Validation failure visibility in run logs

### 2.8 Orchestrator Agent (Phase 2)

**Currently:** Agents work independently. No strategic coordination.

**Needed later:**
- Orchestrator agent type reads workspace state, writes directives
- `orchestrator_directives` table
- Morning plan / evening summary schedule
- Directives injected into other agents' context

---

## 3. Critical Problems with the v6 Brief

### 3.1 Terminology Collision

The brief uses "workspace" as the tenant unit. The codebase uses **"subaccount"**. Same concept, different name. The brief also uses "task" for review/approval items — but `tasks` already means kanban board items.

**Decision:** Keep `subaccounts` in code, allow "workspace" in UI labels. Name new review objects `review_items`, not tasks.

### 3.2 Duplicate Data Model

| Brief Proposes | Already Exists As |
|---------------|-------------------|
| `workspaces` | `subaccounts` |
| `agents` | `agents` + `system_agents` |
| `agent_runs` | `agent_runs` |
| `scheduled_tasks` | `scheduled_tasks` |
| `memory_entries` | `workspace_memory_entries` |
| `memory_summaries` | `workspace_memories` |

### 3.3 Over-Engineering for Phase 1

The brief specifies in full detail things we don't need yet:
- Browser adapter (Playwright) — defer
- Docker deep work — defer
- DevOps adapter — defer
- Marketing agent — defer
- Development agent — defer
- Sub-agent spawning — **already built**

The API adapter is the only one needed for Phase 1.

### 3.4 How Actions Integrate with skillExecutor

The brief doesn't answer the key implementation question: **which existing skills become action-gated and which stay direct?**

Read operations (`read_workspace`, `web_search`) should stay direct.
Write/external operations (`send_email`, anything with real-world side effects) should go through the action gate.

The skill executor needs to be split into: direct-execute skills vs action-proposing skills.

### 3.5 "Not a Support Feature" Is Right but Premature

Build the action/approval layer as a general platform primitive. Use the support agent as the first consumer. Extract generalisations when the second agent type arrives. Don't pre-build marketing or dev agent abstractions now.

---

## 4. Terminology Mapping

| Brief Term | Codebase Term | Notes |
|------------|---------------|-------|
| workspace | subaccount | Keep subaccount in code |
| agent | agent + subaccountAgent | Already split |
| agent_run | agentRun | Already exists |
| task (review) | **NEW: review_item** | Don't overload existing tasks |
| task (board) | task | Already exists |
| scheduled_task | scheduledTask | Already exists |
| memory_entry | workspaceMemoryEntry | Already exists |
| memory_summary | workspaceMemory | Already exists |
| skill | skill + systemSkill | Already exists, 3-layer |
| action | **NEW** | Core addition |
| action_event | **NEW** | Core addition |
| review_item | **NEW** | Core addition |
| integration_connection | **NEW** | Core addition |
| processed_resource | **NEW** | Core addition |
| orchestrator_directive | **NEW (Phase 2)** | Deferred |

---

## 5. Existing Architecture Strengths to Preserve

1. **3-layer prompt assembly** (system → org → subaccount) — elegant IP protection
2. **Middleware pipeline** — extensible, testable
3. **pg-boss for background jobs** — PostgreSQL-native, already integrated
4. **Skill executor pattern** — clean dispatch, easy to extend
5. **Task activities as audit log** — reuse pattern for action events
6. **Workspace memory with auto-extraction** — already covers what the brief describes
7. **Agent handoff via queue** — async, depth-limited, rate-limited
8. **Org-scoped multi-tenancy** — consistent filtering everywhere

---

## End of Part 1

Part 2 covers: refined data model (new tables only), action state machines, execution layer design, review/approval system, skillExecutor integration strategy, Phase 1 support agent plan, and build sequence.
