# Home Dashboard Reactivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `DashboardPage` for event-driven, block-level live updates via WebSocket events, ship a reusable `<FreshnessIndicator>` component, and close the `ClientPulseDashboardPage` emitter gap.

**Architecture:** Each dashboard block subscribes to specific org-level WebSocket events (`dashboard.*`) via the existing `useSocket` hook. Events are invalidation signals only — they trigger a block-level HTTP refetch rather than applying payload data directly. Consistency groups (blocks sharing underlying data) refetch together using `Promise.all` and apply state atomically. A `serverTimestamp` envelope on API responses enables latest-data-wins ordering via the `applyIfNewer` guard.

**Tech Stack:** React (hooks, `useRef`, `useCallback`, `useState`), TypeScript, existing `useSocket` / `useSocketRoom` / `useSocketConnected` hooks from `client/src/hooks/useSocket.ts`, existing `emitOrgUpdate` / `emitToSysadmin` from `server/websocket/emitters.ts`, CSS keyframes for pulse animation.

---

## Spec-to-codebase corrections (read before implementing)

The spec references these files by incorrect names — use the actual paths below:

| Spec name | Actual file |
|---|---|
| `server/routes/agentActivity.ts` | `server/routes/agentRuns.ts` |
| `server/routes/system.ts` | `server/routes/jobQueue.ts` |
| `server/routes/clientpulse.ts` (health-summary route) | `server/routes/clientpulseReports.ts` |

The ClientPulse **emitter** location (`dashboard.client.health.changed` + `dashboard:update`) must be found by grepping — the mutation path may be in a service, not a route handler.

---

## File structure

### New files

| File | Responsibility |
|---|---|
| `client/src/components/dashboard/FreshnessIndicator.tsx` | Freshness component + `formatAge` pure function |
| `client/src/components/dashboard/OperationalMetricsPlaceholder.tsx` | Renders `null` — layout reservation for Piece 3 |
| `client/src/components/dashboard/QueueHealthSummary.tsx` | Extracted from `DashboardPage`, adds `refreshToken` prop |
| `client/src/components/dashboard/__tests__/freshnessIndicator.test.ts` | `formatAge` unit tests |
| `client/src/pages/__tests__/dashboardVersioning.test.ts` | `applyIfNewer` unit tests |
| `client/src/components/__tests__/activityFeedMerge.test.ts` | `mergeActivityItems` unit tests |

### Modified files — client

| File | What changes |
|---|---|
| `client/src/pages/DashboardPage.tsx` | Socket subscriptions, refetch functions, version tracking, `<FreshnessIndicator>`, layout slot, `refreshToken` + `expectedTimestamp` on `<UnifiedActivityFeed>` |
| `client/src/components/UnifiedActivityFeed.tsx` | Add `refreshToken?: number` + `expectedTimestamp?: string` props; add `mergeActivityItems` pure function; export `mergeActivityItems` for tests |

### Modified files — server (routes)

| File | What changes |
|---|---|
| `server/routes/pulse.ts` | Wrap `/api/pulse/attention` response in `{ data, serverTimestamp }` |
| `server/routes/agentRuns.ts` | Wrap `/api/agent-activity/stats` response in `{ data, serverTimestamp }` |
| `server/routes/clientpulseReports.ts` | Wrap `/api/clientpulse/health-summary` response in `{ data, serverTimestamp }` |
| `server/routes/activity.ts` | Wrap `/api/activity` response in `{ data, serverTimestamp }` |
| `server/routes/jobQueue.ts` | Wrap `/api/system/job-queues` response in `{ data, serverTimestamp }` |

### Modified files — server (emitters)

| File | What changes |
|---|---|
| `server/routes/reviewItems.ts` | Add `emitOrgUpdate(orgId, 'dashboard.approval.changed', {...})` after approve + reject + new-item creation |
| `server/services/agentRunFinalizationService.ts` | Add `emitOrgUpdate(orgId, 'dashboard.activity.updated', {...})` for terminal non-sub-agent runs |
| `server/services/workflowEngineService.ts` | Add `emitOrgUpdate(run.orgId, 'dashboard.activity.updated', {...})` for terminal workflow statuses |
| ClientPulse mutation path (grep to confirm) | Add `emitOrgUpdate` for both `dashboard.client.health.changed` and `dashboard:update` |
| `server/routes/jobQueue.ts` (or mutation service) | Add `emitToSysadmin('dashboard.queue.changed', 'system', {...})` — best-effort |

### Modified files — consumer updates (breaking API shape change)

| File | What changes |
|---|---|
| `client/src/hooks/usePulseAttention.ts` | Read `res.data` instead of `res` for pulse attention |
| `client/src/pages/ActivityPage.tsx` | Read `res.data` instead of `res` for activity list |
| `client/src/components/pulse/HistoryTab.tsx` | Read `res.data` instead of `res` for activity list |
| `client/src/pages/ClientPulseDashboardPage.tsx` | Read `res.data` for health-summary + remove toast from `dashboard:update` handler |
| `client/src/pages/JobQueueDashboardPage.tsx` | Read `res.data` for job-queues |

---

<!-- TASKS START HERE -->

## Task 1: Write failing tests — `formatAge` and `applyIfNewer`

**Files:**
- Create: `client/src/components/dashboard/__tests__/freshnessIndicator.test.ts`
- Create: `client/src/pages/__tests__/dashboardVersioning.test.ts`

- [ ] **Step 1.1: Create the `formatAge` test file**

```typescript
// client/src/components/dashboard/__tests__/freshnessIndicator.test.ts
import assert from 'node:assert';

// Import fails until FreshnessIndicator.tsx is created in Task 2.
// Run this test now to confirm it fails with "Cannot find module".
import { formatAge } from '../FreshnessIndicator.js';

const t = (isoBase: string) => new Date(isoBase);
const now = t('2026-04-27T10:00:00.000Z');

function check(secsAgo: number, expected: string) {
  const lastUpdatedAt = new Date(now.getTime() - secsAgo * 1000);
  const result = formatAge(lastUpdatedAt, now);
  assert.strictEqual(result, expected, `formatAge(${secsAgo}s ago) → expected "${expected}", got "${result}"`);
}

check(0,    'updated just now');
check(5,    'updated just now');
check(10,   'updated 10s ago');
check(59,   'updated 59s ago');
check(60,   'updated 1m ago');
check(90,   'updated 1m ago');
check(3599, 'updated 59m ago');
check(3600, 'updated 1h ago');
check(7200, 'updated 2h ago');

console.log('✓ formatAge tests passed');
```

- [ ] **Step 1.2: Run `formatAge` test — confirm it fails**

```bash
npx tsx client/src/components/dashboard/__tests__/freshnessIndicator.test.ts
```

Expected: Error — `Cannot find module '../FreshnessIndicator.js'`

- [ ] **Step 1.3: Create the `applyIfNewer` test file**

```typescript
// client/src/pages/__tests__/dashboardVersioning.test.ts
import assert from 'node:assert';

// applyIfNewer is a module-internal helper in DashboardPage.tsx.
// We reproduce the function here to test its contract.
function applyIfNewer(
  currentTs: { current: string },
  incomingTs: string,
  apply: () => void
): void {
  if (incomingTs > currentTs.current) {
    currentTs.current = incomingTs;
    apply();
  }
}

// Scenario 1: newer response — apply() called, currentTs updated
{
  const ts = { current: '2026-04-27T10:00:00.000Z' };
  let called = false;
  applyIfNewer(ts, '2026-04-27T10:00:01.000Z', () => { called = true; });
  assert.ok(called, 'newer: apply() should be called');
  assert.strictEqual(ts.current, '2026-04-27T10:00:01.000Z', 'newer: currentTs should update');
}

// Scenario 2: older response — apply() NOT called, currentTs unchanged
{
  const ts = { current: '2026-04-27T10:00:01.000Z' };
  let called = false;
  applyIfNewer(ts, '2026-04-27T10:00:00.000Z', () => { called = true; });
  assert.ok(!called, 'older: apply() should not be called');
  assert.strictEqual(ts.current, '2026-04-27T10:00:01.000Z', 'older: currentTs should not change');
}

// Scenario 3: equal timestamp — apply() NOT called (strict >)
{
  const ts = { current: '2026-04-27T10:00:00.000Z' };
  let called = false;
  applyIfNewer(ts, '2026-04-27T10:00:00.000Z', () => { called = true; });
  assert.ok(!called, 'equal: apply() should not be called');
}

// Scenario 4: empty initial state — any timestamp beats ''
{
  const ts = { current: '' };
  let called = false;
  applyIfNewer(ts, '2026-04-27T10:00:00.000Z', () => { called = true; });
  assert.ok(called, 'empty: apply() should be called');
  assert.strictEqual(ts.current, '2026-04-27T10:00:00.000Z', 'empty: currentTs should update');
}

console.log('✓ applyIfNewer tests passed');
```

- [ ] **Step 1.4: Run `applyIfNewer` test — confirm it passes immediately**

`applyIfNewer` is defined inline in the test file, so it passes without any implementation work.

```bash
npx tsx client/src/pages/__tests__/dashboardVersioning.test.ts
```

Expected: `✓ applyIfNewer tests passed`

- [ ] **Step 1.5: Commit**

```bash
git add client/src/components/dashboard/__tests__/freshnessIndicator.test.ts client/src/pages/__tests__/dashboardVersioning.test.ts
git commit -m "test: add failing formatAge test and passing applyIfNewer test"
```

## Task 2: Implement `formatAge` — make its test pass

**Files:**
- Create: `client/src/components/dashboard/FreshnessIndicator.tsx` (stub — full component in Task 5)

- [ ] **Step 2.1: Create `FreshnessIndicator.tsx` with just the `formatAge` export**

```typescript
// client/src/components/dashboard/FreshnessIndicator.tsx
import { useEffect, useRef, useState } from 'react';

const PULSE_DEBOUNCE_MS = 1_500;
const PULSE_DURATION_MS = 600;

export function formatAge(lastUpdatedAt: Date, now = new Date()): string {
  const seconds = Math.floor((now.getTime() - lastUpdatedAt.getTime()) / 1000);
  if (seconds < 10) return 'updated just now';
  if (seconds < 60) return `updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `updated ${hours}h ago`;
}

// Full component body added in Task 5.
export function FreshnessIndicator(_props: { lastUpdatedAt: Date }): null {
  return null;
}
```

- [ ] **Step 2.2: Run `formatAge` test — confirm it passes**

```bash
npx tsx client/src/components/dashboard/__tests__/freshnessIndicator.test.ts
```

Expected: `✓ formatAge tests passed`

- [ ] **Step 2.3: Commit**

```bash
git add client/src/components/dashboard/FreshnessIndicator.tsx
git commit -m "feat: add formatAge pure function (FreshnessIndicator stub)"
```

## Task 3: Write failing test — `mergeActivityItems`

**Files:**
- Create: `client/src/components/__tests__/activityFeedMerge.test.ts`

- [ ] **Step 3.1: Create the test file**

```typescript
// client/src/components/__tests__/activityFeedMerge.test.ts
import assert from 'node:assert';

// Import fails until mergeActivityItems is exported from UnifiedActivityFeed in Task 7.
import { mergeActivityItems } from '../UnifiedActivityFeed.js';

type Item = { id: string; updatedAt: string; subject: string };

const item = (id: string, updatedAt: string, subject = 'x'): Item =>
  ({ id, updatedAt, subject });

// Scenario 1: new item not in existing list — prepended at top
{
  const existing: Item[] = [item('b', '2026-04-27T10:00:01.000Z')];
  const incoming: Item[] = [item('a', '2026-04-27T10:00:02.000Z')];
  const result = mergeActivityItems(existing, incoming);
  assert.strictEqual(result[0].id, 'a', 'new item should be prepended');
  assert.strictEqual(result[1].id, 'b', 'existing item should follow');
  assert.strictEqual(result.length, 2, 'no duplicates');
}

// Scenario 2: same ID, newer updatedAt — replaces existing row in-place
{
  const existing: Item[] = [item('a', '2026-04-27T10:00:00.000Z', 'old')];
  const incoming: Item[] = [item('a', '2026-04-27T10:00:01.000Z', 'new')];
  const result = mergeActivityItems(existing, incoming);
  assert.strictEqual(result.length, 1, 'no duplicates on update');
  assert.strictEqual(result[0].subject, 'new', 'updated row should replace old');
}

// Scenario 3: same ID, equal updatedAt — existing row unchanged
{
  const existing: Item[] = [item('a', '2026-04-27T10:00:00.000Z', 'old')];
  const incoming: Item[] = [item('a', '2026-04-27T10:00:00.000Z', 'new')];
  const result = mergeActivityItems(existing, incoming);
  assert.strictEqual(result[0].subject, 'old', 'equal updatedAt: existing row unchanged');
}

// Scenario 4: same ID, older updatedAt — existing row unchanged
{
  const existing: Item[] = [item('a', '2026-04-27T10:00:01.000Z', 'old')];
  const incoming: Item[] = [item('a', '2026-04-27T10:00:00.000Z', 'stale')];
  const result = mergeActivityItems(existing, incoming);
  assert.strictEqual(result[0].subject, 'old', 'older updatedAt: existing row unchanged');
}

// Scenario 5: overlapping IDs in two responses — no duplicates
{
  const existing: Item[] = [item('a', '2026-04-27T10:00:00.000Z'), item('b', '2026-04-27T10:00:00.000Z')];
  const incoming: Item[] = [item('b', '2026-04-27T10:00:01.000Z'), item('c', '2026-04-27T10:00:01.000Z')];
  const result = mergeActivityItems(existing, incoming);
  const ids = result.map(r => r.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'no duplicate IDs');
  assert.ok(ids.includes('a') && ids.includes('b') && ids.includes('c'), 'all IDs present');
}

console.log('✓ mergeActivityItems tests passed');
```

- [ ] **Step 3.2: Run test — confirm it fails**

```bash
npx tsx client/src/components/__tests__/activityFeedMerge.test.ts
```

Expected: Error — `Cannot find module '../UnifiedActivityFeed.js'` or `mergeActivityItems is not exported`

- [ ] **Step 3.3: Commit**

```bash
git add client/src/components/__tests__/activityFeedMerge.test.ts
git commit -m "test: add failing mergeActivityItems test"
```

## Task 4: Create `OperationalMetricsPlaceholder` component

**Files:**
- Create: `client/src/components/dashboard/OperationalMetricsPlaceholder.tsx`

- [ ] **Step 4.1: Create the file**

```typescript
// client/src/components/dashboard/OperationalMetricsPlaceholder.tsx
// Piece 3 layout reservation — renders nothing until operational metrics are built.
export function OperationalMetricsPlaceholder(): null {
  return null;
}
```

- [ ] **Step 4.2: Commit**

```bash
git add client/src/components/dashboard/OperationalMetricsPlaceholder.tsx
git commit -m "feat: add OperationalMetricsPlaceholder layout reservation (Piece 3)"
```

## Task 5: Create `FreshnessIndicator` component

**Files:**
- Modify: `client/src/components/dashboard/FreshnessIndicator.tsx` (replace the stub from Task 2)

- [ ] **Step 5.1: Check existing Tailwind animate-* conventions**

Run `grep -r "animate-" client/src/components --include="*.tsx" | head -10` to confirm whether the project uses Tailwind animation utilities or custom CSS keyframes. Use whichever convention you see.

- [ ] **Step 5.2: Add the `freshness-pulse` keyframe to the global stylesheet**

Find the global CSS file (likely `client/src/index.css` or `client/src/globals.css`). Add:

```css
@keyframes freshness-pulse {
  0%   { opacity: 1; }
  50%  { opacity: 0.4; }
  100% { opacity: 1; }
}

.freshness-pulse {
  animation: freshness-pulse 0.6s ease-in-out;
}
```

If the project uses Tailwind `theme.extend.keyframes` instead, add the keyframe there and reference it via a `animate-freshness-pulse` class — match the pattern you found in Step 5.1.

- [ ] **Step 5.3: Replace the `FreshnessIndicator` stub with the full component**

```typescript
// client/src/components/dashboard/FreshnessIndicator.tsx
import { useCallback, useEffect, useRef, useState } from 'react';

const PULSE_DEBOUNCE_MS = 1_500;
const PULSE_DURATION_MS = 600;

export function formatAge(lastUpdatedAt: Date, now = new Date()): string {
  const seconds = Math.floor((now.getTime() - lastUpdatedAt.getTime()) / 1000);
  if (seconds < 10) return 'updated just now';
  if (seconds < 60) return `updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `updated ${hours}h ago`;
}

interface FreshnessIndicatorProps {
  lastUpdatedAt: Date;
}

export function FreshnessIndicator({ lastUpdatedAt }: FreshnessIndicatorProps): JSX.Element {
  const [displayText, setDisplayText] = useState(() => formatAge(lastUpdatedAt));
  const [pulsing, setPulsing] = useState(false);
  const pulseDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refresh the displayed text every 5 seconds.
  useEffect(() => {
    setDisplayText(formatAge(lastUpdatedAt));
    const interval = setInterval(() => {
      setDisplayText(formatAge(lastUpdatedAt));
    }, 5_000);
    return () => clearInterval(interval);
  }, [lastUpdatedAt]);

  // Debounced pulse animation: fires 1500ms after the last prop change.
  useEffect(() => {
    if (pulseDebounce.current) clearTimeout(pulseDebounce.current);
    pulseDebounce.current = setTimeout(() => {
      setPulsing(true);
      setTimeout(() => setPulsing(false), PULSE_DURATION_MS);
    }, PULSE_DEBOUNCE_MS);
    return () => {
      if (pulseDebounce.current) clearTimeout(pulseDebounce.current);
    };
  }, [lastUpdatedAt]);

  return (
    <p className={`text-xs text-muted-foreground${pulsing ? ' freshness-pulse' : ''}`}>
      {displayText}
    </p>
  );
}
```

- [ ] **Step 5.4: Re-run `formatAge` test — confirm it still passes**

```bash
npx tsx client/src/components/dashboard/__tests__/freshnessIndicator.test.ts
```

Expected: `✓ formatAge tests passed`

- [ ] **Step 5.5: Commit**

```bash
git add client/src/components/dashboard/FreshnessIndicator.tsx client/src/index.css
git commit -m "feat: implement FreshnessIndicator component with debounced pulse animation"
```

(Replace `client/src/index.css` with the actual global stylesheet path if different.)

## Task 6: Extract `QueueHealthSummary` to standalone file with `refreshToken` prop

**Files:**
- Create: `client/src/components/dashboard/QueueHealthSummary.tsx`
- Modify: `client/src/pages/DashboardPage.tsx` — remove the local `QueueHealthSummary` function at lines 237–271; add import

> **Note:** This task also converts the fetch to consume the new `serverTimestamp` envelope (from Task 8). Since this is a new file, write it with the new shape from the start — it will compile once Task 8 is complete. TypeScript will flag it until then; that is expected.

- [ ] **Step 6.1: Create `client/src/components/dashboard/QueueHealthSummary.tsx`**

```typescript
// client/src/components/dashboard/QueueHealthSummary.tsx
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';

interface TimestampedResponse<T> {
  data: T;
  serverTimestamp: string;
}

type QueueRow = { pending: number; dlqDepth: number; failed: number };
type QueueSummary = { pending: number; dlq: number; failed: number };

interface QueueHealthSummaryProps {
  refreshToken?: number;
}

export function QueueHealthSummary({ refreshToken }: QueueHealthSummaryProps) {
  const [summary, setSummary] = useState<QueueSummary | null>(null);
  const latestTs = useRef<string>('');

  useEffect(() => {
    api.get<TimestampedResponse<QueueRow[]>>('/api/system/job-queues')
      .then(res => {
        const incoming = res.data.serverTimestamp;
        if (incoming <= latestTs.current) return;
        latestTs.current = incoming;
        const queues = res.data.data;
        setSummary({
          pending: queues.reduce((s, q) => s + q.pending, 0),
          dlq:     queues.reduce((s, q) => s + q.dlqDepth, 0),
          failed:  queues.reduce((s, q) => s + q.failed, 0),
        });
      })
      .catch(() => {});
  }, [refreshToken]);

  if (!summary) return null;

  const color = summary.dlq > 0 || summary.failed > 10
    ? 'border-amber-200 bg-amber-50'
    : 'border-green-200 bg-green-50';

  return (
    <Link to="/system/job-queues" className="no-underline block mb-4">
      <div className={`border rounded-xl px-5 py-3 flex items-center gap-6 ${color}`}>
        <div className="text-[13px] font-semibold text-slate-700">Queue Health</div>
        <div className="flex gap-4 text-[12px]">
          <span className="text-slate-500">
            Pending: <span className="font-semibold text-slate-700">{summary.pending}</span>
          </span>
          <span className={summary.dlq > 0 ? 'text-amber-600' : 'text-slate-500'}>
            DLQ: <span className="font-semibold">{summary.dlq}</span>
          </span>
          <span className={summary.failed > 10 ? 'text-red-600' : 'text-slate-500'}>
            Failed (24h): <span className="font-semibold">{summary.failed}</span>
          </span>
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 6.2: Remove local `QueueHealthSummary` from `DashboardPage.tsx` and add import**

In `client/src/pages/DashboardPage.tsx`:

1. Delete lines 235–271 (the `// ── Queue Health Summary` comment block and the entire `function QueueHealthSummary() { ... }` at the bottom of the file).

2. Add this import near the top with the other dashboard component imports:

```typescript
import { QueueHealthSummary } from '../components/dashboard/QueueHealthSummary';
```

The existing render site (`{user.role === 'system_admin' && <QueueHealthSummary />}`) continues to compile — the component name and no-arg signature are compatible. The `refreshToken` prop will be wired in Task 17.

- [ ] **Step 6.3: Commit**

```bash
git add client/src/components/dashboard/QueueHealthSummary.tsx client/src/pages/DashboardPage.tsx
git commit -m "refactor: extract QueueHealthSummary to standalone component with refreshToken prop"
```

## Task 7: Update `UnifiedActivityFeed` — add props + `mergeActivityItems`

**Files:**
- Modify: `client/src/components/UnifiedActivityFeed.tsx`

> **Note:** This task also updates the initial fetch to consume the new `serverTimestamp` envelope. Both the merge fetch and initial fetch are updated here atomically, since they're in the same file.

- [ ] **Step 7.1: Add `mergeActivityItems` pure function above the main component**

Insert after the `relativeTime` helper (after line 222) and before `// Main component`:

```typescript
// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

export function mergeActivityItems(
  existing: ActivityItem[],
  incoming: ActivityItem[],
): ActivityItem[] {
  const byId = new Map(existing.map(item => [item.id, item]));
  const newIds: string[] = [];

  for (const item of incoming) {
    const current = byId.get(item.id);
    if (!current) {
      newIds.push(item.id);
      byId.set(item.id, item);
    } else if (item.updatedAt > current.updatedAt) {
      byId.set(item.id, item);
    }
    // equal or older: skip
  }

  const prepended = incoming.filter(i => newIds.includes(i.id));
  const updated   = existing.map(item => byId.get(item.id)!);
  return [...prepended, ...updated];
}
```

- [ ] **Step 7.2: Update `UnifiedActivityFeedProps` and main component signature**

Replace the existing props interface:

```typescript
// Before:
export interface UnifiedActivityFeedProps {
  orgId: string;
  limit?: number;
}

// After:
export interface UnifiedActivityFeedProps {
  orgId: string;
  limit?: number;
  refreshToken?: number;
  expectedTimestamp?: string;
}
```

Update the component signature to destructure the new props:

```typescript
// Before:
export default function UnifiedActivityFeed({
  orgId: _orgId,
  limit = 20,
}: UnifiedActivityFeedProps) {

// After:
export default function UnifiedActivityFeed({
  orgId: _orgId,
  limit = 20,
  refreshToken,
  expectedTimestamp,
}: UnifiedActivityFeedProps) {
```

- [ ] **Step 7.3: Update the initial fetch to consume the `serverTimestamp` envelope**

Inside the existing `fetchActivity` async function, replace the `api.get` call:

```typescript
// Before:
const { data } = await api.get<{ items: ActivityItem[]; total: number }>(
  '/api/activity',
  { params: { limit, sort: 'newest' } },
);
if (cancelled) return;
const fetched: ActivityItem[] = data.items ?? [];
setItems(fetched);

// After:
const res = await api.get<{ data: { items: ActivityItem[]; total: number }; serverTimestamp: string }>(
  '/api/activity',
  { params: { limit, sort: 'newest' } },
);
if (cancelled) return;
const fetched: ActivityItem[] = res.data.data.items ?? [];
setItems(fetched);
```

- [ ] **Step 7.4: Add a `refreshToken`-triggered merge effect**

Insert this new `useEffect` after the existing one (after line 285, before `// Determine table columns`):

```typescript
  // Re-fetch and merge when DashboardPage signals an activity update.
  // Skipped when refreshToken is 0 (initial value) or undefined.
  useEffect(() => {
    if (!refreshToken) return;
    let cancelled = false;

    async function fetchAndMerge() {
      try {
        const res = await api.get<{ data: { items: ActivityItem[]; total: number }; serverTimestamp: string }>(
          '/api/activity',
          { params: { limit, sort: 'newest' } },
        );
        if (cancelled) return;
        if (expectedTimestamp && res.data.serverTimestamp < expectedTimestamp) return; // stale
        const incoming: ActivityItem[] = res.data.data.items ?? [];
        setItems(prev => mergeActivityItems(prev, incoming));
      } catch {
        // silent — existing items remain
      }
    }

    void fetchAndMerge();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);
```

- [ ] **Step 7.5: Run `mergeActivityItems` test — confirm it passes**

```bash
npx tsx client/src/components/__tests__/activityFeedMerge.test.ts
```

Expected: `✓ mergeActivityItems tests passed`

- [ ] **Step 7.6: Commit**

```bash
git add client/src/components/UnifiedActivityFeed.tsx
git commit -m "feat: add refreshToken/expectedTimestamp props and mergeActivityItems to UnifiedActivityFeed"
```

## Task 8: Add `serverTimestamp` envelope to all five server routes

**Files:**
- Modify: `server/routes/pulse.ts`
- Modify: `server/routes/agentRuns.ts`
- Modify: `server/routes/clientpulseReports.ts`
- Modify: `server/routes/activity.ts`
- Modify: `server/routes/jobQueue.ts`

> **Breaking change:** All consumers of these endpoints must be updated in Task 9 before the app compiles correctly. Do not run the dev server or typecheck between Task 8 and Task 9 — do both tasks before checking.

- [ ] **Step 8.1: Wrap `GET /api/pulse/attention` response — `server/routes/pulse.ts` line 22**

```typescript
// Before:
res.json(data);

// After:
res.json({ data, serverTimestamp: new Date().toISOString() });
```

- [ ] **Step 8.2: Wrap `GET /api/agent-activity/stats` response — `server/routes/agentRuns.ts` line 367**

```typescript
// Before:
res.json(stats);

// After:
res.json({ data: stats, serverTimestamp: new Date().toISOString() });
```

- [ ] **Step 8.3: Wrap `GET /api/clientpulse/health-summary` — `server/routes/clientpulseReports.ts` lines 65-80**

Replace all three `res.json(...)` calls in the handler (including both null early-returns) so the response shape is always `{ data, serverTimestamp }`:

```typescript
// Before (entire handler body):
asyncHandler(async (req, res) => {
  const orgId = req.orgId;
  if (!orgId) {
    res.json(null);
    return;
  }
  const latest = await reportService.getLatestReport(orgId);
  if (!latest) {
    res.json(null);
    return;
  }
  res.json({
    totalClients: latest.totalClients,
    healthy: latest.healthyCount,
    attention: latest.attentionCount,
    atRisk: latest.atRiskCount,
  });
})

// After:
asyncHandler(async (req, res) => {
  const orgId = req.orgId;
  if (!orgId) {
    res.json({ data: null, serverTimestamp: new Date().toISOString() });
    return;
  }
  const latest = await reportService.getLatestReport(orgId);
  if (!latest) {
    res.json({ data: null, serverTimestamp: new Date().toISOString() });
    return;
  }
  res.json({
    data: {
      totalClients: latest.totalClients,
      healthy: latest.healthyCount,
      attention: latest.attentionCount,
      atRisk: latest.atRiskCount,
    },
    serverTimestamp: new Date().toISOString(),
  });
})
```

- [ ] **Step 8.4: Wrap `GET /api/activity` response — `server/routes/activity.ts` line 73**

```typescript
// Before:
res.json(result);

// After:
res.json({ data: result, serverTimestamp: new Date().toISOString() });
```

- [ ] **Step 8.5: Wrap `GET /api/system/job-queues` response — `server/routes/jobQueue.ts` line 16**

```typescript
// Before:
res.json(summaries);

// After:
res.json({ data: summaries, serverTimestamp: new Date().toISOString() });
```

- [ ] **Step 8.6: Commit (do NOT typecheck yet — consumers updated in Task 9)**

```bash
git add server/routes/pulse.ts server/routes/agentRuns.ts server/routes/clientpulseReports.ts server/routes/activity.ts server/routes/jobQueue.ts
git commit -m "feat: add serverTimestamp envelope to five watched API endpoints"
```

## Task 9: Update all client consumers of the five modified endpoints

**Files:**
- Modify: `client/src/pages/DashboardPage.tsx`
- Modify: `client/src/hooks/usePulseAttention.ts`
- Modify: `client/src/pages/ActivityPage.tsx`
- Modify: `client/src/components/pulse/HistoryTab.tsx`
- Modify: `client/src/pages/ClientPulseDashboardPage.tsx`
- Modify: `client/src/pages/JobQueueDashboardPage.tsx`

Run the grep commands below first to catch any consumer you missed:

```bash
grep -rn "/api/activity" client/src --include="*.ts" --include="*.tsx"
grep -rn "/api/pulse/attention" client/src --include="*.ts" --include="*.tsx"
grep -rn "/api/agent-activity/stats" client/src --include="*.ts" --include="*.tsx"
grep -rn "/api/clientpulse/health-summary" client/src --include="*.ts" --include="*.tsx"
grep -rn "/api/system/job-queues" client/src --include="*.ts" --include="*.tsx"
```

Update every match found. The pattern is always the same: `res.data` → `res.data.data` (one level deeper into the new envelope).

- [ ] **Step 9.1: Update `DashboardPage.tsx` — initial fetch `.then` handler**

The `Promise.all` result handlers at lines 40–44. Also update the catch handlers that return mock response objects:

```typescript
// Before — Promise.all .catch handlers:
api.get('/api/agent-activity/stats', { params: { sinceDays: 7 } }).catch((err) => {
  console.error('[Dashboard] Failed to fetch activity stats:', err);
  return { data: null };
}),
api.get('/api/pulse/attention').catch((err) => {
  console.error('[Dashboard] Failed to fetch pulse attention:', err);
  return { data: null };
}),
api.get('/api/clientpulse/health-summary').catch(() => { return { data: null }; }),

// After:
api.get('/api/agent-activity/stats', { params: { sinceDays: 7 } }).catch((err) => {
  console.error('[Dashboard] Failed to fetch activity stats:', err);
  return { data: { data: null, serverTimestamp: '' } };
}),
api.get('/api/pulse/attention').catch((err) => {
  console.error('[Dashboard] Failed to fetch pulse attention:', err);
  return { data: { data: null, serverTimestamp: '' } };
}),
api.get('/api/clientpulse/health-summary').catch(() => {
  return { data: { data: null, serverTimestamp: '' } };
}),
```

```typescript
// Before — .then destructure:
.then(([a, s, p, h]) => {
  setAgents(a.data);
  setStats(s.data);
  setAttention(p.data);
  setHealthSummary(h.data);
})

// After:
.then(([a, s, p, h]) => {
  setAgents(a.data);
  setStats(s.data.data);
  setAttention(p.data.data);
  setHealthSummary(h.data.data);
})
```

- [ ] **Step 9.2: Update `usePulseAttention.ts` line 64**

The hook fetches two different endpoints depending on scope. Only the org-scope endpoint (`/api/pulse/attention`) has changed. Use scope-conditioned access so the subaccount route continues to work:

```typescript
// Before:
const res = await api.get(url);
setData(res.data);

// After:
const res = await api.get(url);
const payload = scope === 'org'
  ? (res.data as { data: typeof res.data; serverTimestamp: string }).data
  : res.data;
setData(payload);
```

Or, if TypeScript inference makes the cast awkward, type it explicitly:

```typescript
const payload: PulseAttentionResponse | null =
  scope === 'org' ? res.data.data : res.data;
setData(payload);
```

- [ ] **Step 9.3: Update `ActivityPage.tsx` — find its `/api/activity` fetch**

Open `client/src/pages/ActivityPage.tsx`. Find the `api.get('/api/activity', ...)` call. Change `res.data` (or `data` from a destructured `{ data }`) to access the new envelope:

```typescript
// Before (pattern — your actual code may differ):
const { data } = await api.get('/api/activity', { params: ... });
setItems(data.items);

// After:
const res = await api.get('/api/activity', { params: ... });
setItems(res.data.data.items);
// or if the response is the array directly:
// setItems(res.data.data);
```

Confirm the exact field name against the `result` shape returned by `listActivityItems` in `server/routes/activity.ts`.

- [ ] **Step 9.4: Update `HistoryTab.tsx` — find its `/api/activity` fetch**

Open `client/src/components/pulse/HistoryTab.tsx`. Apply the same `res.data` → `res.data.data` pattern as Step 9.3.

- [ ] **Step 9.5: Update `ClientPulseDashboardPage.tsx` — health-summary fetch**

Open `client/src/pages/ClientPulseDashboardPage.tsx`. Find the `api.get('/api/clientpulse/health-summary', ...)` call (around line 59 per the explore). Change `res.data` → `res.data.data`. The rest of the component (including the `dashboard:update` handler) is updated in Task 13 and Task 19.

- [ ] **Step 9.6: Update `JobQueueDashboardPage.tsx` — job-queues fetch**

Open `client/src/pages/JobQueueDashboardPage.tsx`. Find the `api.get('/api/system/job-queues', ...)` call. Change `res.data` → `res.data.data`.

- [ ] **Step 9.7: Run typecheck — confirm all five endpoints' consumers are correct**

```bash
npx tsc --noEmit
```

Expected: 0 errors. Fix any `res.data` type mismatches before proceeding.

- [ ] **Step 9.8: Commit**

```bash
git add client/src/pages/DashboardPage.tsx client/src/hooks/usePulseAttention.ts client/src/pages/ActivityPage.tsx client/src/components/pulse/HistoryTab.tsx client/src/pages/ClientPulseDashboardPage.tsx client/src/pages/JobQueueDashboardPage.tsx
git commit -m "feat: update all consumers to read serverTimestamp envelope from five API endpoints"
```

## Task 10: Server emitter — `dashboard.approval.changed` in `reviewItems.ts`

**Files:**
- Modify: `server/routes/reviewItems.ts`

`emitOrgUpdate` signature: `emitOrgUpdate(orgId: string, event: string, data: Record<string, unknown>): void` — import from `server/websocket/emitters.ts` if not already imported.

`orgId` in this file: `req.orgId!` — already used elsewhere in the file. Confirm the exact variable usage at the approve and reject sites (the explore found it at lines 85, 106, 108, etc.).

- [ ] **Step 10.1: Add `emitOrgUpdate` import if not already present**

```typescript
import { emitOrgUpdate, emitSubaccountUpdate } from '../websocket/emitters';
```

Check if `emitOrgUpdate` is already imported. If only `emitSubaccountUpdate` is imported, add `emitOrgUpdate` to the same import.

- [ ] **Step 10.2: Add `dashboard.approval.changed` emit after the approve `emitSubaccountUpdate` (line ~176)**

```typescript
// Existing line (do not remove):
if (subaccountId) emitSubaccountUpdate(subaccountId, 'review:item_updated', { action: 'approved' });

// Add immediately after:
emitOrgUpdate(req.orgId!, 'dashboard.approval.changed', {
  action: 'approved',
  subaccountId: subaccountId ?? null,
});
```

- [ ] **Step 10.3: Add `dashboard.approval.changed` emit after the reject `emitSubaccountUpdate` (line ~224)**

```typescript
// Existing line (do not remove):
if (subaccountId) emitSubaccountUpdate(subaccountId, 'review:item_updated', { action: 'rejected' });

// Add immediately after:
emitOrgUpdate(req.orgId!, 'dashboard.approval.changed', {
  action: 'rejected',
  subaccountId: subaccountId ?? null,
});
```

- [ ] **Step 10.4: Find and add the `action: 'new'` emit on review item creation**

Grep for the item-creation path: `grep -n "review.*creat\|insert.*review\|new.*review" server/routes/reviewItems.ts`. If there is a POST handler that creates a review item, add the emit there:

```typescript
emitOrgUpdate(req.orgId!, 'dashboard.approval.changed', {
  action: 'new',
  subaccountId: subaccountId ?? null,
});
```

If creation happens in a service called by this route, add the emit in that service instead. If there is no creation path in this route file, document it in the PR description as a known gap.

- [ ] **Step 10.5: Commit**

```bash
git add server/routes/reviewItems.ts
git commit -m "feat: emit dashboard.approval.changed on review item approve, reject, and new"
```

## Task 11: Server emitter — `dashboard.activity.updated` in `agentRunFinalizationService.ts`

**Files:**
- Modify: `server/services/agentRunFinalizationService.ts`

Key facts from codebase exploration:
- `emitAgentRunUpdate` call is at line ~375 (inside `finaliseAgentRunFromIeeRun()`)
- `parentIsSubAgent` is assigned at line 259 from `parent.isSubAgent ?? false`
- The gate for the existing subaccount emit is `if (parentSubaccountId && !parentIsSubAgent)` at line 391
- `orgId` is NOT a direct field on `ieeRun` — look for `organisationId` on the parent `agent_runs` row fetched in the transaction (lines ~197-243)

- [ ] **Step 11.1: Find the `orgId` field for the emit**

Run: `grep -n "organisationId\|orgId" server/services/agentRunFinalizationService.ts | head -20`

Look for the parent run's `organisationId` field. It will be something like `parent.organisationId` or `parentRun.organisationId`. Confirm the exact variable name at implementation time.

- [ ] **Step 11.2: Add `emitOrgUpdate` import**

Check if `emitOrgUpdate` is already imported from `../websocket/emitters`. If not, add it to the existing import.

- [ ] **Step 11.3: Add the emit after `emitAgentRunUpdate` (line ~375-379)**

The emit must be inside the `!parentIsSubAgent` guard so sub-agent runs do not update the home dashboard:

```typescript
// Existing emit — do not remove:
emitAgentRunUpdate(ieeRun.agentRunId, 'agent:run:completed', {
  ieeRunId: ieeRun.id,
  finalStatus: resolvedStatus,
  failureReason: ieeRun.failureReason ?? null,
});

// Add after, guarded by parentIsSubAgent:
if (!parentIsSubAgent) {
  emitOrgUpdate(parent.organisationId, 'dashboard.activity.updated', {
    source: 'agent_run',
    runId: ieeRun.agentRunId,
    finalStatus: resolvedStatus,
  });
}
```

Replace `parent.organisationId` with whatever field name you confirmed in Step 11.1.

- [ ] **Step 11.4: Commit**

```bash
git add server/services/agentRunFinalizationService.ts
git commit -m "feat: emit dashboard.activity.updated on agent run terminal state"
```

## Task 12: Server emitter — `dashboard.activity.updated` in `workflowEngineService.ts`

**Files:**
- Modify: `server/services/workflowEngineService.ts`

Key facts from codebase exploration:
- `emitWorkflowEvent` call for the terminal status emit is at line ~875
- `run.organisationId` is the org field (confirmed at lines 299, 342, 752, 861)
- Terminal `finalStatus` values: `'completed'`, `'completed_with_errors'` (from the `finalStatus` assignment at lines 837-839), `'cancelled'` (line 764), `'failed'` (referenced at line 542 in `suppressWebSocket` check)
- The `cancelled` path is a separate branch at lines 758-766 — it needs its own emit

- [ ] **Step 12.1: Add `emitOrgUpdate` import**

Check if `emitOrgUpdate` is already imported. If not, add it to the existing emitter import.

- [ ] **Step 12.2: Add emit after the completion `emitWorkflowEvent` (line ~875)**

The completion branch handles `'completed'` and `'completed_with_errors'`:

```typescript
// Existing emit — do not remove:
await emitWorkflowEvent(runId, run.subaccountId, 'Workflow:run:status', {
  status: finalStatus,
  completedSteps: completedSteps.length,
  totalSteps: def.steps.length,
}, { suppressWebSocket: shouldSuppressWebSocket(run.runMode) });

// Add immediately after:
if (['completed', 'completed_with_errors'].includes(finalStatus)) {
  emitOrgUpdate(run.organisationId, 'dashboard.activity.updated', {
    source: 'workflow_run',
    runId,
    status: finalStatus,
  });
}
```

- [ ] **Step 12.3: Add emit in the `cancelled` branch (line ~764)**

Find the `'cancelled'` status assignment and the `emitWorkflowEvent` call in that branch. Add the dashboard emit alongside it:

```typescript
// Add alongside the existing cancelled workflow event:
emitOrgUpdate(run.organisationId, 'dashboard.activity.updated', {
  source: 'workflow_run',
  runId,
  status: 'cancelled',
});
```

- [ ] **Step 12.4: Add emit for the `failed` branch**

Run: `grep -n "'failed'" server/services/workflowEngineService.ts` to find the `failed` status assignment and its emit location. Add the dashboard emit in the same pattern.

- [ ] **Step 12.5: Commit**

```bash
git add server/services/workflowEngineService.ts
git commit -m "feat: emit dashboard.activity.updated on workflow run terminal states"
```

## Task 13: Server emitters — `dashboard.client.health.changed` + `dashboard:update` (ClientPulse path)

**Files:**
- Modify: the ClientPulse health mutation path (to be confirmed — see step below)

Both events must be emitted from the **mutation** path (write side), not the read path. Two possible locations: the route or service that saves/updates a ClientPulse report, or the scheduled job that recalculates health scores.

- [ ] **Step 13.1: Find the ClientPulse health mutation path**

Run these grep commands to trace the mutation:

```bash
grep -rn "attentionCount\|atRiskCount\|healthyCount\|health.*score\|recalculate" server/ --include="*.ts" | grep -v "test"
grep -rn "getLatestReport\|saveReport\|updateReport\|createReport" server/ --include="*.ts"
grep -rn "clientpulse.*health\|health.*clientpulse" server/ --include="*.ts" -i
```

Find the function that writes health summary data to the database. The emit goes at the end of that function, after the DB write succeeds, using the same values being persisted.

- [ ] **Step 13.2: Add `emitOrgUpdate` import in the mutation file**

```typescript
import { emitOrgUpdate } from '../websocket/emitters'; // adjust path as needed
```

- [ ] **Step 13.3: Add both emits at the end of the health mutation function**

Use the variables being written to the DB for the payload — do not re-read from the DB:

```typescript
// After the DB write:
const healthSummary = {
  totalClients,
  healthy,    // healthyCount or equivalent local variable
  attention,  // attentionCount or equivalent
  atRisk,     // atRiskCount or equivalent
};

// For the home dashboard — invalidation trigger for DashboardPage:
emitOrgUpdate(orgId, 'dashboard.client.health.changed', healthSummary);

// For ClientPulseDashboardPage — merge-in-place update:
emitOrgUpdate(orgId, 'dashboard:update', healthSummary);
```

Confirm the `orgId` variable name in the mutation function and substitute accordingly.

- [ ] **Step 13.4: Commit**

```bash
git add <the mutation file path confirmed in Step 13.1>
git commit -m "feat: emit dashboard.client.health.changed and dashboard:update on ClientPulse health recalculation"
```

## Task 14: Server emitter — `dashboard.queue.changed` (best-effort, job queue path)

**Files:**
- Modify: the job queue mutation path (to be confirmed)

> **Best-effort:** If the mutation path is not straightforward to instrument within the time budget, skip this task and document it as a known gap in the PR description. `QueueHealthSummary` will still live-update on reconnect refetch (§8 reconnect handling). Maximum staleness is bounded by the next reconnect cycle.

`emitToSysadmin` signature: `emitToSysadmin(event: string, entityId: string, data: Record<string, unknown>): void`

- [ ] **Step 14.1: Find the job queue mutation path**

```bash
grep -rn "enqueue\|dequeue\|dlq\|dead.letter\|job.*queue.*insert\|pg.boss" server/ --include="*.ts" | grep -v test | head -20
```

Look for where jobs are enqueued or completed. The emit should fire when the queue depth changes materially (new jobs in, jobs completed, DLQ entries added).

- [ ] **Step 14.2: Add `emitToSysadmin` import**

```typescript
import { emitToSysadmin } from '../websocket/emitters'; // adjust path
```

- [ ] **Step 14.3: Add the emit at queue mutation sites**

```typescript
emitToSysadmin('dashboard.queue.changed', 'system', {
  pendingDelta: <signed int — positive for new jobs, negative for completed>,
});
```

If computing `pendingDelta` is complex (requires a before/after count), use `0` as a placeholder — the client ignores the payload and uses it only as an invalidation signal.

- [ ] **Step 14.4: Commit or document as deferred**

If implemented:
```bash
git add <mutation file>
git commit -m "feat: emit dashboard.queue.changed on job queue mutations (sysadmin)"
```

If deferred, create a `tasks/todo.md` entry under `## Deferred`:
```
- [ ] Wire dashboard.queue.changed emitter to job queue mutation path (best-effort, see spec §5.5)
```

## Task 15: `DashboardPage` — add state, refs, and `markFresh` helper

**Files:**
- Modify: `client/src/pages/DashboardPage.tsx`

All additions go inside the `DashboardPage` component function, after the existing state declarations (after line 31) and before the existing `useEffect`.

- [ ] **Step 15.1: Add new imports at the top of the file**

Add `useRef`, `useCallback` to the React import (they are not currently imported):

```typescript
// Before:
import { useEffect, useState } from 'react';

// After:
import { useCallback, useEffect, useRef, useState } from 'react';
```

Add the socket hook imports:

```typescript
import { useSocket, useSocketRoom, useSocketConnected } from '../hooks/useSocket';
```

Add the new component imports:

```typescript
import { FreshnessIndicator } from '../components/dashboard/FreshnessIndicator';
import { OperationalMetricsPlaceholder } from '../components/dashboard/OperationalMetricsPlaceholder';
```

Update the `QueueHealthSummary` import (added in Task 6 — verify it's present):

```typescript
import { QueueHealthSummary } from '../components/dashboard/QueueHealthSummary';
```

- [ ] **Step 15.2: Add the `TimestampedResponse` interface near the top of the file (after existing interfaces)**

```typescript
interface TimestampedResponse<T> {
  data: T;
  serverTimestamp: string;
}
```

- [ ] **Step 15.3: Add version-tracking refs and inflight/pending refs inside `DashboardPage` function**

Insert after the existing `useState` declarations (after line 31, before the existing `useEffect`):

```typescript
  // ── Per-group timestamp refs (latest-data-wins) ──────────────────────────
  const approvalsTs     = useRef<string>('');
  const activityTs      = useRef<string>('');
  const clientHealthTs  = useRef<string>('');
  const queueTs         = useRef<string>(''); // sysadmin only

  // ── Per-group inflight + pending (coalescing) ─────────────────────────────
  const approvalsInflight    = useRef(false);
  const approvalsPending     = useRef(false);
  const activityInflight     = useRef(false);
  const activityPending      = useRef(false);
  const clientHealthInflight = useRef(false);
  const clientHealthPending  = useRef(false);
  const queueInflight        = useRef(false);  // unused directly — QueueHealthSummary owns its fetch
  const queuePending         = useRef(false);  // same

  // ── FreshnessIndicator ────────────────────────────────────────────────────
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date>(() => new Date());
  const lastUpdatedAtRef = useRef<Date>(new Date());

  // ── Refresh tokens (signal child components to re-fetch) ─────────────────
  const [activityRefreshToken, setActivityRefreshToken] = useState(0);
  const [queueRefreshToken, setQueueRefreshToken]       = useState(0);

  // ── Reconnect state ───────────────────────────────────────────────────────
  const prevConnected      = useRef<boolean | null>(null);
  const reconnectDebounce  = useRef<ReturnType<typeof setTimeout> | null>(null);
```

- [ ] **Step 15.4: Add the `applyIfNewer` helper and `markFresh` helper inside the component**

Add after the refs (still inside the component function, before the existing `useEffect`):

```typescript
  // ── Helpers ───────────────────────────────────────────────────────────────

  function applyIfNewer(
    currentTs: { current: string },
    incomingTs: string,
    apply: () => void,
  ): void {
    if (incomingTs > currentTs.current) {
      currentTs.current = incomingTs;
      apply();
    }
  }

  const markFresh = useCallback((ts: Date) => {
    if (ts > lastUpdatedAtRef.current) {
      lastUpdatedAtRef.current = ts;
      setLastUpdatedAt(ts);
    }
  }, []);
```

- [ ] **Step 15.5: Update the initial `useEffect` to read the new envelope shapes**

The existing `useEffect` at lines 34-46 uses `s.data`, `p.data`, `h.data`. After the envelope change, these need updating. This should already be done in Task 9, Step 9.1. Verify the `.then` reads `s.data.data`, `p.data.data`, `h.data.data`. Add `markFresh(new Date())` at the end of the `.then` handler to initialise the freshness indicator:

```typescript
    }).then(([a, s, p, h]) => {
      setAgents(a.data);
      setStats(s.data.data);
      setAttention(p.data.data);
      setHealthSummary(h.data.data);
      markFresh(new Date()); // add this line
    })
```

- [ ] **Step 15.6: Commit**

```bash
git add client/src/pages/DashboardPage.tsx
git commit -m "feat: add per-group refs, applyIfNewer, and markFresh to DashboardPage"
```

## Task 16: `DashboardPage` — implement all `refetch*` functions

**Files:**
- Modify: `client/src/pages/DashboardPage.tsx`

Add these functions inside the `DashboardPage` component, after the helpers from Task 15 and before the existing `useEffect`. Each function implements the coalescing + `applyIfNewer` + failure-handling pattern from spec §6.3 and §6.4.

- [ ] **Step 16.1: Add `refetchApprovals`**

```typescript
  async function refetchApprovals() {
    if (approvalsInflight.current) {
      approvalsPending.current = true;
      return;
    }
    approvalsInflight.current = true;
    try {
      const res = await api.get<TimestampedResponse<PulseAttentionResponse>>('/api/pulse/attention');
      applyIfNewer(approvalsTs, res.data.serverTimestamp, () => {
        setAttention(res.data.data);
        markFresh(new Date());
      });
    } catch (err) {
      console.error('[DashboardPage] refetchApprovals failed:', err);
    } finally {
      approvalsInflight.current = false;
      if (approvalsPending.current) {
        approvalsPending.current = false;
        void refetchApprovals();
      }
    }
  }
```

- [ ] **Step 16.2: Add `refetchActivity`**

The Activity group fetches two endpoints in parallel. Uses the **minimum** of the two `serverTimestamp` values as the group version (both datasets must be at least this fresh before applying).

```typescript
  async function refetchActivity() {
    if (activityInflight.current) {
      activityPending.current = true;
      return;
    }
    activityInflight.current = true;
    try {
      const [feedRes, statsRes] = await Promise.all([
        api.get<TimestampedResponse<{ items: ActivityItem[]; total: number }>>('/api/activity', { params: { limit: 20, sort: 'newest' } }),
        api.get<TimestampedResponse<ActivityStats>>('/api/agent-activity/stats', { params: { sinceDays: 7 } }),
      ]);
      // Use min of two timestamps — both must be at least this fresh.
      const groupTs = feedRes.data.serverTimestamp < statsRes.data.serverTimestamp
        ? feedRes.data.serverTimestamp
        : statsRes.data.serverTimestamp;
      applyIfNewer(activityTs, groupTs, () => {
        setStats(statsRes.data.data);
        setActivityRefreshToken(t => t + 1); // signals UnifiedActivityFeed to re-fetch and merge
        markFresh(new Date());
      });
    } catch (err) {
      console.error('[DashboardPage] refetchActivity failed:', err);
    } finally {
      activityInflight.current = false;
      if (activityPending.current) {
        activityPending.current = false;
        void refetchActivity();
      }
    }
  }
```

> `ActivityItem` is defined inside `UnifiedActivityFeed.tsx` but not currently exported. In `refetchActivity`, you do not need to reference `ActivityItem` directly — only `ActivityStats` (already in DashboardPage) and the feed token are updated. TypeScript will infer the response type from the `api.get<...>` generic. If you want the type annotation, add `export type { ActivityItem }` to `UnifiedActivityFeed.tsx`.

- [ ] **Step 16.3: Add `refetchClientHealth`**

```typescript
  async function refetchClientHealth() {
    if (clientHealthInflight.current) {
      clientHealthPending.current = true;
      return;
    }
    clientHealthInflight.current = true;
    try {
      const res = await api.get<TimestampedResponse<HealthSummary | null>>('/api/clientpulse/health-summary');
      applyIfNewer(clientHealthTs, res.data.serverTimestamp, () => {
        setHealthSummary(res.data.data);
        markFresh(new Date());
      });
    } catch (err) {
      console.error('[DashboardPage] refetchClientHealth failed:', err);
    } finally {
      clientHealthInflight.current = false;
      if (clientHealthPending.current) {
        clientHealthPending.current = false;
        void refetchClientHealth();
      }
    }
  }
```

- [ ] **Step 16.4: Add `refetchQueue` and `refetchAll`**

`refetchQueue` just increments the token — `QueueHealthSummary` owns its internal fetch and version tracking:

```typescript
  function refetchQueue() {
    setQueueRefreshToken(t => t + 1);
  }

  function refetchAll() {
    void refetchApprovals();
    void refetchActivity();
    void refetchClientHealth();
    if (user.role === 'system_admin') refetchQueue();
  }
```

- [ ] **Step 16.5: Commit**

```bash
git add client/src/pages/DashboardPage.tsx
git commit -m "feat: add refetchApprovals, refetchActivity, refetchClientHealth, refetchQueue, refetchAll to DashboardPage"
```

## Task 17: `DashboardPage` — wire socket subscriptions and reconnect handling

**Files:**
- Modify: `client/src/pages/DashboardPage.tsx`

Add the following hooks inside the `DashboardPage` component, after the `refetchAll` function and before the existing `useEffect`.

- [ ] **Step 17.1: Add `RECONNECT_DEBOUNCE_MS` at the top of the file (file-level constant, outside the component)**

```typescript
const RECONNECT_DEBOUNCE_MS = 500;
```

- [ ] **Step 17.2: Add the `EVENT_TO_GROUP` constant and `useSocket` subscriptions**

```typescript
  // ── Socket subscriptions (org room — auto-joined on connect) ─────────────

  const EVENT_TO_GROUP = {
    'dashboard.approval.changed':     refetchApprovals,
    'dashboard.activity.updated':     refetchActivity,
    'dashboard.client.health.changed': refetchClientHealth,
  } as const;

  useSocket('dashboard.approval.changed',      useCallback(() => { void refetchApprovals(); }, []));
  useSocket('dashboard.activity.updated',      useCallback(() => { void refetchActivity(); }, []));
  useSocket('dashboard.client.health.changed', useCallback(() => { void refetchClientHealth(); }, []));
```

> The `EVENT_TO_GROUP` constant is the single-file guardrail — every entry in the spec's §4.2 table must appear here. If a new event is added to the table, add it here too. Keep the three `useSocket` calls in sync with this constant.

- [ ] **Step 17.3: Add `useSocketRoom` for `dashboard.queue.changed` (sysadmin room)**

```typescript
  useSocketRoom(
    'sysadmin',
    user.role === 'system_admin' ? 'system' : null,
    {
      'dashboard.queue.changed': () => refetchQueue(),
    },
    () => { if (user.role === 'system_admin') refetchQueue(); }, // onReconnectSync
  );
```

`null` `roomId` causes the hook to no-op — this keeps the hook call unconditional (required for React hook ordering). The room is only joined for `system_admin` users.

- [ ] **Step 17.4: Add reconnect refetch with debounce**

```typescript
  const connected = useSocketConnected();

  useEffect(() => {
    const wasConnected = prevConnected.current;
    prevConnected.current = connected;

    // Only act on the false→true transition (reconnect), not initial mount (null→true).
    if (wasConnected === false && connected === true) {
      if (reconnectDebounce.current) clearTimeout(reconnectDebounce.current);
      reconnectDebounce.current = setTimeout(() => {
        refetchAll();
      }, RECONNECT_DEBOUNCE_MS);
    }
  }, [connected]);
```

- [ ] **Step 17.5: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors. Fix any hook dependency warnings or type mismatches.

- [ ] **Step 17.6: Commit**

```bash
git add client/src/pages/DashboardPage.tsx
git commit -m "feat: add socket subscriptions and reconnect handling to DashboardPage"
```

## Task 18: `DashboardPage` — layout assembly

**Files:**
- Modify: `client/src/pages/DashboardPage.tsx`

Three layout changes: (1) `<FreshnessIndicator>` below the greeting, (2) `<OperationalMetricsPlaceholder>` between approval and workspaces sections, (3) updated `<UnifiedActivityFeed>` with `refreshToken` + `expectedTimestamp`, and (4) `<QueueHealthSummary>` with `refreshToken`.

- [ ] **Step 18.1: Add `<FreshnessIndicator>` below the greeting**

In the JSX `return`, the greeting `<div>` ends at line 95. Add `<FreshnessIndicator>` immediately after the closing `</div>` of the greeting section:

```tsx
      {/* Greeting */}
      <div className="mb-6">
        <h1 className="text-[28px] font-extrabold text-slate-900 tracking-tight m-0">
          {greeting}, {user.firstName}
        </h1>
        <p className="text-sm text-slate-500 mt-1.5">
          {activeAgents.length > 0
            ? `${activeAgents.length} AI agent${activeAgents.length === 1 ? '' : 's'} ready to work.`
            : "Let's get your AI team set up."}
        </p>
        <FreshnessIndicator lastUpdatedAt={lastUpdatedAt} />
      </div>
```

- [ ] **Step 18.2: Add `<OperationalMetricsPlaceholder>` between approval and workspaces sections**

Find the JSX comment `{/* ── Your workspaces */}` (around line 176). Insert the placeholder immediately before it:

```tsx
      {/* [LAYOUT-RESERVED: Piece 3 — Operational metrics] */}
      <OperationalMetricsPlaceholder />

      {/* ── Your workspaces ───────────────────────────────────────────────── */}
```

- [ ] **Step 18.3: Wire `refreshToken` + `expectedTimestamp` to `<UnifiedActivityFeed>`**

Find the `<UnifiedActivityFeed>` JSX (around line 229). Update it:

```tsx
        <UnifiedActivityFeed
          orgId={user.organisationId}
          limit={20}
          refreshToken={activityRefreshToken}
          expectedTimestamp={activityTs.current}
        />
```

- [ ] **Step 18.4: Wire `refreshToken` to `<QueueHealthSummary>`**

Find the `<QueueHealthSummary />` render (around line 154). Update it:

```tsx
      {user.role === 'system_admin' && (
        <QueueHealthSummary refreshToken={queueRefreshToken} />
      )}
```

- [ ] **Step 18.5: Run typecheck — confirm no missing props**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 18.6: Commit**

```bash
git add client/src/pages/DashboardPage.tsx
git commit -m "feat: integrate FreshnessIndicator, OperationalMetricsPlaceholder, and live-update props into DashboardPage layout"
```

## Task 19: Fix `ClientPulseDashboardPage` — remove toast from `dashboard:update` handler

**Files:**
- Modify: `client/src/pages/ClientPulseDashboardPage.tsx`

The existing `dashboard:update` handler at lines 74-79 calls `toast.success(...)`. Per the spec §11.2, the toast is removed — the `<FreshnessIndicator>` pattern replaces it. The update handler otherwise stays unchanged.

- [ ] **Step 19.1: Remove the toast call from the `dashboard:update` handler**

```typescript
// Before (lines 74-79):
useSocket('dashboard:update', useCallback((data: unknown) => {
  if (!data || typeof data !== 'object') return;
  const update = data as Partial<HealthSummary>;
  setHealth((prev) => prev ? { ...prev, ...update } : prev);
  toast.success('Dashboard updated with latest data');
}, []));

// After:
useSocket('dashboard:update', useCallback((data: unknown) => {
  if (!data || typeof data !== 'object') return;
  const update = data as Partial<HealthSummary>;
  setHealth((prev) => prev ? { ...prev, ...update } : prev);
}, []));
```

- [ ] **Step 19.2: Remove unused `toast` import if `toast` is no longer used elsewhere in this file**

Run: `grep -n "toast" client/src/pages/ClientPulseDashboardPage.tsx`

If `toast` is no longer used after removing the call, remove its import.

- [ ] **Step 19.3: Commit**

```bash
git add client/src/pages/ClientPulseDashboardPage.tsx
git commit -m "fix: remove toast from dashboard:update handler — replaced by FreshnessIndicator pattern"
```

## Task 20: Final verification — typecheck, lint, tests

**Pre-merge coverage check (from spec §4.2):**

```bash
grep -r "emitOrgUpdate.*'dashboard\." server/
```

Every match must appear in the spec's §4.2 event table. Any call not in the table is a `file-inventory-drift` finding.

- [ ] **Step 20.1: Run all pure-function tests**

```bash
npx tsx client/src/components/dashboard/__tests__/freshnessIndicator.test.ts
npx tsx client/src/pages/__tests__/dashboardVersioning.test.ts
npx tsx client/src/components/__tests__/activityFeedMerge.test.ts
```

Expected: All three print their `✓ ... tests passed` lines. Fix any failures before proceeding.

- [ ] **Step 20.2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 20.3: Run lint**

```bash
npm run lint
```

Expected: 0 errors, 0 warnings (or only pre-existing warnings). Fix any new lint failures.

- [ ] **Step 20.4: Verify the emitter coverage check**

```bash
grep -r "emitOrgUpdate.*'dashboard\." server/
```

Confirm each match is for one of: `dashboard.approval.changed`, `dashboard.activity.updated`, `dashboard.client.health.changed`, `dashboard:update`. (Note: `dashboard:update` uses the older colon convention and is intentionally kept — it is documented in spec §11.)

- [ ] **Step 20.5: Verify file inventory is complete**

Cross-check every file listed in the "File structure" section at the top of this plan against `git status --short`. Every listed file should appear as modified (`M`) or added (`A`). Any listed file that is still unmodified is a gap.

- [ ] **Step 20.6: Final commit (if any remaining changes)**

```bash
git add -p  # review any unstaged changes
git commit -m "chore: final cleanup and verification for home dashboard reactivity"
```

---

## Self-review checklist (run before opening the PR)

Skim the spec §15 pre-review checklist and verify:

- [ ] `FreshnessIndicator` is placed below the home greeting — not in a sidebar, not in a banner
- [ ] All five API endpoints return `{ data, serverTimestamp }` — no endpoint returns the raw payload
- [ ] All consumers read `res.data.data` — no consumer reads the old `res.data` shape
- [ ] `applyIfNewer` uses strict `>` (not `>=`) — equal timestamps do not trigger `apply()`
- [ ] Failure path: if any `refetch*` function throws, `applyIfNewer` is NOT called and `markFresh` is NOT called
- [ ] Activity group: uses `Promise.all`; `catch` is at the `Promise.all` level (no individual try/catch inside that would allow partial update)
- [ ] `useSocketRoom` for `dashboard.queue.changed` is called unconditionally with `null` roomId for non-sysadmin users
- [ ] `PULSE_DEBOUNCE_MS = 1_500` and `RECONNECT_DEBOUNCE_MS = 500` are named constants (not magic numbers)
- [ ] `OperationalMetricsPlaceholder` appears in the JSX between the approval section and the workspaces section
- [ ] `dashboard:update` toast is removed from `ClientPulseDashboardPage`
- [ ] Pre-merge grep: `grep -r "emitOrgUpdate.*'dashboard\." server/` returns exactly the expected set of calls
