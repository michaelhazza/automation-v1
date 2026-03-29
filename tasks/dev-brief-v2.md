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

---

# Part 2: Implementation Plan

---

## 6. New Data Model (Additions Only)

These are the only new tables required. Everything else already exists.

### 6.1 `actions`

The central new object. Represents a proposed unit of work that may require approval before execution.

```sql
actions
  id                  uuid PK
  organisation_id     uuid FK → organisations (for scoping/isolation)
  subaccount_id       uuid FK → subaccounts
  agent_id            uuid FK → agents
  agent_run_id        uuid FK → agent_runs nullable
  parent_action_id    uuid FK → actions nullable (for grouped actions)

  action_type         text NOT NULL  -- e.g. send_email, update_crm, create_task
  action_category     text NOT NULL  -- api | worker | browser | devops
  is_external         boolean NOT NULL DEFAULT false
  gate_level          text NOT NULL  -- auto | review | block

  status              text NOT NULL DEFAULT 'proposed'
  idempotency_key     text NOT NULL
  payload_json        jsonb NOT NULL
  metadata_json       jsonb          -- category, priority, reasoning

  result_json         jsonb nullable
  error_json          jsonb nullable

  approved_by         uuid FK → users nullable
  approved_at         timestamp nullable
  executed_at         timestamp nullable
  retry_count         integer NOT NULL DEFAULT 0
  max_retries         integer NOT NULL DEFAULT 3

  created_at          timestamp NOT NULL DEFAULT now()
  updated_at          timestamp NOT NULL DEFAULT now()

UNIQUE (subaccount_id, idempotency_key)
INDEX on (subaccount_id, status)
INDEX on (agent_run_id)
```

**Valid statuses:** `proposed → pending_approval → approved → executing → completed`
                    `proposed → pending_approval → rejected`
                    `proposed → blocked`
                    `proposed/executing → failed`
                    `proposed → skipped` (duplicate detected)

### 6.2 `action_events`

Audit trail. Every status transition emits one row. Immutable.

```sql
action_events
  id              uuid PK
  organisation_id uuid FK → organisations
  action_id       uuid FK → actions
  event_type      text NOT NULL  -- see list below
  actor_id        uuid FK → users nullable  -- null if system-driven
  metadata_json   jsonb
  created_at      timestamp NOT NULL DEFAULT now()

INDEX on (action_id)
```

**Event types:** `created`, `validation_failed`, `queued_for_review`, `approved`, `edited_and_approved`, `rejected`, `execution_started`, `execution_completed`, `execution_failed`, `retry_scheduled`, `blocked`, `skipped_duplicate`

### 6.3 `review_items`

Human-facing projection of actions needing approval. One row per action that hits `pending_approval`.

```sql
review_items
  id                    uuid PK
  organisation_id       uuid FK → organisations
  subaccount_id         uuid FK → subaccounts
  action_id             uuid FK → actions UNIQUE
  agent_run_id          uuid FK → agent_runs nullable

  review_status         text NOT NULL DEFAULT 'pending'
  review_payload_json   jsonb NOT NULL  -- full context for reviewer
  human_edit_json       jsonb nullable  -- payload overrides applied by reviewer

  reviewed_by           uuid FK → users nullable
  reviewed_at           timestamp nullable
  created_at            timestamp NOT NULL DEFAULT now()

INDEX on (subaccount_id, review_status)
```

**Valid statuses:** `pending → edited_pending → approved → completed`
                    `pending → rejected`

`review_payload_json` must include everything the reviewer needs without leaving the page: sender, original content, agent reasoning, proposed payload.

### 6.4 `integration_connections`

Stored external service credentials per subaccount.

```sql
integration_connections
  id                uuid PK
  organisation_id   uuid FK → organisations
  subaccount_id     uuid FK → subaccounts
  provider_type     text NOT NULL  -- gmail | github | hubspot | custom
  auth_type         text NOT NULL  -- oauth2 | api_key | service_account
  connection_status text NOT NULL DEFAULT 'active'  -- active | revoked | error
  display_name      text
  config_json       jsonb          -- non-secret config (scopes, account id, etc.)
  secrets_ref       text           -- reference to secrets manager / encrypted field
  last_verified_at  timestamp nullable
  created_at        timestamp NOT NULL DEFAULT now()
  updated_at        timestamp NOT NULL DEFAULT now()

UNIQUE (subaccount_id, provider_type)
```

### 6.5 `processed_resources`

Deduplication log for external inputs polled across runs.

```sql
processed_resources
  id                uuid PK
  organisation_id   uuid FK → organisations
  subaccount_id     uuid FK → subaccounts
  integration_type  text NOT NULL  -- gmail | github | hubspot
  resource_type     text NOT NULL  -- message | ticket | pr | contact
  external_id       text NOT NULL  -- provider-native ID
  agent_id          uuid FK → agents nullable
  first_seen_at     timestamp NOT NULL DEFAULT now()
  processed_at      timestamp NOT NULL DEFAULT now()

UNIQUE (subaccount_id, integration_type, resource_type, external_id)
INDEX on (subaccount_id, integration_type, resource_type)
```

---

## 7. Action State Machine

```
proposed
  ├─ gate=auto, is_external=false  →  approved  →  executing  →  completed
  │                                                             →  failed
  ├─ gate=review                   →  pending_approval
  │     ├─ human approves          →  approved   →  executing  →  completed
  │     ├─ human edits+approves    →  approved   →  executing  →  completed
  │     └─ human rejects           →  rejected
  ├─ gate=block                    →  blocked
  └─ duplicate detected            →  skipped
```

**Enforcement rules:**
- `pending_approval` → `approved` requires a `reviewed_by` user id and matching `review_items` record
- `approved` → `executing` must atomically verify status=approved, set status=executing, emit event — all in one transaction
- Backend refuses execution if status ≠ approved or if `executed_at` is already set
- Frontend button availability is UI convenience only; backend always re-checks

---

## 8. Execution Layer Design

### 8.1 ExecutionService

New service: `server/services/executionLayerService.ts`

Responsibilities:
1. Receive an approved action
2. Verify approval state (re-check in DB, not from caller)
3. Check idempotency key — abort if already executed
4. Resolve adapter from action_type registry
5. Emit `execution_started` event
6. Call adapter
7. Persist result or error
8. Transition action to `completed` or `failed`
9. Emit completion event

```typescript
interface ExecutionAdapter {
  execute(action: Action, connection: IntegrationConnection | null): Promise<ExecutionResult>
}

interface ExecutionResult {
  success: boolean
  result?: unknown
  error?: string
}
```

### 8.2 Adapter Registry

Central map — not scattered logic:

```typescript
const adapterRegistry: Record<string, ExecutionAdapter> = {
  send_email:    emailAdapter,
  read_inbox:    emailAdapter,
  create_task:   workerAdapter,   // internal, auto-gated
  move_task:     workerAdapter,
  update_record: apiAdapter,
  fetch_url:     apiAdapter,
  // future: open_pr → devopsAdapter
  // future: click_button → browserAdapter
}
```

### 8.3 Phase 1 Adapters

**API Adapter** — covers all Phase 1 external calls (email, CRM reads/writes, URL fetches). Uses `integration_connections` for credentials.

**Worker Adapter** — covers internal board operations (create_task, move_task, add_deliverable). These are `is_external=false`, `gate_level=auto`. Wraps the existing `skillExecutor` logic.

Browser and DevOps adapters are architecture stubs only in Phase 1 — no implementation.

---

## 9. Integrating Actions with the Existing skillExecutor

This is the most important implementation detail the v6 brief misses.

### 9.1 Split: Direct Skills vs Action-Proposing Skills

**Direct (no change needed):**
- `web_search` — read-only, no side effects
- `read_workspace` / `list_tasks` — read-only
- `spawn_sub_agents` — internal orchestration
- `trigger_process` — internal

**Action-gated (new behaviour):**
- `create_task` — `is_external=false`, `gate_level=auto` → executes immediately but creates an auditable action record
- `move_task`, `reassign_task`, `add_deliverable` — same: auto-gated, internal
- `send_email` (new) — `is_external=true`, `gate_level=review` → queues for human approval
- `read_inbox` (new) — `is_external=true`, `gate_level=auto` → reads only, no approval needed
- `update_record` (new) — `is_external=true`, `gate_level=review`

### 9.2 How skillExecutor Changes

For action-gated skills, `skillExecutor` no longer executes directly. Instead it:
1. Constructs a structured action payload
2. Calls `actionService.proposeAction(payload)`
3. Returns the action id and status to the agent as the tool result

The agent sees: `{ action_id: "...", status: "pending_approval", message: "Queued for review" }` and continues its run. The actual execution happens later when a human approves via the review queue.

For auto-gated internal skills, the flow is: propose → immediately approve → execute → return result synchronously within the same tool call. The action record is created for auditability but execution isn't blocked.

---

## 10. Review / Approval System

### 10.1 Backend: ReviewService

New service: `server/services/reviewService.ts`

Responsibilities:
- `createReviewItem(action)` — called when an action hits `pending_approval`
- `approveItem(reviewItemId, userId, edits?)` — validates ownership, applies edits, transitions action to approved, dispatches execution
- `rejectItem(reviewItemId, userId)` — transitions action to rejected
- `getReviewQueue(subaccountId)` — returns pending items with full review payload

`approveItem` must be transaction-safe:
```
BEGIN
  SELECT action WHERE id = ? FOR UPDATE
  VERIFY status = 'pending_approval'
  IF edits: merge edits into payload_json
  UPDATE action SET status = 'approved', approved_by = ?, approved_at = now()
  INSERT action_event (approved | edited_and_approved)
  UPDATE review_item SET review_status = 'approved', reviewed_by = ?, reviewed_at = now()
COMMIT
→ dispatch to executionLayerService (outside transaction)
```

### 10.2 API Endpoints

```
GET    /api/subaccounts/:id/review-queue          -- list pending review items
GET    /api/review-items/:id                       -- single item with full context
POST   /api/review-items/:id/approve               -- approve (with optional payload edits)
POST   /api/review-items/:id/reject                -- reject
GET    /api/subaccounts/:id/actions                -- action history (all statuses)
GET    /api/actions/:id/events                     -- full audit trail for one action
```

### 10.3 Review Queue UI

New page: `client/src/pages/ReviewQueuePage.tsx`

Each review item must display:
- Agent name and run timestamp
- Action type and category
- Agent reasoning (from metadata_json)
- Proposed payload (formatted per action type — email shows to/subject/body, CRM update shows field diffs)
- Approve button
- Edit payload → Approve button (inline editor for payload fields)
- Reject button

The kanban board is NOT the review queue. The board shows task work in progress. The review queue shows boundary actions awaiting approval. They are separate concerns.

### 10.4 Pending Count Badge

Add review queue pending count to the sidebar nav. Visible to manager+ roles. Pulls from a lightweight `GET /api/subaccounts/:id/review-queue/count` endpoint.

---

## 11. Phase 1 Reference Implementation: Support Agent

The support agent is the first consumer of the new action/approval platform. It validates every new primitive.

### 11.1 What the Support Agent Does

**Internal (autonomous, no approval):**
- Poll Gmail inbox via `read_inbox` skill
- Skip processed message IDs (via `processed_resources`)
- Skip self-sent messages
- Classify each message (bug_report, billing, general, feature_request, account_access, refund_request, complaint, spam)
- Assign priority (high / normal / low)
- Retrieve prior thread context
- Check workspace memory for known customer context
- Draft reply
- Self-review draft against quality rules
- Create board task to track the conversation

**Boundary (requires human approval):**
- `send_email` action with `gate_level=review` — one per inbound message requiring a reply

### 11.2 Support Agent Scheduled Flow

```
Scheduled trigger fires
→ Create agent run
→ Load workspace memory + support policies
→ Call read_inbox (Gmail, since last_run_at)
→ For each new message:
    → Check processed_resources — skip if seen
    → Classify + prioritise
    → Draft reply
    → Self-review (rewrite once if fails quality check)
    → proposeAction(send_email, gate_level=review)
    → Create/update board task linking to review item
→ Write processed_resource entries
→ Write run summary to memory
→ Complete run
```

### 11.3 Support Agent Quality Rules

Before creating the `send_email` action the agent must verify:
- Reply directly addresses the question asked
- Tone matches workspace preference (from memory)
- No feature promises or delivery dates unless policy allows
- No refunds or credits without policy support
- Clear next step included
- Concise unless complexity requires length

If self-review fails → rewrite once → if still failing → create action with a `needs_review_flag` in metadata.

### 11.4 send_email Action Payload

```json
{
  "action_type": "send_email",
  "action_category": "api",
  "is_external": true,
  "gate_level": "review",
  "idempotency_key": "gmail:{thread_id}:reply:{message_id}",
  "payload": {
    "to": "customer@example.com",
    "subject": "Re: Trouble logging in",
    "body": "Hi Sarah, ...",
    "thread_id": "18c4f8a12345",
    "provider": "gmail"
  },
  "metadata": {
    "category": "account_access",
    "priority": "high",
    "reasoning": "Customer cannot log in, active subscription"
  }
}
```

### 11.5 Gmail Integration

Use the existing `emailService` patterns but add:
- `GmailProvider` implementing `EmailProvider` interface: `listMessages`, `readMessage`, `sendMessage`, `createDraft`
- OAuth2 credentials stored in `integration_connections`
- Multi-tenant: each subaccount has its own Gmail connection
- Self-sent filter: skip messages where `from` matches the connected account address

Default schedule: every 2 hours during business hours, configurable per subaccount.

---

## 12. Build Sequence

### Phase 1A — Platform Foundations (Build First)

1. **Database migration** — add `actions`, `action_events`, `review_items`, `integration_connections`, `processed_resources`
2. **ActionService** — create, validate, state transitions, legal transition enforcement
3. **ExecutionLayerService** — adapter registry, idempotency checks, result persistence
4. **WorkerAdapter** — wraps existing skillExecutor internal skills, creates action records for auditability
5. **ReviewService** — createReviewItem, approveItem (transactional), rejectItem, getReviewQueue
6. **Review API routes** — review queue endpoints, action history, action events
7. **skillExecutor refactor** — split direct skills from action-proposing skills; action-gated skills call actionService.proposeAction

### Phase 1B — Support Agent (First Consumer)

8. **GmailProvider** — listMessages, readMessage, sendMessage (backed by integration_connections)
9. **APIAdapter** — dispatches send_email and similar external calls through providers
10. **`send_email` skill** — proposes action with gate_level=review
11. **`read_inbox` skill** — direct, auto-gated, returns message list
12. **Support agent prompt + skill config** — classification, drafting, self-review instructions
13. **ProcessedResources enforcement** — check before processing, write after
14. **Review Queue UI** — ReviewQueuePage with approve/edit/reject, pending count badge

### Phase 1C — Hardening

15. **Observability** — run trace viewer (system prompt, tool calls, tokens), cost estimate per run
16. **Failure policies** — retry logic in ExecutionLayerService, dead letter handling
17. **Integration connection UI** — connect/disconnect Gmail per subaccount
18. **Permissions** — new permission types: REVIEW_VIEW, REVIEW_APPROVE
19. **End-to-end tests** — full support agent flow, approval/rejection paths, deduplication

### Phase 2 — Orchestrator + Second Agent

20. **Orchestrator directives table + service**
21. **Second agent type (marketing or ops)** — uses same action primitives
22. **Browser adapter stub → implementation**

---

## 13. Testing Requirements

### Action System

- Action creation with valid/invalid payloads
- State transition enforcement (illegal transitions rejected)
- Idempotency key uniqueness — duplicate key returns existing action
- `gate_level=review` → execution blocked without approval record
- `gate_level=auto` → execution proceeds immediately
- `gate_level=block` → never executes
- Concurrent approval attempt — only one succeeds

### Support Agent End-to-End

- Inbox polling creates review items
- Processed message IDs not re-processed across runs
- Self-sent messages skipped
- Classification and priority populated correctly
- Approval triggers send
- Rejection prevents send, no outbound email occurs
- Edited payload used on send (not original)
- Memory updated after run
- Failures logged and visible in run record

### Security

- Action from subaccount A cannot be approved by user from subaccount B
- Integration connection for subaccount A cannot be used by agent in subaccount B
- Review approval requires REVIEW_APPROVE permission
- Backend re-checks all state even if frontend bypassed

---

## 14. Success Criteria for Phase 1

- [ ] Support agent runs autonomously on a real Gmail inbox for 5+ consecutive days without manual intervention
- [ ] Zero outbound emails sent without human approval
- [ ] Zero duplicate emails sent (idempotency works)
- [ ] Review queue shows all pending items with sufficient context to approve without opening Gmail
- [ ] Reviewer can edit the reply body before approving
- [ ] All executions have a complete audit trail (action + action_events)
- [ ] Same action/approval primitives visibly reusable — a second agent type could be added without changing the platform layer
