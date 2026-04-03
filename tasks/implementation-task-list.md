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
| Execution mode inference from nullable subaccountId? | Explicit `executionMode` flag on `agent_runs` and `AgentRunRequest`. Never infer from presence/absence of `subaccountId`. |
| Run config reproducibility? | Snapshot resolved config (`configSnapshot`, `resolvedSkillSlugs`, `resolvedLimits`) on `agent_runs` at run creation time. |
| Cross-scope idempotency collisions? | Add `action_scope` column to `actions`. Include in all idempotency checks. Separate partial indexes per scope. |
| Backfill → live transition? | Explicit `syncPhase` state machine on `connector_configs`: `backfill` → `transition` → `live`. Webhooks queued during backfill, replayed during transition. |
| Org-level kill switch? | `orgExecutionEnabled` flag on organisations table. Checked at top of `executeRun()` before config loading. Also checked at pg-boss dequeue for scheduled runs. |
| Partial run results? | Add `resultStatus` (`success`/`partial`/`failed`) to `agent_runs`. Prevents false confidence in outputs from runs where some accounts failed. |
| Config drift during long runs? | Snapshot `configHash` at run start. At completion, compare against current — log `configDriftDetected` if different. Don't block execution. |
| Webhook queue ordering? | Queue keyed by `(accountId, entityType, entityId)`. Replay ordered by `source_timestamp`, fallback `event_ingested_at`. Prevents entity state regressions. |
| Idempotency time dimension? | Rejected. Event idempotency already includes `source_timestamp`. Adding time buckets to action idempotency is over-engineering for v1. |
| Connector health derivation? | Computed `healthStatus` (`healthy`/`degraded`/`failed`) from error rate and sync delays. Failed connectors suppress health scoring. |
| Retry boundary policy? | Safe to retry: connector polling, webhook ingestion (idempotent), data reads, health scoring. NOT safe to retry: agent runs (non-idempotent side effects), intervention execution, alert delivery. Enforced at service layer. |
| Partial run output contract? | Required structured output when `resultStatus` is `partial`/`failed`: `{ processedAccounts, successfulAccounts, failedAccounts, failures[] }`. |
| Failure reason classification? | Standardised enum: `connector_timeout`, `rate_limited`, `auth_error`, `data_incomplete`, `internal_error`, `unknown`. `retryable` derived from reason, not manually set. |
| No-data vs zero-data? | Every canonical query returns `dataStatus`: `fresh`/`stale`/`missing`. Missing data excluded from scoring (not treated as zero). Skills must surface which accounts lack data. |
| Confidence floor? | Below 0.3 = unreliable. May display with warning, must not drive automated decisions. |
| Unknown failure handling? | `unknown` reason treated as high-severity + operator log. Signals classification gap. |
| Confidence propagation? | Multi-source output confidence = `MIN(all contributing confidences)`. Conservative default for v1. |
| ExecutionMode mismatch? | Hard validation: org mode requires null subaccountId, subaccount mode requires present subaccountId. Reject mismatches at run creation. |
| Reconciliation safety cap? | Max 30% of records per account per run. Exceeding halts repair + alerts operator. Prevents mass corruption from bad connector responses. |
| Kill switch audit? | Every toggle logged with actor, timestamp, reason. Enterprise debugging requirement. |
| Event group max size? | Cap at 20 events per group. Prevents runaway grouping under noisy webhook bursts. |
| `agentTriggers.eventType` is 3-value enum? | Widen in Phase 5 when org-level triggers are built. Not needed before then. |
| `actionRegistry.ts` is static TypeScript? | Acceptable. New skills require code deploy (new `.md` + executor). Dynamic registration deferred. |
| GHL missing from `performTokenRefresh`? | Add GHL case to `connectionTokenService.performTokenRefresh` as part of Phase 2. |

---

## Phase 1: Org-Level Agent Execution (Foundation)

### 1.1 Schema Migration: Nullable subaccountId on core tables

Write a single Drizzle migration (0043) that:

- [ ] Make `agent_runs.subaccount_id` nullable (drop NOT NULL)
- [ ] Make `agent_runs.subaccount_agent_id` nullable (drop NOT NULL)
- [ ] Add `agent_runs.execution_mode` column (`text NOT NULL`, values `'subaccount' | 'org'`, default `'subaccount'`) — explicit execution context, never inferred from nullable fields
- [ ] Add `agent_runs.result_status` column (`text`, nullable, values `'success' | 'partial' | 'failed'`) — distinguishes fully-completed from partially-completed runs
- [ ] Add `agent_runs.config_snapshot` column (`jsonb`, nullable) — frozen resolved config at run start for debugging/reproducibility
- [ ] Add `agent_runs.config_hash` column (`text`, nullable) — SHA-256 of config snapshot for drift detection
- [ ] Add `agent_runs.resolved_skill_slugs` column (`jsonb`, nullable) — effective skill list at run start
- [ ] Add `agent_runs.resolved_limits` column (`jsonb`, nullable) — effective budget/timeout at run start
- [ ] Make `review_items.subaccount_id` nullable (drop NOT NULL)
- [ ] Make `actions.subaccount_id` nullable (drop NOT NULL)
- [ ] Add `actions.action_scope` column (`text NOT NULL`, values `'subaccount' | 'org'`, default `'subaccount'`) — explicit scope for idempotency separation
- [ ] Add partial unique index on `actions`: `UNIQUE (organisation_id, idempotency_key) WHERE action_scope = 'org'`
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
- [ ] Add `executionMode: 'subaccount' | 'org'` to `AgentRunRequest` — callers must set this explicitly
- [ ] At run creation, set `executionMode` on the `agent_runs` record — this drives all downstream routing
- [ ] Hard validation at run creation: if `executionMode === 'org'` then `subaccountId` must be null (reject if provided). If `executionMode === 'subaccount'` then `subaccountId` must be present (reject if missing).
- [ ] Snapshot resolved config into `configSnapshot`, `resolvedSkillSlugs`, `resolvedLimits` on the `agent_runs` record before execution begins. Compute `configHash` (SHA-256 of snapshot). Include human-readable version metadata in snapshot: `configVersion`, `templateVersion`, `agentVersion`.
- [ ] At run completion, compare current config hash against snapshotted `configHash`. If different, flag `configDriftDetected: true` in run metadata (log, don't block).
- [ ] Set `resultStatus` on run completion: `'success'` if all work completed, `'partial'` if some accounts/steps failed, `'failed'` if no meaningful work completed
- [ ] When `resultStatus` is `'partial'` or `'failed'`, write structured output: `{ processedAccounts, successfulAccounts, failedAccounts, failures: [{ accountId, reason, retryable }] }` — this contract is required, not optional
- [ ] Use standardised failure reason enum: `connector_timeout`, `rate_limited`, `auth_error`, `data_incomplete`, `internal_error`, `unknown` — no free text
- [ ] Derive `retryable` from reason (not set manually): `connector_timeout` and `rate_limited` → true; all others → false
- [ ] Treat `unknown` failures as high-severity: produce operator-visible log entry (signals the classification system needs extending)
- [ ] Add config loading branch: route by `executionMode`, not by presence of `subaccountAgentId`. If `'subaccount'` → load from `subaccountAgents` (existing). If `'org'` → load from `orgAgentConfigs` via `orgAgentConfigService.getByAgentId(orgId, agentId)`
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

### 1.11 Org vs Subaccount Authority Rules

Enforce cross-cutting authority rules in the skill execution layer:

- [ ] Add guard in `skillExecutor` (or a shared `authorityGuard` utility): when `executionMode === 'org'` and a skill targets a subaccount, validate `allowedSubaccountIds` from `orgAgentConfigs`. Reject if target not in allowed list.
- [ ] Add guard: when `executionMode === 'subaccount'`, reject any attempt to access org memory (returns clear error: "Org memory is not accessible from subaccount context")
- [ ] Add guard: when `executionMode === 'subaccount'`, scope all canonical data queries to the current subaccount only — prevent cross-subaccount reads
- [ ] Add guard: cross-boundary writes (org agent writing to subaccount) always route through HITL gate regardless of skill gate level
- [ ] Set `actions.action_scope` based on `executionMode` in `executeWithActionAudit` — do not infer from nullable `subaccountId`
- [ ] Include `action_scope` in all idempotency checks
- [ ] Log `authority_violation_attempt` event on every rejected authority check: include `agentId`, `executionMode`, `attemptedScope`, `targetId`, rejection reason. Surface in operator logs.

### 1.12 Org-Level Execution Kill Switch

- [ ] Add `orgExecutionEnabled` column to `organisations` table (boolean, default `true`) — or a dedicated org settings table if one exists
- [ ] Check `orgExecutionEnabled` at the top of `agentExecutionService.executeRun()` when `executionMode === 'org'` — reject with clear error before any config loading
- [ ] Check `orgExecutionEnabled` in pg-boss `agent-org-scheduled-run` worker at dequeue time — if disabled, silently drop job (no retry) and log operator-visible entry
- [ ] Add API route to toggle: `PATCH /api/org/settings/execution-enabled` (org admin only)
- [ ] Log audit event on every toggle: `org_execution_disabled` / `org_execution_enabled` with actor, timestamp, optional reason
- [ ] Surface in org settings UI as an emergency stop toggle

### 1.13 UI: Org agent management (minimal)

- [ ] New page or section in admin UI for managing org agent configs
- [ ] Display org-level agents with config (budget, skills, schedule)
- [ ] Manual run trigger button
- [ ] Org-level review queue page or tab on existing review queue
- [ ] Kill switch toggle in org settings

### 1.14 Testing & Verification

- [ ] Create an org agent config for a test agent
- [ ] Trigger a manual org-level run — verify it completes successfully
- [ ] Verify heartbeat schedule fires and produces a run
- [ ] Verify HITL-gated action from org agent appears in org review queue
- [ ] Verify approve/reject works on org-level review items
- [ ] Verify `executionMode` is set correctly on agent_runs records (never inferred)
- [ ] Verify `configSnapshot` is populated at run start and matches resolved config
- [ ] Verify `configDriftDetected` is flagged when config changes mid-run
- [ ] Verify `resultStatus` is set correctly: `'partial'` when some accounts fail, `'success'` when all complete
- [ ] Verify partial run output includes structured failure details (accountId, reason, retryable)
- [ ] Verify failure reasons use standardised enum only (no free text)
- [ ] Verify `retryable` is derived from reason, not manually set
- [ ] Verify executionMode mismatch is rejected (org mode + subaccountId present = error)
- [ ] Verify `action_scope` is set correctly on actions and idempotency prevents cross-scope collisions
- [ ] Verify authority rules: org agent cannot write to subaccount not in `allowedSubaccountIds`
- [ ] Verify authority rules: subaccount agent cannot access org memory
- [ ] Verify authority rules: subaccount agent cannot read other subaccounts' canonical data
- [ ] Verify authority violation attempts are logged with full context (agentId, executionMode, target, reason)
- [ ] Verify kill switch: setting `orgExecutionEnabled = false` immediately blocks all org runs
- [ ] Verify kill switch: scheduled jobs are dropped (not retried) when kill switch is active
- [ ] Verify kill switch toggle produces audit log entry with actor, timestamp, reason
- [ ] Verify zero regression on existing subaccount agent flows
- [ ] Verify WebSocket emissions go to org room for org runs

---

## Phase 2: Integration Layer + GHL Connector

### 2.1 Schema Migration: Canonical entity tables

Write migration 0044 (or bundle with 0043 if Phase 1 hasn't shipped yet):

- [ ] `connector_configs` table:
  - `id` (uuid PK)
  - `organisationId` (FK → organisations, NOT NULL)
  - `connectorType` (text NOT NULL — `'ghl' | 'hubspot' | 'stripe' | 'custom'`)
  - `connectionId` (FK → integrationConnections, nullable — the OAuth connection used)
  - `configJson` (jsonb — connector-specific config: sub-account mappings, polling prefs)
  - `status` (text — `'active' | 'error' | 'disconnected'`)
  - `lastSyncAt` (timestamptz, nullable)
  - `lastSyncStatus` (text, nullable)
  - `lastSyncError` (text, nullable)
  - `pollIntervalMinutes` (integer, default 60)
  - `webhookSecret` (text, nullable — for HMAC verification)
  - `syncPhase` (text NOT NULL, default `'backfill'`, values `'backfill' | 'transition' | 'live'`) — explicit state machine for backfill lifecycle
  - `configVersion` (text, nullable — SHA-256 hash recomputed on config change, referenced by intelligence outputs)
  - `createdAt`, `updatedAt`
  - Unique: `(organisationId, connectorType)` — one connector type per org at MVP

- [ ] `canonical_accounts` table:
  - `id` (uuid PK)
  - `organisationId` (FK → organisations, NOT NULL)
  - `connectorConfigId` (FK → connector_configs, NOT NULL)
  - `subaccountId` (FK → subaccounts, nullable — mapped internal subaccount)
  - `externalId` (text NOT NULL — the ID in the external platform)
  - `displayName` (text)
  - `status` (text — `'active' | 'inactive' | 'suspended'`)
  - `externalMetadata` (jsonb — raw metadata from external platform)
  - `lastSyncAt` (timestamptz)
  - `createdAt`, `updatedAt`
  - Unique: `(connectorConfigId, externalId)`

- [ ] `canonical_contacts` table:
  - `id` (uuid PK)
  - `organisationId` (FK)
  - `accountId` (FK → canonical_accounts, NOT NULL)
  - `externalId` (text NOT NULL)
  - `firstName`, `lastName`, `email`, `phone` (text, all nullable)
  - `tags` (jsonb, nullable)
  - `source` (text, nullable)
  - `createdAt`, `updatedAt`, `externalCreatedAt` (timestamptz)
  - Unique: `(accountId, externalId)`

- [ ] `canonical_opportunities` table:
  - `id` (uuid PK)
  - `organisationId` (FK)
  - `accountId` (FK → canonical_accounts, NOT NULL)
  - `externalId` (text NOT NULL)
  - `name` (text)
  - `stage` (text)
  - `value` (numeric, nullable)
  - `currency` (text, default 'USD')
  - `status` (text — `'open' | 'won' | 'lost' | 'abandoned'`)
  - `stageEnteredAt` (timestamptz, nullable)
  - `stageHistory` (jsonb, nullable — array of `{stage, enteredAt, exitedAt}`)
  - `createdAt`, `updatedAt`, `externalCreatedAt`
  - Unique: `(accountId, externalId)`

- [ ] `canonical_conversations` table:
  - `id` (uuid PK)
  - `organisationId` (FK)
  - `accountId` (FK → canonical_accounts, NOT NULL)
  - `externalId` (text NOT NULL)
  - `channel` (text — `'sms' | 'email' | 'chat' | 'phone' | 'other'`)
  - `status` (text — `'active' | 'inactive' | 'closed'`)
  - `messageCount` (integer, default 0)
  - `lastMessageAt` (timestamptz, nullable)
  - `lastResponseTimeSeconds` (integer, nullable)
  - `createdAt`, `updatedAt`, `externalCreatedAt`
  - Unique: `(accountId, externalId)`

- [ ] `canonical_revenue` table:
  - `id` (uuid PK)
  - `organisationId` (FK)
  - `accountId` (FK → canonical_accounts, NOT NULL)
  - `externalId` (text NOT NULL)
  - `amount` (numeric NOT NULL)
  - `currency` (text, default 'USD')
  - `type` (text — `'one_time' | 'recurring' | 'refund'`)
  - `status` (text — `'pending' | 'completed' | 'failed' | 'refunded'`)
  - `transactionDate` (timestamptz)
  - `createdAt`, `updatedAt`
  - Unique: `(accountId, externalId)`

- [ ] `health_snapshots` table:
  - `id` (uuid PK)
  - `organisationId` (FK)
  - `accountId` (FK → canonical_accounts, NOT NULL)
  - `score` (integer, 0-100)
  - `factorBreakdown` (jsonb — `{factor: string, score: number, weight: number}[]`)
  - `trend` (text — `'improving' | 'stable' | 'declining'`)
  - `confidence` (real, 0.0-1.0)
  - `algorithmVersion` (text — skill code version that produced this snapshot)
  - `configVersion` (text — SHA-256 hash of scoring config at time of computation)
  - `createdAt`
  - Index: `(accountId, createdAt DESC)` for time-series queries

- [ ] `anomaly_events` table:
  - `id` (uuid PK)
  - `organisationId` (FK)
  - `accountId` (FK → canonical_accounts, NOT NULL)
  - `metricName` (text NOT NULL)
  - `currentValue` (numeric)
  - `baselineValue` (numeric)
  - `deviationPercent` (real)
  - `direction` (text — `'above' | 'below'`)
  - `severity` (text — `'low' | 'medium' | 'high' | 'critical'`)
  - `description` (text)
  - `algorithmVersion` (text — skill code version that produced this event)
  - `configVersion` (text — SHA-256 hash of detection config at time of computation)
  - `acknowledged` (boolean, default false)
  - `createdAt`
  - Index: `(accountId, createdAt DESC)`, `(organisationId, severity, acknowledged)`

- [ ] Add all new tables to `server/db/schema/index.ts`

### 2.2 Extend adapter interface

Modify `server/adapters/integrationAdapter.ts`:

- [ ] Add `ingestion` namespace to `IntegrationAdapter` interface:
  ```
  ingestion?: {
    listAccounts(connection, config): Promise<CanonicalAccount[]>
    fetchContacts(connection, accountExternalId, opts?): Promise<CanonicalContact[]>
    fetchOpportunities(connection, accountExternalId, opts?): Promise<CanonicalOpportunity[]>
    fetchConversations(connection, accountExternalId, opts?): Promise<CanonicalConversation[]>
    fetchRevenue(connection, accountExternalId, opts?): Promise<CanonicalRevenue[]>
    validateCredentials(connection): Promise<{valid: boolean, error?: string}>
  }
  ```
- [ ] Define canonical entity TypeScript types matching the DB schema
- [ ] Add `webhook` namespace:
  ```
  webhook?: {
    verifySignature(payload: Buffer, signature: string, secret: string): boolean
    normaliseEvent(rawEvent: unknown): NormalisedEvent | null
  }
  ```
- [ ] Define `NormalisedEvent` type: `{ eventType, accountExternalId, entityType, entityExternalId, data, timestamp }`

### 2.3 GHL connector: Ingestion implementation

Extend `server/adapters/ghlAdapter.ts`:

- [ ] Implement `ingestion.listAccounts` — calls GHL `/locations/search` or agency-level endpoint to enumerate sub-accounts
- [ ] Implement `ingestion.fetchContacts` — calls GHL `/contacts/` with location filter, paginates, normalises to `CanonicalContact`
- [ ] Implement `ingestion.fetchOpportunities` — calls GHL `/opportunities/search`, includes pipeline/stage data, normalises
- [ ] Implement `ingestion.fetchConversations` — calls GHL `/conversations/`, normalises
- [ ] Implement `ingestion.fetchRevenue` — calls GHL `/payments/orders` or transaction endpoints, normalises
- [ ] Implement `ingestion.validateCredentials` — simple API call to verify token works
- [ ] Add GHL case to `connectionTokenService.performTokenRefresh` (currently missing)

### 2.4 GHL connector: Rate limiter

New file `server/lib/rateLimiter.ts`:

- [ ] Implement a token-bucket or sliding-window rate limiter
- [ ] Support per-account limits (GHL: 100 req/10s per location, 200k/day)
- [ ] Queue requests when approaching limit rather than dropping
- [ ] Surface warnings when approaching thresholds (log + optional callback)
- [ ] In-memory for MVP (note: not shared across server instances — same pattern as existing rate limiters with TODO for Redis)

### 2.5 GHL connector: Webhook endpoint

New route file `server/routes/webhooks/ghlWebhook.ts`:

- [ ] `POST /api/webhooks/ghl` — unauthenticated (same pattern as `githubWebhook.ts`)
- [ ] Raw body capture via `req.on('data')` / `req.on('end')` for HMAC verification
- [ ] HMAC-SHA256 signature verification using `connector_configs.webhookSecret`
- [ ] Ack immediately with `200 { received: true }`, process async
- [ ] Call `ghlAdapter.webhook.normaliseEvent()` to translate to internal event type
- [ ] Resolve connector config from webhook payload (GHL includes locationId)
- [ ] Store normalised event — upsert to canonical entity tables
- [ ] Key events to handle: `ContactCreate`, `OpportunityStageUpdate`, `ConversationCreated`, `ConversationInactive`, `AppointmentBooked`
- [ ] Enforce `event_group_id` at ingestion layer: if connector provides one, use it. If not, auto-generate UUID. Group events arriving within 5s window for the same entity under the same group ID.
- [ ] Respect `syncPhase`: if `'backfill'`, queue webhooks instead of applying. If `'transition'`, replay queued. If `'live'`, apply normally.
- [ ] Webhook queue ordering: key queued events by `(accountId, entityType, entityId)`, replay strictly ordered by `source_timestamp` (fallback: `event_ingested_at`)
- [ ] Webhook replay dedup: before applying each replayed event, check idempotency key `(source_connector, external_id, event_type, source_timestamp)` — skip if already exists (polling may have ingested same data during backfill)
- [ ] Event group boundary rules: start new group when `event_type` differs or change direction reverses within the 5s window
- [ ] Event group max size: cap at 20 events per group (configurable). If cap reached, start new group.
- [ ] Mount in `server/index.ts`

### 2.6 GHL connector: Scheduled polling

New file `server/services/connectorPollingService.ts`:

- [ ] Register polling jobs via pg-boss for each active `connector_config`
- [ ] Job name format: `connector-poll:${connectorConfigId}`
- [ ] Job handler: load connector config → get decrypted connection → call ingestion methods → upsert canonical entities
- [ ] Polling frequency from `connector_configs.pollIntervalMinutes`
- [ ] Update `lastSyncAt`, `lastSyncStatus`, `lastSyncError` on connector config after each poll
- [ ] Handle errors gracefully: set status to `'error'`, surface to operator via org update
- [ ] Manage `syncPhase` transitions: `'backfill'` → `'transition'` on backfill_complete event, `'transition'` → `'live'` when queued webhooks fully replayed
- [ ] Recompute `configVersion` hash when connector config changes

### 2.7 Service: Connector config management

New service file `server/services/connectorConfigService.ts`:

- [ ] CRUD for `connector_configs` table
- [ ] `getActiveByOrg(orgId)` — returns active connector configs
- [ ] `getByType(orgId, connectorType)` — get the connector for a given type
- [ ] Account mapping management: store/retrieve GHL locationId → subaccountId mappings in `configJson`

### 2.8 Routes: Connector config management

New route file `server/routes/connectorConfigs.ts`:

- [ ] `GET /api/org/connectors` — list connector configs
- [ ] `POST /api/org/connectors` — create connector config (type + connection reference)
- [ ] `GET /api/org/connectors/:id` — get config with sync status
- [ ] `PATCH /api/org/connectors/:id` — update config (polling interval, account mappings)
- [ ] `DELETE /api/org/connectors/:id` — delete config
- [ ] `POST /api/org/connectors/:id/sync` — trigger manual sync
- [ ] `POST /api/org/connectors/:id/validate` — test credentials
- [ ] Mount in `server/index.ts`

### 2.9 Service: Canonical data access layer

New service file `server/services/canonicalDataService.ts`:

- [ ] `getAccountsByOrg(orgId)` — list all canonical accounts
- [ ] `getAccountsByTags(orgId, tags)` — list accounts filtered by subaccount tags (depends on Phase 3 tags, but interface defined now)
- [ ] `getContactMetrics(accountId, dateRange?)` — contact count, growth rate, recent additions
- [ ] `getOpportunityMetrics(accountId)` — pipeline value, stage distribution, velocity, stale deals
- [ ] `getConversationMetrics(accountId)` — volume, response times, active/inactive ratio
- [ ] `getRevenueMetrics(accountId, dateRange?)` — total, trend, recurring vs one-time
- [ ] `getLatestHealthSnapshot(accountId)` — most recent snapshot
- [ ] `getHealthHistory(accountId, limit?)` — time series of snapshots
- [ ] All query methods return data confidence metadata alongside results:
  - `dataFreshnessScore` (0.0–1.0) — derived from `last_synced_at` vs expected poll interval
  - `dataCompletenessScore` (0.0–1.0) — derived from last reconciliation drift report
- [ ] Hard staleness cutoff: if `last_synced_at` > 2x poll interval, mark dataset as `stale`, include `staleness_warning` in response
- [ ] Return `dataStatus` on every query: `'fresh'` (data exists, current), `'stale'` (data exists, exceeds threshold), `'missing'` (no data ever ingested for this entity type) — distinguishes "zero results" from "no data"
- [ ] Confidence propagation rule: when a skill consumes multiple data sources, output confidence = `MIN(all contributing confidences)`
- [ ] Confidence floor: if propagated confidence < 0.3, output may be displayed (with warning) but must not drive automated decisions (anomaly detection, alerts, HITL proposals)
- [ ] Missing data behaviour: when `dataStatus === 'missing'` for any contributing source, exclude from scoring (not treated as zero). Skill output must surface which accounts have missing data.
- [ ] Enforce query scope guards on all methods:
  - Max accounts per query: 100 (configurable)
  - Max time range: 90 days (configurable)
  - Max rows per entity type: 10,000 (configurable, truncate with warning)
- [ ] Derive connector `healthStatus` (`'healthy' | 'degraded' | 'failed'`) from error rate and sync delays:
  - `healthy`: last sync OK, <5% error rate/24h, no delays >2x poll interval
  - `degraded`: 5-25% error rate or delays >2x poll interval
  - `failed`: 3+ consecutive sync failures or no successful sync in 24h
- [ ] Include `healthStatus` in connector config API responses
- [ ] Enforce explicit behaviour per connector health state:
  - `healthy`: normal operation
  - `degraded`: reduce data confidence scores proportionally, send operator warning
  - `failed`: suppress health scoring, suspend anomaly detection, flag accounts as "data missing" in reports, send operator alert
- [ ] Include `connectorHealthStatus` in data query responses so skills can handle appropriately

### 2.10 Sync event audit logging

- [ ] Log sync events: polling cycle start/completion with entity counts and duration
- [ ] Log webhook events: each webhook received with normalisation outcome (accepted, rejected, duplicate)
- [ ] Log reconciliation repairs: each state repair with before/after values
- [ ] Enforce max repair scope: if reconciliation would overwrite >30% of records for an account, halt for that account, flag `reconciliation_scope_exceeded`, raise operator alert. Operator must acknowledge before large-scope repair proceeds.
- [ ] On reconciliation abort, emit `reconciliation_aborted` event with reason, affected account IDs, and attempted scope. Surface in sync audit logs.
- [ ] Log connector state transitions: each `syncPhase` change
- [ ] Surface sync logs to operators in connector config detail view

### 2.11 Testing & Verification

- [ ] GHL connector can enumerate sub-accounts from a real GHL agency account
- [ ] Contacts, opportunities, conversations normalise correctly
- [ ] Webhook endpoint receives and processes GHL events
- [ ] Rate limiter queues requests correctly under load
- [ ] Polling job runs on schedule and updates canonical entities
- [ ] A skill calling `canonicalDataService.getContactMetrics(accountId)` works without any GHL-specific code
- [ ] Data confidence scores returned alongside canonical data queries
- [ ] Query scope guards enforce limits (test with over-limit requests)
- [ ] `syncPhase` transitions correctly: `backfill` → `transition` → `live`
- [ ] Webhooks queued during backfill, replayed during transition
- [ ] `event_group_id` always populated on ingested events (auto-generated when connector doesn't provide)
- [ ] Sync event audit log captures poll cycles, webhook ingestion, reconciliation repairs, phase transitions
- [ ] Webhook queue replays in correct per-entity order during transition phase
- [ ] Webhook replay correctly deduplicates against events already ingested by polling
- [ ] Event group boundaries respected (different event_type or direction reversal starts new group)
- [ ] Event group capped at max size (new group started when cap reached)
- [ ] Staleness cutoff triggers warning when data exceeds 2x poll interval
- [ ] Connector health status correctly derived (`healthy`/`degraded`/`failed`)
- [ ] Failed connector suppresses health scoring and anomaly detection for its accounts
- [ ] Degraded connector reduces confidence scores proportionally
- [ ] `connectorHealthStatus` included in data query responses
- [ ] `dataStatus` (`fresh`/`stale`/`unavailable`) correctly distinguishes zero results from no data
- [ ] Confidence propagation: multi-source skill outputs use MIN(all input confidences)
- [ ] Reconciliation halts and alerts when repair scope exceeds 30% of records for an account
- [ ] Reconciliation abort produces `reconciliation_aborted` event with affected accounts
- [ ] Confidence floor enforced: outputs with confidence < 0.3 do not drive automated decisions
- [ ] Missing data excluded from scoring (not treated as zero), surfaced in skill output
- [ ] Connector config CRUD works through API routes

---

## Phase 3: Cross-Subaccount Intelligence + Portfolio Health Agent

### Part A: Generic Cross-Subaccount Capabilities

### 3.1 Schema Migration: Subaccount tags

Include in migration 0044 (or 0045 depending on Phase 2 bundling):

- [ ] `subaccount_tags` table:
  - `id` (uuid PK)
  - `organisationId` (FK → organisations, NOT NULL)
  - `subaccountId` (FK → subaccounts, NOT NULL)
  - `key` (text NOT NULL)
  - `value` (text NOT NULL)
  - `createdAt` (timestamptz)
  - Unique: `(subaccountId, key)`
  - Index: `(organisationId, key, value)` for cohort queries

### 3.2 Service & Routes: Subaccount tags

New service `server/services/subaccountTagService.ts`:

- [ ] `setTag(orgId, subaccountId, key, value)` — upsert
- [ ] `removeTag(orgId, subaccountId, key)` — delete
- [ ] `getTags(orgId, subaccountId)` — list tags for a subaccount
- [ ] `getSubaccountsByTags(orgId, filters: {key, value}[])` — return subaccount IDs matching ALL tag filters
- [ ] `bulkSetTag(orgId, subaccountIds[], key, value)` — apply tag to multiple subaccounts
- [ ] `listTagKeys(orgId)` — distinct tag keys across the org (for UI autocomplete)

New route file `server/routes/subaccountTags.ts`:

- [ ] `GET /api/subaccounts/:subaccountId/tags` — list tags
- [ ] `PUT /api/subaccounts/:subaccountId/tags/:key` — set tag (body: `{value}`)
- [ ] `DELETE /api/subaccounts/:subaccountId/tags/:key` — remove tag
- [ ] `POST /api/org/subaccount-tags/bulk` — bulk set tag across subaccounts
- [ ] `GET /api/org/subaccount-tags/keys` — list distinct tag keys
- [ ] `GET /api/org/subaccounts/by-tags` — filter subaccounts by tag query
- [ ] Mount in `server/index.ts`

### 3.3 Schema Migration: Org-level memory

- [ ] `org_memory_entries` table:
  - `id` (uuid PK)
  - `organisationId` (FK → organisations, NOT NULL)
  - `sourceSubaccountIds` (jsonb — array of subaccount IDs that contributed)
  - `agentRunId` (FK → agent_runs, nullable)
  - `agentId` (FK → agents, nullable)
  - `content` (text NOT NULL)
  - `entryType` (text — `'observation' | 'decision' | 'preference' | 'issue' | 'pattern'`)
  - `scopeTags` (jsonb — `{"key": "value"}` matching subaccount tag dimensions)
  - `qualityScore` (real, 0.0-1.0)
  - `embedding` (vector(1536), nullable)
  - `evidenceCount` (integer, default 1)
  - `includedInSummary` (boolean, default false)
  - `accessCount` (integer, default 0)
  - `lastAccessedAt` (timestamptz, nullable)
  - `createdAt` (timestamptz)
  - Index: `(organisationId, includedInSummary)`
  - HNSW index on `embedding` (same as workspace_memory_entries)

- [ ] `org_memories` table (compiled summary, one per org):
  - `id` (uuid PK)
  - `organisationId` (FK → organisations, NOT NULL, UNIQUE)
  - `summary` (text)
  - `qualityThreshold` (real, default 0.5)
  - `runsSinceSummary` (integer, default 0)
  - `summaryThreshold` (integer, default 5)
  - `version` (integer, default 1)
  - `summaryGeneratedAt` (timestamptz, nullable)
  - `createdAt`, `updatedAt`

### 3.4 Service: Org memory

New service `server/services/orgMemoryService.ts`:

- [ ] Mirror `workspaceMemoryService` patterns but scoped to org:
  - `getOrCreateMemory(orgId)` — get or create the compiled org memory record
  - `extractOrgInsights(runId, agentId, orgId, summary)` — LLM extraction of org-level insights from a run summary
  - `listEntries(orgId, filters?)` — list entries with optional type/tag filters
  - `createEntry(orgId, entry)` — insert with quality scoring + async embedding
  - `updateEntry(entryId, updates)` — update content/tags
  - `deleteEntry(entryId)` — delete
  - `getRelevantInsights(orgId, queryEmbedding, scopeTags?)` — semantic search with combined scoring (same formula as subaccount: cosine 60% + quality 25% + recency 15%)
  - `getInsightsForPrompt(orgId, taskContext?)` — formatted for injection into agent system prompt
  - `regenerateSummary(orgId)` — LLM-compiled summary from unprocessed entries
  - `dedup(orgId, newEntries)` — Mem0-style dedup against recent org entries
- [ ] Reuse `scoreMemoryEntry()` from `workspaceMemoryService` (same scoring algorithm)
- [ ] Reuse embedding infrastructure from `server/lib/embeddings.ts`

### 3.5 Routes: Org memory

New route file `server/routes/orgMemory.ts`:

- [ ] `GET /api/org/memory` — get compiled org memory
- [ ] `PUT /api/org/memory` — update compiled summary manually
- [ ] `POST /api/org/memory/regenerate` — trigger summary regeneration
- [ ] `GET /api/org/memory/entries` — list org memory entries (with filters)
- [ ] `DELETE /api/org/memory/entries/:entryId` — delete an entry
- [ ] Mount in `server/index.ts`

### 3.6 Skills: Cross-subaccount query skills

Three new skill files in `server/skills/`:

- [ ] `query_subaccount_cohort.md` — skill definition with input schema (tag filters, metric focus, subaccount IDs)
- [ ] `read_org_insights.md` — skill definition (scope tag filter, semantic query, entry type filter)
- [ ] `write_org_insight.md` — skill definition (content, entry_type, scope_tags, source_subaccount_ids, evidence_count)

Register in action registry (`server/config/actionRegistry.ts`):

- [ ] `query_subaccount_cohort`: category `worker`, gate `auto`, readOnly, idempotent
- [ ] `read_org_insights`: category `worker`, gate `auto`, readOnly, idempotent
- [ ] `write_org_insight`: category `worker`, gate `auto`, not readOnly, idempotent

Implement executors in `server/services/skillExecutor.ts`:

- [ ] `executeQuerySubaccountCohort(params, context)`:
  - Validate org-level context (subaccountId is null)
  - Call `subaccountTagService.getSubaccountsByTags()` to resolve matching subaccounts
  - For each matching subaccount: fetch board health summary (task counts by status), workspace memory summary excerpt, last activity date
  - Return aggregated/anonymised data — NO raw subaccount records
  - Respect `allowedSubaccountIds` from org agent config if set

- [ ] `executeReadOrgInsights(params, context)`:
  - Call `orgMemoryService.getRelevantInsights()` or `listEntries()` based on params
  - Return entries with content, scope_tags, evidence_count

- [ ] `executeWriteOrgInsight(params, context)`:
  - Call `orgMemoryService.createEntry()` with quality scoring + embedding

### Part B: Portfolio Health Agent

### 3.7 Define Portfolio Health Agent as system agent

- [ ] Create system agent seed/migration insert for `portfolio-health-agent`:
  - `slug`: `portfolio-health-agent`
  - `executionScope`: `'org'` (new column from Phase 1)
  - `agentRole`: `analyst`
  - `masterPrompt`: Write prompt focused on portfolio monitoring, anomaly coordination, alert delivery, report generation
  - `defaultSystemSkillSlugs`: `['query_subaccount_cohort', 'read_org_insights', 'write_org_insight', 'compute_health_score', 'detect_anomaly', 'compute_churn_risk', 'generate_portfolio_report', 'trigger_account_intervention']`
  - `defaultOrgSkillSlugs`: `['send_email', 'web_search']`
  - `executionMode`: `'api'`
  - `heartbeatEnabled`: true
  - `heartbeatIntervalHours`: 4 (default scan frequency)
  - `defaultTokenBudget`: 50000
  - `defaultMaxToolCalls`: 30

### 3.8 Update template service for org-scoped agents

Modify `server/services/systemTemplateService.ts`:

- [ ] Update `loadToSubaccount` (or add `loadToOrg`) to check `systemAgents.executionScope`
- [ ] If `executionScope === 'org'`: create agent in `agents` table + create `orgAgentConfigs` entry (not `subaccountAgents`)
- [ ] If `executionScope === 'subaccount'`: existing path (create `subaccountAgents` link)

### Part C: Intelligence Skills

### 3.9 Skills: Intelligence skill definitions

Five new skill files in `server/skills/`:

- [ ] `compute_health_score.md` — input: accountId. Output: composite score 0-100, factor breakdown, trend, confidence
- [ ] `detect_anomaly.md` — input: accountId, metricName, currentValue. Output: anomaly flag, deviation, severity, description
- [ ] `compute_churn_risk.md` — input: accountId. Output: risk score 0-100, drivers, intervention type, suggested action
- [ ] `generate_portfolio_report.md` — input: reportingPeriod, preferences. Output: formatted briefing
- [ ] `trigger_account_intervention.md` — input: accountId, interventionType, evidence. Output: intervention record. Gate: `review`

Register all five in `server/config/actionRegistry.ts`:

- [ ] `compute_health_score`: gate `auto`, readOnly (reads data, writes snapshot)
- [ ] `detect_anomaly`: gate `auto`, readOnly
- [ ] `compute_churn_risk`: gate `auto`, readOnly
- [ ] `generate_portfolio_report`: gate `auto`, readOnly
- [ ] `trigger_account_intervention`: gate `review` (HITL-gated, non-negotiable)

### 3.10 Implement intelligence skill executors

In `server/services/skillExecutor.ts` (or new file `server/services/intelligenceSkillExecutor.ts` to manage size):

- [ ] `executeComputeHealthScore(params, context)`:
  - Load canonical data from `canonicalDataService` for the account
  - Load weight map from org config (or use defaults)
  - Compute weighted score across dimensions (contact growth, pipeline velocity, conversation engagement, revenue trend)
  - Write `health_snapshots` record with `configVersion` hash
  - Return score + breakdown

- [ ] `executeDetectAnomaly(params, context)`:
  - Load historical snapshots for the account from `health_snapshots`
  - Compute rolling baseline (configurable window, default 30 days)
  - Compare current value against baseline using configured threshold
  - If anomaly detected: write `anomaly_events` record
  - Return anomaly assessment

- [ ] `executeComputeChurnRisk(params, context)`:
  - Load recent health snapshot history
  - Evaluate heuristic signals (declining trajectory, stagnation duration, activity gaps)
  - Apply configured weight map
  - Return risk score + drivers + recommended intervention type

- [ ] `executeGeneratePortfolioReport(params, context)`:
  - Load all accounts with latest health snapshots
  - Load recent anomaly events
  - Load org memory insights
  - Use LLM to generate natural language briefing
  - Format for delivery (email-ready structure)
  - Return formatted report

- [ ] `executeTriggerAccountIntervention(params, context)`:
  - Validate intervention type is in configured allowed list
  - Package evidence and recommendation
  - Submit through HITL gate (`proposeReviewGatedAction`)
  - Return pending status with action ID
  - On approval: execute via connector (e.g. GHL campaign pause) or internal action (create task, send email)

### 3.11 Wire org memory extraction into org agent execution

Modify `server/services/agentExecutionService.ts`:

- [ ] After an org-level agent run completes, call `orgMemoryService.extractOrgInsights()` instead of `workspaceMemoryService.extractRunInsights()`
- [ ] Inject org memory into org agent system prompt via `orgMemoryService.getInsightsForPrompt()`

### 3.12 UI: Subaccount tags

- [ ] Tag editor on subaccount settings/detail page (key-value pairs)
- [ ] Bulk tagging interface in subaccounts list
- [ ] Tag filter on subaccounts list page

### 3.13 UI: Org memory

- [ ] Org memory page showing compiled summary + individual entries
- [ ] Same pattern as `WorkspaceMemoryPage` but at org level

### 3.14 Testing & Verification

- [ ] Subaccount tags: create, query, filter subaccounts by tags
- [ ] Org memory: create entries, semantic search, dedup, regenerate summary
- [ ] `query_subaccount_cohort` returns aggregated data filtered by tags
- [ ] `read_org_insights` / `write_org_insight` work correctly
- [ ] `compute_health_score` produces valid scores from canonical data
- [ ] `detect_anomaly` correctly identifies deviations from baseline
- [ ] `compute_churn_risk` produces risk scores with heuristic model
- [ ] `generate_portfolio_report` produces readable briefing via LLM
- [ ] `trigger_account_intervention` goes through HITL gate correctly
- [ ] End-to-end: metric changes → anomaly detected → HITL proposal generated → approval → intervention recorded
- [ ] Data isolation: cohort queries return summaries, not raw subaccount data

---

## Phase 4: Configuration Template System Extension

### 4.1 Schema Migration: Template extension fields

- [ ] Add to `system_hierarchy_templates`:
  - `requiredConnectorType` (text, nullable — e.g. `'ghl'`)
  - `operationalDefaults` (jsonb, nullable — health score weights, anomaly thresholds, scan frequency, report schedule, alert config)
  - `memorySeedsJson` (jsonb, nullable — array of `{content, entryType, scopeTags}` to pre-populate org memory)
  - `requiredOperatorInputs` (jsonb, nullable — array of `{key, label, type, required}` describing what the operator must provide during activation)

- [ ] Add to `system_hierarchy_template_slots`:
  - `skillEnablementMap` (jsonb, nullable — `{skillSlug: boolean}` per-slot skill overrides)
  - `executionScope` (text, nullable — `'subaccount' | 'org'`, inherited from system agent if not set)

- [ ] Add to `hierarchy_templates` (org level):
  - `appliedConnectorConfigId` (FK → connector_configs, nullable)
  - `operationalConfig` (jsonb, nullable — org-specific overrides of template defaults)

- [ ] Add to `org_agent_configs`:
  - `appliedTemplateId` (FK → hierarchy_templates, nullable)
  - `appliedTemplateVersion` (integer, nullable)

### 4.2 Service: Extend `systemTemplateService`

Modify `server/services/systemTemplateService.ts`:

- [ ] Update `loadToSubaccount` → rename or extend to `loadToOrg(systemTemplateId, organisationId)`:
  - For each slot: check `executionScope` (from slot or from system agent)
  - `'subaccount'` scoped agents: skip (they get installed when template is applied to a subaccount)
  - `'org'` scoped agents: create/reuse agent in `agents` table + create `orgAgentConfigs` entry
  - Apply `skillEnablementMap` from slot to the agent's `skillSlugs`/`allowedSkillSlugs`
- [ ] Handle `requiredConnectorType`:
  - Check if org already has a matching `connector_config`
  - If not: return activation checklist requiring operator to set up the connector
  - If yes: link it
- [ ] Handle `operationalDefaults`:
  - Write defaults to org's `operationalConfig` (on the org-level `hierarchyTemplates` record)
  - Operator can override later
- [ ] Handle `memorySeedsJson`:
  - Insert seed entries into `org_memory_entries` via `orgMemoryService.createEntry()`
- [ ] Schedule org-level agents' heartbeats via `agentScheduleService`
- [ ] Return activation summary: agents provisioned, connector status, config applied

### 4.3 Service: Config version hash

New utility or extend `server/services/orgConfigService.ts`:

- [ ] `computeConfigVersion(orgId)` — SHA-256 hash of:
  - `appliedTemplateVersion`
  - Operator overrides (operationalConfig jsonb)
  - Active connector config version (lastSyncAt or a connector config hash)
- [ ] Store hash on org config record
- [ ] Recompute whenever any input changes
- [ ] Intelligence skill outputs reference this hash via `configVersion` field on `health_snapshots`

### 4.4 Build GHL Agency Template

Create the first system template as a seed/migration:

- [ ] Insert `system_hierarchy_templates` record:
  - `name`: "GHL Agency Intelligence"
  - `requiredConnectorType`: `'ghl'`
  - `operationalDefaults`: `{ healthScoreWeights: {pipelineVelocity: 0.30, conversationEngagement: 0.25, contactGrowth: 0.20, revenuetrend: 0.15, platformActivity: 0.10}, anomalyThresholds: {default: 2.0}, scanFrequencyHours: 4, reportSchedule: {dayOfWeek: 1, hour: 8}, alertDestinations: [] }`
  - `memorySeedsJson`: `[{content: "This organisation manages a portfolio of client accounts. Monitor for pipeline stagnation, lead volume drops, and conversation engagement decline.", entryType: "preference"}]`
  - `requiredOperatorInputs`: `[{key: "ghl_oauth", label: "GHL OAuth Credentials", type: "oauth", required: true}, {key: "slack_webhook", label: "Slack Webhook URL", type: "url", required: false}, {key: "alert_email", label: "Alert Email", type: "email", required: true}]`

- [ ] Insert template slots:
  - Orchestrator (executionScope: subaccount, standard skills)
  - BA Agent (executionScope: subaccount, intake skills)
  - Portfolio Health Agent (executionScope: org, intelligence skills enabled via `skillEnablementMap`)

### 4.5 Routes: Template activation

Modify or extend `server/routes/systemTemplates.ts`:

- [ ] `POST /api/system-templates/:id/activate` — activates a system template for the authenticated org
  - Calls `systemTemplateService.loadToOrg()`
  - Returns activation summary + required operator inputs
- [ ] `POST /api/org/template-config` — submit operator inputs (OAuth credentials, Slack webhook, email)
  - Validates inputs, stores credentials, completes connector setup
  - Triggers first scan cycle

### 4.6 UI: Template activation flow

- [ ] System template library page (or extend existing `SystemCompanyTemplatesPage`)
- [ ] "Activate" button on template → opens activation wizard
- [ ] Wizard steps: review what will be provisioned → provide required inputs (OAuth, Slack, email) → confirm
- [ ] Post-activation dashboard showing: agents provisioned, connector status, next scan time

### 4.7 Operator customisation UI

- [ ] Settings page for active template config:
  - Health score weight sliders
  - Anomaly sensitivity slider
  - Scan frequency dropdown
  - Report schedule picker
  - Alert destination management (add/remove Slack/email)
  - HITL gate toggles per intervention type

### 4.8 Template versioning

- [ ] When system admin updates a template:
  - Increment `version` on `system_hierarchy_templates`
  - Do NOT auto-update existing org installations
- [ ] Admin can view which orgs are on which template version
- [ ] Org admin can view if a newer template version is available
- [ ] "Update" action shows diff preview and applies new config (with confirmation)

### 4.9 Testing & Verification

- [ ] Create GHL Agency Template as system template
- [ ] Activate template on a test org — verify agents provisioned correctly
- [ ] Org-scoped agents created via `orgAgentConfigs`, subaccount-scoped via `subaccountAgents`
- [ ] Connector config created and linked
- [ ] Operator inputs (OAuth, Slack) stored correctly
- [ ] Memory seeds inserted into org memory
- [ ] Portfolio Health Agent's first heartbeat scheduled
- [ ] Operator can customise weights/thresholds after activation
- [ ] Template version update notification works

---

## Phase 5: Org-Level Workspace

### 5.1 Schema Migration: Nullable subaccountId on workspace tables

- [ ] Make `tasks.subaccount_id` nullable (drop NOT NULL)
- [ ] Make `scheduled_tasks.subaccount_id` nullable (drop NOT NULL)
- [ ] Make `agent_triggers.subaccount_id` nullable (drop NOT NULL)
- [ ] Make `agent_triggers.subaccount_agent_id` nullable (drop NOT NULL)
- [ ] Make `integration_connections.subaccount_id` nullable (drop NOT NULL)
- [ ] Add partial indexes for org-level queries:
  - `tasks`: `(organisation_id, status) WHERE subaccount_id IS NULL`
  - `scheduled_tasks`: `(organisation_id, is_active) WHERE subaccount_id IS NULL`
  - `agent_triggers`: `(organisation_id, event_type) WHERE subaccount_id IS NULL`
- [ ] Update unique constraint on `integration_connections`: handle nullable subaccountId (partial index)

### 5.2 Widen trigger event types

- [ ] Extend `agentTriggers.eventType` TypeScript type to include: `'org_task_created' | 'org_task_moved' | 'org_agent_completed'`
- [ ] Update `triggerService.checkAndFire()` to handle org-level events (query with `subaccountId IS NULL`)
- [ ] Add org-level rate cap (separate from subaccount rate cap)

### 5.3 Service updates for org-level tasks

Modify `server/services/taskService.ts`:

- [ ] Accept nullable `subaccountId` on `createTask`, `listTasks`, `updateTask`, `moveTask`
- [ ] When `subaccountId` is null: scope queries to `organisationId` only
- [ ] Guard existing task queries that assume `subaccountId` is present

### 5.4 Service updates for org-level scheduled tasks

Modify `server/services/scheduledTaskService.ts`:

- [ ] Accept nullable `subaccountId` on CRUD methods
- [ ] Org-level scheduled tasks assigned to org agents (via `orgAgentConfigs`)
- [ ] Scheduler resolves agent execution through org agent config path

### 5.5 Routes: Org-level workspace

New or modified routes:

- [ ] `GET /api/org/board-config` — org-level board config (already partially supported)
- [ ] `GET /api/org/tasks` — list org-level tasks (subaccountId IS NULL)
- [ ] `POST /api/org/tasks` — create org-level task
- [ ] `PATCH /api/org/tasks/:id` — update org task
- [ ] `PATCH /api/org/tasks/:id/move` — move org task
- [ ] `DELETE /api/org/tasks/:id` — delete org task
- [ ] `GET /api/org/scheduled-tasks` — list org scheduled tasks
- [ ] `POST /api/org/scheduled-tasks` — create org scheduled task
- [ ] `GET /api/org/triggers` — list org triggers
- [ ] `POST /api/org/triggers` — create org trigger
- [ ] `GET /api/org/connections` — list org-level connections
- [ ] `POST /api/org/connections` — create org-level connection

### 5.6 Cross-boundary writes

Modify task-creation skills in `server/services/skillExecutor.ts`:

- [ ] Add optional `targetSubaccountId` parameter to `create_task` skill when invoked from org context
- [ ] Validate target subaccount belongs to same organisation
- [ ] Check `allowedSubaccountIds` on `orgAgentConfigs` (if set, only those subaccounts are valid targets)
- [ ] Cross-boundary task creation is HITL-gated (gate level `review`)
- [ ] Enrich action audit record: `sourceContext: 'org'`, `reasoningSummary` from agent

### 5.7 UI: Org-level workspace

- [ ] Org board page (kanban view for org-level tasks)
- [ ] Org scheduled tasks page
- [ ] Org triggers management page
- [ ] Org connections page
- [ ] Navigation entries for org workspace in admin layout

### 5.8 Testing & Verification

- [ ] Org-level tasks: create, move, update, delete on org board
- [ ] Org-level scheduled tasks fire correctly
- [ ] Org-level triggers fire on org events (`org_task_created`, etc.)
- [ ] Org-level connections created and usable by org agents
- [ ] Cross-boundary write: org agent creates task on subaccount board via HITL gate
- [ ] `allowedSubaccountIds` restriction enforced
- [ ] Audit records include `sourceContext` and `reasoningSummary`
- [ ] Zero regression on subaccount workspace flows

---

## Summary: Task Count by Phase

| Phase | Tasks | Estimated Complexity |
|-------|-------|---------------------|
| Phase 1: Org-Level Agent Execution | 14 task groups | High — foundational, touches many files |
| Phase 2: Integration Layer + GHL Connector | 11 task groups | High — new subsystem, external API integration |
| Phase 3: Cross-Subaccount Intelligence | 14 task groups | Very high — largest phase, most new code |
| Phase 4: Configuration Template System | 9 task groups | Medium — extends existing system |
| Phase 5: Org-Level Workspace | 8 task groups | Medium — repeats nullable pattern from Phase 1 |
| **Total** | **56 task groups** | |

### Implementation Order Notes

- Phase 1 must complete before any other phase
- Phase 2 can overlap with Phase 1 (different subsystem) but must complete before Phase 3
- Phase 3 depends on both Phase 1 and Phase 2
- Phase 4 depends on Phase 3
- Phase 5 is independent of Phases 2-4 and can be built any time after Phase 1
