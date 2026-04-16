---
name: Weekly Digest Gather
description: Aggregates the past 7 days of subaccount activity, memory events, KPI deltas, pending items, memory-health data (stub until S14), and next-week scheduled tasks for the Weekly Digest playbook.
isActive: true
visibility: internal
---

## Parameters

- subaccountId: string (required, uuid) — The subaccount to gather for.
- organisationId: string (required, uuid) — Tenant scope.
- windowDays: number (default 7) — Size of the retrospective window in days.

## Output

Returns a structured object with six sections:

1. workCompleted — { tasksRun, deliverables, actions }
2. learned — { newEntries, beliefsUpdated, blocksCreated }
3. kpiMovement — array of { name, delta }
4. itemsPending — { clarificationsBlocked, reviewQueueItems, failedTasks }
5. memoryHealth — { conflictsResolved, entriesPruned, coverageGaps, stub }
6. nextWeekPreview — array of { taskSlug, nextRunAt }

## Behaviour

Phase 3 scope: the memoryHealth section renders a `stub: true` payload until
S14 lands in Phase 4. Other sections pull live data from existing services:

- **workCompleted**: queries `agent_runs` for completed runs + `task_deliverables` for deliverables + `actions` for tool calls
- **learned**: queries `workspace_memory_entries` (new inserts), `agent_beliefs` (updates), `memory_blocks` (creates)
- **kpiMovement**: placeholder — agencies configure KPIs via the Goals page
- **itemsPending**: queries `memory_review_queue` + `agent_runs.status='failed'` in the window
- **memoryHealth** (stub): `{ conflictsResolved: null, entriesPruned: null, coverageGaps: null, stub: true }`
- **nextWeekPreview**: queries `scheduled_tasks.next_run_at` for items scheduled in the next 7 days

Safe to run repeatedly — the skill is read-only.
