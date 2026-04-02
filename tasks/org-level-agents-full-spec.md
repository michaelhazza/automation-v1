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
| `review_items` | `subaccount_id NOT NULL` | Nullable — org-level HITL reviews |
| `actions` | `subaccount_id NOT NULL` | Nullable — org-level action audit trail |
| `scheduled_tasks` | `subaccount_id NOT NULL` | Deferred to Phase 5 |
| `tasks` | `subaccount_id NOT NULL` | Deferred to Phase 5 |

Index strategy: existing composite indexes that include `subaccountId` need corresponding partial indexes for the `subaccountId IS NULL` case, scoped to `organisationId` instead. The unique constraint on `actions(subaccountId, idempotencyKey)` needs a partial variant for org-level actions.

### Org agent execution config

Today, all per-run configuration lives on the `subaccountAgents` join table: `tokenBudgetPerRun`, `maxToolCallsPerRun`, `timeoutSeconds`, `skillSlugs`, `allowedSkillSlugs`, `customInstructions`, `maxCostPerRunCents`, `maxLlmCallsPerRun`.

Org-level agents need equivalent configuration without the subaccount binding. Two options:

**(a) New `orgAgentConfigs` table** — mirrors the relevant fields from `subaccountAgents`, keyed to `(organisationId, agentId)`. Clean separation. More tables.

**(b) Promote config fields onto the `agents` table** — add the same fields directly to the org-level agent record with a flag like `orgExecutionEnabled`. Fewer tables. Muddies the `agents` table which currently holds only definition, not runtime config.

**Recommendation:** Option (a). The `subaccountAgents` table works well because it cleanly separates "agent definition" from "agent deployment config." The org level should mirror this pattern rather than collapse it. The developer should validate this against the codebase and choose the approach that introduces the least friction.

### Execution service changes

`agentExecutionService.executeRun()` currently requires `subaccountId` and `subaccountAgentId` in the `AgentRunRequest` interface. The changes:

1. **Make `subaccountId` and `subaccountAgentId` optional** on `AgentRunRequest`
2. **Load config from the right source** — if `subaccountAgentId` is present, load from `subaccountAgents` (existing path). If absent, load from the new org agent config
3. **Skip subaccount-specific context gracefully:**
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

The schema defines at minimum:

**Account** — represents one subaccount mapped to an external platform account. Fields: identifier, display name, status, creation date, source connector reference. This is the central entity everything else hangs off.

**Contact** — a person record within an account. Growth rate and recency of new contacts are key health signals.

**Opportunity** — a deal or pipeline item within an account. Stage, value, age in stage, and movement history are key health signals.

**Conversation** — a communication thread. Volume, recency, and response patterns are key health signals.

**Revenue** — a transaction or recurring revenue record. Amount, date, and status.

**CampaignActivity** — a marketing activity (email send, SMS, ad) with performance signals where available.

**HealthSnapshot** — a point-in-time computed summary of an account's health. Written by the platform (Phase 3 intelligence skills), not ingested from the external source.

**AnomalyEvent** — a detected deviation from baseline in any metric. Written by the intelligence skills (Phase 3). Not ingested.

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

### Connector configuration in the database

Each organisation that uses the integration layer has one or more connector config records. A connector config stores:

- Which connector type is active (GHL, in this case)
- The authentication credentials for that connector (using existing `integrationConnections` storage with encrypted tokens)
- The sub-account mapping (which external account IDs map to which internal subaccount records)
- Polling schedule preferences
- Status and last-sync metadata

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

#### Cross-subaccount skills

Three new skills available to org-level agents:

**`query_subaccount_cohort`**
- Reads board health + memory summaries across multiple subaccounts, filtered by tags
- Input: tag filters (e.g. `{"vertical": "dental"}`) or explicit subaccount IDs, optional metric focus
- Output: aggregated/anonymised data per matching subaccount — board health metrics, memory summary excerpts, entity counts, last activity dates
- Does NOT return raw subaccount data to prevent cross-subaccount data leakage — returns summaries and metrics
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

#### Skill: `detect_anomaly`

Compares a current metric snapshot for a subaccount against that subaccount's historical baseline and identifies statistically significant deviations.

**Inputs:** Account identifier, metric name, current value, historical baseline (rolling window stored in org memory), sensitivity configuration.
**Outputs:** Boolean anomaly flag, deviation magnitude, direction (above/below baseline), severity (low/medium/high/critical), natural language description.

**The generic/configured split:** The detection algorithm is generic. The threshold and rolling window size are configured per-organisation. Same skill code, different configuration.

#### Skill: `compute_churn_risk`

Evaluates behavioural signals for a subaccount and produces a churn risk score.

**Inputs:** Account entity, recent HealthSnapshot history, specific risk signals (declining health trajectory, consecutive missed milestones, platform login inactivity, pipeline stagnation duration).
**Outputs:** Churn risk score (0-100), primary risk drivers, recommended intervention type (early warning / active intervention / urgent escalation), suggested next action.

**Implementation note:** At MVP, this uses a heuristic scoring model — explicit rules with configured weights. The architecture should allow replacement with an ML model later without changing the skill's interface. Build the interface right, ship the heuristic, refine over time.

**The generic/configured split:** Risk signal weights and threshold bands are configured per-organisation.

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
