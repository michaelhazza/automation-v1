# Activity Page Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `opsDashboard` → `activity` end-to-end and consolidate three overlapping pages (`SystemActivityPage`, `OpsDashboardPage`, `ExecutionHistoryPage`) into a single `ActivityPage`.

**Architecture:** Pure rename and deletion — no new logic. Backend service and route files are renamed with updated import paths and endpoint strings. `ActivityPage.tsx` is created from `OpsDashboardPage.tsx` with minor type and string cleanups. Three dead page components are deleted. Routes and nav updated throughout.

**Tech Stack:** Node/Express + TypeScript (backend), React 18 + React Router v6 + TypeScript + Tailwind (frontend)

---

## Contents

- [File Map](#file-map)
- [Task 1: Rename backend service file](#task-1-rename-backend-service-file)
- [Task 2: Rename and update backend route file](#task-2-rename-and-update-backend-route-file)
- [Task 3: Update server/index.ts](#task-3-update-serverindexts)
- [Task 4: Create ActivityPage.tsx](#task-4-create-activitypagetsx)
- [Task 5: Update App.tsx routes](#task-5-update-apptsx-routes)
- [Task 6: Update Layout.tsx navigation](#task-6-update-layouttsx-navigation)
- [Task 7: Delete dead files](#task-7-delete-dead-files)
- [Task 8: Cleanliness check and final verification](#task-8-cleanliness-check-and-final-verification)

---

## File Map

| Action | File |
|--------|------|
| Create (rename from) | `server/services/activityService.ts` ← `opsDashboardService.ts` |
| Create (rename from) | `server/routes/activity.ts` ← `opsDashboard.ts` |
| Create (rename from) | `client/src/pages/ActivityPage.tsx` ← `OpsDashboardPage.tsx` |
| Modify | `server/index.ts` |
| Modify | `client/src/App.tsx` |
| Modify | `client/src/components/Layout.tsx` |
| Delete | `server/services/opsDashboardService.ts` |
| Delete | `server/routes/opsDashboard.ts` |
| Delete | `client/src/pages/OpsDashboardPage.tsx` |
| Delete | `client/src/pages/SystemActivityPage.tsx` |
| Delete | `client/src/pages/ExecutionHistoryPage.tsx` |

---

### Task 1: Rename backend service file

**Files:**
- Create: `server/services/activityService.ts`
- Delete: `server/services/opsDashboardService.ts`

- [ ] **Step 1: Copy the service file**

```bash
cp server/services/opsDashboardService.ts server/services/activityService.ts
```

- [ ] **Step 2: Verify the copy succeeded**

```bash
head -5 server/services/activityService.ts
```

Expected: same first 5 lines as `opsDashboardService.ts`.

- [ ] **Step 3: Delete the old file**

```bash
rm server/services/opsDashboardService.ts
```

- [ ] **Step 4: Verify no remaining references to the old filename**

```bash
grep -r "opsDashboardService" server/ --include="*.ts"
```

Expected: zero results. (The route file still references it — fixed in Task 2.)

- [ ] **Step 5: Commit**

```bash
git add server/services/activityService.ts server/services/opsDashboardService.ts
git commit -m "refactor: rename opsDashboardService -> activityService"
```

---

### Task 2: Rename and update backend route file

**Files:**
- Create: `server/routes/activity.ts`
- Delete: `server/routes/opsDashboard.ts`

- [ ] **Step 1: Read the current route file**

Read `server/routes/opsDashboard.ts` in full to confirm content before writing the replacement.

- [ ] **Step 2: Create `server/routes/activity.ts`**

Write this file — identical to `opsDashboard.ts` with three targeted changes (import path + three route path strings):

```typescript
import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission, requireSystemAdmin } from '../middleware/auth.js';
import { ORG_PERMISSIONS, SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { listOpsDashboardItems } from '../services/activityService.js';
import type { OpsDashboardFilters, OpsDashboardScope } from '../services/activityService.js';

const router = Router();

function parseFilters(query: Record<string, unknown>): OpsDashboardFilters {
  const asStringArray = (v: unknown): string[] | undefined => {
    if (typeof v === 'string' && v.length > 0) return v.split(',');
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
    return undefined;
  };
  return {
    type: asStringArray(query.type),
    status: asStringArray(query.status),
    from: typeof query.from === 'string' ? query.from : undefined,
    to: typeof query.to === 'string' ? query.to : undefined,
    agentId: typeof query.agentId === 'string' ? query.agentId : undefined,
    severity: asStringArray(query.severity),
    assignee: typeof query.assignee === 'string' ? query.assignee : undefined,
    q: typeof query.q === 'string' ? query.q : undefined,
    sort: (['newest', 'oldest', 'severity', 'attention_first'].includes(query.sort as string)
      ? (query.sort as OpsDashboardFilters['sort'])
      : undefined),
    limit: typeof query.limit === 'string' ? Math.max(1, Math.min(200, parseInt(query.limit, 10) || 50)) : undefined,
    offset: typeof query.offset === 'string' ? Math.max(0, parseInt(query.offset, 10) || 0) : undefined,
  };
}

router.get(
  '/api/subaccounts/:subaccountId/activity',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.EXECUTIONS_VIEW),
  asyncHandler(async (req, res) => {
    const { subaccountId } = req.params;
    const organisationId = req.orgId!;
    await resolveSubaccount(subaccountId, organisationId);
    const filters = parseFilters(req.query as Record<string, unknown>);
    const scope: OpsDashboardScope = { type: 'subaccount', subaccountId, orgId: organisationId };
    const result = await listOpsDashboardItems(filters, scope);
    res.json(result);
  }),
);

router.get(
  '/api/activity',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.EXECUTIONS_VIEW),
  asyncHandler(async (req, res) => {
    const organisationId = req.orgId!;
    const filters = parseFilters(req.query as Record<string, unknown>);
    const subaccountId = typeof req.query.subaccountId === 'string' ? req.query.subaccountId : undefined;
    const scope: OpsDashboardScope = { type: 'org', orgId: organisationId, subaccountId };
    const result = await listOpsDashboardItems(filters, scope);
    res.json(result);
  }),
);

router.get(
  '/api/system/activity',
  authenticate,
  requireSystemAdmin,
  asyncHandler(async (req, res) => {
    const filters = parseFilters(req.query as Record<string, unknown>);
    const organisationId = typeof req.query.organisationId === 'string' ? req.query.organisationId : undefined;
    const scope: OpsDashboardScope = { type: 'system', organisationId };
    const result = await listOpsDashboardItems(filters, scope);
    res.json(result);
  }),
);

export default router;
```

- [ ] **Step 3: Delete the old route file**

```bash
rm server/routes/opsDashboard.ts
```

- [ ] **Step 4: Verify no remaining `opsDashboard` strings in server/routes/**

```bash
grep -r "opsDashboard\|ops-dashboard" server/routes/ --include="*.ts"
```

Expected: zero results.

- [ ] **Step 5: Commit**

```bash
git add server/routes/activity.ts server/routes/opsDashboard.ts
git commit -m "refactor: rename opsDashboard route -> activity, update endpoint paths"
```

---

### Task 3: Update server/index.ts

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Update the import line**

Find:
```typescript
import opsDashboardRouter from './routes/opsDashboard.js';
```

Replace with:
```typescript
import activityRouter from './routes/activity.js';
```

- [ ] **Step 2: Update the router registration**

Find:
```typescript
app.use(opsDashboardRouter);
```

Replace with:
```typescript
app.use(activityRouter);
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck 2>&1 | head -30
```

Expected: no errors. Fix any before proceeding.

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "refactor: update server/index.ts to use activityRouter"
```

---

### Task 4: Create ActivityPage.tsx

**Files:**
- Create: `client/src/pages/ActivityPage.tsx`

This is `OpsDashboardPage.tsx` with six targeted edits. Read the full source file first, then apply each change.

- [ ] **Step 1: Read the source file in full**

Read `client/src/pages/OpsDashboardPage.tsx` completely. The file is ~547 lines.

- [ ] **Step 2: Apply Change 1 — Remove `decision_log` and `task_event` from `ActivityType` union**

Find (around line 9):
```typescript
type ActivityType =
  | 'agent_run'
  | 'review_item'
  | 'health_finding'
  | 'inbox_item'
  | 'decision_log'
  | 'playbook_run'
  | 'task_event'
  | 'workflow_execution';
```

Replace with:
```typescript
type ActivityType =
  | 'agent_run'
  | 'review_item'
  | 'health_finding'
  | 'inbox_item'
  | 'playbook_run'
  | 'workflow_execution';
```

- [ ] **Step 3: Apply Change 2 — Rename `OpsDashboardItem` → `ActivityItem`**

Use replace-all for the token `OpsDashboardItem` throughout the file. It appears in the type definition and in `useState` calls.

Find (around line 21):
```typescript
type OpsDashboardItem = {
```
Replace with:
```typescript
type ActivityItem = {
```

Then replace all remaining occurrences of `OpsDashboardItem` with `ActivityItem` (there will be 2–3 in useState and function signatures).

- [ ] **Step 4: Apply Change 3 — Update `ACTIVITY_TYPES` array**

Find (around line 42):
```typescript
const ACTIVITY_TYPES: ActivityType[] = [
  'agent_run', 'review_item', 'health_finding', 'inbox_item',
  'decision_log', 'playbook_run', 'task_event', 'workflow_execution',
];
```

Replace with:
```typescript
const ACTIVITY_TYPES: ActivityType[] = [
  'agent_run', 'review_item', 'health_finding', 'inbox_item',
  'playbook_run', 'workflow_execution',
];
```

- [ ] **Step 5: Apply Change 4 — Update `getEndpoint()` API paths**

Find (around line 250):
```typescript
  const getEndpoint = useCallback(() => {
    if (scope === 'subaccount') return `/api/subaccounts/${paramSubaccountId}/ops-dashboard`;
    if (scope === 'system') return '/api/system/ops-dashboard';
    return '/api/ops-dashboard';
  }, [scope, paramSubaccountId]);
```

Replace with:
```typescript
  const getEndpoint = useCallback(() => {
    if (scope === 'subaccount') return `/api/subaccounts/${paramSubaccountId}/activity`;
    if (scope === 'system') return '/api/system/activity';
    return '/api/activity';
  }, [scope, paramSubaccountId]);
```

- [ ] **Step 6: Apply Change 5 — Update page title**

Find (around line 341):
```typescript
          <h1 className="text-[22px] font-bold text-slate-900 mb-0.5">Ops Dashboard</h1>
```

Replace with:
```typescript
          <h1 className="text-[22px] font-bold text-slate-900 mb-0.5">Activity</h1>
```

- [ ] **Step 7: Apply Change 6 — Rename exported component**

Find (around line 195):
```typescript
export default function OpsDashboardPage({ user }: { user: User }) {
```

Replace with:
```typescript
export default function ActivityPage({ user }: { user: User }) {
```

- [ ] **Step 8: Save as `client/src/pages/ActivityPage.tsx`**

Write the fully edited content to `client/src/pages/ActivityPage.tsx`.

- [ ] **Step 9: Verify no `OpsDashboard` or `ops-dashboard` strings remain**

```bash
grep -n "OpsDashboard\|ops-dashboard\|decision_log\|task_event" client/src/pages/ActivityPage.tsx
```

Expected: zero results.

- [ ] **Step 10: Commit**

```bash
git add client/src/pages/ActivityPage.tsx
git commit -m "feat: create ActivityPage from OpsDashboardPage (rename + type cleanup)"
```

---

### Task 5: Update App.tsx routes

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Find the lazy imports for the three pages being removed**

```bash
grep -n "OpsDashboardPage\|SystemActivityPage\|ExecutionHistoryPage" client/src/App.tsx
```

Note the exact line numbers. There will be one lazy import line and one route line for each.

- [ ] **Step 2: Remove the three old lazy imports**

Find and delete each of these three lines (exact text):
```typescript
const OpsDashboardPage = lazy(() => import('./pages/OpsDashboardPage'));
```
```typescript
const SystemActivityPage = lazy(() => import('./pages/SystemActivityPage'));
```
```typescript
const ExecutionHistoryPage = lazy(() => import('./pages/ExecutionHistoryPage'));
```

- [ ] **Step 3: Add the ActivityPage lazy import**

In the same area as the removed imports, add:
```typescript
const ActivityPage = lazy(() => import('./pages/ActivityPage'));
```

- [ ] **Step 4: Remove the five old routes**

Find and delete each of these route blocks (with their comment lines):

```typescript
<Route path="/executions" element={<ExecutionHistoryPage user={user!} />} />
```
```typescript
<Route path="/system/activity" element={<SystemActivityPage user={user!} />} />
```
```typescript
            {/* Ops Dashboard — org scope */}
            <Route path="/admin/ops" element={<OpsDashboardPage user={user!} />} />
```
```typescript
            {/* Ops Dashboard — subaccount scope */}
            <Route path="/admin/subaccounts/:subaccountId/ops" element={<OpsDashboardPage user={user!} />} />
```
```typescript
            {/* Ops Dashboard — system scope */}
            <Route path="/system/ops" element={<OpsDashboardPage user={user!} />} />
```

- [ ] **Step 5: Add the three new routes**

Inside the authenticated route wrapper (near where `/admin/ops` was removed), add:
```typescript
            {/* Activity — org scope */}
            <Route path="/admin/activity" element={<ActivityPage user={user!} />} />
            {/* Activity — subaccount scope */}
            <Route path="/admin/subaccounts/:subaccountId/activity" element={<ActivityPage user={user!} />} />
```

Inside the `<SystemAdminGuard>` wrapper (near where `/system/ops` was removed), add:
```typescript
            {/* Activity — system scope */}
            <Route path="/system/activity" element={<ActivityPage user={user!} />} />
```

- [ ] **Step 6: Confirm `/executions/:id` route is still present**

```bash
grep -n "executions/:id" client/src/App.tsx
```

Expected: one result pointing to `ExecutionDetailPage`. Do not remove it.

- [ ] **Step 7: Run typecheck**

```bash
npm run typecheck 2>&1 | head -40
```

Expected: zero errors. Fix any before proceeding.

- [ ] **Step 8: Commit**

```bash
git add client/src/App.tsx
git commit -m "refactor: update App.tsx — consolidate ops/activity routes to ActivityPage"
```

---

### Task 6: Update Layout.tsx navigation

**Files:**
- Modify: `client/src/components/Layout.tsx`

- [ ] **Step 1: Fix the Platform section — replace two entries with one**

Find these two lines in the Platform section (system admin block):
```typescript
              <NavItem to="/system/ops" icon={<Icons.activity />} label="Ops Dashboard" />
              <NavItem to="/system/skill-studio" icon={<Icons.skills />} label="Skill Studio" />
              <NavItem to="/system/activity" icon={<Icons.activity />} label="Activity" />
```

Replace with (the two activity-related entries collapse to one; Skill Studio stays):
```typescript
              <NavItem to="/system/activity" icon={<Icons.activity />} label="Activity" />
              <NavItem to="/system/skill-studio" icon={<Icons.skills />} label="Skill Studio" />
```

- [ ] **Step 2: Fix the Organisation section — rename and reroute**

Find:
```typescript
              {hasSidebarItem('ops') && hasOrgPerm('org.executions.view') && <NavItem to="/admin/ops" icon={<Icons.activity />} label="Ops Dashboard" />}
```

Replace with:
```typescript
              {hasSidebarItem('ops') && hasOrgPerm('org.executions.view') && <NavItem to="/admin/activity" icon={<Icons.activity />} label="Activity" />}
```

- [ ] **Step 3: Fix the Subaccount (Company) section — point to unified page**

Find:
```typescript
              {hasSidebarItem('ops') && (
                <NavItem to="/executions" icon={<Icons.activity />} label="Activity" />
              )}
```

Replace with:
```typescript
              {hasSidebarItem('ops') && (
                <NavItem to={`/admin/subaccounts/${activeClientId}/activity`} icon={<Icons.activity />} label="Activity" />
              )}
```

- [ ] **Step 4: Verify no stale ops references remain in Layout.tsx**

```bash
grep -n "ops-dashboard\|opsDashboard\|/admin/ops\|/system/ops\|Ops Dashboard\|/executions\"" client/src/components/Layout.tsx
```

Expected: zero results.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Layout.tsx
git commit -m "refactor: Layout.tsx nav — rename Ops Dashboard to Activity at all three scopes"
```

---

### Task 7: Delete dead files

**Files deleted:**
- `client/src/pages/SystemActivityPage.tsx`
- `client/src/pages/ExecutionHistoryPage.tsx`
- `client/src/pages/OpsDashboardPage.tsx`

- [ ] **Step 1: Delete the three dead page files**

```bash
rm client/src/pages/SystemActivityPage.tsx
rm client/src/pages/ExecutionHistoryPage.tsx
rm client/src/pages/OpsDashboardPage.tsx
```

- [ ] **Step 2: Run typecheck to confirm no broken imports**

```bash
npm run typecheck 2>&1 | head -40
```

Expected: zero errors. If any file still imports one of the deleted pages, it was missed in Task 5 — find it with `grep -r "SystemActivityPage\|ExecutionHistoryPage\|OpsDashboardPage" client/src/` and fix it.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/SystemActivityPage.tsx client/src/pages/ExecutionHistoryPage.tsx client/src/pages/OpsDashboardPage.tsx
git commit -m "chore: delete SystemActivityPage, ExecutionHistoryPage, OpsDashboardPage"
```

---

### Task 8: Cleanliness check and final verification

- [ ] **Step 1: Run the full cleanliness grep**

```bash
grep -rn "ops-dashboard\|opsDashboard\|OpsDashboard\|SystemActivityPage\|ExecutionHistoryPage" \
  server/ client/src/ --include="*.ts" --include="*.tsx"
```

Expected: **zero results**. If any appear, fix them before proceeding.

- [ ] **Step 2: Confirm `decision_log` and `task_event` are absent from the frontend**

```bash
grep -n "decision_log\|task_event" client/src/pages/ActivityPage.tsx
```

Expected: zero results. (These terms may legitimately remain in `server/services/activityService.ts` as forward stubs — that is expected and correct.)

- [ ] **Step 3: Confirm `/executions/:id` route is intact**

```bash
grep -n "executions/:id" client/src/App.tsx
```

Expected: one result — `ExecutionDetailPage`. The Activity page links to this for `workflow_execution` rows.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 5: Run lint**

```bash
npm run lint
```

Expected: zero errors. Fix any before marking complete.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: cleanliness verification — activity page consolidation complete"
```
