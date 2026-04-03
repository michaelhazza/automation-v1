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
- [ ] Mount in `server/index.ts`

### 2.6 GHL connector: Scheduled polling

New file `server/services/connectorPollingService.ts`:

- [ ] Register polling jobs via pg-boss for each active `connector_config`
- [ ] Job name format: `connector-poll:${connectorConfigId}`
- [ ] Job handler: load connector config → get decrypted connection → call ingestion methods → upsert canonical entities
- [ ] Polling frequency from `connector_configs.pollIntervalMinutes`
- [ ] Update `lastSyncAt`, `lastSyncStatus`, `lastSyncError` on connector config after each poll
- [ ] Handle errors gracefully: set status to `'error'`, surface to operator via org update

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

### 2.10 Testing & Verification

- [ ] GHL connector can enumerate sub-accounts from a real GHL agency account
- [ ] Contacts, opportunities, conversations normalise correctly
- [ ] Webhook endpoint receives and processes GHL events
- [ ] Rate limiter queues requests correctly under load
- [ ] Polling job runs on schedule and updates canonical entities
- [ ] A skill calling `canonicalDataService.getContactMetrics(accountId)` works without any GHL-specific code
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
