---
title: Unified Activity Page Consolidation
date: 2026-04-13
status: approved
---

# Unified Activity Page Consolidation

## Problem

Three separate pages cover overlapping activity/execution data:

- `SystemActivityPage` — system-scoped workflow execution list, no click-through, system-only
- `OpsDashboardPage` — unified event feed across 8 types, all three scopes, click-through, live polling
- `ExecutionHistoryPage` — org-scoped workflow execution list, no click-through

The nav exposes both "Activity" and "Ops Dashboard" at the system level, which is confusing. The backend uses the name `opsDashboard` throughout, inconsistent with any user-facing label.

## Decision

Consolidate all three pages into a single `ActivityPage` component. Rename everything — frontend and backend — from `opsDashboard` to `activity`. Delete all dead code. The result: one page, one name, zero ambiguity.

## Scope

**Not in scope:** engine type column, duration column, `decision_log` and `task_event` types (unimplemented in backend — removed from type union).

---

## Files Deleted

| File | Reason |
|------|--------|
| `client/src/pages/SystemActivityPage.tsx` | Replaced by `ActivityPage` at `/system/activity` |
| `client/src/pages/OpsDashboardPage.tsx` | Renamed to `ActivityPage.tsx` |
| `client/src/pages/ExecutionHistoryPage.tsx` | Replaced by `ActivityPage` at `/admin/activity` |

`ExecutionDetailPage.tsx` (`/executions/:id`) is **kept** — it is the click-through destination for `workflow_execution` rows in ActivityPage.

---

## Files Renamed

| Old | New |
|-----|-----|
| `server/routes/opsDashboard.ts` | `server/routes/activity.ts` |
| `server/services/opsDashboardService.ts` | `server/services/activityService.ts` |
| `client/src/pages/OpsDashboardPage.tsx` | `client/src/pages/ActivityPage.tsx` |

---

## Backend Changes

### `server/routes/activity.ts` (was `opsDashboard.ts`)

API endpoint paths renamed:

| Old | New |
|-----|-----|
| `GET /api/system/ops-dashboard` | `GET /api/system/activity` |
| `GET /api/ops-dashboard` | `GET /api/activity` |
| `GET /api/subaccounts/:id/ops-dashboard` | `GET /api/subaccounts/:id/activity` |

Auth, permission checks, and query logic are unchanged.

### `server/services/activityService.ts` (was `opsDashboardService.ts`)

File renamed. The exported `ActivityType` union retains `decision_log` and `task_event` as forward stubs — no queries reference them and removing them is deferred. All other function names, types, and logic unchanged. All internal references updated to match new filename.

### `server/index.ts`

Import path updated (`./routes/opsDashboard` → `./routes/activity`). Import binding renamed from `opsDashboardRouter` to `activityRouter`. Registration call updated to use `activityRouter`. Mount path unchanged structurally (routes self-define their paths).

---

## Frontend Changes

### `client/src/pages/ActivityPage.tsx` (was `OpsDashboardPage.tsx`)

- Component renamed from `OpsDashboardPage` to `ActivityPage`
- Page title: "Ops Dashboard" → "Activity"
- Subtitle: dynamic — `{scopeLabel}-wide activity across all agents and workflows` — already correct for all three scopes, no change needed
- API endpoints updated: `ops-dashboard` → `activity` in all three `getEndpoint()` branches
- `ActivityType` union: `decision_log` and `task_event` removed (no backend implementation)
- `ACTIVITY_TYPES` array: same two entries removed
- No other logic changes

### `client/src/App.tsx`

Lazy import: `OpsDashboardPage` removed; replaced with `const ActivityPage = lazy(() => import('./pages/ActivityPage'))`. All route usages of `OpsDashboardPage` updated to `ActivityPage`.

Routes removed:
- `/system/ops` (OpsDashboardPage)
- `/system/activity` (SystemActivityPage)
- `/admin/ops` (OpsDashboardPage)
- `/admin/subaccounts/:subaccountId/ops` (OpsDashboardPage)
- `/executions` (ExecutionHistoryPage)

Routes added:
- `/system/activity` → `ActivityPage`
- `/admin/activity` → `ActivityPage`
- `/admin/subaccounts/:subaccountId/activity` → `ActivityPage`

Route kept:
- `/executions/:id` → `ExecutionDetailPage` (click-through destination)

### `client/src/components/Layout.tsx`

**System — Platform section:**

Before: two entries — "Ops Dashboard" (`/system/ops`) + "Activity" (`/system/activity`)
After: one entry — "Activity" (`/system/activity`)

**Org — Organisation section:**

Before: "Ops Dashboard" → `/admin/ops`
After: "Activity" → `/admin/activity`

**Subaccount — Company section:**

Before: "Activity" → `/executions` (wrong page — was the execution list, not the ops dashboard)
After: "Activity" → `/admin/subaccounts/${activeClientId}/activity`

The sidebar item guard `hasSidebarItem('ops')` on this nav entry is retained unchanged — the key `'ops'` is an internal config slug, not user-visible, and changing it would require a data migration of org module configs. No change needed.

---

## Activity Page: Feature Summary (all three scopes)

| Feature | System | Org | Subaccount |
|---------|--------|-----|------------|
| Live polling (10s) | Yes | Yes | Yes |
| Search | Yes | Yes | Yes |
| Date range filter | Yes | Yes | Yes |
| Sort (attention_first, newest, oldest, severity) | Yes | Yes | Yes |
| Column filter: Type | Yes | Yes | Yes |
| Column filter: Status | Yes | Yes | Yes |
| Column filter: Severity | Yes | Yes | Yes |
| Click-through to detail | Yes | Yes | Yes |
| Subaccount column | Yes | Yes | No |

**Activity types covered (6, post-cleanup):**

- `agent_run` → detail: `/admin/agents/:agentId/runs/:runId` (or subaccount-scoped variant)
- `review_item` → detail: `/admin/review` (or subaccount-scoped)
- `health_finding` → detail: `/admin/health`
- `inbox_item` → detail: `/admin/agent-inbox` (or subaccount-scoped)
- `playbook_run` → detail: `/subaccounts/:id/playbook-runs/:runId`
- `workflow_execution` → detail: `/executions/:id`

---

## Cleanliness Check

After implementation, these patterns must return zero results across the entire codebase:

- `ops-dashboard`
- `opsDashboard`
- `OpsDashboard`
- `SystemActivityPage`
- `ExecutionHistoryPage`
- `decision_log` (removed from `ActivityPage` type union; retained as a forward stub in `activityService.ts` `ActivityType` — both expected, check manually before flagging)
- `task_event` (same caveat)
