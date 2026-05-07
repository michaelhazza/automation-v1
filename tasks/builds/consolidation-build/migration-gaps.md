## PLAN_GAP: Triggers schema — no direct agentId column

**Chunk:** C1
**Status:** Mitigated via subaccountAgents join

The `agentTriggers` table does not have an `agentId` FK to `agents`. Triggers are linked
to agents through `subaccountAgents`. The `getFull` method uses a two-step query:
1. Look up subaccountAgent IDs for this org-level agent
2. Fetch triggers WHERE subaccountAgentId IN (those IDs)

If an agent has no subaccount links, it has no triggers (returns empty array).
This is correct for Phase 1 since triggers only fire in workspace (subaccount) context.

## PLAN_GAP: AgentFull.budget — no backing schema

**Chunk:** C1
**Status:** Deferred

The spec's `AgentFull.budget` shape (`dailyCapUsd`, `monthlyCapUsd`, `warnThresholdPct`)
has no backing DB columns. The `spendingBudgets` table is for agentic commerce spend
(not LLM cost caps) and has only `monthlySpendAlertThresholdMinor`.

Phase 1 returns `{ dailyCapUsd: null, monthlyCapUsd: null, warnThresholdPct: 0 }`.
`patchBudget` accepts patches but does not persist them.
Phase 2 should add `daily_cap_usd`, `monthly_cap_usd`, `warn_threshold_pct` columns
to `agents` and implement the read/write path.

## PLAN_GAP: startRunAsync — non-durable fire-and-forget

**Chunk:** C2
**Status:** Accepted for Phase 1 (test runs are low-stakes)

`startRunAsync` uses bare fire-and-forget (`void this.executeRun(request).catch(...)`).
A process restart between the 202 response and LLM completion leaves the `agent_runs` row
in `status='running'` permanently. The durable queue infrastructure (pg-boss) exists but
was not wired in to avoid scope creep in C2. Phase 2 should route test runs through the
queue if orphaned rows become a support issue (e.g., add a stuck-run cleanup job).
