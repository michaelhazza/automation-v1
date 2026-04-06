# Automation OS — Org-Level Agents & Cross-Subaccount Intelligence
## Combined Development Specification v2.0

**Date:** 2026-04-06 (v2.0 — replaces v1.0 dated 2026-04-02)
**Brief type:** Product and architecture — not a line-level technical specification. Claude Code will derive implementation specifics from the codebase directly.
**Scope:** Five sequenced phases with explicit gate conditions between them.
**Primary design principle:** Generic infrastructure, configured behaviour. Every feature built in this spec must be usable by any future integration or vertical. The first deployment targets GHL agencies, but the platform code must contain zero knowledge of GHL, CRM workflows, or agency-specific concepts.

---

## Context and Purpose

Automation OS is a multi-tenant platform where organisations manage work across multiple subaccounts using AI agents. Subaccounts are a generic concept — they represent whatever the organisation needs: clients, projects, departments, properties, portfolios, stores, tenants, or any other operational unit. The platform doesn't prescribe what a subaccount is.

Today, every agent run is scoped to a single subaccount. There is no mechanism for an agent to operate at the organisation level, monitor across subaccounts, detect cross-subaccount patterns, or take action at the portfolio level. This is a structural limitation that prevents the platform from functioning as a true operating system.

The platform must support any vertical where an organisation manages multiple operational units and wants AI-driven monitoring, health scoring, anomaly detection, and proactive intervention. Example verticals include:

- **Agency CRM** (e.g. GHL, HubSpot) — agencies monitoring client accounts for pipeline health, conversation engagement, and churn risk
- **E-commerce** (e.g. Shopify) — operators monitoring stores for order volume trends, cart abandonment, and inventory issues
- **Property management** — firms monitoring properties for occupancy rates, maintenance response times, and rent collection
- **SaaS operations** — companies monitoring product accounts for feature adoption, support ticket volume, and renewal risk

The first deployment targets GHL agencies managing 20-100+ client sub-accounts. Market research confirms this gap is real, unoccupied, and currently costs agencies $1,000-2,350/month in fragmented partial solutions. However, the platform infrastructure must be vertical-agnostic. GHL is the first configuration, not the defining architecture.

This spec describes how to extend the platform to support org-level agent execution, ingest external platform data through a generic integration layer, and deliver cross-subaccount intelligence — all as generic platform capabilities that are configured per-organisation, not coded per-use-case.

---

## Core Architectural Principle

**The platform is generic. The configuration is the product.**

This means:

- Agents, skills, and the integration layer are written with no knowledge of which industry, which platform, or which use case they are serving. They operate on normalised data and respond to configuration injected at runtime.
- Everything specific to a deployment — which data to fetch, which metrics to compute, how to weight a health score, what threshold triggers an alert, which agents to load, which skills to enable — lives in the database as configuration, not in code.
- A configuration template is the unit of deployment. Loading a configuration template into an organisation provisions the correct agents, enables the correct skills on each agent, connects the correct integration, and defines the metric and scoring configuration. The code does not change. Only the data does.

The practical test for every implementation decision: **"If we replaced the current connector with a completely different vertical (e.g. swapped a CRM connector for an e-commerce connector), would any platform code need to change?"** If the answer is yes, the wrong thing has been made generic. The only things that should change are: the adapter implementation (~300 lines) and the configuration template (database rows).

**The abstraction boundary:** Adapters are the only code that knows about external platforms. Everything above the adapter layer — intelligence skills, the health scoring pipeline, anomaly detection, churn risk, the Portfolio Health Agent, the template system, the UI — operates on generic abstractions: accounts, metrics, health snapshots, anomaly events. These abstractions are populated by adapters and configured by templates.

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
| Adapter pattern | `server/adapters/` with `IntegrationAdapter` interface, GHL + Stripe + Slack + Teamwork implementations |
| OAuth token lifecycle | `integrationConnectionService` with advisory-lock refresh, AES-256-GCM encryption — production-ready |
| Integration connections | Per-subaccount stored credentials for `gmail`, `github`, `hubspot`, `slack`, `ghl`, `stripe`, `teamwork`, `custom` |
| MCP client ecosystem | `mcpClientManager` with 9 presets (Gmail, Slack, HubSpot, GitHub, Brave, Stripe, Notion, Jira, Linear) — auto-discovers tools from external servers |
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
  without this.

Phase 2 — Integration Layer + Canonical Data + Metrics
  The data foundation. Extends the existing adapter pattern into a full
  integration layer with canonical schema, data ingestion, webhook
  handling, scheduled polling, and a universal canonical_metrics table.
  Adapters ingest raw entities AND compute derived metrics. Intelligence
  skills consume metrics, never raw entities or API responses. Can
  overlap with Phase 1 since it is a different subsystem.

Phase 3 — Cross-Subaccount Intelligence + Portfolio Health Agent
  The core value. Combines generic cross-subaccount capabilities
  (subaccount tags, org memory, cohort query skills) with the Portfolio
  Health Agent and its config-driven intelligence skills (health scoring,
  anomaly detection, churn risk, reporting, HITL-gated intervention).
  All intelligence skills read metric definitions from the org's
  template configuration — no hardcoded factors, signals, or
  intervention types.

Phase 4 — Configuration Template System Extension
  The deployment mechanism. Extends the existing hierarchy template
  system to include connector references, skill enablement maps,
  metric definitions, health score factor configurations, churn risk
  signal definitions, intervention type mappings, and operational
  parameters. The first published template targets GHL agencies.
  Loading a template provisions everything — agents, skills, connector,
  metrics, scoring, and alerting.

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

**Run context snapshot.** At run start, the resolved configuration is frozen into `configSnapshot` on the `agent_runs` record. This includes the effective limits, skill slugs, and any org-specific overrides. A `configHash` (SHA-256 of the snapshot) is stored alongside it. The snapshot also includes human-readable version metadata: `configVersion`, `templateVersion`, and `agentVersion`. The hash is for machine comparison; the versions are for human debugging.

**Config drift detection.** If the underlying config changes while a long-running org agent is mid-execution, the run continues using the snapshotted config. At run completion, the system compares the current config hash against the snapshotted `configHash`. If they differ, the run is flagged with `configDriftDetected: true`.

**Partial run handling.** Org-level runs may process multiple accounts in a single run. If some accounts succeed and others fail, the `resultStatus` field captures three states: `'success'` (all work completed), `'partial'` (some failed — details in run output), `'failed'` (no meaningful work completed).

**Partial run output contract.** When `resultStatus` is `'partial'` or `'failed'`, the run output must include:

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

**Failure reason classification.** The `reason` field uses a standardised enum: `connector_timeout`, `rate_limited`, `auth_error`, `data_incomplete`, `internal_error`, `unknown`. The `retryable` flag is derived from the reason, not set manually. `unknown` is high-severity and produces an operator-visible log entry.

**`actionScope` on actions.** An explicit `actionScope` column is included in all idempotency checks to prevent cross-scope dedupe bugs. Partial unique index: `UNIQUE (organisation_id, idempotency_key) WHERE action_scope = 'org'`.

### Org agent execution config

New `orgAgentConfigs` table — mirrors the relevant fields from `subaccountAgents`, keyed to `(organisationId, agentId)`. Clean separation of agent definition from deployment config, mirroring the existing `subaccountAgents` pattern.

### Execution service changes

`agentExecutionService.executeRun()` changes:

1. **Make `subaccountId` and `subaccountAgentId` optional** on `AgentRunRequest`
2. **Set `executionMode` explicitly** — the caller specifies `'subaccount'` or `'org'` at run creation. Never infer from nullable fields.
3. **Validate executionMode consistency** — hard validation: `org` mode requires null subaccountId, `subaccount` mode requires present subaccountId.
4. **Snapshot config at run start** — freeze resolved config into `configSnapshot`
5. **Load config from the right source** — `'subaccount'` → `subaccountAgents`, `'org'` → `orgAgentConfigs`
6. **Skip subaccount-specific context gracefully:**
   - `buildTeamRoster()` — use org-level agent list instead
   - `workspaceMemoryService.getMemoryForPrompt()` — skip or load org memory (Phase 3)
   - `buildSmartBoardContext()` — skip or load org board (Phase 5)
   - `devContextService.getContext()` — skip
   - `checkWorkspaceLimits()` — skip subaccount limits; org + global still apply
7. **Post-run extraction** — skip `extractRunInsights()` until org memory exists (Phase 3)
8. **Post-run triggers** — skip `triggerService.checkAndFire()` until org triggers exist (Phase 5)
9. **Langfuse trace** — use `organisationId` for attribution

### Org-level heartbeat scheduling

- Schedule name format: `agent-org-scheduled-run:${agentId}`
- Job payload: `{ agentId, organisationId }` (no subaccountAgentId or subaccountId)
- `registerAllActiveSchedules()` must query both `subaccountAgents` and `orgAgentConfigs`
- Heartbeat config fields live on the org agent config

### WebSocket emission

- `emitAgentRunUpdate(run.id, ...)` — already org-scoped via run-specific room
- Replace `emitSubaccountUpdate()` with `emitOrgUpdate()` for org-level runs

### Org-level review queue

- `GET /api/org/review-queue` — review items where `subaccountId IS NULL`
- `GET /api/org/review-queue/count` — pending count for badge
- Existing approve/reject routes already work without subaccount context
- UI: org-level review queue page or tab on existing review queue

### Skill execution context

`SkillExecutionContext.subaccountId` becomes optional (`string | null`). Skills requiring subaccount context check for presence and return a clear error if called from org-level context without a target subaccount.

### Org vs subaccount authority rules

These rules are cross-cutting and enforced from Phase 1:

- **Org agents cannot mutate subaccount state** unless: (a) `orgAgentConfig.allowedSubaccountIds` includes the target, AND (b) the action explicitly specifies the target. Cross-boundary writes are always HITL-gated.
- **Subaccount agents cannot read org memory.** Org memory is only accessible from org-level context.
- **Subaccount agents cannot read other subaccounts' canonical data.** All canonical queries are scoped to the current subaccount in subaccount mode.
- **Org agents can read all canonical data for their organisation.**
- **Execution mode is authoritative.** No blending of authority rules.

**Authority violation logging.** Every violation logs `agentId`, `executionMode`, `attemptedScope`, `targetId`, and rejection reason. Surfaced in operator logs.

### Retry boundary policy

- **Safe to retry (idempotent):** connector polling, webhook ingestion, canonical data reads, health scoring, baseline recomputation.
- **Not safe to retry:** agent execution runs, intervention execution, alert delivery.

The retry boundary is enforced at the service layer. `agentExecutionService.executeRun()` does not retry — if a run fails, a new run is created.

### Org-level execution kill switch

`orgExecutionEnabled` flag at the organisation level. When `false`, all org-level runs are rejected.

- **New runs:** Checked before config loading. Returns clear error.
- **Scheduled runs:** pg-boss worker checks before executing. Disabled jobs are silently dropped with operator-visible log.
- **Audit trail:** Every toggle logged with actor, timestamp, reason.

### What this phase does NOT include

- Org-level memory (Phase 3)
- Org-level board or tasks (Phase 5)
- Org-level triggers (Phase 5)
- Org-level connections (Phase 5)
- Cross-subaccount reading (Phase 3)
- Any intelligence capabilities (Phase 3)

### Gate condition for Phase 2

Phase 1 is complete when:
- An agent can be configured at the org level with execution config
- An org-level agent run can be triggered manually and completes successfully
- The org-level heartbeat schedule fires and produces a run
- A HITL-gated action from an org agent appears in the org review queue and can be approved
- No existing subaccount agent flows are affected (zero regression)

---

## Phase 2: Integration Layer + Canonical Data + Metrics

### What this phase delivers

A platform-level service that connects to external platforms, ingests their data, normalises it to a canonical schema, computes derived metrics, and makes both the normalised data and computed metrics available to agents and skills through a clean internal interface. Agents and skills never call external APIs directly. They consume normalised entities and metrics from this layer.

This phase also delivers the first full implementation: the GHL connector, extending the existing `server/adapters/ghlAdapter.ts` pattern into a complete data ingestion system.

### Building on what exists

The codebase already has:
- **Adapter interface** (`server/adapters/integrationAdapter.ts`) — defines `IntegrationAdapter` with `crm`, `payments`, `ingestion`, and `webhook` namespaces
- **GHL adapter** (`server/adapters/ghlAdapter.ts`) — `crm.createContact` implemented with OAuth token handling, `listAccounts()` method exists
- **Slack adapter** (`server/adapters/slackAdapter.ts`) — send messages, list channels, webhook events
- **Teamwork adapter** (`server/adapters/teamworkAdapter.ts`) — ticket CRUD, replies, webhook events
- **Stripe adapter** (`server/adapters/stripeAdapter.ts`) — payments implemented
- **OAuth lifecycle** (`integrationConnectionService.ts`) — advisory-lock token refresh, AES-256-GCM encryption
- **Adapter registry** (`server/adapters/index.ts`) — `Record<string, IntegrationAdapter>` keyed by provider name
- **Connector polling** (`connectorPollingService.ts`) — polling with sync phase state machine
- **Canonical data service** (`canonicalDataService.ts`) — query methods and upsert helpers

What's missing is: complete GHL ingestion methods (pagination + normalisation for all entity types), webhook event normalisation, the `canonical_metrics` table that sits between raw entity data and the intelligence layer, and the adapter metric computation step.

### Why a platform layer and not skills

Skills are agent-invoked, synchronous, and stateless. They are not suited to managing OAuth sessions across polling cycles, enforcing rate limits across a shared quota, ingesting webhook streams, or computing derived metrics on schedule. The integration layer handles this complexity centrally.

### The canonical schema

The canonical schema has two tiers:

1. **Raw entity tables** — normalised records from external platforms (contacts, opportunities, conversations, revenue, accounts). These serve as the data warehouse — useful for display, querying, and agent context.
2. **`canonical_metrics` table** — derived, named metrics computed by each adapter from the raw entities. This is the universal abstraction that the intelligence layer consumes.

**Why two tiers?** Raw entities are useful for browsing ("show me this client's contacts") but they are vertical-specific in structure. A CRM has "opportunities with pipeline stages" — an e-commerce platform has "orders with fulfilment status." The intelligence layer should not read raw entities directly because that creates vertical-specific scoring logic. Instead, each adapter computes named metrics from whatever raw data it has, and the intelligence layer reads only from `canonical_metrics`.

#### Entity identity and uniqueness

Every entity from an external platform is identified by:
- `external_id` — the ID in the source system
- `source_connector` — which connector type produced it
- `source_account_id` — which external account it belongs to

This composite key is the global identity for deduplication and updates.

#### State vs event separation

- **State tables** hold the latest known state. Upserted on every sync.
- **Event tables** record discrete changes over time. Append-only. These power baseline computation and trend analysis.

#### Upsert and ordering rules

- **Last-write-wins with timestamp ordering.** An incoming record only overwrites stored state if its `source_updated_at` is newer.
- **Soft delete handling.** Entities deleted in the source are marked with `deleted_at`. All queries filter on `deleted_at IS NULL` by default.

#### Event enrichment fields

Every event table entry includes:
- `event_group_id` (required, auto-generated if not provided) — groups related events from the same real-world change. **Group boundary rules:** new group starts when event type differs or change direction reverses within a 5-second window. **Max group size:** 20 events (configurable).
- `event_source_type` — `webhook`, `poll`, or `derived`
- `event_ingested_at` — when the platform received the event

#### Data freshness metadata

Every state table includes:
- `last_synced_at` — when last written by the ingestion layer
- `source_updated_at` — the last-modified timestamp from the external platform
- `sync_source` — whether last update came from `webhook` or `poll`

#### Raw entity types (Tier 1)

The schema defines at minimum:

**Account** — one subaccount mapped to an external platform account. The central entity everything else hangs off.

**Contact** — a person or entity record within an account.

**Opportunity** — a deal, order, pipeline item, or transactional entity within an account. The semantics depend on the vertical: for CRMs this is a sales deal; for e-commerce this could be an order; for property management this could be a lease. The field set is generic (name, stage, value, status, stage history).

**Conversation** — a communication thread, support ticket, or interaction record.

**Revenue** — a transaction, payment, or recurring revenue record.

**HealthSnapshot** — a point-in-time computed health summary. Written by the platform (Phase 3), not ingested. Includes `algorithm_version` and `config_version`.

**AnomalyEvent** — a detected deviation from baseline. Written by intelligence skills (Phase 3). Not ingested. Includes `algorithm_version` and `config_version`.

The raw entity schema is v1. It will be extended when new connectors are built. The key principle: agents consuming data operate through the metrics layer, not directly on raw entities.

#### Canonical Metrics (Tier 2) — NEW in v2.0

The `canonical_metrics` table is the universal abstraction between adapters and the intelligence layer. Every adapter, after syncing raw entities, computes derived metrics and writes them here. Intelligence skills read only from this table — never from raw entities directly.

```
canonical_metrics table
├── id (uuid PK)
├── organisation_id (FK)
├── account_id (FK → canonical_accounts)
├── metric_slug       (text NOT NULL — e.g. "contact_growth_rate", "order_volume_trend")
├── current_value     (numeric NOT NULL)
├── previous_value    (numeric, nullable — value from prior computation period)
├── period_start      (timestamptz — start of computation window)
├── period_end        (timestamptz — end of computation window)
├── unit              (text, nullable — e.g. "percent", "count", "currency", "seconds")
├── computed_at       (timestamptz NOT NULL)
├── connector_type    (text NOT NULL — which adapter computed this)
├── metadata          (jsonb, nullable — adapter-specific context)
└── created_at

Unique: (account_id, metric_slug)
Index: (organisation_id, metric_slug)
Index: (account_id, computed_at DESC) — for baseline history
```

**Design principles:**
- **Metric slugs are adapter-defined, not platform-defined.** There is no enum of allowed metrics. Each adapter writes whatever metrics it can compute from its raw data. A CRM adapter writes `contact_growth_rate`, `pipeline_velocity`, `conversation_engagement`. A Shopify adapter writes `order_volume_trend`, `cart_abandonment_rate`, `customer_ltv`. The platform doesn't need to know the difference.
- **Templates declare which metrics to score.** The configuration template (Phase 4) lists the metric slugs that feed into health scoring, anomaly detection, and churn risk for that vertical. If a metric slug doesn't exist in the data, the scoring pipeline skips it with a data-missing warning.
- **History for baselines.** The `canonical_metrics` table is upserted on each computation (unique on `account_id, metric_slug`). A companion `canonical_metric_history` table (append-only) stores every computed value for baseline and trend analysis.

```
canonical_metric_history table
├── id (uuid PK)
├── organisation_id (FK)
├── account_id (FK → canonical_accounts)
├── metric_slug       (text NOT NULL)
├── value             (numeric NOT NULL)
├── period_start      (timestamptz)
├── period_end        (timestamptz)
├── computed_at       (timestamptz NOT NULL)
└── created_at

Index: (account_id, metric_slug, computed_at DESC) — for baseline queries
```

**Adapter metric computation step.** After each polling cycle or webhook batch, the adapter:
1. Syncs raw entities to canonical entity tables (existing flow)
2. Computes derived metrics from the synced data
3. Upserts to `canonical_metrics` (current values)
4. Appends to `canonical_metric_history` (historical record)

This step is part of the adapter's responsibility, not a separate service. Each adapter knows what metrics it can compute from its data. The platform provides the table; the adapter provides the values.

**Example metrics by adapter type:**

| Adapter | Example metric slugs |
|---------|---------------------|
| CRM (GHL, HubSpot) | `contact_growth_rate`, `pipeline_velocity`, `stale_deal_ratio`, `conversation_engagement`, `avg_response_time`, `revenue_trend` |
| E-commerce (Shopify) | `order_volume_trend`, `cart_abandonment_rate`, `avg_order_value`, `customer_ltv`, `return_rate`, `inventory_turnover` |
| Property Management | `occupancy_rate`, `maintenance_response_time`, `rent_collection_rate`, `lease_renewal_rate`, `tenant_satisfaction` |
| SaaS | `mrr_trend`, `churn_rate`, `feature_adoption_rate`, `support_ticket_volume`, `nps_score` |
| Helpdesk (Teamwork) | `ticket_volume_trend`, `avg_resolution_time`, `sla_compliance_rate`, `customer_satisfaction`, `backlog_size` |

None of these slugs exist in platform code. They exist only in adapter implementations and template configurations.

### The connector interface

The existing `IntegrationAdapter` interface defines outbound actions and ingestion methods. Every connector must implement:

- Fetch all accounts for an organisation (the sub-account/location list)
- Fetch raw entities for a given account (contacts, opportunities, conversations, revenue — whichever apply)
- Compute derived metrics from raw data and write to `canonical_metrics`
- Validate credentials for a given connector config
- Handle incoming webhook events and normalise them to internal event types

The adapter pattern separates concerns cleanly:
- **Outbound actions** (existing) — `crm.createContact`, `payments.createCheckout`, etc.
- **Ingestion** (Phase 2) — fetch, normalise, upsert raw entities
- **Metric computation** (Phase 2, new) — derive named metrics from raw entities, write to `canonical_metrics`
- **Webhook handling** (Phase 2) — verify signatures, normalise events

All four share the same credential store and OAuth lifecycle.

### The first connector: GHL (implementation detail, not platform architecture)

The GHL connector extends the existing `ghlAdapter.ts`. This section describes GHL-specific implementation — none of this is in generic platform code.

**Sub-account enumeration.** Enumerates all GHL locations and maps to internal subaccounts. Mapping stored in connector config.

**Data ingestion.** Fetches contacts, opportunities (deals), conversations, and revenue (payments) per location. Normalises to canonical entities.

**Metric computation.** After syncing raw entities, computes and writes:
- `contact_growth_rate` — 30-day vs prior 30-day contact creation comparison
- `pipeline_velocity` — ratio of stale deals (>14 days in stage) to open deals
- `conversation_engagement` — ratio of active to total conversations
- `avg_response_time` — average response time across conversations
- `revenue_trend` — current period vs prior period revenue
- `platform_activity` — sync freshness score

These metric slugs are defined in the GHL adapter code and referenced in the GHL Agency Template (Phase 4). They do not exist anywhere in the platform layer.

**Rate limit management.** GHL allows 100 requests per 10 seconds and 200,000 per day per location. The connector implements a token-bucket rate limiter.

**Webhook ingestion.** Receives GHL webhook events, validates HMAC-SHA256 signatures, and normalises to internal event types. Key events: ContactCreate, OpportunityStageUpdate, ConversationCreated, ConversationInactive, AppointmentBooked. After normalising, triggers metric recomputation for the affected account.

**Scheduled polling.** Polling frequency configurable per-organisation via `connector_configs.pollIntervalMinutes`.

### Ingestion consistency model

Webhooks and polling serve different purposes and must be reconciled:

- **Webhooks = near real-time events.** Deliver changes as they happen but can be missed.
- **Polling = source of truth reconciliation.** Periodically fetches full current state and reconciles.

**Idempotency.** Every ingested event carries an idempotency key: `(source_connector, external_id, event_type, source_timestamp)`. Duplicates silently dropped.

**Event sequencing.** `source_updated_at` determines which update is authoritative. Fallback to arrival order.

**Reconciliation job.** Scheduled job (default: daily) compares stored state against source. Detects missing entities, stale data, and unsynced deletions. Drift report per account. Significant drift triggers operator warning.

**Reconciliation authority:** Polling always wins for state. Webhooks are advisory. Repairs logged with before/after values. Max repair scope: 30% of records per account per run (configurable safety cap). Exceeding halts repair + alerts operator.

**Last seen cursor.** Tracks `last_seen_cursor` per entity type per account. Polling resumes from cursor.

### Initial backfill strategy

1. **Staged ingestion.** Batched, rate-limit-respecting historical fetch.
2. **Priority order.** Accounts first, then raw entities, then metric computation.
3. **Backfill flag.** Entities tagged `is_backfill: true`. Intelligence layer ignores backfill data for baselines.
4. **Completion signal.** `backfill_complete` event per account. Portfolio Health Agent waits for this before first scoring.
5. **Webhook queueing.** Webhooks during backfill are queued (not dropped), replayed in order after backfill completes. Per-entity ordering by `source_timestamp`.
6. **Replay deduplication.** Replayed webhooks checked against existing idempotency keys. Duplicates skipped.

**Sync phase state machine:** `backfill` → `transition` (queued webhooks replaying) → `live` (normal operation). Explicit state field on `connector_configs`.

### Connector configuration

Each connected organisation has one or more `connector_config` records storing:

- Connector type (which adapter to use)
- Authentication credentials reference (via `integrationConnections`)
- Account mapping (external IDs → internal subaccounts)
- Polling schedule
- Sync phase and status
- `configVersion` — SHA-256 hash, recomputed on config change, referenced by intelligence outputs

### Data confidence layer

The canonical data service exposes confidence metadata alongside query results:

- **`dataFreshnessScore`** (0.0–1.0) — derived from `last_synced_at` vs expected polling interval. Decays linearly.
- **`dataCompletenessScore`** (0.0–1.0) — derived from reconciliation drift reports.

**Confidence propagation.** When a skill consumes multiple data sources, output confidence = `MIN(all contributing confidences)`. Conservative default for v1.

**Confidence floor.** Below 0.3 = unreliable. May display with warning, must not drive automated decisions.

**No-data vs zero-data.** Every query returns `dataStatus`: `'fresh'` | `'stale'` | `'missing'`. Missing data is excluded from scoring (not treated as zero). Skills must surface which accounts have missing data.

**Hard staleness cutoff.** If `last_synced_at` exceeds 2x polling interval, data marked `stale` with `staleness_warning`.

### Connector health state

Derived `healthStatus` per connector: `'healthy'` | `'degraded'` | `'failed'`.

| Health state | Behaviour |
|-------------|-----------|
| `healthy` | Normal operation. All scoring proceeds. |
| `degraded` | Confidence scores reduced proportionally. Operator warning. |
| `failed` | Health scoring suppressed. Anomaly detection suspended. Accounts flagged as data missing. Operator alert. |

Enforced at `canonicalDataService` layer. Skills receive `connectorHealthStatus` and handle accordingly.

### Query scope guards

- Max accounts per query: 100 (configurable)
- Max time range: 90 days (configurable)
- Max rows per entity type: 10,000 (configurable, truncate with warning)

### Sync event audit log

- Sync events: every polling cycle start/completion with entity counts and duration
- Webhook events: every webhook with normalisation outcome
- Reconciliation repairs: before/after values
- Connector state transitions: every `syncPhase` change
- Metric computation events: which metrics computed per account per cycle

### What to build vs what to configure (Phase 2)

**Build (generic platform code):**
- Extended connector interface with ingestion + metric computation methods
- `canonical_metrics` and `canonical_metric_history` tables
- Rate limiter service
- Webhook endpoint pattern and event normalisation framework
- Canonical schema entity tables
- Scheduled polling via pg-boss
- Data confidence layer
- Connector health state computation

**Build (adapter-specific, not platform):**
- GHL adapter ingestion methods (fetch contacts, opportunities, conversations, revenue)
- GHL adapter metric computation (compute named metrics from raw entities)
- GHL webhook event normalisation
- GHL rate limit configuration

**Configure (per-organisation):**
- Which connector type to use
- OAuth credentials
- Account mapping (external IDs → subaccounts)
- Polling frequency
- Which webhook events to process

### Gate condition for Phase 3

Phase 2 is complete when:
- A connector can enumerate accounts and produce normalised entities
- The adapter computes derived metrics and writes to `canonical_metrics`
- Webhook ingestion is operational
- A developer writing Phase 3 intelligence skills can read metrics by slug from `canonical_metrics` without touching any adapter-specific code
- Rate limiting is functional
- The `canonical_metrics` table contains real data for at least one connected organisation

