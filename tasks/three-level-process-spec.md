# Three-Level Process Framework — Tailored Spec

**Version:** 1.0 (Part 1 — Architecture & Schema)
**Status:** Draft
**Branch:** `claude/three-level-automation-framework-7z0yZ`

---

## Executive Summary

Extend the existing process/engine system to support three hierarchy levels (System → Organisation → Subaccount) with:

- Reusable, inheritable process definitions
- Subaccount-only execution with connection injection
- Pluggable, multi-scope engines with mandatory per-engine HMAC
- Agent and scheduled-task driven process invocation

This builds on existing patterns: the `subaccountAgents` linking-with-overrides model, the `integrationConnections` table, and the current `processes` → `workflowEngines` → `executions` pipeline.

---

## 1. Core Principles (Unchanged from Brief)

| Principle | Detail |
|-----------|--------|
| Separation of concerns | Processes = logic, Connections = auth, Engines = execution, App = orchestration |
| Subaccount-only execution | No process ever runs at system or org level. Always subaccount context + subaccount connections |
| Inheritance without mutation | Higher-level processes are reusable. Lower levels link + override config, never modify upstream logic |
| Stateless engines | Engines store no users, credentials, or business logic. Auth injected at runtime |
| Pluggable engines | System, org, and subaccount can each have their own engine(s). Resolution falls back up the hierarchy |

---

## 2. Terminology

Sticking with existing codebase terms:

| Brief Term | Codebase Term | Notes |
|------------|---------------|-------|
| Automation | **Process** | Already used everywhere — schema, routes, services, UI |
| Engine | **Workflow Engine** | Existing `workflow_engines` table |
| Connection | **Integration Connection** | Existing `integration_connections` table |
| Automation Connection Mapping | **Process Connection Mapping** | New join table |

---

## 3. Schema Changes

### 3.1 `workflow_engines` — Add Scope Support

Currently org-scoped only. Add `scope` to support system and subaccount engines.

**Add columns:**

| Column | Type | Notes |
|--------|------|-------|
| `scope` | `text NOT NULL DEFAULT 'organisation'` | `'system' \| 'organisation' \| 'subaccount'` |
| `subaccount_id` | `UUID FK → subaccounts, nullable` | Set when `scope = 'subaccount'` |
| `hmac_secret` | `text NOT NULL` | Per-engine HMAC secret, auto-generated on create |

**Modify columns:**

| Column | Change |
|--------|--------|
| `organisation_id` | Make **nullable**. `NULL` when `scope = 'system'` |

**New indexes:**
- `(scope, status)` — for engine resolution queries
- `(subaccount_id)` — for subaccount engine lookups

**Constraints:**
- `scope = 'system'` → `organisation_id IS NULL AND subaccount_id IS NULL`
- `scope = 'organisation'` → `organisation_id IS NOT NULL AND subaccount_id IS NULL`
- `scope = 'subaccount'` → `organisation_id IS NOT NULL AND subaccount_id IS NOT NULL`

**HMAC:** Generated via `crypto.randomBytes(32).toString('hex')` on engine creation. Never exposed in API responses (write-only). Used to sign all outbound webhook calls and verify all inbound callbacks — replacing the current global `WEBHOOK_SECRET` env var approach.

---

### 3.2 `processes` — Add Scope + Inheritance

Currently org-scoped with optional `subaccountId` for subaccount-native processes. Extend to support system-level processes and parent-child linking.

**Add columns:**

| Column | Type | Notes |
|--------|------|-------|
| `scope` | `text NOT NULL DEFAULT 'organisation'` | `'system' \| 'organisation' \| 'subaccount'` |
| `config_schema` | `text, nullable` | JSON Schema for per-execution configuration (distinct from `input_schema`) |
| `default_config` | `jsonb, nullable` | Default config values (can be overridden per subaccount link) |
| `required_connections` | `jsonb, nullable` | Array of `{ key: string, provider: string, required: boolean }` |
| `is_editable` | `boolean NOT NULL DEFAULT true` | `false` for system processes (downstream can't modify) |
| `parent_process_id` | `UUID FK → processes, nullable` | Points to the upstream process this was cloned from (for forked customisation) |

**Modify columns:**

| Column | Change |
|--------|--------|
| `organisation_id` | Make **nullable**. `NULL` when `scope = 'system'` |
| `workflow_engine_id` | Make **nullable**. System processes may not have a fixed engine (resolved at execution time) |

**Scope rules:**
- `scope = 'system'` → `organisation_id IS NULL`, `subaccount_id IS NULL`, `is_editable = false`
- `scope = 'organisation'` → `organisation_id IS NOT NULL`, `subaccount_id IS NULL`
- `scope = 'subaccount'` → `organisation_id IS NOT NULL`, `subaccount_id IS NOT NULL`

**`config_schema` vs `input_schema`:**
- `input_schema` = per-execution data (e.g. "search query", "email body"). Changes every run.
- `config_schema` = setup-time parameters (e.g. "which folder to watch", "polling interval"). Set once per subaccount link, rarely changes.

**`required_connections` example:**
```json
[
  { "key": "gmail_account", "provider": "gmail", "required": true },
  { "key": "slack_channel", "provider": "slack", "required": false }
]
```
Each `key` is a named slot that must be mapped to an actual `integration_connection` at the subaccount level before execution.

---

### 3.3 `integration_connections` — Allow Multiple Per Provider

Currently has a unique constraint on `(subaccount_id, provider_type)` limiting one connection per provider per subaccount. A subaccount may need multiple Gmail accounts, multiple Slack workspaces, etc.

**Changes:**
- **Drop** unique constraint `integration_connections_subaccount_provider`
- **Add column:** `label` (`text, nullable`) — user-friendly name to distinguish connections (e.g. "Support Gmail", "Personal Gmail")
- **Add** unique constraint on `(subaccount_id, provider_type, label)` — prevents exact duplicates while allowing multiples

**Add columns:**

| Column | Type | Notes |
|--------|------|-------|
| `label` | `text, nullable` | Distinguishes multiple connections of same provider |
| `access_token` | `text, nullable` | OAuth2 access token (encrypted at rest) |
| `refresh_token` | `text, nullable` | OAuth2 refresh token (encrypted at rest) |
| `token_expires_at` | `timestamp, nullable` | When current access token expires |

> Note: These replace the current `secrets_ref` / `config_json` approach with explicit token fields for OAuth2 flows. The `config_json` field remains for non-OAuth metadata. `secrets_ref` is retained for API key / service account auth types.

---

### 3.4 `process_connection_mappings` — New Table

Maps a process's required connection slots to actual integration connections for a specific subaccount. This is the "wiring" layer.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID PK` | |
| `organisation_id` | `UUID FK → organisations, NOT NULL` | |
| `subaccount_id` | `UUID FK → subaccounts, NOT NULL` | |
| `process_id` | `UUID FK → processes, NOT NULL` | The process being configured |
| `connection_key` | `text NOT NULL` | Matches a `key` from `processes.required_connections` |
| `connection_id` | `UUID FK → integration_connections, NOT NULL` | The actual connection to use |
| `created_at` | `timestamp` | |
| `updated_at` | `timestamp` | |

**Unique constraint:** `(subaccount_id, process_id, connection_key)` — one connection per slot per subaccount.

**Indexes:** `(subaccount_id, process_id)`, `(connection_id)`

---

### 3.5 `subaccount_process_links` — Extend for Overrides

Currently a simple boolean link (is this process available in this subaccount?). Extend to support config overrides, following the `subaccount_agents` pattern.

**Add columns:**

| Column | Type | Notes |
|--------|------|-------|
| `config_overrides` | `jsonb, nullable` | Per-subaccount config values (merged with process `default_config`) |
| `custom_input_schema` | `text, nullable` | Override input schema for this subaccount (rare, for advanced customisation) |

This keeps the linking-with-overrides pattern consistent with `subaccount_agents`.

---

### 3.6 `executions` — Extend for Connection Context

**Add columns:**

| Column | Type | Notes |
|--------|------|-------|
| `resolved_connections` | `jsonb, nullable` | Snapshot of connection mapping used at execution time (audit trail, no tokens) |
| `resolved_config` | `jsonb, nullable` | Merged config (process default + subaccount overrides) used at execution time |
| `engine_id` | `UUID FK → workflow_engines, nullable` | Which engine actually ran this (for cross-engine tracing) |
| `trigger_type` | `text NOT NULL DEFAULT 'manual'` | `'manual' \| 'agent' \| 'scheduled' \| 'webhook'` |
| `trigger_source_id` | `UUID, nullable` | ID of agent run, scheduled task run, or external webhook that triggered this |

**Modify columns:**

| Column | Change |
|--------|--------|
| `triggered_by_user_id` | Make **nullable**. Agent/scheduled triggers have no user. |

---

## 4. Hierarchy Model

### 4.1 Process Visibility & Inheritance

```
System Processes (platform-managed)
  │
  ├── Visible to all orgs (read-only)
  ├── Cannot be edited/deleted by orgs
  ├── Org can link to subaccounts via subaccount_process_links
  └── Org can clone (parent_process_id → system process) to customise

Organisation Processes (org-managed)
  │
  ├── Created by org admins
  ├── Can be original or cloned from system
  ├── Linked to subaccounts via subaccount_process_links
  └── Subaccount can clone (parent_process_id → org process) to customise

Subaccount Processes (subaccount-managed)
  │
  ├── Created by subaccount admins or cloned from org/system
  ├── Only visible within that subaccount
  └── Directly executable (no linking needed)
```

### 4.2 Capability Matrix

| Capability | System | Organisation | Subaccount |
|------------|--------|--------------|------------|
| Create process | Yes | Yes | Yes |
| Edit system process | Yes | No | No |
| Edit org process | — | Yes | No |
| Edit own process | Yes | Yes | Yes |
| Clone process to customise | — | Yes (from system) | Yes (from system/org) |
| Link process to subaccount | — | Yes | N/A (already in subaccount) |
| Execute process | No | No | **Yes** |
| Manage connections | No | No | **Yes** |

### 4.3 Engine Resolution

When executing a process, the engine is resolved in priority order:

1. **Process-specific engine** — if `processes.workflow_engine_id` is set, use that
2. **Subaccount engine** — if subaccount has an active engine of the right type
3. **Organisation engine** — if org has an active engine of the right type
4. **System engine** — fallback to platform engine

If no engine is found at any level, execution fails with a clear error.

---

## 5. Permission Extensions

### 5.1 New Permission Keys

**System-level** (system_admin only — no permission keys needed, gated by role):
- System process CRUD managed through system admin routes

**Org-level:**

| Key | Purpose |
|-----|---------|
| `org.processes.view_system` | View system processes available to this org |
| `org.processes.clone` | Clone a system process into the org |
| `org.connections.view` | View connection status across subaccounts |

**Subaccount-level:**

| Key | Purpose |
|-----|---------|
| `subaccount.connections.view` | View connections for this subaccount |
| `subaccount.connections.manage` | Create/edit/revoke connections |
| `subaccount.processes.clone` | Clone org/system process into subaccount |
| `subaccount.processes.configure` | Set up connection mappings and config overrides |

### 5.2 Existing Permission Keys (Unchanged)

These continue to work as-is:
- `org.processes.create/edit/delete/activate/test`
- `org.engines.view/manage`
- `subaccount.processes.view/execute/create/edit/delete`
- `org.executions.view`
- `subaccount.executions.view/view_all`

---

## 6. Security Model

### 6.1 HMAC — Per-Engine, Mandatory

**Current state:** Global `WEBHOOK_SECRET` env var, optional. Single secret for all engines.

**New state:** Per-engine `hmac_secret`, mandatory, auto-generated.

**Outbound (app → engine):**
- Compute `HMAC-SHA256(hmac_secret, execution_id)` → include as `X-Webhook-Signature` header
- Engine can verify if it wants to (optional for engine, mandatory for us to send)

**Inbound (engine → app callback):**
- Return URL includes `?token=HMAC-SHA256(hmac_secret, execution_id)`
- Callback handler verifies token — **rejects if invalid** (no more open mode)
- `hmac_secret` looked up from execution's resolved engine

**Migration from global WEBHOOK_SECRET:**
- Keep backward compat: if execution has no `engine_id` (old records), fall back to `WEBHOOK_SECRET` env var
- New executions always use per-engine secret

### 6.2 Token Security

- OAuth tokens stored encrypted in `integration_connections` (access_token, refresh_token)
- Tokens decrypted only at execution time, injected into engine payload
- Tokens never appear in `executions.outbound_payload` audit field (redacted)
- Token refresh happens transparently before injection — if expired, refresh first, update stored token, then inject

### 6.3 Connection Validation

Before execution, validate:
1. All `required: true` connection slots have a mapping
2. All mapped connections exist and have `connection_status = 'active'`
3. All mapped connections belong to the executing subaccount
4. OAuth tokens are valid or refreshable

Fail fast with clear error messages if any validation fails.

---

---

# Part 2 — Execution, Integration & Implementation

**Version:** 1.0 (Part 2 — Runtime, Routes, Frontend, File Inventory)

---

## 7. Execution Pipeline

### 7.1 Full Runtime Flow

```
Trigger (user / agent / scheduled task)
  ↓
1. Resolve process (system/org/subaccount scope)
2. Validate process is active
3. Resolve subaccount context
4. Validate required connections are mapped
5. Load integration connections
6. Refresh expired OAuth tokens
7. Resolve engine (sub → org → system)
8. Merge config (process default + subaccount overrides)
9. Build auth payload (connection tokens keyed by slot name)
10. Build outbound payload (input + auth + config + _meta)
11. Sign request (HMAC-SHA256 with engine hmac_secret)
12. Create execution record (snapshot connections, config, engine)
13. Enqueue via queueService
14. Worker dispatches to engine webhook
15. Engine POSTs result to /api/webhooks/callback/:executionId
16. Callback verifies HMAC, updates execution record
17. Return structured response / notify caller
```

### 7.2 Outbound Payload to Engine

```json
{
  "execution_id": "uuid",
  "process_id": "uuid",
  "auth": {
    "gmail_account": { "access_token": "ya29.xxx" },
    "slack_channel": { "access_token": "xoxb-xxx" }
  },
  "config": {
    "watch_folder": "INBOX",
    "polling_interval": 300
  },
  "input": {
    "search_query": "from:boss@example.com",
    "max_results": 50
  },
  "_meta": {
    "execution_id": "uuid",
    "return_webhook_url": "https://app.example.com/api/webhooks/callback/uuid?token=hmac",
    "files": []
  }
}
```

Tokens are **injected at runtime only** — never stored on the execution record. The `executions.outbound_payload` audit field stores this payload with the `auth` block **redacted** (replaced with `{ "gmail_account": "[REDACTED]" }`).

### 7.3 Connection Config Snapshot (Audit Trail)

`executions.resolved_connections` stores a redacted snapshot for debugging:

```json
{
  "gmail_account": {
    "connection_id": "conn_uuid",
    "provider": "gmail",
    "label": "Support Gmail",
    "status": "active"
  }
}
```

No tokens. Just enough to understand which connection was used.

---

## 8. New Services

### 8.1 `processResolutionService`

**Responsibility:** Given a `process_id` and `subaccount_id`, resolve the full execution context.

```typescript
// server/services/processResolutionService.ts

resolveForExecution(processId: string, subaccountId: string, orgId: string): Promise<{
  process: Process;
  engine: WorkflowEngine;
  connections: Record<string, { token: string; connectionId: string }>;
  config: Record<string, unknown>;
  connectionSnapshot: Record<string, object>;
}>
```

Steps internally:
1. Load process — check scope/org ownership
2. Validate `subaccountId` can access this process (own, org-linked, or system)
3. Load `process_connection_mappings` for `(subaccount_id, process_id)`
4. Validate all `required: true` slots are mapped
5. Load each `integration_connection`, decrypt tokens, refresh if expired
6. Resolve engine via `engineResolutionService`
7. Merge config: `process.default_config` ← `subaccount_process_links.config_overrides`
8. Return assembled context

### 8.2 `engineResolutionService`

**Responsibility:** Given a process and subaccount, find the correct engine.

```typescript
// server/services/engineResolutionService.ts

resolveEngine(process: Process, subaccountId: string, orgId: string): Promise<WorkflowEngine>
```

Priority order:
1. `process.workflow_engine_id` — if set, use directly
2. Active engine scoped to `subaccountId` — `scope = 'subaccount'`
3. Active engine scoped to `orgId` — `scope = 'organisation'`
4. Active system engine — `scope = 'system'`

Throws `{ statusCode: 400, message: 'No active engine found for this process' }` if none found.

### 8.3 `connectionTokenService`

**Responsibility:** Decrypt stored tokens, refresh if expired.

```typescript
// server/services/connectionTokenService.ts

getAccessToken(connection: IntegrationConnection): Promise<string>
refreshIfExpired(connection: IntegrationConnection): Promise<IntegrationConnection>
encryptToken(plaintext: string): string
decryptToken(ciphertext: string): string
```

- Encryption: AES-256-GCM using `TOKEN_ENCRYPTION_KEY` env var
- Refresh: provider-specific OAuth2 token refresh (Gmail, HubSpot, etc.)
- On refresh: updates `integration_connections` with new tokens and `token_expires_at`
- Buffer: refresh if token expires within 5 minutes (not just when expired)

### 8.4 `queueService` Changes

The existing `processExecution()` function is extended to:
1. Call `processResolutionService.resolveForExecution()` instead of loading engine from snapshot
2. Inject auth into outbound payload
3. Sign outbound request with engine `hmac_secret` (`X-Webhook-Signature` header)
4. Store `engine_id`, `resolved_connections`, `resolved_config` on execution record
5. Use per-engine HMAC for callback URL token (not global `WEBHOOK_SECRET`)

The `webhookService.buildReturnUrl()` is updated to accept an engine record and use `engine.hmac_secret`.

---

## 9. Agent Integration

### 9.1 How Agents Trigger Processes Today

The existing `trigger_process` skill in `skillExecutor.ts` already works:
- Agent calls tool with `process_id`, `input_data`, `reason`
- Creates execution record, enqueues via `queueService`
- Returns execution ID to agent

### 9.2 Changes Required

**`trigger_process` skill input schema** — extend to pass config overrides:

```json
{
  "process_id": "uuid",
  "input_data": "{ ... }",
  "config_overrides": "{ ... }",
  "reason": "Fetching last 24h emails as requested by user"
}
```

`config_overrides` is optional — lets the agent customise per-run config beyond the subaccount defaults (e.g. override `max_results`).

**`skillExecutor.ts` changes:**
- Pass `config_overrides` through to execution creation
- Pass `trigger_type: 'agent'` and `trigger_source_id: agentRunId` to execution record
- Validate process is accessible to this subaccount before creating execution (currently missing)

**`executionService.createExecution()`** — extend to accept:
- `triggerType: 'manual' | 'agent' | 'scheduled'`
- `triggerSourceId?: string`
- `configOverrides?: Record<string, unknown>`

**No change to agent execution flow** — agents keep calling `trigger_process` exactly as they do today. The resolution and auth injection happens transparently inside the execution pipeline.

---

## 10. Scheduled Task Integration

No structural changes needed. Scheduled tasks already trigger agent runs, and agents call `trigger_process`. The chain is:

```
scheduledTask → agentRun → trigger_process skill → execution → engine
```

If a scheduled task needs to trigger a process directly (without agent), that's a future enhancement. Out of scope for this spec.

---

## 11. API Routes

### 11.1 System Admin Routes (`/api/system/processes`)

New file: `server/routes/systemProcesses.ts`

| Method | Path | Permission | Purpose |
|--------|------|-----------|---------|
| GET | `/api/system/processes` | system_admin | List all system processes |
| POST | `/api/system/processes` | system_admin | Create system process |
| GET | `/api/system/processes/:id` | system_admin | Get system process |
| PATCH | `/api/system/processes/:id` | system_admin | Update system process |
| DELETE | `/api/system/processes/:id` | system_admin | Soft delete |
| POST | `/api/system/processes/:id/activate` | system_admin | Activate |
| POST | `/api/system/processes/:id/deactivate` | system_admin | Deactivate |

System engines follow the same pattern at `/api/system/engines`.

### 11.2 Org Routes — Extensions

**Extend `GET /api/processes`** to include system processes visible to the org (read-only, flagged with `scope: 'system'`).

**New routes in `processes.ts`:**

| Method | Path | Permission | Purpose |
|--------|------|-----------|---------|
| POST | `/api/processes/:id/clone` | `org.processes.create` | Clone system/org process into org scope |
| GET | `/api/processes/system` | `org.processes.view` | List available system processes |

**New routes in `engines.ts`** — extend engine create/edit to support `scope` field. System admin can create `scope: 'system'` engines from system routes; org admins continue using `/api/engines` for `scope: 'organisation'` engines.

### 11.3 Subaccount Routes — Connections & Mapping

New file: `server/routes/integrationConnections.ts`

| Method | Path | Permission | Purpose |
|--------|------|-----------|---------|
| GET | `/api/subaccounts/:subaccountId/connections` | `subaccount.connections.view` | List connections |
| POST | `/api/subaccounts/:subaccountId/connections` | `subaccount.connections.manage` | Create connection |
| GET | `/api/subaccounts/:subaccountId/connections/:id` | `subaccount.connections.view` | Get connection |
| PATCH | `/api/subaccounts/:subaccountId/connections/:id` | `subaccount.connections.manage` | Update label/status |
| DELETE | `/api/subaccounts/:subaccountId/connections/:id` | `subaccount.connections.manage` | Revoke connection |

New file: `server/routes/processConnectionMappings.ts`

| Method | Path | Permission | Purpose |
|--------|------|-----------|---------|
| GET | `/api/subaccounts/:subaccountId/processes/:processId/connections` | `subaccount.processes.configure` | Get connection mappings for a process |
| PUT | `/api/subaccounts/:subaccountId/processes/:processId/connections` | `subaccount.processes.configure` | Set/update all mappings for a process |

**Subaccount process clone:**

| Method | Path | Permission | Purpose |
|--------|------|-----------|---------|
| POST | `/api/subaccounts/:subaccountId/processes/:processId/clone` | `subaccount.processes.clone` | Clone org/system process into subaccount scope |

### 11.4 Subaccount Engine Routes

New routes to support subaccount-scoped engines:

| Method | Path | Permission | Purpose |
|--------|------|-----------|---------|
| GET | `/api/subaccounts/:subaccountId/engines` | `subaccount.settings.edit` | List subaccount engines |
| POST | `/api/subaccounts/:subaccountId/engines` | `subaccount.settings.edit` | Create subaccount engine |
| PATCH | `/api/subaccounts/:subaccountId/engines/:id` | `subaccount.settings.edit` | Update subaccount engine |
| DELETE | `/api/subaccounts/:subaccountId/engines/:id` | `subaccount.settings.edit` | Delete subaccount engine |

---

## 12. Frontend Changes

### 12.1 System Admin UI

New page: `SystemProcessesPage.tsx`

- Table of system processes (name, scope badge, engine, status, required connections)
- Create/edit form matching existing process form pattern but with:
  - `required_connections` builder (add/remove connection slots with provider selector)
  - `config_schema` editor (JSON schema textarea)
  - `is_editable` toggle
- No engine selector if `workflow_engine_id` left blank (resolved at runtime)

New page: `SystemEnginesPage.tsx`

- Same as existing `EnginesPage.tsx` but scoped to system engines
- Mounted at `/system/engines`

### 12.2 Org Admin UI

**Existing `ProcessesPage.tsx`** — extend:
- Show system processes in a separate "Platform Processes" tab (read-only, with "Clone" action)
- Show `scope` badge on each process row (system / org / subaccount)

**Existing `EnginesPage.tsx`** — no changes needed. Org engines are unchanged.

**New: Connection status overview** — org admin section showing which subaccounts have connections configured for which providers. Read-only summary.

### 12.3 Subaccount Portal UI

**New tab: "Connections"** (in subaccount settings)

- List of integration connections with status indicators
- "Add Connection" → provider selector → OAuth flow or API key input
- Per-connection: label, status, last verified, revoke button

**Extended process view:**

When a subaccount member views a process that has `required_connections`, show:
- Connection status for each required slot (green/red)
- "Configure Connections" link if any slots are unmapped
- Blocked execution with clear message if required connections missing

### 12.4 Execution UI Changes

- Add `trigger_type` badge to execution rows (Manual / Agent / Scheduled)
- Link `trigger_source_id` to agent run or scheduled task where relevant
- In execution detail, show "Connections Used" section from `resolved_connections` snapshot (no tokens, just provider + label + status)

---

## 13. Observability

### 13.1 Execution Tracing

Every execution record already has a UUID `id` that serves as the global execution ID. The extensions to `executions` in Part 1 add:

- `engine_id` — which engine ran it
- `trigger_type` / `trigger_source_id` — what initiated it
- `resolved_connections` — which connections were used

This gives full traceability: scheduled task → agent run → trigger_process → execution → engine.

### 13.2 Cross-Entity Trace Query

A system admin trace query can follow the chain:

```
scheduledTaskRun.id
  → agentRun.triggerSourceId
    → execution.triggerSourceId (= agentRunId)
      → execution.engineId → workflowEngine
      → execution.resolvedConnections
```

No new tables needed — the foreign keys and snapshot fields give enough context.

### 13.3 Replay

Existing `executions.outbound_payload` (with auth redacted) + `executions.process_snapshot` already provide replay capability. With the additions:

- `resolved_config` — exact config used
- `engine_id` — which engine to replay against

A system admin "Replay Execution" action can reconstruct and re-dispatch with the same parameters.

---

## 14. File Inventory

### 14.1 New Files

| File | Purpose |
|------|---------|
| `server/db/schema/processConnectionMappings.ts` | New join table schema |
| `server/services/processResolutionService.ts` | Execution context assembly |
| `server/services/engineResolutionService.ts` | Engine fallback resolution |
| `server/services/connectionTokenService.ts` | Token decrypt, refresh, encrypt |
| `server/routes/systemProcesses.ts` | System admin process CRUD |
| `server/routes/systemEngines.ts` | System admin engine CRUD |
| `server/routes/integrationConnections.ts` | Subaccount connection CRUD |
| `server/routes/processConnectionMappings.ts` | Subaccount process connection wiring |
| `client/src/pages/SystemProcessesPage.tsx` | System admin process management UI |
| `client/src/pages/SystemEnginesPage.tsx` | System admin engine management UI |
| `client/src/pages/subaccount/ConnectionsPage.tsx` | Subaccount connections UI |

### 14.2 Modified Files

| File | Changes |
|------|---------|
| `server/db/schema/workflowEngines.ts` | Add `scope`, `subaccountId`, `hmac_secret`; make `organisationId` nullable |
| `server/db/schema/processes.ts` | Add `scope`, `configSchema`, `defaultConfig`, `requiredConnections`, `isEditable`, `parentProcessId`; make `organisationId` and `workflowEngineId` nullable |
| `server/db/schema/integrationConnections.ts` | Drop unique constraint, add `label`, `accessToken`, `refreshToken`, `tokenExpiresAt` |
| `server/db/schema/subaccountProcessLinks.ts` | Add `configOverrides`, `customInputSchema` |
| `server/db/schema/executions.ts` | Add `resolvedConnections`, `resolvedConfig`, `engineId`, `triggerType`, `triggerSourceId`; make `triggeredByUserId` nullable |
| `server/db/schema/index.ts` | Export `processConnectionMappings` |
| `server/services/queueService.ts` | Use `processResolutionService`, inject auth, per-engine HMAC signing |
| `server/services/webhookService.ts` | Accept engine record for HMAC; per-engine secret instead of global env var |
| `server/services/executionService.ts` | Accept `triggerType`, `triggerSourceId`, `configOverrides`; make `triggeredByUserId` optional |
| `server/services/skillExecutor.ts` | Pass `triggerType: 'agent'`, `triggerSourceId`, `configOverrides` to execution creation |
| `server/routes/processes.ts` | Add clone endpoint; extend list to include system processes |
| `server/routes/webhooks.ts` | Use per-engine HMAC lookup for token verification |
| `server/lib/permissions.ts` | Add new permission keys for connections, clone, configure |
| `server/index.ts` | Mount new routes |
| `client/src/App.tsx` | Add routes for system processes/engines pages, subaccount connections |

---

## 15. Verification Plan

### Schema

- [ ] All new/modified tables created via `drizzle-kit generate` and applied
- [ ] `workflow_engines`: system-scoped engine with null `organisation_id` persists correctly
- [ ] `processes`: system-scoped process with null `organisation_id` and `workflow_engine_id` persists correctly
- [ ] `integration_connections`: two Gmail connections with different labels for same subaccount — no unique constraint violation
- [ ] `process_connection_mappings`: unique constraint on `(subaccount_id, process_id, connection_key)` enforced

### Engine Resolution

- [ ] Process with explicit `workflow_engine_id` → uses that engine regardless of subaccount/org engines
- [ ] Process with no engine → resolves subaccount engine first
- [ ] No subaccount engine → falls back to org engine
- [ ] No org engine → falls back to system engine
- [ ] No engine at any level → 400 error with clear message

### Connection Validation

- [ ] All required slots mapped → execution proceeds
- [ ] Required slot unmapped → 400 error naming the missing slot
- [ ] Mapped connection belongs to different subaccount → rejected
- [ ] Mapped connection has `status = 'revoked'` → rejected with clear message
- [ ] OAuth token expired → transparently refreshed before execution
- [ ] Token refresh fails → 400 error, execution blocked

### HMAC Security

- [ ] New engine auto-generates `hmac_secret`
- [ ] Outbound request includes `X-Webhook-Signature` header
- [ ] Callback with valid token → accepted
- [ ] Callback with invalid token → 401 rejected
- [ ] Callback with no token → 401 rejected
- [ ] `hmac_secret` never appears in any API response

### Auth Injection

- [ ] `auth` block in outbound payload contains correct tokens for each mapped slot
- [ ] `executions.outbound_payload` audit field has `auth` block redacted
- [ ] `executions.resolved_connections` snapshot has no token data

### Agent Trigger

- [ ] Agent calls `trigger_process` → `trigger_type = 'agent'`, `trigger_source_id = agentRunId` on execution
- [ ] Agent passes `config_overrides` → merged correctly with process `default_config`
- [ ] Process not accessible to subaccount → skill returns error to agent, no execution created

### System Processes

- [ ] System admin creates system process → visible to all orgs (read-only)
- [ ] Org admin views system process → can see it, cannot edit
- [ ] Org admin clones system process → new process with `scope = 'organisation'`, `parent_process_id` set
- [ ] Org admin tries to edit system process directly → 403

### Execution End-to-End

- [ ] Manual trigger via portal → execution created, engine called, callback received, status updated
- [ ] Agent trigger → same flow with `trigger_type = 'agent'`
- [ ] Missing connection → blocked before execution, clear error in UI
- [ ] Engine returns error payload → execution marked `failed`, error message stored
