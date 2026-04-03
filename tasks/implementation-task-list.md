# Implementation Task List: Org-Level Agents & Cross-Subaccount Intelligence

**Source spec:** `tasks/org-level-agents-full-spec.md`
**Created:** 2026-04-03
**Approach:** Each phase is implemented sequentially. Tasks within a phase can be parallelised where noted.

---

## Pre-Implementation: Open Questions Resolved

These were identified during the codebase audit and resolved before task creation:

| Question | Decision |
|----------|----------|
| Org agent config: new table or extend `agents`? | New `orgAgentConfigs` table (option a). Mirrors `subaccountAgents` pattern — separates definition from deployment config. |
| Actions idempotency with nullable subaccountId? | Partial unique index: `UNIQUE (organisation_id, idempotency_key) WHERE subaccount_id IS NULL` alongside existing constraint. |
| Two parallel token refresh systems? | Use `integrationConnectionService.refreshWithLock` (advisory-lock pattern) for the integration layer. Add GHL case to refresh flow. |
| No org-scope flag on systemAgents? | Add `executionScope` column (`'subaccount' \| 'org'`, default `'subaccount'`) to `systemAgents`. Template service uses this to route installation. |
| HITL survivability (in-process memory)? | Accept as known limitation. Same risk exists for subaccount agents. DB-persisted HITL is a future improvement. |
| `agentTriggers.eventType` is 3-value enum? | Widen in Phase 5 when org-level triggers are built. Not needed before then. |
| `actionRegistry.ts` is static TypeScript? | Acceptable. New skills require code deploy (new `.md` + executor). Dynamic registration deferred. |
| GHL missing from `performTokenRefresh`? | Add GHL case to `connectionTokenService.performTokenRefresh` as part of Phase 2. |

---

## Phase 1: Org-Level Agent Execution (Foundation)

### 1.1 Schema Migration: Nullable subaccountId on core tables

Write a single Drizzle migration (0043) that:

- [ ] Make `agent_runs.subaccount_id` nullable (drop NOT NULL)
- [ ] Make `agent_runs.subaccount_agent_id` nullable (drop NOT NULL)
- [ ] Make `review_items.subaccount_id` nullable (drop NOT NULL)
- [ ] Make `actions.subaccount_id` nullable (drop NOT NULL)
- [ ] Add partial unique index on `actions`: `UNIQUE (organisation_id, idempotency_key) WHERE subaccount_id IS NULL`
- [ ] Add composite index on `review_items`: `(organisation_id, review_status)` for org-level review queue queries
- [ ] Verify existing `org_status_idx` on `agent_runs` covers org-level run queries (audit confirmed it exists)

### 1.2 Schema: New `orgAgentConfigs` table

New schema file `server/db/schema/orgAgentConfigs.ts`:

- [ ] Create table with fields mirroring `subaccountAgents` runtime config:
  - `id` (uuid PK)
  - `organisationId` (FK → organisations, NOT NULL)
  - `agentId` (FK → agents, NOT NULL)
  - `isActive` (boolean, default true)
  - `tokenBudgetPerRun` (integer, default 30000)
  - `maxToolCallsPerRun` (integer, default 20)
  - `timeoutSeconds` (integer, default 300)
  - `maxCostPerRunCents` (integer, nullable)
  - `maxLlmCallsPerRun` (integer, nullable)
  - `skillSlugs` (jsonb, nullable)
  - `allowedSkillSlugs` (jsonb, nullable)
  - `customInstructions` (text, nullable)
  - `heartbeatEnabled` (boolean, default false)
  - `heartbeatIntervalHours` (integer, default 24)
  - `heartbeatOffsetMinutes` (integer, default 0)
  - `scheduleCron` (text, nullable)
  - `scheduleEnabled` (boolean, default false)
  - `scheduleTimezone` (text, default 'UTC')
  - `lastRunAt` (timestamptz, nullable)
  - `allowedSubaccountIds` (jsonb, nullable — for Phase 5 cross-boundary writes)
  - `createdAt`, `updatedAt`
- [ ] Unique constraint on `(organisationId, agentId)`
- [ ] Add to `server/db/schema/index.ts` exports
- [ ] Include in migration 0043

### 1.3 Schema: Add `executionScope` to `systemAgents`

- [ ] Add `executionScope` column to `systemAgents`: text, default `'subaccount'`, enum `'subaccount' | 'org'`
- [ ] Include in migration 0043

### 1.4 Service: `orgAgentConfigService`

New service file `server/services/orgAgentConfigService.ts`:

- [ ] CRUD methods: `create`, `get`, `getByAgentId(orgId, agentId)`, `update`, `delete`, `listByOrg(orgId)`
- [ ] `getActiveConfigs(orgId)` — returns all active org agent configs (for scheduling)
- [ ] Follows existing service patterns (error shape `{ statusCode, message }`, org scoping)

### 1.5 Routes: Org agent config management

New route file `server/routes/orgAgentConfigs.ts`:

- [ ] `GET /api/org/agent-configs` — list all org agent configs
- [ ] `POST /api/org/agent-configs` — create new org agent config
- [ ] `GET /api/org/agent-configs/:id` — get single config
- [ ] `PATCH /api/org/agent-configs/:id` — update config
- [ ] `DELETE /api/org/agent-configs/:id` — delete config
- [ ] All routes use `authenticate` + `requireOrgPermission`
- [ ] Mount in `server/index.ts`

### 1.6 Service: Update `agentExecutionService`

Modify `server/services/agentExecutionService.ts`:

- [ ] Make `subaccountId` and `subaccountAgentId` optional on `AgentRunRequest` interface
- [ ] Add config loading branch: if `subaccountAgentId` present → load from `subaccountAgents` (existing). If absent → load from `orgAgentConfigs` via `orgAgentConfigService.getByAgentId(orgId, agentId)`
- [ ] Guard `buildTeamRoster()` call: if `subaccountId` → existing path. If null → new `buildOrgTeamRoster(orgId, agentId)` that queries `orgAgentConfigs` + `agents`
- [ ] Guard `workspaceMemoryService.getMemoryForPrompt()`: skip when `subaccountId` is null (org memory comes in Phase 3)
- [ ] Guard `workspaceMemoryService.getEntitiesForPrompt()`: skip when null
- [ ] Guard `buildSmartBoardContext()`: skip when null (org board comes in Phase 5)
- [ ] Guard `devContextService.getContext()`: skip when null
- [ ] Guard `checkWorkspaceLimits()`: skip subaccount limits when null; org + global limits still apply
- [ ] Guard `extractRunInsights()` post-run: skip when `subaccountId` is null
- [ ] Guard `triggerService.checkAndFire()` post-run: skip when null
- [ ] Update Langfuse trace: use `organisationId` when `subaccountId` is null
- [ ] Update WebSocket emission: use `emitOrgUpdate()` instead of `emitSubaccountUpdate()` when `subaccountId` is null
- [ ] Update `lastRunAt`: write to `orgAgentConfigs` instead of `subaccountAgents` for org runs
- [ ] Write new `buildOrgTeamRoster(orgId, currentAgentId)` function

### 1.7 Service: Update `skillExecutor`

Modify `server/services/skillExecutor.ts`:

- [ ] Change `SkillExecutionContext.subaccountId` from `string` to `string | null`
- [ ] Update the `re-export` in `server/tools/meta/types.ts`
- [ ] Audit all tool executor functions that use `context.subaccountId`:
  - Task skills (`executeCreateTask`, `executeMoveTask`, `executeUpdateTask`, `executeReassignTask`): return clear error if `subaccountId` is null and no `targetSubaccountId` provided
  - `executeReadWorkspace`: return empty/error if null
  - `executeWriteWorkspace`: return error if null
  - `executeSpawnSubAgents`: query `orgAgentConfigs` instead of `subaccountAgents` when null
  - `executeWithActionAudit`: pass nullable `subaccountId`
  - `proposeReviewGatedAction`: pass nullable `subaccountId`
  - Dev skills (`read_codebase`, `write_patch`, etc.): skip `devContextService` when null
- [ ] Ensure action records are insertable with `subaccountId = null` (depends on 1.1 migration)

### 1.8 Service: Update `agentScheduleService`

Modify `server/services/agentScheduleService.ts`:

- [ ] Add org-level schedule name format: `agent-org-scheduled-run:${orgAgentConfigId}`
- [ ] Add org-level job payload: `{ orgAgentConfigId, agentId, organisationId }` (no subaccountId/subaccountAgentId)
- [ ] Update `registerAllActiveSchedules()` to also query `orgAgentConfigs` where `scheduleEnabled = true`
- [ ] Add `registerOrgSchedule(orgAgentConfigId, cron, data)` method
- [ ] Add `unregisterOrgSchedule(orgAgentConfigId)` method
- [ ] Add worker for `agent-org-scheduled-run` queue that constructs an `AgentRunRequest` without subaccountId and calls `executeRun`

### 1.9 Routes: Org-level review queue

Modify `server/routes/reviewItems.ts`:

- [ ] Add `GET /api/org/review-queue` — returns review items where `subaccountId IS NULL` for authenticated org
- [ ] Add `GET /api/org/review-queue/count` — pending count
- [ ] Update approve/reject handlers: add `emitOrgUpdate()` call alongside existing `emitSubaccountUpdate()` when `subaccountId` is null

### 1.10 Routes: Org-level agent runs

Modify `server/routes/agentRuns.ts`:

- [ ] Add `POST /api/org/agents/:agentId/run` — trigger a manual org-level run
- [ ] Add `GET /api/org/agents/:agentId/runs` — list runs for an org-level agent
- [ ] Handler constructs `AgentRunRequest` without `subaccountId`/`subaccountAgentId`, loads config from `orgAgentConfigs`

### 1.11 UI: Org agent management (minimal)

- [ ] New page or section in admin UI for managing org agent configs
- [ ] Display org-level agents with config (budget, skills, schedule)
- [ ] Manual run trigger button
- [ ] Org-level review queue page or tab on existing review queue

### 1.12 Testing & Verification

- [ ] Create an org agent config for a test agent
- [ ] Trigger a manual org-level run — verify it completes successfully
- [ ] Verify heartbeat schedule fires and produces a run
- [ ] Verify HITL-gated action from org agent appears in org review queue
- [ ] Verify approve/reject works on org-level review items
- [ ] Verify zero regression on existing subaccount agent flows
- [ ] Verify WebSocket emissions go to org room for org runs
