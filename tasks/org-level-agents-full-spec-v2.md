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

**Partial run downstream behaviour.** When `resultStatus` is `'partial'`, downstream systems must handle it explicitly:

| Downstream system | Behaviour on partial run |
|-------------------|------------------------|
| Health scoring | Compute for successful accounts only. Failed accounts retain previous snapshot. |
| Anomaly detection | Run for successful accounts. Skip failed (stale data → false positives). |
| Churn risk | Run only if confidence > 0.3 for the account. |
| Portfolio report | Generate with "partial data" warning. List failed accounts explicitly. |
| Intervention proposals | Allowed only for accounts with fresh data and confidence above floor. |
| Baseline updates | Update only for successful accounts. Failed accounts retain existing baseline. |
| Alerts | Fire for successful accounts. Do not fire alerts based on absence of data from failed accounts. |

This matrix prevents false positives from missing data and ensures operators know which accounts are affected.

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
├── period_type       (text NOT NULL — e.g. "rolling_7d", "rolling_30d", "daily", "hourly")
├── aggregation_type  (text NOT NULL — e.g. "rate", "ratio", "count", "avg", "sum")
├── unit              (text, nullable — e.g. "percent", "count", "currency", "seconds")
├── computed_at       (timestamptz NOT NULL)
├── computation_trigger (text NOT NULL — "poll", "webhook", "manual", "scheduled")
├── connector_type    (text NOT NULL — which adapter computed this)
├── metadata          (jsonb, nullable — adapter-specific context)
└── created_at

Unique: (account_id, metric_slug, period_type, aggregation_type)
Index: (organisation_id, metric_slug)
Index: (account_id, computed_at DESC) — for baseline history
```

**Metric dimensionality.** The unique constraint includes `period_type` and `aggregation_type` so that the same metric can exist at multiple granularities (e.g. `contact_growth_rate` as both `rolling_7d` and `rolling_30d`). Templates reference the specific dimension they want in their factor definitions.

**Design principles:**
- **Metric slugs are adapter-defined, not platform-defined.** There is no enum of allowed metrics. Each adapter writes whatever metrics it can compute from its raw data. A CRM adapter writes `contact_growth_rate`, `pipeline_velocity`, `conversation_engagement`. A Shopify adapter writes `order_volume_trend`, `cart_abandonment_rate`, `customer_ltv`. The platform doesn't need to know the difference.
- **Templates declare which metrics to score.** The configuration template (Phase 4) lists the metric slugs that feed into health scoring, anomaly detection, and churn risk for that vertical. If a metric slug doesn't exist in the data, the scoring pipeline skips it with a data-missing warning.
- **History for baselines.** The `canonical_metrics` table is upserted on each computation (unique on `account_id, metric_slug, period_type, aggregation_type`). A companion `canonical_metric_history` table (append-only) stores every computed value for baseline and trend analysis.

```
canonical_metric_history table
├── id (uuid PK)
├── organisation_id (FK)
├── account_id (FK → canonical_accounts)
├── metric_slug       (text NOT NULL)
├── period_type       (text NOT NULL)
├── aggregation_type  (text NOT NULL)
├── value             (numeric NOT NULL)
├── period_start      (timestamptz)
├── period_end        (timestamptz)
├── computed_at       (timestamptz NOT NULL)
└── created_at

Index: (account_id, metric_slug, period_type, computed_at DESC) — for baseline queries
```

#### Metric registry (soft validation layer)

Adapters self-register the metrics they produce. This is a **soft registry** — it does not enforce what adapters can write, but it enables validation and drift detection.

```
metric_definitions table
├── id (uuid PK)
├── metric_slug       (text NOT NULL)
├── connector_type    (text NOT NULL — which adapter defines this metric)
├── label             (text — human-readable name)
├── unit              (text — "percent", "count", "currency", "seconds")
├── value_type        (text — "ratio", "count", "currency", "duration", "score")
├── default_period_type (text — "rolling_7d", "rolling_30d", etc.)
├── default_aggregation_type (text — "rate", "ratio", "avg", etc.)
├── version           (integer, default 1 — bumped when computation logic changes)
├── description       (text, nullable)
├── created_at
└── updated_at

Unique: (connector_type, metric_slug)
```

**Registry usage:**
- **On template activation:** validate that every metric slug referenced in `healthScoreFactors`, `anomalyConfig`, and `churnRiskSignals` has a corresponding `metric_definitions` entry for the template's `requiredConnectorType`. Reject activation with clear error if a referenced metric doesn't exist.
- **On adapter update:** when metric computation logic changes, bump `version`. Intelligence outputs reference this version via `algorithm_version`, surfacing drift in reports.
- **On metric write:** no enforcement (adapters write freely). The registry is for validation and documentation, not for gating writes.

This prevents the primary risk: templates silently referencing metrics that an adapter no longer computes.

#### Metric computation contract

Adapters must follow explicit timing rules for metric computation:

**Computation triggers:**
1. **After every polling cycle** — mandatory. All metrics recomputed from fresh data.
2. **After webhook-triggered deltas** — optional per metric. If a webhook updates entities that affect a metric, the adapter may recompute that metric immediately. The `computation_trigger` field records which trigger produced the value.
3. **Manual** — operator can trigger recomputation via API.

**Minimum computation interval:** Configurable per metric in `metric_definitions`. Prevents excessive recomputation under high webhook volume. Default: 5 minutes. If a recomputation is requested within the minimum interval, it is silently skipped (the current value is fresh enough).

**Adapter metric computation step.** After each polling cycle or webhook batch, the adapter:
1. Syncs raw entities to canonical entity tables (existing flow)
2. Computes derived metrics from the synced data (respecting minimum intervals)
3. Upserts to `canonical_metrics` (current values)
4. Appends to `canonical_metric_history` (historical record)
5. Records `computation_trigger` on each metric written

This step is part of the adapter's responsibility, not a separate service. Each adapter knows what metrics it can compute from its data. The platform provides the tables; the adapter provides the values.

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

**Connector recovery.** State transitions are not one-way:
- `healthy` → `degraded`: when error rate exceeds 5% or sync delay exceeds 2x interval
- `degraded` → `failed`: when 3+ consecutive syncs fail or no success in 24h
- `failed` → `degraded`: when a sync succeeds after failure (auto-recovery, single success)
- `degraded` → `healthy`: when error rate returns below 5% AND sync delays normalise over a 1-hour window
- Recovery transitions are logged as connector state events. Health scoring automatically resumes when connector recovers to `degraded` or `healthy` — no operator intervention required for recovery (only for initial failure investigation).

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

---

## Phase 3: Cross-Subaccount Intelligence + Portfolio Health Agent

### What this phase delivers

Two tightly coupled components:

1. **Generic cross-subaccount capabilities** — subaccount tags, org-level memory, and skills that let org-level agents read across subaccounts. These are platform primitives usable by any org-level agent for any purpose.

2. **The Portfolio Health Agent and its config-driven intelligence skills** — a new system agent that consumes metrics from `canonical_metrics` (Phase 2), computes health scores, detects anomalies, flags churn risk, generates portfolio reports, and escalates interventions through the HITL gate. **All intelligence skills read their factor/signal/intervention definitions from the org's template configuration — no hardcoded metrics, factors, or domain-specific logic.**

### Part A: Generic cross-subaccount capabilities

#### Subaccount tags

User-defined key-value tags on subaccounts. This is the grouping primitive for cohort analysis. Organisations define whatever dimensions matter to them — the platform provides the tagging infrastructure, not the categories.

```
subaccount_tags table
├── id (uuid PK)
├── organisation_id (FK)
├── subaccount_id (FK)
├── key          (e.g. "vertical", "region", "plan", "building_type", "store_category")
├── value        (e.g. "dental", "northeast", "premium", "residential", "electronics")
└── created_at

Unique: (subaccount_id, key)
```

The platform has no opinion on what tags mean. A CRM agency tags by vertical and region. A property manager tags by building type and location. An e-commerce operator tags by store category and market. Same table, same API, same skills — different data.

UI: tag management on subaccount settings. Key-value editor. Bulk tagging across multiple subaccounts.

#### Org-level memory

A new memory layer scoped to the organisation, not any single subaccount. Cross-subaccount insights and patterns are stored here.

```
org_memory_entries table
├── id (uuid PK)
├── organisation_id (FK)
├── source_subaccount_ids  (jsonb array — which subaccounts contributed)
├── agent_run_id (FK)
├── content
├── entry_type             (observation, decision, preference, issue, pattern)
├── scope_tags             (jsonb — matches subaccount tag dimensions)
├── quality_score          (0.0–1.0)
├── embedding              (vector(1536))
├── evidence_count         (how many subaccounts support this insight)
├── access_count
├── created_at
└── last_accessed_at
```

Design decisions:
- **Separate table.** Org insights are a different concept than subaccount memory. Mixing muddies permissions and queries.
- **`scope_tags`** links insights to subaccount tag dimensions. Generic, not hardcoded.
- **`evidence_count`** tracks supporting subaccount count. Agents weight by evidence strength.
- **`source_subaccount_ids`** for traceability without leaking data into insight content.

Service mirrors `workspaceMemoryService` — CRUD, semantic search, quality scoring, dedup.

**Org ↔ subaccount memory interaction rules:**

- **Promotion.** Subaccount insight promoted to org memory when same pattern observed across 3+ subaccounts (configurable). Original entries preserved.
- **Decay.** Entries not revalidated within configurable window (default: 30 days) have quality decayed by 20% per missed window. Below 0.2 flagged for review.
- **Conflict resolution.** Higher evidence count wins (2x+ gap). Tie: more recent wins. Unclear: both kept, agent prompted to resolve.
- **No downward propagation.** Org insights never auto-written to subaccount memory. Influence goes through explicit agent actions (may be HITL-gated).

#### Cross-subaccount skills

Three new skills available to org-level agents:

**`query_subaccount_cohort`**
- Reads health summaries + metrics across subaccounts, filtered by tags
- Input: tag filters, explicit subaccount IDs, optional metric focus
- Output: aggregated/anonymised data per matching subaccount — health score, trend, key metrics, last activity
- Does NOT return raw subaccount data — returns summaries and metrics
- Scope guards: max 50 subaccounts per query (configurable), paginated
- Gate level: `auto` (read-only)

**`read_org_insights`**
- Queries org-level memory entries
- Input: optional tag scope filter, semantic query, entry type filter
- Output: matching org memory entries with content, scope tags, evidence count
- Gate level: `auto`

**`write_org_insight`**
- Stores a cross-subaccount pattern in org memory
- Input: content, entry_type, scope_tags, source_subaccount_ids, evidence_count
- Triggers quality scoring and embedding pipeline
- Gate level: `auto`

### Part B: Portfolio Health Agent

#### Agent definition

A new system agent — the Portfolio Health Agent — that operates at the organisation level. Responsible for monitoring the portfolio, coordinating health scoring runs, detecting anomalies, managing alerts, and escalating through HITL.

This agent is **conditionally loaded.** Only present when a configuration template that requires it is applied (Phase 4).

#### Agent responsibilities

**Scheduled portfolio scans.** Runs on a configurable schedule (default from template). Each run reads metrics from `canonical_metrics` for all active accounts, invokes intelligence skills, and flags accounts crossing thresholds.

**Anomaly detection coordination.** Invokes detection skills, receives outputs, decides what to do (log, alert, escalate).

**Alert delivery.** Formats and delivers alerts to configured destinations (Slack, email, in-platform). Alert formatting and destination are configuration, not code.

**HITL gate escalation.** Interventions requiring human approval go through the existing HITL gate system.

**Portfolio report generation.** On configurable schedule, coordinates generation of a portfolio intelligence briefing.

**Baseline management.** Maintains rolling baselines per account per metric in `canonical_metric_history`. Baselines are account-specific and metric-specific — what "normal" looks like for each account's metrics.

#### Baseline storage and computation

Baselines are computed from `canonical_metric_history`, not stored as a separate table (v2.0 simplification from v1.0). The intelligence skills query metric history directly and compute rolling statistics (mean, median, variance) on the fly.

**Baseline computation rules (all configurable per template):**
- **Window size:** Configurable per metric slug in the template. No platform defaults for specific metrics — the template must declare them.
- **Seasonality handling:** Configurable per template. Options: `none`, `day_of_week`, `day_of_month`, `monthly`. The platform provides the computation methods; the template selects which to apply.
- **Minimum data threshold:** Configurable. Default: 14 data points. Below threshold, scoring skipped with "insufficient data" warning.
- **Adaptive windows:** High-variance accounts auto-expand window (up to configurable max). Low-variance auto-contract (to configurable min). Variance threshold configurable.
- **Recomputation trigger:** Batch, default hourly. Not per-event.

#### Agent state machine

```
idle → scanning → analysing → alerting → awaiting_hitl → executing → idle
                                    ↓
                                  idle (no alerts needed)
```

| State | Description | Transitions |
|-------|------------|-------------|
| `idle` | Waiting for next scheduled scan | → `scanning` |
| `scanning` | Reading metrics from `canonical_metrics` for all active accounts | → `analysing` |
| `analysing` | Running intelligence skills (health scoring, anomaly detection, churn risk) | → `alerting` if findings, → `idle` if none |
| `alerting` | Delivering alerts to configured destinations | → `awaiting_hitl` if interventions proposed, → `idle` if alerts only |
| `awaiting_hitl` | Intervention proposals in review queue | → `executing` on approval, → `idle` on rejection/timeout |
| `executing` | Approved interventions carried out | → `idle` |

Retry semantics per state:

| State | On failure | Max retries | Fallback |
|-------|-----------|-------------|----------|
| `scanning` | Retry with backoff | 3 | → `idle` + operator warning |
| `analysing` | Retry failed skill | 2 | → `idle` + partial results logged |
| `alerting` | Retry per destination | 3 | → `idle` + failed deliveries queued |
| `executing` | Retry intervention | 1 | → `idle` + operator alert |

#### Execution scaling controls

At scale (100+ subaccounts), the Portfolio Health Agent must not attempt to process every account in a single sequential pass. Configurable execution controls:

- **`maxAccountsPerRun`** (default: 50) — maximum accounts processed in a single scan cycle. If the org has more, the agent processes in batches across multiple scheduled runs (round-robin or priority-based).
- **`maxConcurrentEvaluations`** (default: 5) — maximum accounts being scored in parallel within a single run. Prevents cost spikes and rate limit pressure on connectors.
- **`maxRunDurationMs`** (default: 300000 / 5 minutes) — hard time budget per run. If exceeded, the run completes with `resultStatus: 'partial'` and logs which accounts were not reached. Remaining accounts are prioritised in the next cycle.
- **`accountPriorityMode`** (default: `round_robin`) — how accounts are ordered for processing. Options: `round_robin` (even coverage), `worst_first` (lowest health score first), `stalest_first` (oldest `last_scored_at` first).

These values are configurable in the template's `operationalDefaults` and overridable per org. They prevent production instability while ensuring all accounts are eventually covered.

#### What this agent does NOT do

- Deep analytical reasoning on why a subaccount is struggling
- Directly modify external platform data — goes through HITL
- Manage individual subaccount configurations
- It monitors. It detects. It alerts. It escalates. Execution is separate.

### Part C: Intelligence skills (config-driven)

The analytical capabilities that the Portfolio Health Agent invokes. These are skills in the existing Automation OS sense: registered in the skill library, invokable by any agent with the right permissions.

**Critical v2.0 design change:** In v1.0, intelligence skills had hardcoded metric references (e.g. `pipeline_velocity`, `conversation_engagement`). In v2.0, **every intelligence skill reads its configuration from the org's template `operationalDefaults`**. The skill code is a generic algorithm; the configuration tells it which metrics to use.

#### Skill: `compute_health_score`

Accepts an account identifier, reads configured factor definitions from the org's template config, fetches the corresponding metrics from `canonical_metrics`, normalises each to 0-100, and computes a weighted composite score.

**Inputs:** Account identifier. All other configuration is read from the org's `operationalDefaults.healthScoreFactors`.

**Factor configuration shape (read from org config, not hardcoded):**

```json
{
  "healthScoreFactors": [
    {
      "metricSlug": "contact_growth_rate",
      "weight": 0.25,
      "label": "Contact Growth",
      "normalisation": { "type": "linear", "minValue": -50, "maxValue": 50, "invertDirection": false }
    },
    {
      "metricSlug": "pipeline_velocity",
      "weight": 0.30,
      "label": "Pipeline Velocity",
      "normalisation": { "type": "linear", "minValue": 0, "maxValue": 100, "invertDirection": true }
    }
  ]
}
```

**Algorithm (generic — same code for every vertical):**
1. Read `healthScoreFactors` array from org config
2. For each factor: fetch `current_value` from `canonical_metrics` where `metric_slug` matches
3. If metric is missing (`dataStatus: 'missing'`): exclude from scoring, log warning
4. Normalise raw value to 0-100 using the factor's `normalisation` rules
5. Compute weighted average of normalised scores
6. Determine trend from `canonical_metric_history` (last N snapshots)
7. Compute confidence from data completeness (how many factors had data)
8. Write `health_snapshots` record with `algorithm_version` and `config_version`

**Outputs:** Composite score (0-100), factor breakdown, trend (improving/stable/declining), confidence level.

**Idempotency.** Health snapshots are deduplicated by `(account_id, DATE_TRUNC('hour', computed_at))`. If a snapshot already exists for the same account in the same hour, the write is skipped. This prevents duplicate snapshots from retries or overlapping scan cycles.

**Normalisation types supported:**
- `linear` — linear mapping from `[minValue, maxValue]` to `[0, 100]`
- `threshold` — below threshold = 0, above = 100
- `percentile` — value's position in historical distribution
- `inverse_linear` — higher raw value = lower score (e.g. response time)

The platform implements these normalisation functions. The template selects which to use per factor.

#### Skill: `detect_anomaly`

Compares a current metric value against that account's historical baseline and identifies statistically significant deviations.

**Inputs:** Account identifier, metric slug. Configuration read from org's `operationalDefaults.anomalyConfig`.

**Anomaly configuration shape (read from org config):**

```json
{
  "anomalyConfig": {
    "defaultThreshold": 2.0,
    "defaultWindowDays": 30,
    "metricOverrides": {
      "order_volume_trend": { "threshold": 1.5, "windowDays": 14 },
      "occupancy_rate": { "threshold": 3.0, "windowDays": 60 }
    },
    "seasonality": "day_of_week",
    "minimumDataPoints": 14
  }
}
```

**Algorithm (generic):**
1. Read threshold and window from config (metric-specific override or default)
2. Fetch metric history from `canonical_metric_history`
3. If fewer than `minimumDataPoints`: return "insufficient data"
4. Compute rolling mean and standard deviation
5. Apply seasonality adjustment if configured
6. Compare current value against baseline
7. If deviation exceeds threshold: write `anomaly_events` record

**Outputs:** Anomaly flag, deviation magnitude, direction, severity (low/medium/high/critical), description.

**Idempotency.** Anomaly events are deduplicated by `(account_id, metric_slug, DATE_TRUNC('hour', created_at))`. If an anomaly event already exists for the same account + metric in the same hour, the write is skipped. This prevents duplicate anomaly alerts from retries.

#### Skill: `compute_churn_risk`

Evaluates configurable risk signals for an account and produces a churn risk score.

**Inputs:** Account identifier. Signal definitions read from org's `operationalDefaults.churnRiskSignals`.

**Signal configuration shape (read from org config):**

```json
{
  "churnRiskSignals": [
    {
      "signalSlug": "health_trajectory_decline",
      "weight": 0.30,
      "type": "metric_trend",
      "metricSlug": "health_score",
      "condition": "declining_over_periods",
      "periods": 3
    },
    {
      "signalSlug": "engagement_drop",
      "weight": 0.25,
      "type": "metric_threshold",
      "metricSlug": "conversation_engagement",
      "condition": "below_value",
      "thresholdValue": 30
    },
    {
      "signalSlug": "no_recent_activity",
      "weight": 0.25,
      "type": "staleness",
      "maxDaysInactive": 14
    },
    {
      "signalSlug": "revenue_anomaly",
      "weight": 0.20,
      "type": "metric_trend",
      "metricSlug": "revenue_trend",
      "condition": "declining_over_periods",
      "periods": 2
    }
  ]
}
```

**Signal types (generic, platform-provided):**
- `metric_trend` — is the metric improving or declining over N periods?
- `metric_threshold` — is the metric above or below a value?
- `staleness` — has the account had no activity for N days?
- `anomaly_count` — how many anomalies in the last N days?
- `health_score_level` — is the health score below a threshold?

The platform implements these signal evaluation functions. The template defines which signals to use, which metrics they reference, and how to weight them.

**Algorithm (generic):**
1. Read signal definitions from config
2. Evaluate each signal (fetch metric, compare against condition)
3. Compute weighted risk score (0-100)
4. Determine intervention type from configurable threshold bands

**Outputs:** Risk score (0-100), primary risk drivers, recommended intervention type, suggested next action.

#### Skill: `generate_portfolio_report`

Accepts a portfolio-level dataset and generates a structured intelligence briefing.

**Inputs:** Reporting period, operator preferences (from config). All data gathered internally.

**Algorithm (generic):**
1. Fetch all accounts with latest health snapshots
2. Fetch recent anomaly events
3. Fetch org memory insights
4. Compile structured data: portfolio overview, accounts requiring attention, anomalies, positive signals
5. Optionally use LLM to generate natural language briefing (format configurable)

**Outputs:** Structured report. Format, tone, and delivery method are configured per-org.

#### Skill: `trigger_account_intervention`

The action skill — bridge between detection and execution.

**Inputs:** Account identifier, intervention type slug, supporting evidence, HITL gate reference.

**Intervention type configuration (read from org config):**

```json
{
  "interventionTypes": [
    {
      "slug": "notify_operator",
      "label": "Notify Operator",
      "gateLevel": "auto",
      "action": "internal_notification"
    },
    {
      "slug": "pause_activity",
      "label": "Pause External Activity",
      "gateLevel": "review",
      "action": "connector_action",
      "connectorAction": "pause_campaign"
    },
    {
      "slug": "escalate_issue",
      "label": "Escalate to Account Manager",
      "gateLevel": "review",
      "action": "create_task"
    },
    {
      "slug": "trigger_workflow",
      "label": "Trigger Follow-up Workflow",
      "gateLevel": "review",
      "action": "connector_action",
      "connectorAction": "start_sequence"
    },
    {
      "slug": "generate_communication",
      "label": "Draft Client Communication",
      "gateLevel": "review",
      "action": "generate_draft"
    }
  ]
}
```

**Intervention action types (generic, platform-provided):**
- `internal_notification` — in-platform alert to operator
- `connector_action` — call a specific adapter method (adapter implements the action)
- `create_task` — create a task on the account's board
- `generate_draft` — use LLM to draft a communication
- `send_email` — send via email service
- `send_slack` — send via Slack adapter

The template defines which intervention types are available and which gate level applies. The platform routes the execution. Connector-specific actions (like "pause a campaign") are implemented in the adapter — the platform just dispatches to the adapter.

**Critical design note:** Every intervention path goes through the HITL gate first. The skill submits the proposal and returns pending status. Only on human approval does execution proceed.

**Intervention cooldown.** To prevent the same issue repeatedly triggering the same intervention (operator fatigue), a cooldown window is enforced per `(account_id, intervention_type_slug)`. If an intervention of the same type was proposed for the same account within the cooldown window, the proposal is suppressed and logged as `intervention_suppressed_cooldown`. The cooldown duration is configurable per intervention type in the template (default: 24 hours). This applies regardless of whether the previous proposal was approved, rejected, or timed out.

### Data isolation

When an org agent reads across subaccounts:
- `query_subaccount_cohort` returns aggregated summaries, not raw data
- Org memory contains insights, not copies of subaccount data
- Health scores and anomaly events are per-account, attributed to source

### Gate condition for Phase 4

Phase 3 is complete when:
- Subaccount tags work (create, query, filter)
- Org memory works (create, semantic search, dedup)
- All three cross-subaccount skills are operational
- All five intelligence skills read their configuration from `operationalDefaults` (no hardcoded factors/signals/interventions)
- Intelligence skills read metrics from `canonical_metrics` by slug (not from raw entity tables directly)
- The Portfolio Health Agent runs a scan cycle and produces HealthSnapshot records
- End-to-end: metric changes → anomaly detected → HITL proposal → approval → intervention

---

## Phase 4: Configuration Template System Extension

### What this phase delivers

An extension to the existing hierarchy template system that makes the full intelligence layer deployable via a single template load. A configuration template is a complete, loadable specification: which agents are active, which skills are enabled, which connector is required, which metrics to score, how to weight them, which anomaly thresholds to use, which risk signals to evaluate, which interventions are available, and what the operational parameters are.

This is the delivery mechanism for everything built in Phases 1-3. Without it, each organisation requires manual setup. With it, any vertical configuration can be applied in minutes.

### Building on what exists

The existing template system provides agent roster + hierarchy. This extension adds:

**Connector specification**
- Required connector type (e.g. `ghl`, `hubspot`, `shopify`)
- Required operator inputs during activation (OAuth credentials, account mapping)

**Skill enablement map**
- Per-agent skill permissions

**Operational parameters (the v2.0 addition)**
- `healthScoreFactors` — array of factor definitions (metric slug, weight, label, normalisation rules)
- `anomalyConfig` — default threshold, window, per-metric overrides, seasonality mode, minimum data points
- `churnRiskSignals` — array of signal definitions (slug, weight, type, metric reference, condition)
- `interventionTypes` — array of intervention definitions (slug, label, gate level, action type, connector action)
- `scanFrequencyHours` — how often the Portfolio Health Agent runs
- `reportSchedule` — when portfolio briefings are generated
- `alertDestinations` — operator configures during activation

**Workspace memory seeds**
- Pre-populated org memory entries for initial agent context

### Template structure (full example — GHL Agency)

This is an example of a **completed template configuration** for one vertical. The same template structure works for any vertical — only the values change.

```json
{
  "name": "GHL Agency Intelligence",
  "requiredConnectorType": "ghl",
  "requiredOperatorInputs": [
    { "key": "ghl_oauth", "label": "GHL OAuth Credentials", "type": "oauth", "required": true },
    { "key": "alert_email", "label": "Alert Email", "type": "email", "required": true },
    { "key": "slack_webhook", "label": "Slack Webhook URL", "type": "url", "required": false }
  ],
  "operationalDefaults": {
    "healthScoreFactors": [
      { "metricSlug": "pipeline_velocity", "weight": 0.30, "label": "Pipeline Velocity", "normalisation": { "type": "inverse_linear", "minValue": 0, "maxValue": 100 } },
      { "metricSlug": "conversation_engagement", "weight": 0.25, "label": "Conversation Engagement", "normalisation": { "type": "linear", "minValue": 0, "maxValue": 100 } },
      { "metricSlug": "contact_growth_rate", "weight": 0.20, "label": "Contact Growth", "normalisation": { "type": "linear", "minValue": -50, "maxValue": 50 } },
      { "metricSlug": "revenue_trend", "weight": 0.15, "label": "Revenue Trend", "normalisation": { "type": "linear", "minValue": -100, "maxValue": 100 } },
      { "metricSlug": "platform_activity", "weight": 0.10, "label": "Platform Activity", "normalisation": { "type": "linear", "minValue": 0, "maxValue": 100 } }
    ],
    "anomalyConfig": {
      "defaultThreshold": 2.0,
      "defaultWindowDays": 30,
      "seasonality": "day_of_week",
      "minimumDataPoints": 14,
      "metricOverrides": {}
    },
    "churnRiskSignals": [
      { "signalSlug": "health_trajectory_decline", "weight": 0.30, "type": "metric_trend", "metricSlug": "health_score", "condition": "declining_over_periods", "periods": 3 },
      { "signalSlug": "pipeline_stagnation", "weight": 0.25, "type": "metric_threshold", "metricSlug": "pipeline_velocity", "condition": "above_value", "thresholdValue": 60 },
      { "signalSlug": "engagement_decline", "weight": 0.25, "type": "metric_threshold", "metricSlug": "conversation_engagement", "condition": "below_value", "thresholdValue": 30 },
      { "signalSlug": "low_health", "weight": 0.20, "type": "health_score_level", "thresholdValue": 40 }
    ],
    "interventionTypes": [
      { "slug": "notify_operator", "label": "Notify Operator", "gateLevel": "auto", "action": "internal_notification" },
      { "slug": "pause_campaign", "label": "Pause Campaign", "gateLevel": "review", "action": "connector_action", "connectorAction": "pause_campaign" },
      { "slug": "escalate_to_am", "label": "Escalate to Account Manager", "gateLevel": "review", "action": "create_task" },
      { "slug": "send_checkin", "label": "Send Check-in Email", "gateLevel": "review", "action": "send_email" }
    ],
    "scanFrequencyHours": 4,
    "reportSchedule": { "dayOfWeek": 1, "hour": 8 },
    "alertDestinations": []
  },
  "memorySeedsJson": [
    { "content": "This organisation manages a portfolio of client accounts. Monitor for pipeline stagnation, lead volume drops, and conversation engagement decline.", "entryType": "preference" }
  ],
  "slots": [
    { "agentSlug": "orchestrator", "executionScope": "subaccount", "skills": ["standard"] },
    { "agentSlug": "ba-agent", "executionScope": "subaccount", "skills": ["intake"] },
    { "agentSlug": "portfolio-health-agent", "executionScope": "org", "skills": ["compute_health_score", "detect_anomaly", "compute_churn_risk", "generate_portfolio_report", "trigger_account_intervention", "query_subaccount_cohort", "read_org_insights", "write_org_insight"] }
  ]
}
```

**A second template example (Shopify — same structure, different config):**

```json
{
  "name": "Shopify Store Intelligence",
  "requiredConnectorType": "shopify",
  "operationalDefaults": {
    "healthScoreFactors": [
      { "metricSlug": "order_volume_trend", "weight": 0.30, "label": "Order Volume", "normalisation": { "type": "linear", "minValue": -50, "maxValue": 50 } },
      { "metricSlug": "cart_abandonment_rate", "weight": 0.25, "label": "Cart Abandonment", "normalisation": { "type": "inverse_linear", "minValue": 0, "maxValue": 100 } },
      { "metricSlug": "avg_order_value", "weight": 0.25, "label": "Avg Order Value", "normalisation": { "type": "linear", "minValue": 0, "maxValue": 200 } },
      { "metricSlug": "return_rate", "weight": 0.20, "label": "Return Rate", "normalisation": { "type": "inverse_linear", "minValue": 0, "maxValue": 50 } }
    ],
    "anomalyConfig": {
      "defaultThreshold": 2.0,
      "defaultWindowDays": 14,
      "seasonality": "day_of_week",
      "minimumDataPoints": 14
    },
    "churnRiskSignals": [
      { "signalSlug": "order_decline", "weight": 0.35, "type": "metric_trend", "metricSlug": "order_volume_trend", "condition": "declining_over_periods", "periods": 3 },
      { "signalSlug": "high_returns", "weight": 0.30, "type": "metric_threshold", "metricSlug": "return_rate", "condition": "above_value", "thresholdValue": 20 },
      { "signalSlug": "revenue_drop", "weight": 0.35, "type": "metric_trend", "metricSlug": "avg_order_value", "condition": "declining_over_periods", "periods": 2 }
    ],
    "interventionTypes": [
      { "slug": "notify_operator", "label": "Notify Operator", "gateLevel": "auto", "action": "internal_notification" },
      { "slug": "restock_alert", "label": "Restock Alert", "gateLevel": "review", "action": "create_task" },
      { "slug": "promo_trigger", "label": "Trigger Promotion", "gateLevel": "review", "action": "connector_action", "connectorAction": "create_discount" }
    ]
  }
}
```

**Same platform code. Different template. Different vertical.**

### Template dependency validation

Before applying, preflight checks validate:
- Connector type is registered in the adapter registry
- Skills referenced in enablement map exist in the skill library
- Operational parameters conform to expected schema
- `dryRun: true` flag runs checks without making changes

Partial application is never allowed.

### Loading a template

1. Provision agents into the organisation
2. Apply skill enablement maps per agent
3. Create connector config and prompt operator for authentication
4. Write `operationalDefaults` to org configuration
5. Seed org memory with template-defined initial context
6. Configure org agent execution configs
7. Schedule Portfolio Health Agent's first scan
8. Confirm activation to operator

### Operator customisation after template load

Templates are starting points, not constraints. After loading, operators can:
- Adjust health score factor weights
- Change anomaly thresholds (globally or per metric)
- Modify churn risk signal weights
- Add/remove intervention types
- Change scan frequency and report schedule
- Add/remove alert destinations
- Enable/disable skills per agent
- Adjust HITL gate behaviour per intervention

All through configuration — database values, not code changes. The UI renders controls dynamically from the factor/signal/intervention definitions.

### Template versioning

Updates to system-level templates don't auto-propagate. Operators get update notifications and can preview + apply changes.

### Config version linkage

`config_version` on intelligence outputs is a SHA-256 hash of: `appliedTemplateVersion` + operator overrides + connector config version. Enables full traceability.

---

## Phase 5: Org-Level Workspace

### What this phase delivers

A workspace at the organisation level for work that doesn't belong to any single subaccount. Same capabilities as subaccount workspaces — board, tasks, scheduling, triggers, connections — but scoped to the organisation.

Independent of the intelligence layer (Phases 2-4). Built based on demand.

### Schema changes

| Table | Change |
|-------|--------|
| `tasks` | `subaccountId` nullable — org-level tasks have `subaccountId = NULL` |
| `scheduled_tasks` | `subaccountId` nullable |
| `agent_triggers` | `subaccountId` and `subaccountAgentId` nullable; org-level trigger support |
| `integration_connections` | Support org-level connections (nullable `subaccountId`) |

### Org-level board

- `boardConfigs` already supports nullable `subaccountId`
- Tasks with `subaccountId = NULL` appear on org board
- UI: org-level board page
- Org agents use existing task skills on org board

### Org-level scheduled tasks, triggers, connections

- Scheduled tasks with null `subaccountId` assigned to org agents
- Triggers with null `subaccountId` fire on org-level events (`org_task_created`, `org_task_moved`, `org_agent_completed`)
- OAuth connections at org level, available to org agents

### Cross-boundary writes

An org agent can create a task on a subaccount's board:
- Task creation skills accept optional `targetSubaccountId` from org context
- Validates target belongs to same organisation
- Checks `allowedSubaccountIds` on org agent config
- **HITL-gated** when writing from org to subaccount context

### Cross-boundary permission model

- **Target validation** — target subaccount must belong to same org. Hard check in skill layer.
- **Allowed subaccounts list** — optional `allowedSubaccountIds` on org agent config restricts scope.
- **Audit enrichment** — every cross-boundary action logged with `source_agent_id`, `source_context`, and `reasoning_summary`.

### Gate condition

Phase 5 is complete when:
- Org-level tasks, scheduled tasks, triggers, and connections work
- Cross-boundary task creation with HITL gate works
- Zero regression on subaccount flows

---

## What to Build vs What to Configure (Consolidated)

### Build (generic platform code — applies to every vertical)

**Phase 1:**
- Org-level agent execution pipeline
- Org agent config mechanism
- Authority rules and kill switch

**Phase 2:**
- Extended connector interface (ingestion + metric computation)
- `canonical_metrics` and `canonical_metric_history` tables
- Rate limiter, webhook framework, scheduled polling
- Canonical entity tables (accounts, contacts, opportunities, conversations, revenue)
- Data confidence layer and connector health computation
- Sync event audit logging

**Phase 3:**
- Subaccount tags infrastructure
- Org-level memory table and service
- Cross-subaccount query skills
- Config-driven intelligence skill algorithms:
  - Health score: reads factor array from config, fetches metrics by slug, normalises, weights
  - Anomaly detection: reads thresholds/windows from config, compares metric history
  - Churn risk: reads signal definitions from config, evaluates against metrics
  - Portfolio report: compiles from health snapshots + anomalies + org memory
  - Intervention: reads intervention types from config, routes through HITL gate
- Normalisation functions (linear, inverse_linear, threshold, percentile)
- Signal evaluation functions (metric_trend, metric_threshold, staleness, anomaly_count, health_score_level)
- Intervention action dispatchers (internal_notification, connector_action, create_task, generate_draft, send_email, send_slack)
- Portfolio Health Agent scheduling/coordination/state machine

**Phase 4:**
- Template schema extensions (operationalDefaults with full factor/signal/intervention config)
- Template activation flow (loadToOrg, preflight validation, operator input collection)
- Template versioning
- Dynamic operator customisation UI (renders controls from config definitions)

**Phase 5:**
- Org-level board, tasks, triggers, connections
- Cross-boundary writes with HITL gate

### Build (adapter-specific — one per external platform, not platform code)

- GHL adapter: ingestion methods + metric computation + webhook normalisation
- Future: HubSpot adapter, Shopify adapter, etc. (~300 lines each)

### Configure (lives in database — different per template/organisation)

- Health score factor definitions (metric slugs, weights, normalisation rules)
- Anomaly thresholds, windows, seasonality mode, per-metric overrides
- Churn risk signal definitions (slugs, weights, types, conditions)
- Intervention type definitions (slugs, labels, gate levels, action types)
- Alert destinations
- Scan frequency and report schedule
- OAuth credentials per organisation
- Account mappings (external IDs → subaccounts)
- Subaccount tags (user-defined dimensions)
- Workspace memory seeds
- Report format and verbosity preferences
- Which connector type to use
- Skill enablement per agent per organisation

---

## Principles for Implementation

**Phase 1 is the hidden prerequisite.** Highest-risk foundational work. Must be solid before proceeding.

**The metrics abstraction is the key boundary.** Intelligence skills must never read from raw entity tables directly. They read from `canonical_metrics` using slugs defined in the template config. If an intelligence skill imports a canonical entity schema file, the abstraction has failed.

**No metric slugs in platform code.** Metric slugs (`contact_growth_rate`, `pipeline_velocity`, etc.) exist only in two places: adapter code (which computes them) and template configuration (which references them). The platform layer uses generic `metric_slug: string` — never an enum or union type.

**No domain-specific logic in platform code.** The platform provides generic primitives: weighted scoring, threshold comparison, trend detection, baseline computation, normalisation functions. Templates configure which primitives to use and with what parameters. If you're writing an `if` statement that checks for a specific vertical or connector type in a skill executor, you're doing it wrong.

**Configuration over code.** If a decision requires a code change to alter behaviour for a specific organisation or vertical, that decision is in the wrong place.

**The HITL gate is not optional for execution.** Any path that modifies external data or initiates communication must go through the gate.

**Baselines are account-specific and metric-specific.** Anomaly detection compares each account to its own history for each metric. No portfolio averages.

**Fail loudly on integration errors.** Surface connector failures to operators. A missed scan is as dangerous as a detected anomaly.

**Data isolation between subaccounts.** Org agents reading across subaccounts get aggregated summaries, never raw records.

---

## Out of Scope

- Second connector implementation (architecture must support; code deferred)
- ML-based prediction models (heuristic first; architecture supports replacement)
- Client-facing portals (operator-facing only)
- Billing/pricing tied to connector usage
- Multi-connector per organisation (one at MVP)
- Org-level agent chat UI

---

## Success Criteria

The feature is complete when:

1. A new organisation can be provisioned by applying a configuration template
2. The operator provides connector credentials and alert destinations
3. Within one scan cycle, all accounts are enumerated, metrics computed, and health scores generated
4. Within one week, the operator receives their first portfolio intelligence briefing
5. When a real anomaly occurs, the operator receives a push alert and a HITL gate proposal
6. All of this happens without any action beyond the initial template activation
7. **The entire system works through generic infrastructure — adding a new vertical requires only a new adapter (~300 lines) and a new configuration template (database rows). Zero changes to agents, skills, the intelligence pipeline, or the UI.**
8. **No intelligence skill contains hardcoded metric slugs, factor names, signal definitions, or intervention types — all read from configuration**
9. **The template includes two working examples (GHL Agency, Shopify Store concept) demonstrating the same platform code serving completely different verticals**

