# Paperclip-Inspired Feature Spec

> Generated from competitive analysis. Each feature is self-contained with schema, API, UI, and implementation notes.
> **Date:** 2026-04-05

---

## Cross-Cutting Concerns (Apply to ALL Features)

These rules apply globally across every feature below. They are non-negotiable.

### CC-1: Multi-Tenant Enforcement

Every service method MUST:
- Require `organisationId` as a parameter
- Validate the entity belongs to BOTH `organisationId` AND `subaccountId` (where applicable) at query level

```ts
// CORRECT — always scope by org + subaccount
where(
  and(
    eq(goals.id, goalId),
    eq(goals.organisationId, orgId),
    eq(goals.subaccountId, subaccountId)
  )
)

// WRONG — trusting upstream to filter
where(eq(goals.id, goalId))
```

Apply to: goals, inbox aggregation, attachments, feedback, webhook callbacks, prompt revisions, and any new table.

### CC-2: Audit Event Logging

Every new write operation MUST emit an audit event to the existing `auditEvents` table. Minimum events per feature:

| Feature | Events |
|---------|--------|
| Goals | `goal.created`, `goal.updated`, `goal.deleted` |
| Instruction Versioning | `agent.prompt.updated`, `agent.prompt.rollback` |
| Inbox | `inbox.item.archived`, `inbox.item.read` |
| HTTP Adapter | `webhook.invoked`, `webhook.failed`, `webhook.callback_received` |
| Attachments | `attachment.uploaded`, `attachment.deleted` |
| Feedback | `feedback.submitted` |
| Hiring Gate | `agent.approval_requested`, `agent.approval_resolved` |

Use existing `auditEventService` pattern: `{ actorId, actorType, action, resourceType, resourceId, orgId, metadata }`.

### CC-3: Soft-Delete Consistency

Global rule for every query across all features:
- All reads MUST filter `isNull(table.deletedAt)` on soft-delete tables
- All cascade operations MUST soft-delete children (never hard delete)
- New tables that have `deletedAt` must follow this pattern without exception

### CC-4: Idempotency on Write Paths

High-risk write operations must be idempotent:

| Operation | Strategy |
|-----------|----------|
| Inbox mark-read (bulk) | Upsert on `(userId, entityType, entityId)` — already unique, just ensure ON CONFLICT DO UPDATE |
| Feedback votes | Upsert on unique constraint (already designed correctly) |
| Webhook callbacks | Validate one-time callback token (JWT with expiry), reject reused tokens |
| Attachment uploads | Client sends `idempotencyKey` (UUID), server dedupes on `(taskId, idempotencyKey)` |
| Goal deletion cascade | Wrap in transaction, check deletedAt before cascading |

### CC-5: Rate Limiting on New APIs

Apply per-user rate limits to prevent spam:

| Endpoint | Limit |
|----------|-------|
| `POST /api/feedback` | 30/min per user |
| `POST /api/inbox/mark-read` | 60/min per user |
| `POST /api/tasks/:id/attachments` | 10/min per user |
| `POST /api/webhooks/agent-callback/:runId` | 100/min per agent |

Use existing rate-limiting middleware or add `express-rate-limit` scoped per route group.

Additionally, define org-level caps as a shared abuse prevention layer. Per-user limits protect against individual misuse; per-org caps protect against compromised API keys or runaway automation flooding a single tenant's resources.

### Naming Convention

- **TypeScript (Drizzle schema + services):** camelCase — `retryBackoffMs`, `heartbeatIntervalHours`
- **Database (migrations):** snake_case — `retry_backoff_ms`, `heartbeat_interval_hours`
- Drizzle maps between them automatically. This is already the pattern in the codebase. New features must follow it.

### CC-6: Transaction Boundaries

**All multi-step writes MUST run inside a DB transaction.** This applies to:
- Goal deletion cascade (delete goal + cascade to children)
- Inbox bulk operations (mark-read across multiple entities)
- Attachment upload (file storage + DB row — if DB insert fails, clean up file)
- Webhook callback processing (run status update + task updates)
- Agent prompt rollback (create new revision + update agent)
- Feedback upsert with any side-effect aggregation

Pattern: use Drizzle's `db.transaction()` wrapper. If any step fails, the entire operation rolls back. For file operations (attachments), use a cleanup-on-failure pattern since files can't be transactionally rolled back.

### CC-7: Agent Run State Enum (Canonical)

All features that reference agent run status MUST use this canonical enum. No ad-hoc status strings.

```ts
type AgentRunStatus =
  | 'queued'               // waiting to execute
  | 'running'              // actively executing
  | 'waiting_callback'     // webhook adapter: sent request, awaiting async response
  | 'completed'            // finished successfully
  | 'completed_with_errors' // finished but with partial failures (e.g. webhook multi-step, some tasks succeeded)
  | 'failed'               // execution error
  | 'failed_timeout'       // exceeded timeout
  | 'failed_retry_exhausted' // all retries consumed
  | 'budget_exceeded'      // stopped by budget enforcement
  | 'cancelled';           // manually cancelled by operator
```

Define this as a shared constant in `server/config/enums.ts` or similar. All services, routes, and frontend must reference this single source of truth.

### CC-8: System Invariants

These are the non-negotiable architectural rules for all features:

1. **All writes are transactional** — multi-step mutations use `db.transaction()`
2. **All reads are tenant-scoped** — every query includes `organisationId` (and `subaccountId` where applicable)
3. **All external calls are idempotent** — webhook invocations, callbacks, and retries are safe to replay
4. **All async flows are retry-safe** — failed jobs can be re-queued without side effects
5. **Every async system defines failure modes before success path** — timeout, retry exhaustion, and callback SLA breach must have explicit handling
6. **No audit events for read operations** — only log writes. Batch low-value events if volume becomes a concern later.

### CC-9: WebSocket Event Deduplication

All WebSocket events already include `eventId` (UUID) in the envelope (see `server/websocket/emitters.ts`). Clients MUST deduplicate using `eventId` to handle reconnection replays and duplicate deliveries. Frontend should maintain a small in-memory set of recent eventIds (last 100) and skip events already seen.

### CC-10: Audit Event Correlation

All audit events SHOULD include an optional `correlationId` field. Propagate from the originating context:
- Agent runs: use `runId` as correlationId for all audit events during execution
- Webhook flows: use `runId` for the outbound call, callback receipt, and any task updates
- Inbox actions: use a request-scoped UUID for bulk operations (mark-read, archive)

This enables end-to-end flow tracing across features. Add `correlation_id TEXT` column to `auditEvents` table (nullable, indexed).

### CC-11: Storage Abstraction

All file storage operations (attachments, logos) go through a `storageService` interface:

```ts
interface StorageService {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
}
```

Two implementations: `LocalStorageService` (filesystem) and `S3StorageService`. Selected by env config. This prevents refactor pain when adding R2, GCS, or encrypted storage later.

### CC-12: System Architecture Layers

The system is composed of three layers. Features should not leak across boundaries.

| Layer | Responsibility | Entities |
|-------|---------------|----------|
| **Control** | Agent orchestration, scheduling, execution | Agents, runs, heartbeats, webhook adapters, concurrency policies |
| **Work** | Task management, project organisation, goal alignment | Tasks, projects, goals, attachments, deliverables |
| **Signal** | Operational visibility, quality feedback, governance | Inbox, feedback votes, audit events, review gates, budget alerts |

Rules:
- Control layer writes to Work layer (agents create/update tasks)
- Work layer emits to Signal layer (task changes trigger inbox items, audit events)
- Signal layer NEVER writes to Control or Work layers directly (humans act on signals via explicit API calls)

---

## Feature 1: Goal Hierarchy System

### Overview
Hierarchical goal trees where company/subaccount mission cascades into sub-goals. Every task can link to a goal, giving agents strategic context during execution.

### Database Schema

**New table: `goals`**

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, defaultRandom() |
| organisationId | uuid | notNull, FK → organisations.id |
| subaccountId | uuid | notNull, FK → subaccounts.id |
| parentGoalId | uuid | nullable, self-ref FK → goals.id |
| title | text | notNull |
| description | text | nullable |
| status | text | notNull, default('active') — enum: 'planned', 'active', 'completed', 'archived' |
| level | text | notNull, default('objective') — enum: 'mission', 'objective', 'key_result' |
| ownerAgentId | uuid | nullable, FK → agents.id |
| targetDate | timestamp | nullable, withTimezone |
| position | integer | notNull, default(0) |
| createdBy | uuid | nullable, FK → users.id |
| createdAt | timestamp | notNull, defaultNow(), withTimezone |
| updatedAt | timestamp | notNull, defaultNow(), withTimezone |
| deletedAt | timestamp | nullable, withTimezone |

**Indexes:**
- `goals_subaccount_idx` on (subaccountId)
- `goals_org_idx` on (organisationId)
- `goals_parent_idx` on (parentGoalId)
- `goals_subaccount_status_idx` on (subaccountId, status)

**Modify existing `tasks` table:**
- Add column: `goalId` (uuid, nullable, FK → goals.id)
- Add index: `tasks_goal_idx` on (goalId)

**Modify existing `projects` table:**
- Add column: `goalId` (uuid, nullable, FK → goals.id)
- Add index: `projects_goal_idx` on (goalId)

### API Routes

All routes under `/api/subaccounts/:subaccountId/goals`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List goals for subaccount (flat list, client builds tree) |
| POST | `/` | Create goal |
| GET | `/:goalId` | Get goal with children count, linked tasks/projects counts |
| PATCH | `/:goalId` | Update goal |
| DELETE | `/:goalId` | Soft-delete goal (cascade soft-delete children) |
| GET | `/:goalId/ancestry` | Return full ancestor chain (for agent context injection) |

### Service Layer

**`goalService.ts`**
- `listGoals(subaccountId, orgId)` — flat list, filtered by deletedAt IS NULL
- `createGoal(data)` — validate parentGoalId belongs to same subaccount if set
- `updateGoal(goalId, data, orgId)` — standard update with resolveSubaccount
- `deleteGoal(goalId, orgId)` — soft-delete, cascade to children (in transaction)
- `getGoalAncestry(goalId)` — recursive CTE query returning chain from goal up to root mission
- `getGoalContext(taskId)` — if task has goalId, return formatted ancestry string for prompt injection

**Integrity constraints (from review feedback):**
- **Circular reference prevention:** On create/update where `parentGoalId` is set, walk the ancestor chain (max 10 levels) and reject if `goalId` appears in its own ancestry. Use the same recursive CTE as `getGoalAncestry` with a cycle check.
- **Cross-subaccount prevention:** Enforce `parent.subaccountId === child.subaccountId` at service layer.
- **Goal owner alignment:** When a task is created with a `goalId` and the goal has an `ownerAgentId`, suggest (but don't force) assigning the task to that agent. Include owner info in the API response for the frontend to use as a default.

### Frontend

**New pages:**
- `GoalsPage.tsx` — tree view of goals with expand/collapse, create button, status badges
- `GoalDetailPage.tsx` — goal detail with sub-goals tab, linked tasks tab, linked projects tab

**New components:**
- `GoalTree.tsx` — recursive tree component with indentation, expand/collapse, drag-to-reorder
- `GoalPicker.tsx` — dropdown/popover for selecting a goal when creating/editing tasks or projects

**Modify existing:**
- Task create/edit forms: add GoalPicker field
- Project create/edit forms: add GoalPicker field
- Task detail page: show linked goal with ancestry breadcrumb

### Agent Prompt Injection

In `agentExecutionService.ts`, when building the system prompt for a run:
1. Check if the task has a `goalId`
2. If yes, call `goalService.getGoalAncestry(goalId)`
3. Inject a `## Strategic Context` section into the agent's system prompt:
```
## Strategic Context
This task supports the following goal hierarchy:
- Mission: [root goal title]
  - Objective: [parent goal title]
    - Key Result: [immediate goal title]

Keep this strategic context in mind when making decisions.
```

### Migration

```sql
-- 00XX_add_goals.sql
CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  subaccount_id UUID NOT NULL REFERENCES subaccounts(id),
  parent_goal_id UUID REFERENCES goals(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  level TEXT NOT NULL DEFAULT 'objective',
  owner_agent_id UUID REFERENCES agents(id),
  target_date TIMESTAMPTZ,
  position INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX goals_subaccount_idx ON goals(subaccount_id);
CREATE INDEX goals_org_idx ON goals(organisation_id);
CREATE INDEX goals_parent_idx ON goals(parent_goal_id);
CREATE INDEX goals_subaccount_status_idx ON goals(subaccount_id, status);

-- 00XX_add_goal_to_tasks.sql
ALTER TABLE tasks ADD COLUMN goal_id UUID REFERENCES goals(id);
CREATE INDEX tasks_goal_idx ON tasks(goal_id);

-- 00XX_add_goal_to_projects.sql
ALTER TABLE projects ADD COLUMN goal_id UUID REFERENCES goals(id);
CREATE INDEX projects_goal_idx ON projects(goal_id);
```

---

## Feature 2: Org Chart Visualisation

### Overview
Interactive visual representation of agent hierarchy within a subaccount. Agents already have `parentAgentId` for reporting relationships — this feature visualises that data as a pannable, zoomable org chart.

### No Schema Changes Required
All data already exists:
- `agents.parentAgentId` — defines reporting hierarchy
- `agents.agentRole` — role label (orchestrator, specialist, etc.)
- `agents.agentTitle` — display title
- `agents.status` — for status dot colouring
- `subaccountAgents` — links agents to subaccounts

### Frontend

**New page: `OrgChartPage.tsx`**

Route: `/subaccounts/:subaccountId/org-chart`

**Layout algorithm:**
1. Fetch all agents for the subaccount via existing `/api/subaccounts/:subaccountId/agents` endpoint
2. Build tree from `parentAgentId` relationships (multiple roots allowed — agents with no parent)
3. Calculate subtree widths recursively (each leaf = base width, parent = sum of children widths)
4. Position nodes: parent centred above children, consistent vertical gap (80px between levels), horizontal gap (32px between siblings)
5. Render SVG layer for connection lines (cubic Bezier curves) + HTML layer for agent cards

**Agent card component: `OrgChartCard.tsx`**
- 200×100px card with:
  - Agent icon (or default avatar)
  - Agent name (bold)
  - Agent title/role (muted)
  - Status dot: green (active), yellow (draft), red (inactive), with pulse animation if agent has a live run
- Click navigates to agent detail page
- Hover shows shadow elevation

**Interaction controls:**
- Pan: click-and-drag on background (track mousedown → mousemove → mouseup, apply translate)
- Zoom: mouse wheel → scale transform (range 0.3x to 2.0x, step 0.1)
- Fit to view: button that calculates bounding box of all nodes and sets transform to fit viewport
- Zoom in/out buttons: +/- in top-right corner

**Connection lines:**
- SVG `<path>` elements using cubic Bezier: from parent bottom-centre to child top-centre
- Path bends at vertical midpoint between parent and child
- Stroke colour: muted grey, 1.5px

**Implementation approach:**
- Use a single `<div>` container with `transform: translate(x, y) scale(z)` for pan/zoom
- SVG layer positioned absolutely behind card layer
- No external library needed — custom implementation is simpler for this use case
- Alternative: `reactflow` library if we want drag-to-reorganise in future (heavier dependency)

**Empty state:** "No agents configured. Create your first agent to see the org chart."

**Header actions:**
- "Add Agent" button
- View toggle: Org Chart / List (switches to existing agent list page)

### API Changes
None required — uses existing agent list endpoint. Optionally add a lightweight endpoint:

`GET /api/subaccounts/:subaccountId/agents/org-tree` — returns agents with only the fields needed for the chart (id, name, agentTitle, agentRole, parentAgentId, status, icon) to reduce payload size. Optional optimisation.

---

## Feature 3: Inbox Enhancements

### Overview
The current Review Queue (`ReviewQueuePage.tsx`) has two tabs: Issues and Needs Review. It needs to become a true unified command centre by adding failed runs, budget alerts, read/unread tracking, keyboard navigation, and search/filtering.

### Current State (What Exists)
- Route: `/inbox` via `agentInbox.ts` route
- Tab 1: "Issues" — tasks with status `inbox`
- Tab 2: "Needs Review" — actions with `pending_approval` status
- Bulk approve/reject on review items
- Group-by-run toggle
- Badge counts per tab
- **Missing:** failed runs, budget alerts, read/unread, keyboard nav, search, filtering

### Database Schema Changes

**New table: `inbox_read_states`**

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, defaultRandom() |
| userId | uuid | notNull, FK → users.id |
| entityType | text | notNull — enum: 'task', 'review_item', 'agent_run' |
| entityId | uuid | notNull |
| isRead | boolean | notNull, default(false) |
| isArchived | boolean | notNull, default(false) |
| readAt | timestamp | nullable, withTimezone |
| createdAt | timestamp | notNull, defaultNow(), withTimezone |

**Indexes:**
- `inbox_read_user_entity_uniq` unique on (userId, entityType, entityId)
- `inbox_read_user_unread_idx` on (userId, isRead) where isRead = false
- `inbox_read_user_archived_idx` on (userId, isArchived)

### API Changes

**Extend existing `/api/inbox` route:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/inbox/unified` | Aggregated inbox: tasks, review items, failed runs, budget alerts |
| POST | `/api/inbox/mark-read` | Mark items as read: `{ items: [{ entityType, entityId }] }` |
| POST | `/api/inbox/mark-unread` | Mark items as unread |
| POST | `/api/inbox/archive` | Archive items (hide from default view) |
| GET | `/api/inbox/counts` | Unread counts per category for badge display |

**`GET /api/inbox/unified` response shape:**
```ts
{
  items: Array<{
    id: string;
    type: 'task' | 'review_item' | 'failed_run' | 'budget_alert';
    title: string;
    subtitle: string;
    status: string;
    priority?: string;
    agentName?: string;
    isRead: boolean;
    isArchived: boolean;
    createdAt: string;
    updatedAt: string;
    entityId: string;    // ID of the underlying entity
    metadata: Record<string, unknown>;  // type-specific extra data
  }>;
  counts: { tasks: number; reviews: number; failedRuns: number; alerts: number; total: number; };
}
```

**Query sources:**
- Tasks: `tasks` where status = 'inbox' and subaccountId in user's accessible subaccounts
- Review items: `reviewItems` where reviewStatus = 'pending' or 'edited_pending'
- Failed runs: `agentRuns` where status in ('failed', 'timeout', 'budget_exceeded') and createdAt > 7 days ago
- Budget alerts: computed from `costAggregates` where spend > 75% of org budget threshold

### Frontend Changes

**Modify `ReviewQueuePage.tsx` → rename to `InboxPage.tsx`**

**Tabs:**
1. **All** — everything, filterable by category chips
2. **Issues** — tasks needing attention (existing)
3. **Reviews** — pending approvals (existing)
4. **Failed Runs** — new: failed/timed-out agent runs with retry button
5. **Alerts** — new: budget warnings, error aggregates

**New features on the page:**
- Search input: filter by title/description/agent name across all categories
- Unread dot: blue dot on unread items, fades on hover/click
- "Mark all as read" button per tab
- Category badge counts in tab headers

**Keyboard shortcuts (bind via useEffect keydown listener):**
- `j` / `k` — move selection up/down
- `Enter` — open selected item detail
- `a` — archive selected item
- `r` — mark as read
- `u` — mark as unread
- `e` — approve (on review items only)
- `x` — reject (on review items only)

Visual hint: show keyboard shortcut legend via `?` key or a small footer hint.

### Service Layer

**`inboxService.ts`**
- `getUnifiedInbox(userId, orgId, filters)` — query across tasks, reviewItems, agentRuns, costAggregates
- `markRead(userId, items)` — upsert into inbox_read_states
- `markUnread(userId, items)` — update inbox_read_states
- `archiveItems(userId, items)` — set isArchived = true
- `getCounts(userId, orgId)` — count unread per category

**Performance strategy (from review feedback):**
Aggregating across 4 tables live will degrade as data grows. Two-phase approach:

**Phase 1 (launch):** Live queries with strict limits. Each source query is capped: max 50 tasks, 50 reviews, 20 failed runs, 10 alerts. Combined, sorted by updatedAt DESC, paginated (cursor-based). This is acceptable for moderate scale.

**Phase 2 (when needed):** Materialised `inbox_items` table populated by write-time triggers. Migrate when query latency exceeds 200ms p95.

Phase 2 trigger definitions (define now, implement later):

| Source Event | Action on `inbox_items` |
|-------------|------------------------|
| Task status → 'inbox' | INSERT row (type=task, entityId=taskId) |
| Review item created | INSERT row (type=review_item, entityId=reviewItemId) |
| Agent run → failed/timeout/budget_exceeded | INSERT row (type=failed_run, entityId=runId) |
| Cost aggregate > 75% budget | INSERT row (type=budget_alert, entityId=orgId, dedup on org+month) |
| Task status leaves 'inbox' | UPDATE row status → 'resolved' |
| Review item approved/rejected | UPDATE row status → 'resolved' |
| Failed run retried | UPDATE row status → 'resolved' |
| User archives item | UPDATE row isArchived = true |

Deduplication: unique on `(entityType, entityId)`. On conflict, update `updatedAt`.
Read state: JOIN with `inbox_read_states` on `(entityType, entityId, userId)`.

**TTL / cleanup:** Resolved + archived items accumulate indefinitely. Add a scheduled cleanup job (daily, via pg-boss):
- Delete `inbox_items` where `status = 'resolved'` AND `updatedAt < now() - 90 days`
- Delete `inbox_items` where `isArchived = true` AND `updatedAt < now() - 30 days`
- Delete corresponding `inbox_read_states` matching on `(entityType, entityId)` — ensure no orphaned read states remain after cleanup

**Phase 2 source of truth rule:** Once `inbox_items` materialised table is enabled, it becomes the sole source of truth. Live aggregation queries are disabled entirely, not merged. This avoids duplicate items, inconsistent counts, and debugging complexity during migration.

**Inbox priority ordering (from review feedback):**
Default sort order:
1. Unread items first
2. Then by priority: urgent > high > normal > low
3. Then by recency (updatedAt DESC)

Expose `sortBy` query param to allow override: `recency`, `priority`, `unread_first` (default).

### WebSocket Integration

Emit to org room when inbox-relevant events occur:
- `inbox:new_item` — when a new task enters inbox, review item created, or run fails
- `inbox:item_resolved` — when a review is approved/rejected or a failed run is retried

Client uses these to update badge counts and prepend new items without polling.

---

## Feature 4: Agent Instruction Versioning

### Overview
Track every change to an agent's masterPrompt and additionalPrompt as a revision. Operators can view diff history and rollback to previous versions.

### Database Schema

**New table: `agent_prompt_revisions`**

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, defaultRandom() |
| agentId | uuid | notNull, FK → agents.id |
| organisationId | uuid | notNull, FK → organisations.id |
| revisionNumber | integer | notNull |
| masterPrompt | text | notNull |
| additionalPrompt | text | notNull |
| changeDescription | text | nullable — auto-generated or user-provided |
| changedBy | uuid | nullable, FK → users.id |
| changedByAgentId | uuid | nullable, FK → agents.id |
| promptHash | text | notNull — SHA-256 of (masterPrompt + additionalPrompt), used for dedup and quick comparison |
| createdAt | timestamp | notNull, defaultNow(), withTimezone |

**Indexes:**
- `agent_prompt_rev_agent_idx` on (agentId)
- `agent_prompt_rev_agent_num_uniq` unique on (agentId, revisionNumber)
- `agent_prompt_rev_created_idx` on (agentId, createdAt DESC)

### Service Layer Changes

**Modify `agentService.ts` — `updateAgent()`:**

Before persisting an agent update, if `masterPrompt` or `additionalPrompt` changed:
1. Fetch current agent prompt values
2. Compute hash: `SHA-256(masterPrompt + '\0' + additionalPrompt)`
3. Compare hash vs latest revision hash — if identical, skip revision creation (dedup)
4. If different, create a new `agent_prompt_revisions` row
5. Auto-increment `revisionNumber` (max existing + 1)
6. Auto-generate `changeDescription` by diffing: "masterPrompt changed (±X chars)" / "additionalPrompt changed (±X chars)"
7. Persist the agent update as normal

**New methods in `agentService.ts`:**
- `getPromptRevisions(agentId, orgId, limit?, offset?)` — paginated revision list
- `getPromptRevision(agentId, revisionId, orgId)` — single revision detail
- `rollbackPrompt(agentId, revisionId, orgId, userId)` — restore agent prompts from revision, which itself creates a new revision ("Rolled back to revision #N")

### API Routes

Add to existing `/api/agents/:agentId` routes:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents/:agentId/prompt-revisions` | List revisions (paginated) |
| GET | `/api/agents/:agentId/prompt-revisions/:revisionId` | Get single revision |
| POST | `/api/agents/:agentId/prompt-revisions/:revisionId/rollback` | Rollback to this revision |

### Frontend

**Modify agent edit page — add "History" tab or collapsible section:**
- List of revisions: revision number, timestamp, changed-by user/agent, change description
- Click a revision to expand and see full prompt text
- "Compare" button: side-by-side diff of selected revision vs current (use a simple line-diff algorithm, highlight additions in green, deletions in red)
- "Rollback" button on each revision with confirmation dialog: "This will restore prompts from revision #N and create a new revision. Continue?"

**Diff component: `PromptDiffViewer.tsx`**
- Split view: left = old, right = new
- Line-level diff highlighting
- Can use `diff` npm package or simple custom implementation

### Migration

```sql
CREATE TABLE agent_prompt_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  revision_number INTEGER NOT NULL,
  master_prompt TEXT NOT NULL,
  additional_prompt TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  change_description TEXT,
  changed_by UUID REFERENCES users(id),
  changed_by_agent_id UUID REFERENCES agents(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, revision_number)
);

CREATE INDEX agent_prompt_rev_agent_idx ON agent_prompt_revisions(agent_id);
CREATE INDEX agent_prompt_rev_created_idx ON agent_prompt_revisions(agent_id, created_at DESC);
```

---

## Feature 5: Routine / Heartbeat Concurrency Policies

### Overview
When a scheduled heartbeat or cron fires but the agent's previous run is still active, the system currently has no policy for handling this. Add configurable concurrency and catch-up policies.

### Current State
- `subaccountAgents` has: `heartbeatEnabled`, `heartbeatIntervalHours`, `heartbeatOffsetMinutes`, `scheduleCron`, `scheduleEnabled`, `scheduleTimezone`
- `orgAgentConfigs` mirrors similar fields at org level
- No field controlling what happens when a run is already active
- No field controlling missed-run catch-up behaviour

### Database Schema Changes

**Modify `subaccount_agents` table — add columns:**

| Column | Type | Default |
|--------|------|---------|
| concurrencyPolicy | text | 'skip_if_active' — enum: 'skip_if_active', 'coalesce_if_active', 'always_enqueue' |
| catchUpPolicy | text | 'skip_missed' — enum: 'skip_missed', 'enqueue_missed_with_cap' |
| catchUpCap | integer | 3 — max missed runs to enqueue on catch-up |
| maxConcurrentRuns | integer | 1 — hard cap on simultaneous runs for this agent |

**Mirror on `org_agent_configs` table** (same columns, same defaults).

### Policy Definitions

**Concurrency policies (when schedule fires and agent is already running):**
- `skip_if_active` — drop the trigger silently. Log it. Default and safest.
- `coalesce_if_active` — queue exactly one pending run. If one is already queued, drop the new trigger. Guarantees the agent runs again after current completes.
- `always_enqueue` — queue every trigger. Dangerous at short intervals but useful for event-driven triggers where every event matters.

**Catch-up policies (when agent resumes after being paused/disabled):**
- `skip_missed` — ignore all missed windows. Agent picks up from now. Default.
- `enqueue_missed_with_cap` — calculate how many runs were missed, enqueue up to `catchUpCap` (default 3) to catch up. Prevents unbounded queue buildup.

### Service Layer Changes

**Modify heartbeat/schedule execution path:**

In `agentScheduleService.ts` or wherever runs are triggered.

**IMPORTANT — Race condition prevention (from review feedback):**
A naive `countActiveRuns()` check is not safe — two triggers can pass simultaneously. Use one of:
1. **pg-boss queue (preferred):** Since we already use pg-boss, enqueue all triggers as jobs and let the queue enforce concurrency via `teamSize` / `teamConcurrency` options per queue name. The concurrency policy becomes a pre-enqueue check using pg-boss's built-in job state queries (which are transactional).
2. **PostgreSQL advisory lock:** `SELECT pg_try_advisory_xact_lock(hashtext(subaccountAgentId))` — if lock acquired, proceed; if not, apply policy. This is transactional and race-safe.

```ts
async function enqueueRunWithPolicy(subaccountAgentId: string): Promise<boolean> {
  // Use pg-boss to atomically check + enqueue
  const config = await getSubaccountAgent(subaccountAgentId);
  // Queue naming invariant: deterministic and unique per execution scope.
  // Pattern: `agent-run:{subaccountAgentId}` — ensures concurrency is scoped per agent-subaccount pair.
  const queueName = `agent-run:${subaccountAgentId}`;

  // pg-boss getQueueSize returns active + queued count atomically
  const activeCount = await boss.getQueueSize(queueName, { before: 'completed' });

  if (activeCount >= config.maxConcurrentRuns) {
    switch (config.concurrencyPolicy) {
      case 'skip_if_active':
        logger.info('heartbeat_skipped', { subaccountAgentId, reason: 'active_run' });
        return false;
      case 'coalesce_if_active':
        // pg-boss can check for existing queued jobs atomically
        const queuedCount = await boss.getQueueSize(queueName, { before: 'active' });
        if (queuedCount > 0) {
          logger.info('heartbeat_coalesced', { subaccountAgentId, reason: 'already_queued' });
          return false;
        }
        return true;
      case 'always_enqueue':
        return true;
    }
  }
  return true;
}
```

**Catch-up logic** — on agent resume (status change from inactive/paused to active):
1. Calculate missed windows since last run (based on cron schedule or heartbeat interval)
2. If `catchUpPolicy` = 'skip_missed', do nothing
3. If `catchUpPolicy` = 'enqueue_missed_with_cap', enqueue min(missedCount, catchUpCap) runs

### API Changes

Extend existing PATCH endpoints for subaccount agents and org agent configs to accept:
- `concurrencyPolicy`
- `catchUpPolicy`
- `catchUpCap`
- `maxConcurrentRuns`

Add Zod validation for enum values and numeric ranges.

### Frontend Changes

**Modify agent heartbeat/schedule settings section:**
- Add "Concurrency Policy" dropdown: Skip if active / Queue one / Queue all
- Add "Catch-up Policy" dropdown: Skip missed / Catch up (with cap input)
- Add "Max Concurrent Runs" number input (range 1-10)
- Show tooltip explanations for each policy option

### Migration

```sql
ALTER TABLE subaccount_agents
  ADD COLUMN concurrency_policy TEXT NOT NULL DEFAULT 'skip_if_active',
  ADD COLUMN catch_up_policy TEXT NOT NULL DEFAULT 'skip_missed',
  ADD COLUMN catch_up_cap INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN max_concurrent_runs INTEGER NOT NULL DEFAULT 1;

ALTER TABLE org_agent_configs
  ADD COLUMN concurrency_policy TEXT NOT NULL DEFAULT 'skip_if_active',
  ADD COLUMN catch_up_policy TEXT NOT NULL DEFAULT 'skip_missed',
  ADD COLUMN catch_up_cap INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN max_concurrent_runs INTEGER NOT NULL DEFAULT 1;
```

---

## Feature 6: Projects Gap Fixes

### Overview
Projects exist as a lightweight container but have critical gaps. This spec fixes the broken task filtering and adds the missing capabilities to match Paperclip's project depth.

### Bug Fix: Task Filtering by Project (CRITICAL)

**Problem:** `GET /api/subaccounts/:subaccountId/tasks` ignores the `projectId` query parameter. The server route at `server/routes/tasks.ts:20-22` only extracts `status`, `priority`, `assignedAgentId`, and `search`.

**Fix in `server/routes/tasks.ts`:**
- Extract `projectId` from `req.query`
- Pass to `taskService.listTasks()`

**Fix in `server/services/taskService.ts` — `listTasks()`:**
- Accept `projectId` parameter
- Add `and(eq(tasks.projectId, projectId))` to the where clause when provided

### Schema Changes

**Modify `projects` table — add columns:**

| Column | Type | Constraints |
|--------|------|-------------|
| targetDate | timestamp | nullable, withTimezone |
| budgetCents | integer | nullable — monthly budget cap for this project |
| budgetWarningPercent | integer | default(75) — alert threshold |

**Modify `cost_aggregates` table or add project attribution:**
- Add `projectId` column (nullable, FK → projects.id) to `cost_aggregates`
- Index: `cost_agg_project_idx` on (projectId)
- When creating cost aggregate entries for agent runs, if the triggering task has a `projectId`, propagate it to the cost aggregate

### API Changes

**Extend `GET /api/subaccounts/:subaccountId/projects/:projectId`:**
Return enriched response including:
- `taskCounts`: `{ total, inbox, inProgress, done }` — count tasks by status where projectId matches
- `totalSpendCents`: sum from cost_aggregates where projectId matches
- `budgetUtilizationPercent`: computed from totalSpendCents / budgetCents

**Extend `PATCH /api/subaccounts/:subaccountId/projects/:projectId`:**
Accept: `targetDate`, `budgetCents`, `budgetWarningPercent`

### Frontend Changes

**Modify `ProjectDetailPage.tsx`:**
- Show target date with date picker for editing
- Show budget bar (green/yellow/red based on utilization) if budgetCents is set
- Task list now actually filters correctly (server fix above)
- Add task count summary chips: "5 In Progress · 3 Done · 2 Inbox"
- Add "Cost" section showing total project spend

**Modify `ProjectsPage.tsx`:**
- Show target date on project cards
- Show budget utilization mini-bar on cards if budget set

**Modify task create/edit:**
- ProjectPicker already exists — ensure it works in all task creation paths (manual, agent-created, handoff)

### Service Layer

**`projectService.ts` — new methods:**
- `getProjectStats(projectId, orgId)` — returns task counts by status and total spend
- `checkProjectBudget(projectId, orgId)` — returns utilization %, fires alert if > warningPercent

**`costAggregateService.ts` — modify:**
- When recording cost for a run, include the projectId in the cost aggregate row

**Project cost attribution strategy (from review feedback):**
Don't infer projectId from the task at cost-recording time — this is fragile for multi-task runs, retries, and agent-triggered runs. Instead:
- Attach `projectId` directly to `agentRuns` at run creation time (when the run is triggered from a task, copy the task's projectId to the run)
- Add `projectId` column to `agent_runs` table (nullable, FK → projects.id)
- Cost aggregation then reads projectId from the run, not inferred from the task
- This survives task reassignment, retries, and multi-task scenarios
- **Edge case:** Runs triggered by heartbeat, manual trigger, or webhook with no originating task → `projectId = NULL`. Never infer or backfill projectId from downstream task updates after run creation.

### Migration

```sql
ALTER TABLE projects
  ADD COLUMN target_date TIMESTAMPTZ,
  ADD COLUMN budget_cents INTEGER,
  ADD COLUMN budget_warning_percent INTEGER DEFAULT 75;

ALTER TABLE cost_aggregates
  ADD COLUMN project_id UUID REFERENCES projects(id);
CREATE INDEX cost_agg_project_idx ON cost_aggregates(project_id);

ALTER TABLE agent_runs
  ADD COLUMN project_id UUID REFERENCES projects(id);
CREATE INDEX agent_runs_project_idx ON agent_runs(project_id);
```

---

## Feature 7: HTTP/Webhook Agent Adapter

### Overview
A new agent adapter type that sends heartbeat/task payloads to an external HTTP endpoint and receives responses. Enables "bring your own agent" — any system that can handle HTTP requests becomes an agent in our platform.

### How It Works

1. Operator configures an agent with adapter type `http_webhook`
2. When the agent is triggered (heartbeat, task assignment, manual), the system POSTs a structured payload to the configured URL
3. The external system processes the request and either:
   - Returns a synchronous response (for fast operations)
   - Returns a 202 Accepted and later calls back to a return webhook URL

### Schema Changes

**Modify `agents` table — new `modelProvider` value:** `'http_webhook'`

**New table: `webhook_adapter_configs`**

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, defaultRandom() |
| agentId | uuid | notNull, FK → agents.id, unique |
| organisationId | uuid | notNull, FK → organisations.id |
| endpointUrl | text | notNull — the URL to POST to |
| authType | text | notNull, default('none') — enum: 'none', 'bearer', 'hmac_sha256', 'api_key_header' |
| authSecret | text | nullable — encrypted at rest (use existing secret encryption) |
| authHeaderName | text | nullable — custom header name for api_key_header type (default: X-API-Key) |
| timeoutMs | integer | notNull, default(300000) — 5 min default |
| retryCount | integer | notNull, default(2) |
| retryBackoffMs | integer | notNull, default(5000) — base delay, exponential backoff with jitter: delay = base * 2^attempt + random(0, base/2) |
| expectCallback | boolean | notNull, default(false) — if true, system waits for callback instead of sync response |
| callbackSecret | text | nullable — secret for validating incoming callbacks (HMAC) |
| createdAt | timestamp | notNull, defaultNow(), withTimezone |
| updatedAt | timestamp | notNull, defaultNow(), withTimezone |

### Outbound Payload Shape

```ts
interface WebhookHeartbeatPayload {
  eventType: 'heartbeat' | 'task_assigned' | 'manual_trigger';
  agentId: string;
  agentName: string;
  runId: string;
  task?: {
    id: string;
    title: string;
    description: string;
    brief: string;
    priority: string;
    goalContext?: string;   // from Feature 1
  };
  context: {
    subaccountId: string;
    subaccountName: string;
    organisationId: string;
  };
  idempotencyKey: string;    // set to runId — external systems SHOULD use this to deduplicate repeated webhook deliveries on retry
  callbackUrl: string;      // URL to POST results back to
  callbackToken: string;    // one-time token for authenticating callback
  timestamp: string;
}
```

### Inbound Response / Callback Shape

```ts
interface WebhookAgentResponse {
  status: 'completed' | 'failed' | 'in_progress';
  message?: string;         // agent's response text
  taskUpdates?: {
    status?: string;        // move task to this status
    deliverables?: Array<{ title: string; content: string; type: string }>;
  };
  error?: string;           // on failure
  metadata?: Record<string, unknown>;
}
```

### API Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/webhooks/agent-callback/:runId` | Receive async callback from external agent |

Callback endpoint validates `callbackToken` from request header, updates run status, and processes task updates.

**Webhook security hardening (from review feedback):**
- `callbackToken` MUST be a signed JWT containing: `{ runId, agentId, orgId, exp }` with 15-minute expiry
- Reject tokens where `runId` doesn't match the URL parameter
- Enforce at DB level: `UPDATE agent_runs SET status = :newStatus WHERE id = :runId AND status = 'waiting_callback'` — if zero rows affected, reject (prevents race on duplicate callbacks)
- Require `X-Timestamp` header, reject requests with drift > 5 minutes
- Log all callback attempts (success and failure) to audit events

### Service Layer

**New: `webhookAdapterService.ts`**
- `triggerWebhookAgent(agentId, runId, task, context)` — build payload, sign request, POST to endpoint
- `handleCallback(runId, callbackToken, response)` — validate token, update run, process task updates
- `signRequest(payload, secret, authType)` — generate auth header based on config

**Request signing:**
- `bearer`: `Authorization: Bearer <secret>`
- `hmac_sha256`: `X-Signature: sha256=<HMAC of body using secret>`
- `api_key_header`: `<authHeaderName>: <secret>`

**Modify `agentExecutionService.ts`:**
- In the run execution path, check if agent's modelProvider is `http_webhook`
- If so, delegate to `webhookAdapterService.triggerWebhookAgent()` instead of the LLM pipeline
- If `expectCallback` is true, set run status to `waiting_callback` and return
- If sync response, process immediately

**Webhook failure state machine (explicit):**

```
queued → running (webhook POST sent)
  ├─ sync response 2xx → completed
  ├─ sync response 4xx/5xx → retry (up to retryCount with exponential backoff + jitter)
  │   └─ retries exhausted → failed_retry_exhausted
  ├─ timeout (no response within timeoutMs) → retry
  │   └─ retries exhausted → failed_timeout
  └─ expectCallback = true:
      └─ running → waiting_callback
          ├─ callback received within 15 min → completed/failed (per callback payload)
          └─ no callback within 15 min → failed_timeout (SLA breach)
```

**Callback SLA enforcement:** Schedule a pg-boss delayed job at webhook send time with 15-minute delay. Job checks if run is still `waiting_callback` — if so, transition to `failed_timeout`. If run is already completed/failed, no-op.

**Circuit breaker:** Protect against permanently failing or slow external endpoints.
- Track failure count per agent in a rolling window (last 10 minutes)
- If failures >= 5 in window: trip the circuit — skip further webhook calls, set run status to `failed` with reason `circuit_breaker_open`
- Surface in inbox alerts tab: "Agent X webhook endpoint failing — 5 consecutive failures"
- Auto-reset: after 5 minutes with no attempts, allow one probe request. If it succeeds, close the circuit.
- State is in-memory (not persisted) — resets on server restart, which is acceptable.
- In multi-instance deployments, circuit breaker state is per-instance and not globally coordinated (acceptable for MVP). If needed later, move state to Redis.

### Frontend Changes

**Modify agent create/edit — when modelProvider = 'http_webhook':**
- Show webhook configuration section instead of LLM model selection
- Fields: Endpoint URL, Auth Type dropdown, Auth Secret (password field), Timeout, Retry Count
- "Expects Callback" toggle with explanation text
- "Test Connection" button that sends a test ping to the endpoint

### Migration

```sql
CREATE TABLE webhook_adapter_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) UNIQUE,
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  endpoint_url TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'none',
  auth_secret TEXT,
  auth_header_name TEXT,
  timeout_ms INTEGER NOT NULL DEFAULT 300000,
  retry_count INTEGER NOT NULL DEFAULT 2,
  retry_delay_ms INTEGER NOT NULL DEFAULT 5000,
  expect_callback BOOLEAN NOT NULL DEFAULT false,
  callback_secret TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## Feature 8: File Attachments on Tasks

### Overview
Drag-and-drop file upload on tasks. Support images, PDFs, markdown, and text files. Agents can attach deliverables as files. Image gallery lightbox for previewing.

### Database Schema

**New table: `task_attachments`**

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, defaultRandom() |
| taskId | uuid | notNull, FK → tasks.id |
| organisationId | uuid | notNull, FK → organisations.id |
| fileName | text | notNull |
| fileType | text | notNull — MIME type |
| fileSizeBytes | integer | notNull |
| storageKey | text | notNull — S3 key or local path |
| storageProvider | text | notNull, default('local') — enum: 'local', 's3' |
| thumbnailKey | text | nullable — for images |
| uploadedBy | uuid | nullable, FK → users.id |
| uploadedByAgentId | uuid | nullable, FK → agents.id |
| createdAt | timestamp | notNull, defaultNow(), withTimezone |
| deletedAt | timestamp | nullable, withTimezone |

**Indexes:**
- `task_attach_task_idx` on (taskId)
- `task_attach_org_idx` on (organisationId)

### Storage

**Local storage (default):** Files stored in `data/attachments/{orgId}/{taskId}/{uuid}-{filename}`
**S3 (optional):** If `S3_BUCKET` env var is set, use S3. Config: bucket, region, prefix.

Use `multer` middleware for multipart upload handling (already a common Express pattern). Max file size: 10MB per file, configurable via env var `MAX_ATTACHMENT_SIZE_MB`.

### API Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tasks/:taskId/attachments` | Upload file(s) — multipart/form-data |
| GET | `/api/tasks/:taskId/attachments` | List attachments for task |
| GET | `/api/attachments/:attachmentId/download` | Download/stream file |
| GET | `/api/attachments/:attachmentId/thumbnail` | Get thumbnail (images only) |
| DELETE | `/api/attachments/:attachmentId` | Soft-delete attachment |

Upload endpoint accepts multiple files. For images, auto-generate a thumbnail (max 200px width) using `sharp` (already in many Node.js stacks).

**File validation (from review feedback):**
- Validate MIME type server-side using magic bytes (not just file extension) — use `file-type` npm package
- Allowlist MIME types: `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`, `application/pdf`, `text/plain`, `text/markdown`
- Reject SVGs with embedded scripts (sanitise SVG content before storing)
- Enforce file size limit server-side (10MB default, configurable via `MAX_ATTACHMENT_SIZE_MB` env var)
- **Idempotency:** Accept optional `idempotencyKey` (client-generated UUID) in the upload request. Add `idempotency_key` column (nullable, text) to `task_attachments` with unique index on `(task_id, idempotency_key)`. On conflict, return existing attachment instead of creating duplicate.

### Service Layer

**`attachmentService.ts`**
- `uploadAttachments(taskId, orgId, files, uploadedBy)` — store files, create DB records, generate thumbnails for images
- `listAttachments(taskId, orgId)` — list non-deleted attachments
- `getAttachment(attachmentId, orgId)` — get file metadata + signed download URL (or stream)
- `deleteAttachment(attachmentId, orgId)` — soft-delete

### Frontend Changes

**Modify task detail page — add "Attachments" section:**
- Drop zone: dashed border area with "Drop files here or click to upload" text
- File list: rows showing filename, type icon, size, uploader, timestamp, delete button
- Image thumbnails: inline preview for image types
- Click image → lightbox gallery modal (cycle through images with arrow keys)
- Click non-image → download

**New components:**
- `FileDropZone.tsx` — drag-and-drop upload area with progress indicator
- `AttachmentList.tsx` — file list with type icons and actions
- `ImageGalleryModal.tsx` — fullscreen lightbox with prev/next navigation

**Agent-created attachments:**
- When agents use the `add_deliverable` skill with file content, optionally save as attachment
- Show agent avatar as uploader

### Migration

```sql
CREATE TABLE task_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  storage_provider TEXT NOT NULL DEFAULT 'local',
  thumbnail_key TEXT,
  uploaded_by UUID REFERENCES users(id),
  uploaded_by_agent_id UUID REFERENCES agents(id),
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT task_attach_idempotency UNIQUE(task_id, idempotency_key)  -- NULLs bypass: idempotency only enforced when key is provided
);

CREATE INDEX task_attach_task_idx ON task_attachments(task_id);
CREATE INDEX task_attach_org_idx ON task_attachments(organisation_id);
```

---

## Feature 9: Feedback Voting on Agent Outputs

### Overview
Thumbs up/down on agent-generated comments, deliverables, and task activities. Collects quality signal for agent improvement over time.

### Database Schema

**New table: `feedback_votes`**

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, defaultRandom() |
| organisationId | uuid | notNull, FK → organisations.id |
| userId | uuid | notNull, FK → users.id |
| entityType | text | notNull — enum: 'task_activity', 'task_deliverable', 'agent_message' |
| entityId | uuid | notNull |
| vote | text | notNull — enum: 'up', 'down' |
| comment | text | nullable — optional reason |
| agentId | uuid | nullable, FK → agents.id — which agent produced this output |
| createdAt | timestamp | notNull, defaultNow(), withTimezone |
| updatedAt | timestamp | notNull, defaultNow(), withTimezone |

**Indexes:**
- `feedback_user_entity_uniq` unique on (userId, entityType, entityId) — one vote per user per item
- `feedback_agent_idx` on (agentId)
- `feedback_org_idx` on (organisationId)

### API Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/feedback` | Create or update vote: `{ entityType, entityId, vote, comment? }` |
| DELETE | `/api/feedback/:feedbackId` | Remove vote (hard delete — exception to CC-3, feedback votes are ephemeral user actions not audit-worthy records) |
| GET | `/api/feedback/agent/:agentId/summary` | Aggregate: total up/down per agent |

POST is an upsert — if user already voted on this entity, update the vote.

### Service Layer

**`feedbackService.ts`**
- `upsertVote(userId, orgId, entityType, entityId, vote, comment?)` — upsert with conflict on unique index
- `removeVote(feedbackId, userId, orgId)` — delete
- `getAgentFeedbackSummary(agentId, orgId, dateRange?)` — count up/down votes, recent negative feedback list

### Frontend Changes

**Add to task activity items and deliverables:**
- Two small icon buttons: thumbs-up / thumbs-down
- Filled state when voted, outline when not
- Click to toggle vote (click again to remove)
- Optional: on downvote, show a small text input for "What went wrong?" (max 200 chars)

**Add to agent detail page — "Feedback" section:**
- Show aggregate: "85% positive (34 up, 6 down) last 30 days"
- List recent negative feedback with linked task/activity for investigation

### Migration

```sql
CREATE TABLE feedback_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  vote TEXT NOT NULL,
  comment TEXT,
  agent_id UUID REFERENCES agents(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, entity_type, entity_id)
);

CREATE INDEX feedback_agent_idx ON feedback_votes(agent_id);
CREATE INDEX feedback_org_idx ON feedback_votes(organisation_id);
CREATE INDEX feedback_agent_time_idx ON feedback_votes(agent_id, created_at);
```

---

## Feature 10: Mobile Responsiveness Audit & Fixes

### Overview
Ensure all key operator flows work well on mobile. Paperclip explicitly markets "manage from your phone" — we should match this for the most critical screens.

### No Schema Changes

### Approach
This is a CSS/layout audit, not a feature build. Use Tailwind responsive breakpoints (`sm:`, `md:`, `lg:`) which we already use.

### Priority Screens (audit and fix these first)

1. **Inbox/Review Queue** — most likely used on mobile for quick approvals
   - Ensure cards stack vertically on small screens
   - Action buttons (approve/reject) should be full-width on mobile
   - Consider swipe-to-approve/reject gesture (nice-to-have)

2. **Dashboard** — checking agent status on the go
   - Metric cards: 2-column grid on mobile (currently may be 4-col)
   - Charts: stack vertically, ensure readable at small sizes
   - Activity feed: full-width cards

3. **Agent list** — quick status check
   - Switch to single-column card layout on mobile
   - Status dots and live-run indicators must remain visible
   - Collapse non-essential columns (model, heartbeat interval)

4. **Task detail** — reviewing agent work
   - Properties panel: move to bottom sheet on mobile (not side panel)
   - Comment input: sticky to bottom of screen
   - Attachments: horizontal scroll for image thumbnails

5. **Navigation** — overall app navigation
   - Sidebar: collapsible overlay on mobile (hamburger menu)
   - Breadcrumbs: truncate with ellipsis on narrow screens
   - Bottom nav bar for mobile: Inbox, Dashboard, Tasks, Agents, More

### Implementation

**New component: `MobileBottomNav.tsx`**
- Fixed bottom bar with 5 icons
- Only visible below `md:` breakpoint
- Highlights active route
- Badge counts on Inbox icon

**Modify `Layout.tsx`:**
- Hide sidebar below `md:` breakpoint, show hamburger toggle
- Add `MobileBottomNav` for small screens
- Ensure command palette (Cmd+K) still works on mobile via menu button

### Performance on Mobile (from review feedback)
- **Inbox:** Limit initial fetch to 20 items, load more on scroll (cursor pagination)
- **Org Chart:** Lazy-load agent cards. For 20+ agents, virtualise rendering — only render nodes visible in the viewport. Collapse deep branches by default on mobile.
- **Task lists:** Use virtualised list (`react-window` or `@tanstack/react-virtual`) for subaccounts with 100+ tasks
- **Dashboard charts:** Use lightweight chart rendering. Consider skipping charts on mobile and showing numeric summaries only.

### Testing
- Use Chrome DevTools responsive mode at 375px (iPhone SE), 390px (iPhone 14), 768px (iPad)
- Test touch targets: minimum 44×44px per Apple HIG
- Test scrolling: no horizontal scroll on any page

---

## Feature 11: Per-Org Branding

### Overview
Allow organisations to set a logo and brand colour that appears in the nav bar and client-facing views. Simple implementation for white-label agency use case.

### Schema Changes

**Modify `organisations` table — add columns:**

| Column | Type | Default |
|--------|------|---------|
| logoUrl | text | nullable — URL or storage key for logo image |
| brandColor | text | nullable — hex colour, e.g. '#6366f1' |

### API Changes

**Extend `PATCH /api/organisations/:orgId`:**
- Accept `brandColor` — validate strict hex format: `/^#[0-9a-fA-F]{6}$/`

**New endpoint:**
- `POST /api/organisations/:orgId/logo` — upload logo image (multipart, reuse attachment storage logic from Feature 8)
- `DELETE /api/organisations/:orgId/logo` — remove logo

**Validation rules (from review feedback):**
- Logo: accept PNG, JPEG, WebP, GIF only (max 2MB). **Reject SVG** to prevent XSS injection via embedded scripts.
- Brand colour: strict hex validation, no CSS keywords or rgb() values
- Logo dimensions: recommend 200×200px or smaller, warn if larger than 500×500px

### Frontend Changes

**Modify `Layout.tsx` / nav bar:**
- If `org.logoUrl` exists, show logo image instead of default app icon
- If `org.brandColor` exists, apply as CSS variable `--brand-color` and use for nav accent, sidebar highlights, and primary buttons

**Modify org settings page:**
- "Branding" section with:
  - Logo upload with preview (accept PNG, JPEG, WebP, GIF — max 2MB, no SVG)
  - Brand colour picker (hex input + colour swatch)
  - "Remove logo" button
  - Preview of how the nav will look

### Migration

```sql
ALTER TABLE organisations
  ADD COLUMN logo_url TEXT,
  ADD COLUMN brand_color TEXT;
```

---

## Feature 12: Agent Hiring Approval Gate

### Overview
Optional org-level setting that requires approval before new agents can be activated. Uses existing review gate infrastructure.

### Schema Changes

**Modify `organisations` table — add column:**

| Column | Type | Default |
|--------|------|---------|
| requireAgentApproval | boolean | default(false) |

### Service Layer Changes

**Modify `agentService.ts` — `createAgent()`:**

After creating the agent, check `org.requireAgentApproval`:
- If `false`: agent is created with status `'draft'` as normal (existing behaviour)
- If `true`: agent is created with status `'pending_approval'` and a review item is created:

```ts
if (org.requireAgentApproval) {
  // Create agent with pending status
  await db.update(agents).set({ status: 'pending_approval' }).where(eq(agents.id, newAgent.id));

  // Create review item
  await reviewService.createReviewItem({
    organisationId: orgId,
    subaccountId: subaccountId,
    entityType: 'agent_activation',
    entityId: newAgent.id,
    title: `Approve new agent: ${newAgent.name}`,
    description: `Agent "${newAgent.name}" (${newAgent.agentRole || 'no role'}) requires approval before activation.`,
    payload: { agentId: newAgent.id, agentName: newAgent.name, agentRole: newAgent.agentRole },
  });
}
```

**Add new status value:** `'pending_approval'` to agents status enum (alongside draft, active, inactive).

**Modify review item approval handler:**
When a review item of type `agent_activation` is approved:
- Set agent status from `'pending_approval'` to `'draft'` (or `'active'` if auto-activate is desired)

When rejected:
- Soft-delete the agent or set to `'inactive'`

### API Changes

**Extend `PATCH /api/organisations/:orgId`:**
- Accept `requireAgentApproval` boolean

### Frontend Changes

**Modify org settings page:**
- Add toggle: "Require approval for new agents" with explanation text
- Under "Governance" or "Security" section

**Modify agent list:**
- Show "Pending Approval" badge on agents with `status = 'pending_approval'`
- These agents appear in the Inbox/Review Queue for approval

**Modify Review Queue:**
- Handle `agent_activation` review type: show agent name, role, model config
- Approve → activates agent
- Reject → removes agent

### Migration

```sql
ALTER TABLE organisations
  ADD COLUMN require_agent_approval BOOLEAN NOT NULL DEFAULT false;
```

---

## Implementation Phases

### Phase 1 — Foundation (Features 1, 2, 4)
Goal Hierarchy, Org Chart, Instruction Versioning. These are independent, can be built in parallel. No cross-dependencies.

### Phase 2 — Operations (Features 3, 5, 6)
Inbox Enhancements, Concurrency Policies, Projects Gap Fixes. These improve day-to-day operations.

### Phase 3 — Ecosystem (Features 7, 8, 9)
HTTP Adapter, File Attachments, Feedback Voting. These extend platform capabilities.

### Phase 4 — Polish (Features 10, 11, 12)
Mobile, Branding, Hiring Gate. These are incremental improvements.

Each phase can be shipped independently. Within phases, features have no dependencies on each other.

---

## Build Rules (Enforce During Implementation)

These are not design decisions — they are execution discipline rules that prevent the spec from degrading during build.

### BR-1: Strict Validation at API Boundary

Every route MUST validate inputs with Zod before passing to service layer:
- Reject unknown fields (`z.object().strict()`)
- Enforce enum constraints centrally (import from shared enums, don't inline strings)
- Validate UUIDs, hex colours, URLs, MIME types at the boundary — services should never receive malformed input

Critical for: `concurrencyPolicy`, `catchUpPolicy`, `webhook payloads`, `inbox filters`, `goal level/status enums`.

### BR-2: Single Writer Per Concern

No two services may write to the same concern. Ownership is exclusive:

| Concern | Single Writer |
|---------|--------------|
| Agent run state | `agentExecutionService` ONLY |
| Inbox items/state | `inboxService` ONLY |
| Cost aggregation | `costAggregateService` ONLY |
| Webhook lifecycle | `webhookAdapterService` ONLY |
| Review items | `reviewService` ONLY |
| Goal hierarchy | `goalService` ONLY |

If another service needs to trigger a state change, it calls the owning service — never writes directly.

### BR-3: Structured Operational Logging

Every service log MUST include structured context:

```ts
logger.info('webhook_invoked', {
  correlationId,
  organisationId,
  subaccountId,
  entityId,
  action: 'webhook.invoke',
  status: 'success',
});
```

Minimum fields: `correlationId`, `organisationId`, `action`, `status`. Add `subaccountId` and `entityId` where applicable. This is separate from audit events — audit events are for compliance, operational logs are for debugging.

### BR-4: Migration Ordering

Schema changes with interdependencies must follow this deploy order:
1. **Schema first** — deploy new tables and columns (nullable, with defaults)
2. **Write paths second** — deploy services that populate new columns
3. **Read paths last** — deploy UI and queries that depend on new data

Never deploy a read path before the write path that populates it — this causes empty/broken UI states.

### BR-5: Feature Flags (Recommended)

Gate new features behind simple boolean flags in org settings or env config:

```ts
const FEATURE_FLAGS = {
  goalsEnabled: process.env.FF_GOALS === 'true',
  inboxV2Enabled: process.env.FF_INBOX_V2 === 'true',
  webhookAgentsEnabled: process.env.FF_WEBHOOK_AGENTS === 'true',
  attachmentsEnabled: process.env.FF_ATTACHMENTS === 'true',
};
```

This enables: incremental shipping within phases, rollback safety, and early testing with real users. Routes and UI pages check the flag before rendering.

### BR-6: Retry Ownership (No Double-Retry)

Retries exist at multiple layers. Each layer owns exactly one concern:

| Layer | Responsibility | Example |
|-------|---------------|---------|
| Queue (pg-boss) | Delivery retry — ensures the job is delivered to a worker | Job fails to dequeue → pg-boss retries |
| Service (webhook/agent) | Business retry — handles transient external failures | Webhook 503 → service retries with backoff |
| Controller/API | NO retries — returns error to caller | Never |

**Rule:** Retries must decrement a single logical counter. Never double-retry across layers (e.g., pg-boss retrying a job that already retried its webhook call internally). If the service exhausts its retries, it marks the job as failed — pg-boss does NOT retry it again.

### BR-7: Time Consistency

All internal time handling follows these rules:
- **All timestamps are UTC** — stored, compared, and transmitted in UTC
- **All DB comparisons use `now()`** (database time), not application `new Date()` — prevents clock drift between app instances
- **Frontend only** converts to local timezone for display
- **All TTLs, expiry checks, and retry delays** use UTC-based arithmetic

Applies to: webhook callback expiry, inbox TTL cleanup, heartbeat scheduling, audit event timestamps.

### BR-8: System Health Surface

Add a lightweight internal health view (not a full observability stack):

**Route:** `GET /api/admin/system-health` (system admin only)

Returns:
```ts
{
  failedRunsLast24h: number;
  webhookFailureRate: { agentId: string; failures: number; total: number }[];
  retryExhaustedLast24h: number;
  circuitBreakers: { agentId: string; state: 'closed' | 'open' | 'half_open' }[];
  queueDepth: { queueName: string; size: number }[];
  oldestPendingReview: string | null;  // ISO timestamp
}
```

This is queried on-demand (not real-time). Gives operators a single view of system health without digging through logs. Surface in the admin dashboard as a "System Health" card.

### BR-9: Backpressure Rule

When system load exceeds safe thresholds, degrade gracefully:

**Trigger:** pg-boss queue depth > 100 pending jobs OR failed job rate > 20% in last 10 minutes.

**Action:**
- Pause non-critical queues: heartbeat runs, catch-up enqueues, routine triggers
- Allow only: manual runs, webhook callbacks, inbox actions, review approvals
- Emit `system.backpressure.activated` audit event
- Surface alert in inbox

**Recovery:** Auto-resume paused queues when queue depth < 50 AND failure rate < 5% for 5 consecutive minutes.
