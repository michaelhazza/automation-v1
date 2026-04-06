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

