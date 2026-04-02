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
