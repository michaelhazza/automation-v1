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

## Part 2 (Next)

Part 2 will cover:
- Execution flow (detailed runtime pipeline)
- Token refresh subsystem
- Engine resolution service
- Process resolution engine (inheritance + config merging)
- Agent integration (how `trigger_process` skill evolves)
- Scheduled task integration
- API routes (system admin, org, subaccount, portal)
- Frontend changes
- Observability (tracing, replay, debugging)
- File inventory (new + modified files)
- Verification plan
