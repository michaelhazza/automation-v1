# HITL Platform Development Spec

**Source:** `docs/hitl-platform-dev-brief-v3.md` + `docs/agent-orchestration-hitl-reference.md`
**Scope:** Phase 1A — Platform Foundations
**Branch:** `claude/review-codebase-brief-JBEMK`

---

## What We're Building

An action/approval layer that sits between agent tool calls and real-world side effects. Agents propose actions; the platform gates execution based on policy. Internal operations auto-execute with audit trails. External/boundary operations queue for human review.

**Core principle:** Autonomy inside the system. Control at the boundary.

---

## Phase 1A Deliverables (This Build)

### 1. Database Migration

New tables:
- `actions` — proposed work units with structured payload, state machine, idempotency
- `action_events` — immutable audit trail of every action state transition
- `review_items` — human-facing projection of actions needing approval
- `integration_connections` — stored external service credentials per subaccount
- `processed_resources` — deduplication log for external inputs across runs
- `workspace_limits` — daily token/cost caps per subaccount

### 2. Action Type Registry

TypeScript config object (not DB table for Phase 1). Defines per action type:
- action_category, is_external, default_gate_level
- creates_board_task flag
- payload_schema (for validation)
- retry_policy (strategy, retry_on, do_not_retry_on)

Phase 1 types: `send_email`, `read_inbox`, `create_task`, `move_task`, `reassign_task`, `add_deliverable`, `update_record`

### 3. ActionService

- `proposeAction(payload)` — validate against registry, check idempotency, create record, apply gate
- `transitionState(actionId, newStatus)` — enforce legal transitions only
- `getAction(id)` / `listActions(subaccountId, filters)` — query
- All transitions emit action_events

### 4. ExecutionLayerService

- Receives approved actions, re-checks state in DB (SELECT FOR UPDATE)
- Resolves adapter from registry
- Checks idempotency (executed_at must be null)
- Dispatches to adapter, persists result/error
- Schedules retry if policy allows

### 5. Adapters

- **WorkerAdapter** — wraps existing skillExecutor internal logic (create_task, move_task, etc.)
- **APIAdapter** — stub for Phase 1B (send_email, read_inbox via providers)

### 6. ReviewService

- `createReviewItem(action)` — when action hits pending_approval
- `approveItem(id, userId, edits?)` — transactional with SELECT FOR UPDATE
- `rejectItem(id, userId)`
- `bulkApprove(ids, userId)` / `bulkReject(ids, userId)` — each item transacted individually
- `getReviewQueue(subaccountId)` / `getReviewQueueCount(subaccountId)`

### 7. Review API Routes

```
GET    /api/subaccounts/:id/review-queue
GET    /api/subaccounts/:id/review-queue/count
GET    /api/review-items/:id
POST   /api/review-items/:id/approve
POST   /api/review-items/:id/reject
POST   /api/review-items/bulk-approve
POST   /api/review-items/bulk-reject
GET    /api/subaccounts/:id/actions
GET    /api/actions/:id/events
```

### 8. skillExecutor Refactor

**Direct (unchanged):** web_search, read_workspace, spawn_sub_agents, trigger_process

**Action-gated:** create_task, move_task, reassign_task, add_deliverable → propose auto-gated action, execute synchronously, return result

**Review-gated (new skills in Phase 1B):** send_email, update_record → propose review-gated action, return `{ action_id, status: 'pending_approval' }` to agent

---

## State Machines

### Action States
```
proposed → pending_approval → approved → executing → completed
proposed → pending_approval → rejected
proposed → approved → executing → failed (→ retry?)
proposed → blocked
proposed → skipped (duplicate idempotency key)
```

### Review Item States
```
pending → edited_pending → approved → completed
pending → approved → completed
pending → rejected
```

---

## Key Implementation Rules

1. **SELECT FOR UPDATE** on all state transitions that trigger execution
2. Execution dispatched OUTSIDE the transaction (no locks held during network calls)
3. Backend always re-checks state — frontend buttons are UI convenience only
4. Bulk operations transact each item individually — failure on item N does not roll back 1..N-1
5. Idempotency: duplicate key returns existing action, not an error
6. action_events are immutable — insert only, never update or delete
7. All tables org-scoped and subaccount-scoped — strict tenant isolation

---

## Files to Create

```
server/db/schema/actions.ts
server/db/schema/actionEvents.ts
server/db/schema/reviewItems.ts
server/db/schema/integrationConnections.ts
server/db/schema/processedResources.ts
server/db/schema/workspaceLimits.ts
server/config/actionRegistry.ts
server/services/actionService.ts
server/services/executionLayerService.ts
server/services/reviewService.ts
server/services/adapters/workerAdapter.ts
server/services/adapters/apiAdapter.ts
server/routes/reviewItems.ts
server/routes/actions.ts
migrations/0016_hitl_action_system.sql
```

## Files to Modify

```
server/db/schema/index.ts          — export new schemas
server/services/skillExecutor.ts   — split direct vs action-gated
server/index.ts                    — mount new routes
```
