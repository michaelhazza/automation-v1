# Development Brief v2: Human-in-the-Loop Autonomous Agent Platform

## Part 1: Critical Analysis & Current State Assessment

**Date:** 2026-03-29
**Context:** Review of the v6 Unified Production Spec against what actually exists in the codebase.

---

## 1. Note on Missing Reference

The original brief referenced `/docs/api_coinglass_20260322` — this file does not exist anywhere in the repository. No coinglass-related files were found. This reference should be clarified.

---

## 2. What Already Exists (The Brief Ignores This)

The v6 spec reads as if we're starting from zero. We are not. Here's what's already built and working:

### 2.1 Agent Runtime (Substantial — ~80% of what the brief describes)

| Component | Status | Location |
|-----------|--------|----------|
| Agent definitions (org-scoped) | **Built** | `server/db/schema/agents.ts` |
| System agents (platform IP layer) | **Built** | `server/db/schema/systemAgents.ts` |
| Agent-to-workspace linking | **Built** | `server/db/schema/subaccountAgents.ts` with per-client overrides |
| Agent run records | **Built** | `server/db/schema/agentRuns.ts` — tracks status, tokens, duration, tool calls, summary |
| Agentic loop | **Built** | `server/services/agentExecutionService.ts` — full LLM loop with tool execution |
| 3-layer prompt assembly | **Built** | System prompt → org prompt → subaccount instructions |
| Middleware pipeline | **Built** | `server/services/middleware/` — budget check, loop detection, tool restriction, error handling |
| Skill/tool system | **Built** | `server/services/skillExecutor.ts` — create_task, move_task, add_deliverable, reassign_task, spawn_sub_agents, web_search, read/write_workspace |
| System skills (hidden from orgs) | **Built** | `server/services/systemSkillService.ts` |
| Token budget enforcement | **Built** | Per-run budgets with wrap-up on exhaustion |
| Agent handoffs | **Built** | Agent-to-agent task handoff via pg-boss queue, max depth 5 |
| Sub-agent spawning | **Built** | `spawn_sub_agents` tool with budget splitting |

### 2.2 Task / Board System (Built)

| Component | Status | Location |
|-----------|--------|----------|
| Tasks (kanban items) | **Built** | `server/db/schema/tasks.ts` — status, priority, assignment, brief |
| Task activities (audit log) | **Built** | `server/db/schema/taskActivities.ts` |
| Task deliverables | **Built** | `server/db/schema/taskDeliverables.ts` |
| Board config (columns) | **Built** | `server/db/schema/boardConfigs.ts` with org + subaccount hierarchy |
| Board templates | **Built** | System-level board column templates |
| Kanban UI | **Built** | `client/src/pages/WorkspaceBoardPage.tsx` with drag-and-drop |
| Task modal (create/edit) | **Built** | `client/src/components/TaskModal.tsx` |

### 2.3 Memory System (Built)

| Component | Status | Location |
|-----------|--------|----------|
| Workspace memories (summaries) | **Built** | `server/db/schema/workspaceMemories.ts` |
| Memory entries (raw observations) | **Built** | Part of workspace memory schema |
| Memory extraction post-run | **Built** | `workspaceMemoryService.extractRunInsights()` |
| Memory summarisation | **Built** | Periodic summarisation after N runs |
| Memory injection into prompts | **Built** | `workspaceMemoryService.getMemoryForPrompt()` |
| Memory UI | **Built** | `client/src/pages/WorkspaceMemoryPage.tsx` |

### 2.4 Scheduling (Built)

| Component | Status | Location |
|-----------|--------|----------|
| Scheduled tasks (RRULE + cron) | **Built** | `server/db/schema/scheduledTasks.ts` |
| pg-boss queue integration | **Built** | `server/services/queueService.ts` + `agentScheduleService.ts` |
| Retry policies | **Built** | Max retries, backoff, pause on consecutive failures |
| Manual + scheduled + triggered runs | **Built** | `runType` field on agent runs |

### 2.5 Multi-Tenancy & Permissions (Built)

| Component | Status | Location |
|-----------|--------|----------|
| Organisations (tenant root) | **Built** | Org-scoped everything |
| Subaccounts (workspaces) | **Built** | Client/workspace entities within orgs |
| 5-role hierarchy | **Built** | system_admin → org_admin → manager → user → client_user |
| Permission sets | **Built** | Fine-grained permission_sets + permission_set_items |
| JWT auth | **Built** | 24h tokens, middleware enforcement |
| Invite-only onboarding | **Built** | No self-registration |

### 2.6 Integrations (Partial)

| Component | Status | Location |
|-----------|--------|----------|
| Email (SendGrid/Resend/SMTP) | **Built** | `server/services/emailService.ts` — for platform emails (invites, resets) |
| File storage (R2/S3) | **Built** | `server/services/fileService.ts` |
| Workflow engines (n8n adapter) | **Built** | `server/services/engineService.ts` |
| LLM (Anthropic Claude) | **Built** | `server/services/llmService.ts` |
| Web search (Tavily) | **Built** | Optional agent tool |

### 2.7 Frontend (Extensive — 54 pages)

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

## 3. What's Actually Missing (The Real Gap)

The brief proposes ~30 new tables and services. Most of that duplicates what exists. Here's what's **genuinely missing** — the delta between current state and the HITL platform:

### 3.1 Action System (THE core gap)

**Currently:** Agents execute tools directly via `skillExecutor`. There is no intermediate "proposed action" object. When an agent calls `create_task` or `move_task`, it happens immediately. There is no gate, no approval, no review step for side-effectful operations.

**What's needed:**
- An `actions` table representing proposed work units
- Action state machine: `proposed → pending_approval → approved → executing → completed/failed/rejected`
- Gate levels per action type: `auto | review | block`
- `is_external` flag to distinguish internal vs boundary actions
- Idempotency keys for deduplication
- Action events table for audit trail

### 3.2 Execution Layer with Adapter Pattern (Missing)

**Currently:** `skillExecutor.ts` is a big switch statement. Each skill is a function that directly does the work. There's no adapter abstraction, no execution dispatch layer, no separation between "propose" and "execute".

**What's needed:**
- Execution service that sits between action approval and actual execution
- Adapter registry mapping action_type → adapter (API, worker, future browser/devops)
- Adapter interface: validate → execute → capture result
- Idempotency enforcement at execution time
- Provider abstraction for external services (email, CRM, code, ads)

### 3.3 Review / Approval System (Missing)

**Currently:** Agents move tasks to "review" status on the kanban board. Humans see them there. But there's no structured review queue, no approve/reject/edit flow, no enforcement that prevents execution without approval.

**What's needed:**
- Review items table (or projection from actions)
- Review queue UI — dedicated page for pending approvals
- Approve / Edit+Approve / Reject actions from UI
- Backend enforcement: actions with `gate_level=review` cannot execute without approval record
- Display: original context, agent reasoning, proposed payload, edit capability

### 3.4 Integration Connections (Missing)

**Currently:** Email is used for platform operations (invites, resets). There's no stored connection model for external services that agents would use (Gmail inbox, GitHub repo, CRM account, ad platform).

**What's needed:**
- `integration_connections` table: workspace-scoped, provider_type, auth credentials (encrypted ref)
- Provider abstraction interfaces (EmailProvider, CRMProvider, CodeProvider)
- Connection management UI
- Multi-tenant auth isolation

### 3.5 Processed Resources / Deduplication (Missing)

**Currently:** No mechanism to track "we already processed Gmail message X" across runs.

**What's needed:**
- `processed_resources` table: integration_type, resource_type, external_id, workspace-scoped
- Checked before agent processes external inputs
- Prevents duplicate work across scheduled runs

### 3.6 Orchestrator Agent Pattern (Missing)

**Currently:** Agents work independently. No strategic coordination layer.

**What's needed (Phase 2+):**
- Orchestrator agent type that reads workspace state and writes directives
- `orchestrator_directives` table
- Morning plan / evening summary schedule
- Directives injected into other agents' context

---

## 4. Critical Problems with the v6 Brief

### 4.1 Terminology Collision

The brief uses "workspace" as the tenant unit. The codebase uses **"subaccount"**. These are the same concept but different names. The brief uses "task" for review/workflow items — but `tasks` already means kanban board items. This will cause confusion everywhere.

**Decision required:** Either rename subaccounts → workspaces (breaking migration) or keep subaccounts and map the brief's terminology. Recommend keeping `subaccounts` in code but allowing "workspace" in UI labels.

### 4.2 Duplicate Data Model

The brief proposes tables that already exist under different names:

| Brief Proposes | Already Exists As | Notes |
|---------------|-------------------|-------|
| `workspaces` | `subaccounts` | Same concept |
| `agents` | `agents` + `system_agents` | Already has 3-layer model |
| `agent_runs` | `agent_runs` | Already comprehensive |
| `scheduled_tasks` | `scheduled_tasks` | Already has RRULE + cron |
| `memory_entries` | `workspace_memory_entries` | Already built |
| `memory_summaries` | `workspace_memories` | Already built |

### 4.3 Over-Engineering for Phase 1

The brief specifies in full detail:
- Browser adapter (Playwright) — not needed Phase 1
- Docker deep work execution — not needed Phase 1
- DevOps adapter — not needed Phase 1
- Marketing agent implementation — not needed Phase 1
- Development agent implementation — not needed Phase 1
- Sub-agent spawning in production — **already built**

Designing adapter interfaces for browser/Docker/devops now adds complexity with zero payoff. The API adapter is the only one needed for Phase 1. The others can be added when there's a real use case.

### 4.4 28 Sections Is 10x Too Long

The brief spends ~60% of its length on:
- Repeating the same principles in different words
- Future agent types that won't be built yet
- Adapter types that won't be built yet
- Philosophical guidance that belongs in CLAUDE.md, not a spec

A spec should be: data model + state machines + API contracts + build sequence. The rest is noise.

### 4.5 Missing: How Actions Integrate with Existing Skill Executor

The brief doesn't address the most important implementation question: **how does the action system integrate with the existing `skillExecutor.ts` switch statement?**

Currently, when an agent calls `create_task`, the skill executor directly creates the task. With the action system, some tool calls should:
1. Create an action record (proposed)
2. Check gate policy
3. Either auto-execute or queue for review

But other tool calls (internal ones like `read_workspace`, `list_tasks`) should remain direct. The brief doesn't distinguish which existing skills become action-gated vs which stay direct.

### 4.6 The "Not a Support Feature" Stance Is Correct but Premature

The brief is right that the platform should be general. But it over-indexes on this by designing abstractions for agents that don't exist yet. The correct approach:
1. Build the action/approval layer as a general platform feature
2. Implement the support agent as the first consumer
3. Extract patterns when the second agent type arrives
4. Don't pre-build abstractions for marketing/dev agents

---

## 5. Terminology Mapping (Brief → Codebase)

| Brief Term | Codebase Term | Notes |
|------------|---------------|-------|
| workspace | subaccount | Same concept, keep subaccount in code |
| agent | agent + subaccountAgent | Already split into definition + workspace link |
| agent_run | agentRun | Already exists, needs minor extensions |
| task (review) | **NEW: reviewItem or action** | Don't overload existing `tasks` table |
| task (board) | task | Already exists as kanban items |
| scheduled_task | scheduledTask | Already exists |
| memory_entry | workspaceMemoryEntry | Already exists |
| memory_summary | workspaceMemory | Already exists |
| skill | skill + systemSkill | Already exists, 3-layer |
| execution layer | **NEW** | Does not exist yet |
| action | **NEW** | Core addition |
| action_event | **NEW** | Core addition |
| review_item | **NEW** | Core addition |
| integration_connection | **NEW** | Core addition |
| processed_resource | **NEW** | Core addition |
| orchestrator_directive | **NEW (Phase 2)** | Deferred |

---

## 6. Existing Architecture Strengths to Preserve

These patterns are well-designed and should not be disrupted:

1. **3-layer prompt assembly** (system → org → subaccount) — elegant IP protection model
2. **Middleware pipeline** for agent execution — extensible, testable
3. **pg-boss for background jobs** — reliable, PostgreSQL-native, already integrated
4. **Skill executor pattern** — clean dispatch, easy to extend
5. **Task activities as audit log** — good foundation for action events
6. **Workspace memory with auto-extraction** — already does what the brief's memory layer describes
7. **Agent handoff via queue** — async, depth-limited, rate-limited
8. **Org-scoped multi-tenancy** — consistent filtering everywhere

---

## End of Part 1

Part 2 will cover:
- Refined data model (only new tables, extending existing ones)
- Action system design and state machines
- Execution layer architecture
- Review/approval system
- Integration with existing skillExecutor
- Phase 1 support agent implementation plan
- Build sequence and testing strategy
