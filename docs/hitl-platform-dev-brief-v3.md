# Development Brief v3: Human-in-the-Loop Autonomous Agent Platform

**Date:** 2026-03-29  
**Status:** Final spec — ready for build  
**Supersedes:** v2 Parts 1 and 2 (merged + enhanced)  
**Changes from v2:** Incorporates external review feedback — 10 additions, 3 deferred, 2 already addressed

---

## Feedback Review: What Was Accepted and What Was Deferred

Before the spec itself, here is a transparent record of the external feedback review and the decisions made. This prevents the spec from ballooning with deferred items later.

### Accepted (implemented in this document)

| Feedback Item | Decision | Rationale |
|---|---|---|
| Action Type Registry | Implemented — Section 6.6 | Genuine gap. Without a central registry, payloads drift and validation scatters |
| Concurrency and locking model | Implemented — Section 7 | The spec mentioned idempotency but not SELECT FOR UPDATE. Race conditions are real |
| Retry policy per action type | Implemented — Section 6.6 | max_retries on the row is not enough without per-type retry rules |
| Action to Task relationship rules | Implemented — Section 9.3 | Genuinely unclear. Needed a decision not a vague link |
| SkillExecutor sync path explicit spec | Implemented — Section 9.2 | The auto-gate sync flow was underspecified, devs would have improvised inconsistently |
| Payload versioning | Implemented — one field | Zero cost, high future value |
| Partial execution results | Implemented — result_status enum | Clean signal for partial failures vs full failures |
| Action grouping via agent run | Implemented — Section 6.1 note | parent_action_id already exists in schema, just needed explicit documentation |
| Bulk approve in review UI | Implemented — Section 10.3 | Single-item-only approval would break immediately in real usage |
| Global token/cost controls | Implemented — Section 6.7 | Per-run budgets exist but workspace-level daily caps were missing |

### Deferred (documented but not built in Phase 1)

| Feedback Item | Deferred To | Rationale |
|---|---|---|
| Auto-approve policy rules table | Phase 1C | High value but adds schema complexity. Manual approval for all of Phase 1B is correct |
| Orchestrator output type definition | Phase 2 | Already deferred in v2. Type definition documented here for future reference |
| Full run replayability | Phase 2 | Logging requirements added to Phase 1C observability so replay becomes possible later |

### Already Addressed in v2

- Naming consistency (subaccount vs workspace) — covered in Section 4
- The feedback on "single writer" execution and backend re-checking gate state — already in Section 7 of v2, retained here

---

## 1. What Already Exists

The v6 source spec read as if starting from zero. This section corrects that. The genuine delta is much smaller than originally specified.

### 1.1 Agent Runtime

| Component | Status | Location |
|---|---|---|
| Agent definitions (org-scoped) | Built | `server/db/schema/agents.ts` |
| System agents (platform IP layer) | Built | `server/db/schema/systemAgents.ts` |
| Agent-to-workspace linking | Built | `server/db/schema/subaccountAgents.ts` with per-client overrides |
| Agent run records | Built | `server/db/schema/agentRuns.ts` — status, tokens, duration, tool calls, summary |
| Agentic loop | Built | `server/services/agentExecutionService.ts` — full LLM loop with tool execution |
| 3-layer prompt assembly | Built | System prompt → org prompt → subaccount instructions |
| Middleware pipeline | Built | `server/services/middleware/` — budget check, loop detection, tool restriction, error handling |
| Skill/tool system | Built | `server/services/skillExecutor.ts` — 8 skills |
| System skills | Built | `server/services/systemSkillService.ts` |
| Token budget enforcement | Built | Per-run budgets with wrap-up on exhaustion |
| Agent handoffs | Built | Agent-to-agent task handoff via pg-boss queue, max depth 5 |
| Sub-agent spawning | Built | `spawn_sub_agents` tool with budget splitting, max 3 children |

### 1.2 Task / Board System

| Component | Status | Location |
|---|---|---|
| Tasks (kanban items) | Built | `server/db/schema/tasks.ts` |
| Task activities (audit log) | Built | `server/db/schema/taskActivities.ts` |
| Task deliverables | Built | `server/db/schema/taskDeliverables.ts` |
| Board config (columns) | Built | `server/db/schema/boardConfigs.ts` |
| Kanban UI | Built | `client/src/pages/WorkspaceBoardPage.tsx` with drag-and-drop |
| Task modal | Built | `client/src/components/TaskModal.tsx` |

### 1.3 Memory System

| Component | Status | Location |
|---|---|---|
| Workspace memories (summaries) | Built | `server/db/schema/workspaceMemories.ts` |
| Memory entries (raw observations) | Built | Per-run insight extraction |
| Memory extraction post-run | Built | `workspaceMemoryService.extractRunInsights()` |
| Memory summarisation | Built | Periodic summarisation after N runs |
| Memory injection into prompts | Built | `workspaceMemoryService.getMemoryForPrompt()` |
| Memory UI | Built | `client/src/pages/WorkspaceMemoryPage.tsx` |

### 1.4 Scheduling

| Component | Status | Location |
|---|---|---|
| Scheduled tasks (RRULE + cron) | Built | `server/db/schema/scheduledTasks.ts` |
| pg-boss queue integration | Built | `server/services/queueService.ts` + `agentScheduleService.ts` |
| Retry policies | Built | Max retries, backoff, pause on consecutive failures |
| Manual + scheduled + triggered runs | Built | `runType` field on agent runs |

### 1.5 Multi-Tenancy and Permissions

| Component | Status | Location |
|---|---|---|
| Organisations (tenant root) | Built | Org-scoped everything |
| Subaccounts (workspaces) | Built | Client/workspace entities within orgs |
| 5-role hierarchy | Built | system_admin → org_admin → manager → user → client_user |
| Permission sets | Built | Fine-grained permission_sets + permission_set_items |
| JWT auth | Built | 24h tokens, middleware enforcement |

### 1.6 Integrations (Partial)

| Component | Status | Notes |
|---|---|---|
| Email (SendGrid/Resend/SMTP) | Built | Platform emails only — not exposed as agent skill |
| File storage (R2/S3) | Built | `server/services/fileService.ts` |
| Data sources (HTTP, Google Docs, Dropbox, R2/S3) | Built | Caching, fallback, email alerts on failure |
| Workflow engines (n8n adapter) | Built | `server/services/engineService.ts` |
| LLM (Anthropic Claude) | Built | Sonnet 4.6 default, configurable per agent |
| Web search (Tavily) | Built | Optional agent skill |
| External service connections (Gmail, GitHub, CRM) | NOT built | No stored connection model, no provider auth |

---

## 2. What Is Actually Missing (The True Delta)

### 2.1 Action System

**Currently:** Agents execute tools directly via `skillExecutor`. There is no intermediate "proposed action" object. When an agent calls `create_task` or `move_task`, it happens immediately with no gate, no approval step.

**What is needed:**
- `actions` table — proposed work units with structured payload
- Action state machine: `proposed → pending_approval → approved → executing → completed/failed/rejected`
- Gate levels per action type: `auto | review | block`
- `is_external` flag — internal vs boundary actions
- Idempotency keys — prevent duplicate execution
- `action_events` table — audit trail of every state transition
- **Action Type Registry** — central definition of action types, their schemas, and default gate levels

### 2.2 Execution Layer with Adapter Pattern

**Currently:** `skillExecutor.ts` is a switch statement where each case directly executes. No separation between "propose" and "execute", no adapter abstraction.

**What is needed:**
- Execution service that dispatches approved actions to adapters
- Adapter registry: action_type → adapter
- Adapter interface: validate → idempotency check → execute → capture result
- Provider abstraction for external services

### 2.3 Review / Approval System

**Currently:** Agents move kanban tasks to "review" status. No structured review queue, no approve/reject/edit flow, no backend enforcement preventing execution without approval.

**What is needed:**
- `review_items` table
- Dedicated review queue UI (not the kanban board)
- Approve / Edit+Approve / Reject from UI
- Bulk approve and reject for multi-item runs
- Backend enforcement: `gate_level=review` actions cannot execute without an approval record

### 2.4 Integration Connections

**Currently:** No stored connection model for external services.

**What is needed:**
- `integration_connections` table — subaccount-scoped, encrypted credential ref
- Provider interfaces (EmailProvider at minimum for Phase 1)
- Connection management UI

### 2.5 Processed Resources / Deduplication

**Currently:** No mechanism to track "we already processed Gmail message X" across runs.

**What is needed:**
- `processed_resources` table — integration_type, resource_type, external_id, subaccount-scoped

### 2.6 Missing Agent Skills

The current 8 skills cover internal board operations only.

| Skill | Priority | Needed For |
|---|---|---|
| `send_email` | Critical | Outbound communication (support replies) |
| `read_inbox` | Critical | Support agent inbox polling |
| `request_approval` | Critical | Agent signals mid-run that it needs human sign-off |
| `fetch_url` | High | Reading external URLs, lightweight API calls |
| `search_records` / `update_record` | High | CRM/support context lookup |

### 2.7 Observability Gaps

**What is needed:**
- Run trace viewer — system prompt snapshot, each LLM call, tool calls, token counts
- Cost estimate per run
- Validation failure visibility
- Sufficient logging detail to enable future run replay (see Section 13)

### 2.8 Global Cost Controls

**Currently:** Per-run token budgets exist. No workspace-level daily caps.

**What is needed:**
- `workspace_limits` — daily token and cost caps per subaccount
- Guards in the middleware pipeline that check daily totals before firing agent runs

### 2.9 Orchestrator Agent (Phase 2)

**Currently:** Agents work independently. No strategic coordination.

**Needed later:**
- Orchestrator agent type reads workspace state, writes directives
- `orchestrator_directives` table
- Morning plan / evening summary schedule
- Directives injected into other agents' context

---

## 3. Critical Architecture Decisions

### 3.1 Terminology

The v6 source spec used "workspace" as the tenant unit. The codebase uses "subaccount". Same concept, different name. The spec also used "task" for review/approval items, but `tasks` already means kanban board items.

**Decision:** Keep `subaccounts` in code. Allow "workspace" in UI labels. Name new review objects `review_items`, not tasks.

### 3.2 SkillExecutor Split

Read operations stay direct (no action record created). Write/external operations go through the action gate.

**Direct (no change):** `web_search`, `read_workspace`, `list_tasks`, `spawn_sub_agents`, `trigger_process`

**Action-gated:** `create_task`, `move_task`, `reassign_task`, `add_deliverable` (auto-gated, internal), `send_email`, `update_record` (review-gated, external)

### 3.3 Scope for Phase 1

The API adapter is the only adapter needed for Phase 1. Browser and DevOps adapters are stub interfaces only.

---

## 4. Terminology Mapping

| UI / Brief Term | Codebase Term | Notes |
|---|---|---|
| workspace | subaccount | Keep subaccount in code |
| agent | agent + subaccountAgent | Already split |
| agent_run | agentRun | Already exists |
| task (review queue) | review_item | New — do not overload existing tasks |
| task (board) | task | Already exists |
| scheduled_task | scheduledTask | Already exists |
| memory_entry | workspaceMemoryEntry | Already exists |
| memory_summary | workspaceMemory | Already exists |
| skill | skill + systemSkill | Already exists, 3-layer |
| action | NEW | Core addition |
| action_event | NEW | Core addition |
| review_item | NEW | Core addition |
| integration_connection | NEW | Core addition |
| processed_resource | NEW | Core addition |
| action_definition | NEW | Core addition (registry) |
| workspace_limits | NEW | Core addition (cost controls) |
| orchestrator_directive | NEW — Phase 2 | Deferred |

---

## 5. Existing Architecture Strengths to Preserve

1. **3-layer prompt assembly** (system → org → subaccount) — elegant IP protection
2. **Middleware pipeline** — extensible, testable
3. **pg-boss for background jobs** — PostgreSQL-native, already integrated
4. **Skill executor pattern** — clean dispatch, easy to extend
5. **Task activities as audit log** — reuse pattern for action events
6. **Workspace memory with auto-extraction** — already covers what the spec describes
7. **Agent handoff via queue** — async, depth-limited, rate-limited
8. **Org-scoped multi-tenancy** — consistent filtering everywhere

---

## 6. New Data Model (Additions Only)

These are the only new tables required. Everything else already exists.

### 6.1 `actions`

The central new object. Represents a proposed unit of work that may require approval before execution.

```sql
actions
  id                  uuid PK
  organisation_id     uuid FK → organisations
  subaccount_id       uuid FK → subaccounts
  agent_id            uuid FK → agents
  agent_run_id        uuid FK → agent_runs nullable
  parent_action_id    uuid FK → actions nullable   -- for grouping sibling actions from one run

  action_type         text NOT NULL                -- e.g. send_email, update_crm, create_task
  action_category     text NOT NULL                -- api | worker | browser | devops
  is_external         boolean NOT NULL DEFAULT false
  gate_level          text NOT NULL                -- auto | review | block

  status              text NOT NULL DEFAULT 'proposed'
  payload_version     integer NOT NULL DEFAULT 1   -- for future payload schema migrations
  idempotency_key     text NOT NULL
  payload_json        jsonb NOT NULL
  metadata_json       jsonb                        -- category, priority, reasoning

  result_json         jsonb nullable
  result_status       text nullable                -- success | partial | failed
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
INDEX on (parent_action_id)
```

**Valid statuses:**
```
proposed → pending_approval → approved → executing → completed
proposed → pending_approval → rejected
proposed → blocked
proposed/executing → failed
proposed → skipped  (duplicate idempotency key detected)
```

**Action grouping:** All actions produced by the same agent run share the same `agent_run_id`. Actions that are logically related within a run (e.g. five email replies from one inbox poll) share `parent_action_id` pointing to a nominated "group leader" action. This enables the review UI to show "5 emails from this run" and support bulk approval without a separate `action_groups` table.

### 6.2 `action_events`

Audit trail. Every status transition emits one row. Immutable.

```sql
action_events
  id              uuid PK
  organisation_id uuid FK → organisations
  action_id       uuid FK → actions
  event_type      text NOT NULL
  actor_id        uuid FK → users nullable   -- null if system-driven
  metadata_json   jsonb
  created_at      timestamp NOT NULL DEFAULT now()

INDEX on (action_id)
INDEX on (organisation_id, created_at)
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
  review_payload_json   jsonb NOT NULL   -- full context: original email, agent reasoning, proposed payload
  human_edit_json       jsonb nullable   -- payload overrides applied by reviewer

  reviewed_by           uuid FK → users nullable
  reviewed_at           timestamp nullable
  created_at            timestamp NOT NULL DEFAULT now()

INDEX on (subaccount_id, review_status)
INDEX on (agent_run_id)
```

**Valid statuses:** `pending → edited_pending → approved → completed`, `pending → rejected`

`review_payload_json` must include everything the reviewer needs without opening another tab: sender name and address, original message content, agent reasoning, proposed payload formatted for the action type, and the run timestamp.

### 6.4 `integration_connections`

Stored external service credentials per subaccount.

```sql
integration_connections
  id                uuid PK
  organisation_id   uuid FK → organisations
  subaccount_id     uuid FK → subaccounts
  provider_type     text NOT NULL   -- gmail | github | hubspot | custom
  auth_type         text NOT NULL   -- oauth2 | api_key | service_account
  connection_status text NOT NULL DEFAULT 'active'  -- active | revoked | error
  display_name      text
  config_json       jsonb           -- non-secret config (scopes, account id, email address)
  secrets_ref       text            -- reference to secrets manager or encrypted field
  last_verified_at  timestamp nullable
  created_at        timestamp NOT NULL DEFAULT now()
  updated_at        timestamp NOT NULL DEFAULT now()

UNIQUE (subaccount_id, provider_type)
```

### 6.5 `processed_resources`

Deduplication log for external inputs polled across scheduled runs.

```sql
processed_resources
  id                uuid PK
  organisation_id   uuid FK → organisations
  subaccount_id     uuid FK → subaccounts
  integration_type  text NOT NULL   -- gmail | github | hubspot
  resource_type     text NOT NULL   -- message | ticket | pr | contact
  external_id       text NOT NULL   -- provider-native ID
  agent_id          uuid FK → agents nullable
  first_seen_at     timestamp NOT NULL DEFAULT now()
  processed_at      timestamp NOT NULL DEFAULT now()

UNIQUE (subaccount_id, integration_type, resource_type, external_id)
INDEX on (subaccount_id, integration_type, resource_type)
```

### 6.6 Action Type Registry

Central definition of every action type. Implemented as a TypeScript config object in Phase 1 (not a DB table). Promotes to a DB table in Phase 2 when org-level overrides are needed.

```typescript
interface ActionDefinition {
  action_type: string
  action_category: 'api' | 'worker' | 'browser' | 'devops'
  is_external: boolean
  default_gate_level: 'auto' | 'review' | 'block'
  creates_board_task: boolean   // see Section 9.3
  payload_schema: JSONSchema
  retry_policy: {
    max_retries: number
    strategy: 'exponential_backoff' | 'fixed' | 'none'
    retry_on: string[]           // e.g. ['timeout', 'network_error', 'rate_limit']
    do_not_retry_on: string[]    // e.g. ['validation_error', 'auth_error']
  }
}

// Registry (Phase 1 definitions)
const actionRegistry: Record<string, ActionDefinition> = {
  send_email: {
    action_type: 'send_email',
    action_category: 'api',
    is_external: true,
    default_gate_level: 'review',
    creates_board_task: true,
    payload_schema: {
      to: 'string',
      subject: 'string',
      body: 'string',
      thread_id: 'string',
      provider: 'string'
    },
    retry_policy: {
      max_retries: 3,
      strategy: 'exponential_backoff',
      retry_on: ['timeout', 'network_error', 'rate_limit'],
      do_not_retry_on: ['validation_error', 'auth_error', 'recipient_not_found']
    }
  },
  read_inbox: {
    action_type: 'read_inbox',
    action_category: 'api',
    is_external: true,
    default_gate_level: 'auto',
    creates_board_task: false,
    payload_schema: { provider: 'string', since: 'timestamp' },
    retry_policy: {
      max_retries: 3,
      strategy: 'exponential_backoff',
      retry_on: ['timeout', 'network_error'],
      do_not_retry_on: ['auth_error']
    }
  },
  create_task: {
    action_type: 'create_task',
    action_category: 'worker',
    is_external: false,
    default_gate_level: 'auto',
    creates_board_task: false,   // it IS the board task
    payload_schema: { title: 'string', brief: 'string', status: 'string' },
    retry_policy: { max_retries: 2, strategy: 'fixed', retry_on: ['db_error'], do_not_retry_on: [] }
  },
  // move_task, reassign_task, add_deliverable follow same pattern as create_task
  update_record: {
    action_type: 'update_record',
    action_category: 'api',
    is_external: true,
    default_gate_level: 'review',
    creates_board_task: false,
    payload_schema: { provider: 'string', record_type: 'string', record_id: 'string', fields: 'object' },
    retry_policy: {
      max_retries: 3,
      strategy: 'exponential_backoff',
      retry_on: ['timeout', 'network_error'],
      do_not_retry_on: ['validation_error', 'not_found']
    }
  }
}
```

Why this matters: every component (validation, adapter routing, UI rendering, gate enforcement, retry logic) reads from this one registry. Action behaviour cannot drift between services.

### 6.7 `workspace_limits`

Global cost and token guardrails per subaccount. Prevents runaway spend across all scheduled and manual runs.

```sql
workspace_limits
  id                      uuid PK
  subaccount_id           uuid FK → subaccounts UNIQUE
  daily_token_limit       integer nullable       -- total tokens across all agent runs per day
  daily_cost_limit_cents  integer nullable       -- approximate cost cap in cents
  per_run_token_limit     integer nullable       -- override for per-run budget (else uses agent default)
  alert_threshold_pct     integer DEFAULT 80     -- notify at this % of daily limit
  created_at              timestamp NOT NULL DEFAULT now()
  updated_at              timestamp NOT NULL DEFAULT now()
```

The middleware pipeline checks daily totals before each agent run. If the daily limit would be breached, the run is queued rather than blocked — a notification fires and the run waits for the next day or manual override.

---

## 7. Action State Machine and Concurrency Model

### 7.1 State Machine

```
proposed
  ├─ gate=auto, is_external=false  →  approved  →  executing  →  completed
  │                                                             →  failed (→ retry if policy allows)
  ├─ gate=review                   →  pending_approval
  │     ├─ human approves          →  approved   →  executing  →  completed
  │     ├─ human edits+approves    →  approved   →  executing  →  completed
  │     └─ human rejects           →  rejected
  ├─ gate=block                    →  blocked
  └─ duplicate idempotency key     →  skipped
```

### 7.2 Concurrency and Locking

The `approved → executing` transition is the critical section. Two concurrent approval attempts, a manual approval racing with an auto-approve retry, or a double-click on the approve button must all be handled correctly.

**Locking pattern for all state transitions that trigger execution:**

```sql
BEGIN TRANSACTION;

SELECT id, status FROM actions
WHERE id = $action_id
FOR UPDATE;                          -- acquires row-level lock

-- verify preconditions
IF status != 'approved' THEN
  ROLLBACK;
  RAISE 'Invalid state transition';
END IF;

IF executed_at IS NOT NULL THEN
  ROLLBACK;
  RAISE 'Already executed';
END IF;

-- atomic transition
UPDATE actions
SET status = 'executing', executed_at = now()
WHERE id = $action_id;

INSERT INTO action_events (action_id, event_type) VALUES ($action_id, 'execution_started');

COMMIT;
-- dispatch to adapter OUTSIDE the transaction
```

**Rules:**
- Execution is always dispatched outside the transaction (to avoid holding locks during network calls)
- Backend re-checks status on every approve/execute call regardless of what the frontend sent
- Frontend button states are UI convenience only — they do not represent backend state
- Retries check `retry_count < max_retries` before scheduling — they never exceed the policy

### 7.3 Approval Transaction

```sql
BEGIN TRANSACTION;

SELECT action_id, review_status FROM review_items
WHERE id = $review_item_id
FOR UPDATE;

IF review_status != 'pending' AND review_status != 'edited_pending' THEN
  ROLLBACK;
  RAISE 'Review item already resolved';
END IF;

-- apply edits if provided
IF edits IS NOT NULL THEN
  UPDATE actions SET payload_json = merge(payload_json, edits) WHERE id = $action_id;
  UPDATE review_items SET human_edit_json = edits, review_status = 'approved' WHERE id = $review_item_id;
  INSERT INTO action_events VALUES ($action_id, 'edited_and_approved', $user_id);
ELSE
  UPDATE review_items SET review_status = 'approved', reviewed_by = $user_id WHERE id = $review_item_id;
  INSERT INTO action_events VALUES ($action_id, 'approved', $user_id);
END IF;

UPDATE actions SET status = 'approved', approved_by = $user_id, approved_at = now() WHERE id = $action_id;

COMMIT;
-- dispatch to executionLayerService OUTSIDE transaction
```

---

## 8. Execution Layer Design

### 8.1 ExecutionLayerService

New service: `server/services/executionLayerService.ts`

Responsibilities:
1. Receive an approved action
2. Verify approval state (re-check in DB, not from caller)
3. Check idempotency key — abort if already executed
4. Resolve adapter from action_type registry
5. Emit `execution_started` event
6. Call adapter.execute()
7. Persist result, result_status, or error
8. Transition action to `completed` or `failed`
9. Schedule retry if failure policy permits
10. Emit completion event

```typescript
interface ExecutionAdapter {
  execute(
    action: Action,
    connection: IntegrationConnection | null
  ): Promise<ExecutionResult>
}

interface ExecutionResult {
  success: boolean
  result_status: 'success' | 'partial' | 'failed'
  result?: unknown
  error?: string
  error_code?: string   // used by retry policy to decide whether to retry
}
```

### 8.2 Adapter Registry

```typescript
const adapterRegistry: Record<string, ExecutionAdapter> = {
  send_email:     emailAdapter,
  read_inbox:     emailAdapter,
  create_task:    workerAdapter,
  move_task:      workerAdapter,
  reassign_task:  workerAdapter,
  add_deliverable: workerAdapter,
  update_record:  apiAdapter,
  fetch_url:      apiAdapter,
  // Phase 2 stubs (interface only, no implementation):
  // open_pr:     devopsAdapter,
  // click_button: browserAdapter,
}
```

### 8.3 Phase 1 Adapters

**API Adapter** — covers all Phase 1 external calls: email via Gmail, URL fetches, CRM reads and writes. Reads credentials from `integration_connections`. Handles provider-specific error mapping to the retry policy error codes.

**Worker Adapter** — covers internal board operations. These are `is_external=false`, `gate_level=auto`. Wraps existing `skillExecutor` logic. Creates action records for auditability but does not block execution.

**Browser and DevOps adapters** — TypeScript interface stubs only in Phase 1. No implementation. The registry slots exist so Phase 2 is additive.

---

## 9. Integrating Actions with the Existing skillExecutor

This is the most important implementation detail.

### 9.1 Split: Direct vs Action-Gated Skills

**Direct (no change to these skills):**
- `web_search` — read-only, no side effects
- `read_workspace` / `list_tasks` — read-only
- `spawn_sub_agents` — internal orchestration
- `trigger_process` — internal

**Action-gated (behaviour changes):**

| Skill | gate_level | is_external | Change |
|---|---|---|---|
| `create_task` | auto | false | Now proposes action; immediately auto-approves and executes synchronously |
| `move_task` | auto | false | Same |
| `reassign_task` | auto | false | Same |
| `add_deliverable` | auto | false | Same |
| `send_email` (new) | review | true | Proposes action; blocks until human approves |
| `read_inbox` (new) | auto | true | Proposes action; immediately auto-approves and executes |
| `update_record` (new) | review | true | Proposes action; blocks until human approves |

### 9.2 Execution Flow by Gate Level

**Auto-gated (internal and read-only external):**

```
Agent calls tool
→ skillExecutor constructs action payload
→ actionService.proposeAction(payload)
  → validates against action registry schema
  → checks idempotency key
  → creates action record (status: proposed)
  → gate=auto: immediately transition to approved
  → dispatch to executionLayerService SYNCHRONOUSLY
    → execute
    → update action to completed/failed
  → return result to agent as tool result
```

The agent receives the execution result immediately and continues its run. The action record exists for auditability but does not interrupt flow.

**Review-gated (external write actions):**

```
Agent calls tool
→ skillExecutor constructs action payload
→ actionService.proposeAction(payload)
  → validates against action registry schema
  → checks idempotency key — if exists, return existing action status
  → creates action record (status: proposed)
  → gate=review: transition to pending_approval
  → reviewService.createReviewItem(action)
  → return to agent: { action_id, status: 'pending_approval', message: 'Queued for review' }
Agent continues its run (does not wait for human approval)
```

The agent sees the queued status and continues — it does not block waiting for a human. The actual execution happens asynchronously when the reviewer approves.

**Block-gated:**

```
Agent calls tool
→ actionService.proposeAction(payload)
  → gate=block: transition to blocked immediately
  → emit blocked event
  → return to agent: { action_id, status: 'blocked', message: 'Action type is blocked for this workspace' }
```

### 9.3 Action to Board Task Relationship

This was ambiguous in v2. The rule is determined by the `creates_board_task` flag on the `ActionDefinition`.

| Action Type | creates_board_task | Reasoning |
|---|---|---|
| `send_email` | true | Each reply becomes a board task tracking the customer conversation thread |
| `create_task` | false | The action IS the board task — no duplication |
| `move_task` | false | Modifying an existing task |
| `update_record` | false | CRM update does not warrant a board task by default |
| `read_inbox` | false | Read operation, no task needed |

When `creates_board_task = true`, the ReviewService creates a linked board task alongside the review item. The board task carries a reference to the review_item id and displays in the kanban view. This is separate from the review queue — the board task shows work in progress; the review item shows the specific action awaiting approval.

---

## 10. Review / Approval System

### 10.1 Backend: ReviewService

New service: `server/services/reviewService.ts`

```typescript
class ReviewService {
  createReviewItem(action: Action): Promise<ReviewItem>
  approveItem(reviewItemId: string, userId: string, edits?: Partial<ActionPayload>): Promise<void>
  rejectItem(reviewItemId: string, userId: string): Promise<void>
  getReviewQueue(subaccountId: string, filters?: ReviewQueueFilters): Promise<ReviewItem[]>
  getReviewQueueCount(subaccountId: string): Promise<number>
  bulkApprove(reviewItemIds: string[], userId: string): Promise<BulkResult>
  bulkReject(reviewItemIds: string[], userId: string): Promise<BulkResult>
}
```

`approveItem` and `bulkApprove` use the locking pattern from Section 7.3. Each item in a bulk operation is transacted individually — a failure on item 3 does not roll back items 1 and 2.

### 10.2 API Endpoints

```
GET    /api/subaccounts/:id/review-queue              -- list pending review items (supports filter by agent_run_id)
GET    /api/subaccounts/:id/review-queue/count        -- lightweight count for nav badge
GET    /api/review-items/:id                          -- single item with full context
POST   /api/review-items/:id/approve                  -- approve (optional payload edits in body)
POST   /api/review-items/:id/reject                   -- reject
POST   /api/review-items/bulk-approve                 -- body: { ids: string[] }
POST   /api/review-items/bulk-reject                  -- body: { ids: string[] }
GET    /api/subaccounts/:id/actions                   -- action history (all statuses)
GET    /api/actions/:id/events                        -- full audit trail for one action
```

### 10.3 Review Queue UI

New page: `client/src/pages/ReviewQueuePage.tsx`

**Per-item display:**
- Agent name and run timestamp
- Action type badge
- Agent reasoning (from metadata_json, collapsed by default)
- Proposed payload — formatted per action type (email shows to/subject/body; CRM update shows field diffs)
- Approve button
- Edit payload inline → Approve button
- Reject button

**Grouping and bulk actions:**
- Items grouped by agent_run_id when multiple items came from the same run
- Group header shows: agent name, run time, count ("5 emails")
- Bulk select within a group: Approve All / Reject All
- Cross-group multi-select also supported

**Filtering:**
- By agent
- By action type
- By priority (from metadata_json)
- By age (oldest first is default)

**The kanban board is NOT the review queue.** The board shows task work in progress. The review queue shows boundary actions awaiting approval. They are separate concerns presented in separate pages.

### 10.4 Auto-Approve Policies (Phase 1C — Deferred)

Not built in Phase 1B. Documented here for planning:

An `approval_policies` table will allow subaccount-level rules such as "low priority emails from repeat customers auto-approve" or "internal notifications never require review". The gate_level on individual actions will remain the enforcement mechanism — auto-approve policies are a way to upgrade a review-gated action to auto-gated based on conditions, not a bypass of the gate system.

### 10.5 Pending Count Badge

A badge on the sidebar nav shows the count of pending review items for the active subaccount. Visible to manager+ roles. Polls `GET /api/subaccounts/:id/review-queue/count` on a short interval. Clicking navigates to the review queue page.

---

## 11. Phase 1 Reference Implementation: Support Agent

The support agent is the first consumer of every new platform primitive. It validates the action system, review queue, Gmail integration, deduplication, and scheduled execution all at once.

### 11.1 What the Support Agent Does

**Autonomous (no approval needed):**
- Poll Gmail inbox via `read_inbox` skill
- Skip processed message IDs (via `processed_resources`)
- Skip self-sent messages
- Classify each message: `bug_report | billing | general | feature_request | account_access | refund_request | complaint | spam`
- Assign priority: `high | normal | low`
- Retrieve prior thread context
- Check workspace memory for known customer context
- Draft reply
- Self-review draft against quality rules
- Create board task to track the conversation

**Requires human approval:**
- `send_email` action with `gate_level=review` — one per inbound message requiring a reply

### 11.2 Support Agent Scheduled Flow

```
Scheduled trigger fires
→ Create agent run
→ Load workspace memory + support policies from memory
→ Check workspace_limits — abort if daily cap reached
→ Execute read_inbox (Gmail, since last_run_at)
→ For each new message:
    → Check processed_resources — skip if already seen
    → Classify and prioritise
    → Draft reply
    → Self-review (rewrite once if fails quality check)
    → proposeAction(send_email, gate_level=review, creates_board_task=true)
    → Review item created, board task created, agent continues
→ Write processed_resource entries for all seen message IDs
→ Write run summary to workspace memory
→ Complete run
```

### 11.3 Draft Quality Rules

Before creating the `send_email` action, the agent verifies:
- Reply directly addresses the question asked
- Tone matches workspace preference (from memory)
- No feature promises or delivery timelines unless policy explicitly allows
- No refunds or credits without policy support
- Clear next step for the customer included
- Concise unless complexity requires length

If self-review fails: rewrite once. If still failing: create the action with a `needs_human_review_flag: true` in metadata, which causes the review item to display a warning to the reviewer.

### 11.4 send_email Action Payload

```json
{
  "action_type": "send_email",
  "action_category": "api",
  "is_external": true,
  "gate_level": "review",
  "payload_version": 1,
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
    "reasoning": "Customer cannot log in, active paid subscription, second email in 24 hours",
    "needs_human_review_flag": false
  }
}
```

### 11.5 Gmail Integration

Use the existing `emailService` patterns as a reference, but implement separately:

- `GmailProvider` implementing `EmailProvider` interface: `listMessages`, `readMessage`, `sendMessage`, `createDraft`
- OAuth2 credentials stored in `integration_connections`
- Multi-tenant: each subaccount has its own Gmail connection record
- Self-sent filter: skip messages where `from` matches the connected account's address
- Default schedule: every 2 hours during business hours, configurable per subaccount

---

## 12. Build Sequence

### Phase 1A — Platform Foundations

1. **Database migration** — add `actions`, `action_events`, `review_items`, `integration_connections`, `processed_resources`, `workspace_limits`
2. **ActionTypeRegistry** — TypeScript config object with Phase 1 action definitions, schemas, and retry policies
3. **ActionService** — create, validate against registry schema, state transitions, legal transition enforcement
4. **ExecutionLayerService** — adapter registry, idempotency checks, locking, result persistence, retry scheduling
5. **WorkerAdapter** — wraps existing skillExecutor internal skills; creates auto-gated action records
6. **ReviewService** — createReviewItem, approveItem (transactional with locking), rejectItem, bulkApprove, bulkReject, getReviewQueue
7. **Review API routes** — all endpoints from Section 10.2
8. **skillExecutor refactor** — split direct skills from action-proposing skills; action-gated skills call `actionService.proposeAction`

### Phase 1B — Support Agent

9. **GmailProvider** — listMessages, readMessage, sendMessage backed by `integration_connections`
10. **APIAdapter** — dispatches `send_email` and other external API calls through providers
11. **`send_email` skill** — proposes action with gate_level=review, creates_board_task=true
12. **`read_inbox` skill** — direct auto-gated, returns message list
13. **Support agent prompt and skill config** — classification, drafting, self-review instructions
14. **processed_resources enforcement** — check before processing, write after run completes
15. **Review Queue UI** — ReviewQueuePage with per-item and bulk approve/edit/reject, pending count badge
16. **Integration connection UI** — connect/disconnect Gmail per subaccount, display connection status

### Phase 1C — Hardening

17. **Observability** — run trace viewer (system prompt snapshot, tool calls, tokens per call), approximate cost per run
18. **Replayability logging** — ensure each run record stores enough to reconstruct inputs for future replay: prompt snapshot, tool call inputs, memory state at run start
19. **workspace_limits middleware guard** — check daily token/cost totals before each run, notify on threshold
20. **Failure policies** — per-action-type retry in ExecutionLayerService, dead letter visibility
21. **Permissions** — new permission types: `REVIEW_VIEW`, `REVIEW_APPROVE`
22. **End-to-end tests** — full support agent flow, approval and rejection paths, deduplication, bulk actions, concurrency edge cases

### Phase 2 — Orchestrator and Second Agent

23. **Orchestrator directives table and service**
24. **Second agent type** (marketing or ops) — uses same action primitives, validates generalisability
25. **Browser adapter stub → implementation** (requires VPS/Docker infrastructure)
26. **Auto-approve policy rules** — `approval_policies` table and evaluation engine

---

## 13. Observability and Replayability

### Run Trace Viewer (Phase 1C)

Each agent run record must display:
- System prompt snapshot at time of run (not current prompt — the actual prompt used)
- Each LLM call: input messages, tool calls made, raw response, token counts, latency
- Each tool call: skill name, input payload, output, action_id if applicable
- Total tokens consumed, approximate cost
- Validation failures with the failing rule displayed

### Replayability Logging Requirements (Phase 1C)

Full replay is a Phase 2 feature. Phase 1C must log enough data to make it possible. For each run, persist:
- `prompt_snapshot_json` — the complete prompt as sent (system + memory + task context)
- `tool_call_log_json` — ordered array of {skill, input, output, action_id, timestamp}
- `memory_state_at_start_json` — memory summary as injected at the time the run started

These fields can sit on `agent_runs` or a linked `agent_run_traces` table. With this data, a future replay engine can reconstruct inputs, simulate execution, and compare outputs without side effects.

---

## 14. Testing Requirements

### Action System

- Action creation with valid and invalid payloads (invalid rejected by registry schema)
- State transition enforcement — illegal transitions return an error
- Idempotency key uniqueness — duplicate key returns existing action status, not an error
- `gate_level=review` → execution blocked without an approval record
- `gate_level=auto` → execution proceeds immediately and returns synchronously
- `gate_level=block` → transitions to blocked, never executes
- Concurrent approval attempt — SELECT FOR UPDATE ensures only one succeeds
- Retry scheduling respects action type policy (no retry on validation_error, retry on timeout)

### Support Agent End-to-End

- Inbox polling creates review items
- Processed message IDs are not re-processed across runs
- Self-sent messages are skipped
- Classification and priority fields are populated
- Approval triggers `send_email` execution
- Rejection prevents send — no outbound email
- Human-edited payload is used on send (not original draft)
- Workspace memory is updated after each run
- Failures are logged in run record and visible in trace viewer

### Bulk Actions

- Bulk approve approves all items and dispatches execution for each
- Failure on one item does not roll back others
- Bulk reject archives all items with no execution

### Security

- Action from subaccount A cannot be approved by user from subaccount B
- Integration connection for subaccount A cannot be used by agent in subaccount B
- Review approval requires `REVIEW_APPROVE` permission — backend enforces, not just UI
- Backend re-checks all gate state even if frontend sends approval directly

---

## 15. Success Criteria for Phase 1

- [ ] Support agent runs autonomously on a real Gmail inbox for 5+ consecutive days without manual intervention
- [ ] Zero outbound emails sent without explicit human approval
- [ ] Zero duplicate emails sent (idempotency works across run restarts)
- [ ] Review queue shows all pending items with sufficient context to approve without opening Gmail
- [ ] Reviewer can edit the reply body before approving, and edited version is what gets sent
- [ ] Bulk approve works correctly for multi-email runs
- [ ] All executions have a complete audit trail: action + action_events
- [ ] Run trace viewer shows system prompt, tool calls, and token consumption per run
- [ ] Daily workspace limits prevent runaway spend
- [ ] The same action/approval primitives are visibly reusable — a second agent type could be added without changing the platform layer

---

## Appendix A: Orchestrator Agent Type Definition (Phase 2)

Documented here for planning reference. Not built in Phase 1.

The orchestrator reads workspace state twice daily, synthesises it into a prioritised plan, and writes directives that inject into every other agent's context on the next run.

```typescript
interface OrchestratorInput {
  workspace_memory: MemorySummary
  open_review_items: ReviewItem[]
  recent_action_history: Action[]
  recent_failures: AgentRun[]
  board_state: BoardSummary
}

interface OrchestratorOutput {
  priorities: Array<{
    description: string
    assigned_agent?: string
    urgency: 'high' | 'normal' | 'low'
  }>
  issues: Array<{
    description: string
    source_agent: string
    first_seen_at: timestamp
  }>
  recommendations: Array<{
    description: string
    reasoning: string
  }>
  directive_text: string   // injected into other agents' system prompts on next run
}
```

Schedule: runs at 06:00 (morning plan) and 20:00 (evening summary) per workspace timezone. The `directive_text` output is stored in `orchestrator_directives` and injected by `workspaceMemoryService.getMemoryForPrompt()` alongside the regular memory summary.
