# Automation OS — Org-Level Agents & Cross-Subaccount Intelligence
## Combined Development Specification v1.0

**Date:** 2026-04-02
**Brief type:** Product and architecture — not a line-level technical specification. Claude Code will derive implementation specifics from the codebase directly.
**Scope:** Five sequenced phases with explicit gate conditions between them.
**Primary design principle:** Generic infrastructure, configured behaviour. Every feature built in this spec must be usable by any future integration. GHL is the first implementation, not the defining one.

---

## Context and Purpose

Automation OS is a multi-tenant platform where organisations manage work across multiple subaccounts using AI agents. Subaccounts are a generic concept — they represent whatever the organisation needs: clients, projects, departments, properties, portfolios. The platform doesn't prescribe what a subaccount is.

Today, every agent run is scoped to a single subaccount. There is no mechanism for an agent to operate at the organisation level, monitor across subaccounts, detect cross-subaccount patterns, or take action at the portfolio level. This is a structural limitation that prevents the platform from functioning as a true operating system.

The first and largest target market is GoHighLevel (GHL) agencies managing 20-100+ client sub-accounts. These agencies have a structural visibility problem: every client account is a data silo, and there is no system — native to GHL or available as a third-party tool — that monitors the portfolio as a whole, detects problems proactively, or takes action without a human logging in and checking manually.

Market research confirms this gap is real, unoccupied, and currently costs agencies $1,000-2,350/month in fragmented partial solutions that do not solve the core problem. The five capabilities that matter and that nothing in the market provides are: cross-subaccount pattern detection, account health scoring and churn prediction, proactive push alerting, autonomous action (HITL-gated), and portfolio intelligence that improves over time.

This spec describes how to extend the platform to support org-level agent execution, ingest external platform data through a generic integration layer, and deliver cross-subaccount intelligence — all as generic platform capabilities that are configured per-organisation, not coded per-use-case.

---

## Core Architectural Principle

**The platform is generic. The configuration is the product.**

This means:

- Agents, skills, and the integration layer are written with no knowledge of which industry, which platform, or which use case they are serving. They operate on normalised data entities and respond to configuration injected at runtime.
- Everything specific to GHL agencies — which data to fetch, how to weight a health score, what threshold triggers an alert, which agents to load, which skills to enable — lives in the database as configuration, not in code.
- A configuration template is the unit of deployment. Loading a configuration template into an organisation provisions the correct agents, enables the correct skills on each agent, and connects the correct integration. The code does not change. Only the data does.

The practical test for every implementation decision: "If we replaced GHL with HubSpot tomorrow, would this code need to change?" If the answer is yes, the wrong thing has been made generic.

---

## Existing Infrastructure (What We're Building On)

A full codebase audit reveals significant foundation already in place. This spec builds on it rather than rebuilding.

### Already org-ready (least work required)

| Component | Current State |
|-----------|--------------|
| Policy rules | `subaccountId` is already nullable; org-wide rules already work |
| Org budget caps | `orgBudgets` table exists and is enforced independently |
| Processes | Already support `scope: 'organisation'` with nullable `subaccountId` |
| WebSocket | `emitOrgUpdate` function exists, just not wired to execution flow |
| Board config | Org-level config already exists (nullable `subaccountId` on `boardConfigs`) |
| Agent hierarchy | `agents.parentAgentId` exists for org-level hierarchy (no UI yet) |
| Budget context | `BudgetContext.subaccountId` is already optional; org/global caps apply without it |

### Integration layer foundation

| Component | Current State |
|-----------|--------------|
| Adapter pattern | `server/adapters/` with `IntegrationAdapter` interface, GHL + Stripe implementations |
| GHL adapter | `crm.createContact` implemented; `tag_contact` + `create_opportunity` declared but not built |
| OAuth token lifecycle | `integrationConnectionService` with advisory-lock refresh, AES-256-GCM encryption — production-ready |
| Integration connections | Per-subaccount stored credentials for `gmail`, `github`, `hubspot`, `slack`, `ghl`, `stripe`, `custom` |
| Process-to-connector binding | `processConnectionMappings` + `processes.requiredConnections` slot pattern in place |

### Template system foundation

| Component | Current State |
|-----------|--------------|
| System templates | `systemHierarchyTemplates` + `systemHierarchyTemplateSlots` + `systemTemplateService` |
| Org templates | `hierarchyTemplates` + `hierarchyTemplateSlots` + `hierarchyTemplateService` |
| Template versioning | `appliedTemplateId` + `appliedTemplateVersion` tracked on `subaccountAgents` |
| Template slots | Reference `systemAgentId` or `agentId`, carry full blueprint fields, self-referencing `parentSlotId` for tree structure |
| Paperclip import | System admin can import templates from Paperclip manifests |

### Hard-coupled to subaccount (requires migration)

| Subsystem | Blocker |
|-----------|---------|
| Agent runs | `subaccountId NOT NULL`, `subaccountAgentId NOT NULL` |
| Execution config | Budget, skills, instructions all on `subaccountAgents` join table |
| Heartbeat scheduling | Schedule keyed to `subaccountAgentId` |
| Memory | All entries scoped to single subaccount |
| Tasks | `subaccountId NOT NULL` |
| Skill execution | `SkillExecutionContext.subaccountId` required |
| Triggers | Schema requires subaccount + subaccount agent |
| Review queue / HITL | Review items and actions require subaccount |
| Connections | OAuth connections tied to subaccount |

---

## Phase Overview

```
Phase 1 — Org-Level Agent Execution (Foundation)
  The platform prerequisite. Makes agents runnable at the organisation
  level without a subaccount binding. Nothing in Phases 2-5 works
  without this. Discovered during architecture audit — not addressed
  in the original AIL brief.

Phase 2 — Integration Layer + GHL Connector
  The data foundation. Extends the existing adapter pattern into a full
  integration layer with canonical schema, data ingestion, webhook
  handling, and scheduled polling. Agents consume normalised entities,
  never raw API responses. Can overlap with Phase 1 since it is a
  different subsystem.

Phase 3 — Cross-Subaccount Intelligence + Portfolio Health Agent
  The core value. Combines generic cross-subaccount capabilities
  (subaccount tags, org memory, cohort query skills) with the Portfolio
  Health Agent and its intelligence skills (health scoring, anomaly
  detection, churn risk, reporting, HITL-gated intervention).

Phase 4 — Configuration Template System Extension
  The deployment mechanism. Extends the existing hierarchy template
  system to include connector references, skill enablement maps,
  and operational parameters. The GHL Agency Template is the first
  published template. Loading it provisions everything.

Phase 5 — Org-Level Workspace
  The organisation gets its own workspace for org-wide work that
  doesn't belong to any single subaccount. Board, tasks, scheduled
  tasks, triggers, connections — same capabilities as subaccount
  workspaces but scoped to the organisation. Independent of the
  intelligence layer; built based on demand.
```

---

## Phase 1: Org-Level Agent Execution (Foundation)

### What this phase delivers

The ability for agents to run at the organisation level without being bound to a subaccount. This is the platform prerequisite that everything else depends on. Today, every major subsystem hard-requires a `subaccountId` — agent runs, execution config, scheduling, memory, skills, triggers, review queue. This phase makes that coupling optional.

### Why this must come first

The Portfolio Health Agent in Phase 3 is an org-level agent. The cross-subaccount intelligence skills need to run in an org-level context. The configuration template system in Phase 4 needs to provision org-level agents. None of this is possible if the execution pipeline rejects a null `subaccountId`.

### Schema migrations

The following tables require `subaccountId` to become nullable:

| Table | Current constraint | Change |
|-------|-------------------|--------|
| `agent_runs` | `subaccount_id NOT NULL` | Nullable — org-level runs have no subaccount |
| `agent_runs` | `subaccount_agent_id NOT NULL` | Nullable — org-level runs use org agent config |
| `agent_runs` | (new columns) | Add `executionMode` (`'subaccount' \| 'org'`, NOT NULL), `resultStatus` (`'success' \| 'partial' \| 'failed'`, nullable), `configSnapshot` (jsonb, nullable — frozen config at run start), `configHash` (text, nullable — hash of snapshot for drift detection), `resolvedSkillSlugs` (jsonb, nullable), `resolvedLimits` (jsonb, nullable) |
| `review_items` | `subaccount_id NOT NULL` | Nullable — org-level HITL reviews |
| `actions` | `subaccount_id NOT NULL` | Nullable — org-level action audit trail |
| `actions` | (new column) | Add `actionScope` (`'subaccount' \| 'org'`, NOT NULL, default `'subaccount'`) — explicit scope prevents cross-scope idempotency collisions |
| `scheduled_tasks` | `subaccount_id NOT NULL` | Deferred to Phase 5 |
| `tasks` | `subaccount_id NOT NULL` | Deferred to Phase 5 |

**`executionMode` on agent runs.** The execution path must not be inferred from the presence or absence of `subaccountId`. An explicit `executionMode` flag (`'subaccount' | 'org'`) is set at run creation and used to route config loading, guard skills, and control logging/tracing. This prevents misrouting bugs where org logic accidentally runs in subaccount context or vice versa.

**Run context snapshot.** At run start, the resolved configuration is frozen into `configSnapshot` on the `agent_runs` record. This includes the effective limits, skill slugs, and any org-specific overrides. A `configHash` (SHA-256 of the snapshot) is stored alongside it. The snapshot also includes human-readable version metadata: `configVersion` (the org config hash), `templateVersion` (the applied template version, if any), and `agentVersion` (the system agent version). The hash is for machine comparison; the versions are for human debugging. This is essential for debugging, reproducibility, and post-mortems — especially once configs become dynamic via the template system (Phase 4).

**Config drift detection.** If the underlying config changes while a long-running org agent is mid-execution, the run continues using the snapshotted config (correct behaviour — mid-run config changes must not affect in-flight execution). However, at run completion, the system compares the current config hash against the snapshotted `configHash`. If they differ, the run is flagged with `configDriftDetected: true` in the run metadata. This aids debugging of inconsistencies in outputs that span a config change window.

**Partial run handling.** Org-level runs (especially the Portfolio Health Agent) may process multiple accounts in a single run. If some accounts succeed and others fail (e.g. connector timeout for one account), the run should not be marked as a blanket `success` or `failure`. The `resultStatus` field on `agent_runs` captures three states: `'success'` (all work completed), `'partial'` (some work completed, some failed — details in run output), `'failed'` (no meaningful work completed). Downstream consumers (reporting, alerting) must check `resultStatus` and not assume a completed run means all data is fresh.

**Partial run output contract.** When `resultStatus` is `'partial'`, the run output must include a structured summary:

```json
{
  "processedAccounts": 47,
  "successfulAccounts": 42,
  "failedAccounts": 5,
  "failures": [
    { "accountId": "...", "reason": "connector_timeout", "retryable": true }
  ]
}
```

**Failure reason classification.** The `reason` field uses a standardised enum, not free text: `connector_timeout`, `rate_limited`, `auth_error`, `data_incomplete`, `internal_error`, `unknown`. This enables failure analytics, automated retry strategies, and consistent downstream logic. The `retryable` flag is derived from the reason, not set manually: `connector_timeout` and `rate_limited` are retryable; `auth_error`, `data_incomplete`, `internal_error`, and `unknown` are not. The `unknown` reason is additionally treated as high-severity and produces an operator-visible log entry — if failures are hitting `unknown`, the classification system needs extending. This prevents inconsistent retry behaviour across agents.

This structure is stored in the existing run output field and is required (not optional) when `resultStatus` is `'partial'` or `'failed'`. It enables: targeted retry of only failed accounts in a subsequent run, accurate reporting that distinguishes "no data" from "stale data" from "fresh data," and operator visibility into which accounts are affected.

**`actionScope` on actions.** The existing idempotency model uses `(subaccountId, idempotencyKey)`. With nullable `subaccountId`, a collision could occur if the same idempotency key is used in different scopes. The explicit `actionScope` column is included in all idempotency checks to prevent cross-scope dedupe bugs.

Index strategy: existing composite indexes that include `subaccountId` need corresponding partial indexes for the `subaccountId IS NULL` case, scoped to `organisationId` instead. The unique constraint on `actions(subaccountId, idempotencyKey)` needs a partial variant for org-level actions: `UNIQUE (organisation_id, idempotency_key) WHERE action_scope = 'org'`.

### Org agent execution config

Today, all per-run configuration lives on the `subaccountAgents` join table: `tokenBudgetPerRun`, `maxToolCallsPerRun`, `timeoutSeconds`, `skillSlugs`, `allowedSkillSlugs`, `customInstructions`, `maxCostPerRunCents`, `maxLlmCallsPerRun`.

Org-level agents need equivalent configuration without the subaccount binding. Two options:

**(a) New `orgAgentConfigs` table** — mirrors the relevant fields from `subaccountAgents`, keyed to `(organisationId, agentId)`. Clean separation. More tables.

**(b) Promote config fields onto the `agents` table** — add the same fields directly to the org-level agent record with a flag like `orgExecutionEnabled`. Fewer tables. Muddies the `agents` table which currently holds only definition, not runtime config.

**Recommendation:** Option (a). The `subaccountAgents` table works well because it cleanly separates "agent definition" from "agent deployment config." The org level should mirror this pattern rather than collapse it. The developer should validate this against the codebase and choose the approach that introduces the least friction.

### Execution service changes

`agentExecutionService.executeRun()` currently requires `subaccountId` and `subaccountAgentId` in the `AgentRunRequest` interface. The changes:

1. **Make `subaccountId` and `subaccountAgentId` optional** on `AgentRunRequest`
2. **Set `executionMode` explicitly** — the caller specifies `'subaccount'` or `'org'` at run creation. This flag drives all downstream routing decisions. Never infer execution mode from the presence or absence of `subaccountId`.
3. **Validate executionMode consistency** — hard validation at run creation: if `executionMode === 'org'`, then `subaccountId` must be null (reject with error if provided). If `executionMode === 'subaccount'`, then `subaccountId` must be present (reject if missing). This prevents silent corruption from mismatched parameters.
3. **Snapshot config at run start** — freeze the resolved config (limits, skill slugs, overrides) into `configSnapshot` on the `agent_runs` record before execution begins
4. **Load config from the right source** — based on `executionMode`: if `'subaccount'`, load from `subaccountAgents` (existing path). If `'org'`, load from the new org agent config
5. **Skip subaccount-specific context gracefully:**
   - `buildTeamRoster()` — use org-level agent list instead of subaccount agents
   - `workspaceMemoryService.getMemoryForPrompt()` — skip (no subaccount memory) or load org memory when Phase 3 is built
   - `buildSmartBoardContext()` — skip (no subaccount board) or load org board when Phase 5 is built
   - `devContextService.getContext()` — skip (no subaccount dev context)
   - `checkWorkspaceLimits()` — skip subaccount limits; org + global limits still apply
4. **Post-run memory extraction** — skip `extractRunInsights()` (subaccount-scoped) until org memory exists in Phase 3
5. **Post-run triggers** — skip `triggerService.checkAndFire()` (subaccount-scoped) until org triggers exist in Phase 5
6. **Langfuse trace** — use `organisationId` instead of `subaccountId` for attribution

### Org-level heartbeat scheduling

`agentScheduleService` currently keys schedules to `subaccountAgentId`. For org agents:

- Schedule name format: `agent-org-scheduled-run:${agentId}` (distinct from subaccount schedule names)
- Job payload: `{ agentId, organisationId }` (no `subaccountAgentId` or `subaccountId`)
- `registerAllActiveSchedules()` must query both `subaccountAgents` (existing) and org agent configs (new) for active schedules
- The heartbeat config fields (`heartbeatEnabled`, `heartbeatIntervalHours`, `heartbeatOffsetMinutes`) live on the org agent config

### WebSocket emission

When an org-level agent runs:
- `emitAgentRunUpdate(run.id, ...)` — already org-scoped via the run-specific room (no change)
- Replace `emitSubaccountUpdate()` with `emitOrgUpdate()` — this function already exists in `emitters.ts` but is not wired to the execution flow

### Org-level review queue

When org agents propose HITL-gated actions, review items need to be viewable and actionable:

- New route: `GET /api/org/review-queue` — returns review items where `subaccountId IS NULL` for the authenticated org
- New route: `GET /api/org/review-queue/count` — pending count for badge display
- Approve/reject routes (`POST /api/review-items/:id/approve|reject`) already work without subaccount context — they operate on `reviewItem.id`
- UI: new org-level review queue page or a tab/mode on the existing review queue

### Skill execution context

`SkillExecutionContext.subaccountId` must become optional (`string | null`). Skills that require a subaccount context (e.g. `create_task` targeting a subaccount board, `read_workspace` for a subaccount board) should check for `subaccountId` presence and return a clear error if called from an org-level context without a target subaccount specified.

Cross-subaccount skills (Phase 3) will be designed to work specifically in the org-level context.

### Org vs subaccount authority rules

These rules are cross-cutting and must be enforced from Phase 1, not deferred to Phase 5:

- **Org agents cannot mutate subaccount state** unless: (a) the `orgAgentConfig` has `allowedSubaccountIds` that includes the target, AND (b) the action explicitly specifies the target subaccount. Without both, the mutation is rejected at the skill execution layer. Cross-boundary writes are always HITL-gated (Phase 5 implements the full UI; Phase 1 enforces the programmatic guard).
- **Subaccount agents cannot read org memory directly.** Org memory (Phase 3) is only accessible from org-level execution context. Subaccount agents access only their own subaccount memory.
- **Subaccount agents cannot read other subaccounts' canonical data.** When `executionMode === 'subaccount'`, all canonical data queries are scoped to the current subaccount only. Cross-subaccount reads require org-level context. This prevents accidental cross-client data leakage in multi-tenant setups.
- **Org agents can read all canonical data for their organisation.** This is expected — org agents exist to operate across the portfolio. Read access is unrestricted within the organisation boundary.
- **Execution mode is authoritative.** The `executionMode` flag on `agent_runs` determines which authority rules apply. A run with `executionMode: 'org'` uses org authority rules; `executionMode: 'subaccount'` uses subaccount rules. There is no blending.

**Authority violation logging.** When any authority rule is violated (a skill attempts an action that the rules forbid), the system logs an `authority_violation_attempt` event containing: `agentId`, `executionMode`, `attemptedScope` (what the agent tried to do), `targetId` (the subaccount or resource it tried to access), and the rejection reason. These events are surfaced in operator logs and are critical for enterprise debugging and future compliance requirements. The violation is always rejected — logging is for visibility, not for approval workflows.

These rules prevent accidental cross-boundary writes, security leakage, and future compliance issues. They are enforced in the skill execution layer, not delegated to individual skill implementations.

### Retry boundary policy

Not all operations are safe to retry. The following policy prevents duplicate side effects:

- **Safe to retry (idempotent):** connector polling, webhook ingestion (deduplicated by idempotency key), canonical data reads, health score computation (overwrites previous snapshot), baseline recomputation.
- **Not safe to retry (non-idempotent side effects):** agent execution runs (may produce duplicate actions, HITL proposals, or external API calls), intervention execution (may trigger duplicate external actions), alert delivery (may send duplicate notifications).

The retry boundary is enforced at the service layer: `connectorPollingService` and `webhookIngestionService` implement automatic retry with exponential backoff. `agentExecutionService.executeRun()` does not retry — if a run fails, a new run is created (with a new run ID and fresh config snapshot). The Portfolio Health Agent's state machine (Phase 3) handles its own retry semantics per state, as defined in its retry table.

### Org-level execution kill switch

Org agent configs include an `orgExecutionEnabled` flag at the organisation level (not per-agent). When set to `false`, all org-level agent runs for that organisation are immediately rejected. This provides an emergency stop for all org agents without requiring individual config changes.

The kill switch affects both new and scheduled runs:

- **New runs:** Checked at run creation time in `agentExecutionService.executeRun()`, before any config loading or context building. Returns a clear error: "Org-level execution is disabled for this organisation."
- **Scheduled runs:** When the pg-boss worker dequeues an `agent-org-scheduled-run` job, it checks `orgExecutionEnabled` before executing. If disabled, the job is silently dropped (not retried) and an operator-visible log entry is created. This prevents delayed executions from firing after an emergency shutdown.

**Kill switch audit trail.** Every toggle of the kill switch produces an audit log entry: `org_execution_disabled` or `org_execution_enabled`, including the actor (user ID), timestamp, and optional reason. This is an enterprise requirement — when nothing ran for 6 hours, the first debugging question is "did someone flip the kill switch?" The audit trail answers it immediately.

### What this phase does NOT include

- Org-level memory (Phase 3)
- Org-level board or tasks (Phase 5)
- Org-level triggers (Phase 5)
- Org-level connections (Phase 5)
- Cross-subaccount reading (Phase 3)
- Any intelligence capabilities (Phase 3)

### Gate condition for Phase 2

Phase 1 is complete when:
- An agent can be configured at the org level with execution config (budget, skills, schedule)
- An org-level agent run can be triggered manually and completes successfully
- The org-level heartbeat schedule fires and produces a run
- A HITL-gated action from an org agent appears in the org review queue and can be approved
- No existing subaccount agent flows are affected (zero regression)

---

## Phase 2: Integration Layer + GHL Connector

### What this phase delivers

A platform-level service that connects to external platforms, ingests their data, normalises it to a canonical schema, and makes that normalised data available to agents and skills through a clean internal interface. Agents and skills never call external APIs directly. They consume normalised entities from this layer.

This phase also delivers the first full implementation of that layer: the GHL connector, extending the existing `server/adapters/ghlAdapter.ts` pattern into a complete data ingestion system.

### Building on what exists

The codebase already has:
- **Adapter interface** (`server/adapters/integrationAdapter.ts`) — defines `IntegrationAdapter` with `crm` and `payments` namespaces
- **GHL adapter** (`server/adapters/ghlAdapter.ts`) — `crm.createContact` implemented with OAuth token handling
- **Stripe adapter** (`server/adapters/stripeAdapter.ts`) — payments implemented
- **OAuth lifecycle** (`integrationConnectionService.ts`) — advisory-lock token refresh, AES-256-GCM encryption, 15-minute early refresh buffer
- **Connection storage** (`integrationConnections` schema) — per-subaccount credentials for multiple providers
- **Adapter registry** (`server/adapters/index.ts`) — `Record<string, IntegrationAdapter>` keyed by provider name

What's missing is the **data ingestion** side. The current adapter pattern handles outbound actions (create a contact, create a checkout). It does not handle inbound data retrieval (fetch all contacts, fetch pipeline state, receive webhooks). The integration layer extends the adapter pattern with ingestion capabilities.

### Why a platform layer and not skills

Skills are agent-invoked, synchronous, and stateless. They are suited to actions like looking up information or triggering a process. They are not suited to managing OAuth sessions across polling cycles, enforcing rate limits across a shared quota, ingesting webhook streams, or maintaining connection state across multiple sub-accounts.

The integration layer handles all of that complexity once, centrally, so that skills and agents remain simple. A skill that calls `getOpportunities(orgId, accountId)` does not need to know about GHL's rate limits, OAuth token refresh, or the shape of GHL's API response.

### The canonical schema

The canonical schema is the set of normalised entity types that the integration layer produces and the rest of the system consumes. It is designed from GHL's real data model (the first implementation) but named and structured generically so that a second connector (HubSpot, Shopify, Stripe) can produce the same entity types from different raw data.

#### Entity identity and uniqueness

Every entity ingested from an external platform is identified by a composite key:

- `external_id` — the ID in the source system (e.g. GHL contact ID)
- `source_connector` — which connector type produced it (e.g. `ghl`)
- `source_account_id` — which external account it belongs to (e.g. GHL location ID)

This composite key is the global identity for deduplication and updates. No two records may share the same `(external_id, source_connector, source_account_id)` tuple.

#### State vs event separation

The schema separates **current state** (latest known record) from **event history** (what happened and when):

- **State tables** (`contacts`, `opportunities`, `conversations`, `revenue`) hold the latest known state of each entity. Upserted on every sync.
- **Event tables** (`contact_events`, `opportunity_events`, `conversation_events`, `revenue_events`) record discrete changes over time. Append-only. These power anomaly detection, trend analysis, and historical baselines.

This split is critical: health scoring needs current state; anomaly detection needs event history; both need to be queryable independently.

#### Upsert and ordering rules

- **Last-write-wins with timestamp ordering.** Each entity carries `source_updated_at` (timestamp from the external platform) and `last_synced_at` (when we last wrote it). An incoming record only overwrites the stored state if its `source_updated_at` is newer than the stored value. This handles out-of-order webhook + polling arrivals.
- **Soft delete handling.** Entities deleted in the source system are marked with `deleted_at` rather than removed. Required for GHL (which soft-deletes contacts) and expected for future connectors. All queries filter on `deleted_at IS NULL` by default.

#### Event enrichment fields

Every event table entry includes, in addition to entity-specific fields:

- `event_group_id` (required, auto-generated if not provided by connector) — groups related events that are part of the same real-world change (e.g. a pipeline move that triggers stage change + revenue update). Assigned by the connector when it can detect causality, or auto-generated by the ingestion layer (UUID) when the connector does not provide one. When events arrive within a short window (configurable, default 5 seconds) for the same entity and from the same source, the ingestion layer assigns the same group ID. **Group boundary rules:** a new group is started when: (a) the `event_type` differs from the previous event in the window, OR (b) the change direction reverses (e.g. a metric goes up then down within the window). This prevents unrelated events from being incorrectly grouped, which would make anomaly detection noisy. **Max group size:** a group is capped at 20 events (configurable). If the cap is reached within the window, a new group is started. This prevents runaway grouping under noisy webhook bursts. This field is critical for anomaly detection, causality tracking, and debugging multi-event flows — it must not be left empty.
- `event_source_type` — one of `webhook`, `poll`, or `derived` (computed by the platform, e.g. a churn risk event). Distinguishes how the event entered the system.
- `event_ingested_at` — when the platform received the event. Separate from `source_updated_at` (when it happened in the source) and `last_synced_at` (when state was written). This three-timestamp model enables: sequence reconstruction, ingestion latency monitoring, and debugging "what actually happened vs when we knew about it."

#### Data freshness metadata

Every state table includes:
- `last_synced_at` — when this record was last written by the ingestion layer
- `source_updated_at` — the last-modified timestamp from the external platform
- `sync_source` — whether the last update came from `webhook` or `poll`

This enables the reconciliation job (below) to detect stale data and the intelligence layer to assess data confidence.

#### Entity types

The schema defines at minimum:

**Account** — represents one subaccount mapped to an external platform account. Fields: identifier, display name, status, creation date, source connector reference. This is the central entity everything else hangs off.

**Contact** — a person record within an account. Growth rate and recency of new contacts are key health signals.

**Opportunity** — a deal or pipeline item within an account. Stage, value, age in stage, and movement history are key health signals.

**Conversation** — a communication thread. Volume, recency, and response patterns are key health signals.

**Revenue** — a transaction or recurring revenue record. Amount, date, and status.

**CampaignActivity** — a marketing activity (email send, SMS, ad) with performance signals where available.

**HealthSnapshot** — a point-in-time computed summary of an account's health. Written by the platform (Phase 3 intelligence skills), not ingested from the external source. Includes `algorithm_version` and `config_version` for regression debugging.

**AnomalyEvent** — a detected deviation from baseline in any metric. Written by the intelligence skills (Phase 3). Not ingested. Includes `algorithm_version` and `config_version`.

The schema is v1. It will be refactored when the second connector is built. The goal now is to get the right boundaries — agents consume entity types, not API responses — not to get the perfect field set on every entity.

### The connector interface

The existing `IntegrationAdapter` interface defines outbound actions (`crm.createContact`, `payments.createCheckout`). The integration layer extends this with an ingestion interface. Every connector must implement:

- Fetch all accounts for an organisation (the sub-account list)
- Fetch contacts for a given account, with optional date range
- Fetch opportunities for a given account, including stage history
- Fetch conversation activity for a given account
- Fetch revenue records for a given account
- Validate credentials for a given organisation's connector config
- Handle incoming webhook events and normalise them to internal event types

The relationship to the existing adapter pattern: the existing `IntegrationAdapter` interface continues to handle outbound actions. The new ingestion interface sits alongside it. A connector implements both. They share the same credential store (`integrationConnections`) and OAuth lifecycle (`integrationConnectionService`).

### The GHL connector (ingestion extension)

Extends the existing `ghlAdapter.ts` with data retrieval capabilities:

**Authentication and credential management.** Already handled by `integrationConnectionService` with advisory-lock token refresh. The connector uses this existing infrastructure. No new auth code needed — only new API call methods that consume the decrypted token.

**Sub-account enumeration.** GHL agencies have a parent agency account with many child sub-accounts (locations). The connector enumerates all sub-accounts associated with the agency's API credential and presents them as Account entities. The mapping between GHL location IDs and internal subaccount records is stored in the connector config.

**Data ingestion.** The connector fetches data per sub-account and normalises it to canonical entities. It does not return raw GHL API responses to callers. It returns Contact, Opportunity, Conversation, and Revenue entities.

**Rate limit management.** GHL's API allows 100 requests per 10 seconds and 200,000 requests per day per location. The connector implements a rate limiter that queues requests rather than dropping them, and surfaces rate limit warnings to the operator when approaching limits.

**Webhook ingestion.** GHL fires webhooks for 59 documented event types. The existing `server/routes/githubWebhook.ts` pattern (unauthenticated endpoint with signature verification) is the model. The GHL connector receives webhook events, validates their signatures, and translates them into internal event types. Key events at minimum: contact created, opportunity stage changed, conversation started, conversation went inactive, appointment booked.

**Scheduled polling.** Some metrics are not available via webhooks and require polling. The connector supports scheduled polling jobs managed through the existing pg-boss scheduler. Polling frequency is configurable per-organisation.

### Ingestion consistency model

Webhooks and polling serve different purposes and must be reconciled:

- **Webhooks = near real-time events.** They deliver changes as they happen but can be missed (network failures, downtime, ordering issues).
- **Polling = source of truth reconciliation.** Polling jobs periodically fetch the full current state from the source and reconcile against stored data.

**Idempotency.** Every ingested event carries an idempotency key derived from `(source_connector, external_id, event_type, source_timestamp)`. Duplicate events are silently dropped. This prevents double-counting when a webhook and a poll cycle deliver the same change.

**Event sequencing.** When multiple updates arrive for the same entity, `source_updated_at` determines which is authoritative (see upsert rules above). Events without a source timestamp use arrival order as fallback.

**Reconciliation job.** A scheduled job (default: daily, configurable) compares stored entity state against the source for each connected account. It detects:
- Entities present in source but missing locally (missed webhook + missed poll)
- Entities with `last_synced_at` older than expected (stale data)
- Entities deleted in source but not locally marked

The reconciliation job produces a drift report per account. Drift is considered significant — and triggers an operator-visible warning — when any of: (a) 5%+ of entities for an account are missing locally, (b) 10%+ of entities have a `source_updated_at` newer than `last_synced_at` by more than 2 polling cycles, or (c) any entities are deleted in source but not locally marked. Thresholds are configurable per-organisation.

**Reconciliation authority rules.** When reconciliation detects a mismatch between stored state and the source:

- **Polling (source) always wins for state.** The polled data is the source of truth. If the stored state differs from what polling returns, the stored state is overwritten — provided the polled `source_updated_at` is newer or equal. This is a repair, not a conflict.
- **Webhooks are advisory.** Webhook-delivered data is applied optimistically (faster updates), but reconciliation can overwrite it. Webhooks are never authoritative over a more recent poll result.
- **Repair behaviour:** On mismatch, the reconciliation job overwrites the stored state with the polled version and logs a `reconciliation_repair` event including the before/after values. No manual intervention required for state repairs. Event history is never modified — only state tables are repaired.
- **Max repair scope.** A safety cap limits reconciliation to overwriting at most 30% of records for a given account in a single run (configurable). If the repair scope exceeds this threshold, the reconciliation job halts for that account, flags it as `reconciliation_scope_exceeded`, and raises an operator alert. This protects against: bad connector responses overwriting valid data, API bugs returning incorrect state, and mapping errors causing mass corruption. The operator must acknowledge and approve large-scope repairs manually. The halt produces a `reconciliation_aborted` event with the reason, affected account IDs, and the repair scope that was attempted. This is surfaced alongside other sync audit events so the operator understands why data remains stale.

**Last seen cursor.** The ingestion layer tracks a `last_seen_cursor` per entity type per account — the most recent `source_updated_at` or page cursor successfully processed. Polling resumes from this cursor rather than re-fetching everything.

### Initial backfill strategy

When a connector is first connected to an organisation:

1. **Staged ingestion.** The backfill job fetches historical data in batches, respecting rate limits. It does not attempt to pull everything at once.
2. **Priority order.** Accounts are backfilled first (the subaccount list), then contacts, then opportunities, then conversations, then revenue. This ensures the Portfolio Health Agent has the entity hierarchy before detail data.
3. **Backfill flag.** During backfill, ingested entities are tagged with `is_backfill: true` so the intelligence layer can distinguish historical data from live activity. Anomaly detection ignores backfill data when computing baselines.
4. **Completion signal.** When backfill completes for an account, the system emits a `backfill_complete` event. The Portfolio Health Agent waits for this before running its first health scoring pass on that account.
5. **Webhook queueing during backfill.** Webhooks that arrive while backfill is in progress for an account are queued (not dropped, not applied immediately). Once backfill completes, queued webhooks are replayed in order, subject to normal idempotency and timestamp rules. This prevents: duplicate events from overlapping data windows, incorrect baselines from mixing historical and live data, and false anomalies immediately post-connect.

**Webhook queue ordering guarantee.** Queued webhooks are keyed by `(accountId, entityType, entityId)` and replayed strictly ordered by `source_timestamp`, with `event_ingested_at` as fallback when source timestamps are identical. This per-entity ordering prevents state regressions (e.g. an opportunity appearing to move backwards through pipeline stages) and ensures health signals reflect the correct sequence of changes.

**Webhook replay deduplication.** During the `transition` phase, replayed webhooks may overlap with data already ingested by polling (which ran during backfill). Before applying any replayed event, the ingestion layer checks the existing idempotency key `(source_connector, external_id, event_type, source_timestamp)`. If a matching event already exists, the replay is silently skipped. This reuses the existing idempotency infrastructure — no new dedup mechanism is needed, but the check must be explicitly enforced during replay (not assumed).

### Connector configuration in the database

Each organisation that uses the integration layer has one or more connector config records. A connector config stores:

- Which connector type is active (GHL, in this case)
- The authentication credentials for that connector (using existing `integrationConnections` storage with encrypted tokens)
- The sub-account mapping (which external account IDs map to which internal subaccount records)
- Polling schedule preferences
- Status and last-sync metadata

Additionally, each connector config tracks a `syncPhase` field with three states:

- **`backfill`** — initial historical data ingestion is in progress. Webhooks for this account are queued, not applied. Anomaly detection is suppressed.
- **`transition`** — backfill is complete. Queued webhooks are being replayed in order, subject to normal idempotency and timestamp rules.
- **`live`** — normal operation. Webhooks and polling both apply normally.

This explicit state machine prevents race conditions between polling and webhooks during initial setup, false anomalies immediately post-connect, and ambiguous system behaviour during the backfill-to-live transition. The transition from `backfill` → `transition` is triggered by the `backfill_complete` event. The transition from `transition` → `live` is triggered when all queued webhooks have been replayed.

The connector config also tracks a `configVersion` (text) — a SHA-256 hash recomputed whenever the config changes. Intelligence skill outputs reference this hash for full reproducibility.

This builds on the existing `integrationConnections` table and `processConnectionMappings` pattern. The developer should evaluate whether the existing schema is sufficient or whether a new `connectorConfigs` table is needed for org-level connector state that spans subaccounts.

### What to build vs what to configure

**Build (generic):**
- Extended connector interface (ingestion methods alongside existing action methods)
- GHL ingestion implementation (fetch accounts, contacts, opportunities, conversations, revenue)
- Rate limiter service
- Webhook endpoint and event normalisation
- Canonical schema entity tables
- Scheduled polling via pg-boss

**Configure (per-organisation):**
- Which connector type to use
- OAuth credentials (provided by operator)
- Sub-account mapping (GHL location IDs to internal subaccounts)
- Polling frequency
- Which webhook events to process

### Data confidence layer

The canonical data service exposes a lightweight data confidence assessment alongside query results. This is computed at the query layer, not stored in schema:

- **`dataFreshnessScore`** (0.0–1.0) — derived from `last_synced_at` relative to the expected polling interval. A score of 1.0 means the data was synced within the last polling cycle. Decays linearly as staleness increases.
- **`dataCompletenessScore`** (0.0–1.0) — derived from reconciliation drift reports. A score of 1.0 means no known missing or stale entities. Decreases proportionally to the drift percentage detected by the last reconciliation job.

These scores are returned on all canonical data queries and included in skill inputs. Intelligence skills should factor confidence into their outputs — a health score computed from low-confidence data should itself report low confidence. This prevents agents from making high-confidence decisions on stale or incomplete data, especially during the early lifecycle of a connector.

**Confidence propagation rule.** When a skill consumes multiple data sources to produce an output (e.g. health scoring combines contact, opportunity, conversation, and revenue metrics), the output confidence is `MIN(all contributing confidences)`. The weakest input determines overall confidence. A weighted model may replace this later, but `MIN` is the correct conservative default for v1.

**Confidence floor.** If the propagated confidence falls below 0.3, the output is treated as unreliable: it may be displayed to operators (with a clear warning) but must not drive automated decisions (anomaly detection, alert generation, HITL proposals). This prevents agents from acting on garbage data, especially during early connector lifecycle or degraded connector states.

**No-data vs zero-data distinction.** Every canonical data query returns a `dataStatus` field alongside results: `'fresh'` (data exists and is current), `'stale'` (data exists but exceeds staleness threshold), or `'missing'` (no data has ever been ingested for this entity type). This distinction is critical: "0 contacts exist" (fresh, count is zero) is fundamentally different from "we have no contact data" (missing). Without this, health scoring would incorrectly interpret missing data as zero activity, producing false anomalies.

**Missing data behaviour in skills.** When any contributing data source has `dataStatus: 'missing'`, that source is excluded from scoring entirely (not treated as zero). The skill output must explicitly surface which accounts have missing data: e.g. "3 accounts excluded from portfolio scoring due to missing contact data." This prevents silent bias in portfolio-level outputs and ensures operators know which accounts are not yet fully covered.

**Hard staleness cutoff.** If `last_synced_at` for an account exceeds 2x the configured polling interval, the canonical data service marks the dataset as `stale` and includes a `staleness_warning` in the response. Intelligence skills receiving stale data must degrade gracefully — they may still compute outputs but must set confidence to the minimum (0.1) and include the staleness warning in their output. This prevents misleading health scores when a connector has silently stopped syncing.

### Connector health state

Each connector config exposes a derived `healthStatus` field: `'healthy' | 'degraded' | 'failed'`. This is computed (not stored) from:

- **`healthy`** — last sync succeeded, error rate below 5% over the last 24 hours, no sync delays exceeding 2x poll interval
- **`degraded`** — error rate between 5-25%, or sync delays exceeding 2x poll interval but data is still flowing
- **`failed`** — last 3+ consecutive syncs failed, or no successful sync in the last 24 hours

The health status is surfaced in the connector config API response and on the operator dashboard. The system enforces explicit behaviour per health state:

| Health state | Behaviour |
|-------------|-----------|
| `healthy` | Normal operation. All scoring, anomaly detection, and reporting proceed as configured. |
| `degraded` | Data confidence scores are reduced proportionally to error rate/delay severity. Intelligence skills still run but outputs carry lower confidence. Operator receives a warning notification (not an alert). |
| `failed` | Health scoring is suppressed for all accounts on this connector. Anomaly detection is suspended (to prevent false anomalies from missing data). Affected accounts are flagged as "data missing" in portfolio reports. Operator receives an alert. The Portfolio Health Agent skips these accounts entirely rather than producing misleading outputs. |

These rules are enforced at the `canonicalDataService` layer — when a skill requests data for an account whose connector is `failed`, the response includes `connectorHealthStatus: 'failed'` and the skill is expected to handle it (skip scoring, report unavailability). This is not optional behaviour left to individual skill implementations.

### Query scope guards

All canonical data service methods enforce hard limits to prevent runaway queries:

- **Maximum accounts per query:** 100 (configurable). Queries spanning more accounts must paginate.
- **Maximum time range:** 90 days (configurable). Historical queries beyond this require explicit override.
- **Maximum rows returned per entity type:** 10,000 (configurable). Results exceeding this are truncated with a warning.

These limits are enforced at the `canonicalDataService` layer, not in individual callers. This provides a consistent safety net regardless of whether the caller is a skill, the Portfolio Health Agent, or an API route.

### Sync event audit log

The integration layer logs the following events for operational visibility:

- **Sync events** — every polling cycle start/completion, with entity counts and duration
- **Webhook events** — every webhook received, with normalisation outcome (accepted, rejected, duplicate)
- **Reconciliation repairs** — every state repair performed during reconciliation, with before/after values
- **Connector state transitions** — every `syncPhase` change (`backfill` → `transition` → `live`)

These events are stored in the existing audit infrastructure and surfaced to operators alongside agent action logs. They are essential for diagnosing "why didn't the system detect X?" questions.

### Gate condition for Phase 3

Phase 2 is complete when:
- The GHL connector can successfully enumerate sub-accounts and produce normalised Account entities for a real GHL organisation
- Opportunity, Contact, and Conversation entities are being produced correctly from GHL data
- Webhook ingestion is operational for at minimum the five key event types
- A developer working on Phase 3 can write skills that call the integration layer interface without touching GHL-specific code
- Rate limiting is functional and surfaces warnings when approaching GHL limits

---

## Phase 3: Cross-Subaccount Intelligence + Portfolio Health Agent

### What this phase delivers

Two tightly coupled components:

1. **Generic cross-subaccount capabilities** — subaccount tags, org-level memory, and skills that let org-level agents read across subaccounts. These are platform primitives usable by any org-level agent for any purpose.

2. **The Portfolio Health Agent and its intelligence skills** — a new system agent that consumes normalised data from Phase 2, computes health scores, detects anomalies, flags churn risk, generates portfolio reports, and escalates interventions through the HITL gate. This agent is the first consumer of both the org-level execution (Phase 1) and the integration layer (Phase 2).

### Part A: Generic cross-subaccount capabilities

#### Subaccount tags

User-defined key-value tags on subaccounts. This is the grouping primitive for cohort analysis. Organisations define whatever dimensions matter to them — the platform provides the tagging infrastructure, not the categories.

```
subaccount_tags table
├── id (uuid PK)
├── organisation_id (FK)
├── subaccount_id (FK)
├── key          (e.g. "vertical", "region", "plan", "tier")
├── value        (e.g. "dental", "northeast", "premium", "enterprise")
└── created_at

Unique: (subaccount_id, key)
```

A GHL agency tags by vertical and region. A dev shop tags by tech stack and contract type. A property manager tags by building type and location. Same table, same API, same skills — different data.

UI: tag management on the subaccount settings page. Key-value editor. Bulk tagging across multiple subaccounts.

#### Org-level memory

A new memory layer scoped to the organisation, not any single subaccount. This is where cross-subaccount insights and patterns are stored.

```
org_memory_entries table
├── id (uuid PK)
├── organisation_id (FK)
├── source_subaccount_ids  (jsonb array — which subaccounts contributed)
├── agent_run_id (FK)
├── content                ("Dental subaccounts convert 2x better with same-day follow-up")
├── entry_type             (observation, decision, preference, issue, pattern)
├── scope_tags             (jsonb — e.g. {"vertical": "dental"} — which segment this applies to)
├── quality_score          (0.0–1.0, same scoring as subaccount memory entries)
├── embedding              (vector(1536), same embedding infrastructure)
├── evidence_count         (how many subaccounts support this insight)
├── access_count
├── created_at
└── last_accessed_at
```

Design decisions:
- **Separate table, not nullable `subaccountId` on existing memory tables.** Org insights are a different concept than subaccount memory. Mixing them muddies permissions and queries.
- **`scope_tags`** links insights to subaccount tag dimensions. "This pattern applies to subaccounts tagged `vertical=dental`." Generic, not hardcoded.
- **`evidence_count`** tracks how many subaccounts support this insight. Agents can weight by evidence strength.
- **`source_subaccount_ids`** for traceability without leaking subaccount data into the insight content.

The service mirrors `workspaceMemoryService` — CRUD, semantic search via embeddings, quality scoring, dedup. The dedup loop compares new org insights against existing ones using the same Mem0 pattern.

**Org ↔ subaccount memory interaction rules:**

- **Promotion.** A subaccount-level insight is promoted to org memory when the same pattern is observed across 3+ subaccounts (configurable threshold). The promoting agent writes a new org memory entry with `evidence_count` reflecting how many subaccounts contributed, and `source_subaccount_ids` listing them. The original subaccount entries are not deleted.
- **Decay.** Org memory entries have a `last_validated_at` timestamp. Entries not revalidated within a configurable window (default: 30 days) have their `quality_score` decayed by 20% per missed window. Entries that decay below 0.2 are flagged for review rather than auto-deleted — the agent can re-evaluate or the operator can dismiss.
- **Conflict resolution.** When a new insight contradicts an existing org memory entry (detected via semantic similarity + opposing sentiment), the system applies: (1) higher `evidence_count` wins if the gap is significant (2x+), (2) more recent `last_validated_at` wins if evidence is comparable, (3) if neither is clear, both are kept and the agent is prompted to resolve on its next run.
- **No downward propagation.** Org insights are never automatically written into subaccount memory. They inform org-level agent reasoning only. If an org insight needs to influence subaccount-level behaviour, it goes through an explicit agent action (which may be HITL-gated).

#### Cross-subaccount skills

Three new skills available to org-level agents:

**`query_subaccount_cohort`**
- Reads board health + memory summaries across multiple subaccounts, filtered by tags
- Input: tag filters (e.g. `{"vertical": "dental"}`) or explicit subaccount IDs, optional metric focus
- Output: aggregated/anonymised data per matching subaccount — board health metrics, memory summary excerpts, entity counts, last activity dates
- Does NOT return raw subaccount data to prevent cross-subaccount data leakage — returns summaries and metrics
- **Scope guards:** Maximum 50 subaccounts per query (configurable). Results are paginated. If the tag filter matches more than the limit, the skill returns the first page with a continuation token. This prevents a single agent call from triggering expensive scans across hundreds of subaccounts.
- Gate level: `auto` (read-only, no side effects)

**`read_org_insights`**
- Queries org-level memory entries
- Input: optional tag scope filter, optional semantic query, optional entry type filter
- Output: matching org memory entries with content, scope tags, evidence count
- Gate level: `auto`

**`write_org_insight`**
- Stores a cross-subaccount pattern in org memory
- Input: content, entry_type, scope_tags, source_subaccount_ids, evidence_count
- Triggers the same quality scoring and embedding pipeline as subaccount memory entries
- Gate level: `auto` (internal state, no external effect)

### Part B: Portfolio Health Agent

#### Agent definition

A new system agent — the Portfolio Health Agent — that operates at the organisation level using the org-level execution enabled by Phase 1. It is responsible for monitoring the portfolio as a whole, coordinating health scoring runs, detecting anomalies, managing alert delivery, and escalating findings through the HITL gate.

This agent is conditionally loaded. It is not present in every organisation. It is loaded when a configuration template that requires it is applied (Phase 4). This is by design — not every organisation manages a portfolio that needs health monitoring.

#### Agent responsibilities

**Scheduled portfolio scans.** The agent runs on a configurable schedule (default: every 4 hours, configurable per organisation). Each run triggers a health scoring pass across all active subaccounts, compares current scores to historical baselines, and flags any subaccounts that have crossed threshold conditions.

**Anomaly detection coordination.** The agent does not compute anomalies directly — that is delegated to the intelligence skills. The agent is responsible for invoking those skills, receiving their outputs, and deciding what to do with them (log, alert, escalate, act).

**Alert delivery.** When the intelligence skills produce an anomaly event or a health score crosses a threshold, the agent formats and delivers an alert to the configured destination (Slack, email, in-platform notification). Alert formatting and destination are configured per-organisation, not hardcoded.

**HITL gate escalation.** Alerts that require human approval before action (for example, pausing a client campaign, triggering an outreach sequence, generating a client communication) are passed through the existing HITL gate system. The agent surfaces the recommended action, the evidence, and a structured approval request.

**Portfolio report generation.** On a configurable schedule (default: weekly), the agent coordinates the generation of a portfolio-level intelligence briefing and delivers it to the operator.

**Memory and baseline management.** The agent maintains a rolling baseline for each subaccount in org memory — what "normal" looks like for that subaccount's key metrics. Baselines are subaccount-specific and updated continuously. This is what makes anomaly detection meaningful: a 30% drop for a subaccount that normally generates 200 leads/month is different from the same drop for one that generates 10.

**Baseline storage.** Baselines are stored in a dedicated structured table, not in org memory. Org memory is optimised for semantic reasoning; baselines are structured time-series data that needs efficient querying and updating.

```
account_metric_baselines table
├── id (uuid PK)
├── organisation_id (FK)
├── subaccount_id (FK)
├── metric_type         (e.g. "contact_growth", "pipeline_velocity", "conversation_engagement")
├── rolling_avg
├── rolling_median
├── variance
├── window_size_days
├── sample_count
├── last_computed_at
└── created_at
```

The Portfolio Health Agent writes a human-readable summary of baseline state into org memory for reasoning purposes (e.g. "Account X typically generates 150 leads/month with low variance"). The structured table is the source of truth for computation; org memory is the source for agent reasoning.

**Baseline model definition:**
- **Window size:** Configurable per metric type. Default: 30-day rolling window for volume metrics (contacts, conversations), 14-day for velocity metrics (pipeline movement, response times). Operators can override per-organisation.
- **Seasonality handling:** Day-of-week weighting is applied by default (agencies see predictable weekday/weekend patterns). Monthly seasonality is tracked but only applied when 90+ days of data exist.
- **Minimum data threshold:** A baseline is not considered valid until the subaccount has at least 14 days of data for that metric. Before that threshold, anomaly detection is suppressed for that metric and the agent reports "insufficient data" rather than false positives.
- **Adaptive windows:** For subaccounts with high variance, the window auto-expands (up to 60 days) to stabilise the baseline. For low-variance subaccounts, it can contract (down to 7 days) to increase sensitivity. The variance threshold for adaptation is configurable.
- **Recomputation trigger:** Baselines are recomputed on a scheduled batch (default: hourly). They are not recomputed on every event ingestion — that would be expensive and noisy for high-volume accounts. The hourly batch picks up all new events since the last computation.

#### Agent state machine

The Portfolio Health Agent operates as a state machine for observability and debugging:

```
idle → scanning → analysing → alerting → awaiting_hitl → executing → idle
                                    ↓
                                  idle (no alerts needed)
```

| State | Description | Transitions |
|-------|------------|-------------|
| `idle` | Waiting for next scheduled scan or manual trigger | → `scanning` on schedule/trigger |
| `scanning` | Fetching current data from integration layer for all active subaccounts | → `analysing` when data collected |
| `analysing` | Running health scoring, anomaly detection, churn risk skills | → `alerting` if findings exist, → `idle` if none |
| `alerting` | Formatting and delivering alerts to configured destinations | → `awaiting_hitl` if interventions proposed, → `idle` if alerts only |
| `awaiting_hitl` | Intervention proposals submitted to review queue, waiting for operator | → `executing` on approval, → `idle` on rejection/timeout |
| `executing` | Approved interventions being carried out via skills | → `idle` on completion |

State transitions are logged with timestamps for debugging. If the agent is stuck in any non-idle state for longer than a configurable timeout (default: 30 minutes), an operator alert is raised.

**Retry semantics per state:**

| State | On failure | Max retries | Fallback |
|-------|-----------|-------------|----------|
| `scanning` | Retry data fetch with exponential backoff | 3 | → `idle` + operator warning ("scan failed, data may be stale") |
| `analysing` | Retry failed skill invocation | 2 | → `idle` + partial results logged (healthy skills still produce output) |
| `alerting` | Retry delivery to each destination independently | 3 | → `idle` + failed deliveries queued for next cycle |
| `executing` | Retry the approved intervention | 1 | → `idle` + operator alert ("approved intervention failed to execute") |

Failed retries never silently swallow errors. Every exhausted retry produces an operator-visible event with the failure reason.

#### What this agent does NOT do

- Deep analytical reasoning on why a subaccount is struggling — that can be delegated to other agents
- Directly modify external platform data — that goes through the HITL gate and the appropriate skill
- Manage individual subaccount configurations — that is the operator's responsibility
- It monitors. It detects. It alerts. It escalates. Execution is separate.

### Part C: Intelligence skills

The analytical capabilities that the Portfolio Health Agent invokes. These are skills in the existing Automation OS sense: invokable by any agent with the right permissions. Although designed for the Portfolio Health Agent, they are registered in the skill library and can be enabled for other agents.

#### Skill: `compute_health_score`

Accepts normalised metric values for a given subaccount (from the integration layer), weights them according to a configurable scoring model, and returns a composite health score between 0 and 100 with factor breakdown.

**Inputs:** Account entity, recent metric snapshot (contact growth rate, opportunity pipeline velocity, conversation engagement rate, revenue trend, platform activity).
**Outputs:** Composite score, factor breakdown, trend direction (improving/stable/declining), confidence level.

**The generic/configured split:** The skill code implements the scoring algorithm generically — it accepts a weight map and a set of signals and computes a weighted score. The weight map (how much to value lead volume versus pipeline velocity versus conversation engagement) lives in the database as configuration, per-organisation. Same skill code, different configuration.

**Output versioning:** Every HealthSnapshot includes `algorithm_version` (the skill code version) and `config_version` (a hash of the weight map used). This enables before/after comparison when scoring logic or weights change, and regression debugging.

#### Skill: `detect_anomaly`

Compares a current metric snapshot for a subaccount against that subaccount's historical baseline and identifies statistically significant deviations.

**Inputs:** Account identifier, metric name, current value, historical baseline (rolling window stored in org memory), sensitivity configuration.
**Outputs:** Boolean anomaly flag, deviation magnitude, direction (above/below baseline), severity (low/medium/high/critical), natural language description.

**The generic/configured split:** The detection algorithm is generic. The threshold and rolling window size are configured per-organisation. Same skill code, different configuration.

**Output versioning:** Every AnomalyEvent includes `algorithm_version` and `config_version` for the same regression debugging reasons as health scoring.

#### Skill: `compute_churn_risk`

Evaluates behavioural signals for a subaccount and produces a churn risk score.

**Inputs:** Account entity, recent HealthSnapshot history, specific risk signals (declining health trajectory, consecutive missed milestones, platform login inactivity, pipeline stagnation duration).
**Outputs:** Churn risk score (0-100), primary risk drivers, recommended intervention type (early warning / active intervention / urgent escalation), suggested next action.

**Implementation note:** At MVP, this uses a heuristic scoring model — explicit rules with configured weights. The architecture should allow replacement with an ML model later without changing the skill's interface. Build the interface right, ship the heuristic, refine over time.

**The generic/configured split:** Risk signal weights and threshold bands are configured per-organisation.

**Output versioning:** Churn risk outputs include `algorithm_version` and `config_version`, same as the other intelligence skills.

#### Skill: `generate_portfolio_report`

Accepts a portfolio-level dataset and generates a structured intelligence briefing in natural language.

**Inputs:** Full portfolio snapshot (all Account entities with latest HealthSnapshot records), reporting period, operator preferences (verbosity, focus areas, format).
**Outputs:** Formatted briefing covering: overall portfolio health, subaccounts requiring attention, negative trends, positive patterns, and recommended priority actions. Structured for delivery via email, Slack, or in-platform.

**The generic/configured split:** Report structure, language tone, and delivery format are configured per-organisation.

#### Skill: `trigger_account_intervention`

The action skill — the bridge between detection and execution.

**Inputs:** Account identifier, intervention type (check-in sequence, campaign pause, internal alert, account manager notification, client communication draft), supporting evidence, HITL gate reference.
**Outputs:** Intervention record (what was proposed, what was approved, what was executed), audit trail entry.

**Critical design note:** This skill does not execute directly. Every execution path goes through the HITL gate first. The skill submits the intervention proposal and returns a pending status. Only on human approval does execution proceed. This is consistent with the existing platform design and is non-negotiable.

**The generic/configured split:** Available intervention types and their execution logic are configured per-organisation and per-connector. A GHL organisation can pause a GHL campaign. A future HubSpot organisation can archive a deal. Same skill, different connector execution.

### Data isolation

When an org agent reads across subaccounts, data isolation must be maintained:

- `query_subaccount_cohort` returns aggregated summaries, not raw data. Subaccount A's specific records should not appear in the context used for reasoning about Subaccount B.
- Org memory entries (`org_memory_entries`) should contain insights and patterns, not copies of subaccount data. The `source_subaccount_ids` field is for traceability, not for re-querying.
- Health scores and anomaly events are per-subaccount records. The Portfolio Health Agent can see all of them for its organisation, but each is attributed to its source subaccount.

### Gate condition for Phase 4

Phase 3 is complete when:
- Subaccount tags can be created, queried, and used to filter subaccounts
- Org memory entries can be created, queried via semantic search, and deduped
- All three cross-subaccount skills are operational
- All five intelligence skills are operational and passing integration tests against real normalised data
- The Portfolio Health Agent successfully runs a scheduled scan cycle, invokes skills, and produces HealthSnapshot records
- At least one end-to-end flow is demonstrated: a real metric changes, the integration layer detects it, the agent invokes `detect_anomaly`, a HITL gate proposal is generated, approval produces an intervention record
- Skill outputs conform to the formats Phase 4's configuration system will reference

---

## Phase 4: Configuration Template System Extension

### What this phase delivers

An extension to the existing hierarchy template system that makes the full intelligence layer deployable via a single template load operation. A configuration template is a complete, loadable specification for what an organisation needs: which system agents are active, which skills are enabled on each agent, which connector is connected, and what the operational parameters are.

This is the delivery mechanism for everything built in Phases 1-3. Without it, each organisation requires manual setup. With it, a "GHL Agency" configuration can be applied to a new organisation in minutes.

### Building on what exists

The codebase already has a mature template system:

- **System hierarchy templates** (`systemHierarchyTemplates` + `systemHierarchyTemplateSlots`) — platform-level blueprints published by system admin
- **Org hierarchy templates** (`hierarchyTemplates` + `hierarchyTemplateSlots`) — org-level templates that can be cloned from system templates
- **Template versioning** — `appliedTemplateId` + `appliedTemplateVersion` tracked on `subaccountAgents`
- **Template slots** — reference `systemAgentId` or `agentId`, carry full blueprint fields, self-referencing `parentSlotId` for tree structure
- **Paperclip import** — system admin can import templates from manifests
- **`systemTemplateService`** and **`hierarchyTemplateService`** — full CRUD with SHA-256 manifest hashing

What's missing is the ability to include **connector references, skill enablement maps, and operational parameters** in a template. The current template defines the agent roster. The extended template defines the roster plus everything needed to make those agents operational for a specific use case.

### What the extension adds to templates

A configuration template includes the existing team template (agent roster and agent-level configuration) plus:

**Connector specification**
- Which connector type is required (e.g. `ghl`)
- What configuration the operator must provide during activation (OAuth credentials, sub-account mapping)
- The connector is not pre-authenticated — the template specifies the requirement; the operator fulfils it

**Skill enablement map**
- Per-agent skill permissions: which skills are enabled, which are disabled
- This is what makes the Portfolio Health Agent's capabilities activatable via template — the intelligence skills are registered in the platform skill library but only enabled on agents that need them

**Operational parameters**
- Health score weight maps (configurable per template, overridable per organisation)
- Anomaly detection thresholds and sensitivity settings
- Churn risk signal weights and severity bands
- Alert destinations (operator configures Slack/email during activation)
- Scan frequency (default: every 4 hours)
- Report schedule (default: weekly)
- HITL gate requirements per intervention type

**Workspace memory seeds**
- Pre-populated org memory entries that give the agent initial context at activation
- e.g. "This organisation manages a portfolio of client accounts. Monitor for pipeline stagnation, lead volume drops, and conversation engagement decline."

### The GHL Agency Template

The first published configuration template:

- Orchestrator (enabled, standard configuration)
- BA Agent (enabled, intake skills enabled)
- Portfolio Health Agent (enabled — conditional agent, only appears in templates that need it)
- GHL Connector (required — operator must provide OAuth credentials during activation)
- Health scoring weights calibrated for GHL agency dynamics (pipeline velocity weighted highest, followed by conversation engagement, contact growth, platform activity)
- Default anomaly sensitivity settings per metric type
- Default alert destination configuration (operator provides Slack/email during activation)
- Default scan frequency (every 4 hours) and report schedule (weekly, Monday 8am operator timezone)
- Skill enablement: `compute_health_score`, `detect_anomaly`, `compute_churn_risk`, `generate_portfolio_report` enabled on Portfolio Health Agent; `trigger_account_intervention` enabled with explicit HITL approval on all paths

### Template dependency validation

Before a template is applied, a preflight check validates that all dependencies are satisfiable:

- **Connector exists.** The specified connector type is registered in the adapter registry.
- **Required skills exist.** Every skill referenced in the skill enablement map is registered in the skill library.
- **Config schema valid.** Operational parameters conform to the expected schema (correct types, required fields present, values within allowed ranges).
- **Dry-run mode.** The template load operation supports a `dryRun: true` flag that runs all preflight checks and returns a validation report without making any changes. This is surfaced in the UI as a "Preview" step before activation.

If any preflight check fails, the template load is rejected with a structured error listing every failure. Partial application is never allowed.

### Loading a template into an organisation

When a template is applied, the system must:

1. Provision the specified system agents into the organisation (creating agent records, not duplicating code)
2. Apply the skill enablement map to each agent
3. Create the connector config record and prompt the operator to complete authentication
4. Write the operational parameters to the organisation's configuration store
5. Seed the org memory with template-defined initial context
6. If org-level execution is enabled (Phase 1), configure the org agent execution configs
7. Schedule the Portfolio Health Agent's first scan cycle via pg-boss
8. Confirm activation to the operator with a summary of what was provisioned

The operator provides: OAuth credentials, alert destinations (Slack webhook URL, email address). The system handles everything else.

### Operator customisation after template load

A template is a starting point, not a constraint. After loading, operators can:

- Adjust health score weights for their portfolio
- Change anomaly sensitivity thresholds globally or per subaccount
- Modify scan frequency and report schedule
- Add or remove alert destinations
- Enable or disable specific skills
- Adjust HITL gate behaviour (which interventions require approval)

All customisation is through configuration — database values, not code changes.

### Template versioning

When a template is updated at the system admin level, existing organisations that loaded an older version are not automatically updated. The admin can push an update notification to affected organisations, and operators can choose to apply the update with a preview of what changes. This prevents silent regressions in live organisations.

The existing `appliedTemplateVersion` tracking on `subaccountAgents` provides the foundation. The extension applies the same pattern to org-level agent configs and operational parameters.

### Config version linkage

The `config_version` referenced in intelligence skill outputs (Phase 3) must be traceable back to its source. The config version is a SHA-256 hash computed from:

- The `appliedTemplateVersion` (which template was loaded)
- Any operator overrides applied after template load (weight maps, thresholds, sensitivity settings)
- The active connector config version

This hash is stored on the organisation's config record and recomputed whenever any input changes. Intelligence outputs reference this hash, creating a complete chain: template version → operator overrides → config hash → skill output. This enables: reproducing any past computation, auditing when and why outputs shifted, and debugging regressions after config changes.

---

## Phase 5: Org-Level Workspace

### What this phase delivers

A workspace at the organisation level for work that doesn't belong to any single subaccount. Same capabilities as subaccount workspaces — board, tasks, scheduling, triggers, connections — but scoped to the organisation.

This phase is independent of the intelligence layer (Phases 2-4) and can be built based on demand. It is included in this spec because org-level agents (Phase 1) will naturally want to create tasks, manage work, and respond to events at the org level.

### Schema changes

| Table | Change |
|-------|--------|
| `tasks` | `subaccountId` becomes nullable — org-level tasks have `subaccountId = NULL` |
| `scheduled_tasks` | `subaccountId` becomes nullable |
| `agent_triggers` | `subaccountId` and `subaccountAgentId` become nullable; new org-level trigger support |
| `integration_connections` | Support org-level connections (nullable `subaccountId`) for org agents that need OAuth access |

### Org-level board

- The `boardConfigs` table already supports nullable `subaccountId` — org-level board config exists
- Tasks with `subaccountId = NULL` appear on the org board
- UI: new org-level board page or a mode on the existing board
- Org-level agents can create, move, and update tasks on the org board using existing task skills

### Org-level scheduled tasks

- `scheduled_tasks` with `subaccountId = NULL` are org-level recurring tasks
- Assigned to org-level agents
- Managed via new org-level scheduled tasks routes and UI

### Org-level triggers

- `agent_triggers` with `subaccountId = NULL` fire on org-level events
- Event types: `org_task_created`, `org_task_moved`, `org_agent_completed`
- The trigger fires an org-level agent run (using Phase 1 execution)

### Org-level connections

- OAuth connections at the org level, available to org agents
- This enables org agents to send emails, post to Slack, etc. without borrowing a subaccount's connection
- Same `integrationConnections` table with nullable `subaccountId`

### Cross-boundary writes

One key capability: **an org-level agent should be able to create a task on a subaccount's board.** If the Portfolio Health Agent detects an issue with a subaccount, it should be able to create an alert task on that subaccount's board — not just on its own org board.

This requires the task-creation skills to accept an optional `targetSubaccountId` parameter when called from an org-level context. The skill validates that the target subaccount belongs to the same organisation before creating the task.

This capability should be HITL-gated when writing to a subaccount board from an org context.

### Cross-boundary permission model

HITL gating is the user-facing safety layer. Below it, there is a mandatory programmatic validation layer for all cross-boundary actions:

- **Target validation.** Any skill invoked from an org-level context with a `targetSubaccountId` must validate that the target subaccount belongs to the same organisation. This is a hard check in the skill execution layer, not delegated to individual skill implementations.
- **Allowed subaccounts list.** Org agent configs include an optional `allowedSubaccountIds` field. When populated, the org agent can only target those subaccounts. When null, all subaccounts in the org are valid targets. This allows operators to restrict org agent scope (e.g. "only monitor premium-tier clients").
- **Audit enrichment.** Every cross-boundary action logged in the `actions` table includes `source_agent_id`, `source_context` (org vs subaccount), and `reasoning_summary` (a one-line explanation from the agent of why this action was taken). This is required for debugging and operator trust.

### Gate condition

Phase 5 is complete when:
- Org-level tasks can be created, moved, and updated on an org board
- Org-level scheduled tasks fire correctly
- Org-level triggers fire on org events
- Org-level connections can be created and used by org agents
- Cross-boundary task creation (org agent creating a task on a subaccount board) works with HITL gate

---

## What to Build vs What to Configure (Consolidated)

### Build (generic — lives in code, applies to every organisation)

- Org-level agent execution pipeline (Phase 1)
- Org agent config mechanism (Phase 1)
- Extended connector interface with ingestion methods (Phase 2)
- GHL connector implementation (Phase 2)
- Rate limiter, webhook endpoint, scheduled polling (Phase 2)
- Canonical schema entity types (Phase 2)
- Subaccount tags infrastructure (Phase 3)
- Org-level memory table and service (Phase 3)
- Cross-subaccount query skills (Phase 3)
- Portfolio Health Agent scheduling/coordination logic (Phase 3)
- All five intelligence skills — scoring algorithms, detection, reporting (Phase 3)
- Configuration template schema extension and load operation (Phase 4)
- Template versioning (Phase 4)
- Org-level board, tasks, triggers, connections (Phase 5)

### Configure (specific — lives in database, different per organisation or template)

- Health score weight maps
- Anomaly thresholds and sensitivity settings
- Churn risk signal weights and severity bands
- Alert destinations (Slack, email)
- Scan frequency and report schedule
- HITL gate requirements per intervention type
- OAuth credentials per organisation
- Sub-account mappings (external IDs to internal subaccounts)
- Subaccount tags (user-defined dimensions)
- Workspace memory seeds
- Report format and verbosity preferences
- Which connector type to use
- Skill enablement per agent per organisation

---

## Principles for Implementation

These are decision criteria, not implementation instructions.

**Phase 1 is the hidden prerequisite.** The original AIL brief assumed agents could run at org level. They can't. This is the highest-risk foundational work and must be solid before anything else proceeds.

**The integration layer boundary is critical.** The canonical schema must be right enough that agents consuming it are platform-agnostic. If GHL concepts leak into the agent layer, the abstraction has failed and the second connector will be expensive. Validate the schema boundary explicitly before Phase 3.

**Configuration over code.** If a decision requires a code change to alter behaviour for a specific organisation, that decision has been put in the wrong place.

**The HITL gate is not optional for execution.** Any skill path that modifies external platform data or initiates external communication must go through the gate. Non-negotiable.

**Baselines are subaccount-specific.** The anomaly detection skill must compare each subaccount to its own history, not to a portfolio average. Different subaccounts have different normal states.

**The GHL connector is v1, not the canonical schema.** Design entity types to be as platform-agnostic as possible. Annotate GHL-specific fields as candidates for refactoring when connector 2 arrives.

**Fail loudly on integration errors.** When a connector cannot fetch data, surface this to the operator rather than silently skipping. A missed scan is as dangerous as a detected anomaly.

**Data isolation between subaccounts.** Org agents reading across subaccounts must not leak one subaccount's raw data into another's context. Cross-subaccount skills return aggregated summaries, not raw records.

---

## Out of Scope

The following are explicitly deferred:

- A second connector implementation (HubSpot, Shopify, Stripe). The architecture must support them; the code must not be written yet.
- ML-based churn prediction models. Heuristic first. Architecture supports model replacement; model itself deferred.
- Client-facing portals exposing health scores to end clients. This brief covers the operator-facing intelligence layer only.
- Billing or pricing logic tied to connector usage or sub-account count.
- Multi-connector organisations (one connector per organisation at MVP).
- Org-level agent conversations/chat UI (the `AgentChatPage` pattern at org level). Can be added later.

---

## Success Criteria

The feature is complete when:

1. A new organisation can be provisioned by applying the GHL Agency Configuration Template
2. The operator provides GHL OAuth credentials and a Slack webhook URL
3. Within one scan cycle, all sub-accounts are enumerated and have initial health scores
4. Within one week, the operator receives their first portfolio intelligence briefing without having logged into any individual GHL sub-account
5. When a real anomaly occurs in a sub-account, the operator receives a push alert and a HITL gate proposal
6. All of this happens without any action beyond the initial template activation
7. The entire system works through generic infrastructure — replacing GHL with a different connector would require only a new connector implementation and a new configuration template, not changes to agents, skills, or the intelligence layer
