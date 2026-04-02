# Dev Brief: Org-Level Agents & Cross-Subaccount Intelligence

**Date:** 2026-04-02
**Status:** CEO brief -- strategic framing, not dev spec
**Context:** Platform currently only supports agents running within a single subaccount. This brief proposes extending agents to run at the organisation level, enabling cross-subaccount intelligence, portfolio monitoring, and org-wide automation.

---

## Why This Matters

Today, every agent run is scoped to a single subaccount. There is no mechanism for an agent to:

- Monitor health across all subaccounts in an organisation
- Detect patterns that span subaccounts (e.g. "subaccounts tagged 'dental' convert best with same-day follow-up")
- Generate cross-subaccount reports or alerts
- Operate at the org level without being tied to one subaccount

Subaccounts are a generic concept -- they represent whatever the organisation needs: clients, projects, departments, properties, portfolios. The platform doesn't prescribe what a subaccount is. But the org needs a way to operate *across* them.

**This is our differentiation.** Fully autonomous agent tools can't do persistent, multi-tenant, cross-workspace intelligence with human oversight. This is where we win.

---

## What We're Building

**An org-level agent capability** -- agents that belong to the organisation (not a specific subaccount) and can see across all subaccounts. The org's AI operations layer.

### Use Cases Unlocked (examples -- org defines these through configuration, not code)

| Use Case | Description |
|----------|-------------|
| **Portfolio health monitoring** | Heartbeat agent reviews all subaccount boards, flags stalling work, missed deadlines, at-risk accounts |
| **Cross-subaccount pattern detection** | "Subaccounts tagged 'dental' saw lead volume drop this week" / "Projects using pattern X complete 2x faster" |
| **Automated reporting** | Generate per-subaccount reports by reading each board + memory, send via email with review gate |
| **Early warning signals** | Agent tracks activity signals across subaccounts, surfaces risk before problems escalate |
| **Cohort analysis** | Compare performance across subaccount segments using user-defined tags |
| **Org-level operations** | Internal task management, coordination, process improvement at the org level |

---

## Current State: Everything is Subaccount-Scoped

A full audit reveals that **every major subsystem** hard-requires a `subaccountId`:

| Subsystem | Subaccount-coupled? | Notes |
|-----------|-------------------|-------|
| Agent runs | Hard-coupled (NOT NULL FK) | Cannot insert a run without a subaccount |
| Execution config | Hard-coupled | Budget, skills, instructions all live on `subaccountAgents` join table |
| Heartbeat scheduling | Hard-coupled | Schedule keyed to `subaccountAgentId` |
| Memory | Hard-coupled | All entries scoped to single subaccount |
| Board / Tasks | Hard-coupled | Tasks require subaccount |
| Skill execution | Hard-coupled | `SkillExecutionContext.subaccountId` is required |
| Triggers | Hard-coupled | Trigger schema requires subaccount + subaccount agent |
| Review queue / HITL | Hard-coupled | Review items and actions require subaccount |
| WebSocket events | Partially coupled | Run-level events are org-scoped; board events are subaccount-scoped |
| Connections | Hard-coupled | OAuth connections tied to subaccount |

### What's Already Org-Ready (least work)

- **Policy rules** -- `subaccountId` is already nullable; org-wide rules already work
- **Org budget caps** -- `orgBudgets` table exists and is enforced independently
- **Processes** -- already support `scope: 'organisation'` with nullable `subaccountId`
- **WebSocket** -- `emitOrgUpdate` function exists, just not wired to execution flow
- **Board config** -- org-level config already exists (nullable `subaccountId` on `boardConfigs`)
- **Agent hierarchy** -- `agents.parentAgentId` exists for org-level hierarchy (no UI yet)
- **Budget context** -- `BudgetContext.subaccountId` is already optional; org/global caps apply without it

---

## High-Level Architecture

### New Concept: Org Agent

An org agent is an agent that runs at the organisation level -- no subaccount binding. It has its own execution config (budget, skills, schedule) without requiring the `subaccountAgents` join table.

```
System Agent (platform IP)
      |
Org Agent (organisation-level)
      |--- can read across all subaccounts via new skills
      |--- has its own board, memory, review queue at org level
      |
Subaccount Agent (subaccount-level, unchanged)
      |--- operates within a single subaccount workspace
```

### New Capabilities

**1. Org Agent Execution Config**
Where subaccount agents get their run config (budget, skills, max tool calls, timeout) from `subaccountAgents`, org agents need an equivalent. Options:
- (a) New `orgAgentConfigs` table mirroring the relevant fields
- (b) Move config fields onto the `agents` table directly with a flag for "org-level active"
- Decision deferred to dev spec.

**2. Org-Level Memory**
New `org_memory_entries` table -- stores insights that span clients. Not a replacement for subaccount memory. This is where cross-client patterns live.

**3. Subaccount Tags**
User-defined key-value tags on subaccounts. The grouping primitive for cohort analysis. Organisations define whatever dimensions matter to them -- the platform provides the tagging infrastructure, not the categories.

**4. Three New Skills**
- `query_subaccount_cohort` -- read board health + memory summaries across multiple subaccounts, filtered by tags
- `read_org_insights` -- query org-level memory
- `write_org_insight` -- store cross-subaccount patterns in org memory

**5. Org-Level Board (Phase 3)**
A kanban board at the org level for org-wide work that doesn't belong to any single subaccount. Already partially supported (board config has nullable `subaccountId`), but tasks don't yet support it.

**6. Org-Level Review Queue**
When org agents propose actions (e.g. sending a report email), they need HITL review. Same mechanism, new scope.

---

## Phasing

### Phase 1: Org Agent Execution (Foundation)

**Goal:** An agent can run at org level -- no subaccount required.

What this involves:
- Schema migrations: make `subaccountId` nullable on `agent_runs`, `review_items`, `actions`
- New org agent config mechanism (execution budget, skills, schedule)
- Update `agentExecutionService` to handle null `subaccountId` -- skip subaccount-specific context loading (board, memory, team roster) gracefully
- Org-level heartbeat scheduling
- WebSocket: emit to org room instead of subaccount room when running org-level
- Org-level review queue route + basic UI

**What you get:** Org agents can run, execute skills, and have their actions reviewed. But they can't yet see across clients.

### Phase 2: Cross-Subaccount Read (Intelligence)

**Goal:** Org agents can read across subaccounts.

What this involves:
- Subaccount tags (schema + CRUD + UI)
- `query_subaccount_cohort` skill -- reads board state + memory summaries across subaccounts, filtered by user-defined tags
- Org-level memory (`org_memory_entries` table + service)
- `read_org_insights` and `write_org_insight` skills

**What you get:** An org-level agent can run on heartbeat, review all subaccounts, identify patterns, store insights, and create alert tasks. The org's cross-cutting intelligence layer.

### Phase 3: Org-Level Workspace

**Goal:** The organisation has its own workspace for org-wide work.

What this involves:
- Make `tasks.subaccountId` nullable -- org-level tasks
- Org-level board UI
- Org-level scheduled tasks
- Org-level triggers (e.g. "when an org task is created, fire the org orchestrator")
- Org-level connections (OAuth connections at org level, available to org agents)

**What you get:** A workspace at the org level for work that doesn't belong to any single subaccount. Same capabilities as subaccount workspaces -- board, tasks, scheduling, triggers, connections -- but scoped to the organisation.

---

## What Changes, What Doesn't

| Area | Changes? | Detail |
|------|----------|--------|
| Subaccount agent flows | **No change** | Everything that works today continues unchanged |
| Three-tier agent model | **Extended** | Org agents become a first-class concept alongside subaccount agents |
| Agent execution service | **Modified** | Handles nullable `subaccountId`, skips subaccount-specific loading when absent |
| Memory system | **Extended** | New org memory layer; subaccount memory untouched |
| Skill executor | **Modified** | `SkillExecutionContext.subaccountId` becomes optional; new cross-client skills added |
| Client UI | **No change** | Portal, client-facing pages unaffected |
| Admin UI | **Extended** | New org agents page, org board, org review queue |
| System admin | **No change** | System agent templates continue to work at all levels |

---

## Risks & Open Questions

1. **Scope creep.** Phase 1 alone touches agent runs, execution service, scheduling, HITL, and review queue. Need to be disciplined about not pulling in Phase 2/3 work.

2. **Data isolation.** When an org agent reads across clients, we need to ensure it doesn't leak Client A's data into Client B's context. The `query_client_cohort` skill should return aggregated/anonymised data, not raw client records.

3. **Org agent vs subaccount agent run limits.** Today, run limits (budget, max tool calls) live on `subaccountAgents`. Org agents need equivalent guardrails. Where does this config live?

4. **Connections at org level.** If an org agent needs to send email, it needs an OAuth connection. Today connections are per-subaccount. Do we need org-level connections, or does the org agent specify which subaccount's connection to use?

5. **How does an org agent create tasks on a client board?** If the intelligence agent spots an issue with a client, should it be able to create a task on that client's subaccount board? This crosses the org/subaccount boundary in the write direction.

6. **Performance.** An org agent querying across 100 subaccounts' memories and boards could be expensive. Need to design the `query_client_cohort` skill to be efficient (aggregated summaries, not raw data dumps).

---

## Strategic Framing

This is the feature that turns the platform from a "per-subaccount agent tool" into a true operating system. Without org-level agents, the organisation still needs to manage each subaccount manually. With them, the platform becomes the org's AI-powered operations layer that works across all their workspaces.

The cross-subaccount intelligence capability (Phase 2) is persistent, accumulative, and gets smarter over time through workspace memory. This is a generic platform capability -- what orgs *do* with it depends on their domain. An agency monitors client health. A dev shop tracks project velocity. A property manager monitors building performance. The platform provides the infrastructure; the org provides the context through data and configuration, not code.

**Recommended approach:** Build Phase 1 as a foundation sprint, validate Phase 2 capabilities with real users, then build Phase 2. Phase 3 follows based on demand.

---

## Next Steps

1. Validate with real users that cross-subaccount capabilities match actual needs
2. Produce a dev spec for Phase 1 (schema migrations, execution service changes, org agent config)
3. Classify as **Significant** (multiple domains, new patterns) -- invoke architect agent before implementation
