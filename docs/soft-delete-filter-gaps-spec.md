# Soft-Delete Filter Gaps — Fix Specification

## Context

A code-wide audit found that several server-side queries join or select from soft-deletable tables
without the required `isNull(X.deletedAt)` guard in the join condition or WHERE clause. The issue
was discovered when `listSubaccountAgents` (fixed on branch `bugfixes-april26`) returned an
inactive `system_monitor` agent that appeared as a floating node in the org chart.

### Soft-deletable tables in this codebase

| Table | Drizzle schema | Column |
|-------|---------------|--------|
| `agents` | `server/db/schema/agents.ts` | `deletedAt` |
| `subaccounts` | `server/db/schema/subaccounts.ts` | `deletedAt` |
| `systemAgents` | `server/db/schema/systemAgents.ts` | `deletedAt` |
| `subaccountAgents` | `server/db/schema/subaccountAgents.ts` | `isActive` boolean (soft-activation, not timestamp) |

### Pattern being fixed

```ts
// WRONG — deleted agents surface in results
.innerJoin(agents, eq(agents.id, someTable.agentId))

// CORRECT — deleted agents excluded from join
.innerJoin(agents, and(eq(agents.id, someTable.agentId), isNull(agents.deletedAt)))

// For leftJoin (optional attribution), same rule applies
.leftJoin(agents, and(eq(agents.id, someTable.agentId), isNull(agents.deletedAt)))
```

---

## Category A — Fix unconditionally

These queries return current operational state to users or to runtime execution paths.
Showing deleted/inactive entities here is always wrong.

### 1. `server/tools/config/configSkillHandlers.ts` — data source operations

Three queries do an `innerJoin(agents, eq(agentDataSources.agentId, agents.id))` without
`isNull(agents.deletedAt)`:

- **Line 453** — `patchDataSource()` — allows writes to data sources owned by a deleted agent
- **Line 477** — `deleteDataSource()` — allows deletes against a deleted agent's data sources
- **Line 665** — `listDataSources()` — lists data sources including deleted agents' entries

Two more queries join via `subaccountAgents → agents` without either guard:

- **Line 677** — `innerJoin(subaccountAgents, ...)` — no `isActive` check
- **Line 678** — `innerJoin(agents, ...)` — no `isNull(agents.deletedAt)` in join

Fix: add `isNull(agents.deletedAt)` to every join condition. For line 677, also add
`eq(subaccountAgents.isActive, true)`.

### 2. `server/tools/readDataSource.ts:182` — runtime LLM data source loading

`innerJoin(agents, eq(agents.id, agentDataSources.agentId))` with no deletedAt guard.
This runs at LLM execution time — accessing data sources owned by a deleted agent could
cause runtime errors or load stale content into the model context.

Fix: add `isNull(agents.deletedAt)` to the join condition.

### 3. `server/services/orgAgentConfigService.ts:23` — org agent config list

`innerJoin(agents, eq(agents.id, orgAgentConfigs.agentId))` with no deletedAt guard.
Returns org-level agent config records for deleted agents, surfacing phantom entries in
the agent configuration UI.

Fix: add `isNull(agents.deletedAt)` to the join condition.

### 4. `server/services/webLoginConnectionService.ts:353` — web login connection list

`innerJoin(agents, eq(agents.id, subaccountAgents.agentId))` with no deletedAt guard
inside `listBySubaccount()`. Web login connections for deleted agents appear as active
credential options in the UI.

Fix: add `isNull(agents.deletedAt)` to the join condition.

### 5. `server/services/subtaskWakeupService.ts:69` — runtime orchestration wakeup

`innerJoin(agents, eq(agents.id, subaccountAgents.agentId))` with no deletedAt guard.
This is a runtime path: when a subtask completes, the service looks up the orchestrator
agent to notify. If the orchestrator was deleted mid-run, the wakeup silently misses it.

Fix: add `isNull(agents.deletedAt)` to the join condition.

### 6. `server/routes/llmUsage.ts:59` — billing cost breakdown

`innerJoin(subaccounts, eq(costAggregates.entityId, subaccounts.id))` with no
`isNull(subaccounts.deletedAt)` guard. The top-N spend report includes deleted subaccounts,
inflating cost attribution in billing-facing APIs.

Fix: add `isNull(subaccounts.deletedAt)` to the join condition.

### 7. `server/services/activityService.ts:402,448` — workflow and execution activity

`listWorkflowRuns()` (line 402) and `listExecutions()` (line 448) both do:

```ts
.leftJoin(subaccounts, eq(subaccounts.id, workflowRuns.subaccountId))
```

without `isNull(subaccounts.deletedAt)`. Other queries in the same file (lines 213, 272, 358)
already apply this filter correctly — these two are inconsistent with the established pattern.

Fix: add `isNull(subaccounts.deletedAt)` to both join conditions to match the rest of the file.

---

## Category B — Design decision required before fixing

These queries join soft-deletable tables in **historical / audit log** contexts. The correct
behaviour depends on a product decision: should run history, task attribution, and knowledge
entries continue to reference agents/subaccounts that have since been deleted?

The common failure mode here is the inverse: `innerJoin` without `deletedAt` filter means
that if the agent is hard-deleted (which shouldn't happen but could via direct DB), the run
record disappears entirely from history. The safe default is to convert `innerJoin → leftJoin`
with a `deletedAt IS NULL` guard so the historical record is preserved but stale name/slug
is not leaked.

### B1. `server/services/agentActivityService.ts` — agent run history

All four query methods use unguarded joins:

| Line | Method | Join type | Table |
|------|--------|-----------|-------|
| 55 | `listRuns()` | `innerJoin` | `agents` |
| 56 | `listRuns()` | `leftJoin` | `subaccounts` |
| 104 | `getRun()` | `innerJoin` | `agents` |
| 105 | `getRun()` | `leftJoin` | `subaccounts` |
| 214 | `getTaskActivities()` | `leftJoin` | `agents` |
| 285 | `getChainedRuns()` | `innerJoin` | `agents` |
| 286 | `getChainedRuns()` | `leftJoin` | `subaccounts` |

Risk of leaving as-is: historical runs are hidden if agent is deleted (innerJoin),
or show deleted agent metadata (all joins). Risk is display-level only.

Recommended fix: change `innerJoin(agents, ...)` → `leftJoin(agents, and(..., isNull(agents.deletedAt)))`
so the run history record is preserved but the agent name/slug falls back to null/placeholder
in the UI when the agent is deleted. Apply the same to the subaccounts leftJoins.

### B2. `server/services/scheduledTaskService.ts:471,493` — scheduled task agent attribution

`getById()` and `listBySubaccount()` both leftJoin agents without a deletedAt guard:

```ts
.leftJoin(agents, eq(agents.id, scheduledTasks.assignedAgentId))
```

Risk: a scheduled task's `assignedAgentId` still points to a deleted agent — the task shows
a stale agent name. The task itself continues to exist.

Recommended fix: add `isNull(agents.deletedAt)` to the join condition so that if the assigned
agent is deleted, `assignedAgent` resolves to null rather than returning stale data. The UI
should already handle null gracefully for optional attribution.

### B3. `server/services/knowledgeService.ts:119` — memory entry agent attribution

```ts
.leftJoin(agents, eq(agents.id, workspaceMemoryEntries.agentId))
```

Risk is minimal (leftJoin, attribution only). Memory entries themselves have their own
`deletedAt` guard. Historical attribution of "which agent wrote this entry" is acceptable
even for deleted agents. Low priority — apply `isNull(agents.deletedAt)` for consistency.

### B4. `server/services/delegationGraphService.ts:50,95` — delegation graph

Two `innerJoin(agents, eq(agents.id, agentRuns.agentId))` calls without deletedAt guard.
The delegation graph is used for run visualisation / hierarchy tracing. Determine first
whether this is live-graph (shows current agent topology) or historical (traces past runs):
- If live: fix as Category A (add `isNull` filter)
- If historical run-trace: fix as Category B1 (convert innerJoin to leftJoin with filter)

Inspect `delegationGraphService.ts` to determine context before fixing.

---

## Implementation notes

- All fixes are in join conditions, not WHERE clauses, so they apply before the join
  multiplies rows.
- `isNull` is already imported in most of these files — verify before adding the import.
- Fixes are mechanical and do not require schema changes or migrations.
- Run `npm run typecheck` after each file. Run `npm test` before marking done.

## Done criteria

- All Category A findings have `isNull(X.deletedAt)` (and `isActive` where applicable) in
  every join on a soft-deletable table.
- Category B fixes are applied per the recommended approach above, with B4
  (delegationGraphService) classified correctly after inspection.
- `npm run typecheck` passes clean.
- `npm test` (unit suite, not gates) passes clean.
- A brief note is added to `KNOWLEDGE.md` recording that join conditions on soft-deletable
  tables must always include the deletedAt guard.
