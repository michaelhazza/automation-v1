# System Monitoring Coverage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use [superpowers:subagent-driven-development](../../../.claude/agents/) (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 7 producer-side monitoring gaps (G1, G2, G3, G4 subset, G5, G7, G11) so the System Monitor agent sees failures it was designed to triage — log evidence, every DLQ-bound failure, every webhook 5xx, every skill-analyzer terminal failure.

**Architecture:** Pure additive wiring on top of existing primitives. Three phases: (1) log-buffer wiring + DLQ subscription coverage + async-ingest worker registration; (2) `createWorker` conversion for the workflow engine + IEE; (3) `recordIncident` emission from webhook 5xx paths and the skill-analyzer wrapper. Zero new abstractions, zero migrations, zero schema changes.

**Tech Stack:** TypeScript, Node `node:test` + `node:assert`, pg-boss, Drizzle ORM, existing `recordIncident` / `appendLogLine` / `createWorker` / `JOB_CONFIG` primitives.

**Spec:** [docs/superpowers/specs/2026-04-28-system-monitoring-coverage-spec.md](../../../docs/superpowers/specs/2026-04-28-system-monitoring-coverage-spec.md) (status: SPEC-REVIEW-COMPLETE, 1724 lines).

**Branch:** `claude/add-monitoring-logging-3xMKQ`. **Build slug:** `system-monitoring-coverage`. **Predecessor PR (spec-only):** [#226](https://github.com/breakoutsolutions/Claude-Code/pull/226).

---

## Verification cadence (read this before starting)

Per CLAUDE.md gate-cadence rule and the architect's chunk decomposition:

| When | Command | Purpose |
|---|---|---|
| **After every commit** | `npx tsc --noEmit` | Catch type errors before they cascade into the next commit. ~5–15s. |
| **After every chunk** | `bash scripts/run-all-unit-tests.sh` + `npm run lint` | Full pure-helper + invariant pass + style. ~minutes. |
| **End-of-build only** | `npm run test:gates` | Pre-merge gate. Expensive — do NOT run mid-iteration. |

If `npx tsc --noEmit` fails, do not proceed to the next commit — fix in place.

If `bash scripts/run-all-unit-tests.sh` fails after a chunk, do not move to the next chunk — fix in place.

If, after 3 fix attempts on the same check, the failure persists: STOP. Append the blocker to `tasks/todo.md § Blockers`, escalate to the user, and try a fundamentally different approach. Do NOT retry-with-rephrasing per CLAUDE.md §1.

---

## File inventory at-a-glance

The spec's §2 file inventory is the single source of truth. Recap:

**New files (9):**
- `server/lib/loggerBufferAdapterPure.ts`
- `server/lib/__tests__/loggerBufferAdapterPure.test.ts`
- `server/lib/__tests__/logger.integration.test.ts`
- `server/services/dlqMonitorServicePure.ts`
- `server/services/__tests__/dlqMonitorServicePure.test.ts`
- `server/services/__tests__/dlqMonitorServiceForceSyncInvariant.test.ts`
- `server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts`
- `server/config/__tests__/jobConfigInvariant.test.ts`
- `server/jobs/__tests__/skillAnalyzerJobIncidentEmission.integration.test.ts`

**Modified files (≤9 distinct, several touched in multiple chunks):**
- `server/lib/logger.ts` (Chunk 1)
- `server/services/incidentIngestor.ts` (Chunk 2 — `opts` parameter only)
- `server/config/jobConfig.ts` (Chunk 2 — 6 `deadLetter:` additions + 1 new `system-monitor-ingest` entry)
- `server/services/dlqMonitorService.ts` (Chunk 2 — derive + `forceSync: true`)
- `server/index.ts` (Chunk 2 — async worker registration; Chunk 5 — skill-analyzer wrap)
- `server/services/workflowEngineService.ts` (Chunk 3)
- `server/jobs/ieeRunCompletedHandler.ts` (Chunk 3 — verify or convert)
- `server/services/ieeExecutionService.ts` (Chunk 3 — verify or convert)
- `server/routes/webhooks/ghlWebhook.ts` (Chunk 4)
- `server/routes/githubWebhook.ts` (Chunk 4)

**Files explicitly OUT of inventory (do NOT touch):** `incidentIngestorPure.ts`, `incidentIngestorAsyncWorker.ts` (verify export only — no edits), `skillExecutor.ts`, `systemIncidents.ts`, all `server/services/systemMonitor/skills/*`, all `server/services/systemMonitor/synthetic/*`, all `server/adapters/*`, `queueService.ts` raw `boss.work` registrations beyond Chunk 3 scope.

If implementation surfaces a need to edit any out-of-inventory file: STOP, append to `tasks/todo.md`, ship the chunk against its locked scope only.

---

## Contents

- [Chunk 1 — G2 log buffer wiring](#chunk-1--g2-log-buffer-wiring)
- [Chunk 2 — G5 + G3 + G1 DLQ coverage + async-ingest worker](#chunk-2--g5--g3--g1-dlq-coverage--async-ingest-worker)
- [Chunk 3 — G4-A + G4-B `createWorker` conversion (workflow + IEE)](#chunk-3--g4-a--g4-b-createworker-conversion-workflow--iee)
- [Chunk 4 — G7 webhook 5xx incident emission](#chunk-4--g7-webhook-5xx-incident-emission)
- [Chunk 5 — G11 skill-analyzer wrap + tests](#chunk-5--g11-skill-analyzer-wrap--tests)
- [End-of-build verification + handoff](#end-of-build-verification--handoff)

---

## Chunk 1 — G2 log buffer wiring

**Goal (G2):** After this chunk, `logger.info('event', { correlationId: 'cid' })` populates the system-monitor log buffer so the triage agent's `read_logs_for_correlation_id` skill returns evidence.

**Spec sections to read first:** [§3.1 LogLine contract](../../../docs/superpowers/specs/2026-04-28-system-monitoring-coverage-spec.md#31-logline-consumed-by-appendlogline-produced-by-the-new-logger-adapter), §4.2 (full sub-tree), §8.1 (execution-safety contract for the buffer write).

**Files in this chunk:**
- Create: `server/lib/loggerBufferAdapterPure.ts`
- Create: `server/lib/__tests__/loggerBufferAdapterPure.test.ts`
- Create: `server/lib/__tests__/logger.integration.test.ts`
- Modify: `server/lib/logger.ts:34-43` (extend `emit` with buffer wiring)

**Spec commits this chunk produces:** §4.1 commits 1–2.

**No prior-chunk dependencies.** This chunk is independent of Chunks 2–5.

### Task 1.1: Create the pure adapter helper (commit 1, part 1)

**Files:**
- Create: `server/lib/loggerBufferAdapterPure.ts`
- Create: `server/lib/__tests__/loggerBufferAdapterPure.test.ts`

- [ ] **Step 1: Create `server/lib/loggerBufferAdapterPure.ts`** with the contents below verbatim from spec §4.2.1.

```ts
import type { LogLine } from '../services/systemMonitor/logBuffer.js';

interface LogEntryShape {
  timestamp?: string;
  level?: string;
  event?: string;
  correlationId?: string;
  [key: string]: unknown;
}

/**
 * Returns a LogLine ready for appendLogLine, or null if the entry has no
 * usable correlationId. Pure — no DB, no async, no logger import.
 */
export function buildLogLineForBuffer(entry: LogEntryShape): LogLine | null {
  const cid = entry.correlationId;
  if (typeof cid !== 'string' || cid.length === 0) return null;

  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'timestamp' || key === 'level' || key === 'event' || key === 'correlationId') {
      continue;
    }
    meta[key] = value;
  }

  let ts: Date;
  try {
    ts = entry.timestamp ? new Date(entry.timestamp) : new Date();
    if (isNaN(ts.getTime())) ts = new Date();
  } catch {
    ts = new Date();
  }

  return {
    ts,
    level: typeof entry.level === 'string' ? entry.level : 'info',
    event: typeof entry.event === 'string' ? entry.event : 'unknown_event',
    correlationId: cid,
    meta,
  };
}
```

- [ ] **Step 2: Create the pure-helper test** at `server/lib/__tests__/loggerBufferAdapterPure.test.ts` — 7 cases per spec §4.2.3.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLogLineForBuffer } from '../loggerBufferAdapterPure.js';

test('returns null when correlationId is missing', () => {
  assert.equal(buildLogLineForBuffer({ event: 'e' }), null);
});

test('returns null when correlationId is an empty string', () => {
  assert.equal(buildLogLineForBuffer({ correlationId: '', event: 'e' }), null);
});

test('returns null when correlationId is non-string', () => {
  assert.equal(buildLogLineForBuffer({ correlationId: 42 as unknown as string }), null);
  assert.equal(buildLogLineForBuffer({ correlationId: undefined }), null);
  assert.equal(buildLogLineForBuffer({ correlationId: {} as unknown as string }), null);
});

test('returns a valid LogLine when correlationId is non-empty', () => {
  const line = buildLogLineForBuffer({
    timestamp: '2026-01-01T00:00:00.000Z',
    level: 'info',
    event: 'agent_run_started',
    correlationId: 'cid-7a8b',
    runId: 'run-42',
    orgId: 'org-1',
  });
  assert.ok(line);
  assert.equal(line.correlationId, 'cid-7a8b');
  assert.equal(line.event, 'agent_run_started');
  assert.equal(line.level, 'info');
  assert.deepEqual(line.meta, { runId: 'run-42', orgId: 'org-1' });
});

test('strips timestamp/level/event/correlationId from meta', () => {
  const line = buildLogLineForBuffer({
    timestamp: '2026-01-01T00:00:00.000Z',
    level: 'warn',
    event: 'e',
    correlationId: 'cid',
    foo: 'bar',
  });
  assert.ok(line);
  assert.deepEqual(line.meta, { foo: 'bar' });
  assert.ok(!('timestamp' in line.meta));
  assert.ok(!('level' in line.meta));
  assert.ok(!('event' in line.meta));
  assert.ok(!('correlationId' in line.meta));
});

test('preserves all other keys in meta', () => {
  const line = buildLogLineForBuffer({
    correlationId: 'cid',
    a: 1,
    b: 'two',
    c: { nested: true },
  });
  assert.ok(line);
  assert.deepEqual(line.meta, { a: 1, b: 'two', c: { nested: true } });
});

test('falls back to new Date() when timestamp is missing or invalid', () => {
  const line1 = buildLogLineForBuffer({ correlationId: 'cid' });
  assert.ok(line1);
  assert.ok(line1.ts instanceof Date);
  assert.ok(!isNaN(line1.ts.getTime()));

  const line2 = buildLogLineForBuffer({ correlationId: 'cid', timestamp: 'not-a-date' });
  assert.ok(line2);
  assert.ok(!isNaN(line2.ts.getTime()));
});
```

- [ ] **Step 3: Run the pure-helper tests and verify they pass.**

Run: `npx tsx --test server/lib/__tests__/loggerBufferAdapterPure.test.ts`
Expected: 7 passing tests, 0 failures.

- [ ] **Step 4: Run typecheck.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit (commit 1).**

```bash
git add server/lib/loggerBufferAdapterPure.ts server/lib/__tests__/loggerBufferAdapterPure.test.ts
git commit -m "feat(monitor): add buildLogLineForBuffer pure helper + tests (G2)"
```

### Task 1.2: Wire the adapter into `logger.emit` (commit 2)

**Files:**
- Modify: `server/lib/logger.ts:34-43` (extend `emit`)
- Create: `server/lib/__tests__/logger.integration.test.ts`

- [ ] **Step 1: Modify `server/lib/logger.ts`.** Replace the existing `emit` function (current body at lines 34–43) and append the helper functions immediately below it. The full replacement region looks like this — exactly match the spec §4.2.2 contract, including the burst-race guard for the lazy import.

```ts
function emit(entry: LogEntry): void {
  const output = JSON.stringify(entry);
  if (entry.level === 'error') {
    console.error(output);
  } else if (entry.level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }

  // Feed the System Monitor's log buffer for correlation-ID-scoped retrieval.
  // Lazy import keeps the logger module free of systemMonitor deps.
  // Errors are swallowed — the buffer is a best-effort observability surface.
  appendLogLineSafe(entry);
}

type AppendLogLineFn = (line: import('../services/systemMonitor/logBuffer.js').LogLine) => void;
let _appendLogLineCache: AppendLogLineFn | null = null;
let _appendLogLineLoading: Promise<AppendLogLineFn> | null = null;

async function loadAppendLogLine(): Promise<AppendLogLineFn> {
  if (_appendLogLineCache) return _appendLogLineCache;
  if (_appendLogLineLoading) return _appendLogLineLoading;

  _appendLogLineLoading = import('../services/systemMonitor/logBuffer.js').then((m) => {
    _appendLogLineCache = m.appendLogLine;
    _appendLogLineLoading = null;
    return _appendLogLineCache;
  }).catch((err) => {
    _appendLogLineLoading = null;
    throw err;
  });

  return _appendLogLineLoading;
}

function appendLogLineSafe(entry: LogEntry): void {
  void (async () => {
    try {
      const { buildLogLineForBuffer } = await import('./loggerBufferAdapterPure.js');
      const line = buildLogLineForBuffer(entry);
      if (line === null) return;
      const fn = await loadAppendLogLine();
      fn(line);
    } catch {
      // Never let buffer-write failures surface to the logger caller.
    }
  })();
}
```

Do NOT change anything else in `logger.ts` — the `LogEntry` shape, `LOG_LEVELS`, `currentLevel`, `shouldLog`, the `logger` object, and `generateCorrelationId` stay untouched.

- [ ] **Step 2: Verify `appendLogLine` and `_resetBufferForTest` exist in `server/services/systemMonitor/logBuffer.ts`.**

Run: `grep -nE "(appendLogLine|_resetBufferForTest)" server/services/systemMonitor/logBuffer.ts`
Expected: at least one match for each. If `_resetBufferForTest` is absent, STOP and append to `tasks/todo.md` — the integration test below depends on it. (Per the spec's no-new-primitives rule, do not add it inline; route the gap to backlog and ship the chunk without the integration test if the helper is missing.)

- [ ] **Step 3: Create the logger integration test** at `server/lib/__tests__/logger.integration.test.ts` per spec §4.2.3.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { logger } from '../logger.js';
import { readLinesForCorrelationId, _resetBufferForTest } from '../../services/systemMonitor/logBuffer.js';

test('logger.info with correlationId populates the log buffer', async () => {
  _resetBufferForTest();
  logger.info('test_event_42', { correlationId: 'cid-42', foo: 'bar' });
  // Lazy import resolves on next tick; allow two microtask ticks.
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  const lines = readLinesForCorrelationId('cid-42', 100);
  assert.ok(lines.length >= 1, 'expected at least one buffered line');
  const line = lines.find(l => l.event === 'test_event_42');
  assert.ok(line, 'expected line with matching event name');
  assert.equal(line.correlationId, 'cid-42');
  assert.equal((line.meta as { foo?: string }).foo, 'bar');
});

test('logger.info without correlationId does NOT populate the buffer', async () => {
  _resetBufferForTest();
  logger.info('test_event_no_cid', { foo: 'baz' });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  const allKeys = ['', 'undefined', 'null'];
  for (const k of allKeys) {
    const lines = readLinesForCorrelationId(k, 100);
    assert.equal(lines.length, 0, `expected no lines for key '${k}'`);
  }
});
```

If the test proves flaky on `setImmediate × 2`, fall back to `await new Promise(r => setTimeout(r, 50))` — spec §4.2.3 explicitly authorises this.

- [ ] **Step 4: Run the integration test.**

Run: `npx tsx --test server/lib/__tests__/logger.integration.test.ts`
Expected: 2 passing tests.

- [ ] **Step 5: Run typecheck.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit (commit 2).**

```bash
git add server/lib/logger.ts server/lib/__tests__/logger.integration.test.ts
git commit -m "feat(monitor): wire appendLogLine from logger.emit (G2)"
```

### Chunk 1 close-out

- [ ] **Step 1: Run the unit-test suite.**

Run: `bash scripts/run-all-unit-tests.sh`
Expected: all green, including the 2 new test files (7 + 2 cases).

- [ ] **Step 2: Run lint.**

Run: `npm run lint`
Expected: clean. Fix any new violations introduced by Chunk 1 before moving on.

- [ ] **Step 3: Spec acceptance check (G2).** All three §1.1 G2 verifiable assertions are now covered:
  - `buildLogLineForBuffer({ correlationId: 'x', timestamp: '...', level: 'info', event: 'e', foo: 'bar' }).meta` equals `{ foo: 'bar' }` — covered by Task 1.1 Step 2 case 5.
  - `buildLogLineForBuffer({ correlationId: '' })` returns `null` — case 2.
  - After `logger.info('test_event', { correlationId: 'cid' })` and one event-loop tick, `readLinesForCorrelationId('cid', 100).length >= 1` — covered by Task 1.2 Step 3.

Chunk 1 complete. Proceed to Chunk 2.

---

## Chunk 2 — G5 + G3 + G1 DLQ coverage + async-ingest worker

**Goal (G5, G3, G1):** After this chunk, every queue declared in `JOB_CONFIG` has a `deadLetter:` entry, `dlqMonitorService` subscribes to all 40 of them (up from 8), `system-monitor-ingest` has a JOB_CONFIG entry, and the async-ingest worker registers and drains the queue when `SYSTEM_INCIDENT_INGEST_MODE=async` is set.

**Spec sections to read first:** §3.2 (DLQ derivation contract), §3.3 (system-monitor-ingest entry), §3.4 (async-ingest registration + the `forceSync` loop-hazard invariant), §4.3–§4.8 (full Phase 1 minus G2), §8.3–§8.4 (write-path contracts).

**Files in this chunk:**
- Create: `server/services/dlqMonitorServicePure.ts`
- Create: `server/services/__tests__/dlqMonitorServicePure.test.ts`
- Create: `server/services/__tests__/dlqMonitorServiceForceSyncInvariant.test.ts`
- Create: `server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts`
- Create: `server/config/__tests__/jobConfigInvariant.test.ts`
- Modify: `server/config/jobConfig.ts` — add `deadLetter:` to 6 entries (G5) AND add new `system-monitor-ingest` entry (G3)
- Modify: `server/services/incidentIngestor.ts:86` — extend `recordIncident` signature with `opts?: { forceSync?: boolean }` second parameter
- Modify: `server/services/dlqMonitorService.ts:14-23` — replace hard-coded `DLQ_QUEUES` with derivation; pass `{ forceSync: true }` on every `recordIncident` call (lines ~41-49)
- Modify: `server/index.ts` (~line 455) — register async-ingest worker conditional on env var

**Spec commits this chunk produces:** §4.1 commits 3–8.

**CRITICAL ordering risk (architect-flagged):** Commit 5 introduces both the `DLQ_QUEUES` derivation **AND** the `forceSync: true` calls in `dlqMonitorService.ts`. Those calls require `recordIncident`'s `opts?: { forceSync?: boolean }` second parameter — which spec §2.2 lists as a `incidentIngestor.ts` modification but spec §4.1 does NOT call out as a separate commit. **Bundle the signature change into commit 5.** If it lands later, commit 5 fails to typecheck.

**Out-of-inventory enforcement:** Do NOT touch `server/services/incidentIngestorPure.ts` — `IncidentInput` is unchanged; the `opts` parameter lives on `recordIncident` only. Do NOT touch `server/services/incidentIngestorAsyncWorker.ts` beyond verifying `handleSystemMonitorIngest` is exported (it is, per spec §2.2 "No code change beyond export shape").

### Task 2.1: G5 — Add `deadLetter:` to 6 missing JOB_CONFIG entries (commit 3)

**Files:**
- Modify: `server/config/jobConfig.ts`

- [ ] **Step 1: Locate each entry** by name (line numbers in spec §4.3 are approximate — verify before editing).

```bash
grep -nE "^\s*'(slack-inbound|agent-briefing-update|memory-context-enrichment|page-integration|iee-cost-rollup-daily|connector-polling-tick)':" server/config/jobConfig.ts
```

Expected: 6 lines.

- [ ] **Step 2: For each of the 6 entries, add a `deadLetter:` line** as the last property before the closing brace. Spec §4.3 wording: each gets `deadLetter: '<queue-name>__dlq'`.

| Queue | `deadLetter:` value |
|---|---|
| `slack-inbound` | `'slack-inbound__dlq'` |
| `agent-briefing-update` | `'agent-briefing-update__dlq'` |
| `memory-context-enrichment` | `'memory-context-enrichment__dlq'` |
| `page-integration` | `'page-integration__dlq'` |
| `iee-cost-rollup-daily` | `'iee-cost-rollup-daily__dlq'` |
| `connector-polling-tick` | `'connector-polling-tick__dlq'` |

- [ ] **Step 3: Verify the additions.**

```bash
grep -A 6 "^  '(slack-inbound|agent-briefing-update|memory-context-enrichment|page-integration|iee-cost-rollup-daily|connector-polling-tick)':" server/config/jobConfig.ts | grep deadLetter
```

Expected: 6 lines, each containing `deadLetter: '<queue>__dlq'`.

- [ ] **Step 4: Typecheck.**

Run: `npx tsc --noEmit`
Expected: clean. (No invariant test exists yet — that lands in commit 7.)

- [ ] **Step 5: Commit (commit 3).**

```bash
git add server/config/jobConfig.ts
git commit -m "feat(jobs): add deadLetter to 6 missing JOB_CONFIG entries (G5)"
```

### Task 2.2: G3 config — Add `system-monitor-ingest` entry to JOB_CONFIG (commit 4)

**Files:**
- Modify: `server/config/jobConfig.ts`

- [ ] **Step 1: Locate placement.** Spec §4.4 says: place adjacent to `system-monitor-notify` if it has an entry, otherwise after `system-monitor-self-check`.

```bash
grep -nE "^\s*'system-monitor-(notify|self-check)':" server/config/jobConfig.ts
```

Use the line number returned to position the new entry directly below.

- [ ] **Step 2: Add the entry verbatim from spec §3.3.**

```ts
'system-monitor-ingest': {
  retryLimit: 3,
  retryDelay: 10,
  retryBackoff: true,
  expireInSeconds: 60,
  deadLetter: 'system-monitor-ingest__dlq',
  idempotencyStrategy: 'fifo' as const,
},
```

- [ ] **Step 3: Verify.**

```bash
grep -A 7 "^\s*'system-monitor-ingest':" server/config/jobConfig.ts
```

Expected: the 6 fields above, in the order shown.

- [ ] **Step 4: Typecheck.**

Run: `npx tsc --noEmit`
Expected: clean. If the JOB_CONFIG type rejects `idempotencyStrategy: 'fifo' as const`, check existing entries that use it (`grep -n "idempotencyStrategy" server/config/jobConfig.ts`) and match their style.

- [ ] **Step 5: Commit (commit 4).**

```bash
git add server/config/jobConfig.ts
git commit -m "feat(jobs): add system-monitor-ingest entry to JOB_CONFIG (G3)"
```

### Task 2.3: G1 — Derive `DLQ_QUEUES` + add `forceSync` to `recordIncident` (commit 5)

This commit is a unit because the derivation in `dlqMonitorService.ts` triggers the spec §3.4 loop-hazard invariant — the file's `recordIncident(...)` calls must pass `{ forceSync: true }`, which requires `recordIncident`'s signature to accept the second parameter. All three edits ship together to keep the typechecker green at every commit boundary.

**Files:**
- Create: `server/services/dlqMonitorServicePure.ts`
- Create: `server/services/__tests__/dlqMonitorServicePure.test.ts`
- Modify: `server/services/incidentIngestor.ts:86` — `recordIncident` signature
- Modify: `server/services/dlqMonitorService.ts:14-23` — replace hard-coded array; add `forceSync: true` to all `recordIncident` calls

- [ ] **Step 1: Create `server/services/dlqMonitorServicePure.ts`** per spec §3.2 contract verbatim.

```ts
import { JOB_CONFIG } from '../config/jobConfig.js';

/**
 * Derive the deduplicated list of DLQ queue names from JOB_CONFIG.
 *
 * Pure — no DB, no async, no logger. Throws at boot if any entry's
 * deadLetter value doesn't match the `<queue>__dlq` convention so a
 * misconfiguration fails fast instead of silently subscribing to the
 * wrong DLQ.
 */
export function deriveDlqQueueNames(config: typeof JOB_CONFIG): string[] {
  const dlqs = new Set<string>();
  for (const [queueName, entry] of Object.entries(config)) {
    const dlq = (entry as { deadLetter?: string }).deadLetter;
    if (typeof dlq !== 'string' || dlq.length === 0) continue;

    const expected = `${queueName}__dlq`;
    if (dlq !== expected) {
      throw new Error(
        `[deriveDlqQueueNames] JOB_CONFIG['${queueName}'].deadLetter must equal '${expected}', got '${dlq}'`,
      );
    }

    dlqs.add(dlq);
  }
  return Array.from(dlqs).sort();
}
```

- [ ] **Step 2: Create the pure-helper test** at `server/services/__tests__/dlqMonitorServicePure.test.ts` covering the 4 cases listed in spec §2.1 (a–d).

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveDlqQueueNames } from '../dlqMonitorServicePure.js';

test('returns DLQ names for every entry that declares deadLetter', () => {
  const config = {
    'a': { deadLetter: 'a__dlq' },
    'b': { deadLetter: 'b__dlq' },
  } as unknown as Parameters<typeof deriveDlqQueueNames>[0];
  assert.deepEqual(deriveDlqQueueNames(config), ['a__dlq', 'b__dlq']);
});

test('skips entries without deadLetter', () => {
  const config = {
    'a': { deadLetter: 'a__dlq' },
    'b': {},
  } as unknown as Parameters<typeof deriveDlqQueueNames>[0];
  assert.deepEqual(deriveDlqQueueNames(config), ['a__dlq']);
});

test('deduplicates identical deadLetter values', () => {
  // This shouldn't happen in practice (the convention enforces uniqueness)
  // but the Set guarantees correctness if it ever does.
  const config = {
    'a': { deadLetter: 'shared__dlq' },
    'shared': { deadLetter: 'shared__dlq' },
  } as unknown as Parameters<typeof deriveDlqQueueNames>[0];
  assert.deepEqual(deriveDlqQueueNames(config), ['shared__dlq']);
});

test('throws when deadLetter does not match <queue>__dlq', () => {
  const config = {
    'workflow-run-tick': { deadLetter: 'wrong-name' },
  } as unknown as Parameters<typeof deriveDlqQueueNames>[0];

  assert.throws(
    () => deriveDlqQueueNames(config),
    /JOB_CONFIG\['workflow-run-tick'\]\.deadLetter must equal 'workflow-run-tick__dlq', got 'wrong-name'/,
  );
});
```

- [ ] **Step 3: Run the pure-helper test and verify pass.**

Run: `npx tsx --test server/services/__tests__/dlqMonitorServicePure.test.ts`
Expected: 4 passing tests.

- [ ] **Step 4: Modify `server/services/incidentIngestor.ts`.** Extend `recordIncident` (currently at line 86) to accept the optional `opts` parameter. Replace ONLY the function signature line and the body's branch logic — leave `recordFailure`, `enqueueIngest`, and `ingestInline` untouched.

Find:

```ts
export async function recordIncident(input: IncidentInput): Promise<void> {
  if (!isIngestEnabled()) return;

  try {
    if (isAsyncMode()) {
      await enqueueIngest(input);
    } else {
```

Replace with:

```ts
export async function recordIncident(
  input: IncidentInput,
  opts?: { forceSync?: boolean },
): Promise<void> {
  if (!isIngestEnabled()) return;

  try {
    // forceSync overrides SYSTEM_INCIDENT_INGEST_MODE — used by
    // dlqMonitorService to close the §3.4 loop-hazard invariant. See spec.
    const useAsync = opts?.forceSync === true ? false : isAsyncMode();
    if (useAsync) {
      await enqueueIngest(input);
    } else {
```

Everything else in the function body stays identical (the `else` branch with `computeFingerprint` + `checkThrottle` + `ingestInline`, plus the outer `catch`).

- [ ] **Step 5: Modify `server/services/dlqMonitorService.ts`.** Two edits in this file.

**Edit A** — Replace the hard-coded `DLQ_QUEUES` array (lines 14–23) with the derivation:

```ts
import { JOB_CONFIG } from '../config/jobConfig.js';
import { deriveDlqQueueNames } from './dlqMonitorServicePure.js';

const DLQ_QUEUES = deriveDlqQueueNames(JOB_CONFIG);
```

The two new imports go alongside the existing imports at the top of the file.

**Edit B** — Add `{ forceSync: true }` to every `recordIncident` call inside `startDlqMonitor`. Today there is one call at lines ~41–49. Locate it and pass the options bag as the second argument:

```ts
recordIncident({
  source: 'job',
  summary: `Job reached DLQ: ${sourceQueue}`,
  errorCode: 'job_dlq',
  organisationId: typeof payload.organisationId === 'string' ? payload.organisationId : null,
  subaccountId: typeof payload.subaccountId === 'string' ? payload.subaccountId : null,
  fingerprintOverride: `job:${sourceQueue}:dlq`,
  errorDetail: { jobId: job.id },
}, { forceSync: true });
```

- [ ] **Step 6: Verify both edits.**

```bash
grep -nE "deriveDlqQueueNames|forceSync" server/services/dlqMonitorService.ts
```

Expected output (line numbers may vary):
- `import { deriveDlqQueueNames } from './dlqMonitorServicePure.js';`
- `const DLQ_QUEUES = deriveDlqQueueNames(JOB_CONFIG);`
- `}, { forceSync: true });` — for every `recordIncident` call (currently 1; if more are added later they MUST also pass `forceSync: true`).

- [ ] **Step 7: Typecheck.**

Run: `npx tsc --noEmit`
Expected: clean. The new `recordIncident` second parameter is optional, so no other call site needs to change.

- [ ] **Step 8: Run the unit-test suite to ensure no regressions.**

Run: `bash scripts/run-all-unit-tests.sh`
Expected: clean. Pre-existing `incidentIngestor` tests still pass (the signature change is backwards-compatible for callers omitting the second argument).

- [ ] **Step 9: Commit (commit 5).**

```bash
git add server/services/dlqMonitorServicePure.ts \
        server/services/__tests__/dlqMonitorServicePure.test.ts \
        server/services/dlqMonitorService.ts \
        server/services/incidentIngestor.ts
git commit -m "feat(monitor): derive DLQ_QUEUES from JOB_CONFIG (G1)

Adds deriveDlqQueueNames pure helper, extends recordIncident with an
optional { forceSync?: boolean } second parameter (closes the §3.4
loop-hazard invariant), and replaces the hard-coded DLQ_QUEUES array
with a derivation over JOB_CONFIG. dlqMonitorService now passes
forceSync: true so DLQ-derived incidents never re-enter the
async-ingest queue."
```

### Task 2.4: G3 worker — Register async-ingest worker on boot (commit 6)

**Files:**
- Modify: `server/index.ts` (~line 455 — immediately after `await registerSystemIncidentNotifyWorker(boss);`)

- [ ] **Step 1: Verify the export `handleSystemMonitorIngest` exists** in `server/services/incidentIngestorAsyncWorker.ts`.

```bash
grep -n "export async function handleSystemMonitorIngest" server/services/incidentIngestorAsyncWorker.ts
```

Expected: one match. (Already verified during plan authoring; if missing in the working tree, STOP and append to `tasks/todo.md`.)

- [ ] **Step 2: Locate the registration site** in `server/index.ts`.

```bash
grep -n "registerSystemIncidentNotifyWorker" server/index.ts
```

Expected: one match around line 455. Insert the new block on the line immediately after.

- [ ] **Step 3: Add the conditional registration block** verbatim from spec §4.6:

```ts
// Async-ingest worker — only registers when SYSTEM_INCIDENT_INGEST_MODE=async.
// Sync mode (the default) writes incidents inline in the calling process and
// has no consumer for this queue. Registering the worker unconditionally would
// cause the queue to drain even in sync mode, which is harmless but confusing.
if (process.env.SYSTEM_INCIDENT_INGEST_MODE === 'async') {
  const { handleSystemMonitorIngest } = await import('./services/incidentIngestorAsyncWorker.js');
  await boss.work(
    'system-monitor-ingest',
    { teamSize: 4, teamConcurrency: 1 },
    async (job: { id: string; data: unknown }) => {
      await handleSystemMonitorIngest(job.data as Parameters<typeof handleSystemMonitorIngest>[0]);
    }
  );
  logger.info('async_incident_ingest_worker_registered');
}
```

Do NOT add a new top-level `import` for `handleSystemMonitorIngest` — the dynamic import inside the conditional keeps the boot path lean and matches existing patterns in this file.

- [ ] **Step 4: Verify `logger` is already imported in `server/index.ts`.**

```bash
grep -n "from './lib/logger" server/index.ts
```

Expected: one match. If missing, the existing `logger.info('async_incident_ingest_worker_registered')` line will fail to typecheck — add the import alongside the existing logger imports.

- [ ] **Step 5: Typecheck.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit (commit 6).**

```bash
git add server/index.ts
git commit -m "feat(monitor): register system-monitor-ingest async worker on boot (G3)"
```

### Task 2.5: Invariant tests — `jobConfigInvariant` + `dlqMonitorServiceForceSyncInvariant` (commit 7)

**Files:**
- Create: `server/config/__tests__/jobConfigInvariant.test.ts`
- Create: `server/services/__tests__/dlqMonitorServiceForceSyncInvariant.test.ts`

- [ ] **Step 1: Create `server/config/__tests__/jobConfigInvariant.test.ts`** verbatim from spec §4.7.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { JOB_CONFIG } from '../jobConfig.js';

test('every JOB_CONFIG entry declares a deadLetter queue', () => {
  const missing: string[] = [];
  for (const [name, entry] of Object.entries(JOB_CONFIG)) {
    const dlq = (entry as { deadLetter?: string }).deadLetter;
    if (typeof dlq !== 'string' || dlq.length === 0) {
      missing.push(name);
    }
  }
  assert.deepEqual(missing, [],
    `Queues without deadLetter — every entry MUST declare one to be visible to dlqMonitorService:\n${missing.join('\n')}`);
});

test('every deadLetter follows the <queue>__dlq convention', () => {
  const violations: Array<{ queue: string; deadLetter: string }> = [];
  for (const [name, entry] of Object.entries(JOB_CONFIG)) {
    const dlq = (entry as { deadLetter?: string }).deadLetter;
    if (typeof dlq !== 'string') continue;
    const expected = `${name}__dlq`;
    if (dlq !== expected) {
      violations.push({ queue: name, deadLetter: dlq });
    }
  }
  assert.deepEqual(violations, [],
    `Queues with deadLetter that doesn't match <queue>__dlq:\n${violations.map(v => `${v.queue} → ${v.deadLetter}`).join('\n')}`);
});
```

- [ ] **Step 2: Run the invariant test.**

Run: `npx tsx --test server/config/__tests__/jobConfigInvariant.test.ts`
Expected: 2 passing tests. If any queue is reported as missing `deadLetter`, the G5 list in spec §1.1 was incomplete — add the missing queue's `deadLetter` and re-run. (At plan-write time, JOB_CONFIG should be complete after Task 2.1.)

- [ ] **Step 3: Create `server/services/__tests__/dlqMonitorServiceForceSyncInvariant.test.ts`** per spec §2.1 description: a pure unit test (no pg-boss, no DB) that mocks `recordIncident` and asserts every DLQ-handler invocation passes `{ forceSync: true }` even when `SYSTEM_INCIDENT_INGEST_MODE=async`.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

test('dlqMonitorService passes forceSync: true to recordIncident in async mode', async (t) => {
  const captured: Array<{ input: unknown; opts: unknown }> = [];

  // Mock the recordIncident export from incidentIngestor.
  t.mock.module('../incidentIngestor.js', {
    namedExports: {
      recordIncident: (input: unknown, opts?: unknown) => {
        captured.push({ input, opts });
      },
    },
  });

  // Stub pg-boss: capture each registered handler so the test can invoke it directly.
  const handlers = new Map<string, (job: unknown) => Promise<void>>();
  const fakeBoss = {
    work: async (name: string, _opts: unknown, handler: (job: unknown) => Promise<void>) => {
      handlers.set(name, handler);
    },
  };

  const previousMode = process.env.SYSTEM_INCIDENT_INGEST_MODE;
  process.env.SYSTEM_INCIDENT_INGEST_MODE = 'async';
  try {
    const { startDlqMonitor } = await import('../dlqMonitorService.js');
    await startDlqMonitor(fakeBoss as unknown as Parameters<typeof startDlqMonitor>[0]);

    // Invoke one captured handler with a fake DLQ job.
    const [firstHandler] = handlers.values();
    assert.ok(firstHandler, 'expected at least one DLQ handler registered');
    await firstHandler({
      id: 'job-1',
      data: { organisationId: 'org-1', subaccountId: 'sub-1' },
    });

    assert.equal(captured.length, 1, 'expected exactly one recordIncident call');
    assert.deepEqual(captured[0].opts, { forceSync: true });
  } finally {
    if (previousMode === undefined) delete process.env.SYSTEM_INCIDENT_INGEST_MODE;
    else process.env.SYSTEM_INCIDENT_INGEST_MODE = previousMode;
  }
});
```

If `t.mock.module` is unavailable on the running Node version (`node:test` mock module support landed in Node 22.3), fall back to importing `dlqMonitorService` and rebinding its `recordIncident` reference via a test seam. If the seam doesn't exist, append to `tasks/todo.md` as `dlqMonitorService needs a test seam for forceSync invariant — wire up via a small `__setRecordIncidentForTest` export following the existing `_resetBufferForTest` pattern in `logBuffer.ts`` and ship the chunk without this specific test (the integration test in Task 2.6 still exercises the wiring end-to-end).

- [ ] **Step 4: Run the invariant test.**

Run: `npx tsx --test server/services/__tests__/dlqMonitorServiceForceSyncInvariant.test.ts`
Expected: 1 passing test.

- [ ] **Step 5: Run typecheck.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit (commit 7).**

```bash
git add server/config/__tests__/jobConfigInvariant.test.ts \
        server/services/__tests__/dlqMonitorServiceForceSyncInvariant.test.ts
git commit -m "test: jobConfigInvariant + dlqMonitor forceSync invariant (G1+G5)"
```

### Task 2.6: DLQ round-trip integration test (commit 8)

**Files:**
- Create: `server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts`

This test is gated by `NODE_ENV=integration` and skipped in default CI. It exists to be invoked manually before opening the PR and as part of staging smoke (V2 in spec §9.2).

- [ ] **Step 1: Create the integration test** per spec §4.8. The body uses the existing pg-boss test infra; if the implementer's local environment does not have pg-boss running, the test self-skips via `NODE_ENV` gating.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/index.js';
import { systemIncidents } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { hashFingerprint } from '../incidentIngestorPure.js';

const SKIP = process.env.NODE_ENV !== 'integration';

test('DLQ round-trip: poison job → __dlq → system_incidents row', { skip: SKIP }, async () => {
  const queue = 'workflow-run-tick';
  const fingerprint = hashFingerprint(`job:${queue}:dlq`);

  await db.delete(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));

  // Implementer-supplied: enqueue a poison job with retryLimit=0 so it lands
  // directly in workflow-run-tick__dlq. Use the existing pg-boss test seam if
  // present; otherwise inject the DLQ event by sending to the __dlq queue
  // directly.
  // const boss = await getPgBoss();
  // await boss.send('workflow-run-tick__dlq', { jobId: 'fake-test-job', error: 'forced' });

  let row;
  for (let i = 0; i < 30; i++) {
    [row] = await db.select().from(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));
    if (row) break;
    await new Promise(r => setTimeout(r, 1000));
  }

  assert.ok(row, 'expected a system_incidents row within 30s');
  assert.equal(row.source, 'job');
  assert.equal(row.severity, 'high');
  assert.equal(row.errorCode, 'job_dlq');
  assert.equal(row.occurrenceCount, 1);
});
```

The poison-job enqueue line is commented in the snippet above — the implementer fills it in based on the project's pg-boss test seam (see existing `incidentIngestorThrottle.integration.test.ts` for the canonical pattern). If no seam exists, write the test against `boss.send('<queue>__dlq', …)` to exercise the DLQ subscriber directly.

- [ ] **Step 2: Run the integration test against a live DB + pg-boss** (or skip if not available locally).

Run: `NODE_ENV=integration npx tsx --test server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts`
Expected: 1 passing test, OR cleanly skipped with a "skip" output. Do NOT mark this chunk complete on a failing integration run — fix the test or escalate.

- [ ] **Step 3: Commit (commit 8).**

```bash
git add server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts
git commit -m "test: dlqMonitorRoundTrip integration (G1)"
```

### Chunk 2 close-out

- [ ] **Step 1: Run the full unit-test suite.**

Run: `bash scripts/run-all-unit-tests.sh`
Expected: all green. Pre-existing tests still pass; new pure + invariant tests added in Tasks 2.3, 2.5 are green.

- [ ] **Step 2: Run lint.**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Spec acceptance check (G5, G3, G1).**

- **G5** (every JOB_CONFIG queue has `deadLetter:`): asserted by `jobConfigInvariant.test.ts`.
- **G3-A** (config entry): visible via `grep "system-monitor-ingest" server/config/jobConfig.ts`.
- **G3-B** (worker registration): asserted by `grep "boss.work\(\\s*'system-monitor-ingest'" server/index.ts` returning 1 match inside the `SYSTEM_INCIDENT_INGEST_MODE === 'async'` conditional.
- **G1-A** (DLQ derivation): asserted by `dlqMonitorServicePure.test.ts` cases 1–4.
- **G1-B** (every queue declares `deadLetter:`): asserted by `jobConfigInvariant.test.ts`.
- **§3.4 loop-hazard invariant**: asserted by `dlqMonitorServiceForceSyncInvariant.test.ts`.

Chunk 2 complete. Proceed to Chunk 3.

---

## Chunk 3 — G4-A + G4-B `createWorker` conversion (workflow + IEE)

**Goal (G4):** After this chunk, the workflow engine's 4 worker registrations and the IEE's 4 worker registrations all run through `createWorker`, picking up `JOB_CONFIG`-driven retry/timeout/error-classification semantics. Failures retry per `JOB_CONFIG`, exhaustions land in `<queue>__dlq`, and Chunk 2's DLQ subscriber records an incident for each.

**Spec sections to read first:** §5.1 (why workflow + IEE only), §5.2 (workflow patterns + the per-handler `withOrgTx` decision table), §5.3 (IEE verification), §5.4 (commit ordering), §5.5–§5.6 (verification + acceptance), [§5.2.4 what `createWorker` adds](../../../docs/superpowers/specs/2026-04-28-system-monitoring-coverage-spec.md#524-what-createworker-adds-that-raw-bosswork-lacks).

**Files in this chunk:**
- Modify: `server/services/workflowEngineService.ts` (3 `pgboss.work(...)` registrations at ~lines 3483, 3492, 3503; verify a 4th for `workflow-bulk-parent-check`)
- Modify: `server/jobs/ieeRunCompletedHandler.ts` (verify or convert)
- Modify: `server/services/ieeExecutionService.ts` (verify or convert)
- Verify-only (no edit expected): `server/services/queueService.ts`

**Spec commits this chunk produces:** §5.4 commits 9–13.

**Decision matrix for every conversion (spec §5.2 INVARIANT):**

| Handler contains `withOrgTx`? | Action |
|---|---|
| No | Convert with default `resolveOrgContext` (reads `organisationId` from job payload). |
| Yes — org from `job.data.organisationId` | Remove the inner `withOrgTx` and rely on `createWorker`'s default resolver. |
| Yes — org resolved from a different source (DB row, etc.) | Use `resolveOrgContext: () => null` and keep the handler's own `withOrgTx`. |

This rule **overrides** any conversion pattern in Tasks 3.2–3.6 if reality conflicts with the documented assumption — verify per-handler at edit time.

**Out-of-inventory enforcement:** Beyond `workflowEngineService.ts`, `ieeRunCompletedHandler.ts`, and `ieeExecutionService.ts`, no other file may be touched in this chunk. The remaining ~14 raw `boss.work` registrations in `queueService.ts` are explicitly deferred (spec §10.1) — do NOT convert them here.

### Task 3.1: Pre-conversion preflight (no commit)

**Goal:** establish the per-handler `withOrgTx` decision before any code change. Doing this once up-front keeps each conversion commit single-purpose.

- [ ] **Step 1: Verify the 4 workflow registration sites exist** at the lines spec §5.2 references.

```bash
grep -nE "(boss|pgboss)\.work\(\s*['\"]workflow-(run-tick|watchdog|agent-step|bulk-parent-check)" server/services/workflowEngineService.ts
```

Expected: 3–4 matches. Record the actual line numbers for use below. If `workflow-bulk-parent-check` is not in this file, search the broader server tree:

```bash
grep -rnE "(boss|pgboss)\.work\(\s*['\"]workflow-bulk-parent-check" server
```

If found in another file, it's still in scope for this chunk (spec §5.2 says "convert if it exists in this file (verify at implementation time)"). If not found anywhere, omit the commit-12 conversion and note it in the chunk close-out.

- [ ] **Step 2: Run the `withOrgTx` preflight grep** across the 3 candidate files.

```bash
grep -n "withOrgTx" server/services/workflowEngineService.ts \
                   server/services/ieeExecutionService.ts \
                   server/jobs/ieeRunCompletedHandler.ts
```

For each handler being converted, locate the relevant function and decide which row of the decision matrix applies. Record decisions in scratch notes — they drive Tasks 3.2–3.6.

- [ ] **Step 3: Verify the IEE registration sites.**

```bash
grep -rnE "(boss|pgboss)\.work\(\s*['\"]iee-" server
```

Expected: 3–4 matches across `ieeExecutionService.ts` + `ieeRunCompletedHandler.ts`. If a registration is already wrapped in `createWorker(...)`, mark it "already converted — verify only" for Task 3.6.

- [ ] **Step 4: Verify the `createWorker` import path** is reachable from the files being modified.

```bash
grep -n "createWorker" server/services/workflowEngineService.ts \
                       server/services/ieeExecutionService.ts \
                       server/jobs/ieeRunCompletedHandler.ts
```

If `createWorker` is already imported in any of these files, reuse the existing import. If not, add `import { createWorker } from '../lib/createWorker.js';` (path adjusted per file location) at the import block.

### Task 3.2: Convert `workflow-run-tick` to `createWorker` (commit 9)

**Files:**
- Modify: `server/services/workflowEngineService.ts` (~line 3483)

- [ ] **Step 1: Locate the registration.**

```bash
grep -n "workflow-run-tick" server/services/workflowEngineService.ts
```

Expected: hits at ~3483 (registration site) plus the `TICK_QUEUE` const declaration. Record actual line numbers.

- [ ] **Step 2: Apply the conversion** per spec §5.2.1. Replace the existing block:

```ts
await pgboss.work(TICK_QUEUE, { teamSize: 4, teamConcurrency: 1 }, async (job) => {
  const data = job.data as { runId: string };
  await this.tick(data.runId);
});
```

with:

```ts
await createWorker({
  queue: TICK_QUEUE as any,
  boss: pgboss as any,
  concurrency: 4,
  resolveOrgContext: () => null,  // tick reads org from workflow_runs row
  handler: async (job) => {
    const data = job.data as { runId: string };
    await this.tick(data.runId);
  },
});
```

The `as any` casts on `queue` and `boss` mirror the spec snippet — they exist because `createWorker`'s `JobName` type may not include `TICK_QUEUE`'s string literal until JOB_CONFIG is regenerated. If typecheck objects, drop the casts and let the type system guide you to the correct `JobName` value.

- [ ] **Step 3: If the preflight grep showed `withOrgTx` already inside `tick`'s body and resolves org from a DB row** — keep `resolveOrgContext: () => null` (the "different source" row of the decision matrix). If `withOrgTx` is absent from `tick`, the `() => null` opt-out is still correct because the tick payload is `{ runId }`, not `{ organisationId }`.

- [ ] **Step 4: Verify import.** If `createWorker` was not previously imported in this file, add: `import { createWorker } from '../lib/createWorker.js';` near the existing imports.

- [ ] **Step 5: Typecheck.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Verify the conversion grep.**

```bash
grep -nE "(boss|pgboss)\.work\(\s*['\"]workflow-run-tick" server/services/workflowEngineService.ts
```

Expected: 0 matches. (The remaining `TICK_QUEUE`-string reference is now inside a `createWorker({ queue: TICK_QUEUE })` call.)

- [ ] **Step 7: Commit (commit 9).**

```bash
git add server/services/workflowEngineService.ts
git commit -m "refactor(workflows): convert workflow-run-tick to createWorker (G4-A)"
```

### Task 3.3: Convert `workflow-watchdog` to `createWorker` (commit 10)

**Files:**
- Modify: `server/services/workflowEngineService.ts` (~line 3492)

- [ ] **Step 1: Apply the conversion** per spec §5.2.2 (watchdog is a cross-org sweep — opt out of org-tx prelude).

Replace:

```ts
await pgboss.work(WATCHDOG_QUEUE, { teamSize: 1, teamConcurrency: 1 }, async () => {
  await this.watchdogSweep();
});
```

with:

```ts
await createWorker({
  queue: WATCHDOG_QUEUE as any,
  boss: pgboss as any,
  concurrency: 1,
  resolveOrgContext: () => null,
  handler: async () => {
    await this.watchdogSweep();
  },
});
```

- [ ] **Step 2: Typecheck.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Verify.**

```bash
grep -nE "(boss|pgboss)\.work\(\s*['\"]workflow-watchdog" server/services/workflowEngineService.ts
```

Expected: 0 matches.

- [ ] **Step 4: Commit (commit 10).**

```bash
git add server/services/workflowEngineService.ts
git commit -m "refactor(workflows): convert workflow-watchdog to createWorker (G4-A)"
```

### Task 3.4: Convert `workflow-agent-step` to `createWorker` (commit 11)

**Files:**
- Modify: `server/services/workflowEngineService.ts` (~line 3503)

- [ ] **Step 1: Apply the conversion** per spec §5.2.3. Agent-step carries `organisationId` directly in the payload, so the **default** resolver applies — UNLESS the preflight grep showed an inner `withOrgTx` resolving org from a different source.

Replace the existing `await pgboss.work(AGENT_STEP_QUEUE, ...)` block with:

```ts
await createWorker({
  queue: AGENT_STEP_QUEUE as any,
  boss: pgboss as any,
  concurrency: 4,
  // Default resolveOrgContext reads { organisationId, subaccountId? } from job.data.
  handler: async (job) => {
    const data = job.data as {
      WorkflowStepRunId: string;
      WorkflowRunId: string;
      organisationId: string;
      // ... existing fields
    };
    // existing handler body — DO NOT re-paraphrase from memory; copy verbatim
    // from the original block being replaced. Only the wrapper changes.
  },
});
```

**Important:** copy the existing handler body verbatim into the `handler:` callback. Do not rewrite from memory or attempt incremental cleanup — that's drive-by reformatting (CLAUDE.md §6).

If the preflight grep showed an inner `withOrgTx` whose org comes from `job.data.organisationId`, **remove** the inner `withOrgTx` (the default resolver now owns the tx). If the inner `withOrgTx` resolves from a different source, fall back to `resolveOrgContext: () => null` and keep the inner `withOrgTx` intact.

- [ ] **Step 2: Typecheck.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Verify.**

```bash
grep -nE "(boss|pgboss)\.work\(\s*['\"]workflow-agent-step" server/services/workflowEngineService.ts
```

Expected: 0 matches.

- [ ] **Step 4: Commit (commit 11).**

```bash
git add server/services/workflowEngineService.ts
git commit -m "refactor(workflows): convert workflow-agent-step to createWorker (G4-A)"
```

### Task 3.5: Convert `workflow-bulk-parent-check` to `createWorker` (commit 12 — conditional)

**Skip this task entirely if Task 3.1 Step 1 found no `workflow-bulk-parent-check` registration.** The spec explicitly authorises omission: §5.2 says "convert if it exists in this file (verify at implementation time)."

**Files:**
- Modify: `server/services/workflowEngineService.ts` (location varies)

- [ ] **Step 1: Locate the registration** at the line numbers identified in Task 3.1 Step 1.

- [ ] **Step 2: Apply the conversion.** Use the same shape as Task 3.2 (`resolveOrgContext: () => null`) unless preflight showed otherwise. The bulk-parent-check is a sweep — cross-org behaviour expected.

```ts
await createWorker({
  queue: 'workflow-bulk-parent-check' as any,
  boss: pgboss as any,
  concurrency: 1,
  resolveOrgContext: () => null,
  handler: async (job) => {
    // existing handler body — copy verbatim
  },
});
```

- [ ] **Step 3: Typecheck.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Verify.**

```bash
grep -rnE "(boss|pgboss)\.work\(\s*['\"]workflow-bulk-parent-check" server
```

Expected: 0 matches.

- [ ] **Step 5: Commit (commit 12).**

```bash
git add server/services/workflowEngineService.ts
git commit -m "refactor(workflows): convert workflow-bulk-parent-check to createWorker (G4-A)"
```

### Task 3.6: Verify or convert IEE workers (commit 13)

**Files:**
- Modify: `server/services/ieeExecutionService.ts` (or verify-only)
- Modify: `server/jobs/ieeRunCompletedHandler.ts` (or verify-only)

The spec is uncertain whether IEE workers already route through `createWorker`. Audit-time evidence (spec §5.3) shows `ieeRunCompletedHandler.ts:80` uses `.work(QUEUE, ...)` but it MAY already be inside a `createWorker` wrapper — verify before editing.

- [ ] **Step 1: For each IEE registration site identified in Task 3.1 Step 3,** decide:
  - Already wrapped in `createWorker` → no change.
  - Raw `boss.work` → convert.

- [ ] **Step 2: Conversion patterns:**

| Queue | Resolver | Concurrency |
|---|---|---|
| `iee-browser-task` | default (payload carries `organisationId`) | per JOB_CONFIG |
| `iee-dev-task` | default | per JOB_CONFIG |
| `iee-cleanup-orphans` | `() => null` (cross-org sweep) | 1 |
| `iee-run-completed` | default if payload carries `organisationId`; otherwise `() => null` | per JOB_CONFIG |

Apply per-handler. Copy each existing handler body verbatim into the new `handler:` callback.

- [ ] **Step 3: Spec §5.3 risk callout — IEE handlers have bespoke timeout logic.** `createWorker` derives `timeoutMs` from `JOB_CONFIG[queue].expireInSeconds × 900`. Spec §5.3 confirms this is comfortably above the IEE handler's `MAX_EXECUTION_TIME_MS` (per `jobConfig.ts:289-296`), so no override is needed. If the IEE handler has its own internal timeout shorter than the wrapper timeout, the inner timeout still fires first — no conflict.

- [ ] **Step 4: Typecheck.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Verify the conversions / non-conversions.**

```bash
grep -rnE "(boss|pgboss)\.work\(\s*['\"]iee-" server
```

Expected: only matches that are inside `createWorker({ ..., boss: ... })` calls (`createWorker` internally calls `boss.work`, so the literal won't fully disappear from the broader server tree). What MUST be 0 is direct `boss.work('iee-…', …)` not wrapped by `createWorker`.

A more precise check:

```bash
grep -rB 5 "boss.work\(\s*'iee-" server | grep -B 5 "createWorker"
```

If your editor's grep doesn't support the `-B` flag this way, eyeball the matches.

- [ ] **Step 6: Commit (commit 13).**

```bash
git add server/services/ieeExecutionService.ts server/jobs/ieeRunCompletedHandler.ts
git commit -m "refactor(iee): verify/convert IEE workers to createWorker (G4-B)"
```

If both files were verify-only (no edits), skip this commit and note in the chunk close-out: "IEE workers already routed through createWorker — no changes."

### Chunk 3 close-out

- [ ] **Step 1: Run the unit-test suite.**

Run: `bash scripts/run-all-unit-tests.sh`
Expected: all green. No new test files were added in Chunk 3 — the existing workflow / IEE tests should still pass against the refactored registrations.

- [ ] **Step 2: Run lint.**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Spec acceptance check (G4-A, G4-B).**

- **G4-A** (workflow): `grep -E "createWorker.*workflow-(run-tick|watchdog|agent-step|bulk-parent-check)" server/services/workflowEngineService.ts` returns 3 or 4 matches (4 if `bulk-parent-check` was found in Task 3.5; 3 otherwise). `grep -E "(boss|pgboss)\.work\(.*'workflow-" server/services/workflowEngineService.ts` returns 0 matches.
- **G4-B** (IEE): every IEE queue's registration is either pre-existing inside a `createWorker` call or was converted in Task 3.6.

- [ ] **Step 4: Manual smoke** (per spec §5.5 V4): submit a workflow run that intentionally throws on first invocation, observe pg-boss retries per `JOB_CONFIG.workflow-run-tick.retryLimit`, observe a `system_incidents` row appearing within 30s of DLQ-landing. Skip if local infra is not available — this is run as part of staging V4 verification (spec §9.2).

Chunk 3 complete. Proceed to Chunk 4.

---

## Chunk 4 — G7 webhook 5xx incident emission

**Goal (G7):** After this chunk, the GHL and GitHub webhook handlers' 5xx-returning catch blocks call `recordIncident` with stable `fingerprintOverride` keys, so repeated webhook failures dedup into a single incident row with `occurrenceCount` ticking up.

**Spec sections to read first:** §3.5 (webhook-handler incident contract), §6.1 (full G7 sub-tree including the §6.1.3 verify list), §8.5 (write-path contract).

**Files in this chunk:**
- Modify: `server/routes/webhooks/ghlWebhook.ts` (~lines 63–67 catch block — verify line numbers at edit time)
- Modify: `server/routes/githubWebhook.ts` (~lines 122–124 catch block — verify line numbers at edit time)

**Spec commits this chunk produces:** §6.4 commits 14–15.

**No tests added in this chunk.** Per spec §6.3.2: webhook 5xx paths are mechanical glue — pure-helper testing of three lines of `recordIncident({...})` is overkill, manual smoke is the verification surface (spec §9.2 V5).

### Task 4.1: GHL webhook — emit `recordIncident` on DB-lookup failure (commit 14)

**Files:**
- Modify: `server/routes/webhooks/ghlWebhook.ts`

- [ ] **Step 1: Verify the current catch block** matches spec §6.1.1's "before" snippet.

```bash
grep -n -A 5 "GHL Webhook.*DB lookup" server/routes/webhooks/ghlWebhook.ts
```

Expected: a `console.error('[GHL Webhook] DB lookup failed:', ...)` line followed by `res.status(500).json(...)` and `return`. If the structure has changed since spec authoring, follow the §6.1.3 catch-all guidance: emit `recordIncident` immediately before any `res.status(500)` inside an internal try/catch.

- [ ] **Step 2: Add the import** at the top of the file alongside existing imports.

```ts
import { recordIncident } from '../../services/incidentIngestor.js';
```

If the path resolves differently in this file's directory layout (`server/routes/webhooks/` is two levels deep), the relative import is `../../services/incidentIngestor.js` — verify with `grep -n "from '" server/routes/webhooks/ghlWebhook.ts | head -5` to match the file's existing import style.

- [ ] **Step 3: Replace the catch block** per spec §6.1.1 "after" snippet.

```ts
} catch (err) {
  console.error('[GHL Webhook] DB lookup failed:', err instanceof Error ? err.message : err);

  // Surface to the System Monitor so the agent can triage repeated failures.
  // fingerprintOverride pins the dedup key; stack-derived fingerprinting is
  // unreliable inside webhook handlers because the failure surface depends on
  // adapter internals we don't control.
  recordIncident({
    source: 'route',
    summary: `GHL webhook DB lookup failed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
    errorCode: 'webhook_handler_failed',
    stack: err instanceof Error ? err.stack : undefined,
    fingerprintOverride: 'webhook:ghl:db_lookup_failed',
    errorDetail: { locationId },
  });

  res.status(500).json({ error: 'Internal error' });
  return;
}
```

- [ ] **Step 4: Verify no other 5xx paths are missed** in this file.

```bash
grep -nE "res\.status\(5[0-9]+\)" server/routes/webhooks/ghlWebhook.ts
```

If more than one 5xx site exists, apply the same pattern to each. The audit identified only the DB-lookup site at lines 63–67, but a re-verification at edit time is mandatory per spec §6.1.1 ("apply the same pattern to any other internal `try/catch` that ends in `res.status(500)` without throwing").

- [ ] **Step 5: Typecheck.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Verify the addition.**

```bash
grep -A 10 "res.status(500)" server/routes/webhooks/ghlWebhook.ts | grep recordIncident
```

Expected: at least one match per 5xx-returning catch block.

- [ ] **Step 7: Commit (commit 14).**

```bash
git add server/routes/webhooks/ghlWebhook.ts
git commit -m "feat(webhooks): emit recordIncident on GHL handler 5xx (G7)"
```

### Task 4.2: GitHub webhook — emit `recordIncident` on handler error (commit 15)

**Files:**
- Modify: `server/routes/githubWebhook.ts`

The GitHub webhook uses an early-ack pattern: it returns 200 to GitHub at line 112 BEFORE the handler runs, so the `recordIncident` emission post-ack does not affect the response. This is intentional and documented in spec §6.1.2.

- [ ] **Step 1: Verify the current catch block** matches spec §6.1.2's "before" snippet.

```bash
grep -n -B 2 -A 4 "github_webhook.handler_error" server/routes/githubWebhook.ts
```

Expected: a `logger.error('github_webhook.handler_error', { event, delivery, error: ... })` line inside a catch block at ~lines 122–124.

- [ ] **Step 2: Add the import** at the top of the file.

```ts
import { recordIncident } from '../services/incidentIngestor.js';
```

This file is one level shallower than the GHL file (`server/routes/`, not `server/routes/webhooks/`), so the relative import path differs. Verify with `grep -n "from '" server/routes/githubWebhook.ts | head -5`.

- [ ] **Step 3: Replace the catch block** per spec §6.1.2 "after" snippet.

```ts
} catch (err) {
  logger.error('github_webhook.handler_error', { event, delivery, error: err instanceof Error ? err.message : String(err) });

  // The response was already sent at line 112 (early-ack pattern). This
  // emission is purely for observability — it never affects the response.
  recordIncident({
    source: 'route',
    summary: `GitHub webhook handler failed for event ${event}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
    errorCode: 'webhook_handler_failed',
    stack: err instanceof Error ? err.stack : undefined,
    fingerprintOverride: 'webhook:github:handler_failed',
    errorDetail: { event, delivery },
  });
}
```

- [ ] **Step 4: Verify no other 5xx paths are missed.**

```bash
grep -nE "res\.status\(5[0-9]+\)" server/routes/githubWebhook.ts
```

The early-ack pattern means there should be 0 inline 500s; the handler's failure mode is a logged error after the response. If the grep returns matches, apply the §6.1.1 pattern to each.

- [ ] **Step 5: Verify the §6.1.3 "no change needed" list** — confirm the other webhook routes still use `asyncHandler`.

```bash
grep -nE "res\.status\(5[0-9]+\)" server/routes/webhooks/slackWebhook.ts \
                                    server/routes/webhooks/teamworkWebhook.ts \
                                    server/routes/webhooks.ts
```

Expected: 0 matches (or matches are inside `asyncHandler` callbacks where the global error handler catches them — eyeball if needed). If the grep surfaces an inline 500 in any of these three files, append a finding to `tasks/todo.md` (`webhook 5xx coverage gap in <file>:<line>`) and ship the chunk against its locked scope only — do NOT expand scope here.

- [ ] **Step 6: Typecheck.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Verify the addition.**

```bash
grep -A 12 "github_webhook.handler_error" server/routes/githubWebhook.ts | grep recordIncident
```

Expected: at least one match.

- [ ] **Step 8: Commit (commit 15).**

```bash
git add server/routes/githubWebhook.ts
git commit -m "feat(webhooks): emit recordIncident on GitHub handler error (G7)"
```

### Chunk 4 close-out

- [ ] **Step 1: Run the unit-test suite.**

Run: `bash scripts/run-all-unit-tests.sh`
Expected: all green. No new tests added in this chunk; the existing webhook tests should pass against the augmented catch blocks.

- [ ] **Step 2: Run lint.**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Spec acceptance check (G7).** Per spec §1.1 G7 verifiable assertion:

```bash
grep -A 5 "res.status(500)" server/routes/webhooks/ghlWebhook.ts server/routes/githubWebhook.ts | grep recordIncident
```

Expected: at least one `recordIncident` per 5xx-returning catch block (so for GHL, ≥1 match; for GitHub the early-ack pattern means a recordIncident exists post-ack rather than next to a 500). The §6.6 acceptance check uses `grep -A 10 "res.status(500)"` — same shape, larger window.

- [ ] **Step 4: Manual smoke** (per spec §9.2 V5): trigger a GHL webhook for a non-existent `locationId`, observe a `system_incidents` row with `fingerprint = hashFingerprint('webhook:ghl:db_lookup_failed').slice(0, 16)`. Repeat with a malformed GitHub payload. Skip if local infra is not available — runs as part of staging V5 verification.

Chunk 4 complete. Proceed to Chunk 5.

---

## Chunk 5 — G11 skill-analyzer wrap + tests

**Goal (G11):** After this chunk, every skill-analyzer terminal failure produces a `system_incidents` row with `fingerprintOverride: 'skill_analyzer:terminal_failure'` and the original error is re-thrown so pg-boss retry semantics + DLQ flow are preserved.

**Spec sections to read first:** §3.6 (skill-analyzer incident contract), §6.2 (full G11 sub-tree including the dual-fingerprint rationale), §6.3.1 (test scope honesty + sample), §8.6 (write-path contract).

**Files in this chunk:**
- Modify: `server/index.ts` (~line 478 — wrap the existing `processSkillAnalyzerJob` invocation)
- Create: `server/jobs/__tests__/skillAnalyzerJobIncidentEmission.integration.test.ts`

**Spec commits this chunk produces:** §6.4 commits 16–17.

**Phase 2 dependency note (per spec §6.2.1):** if Chunk 3's IEE work moved the skill-analyzer registration site, the wrap lives inside the new `createWorker` `handler:` callback instead of a raw `boss.work` callback. Audit-time evidence shows the registration is at `server/index.ts:476` (NOT in any IEE module), so there is likely no overlap — verify at edit time before assuming the line number.

### Task 5.1: Wrap `processSkillAnalyzerJob` with `recordIncident` (commit 16)

**Files:**
- Modify: `server/index.ts` (~line 476–479)

- [ ] **Step 1: Verify the current registration shape.**

```bash
grep -n -A 4 "processSkillAnalyzerJob" server/index.ts
```

Expected: a `boss.work('skill-analyzer', async (job) => { ... await processSkillAnalyzerJob(jobId); ... })` block at ~line 476–479. If Chunk 3 moved this to `createWorker`, the wrap goes inside the `handler:` callback instead — semantics are identical.

- [ ] **Step 2: Verify `recordIncident` is already imported.** Spec §6.2 notes it should be at line 161.

```bash
grep -n "import.*recordIncident" server/index.ts
```

Expected: 1 match. If absent, add `import { recordIncident } from './services/incidentIngestor.js';` alongside the existing imports — but per architect's hidden-deps flag, this should already exist. If you find yourself adding it, double-check by re-grepping (you may have a different path or an aliased import).

- [ ] **Step 3: Replace the registration body** per spec §6.2 verbatim.

Find:

```ts
const { processSkillAnalyzerJob } = await import('./jobs/skillAnalyzerJob.js');
await boss.work('skill-analyzer', async (job) => {
  const { jobId } = job.data as { jobId: string };
  await processSkillAnalyzerJob(jobId);
});
```

Replace with:

```ts
const { processSkillAnalyzerJob } = await import('./jobs/skillAnalyzerJob.js');
await boss.work('skill-analyzer', async (job) => {
  const { jobId } = job.data as { jobId: string };
  try {
    await processSkillAnalyzerJob(jobId);
  } catch (err) {
    // Surface terminal failures to the System Monitor. pg-boss retry exhaustion
    // also lands in skill-analyzer__dlq (covered by Phase 1's DLQ derivation),
    // but emitting here too gives faster visibility for failures that happen
    // on the FINAL retry attempt — without this wrap, the operator sees no
    // signal until the DLQ row lands.
    recordIncident({
      source: 'job',
      severity: 'high',
      summary: `Skill analyzer terminal failure for job ${jobId}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
      errorCode: 'skill_analyzer_failed',
      stack: err instanceof Error ? err.stack : undefined,
      fingerprintOverride: 'skill_analyzer:terminal_failure',
      errorDetail: { jobId },
    });
    throw err; // preserve pg-boss retry semantics
  }
});
```

The `throw err` line is mandatory — without it, pg-boss marks the job `completed` even though it failed, breaking `processSkillAnalyzerJob`'s crash-resume contract (spec §6.2 explicit invariant).

- [ ] **Step 4: Typecheck.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Verify the wrap.**

```bash
grep -n -A 20 "boss.work\(\s*'skill-analyzer'" server/index.ts | grep -E "(recordIncident|throw err)"
```

Expected: at least 2 matches (one `recordIncident`, one `throw err`).

- [ ] **Step 6: Commit (commit 16).**

```bash
git add server/index.ts
git commit -m "feat(jobs): wrap skill-analyzer handler with recordIncident (G11)"
```

### Task 5.2: Skill-analyzer incident emission integration tests (commit 17)

**Files:**
- Create: `server/jobs/__tests__/skillAnalyzerJobIncidentEmission.integration.test.ts`

**Test scope honesty (per spec §6.3.1):** these tests exercise the *emission semantics* of the wrap — fingerprint shape, dedup behaviour, error re-throw — by calling `recordIncident` directly inside a try/catch that mirrors the wrapper's body. They do NOT exercise pg-boss delivery, retry exhaustion, or the wrapper's literal placement inside `boss.work(...)` in `server/index.ts`. Wrapper-location regressions are caught by the Task 5.1 Step 5 grep verification, not by these tests.

- [ ] **Step 1: Create the test file** verbatim from spec §6.3.1.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../db/index.js';
import { systemIncidents } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { hashFingerprint } from '../../services/incidentIngestorPure.js';

const SKIP = process.env.NODE_ENV !== 'integration';

test('skill-analyzer terminal failure produces a system_incidents row', { skip: SKIP }, async () => {
  const fingerprint = hashFingerprint('skill_analyzer:terminal_failure');
  await db.delete(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));

  const originalJobId = 'test-job-' + Date.now();
  let propagatedError: unknown = null;

  try {
    const { recordIncident } = await import('../../services/incidentIngestor.js');

    try {
      throw new Error('simulated handler failure');
    } catch (err) {
      recordIncident({
        source: 'job',
        severity: 'high',
        summary: `Skill analyzer terminal failure for job ${originalJobId}: simulated handler failure`,
        errorCode: 'skill_analyzer_failed',
        stack: err instanceof Error ? err.stack : undefined,
        fingerprintOverride: 'skill_analyzer:terminal_failure',
        errorDetail: { jobId: originalJobId },
      });
      throw err;
    }
  } catch (err) {
    propagatedError = err;
  }

  // Wait for the incident write to commit (sync mode).
  await new Promise(r => setTimeout(r, 100));

  const [row] = await db.select().from(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));
  assert.ok(row, 'expected a system_incidents row');
  assert.equal(row.source, 'job');
  assert.equal(row.severity, 'high');
  assert.equal(row.errorCode, 'skill_analyzer_failed');
  assert.ok((row.latestErrorDetail as { jobId?: string }).jobId === originalJobId, 'expected jobId in errorDetail');
  assert.ok(propagatedError instanceof Error, 'expected error to be re-thrown');
  assert.equal((propagatedError as Error).message, 'simulated handler failure');
});

test('skill-analyzer dedup: 5 failures collapse to one row with occurrenceCount=5', { skip: SKIP }, async () => {
  const fingerprint = hashFingerprint('skill_analyzer:terminal_failure');
  await db.delete(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));

  const { recordIncident } = await import('../../services/incidentIngestor.js');

  for (let i = 0; i < 5; i++) {
    recordIncident({
      source: 'job',
      severity: 'high',
      summary: `Skill analyzer terminal failure for job test-${i}: bang`,
      errorCode: 'skill_analyzer_failed',
      fingerprintOverride: 'skill_analyzer:terminal_failure',
      errorDetail: { jobId: `test-${i}` },
    });
    await new Promise(r => setTimeout(r, 50));
  }

  const [row] = await db.select().from(systemIncidents).where(eq(systemIncidents.fingerprint, fingerprint));
  assert.ok(row, 'expected exactly one row from 5 failures');
  assert.equal(row.occurrenceCount, 5);
});
```

- [ ] **Step 2: Run the integration tests against a live DB** (or skip if not available locally).

Run: `NODE_ENV=integration npx tsx --test server/jobs/__tests__/skillAnalyzerJobIncidentEmission.integration.test.ts`
Expected: 2 passing tests, OR cleanly skipped. Do NOT mark this chunk complete on a failing integration run.

- [ ] **Step 3: Typecheck.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit (commit 17).**

```bash
git add server/jobs/__tests__/skillAnalyzerJobIncidentEmission.integration.test.ts
git commit -m "test: skill-analyzer incident emission integration tests (G11)"
```

### Chunk 5 close-out

- [ ] **Step 1: Run the full unit-test suite.**

Run: `bash scripts/run-all-unit-tests.sh`
Expected: all green. The new integration test self-skips outside `NODE_ENV=integration`.

- [ ] **Step 2: Run lint.**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Spec acceptance check (G11).** Per spec §1.1 G11 verifiable assertion: integration test injects a thrown error and asserts both (a) one `system_incidents` row written with the named fingerprint, and (b) the original error is propagated. Both assertions are encoded in the §6.3.1 test cases above.

Additionally per spec §6.6: `grep -n -A 20 "boss.work\(\s*'skill-analyzer'" server/index.ts` shows a `recordIncident` call before `throw err`. Verified by Task 5.1 Step 5.

- [ ] **Step 4: Manual smoke** (per spec §9.2 V6): submit a skill-analyzer job that forces a terminal throw, observe a row within 1s with `fingerprintOverride` matching `'skill_analyzer:terminal_failure'`. Repeat 5 times with different `jobId`s, confirm one row with `occurrenceCount=5` (NOT 5 separate rows). Skip if local infra is not available — runs as part of staging V6 verification.

Chunk 5 complete. Proceed to End-of-build verification + handoff.

---

## End-of-build verification + handoff

After all 5 chunks land (17 commits on `claude/add-monitoring-logging-3xMKQ`), execute the steps below in order.

### Step 1: Documentation sync (CLAUDE.md §11 — same-commit rule)

The spec changes the System Monitor's coverage surface. `architecture.md § System Monitor` must reflect this in the same PR.

- [ ] Read `architecture.md § System Monitor` (or whichever section covers the monitor pipeline).
- [ ] Update the coverage list to reflect the new state: 40 DLQ subscriptions (up from 8), log buffer wired from `logger.emit`, async-ingest mode functional, workflow + IEE through `createWorker`, webhook 5xx + skill-analyzer terminal failures emit incidents.
- [ ] If `architecture.md` does not currently have a System Monitor coverage list, do NOT create one as part of this PR (CLAUDE.md §6 surgical-changes rule). Note in `tasks/todo.md` that `architecture.md § System Monitor` needs a coverage section, and ship the rest of the PR.
- [ ] Commit:

```bash
git add architecture.md
git commit -m "docs(architecture): update System Monitor coverage list (post system-monitoring-coverage)"
```

### Step 2: Final unit-test pass

- [ ] Run: `bash scripts/run-all-unit-tests.sh`
- [ ] Expected: all green, including the 4 new pure-helper / invariant test files added in Chunks 1–2 + 5.

### Step 3: Final typecheck + lint

- [ ] Run in parallel: `npx tsc --noEmit` and `npm run lint`
- [ ] Expected: both clean.

### Step 4: Spec-conformance review (mandatory per CLAUDE.md)

This is a Significant/Major spec-driven task. Run `spec-conformance` BEFORE `pr-reviewer`.

- [ ] From the main session, invoke: `spec-conformance: verify the current branch against its spec`
- [ ] Expected outcomes: `CONFORMANT` (proceed), `CONFORMANT_AFTER_FIXES` (proceed; the agent will have written mechanical fixes — re-run `pr-reviewer` against the expanded change set), or `NON_CONFORMANT` (triage findings; some may route to `tasks/todo.md` as deferred, others may require code changes in this PR).
- [ ] Read the log written to `tasks/review-logs/spec-conformance-log-system-monitoring-coverage-<timestamp>.md`.

### Step 5: pr-reviewer (always)

- [ ] Invoke: `pr-reviewer: review the changes I just made`
- [ ] Brief description for the agent: "system-monitoring-coverage: closes 7 producer-side monitoring gaps (G1, G2, G3, G4 subset, G5, G7, G11). 9 new files + ≤9 modified files across server/lib, server/services, server/config, server/routes, server/index.ts. No migrations, no schema changes, no new primitives."
- [ ] Address findings inline. If any finding is rejected as a false positive, log the rationale in the PR description.

### Step 6: dual-reviewer (optional — local-only, user-triggered)

Per CLAUDE.md, `dual-reviewer` runs only when the user explicitly asks AND the session is local. Spec §5.6 recommends it for Phase 2 (boot-time wiring is harder to spot-check), but the trigger is the user's call, not yours.

- [ ] If user-triggered: invoke `dual-reviewer` with the same brief as Step 5.

### Step 7: chatgpt-pr-review (optional)

- [ ] If user wants a second-phase review pass: spawn a dedicated new Claude Code session and run `chatgpt-pr-review`. The agent self-detects the PR and the spec.

### Step 8: Pre-merge gate (`npm run test:gates`)

This is the single point in the build where the expensive gates suite runs (CLAUDE.md gate-cadence rule).

- [ ] Run: `npm run test:gates`
- [ ] Expected: all green.
- [ ] If a gate fails: investigate root cause; do NOT skip with `--no-verify` or any equivalent. Per spec §0.3 and CLAUDE.md §1, escalate after 3 failed fix attempts.

### Step 9: V1–V7 manual smoke verification (staging)

The spec's §9.2 verification checklist is the operator-facing acceptance gate.

- [ ] **V1** — Log buffer round trip (G2). Hit a route, capture the correlationId, confirm `readLinesForCorrelationId` returns ≥1 line.
- [ ] **V2** — DLQ subscription coverage (G1, G5). For 3 representative queues (`workflow-run-tick`, `skill-analyzer`, `connector-polling-sync`), poison-pill a job and confirm a `system_incidents` row appears within 30s with the matching `job:<queue>:dlq` fingerprint.
- [ ] **V3** — Async-ingest worker drains (G3). Set `SYSTEM_INCIDENT_INGEST_MODE=async`, restart, trigger a 5xx, confirm the queue empties and the row exists.
- [ ] **V4** — Workflow engine failures surface (G4-A). Submit a workflow run that throws, confirm the DLQ-derived `system_incidents` row.
- [ ] **V5** — Webhook 5xx emits incident (G7). GHL with non-existent `locationId`; GitHub with malformed payload. Confirm both rows exist.
- [ ] **V6** — Skill-analyzer terminal failure surfaces (G11). 5 failures with different `jobId`s collapse into 1 row with `occurrenceCount=5`.
- [ ] **V7** — End-to-end: route → triage → diagnosis with log evidence (G2 + cumulative). Confirm the agent's diagnosis cites a buffered log line.

### Step 10: Pre-merge checklist sign-off

Tick the items in spec §9.6 (already mirrored above). When all 14 items are checked, the PR is mergeable into `main`.

### Step 11: Post-merge

- [ ] Update `tasks/current-focus.md` — set `Active spec` and `Active build slug` to `none` (or to the next spec in flight).
- [ ] Append a "Recently shipped to `main`" entry to `tasks/current-focus.md` summarising the build (1 short paragraph).
- [ ] Tick the relevant entries in `tasks/post-merge-system-monitor.md` and the audit log (`tasks/review-logs/codebase-audit-log-monitoring-coverage-2026-04-28T06-09-11Z.md`) per spec §10.5 tracking.
- [ ] Capture any durable patterns in `KNOWLEDGE.md` (CLAUDE.md §3 self-improvement loop). Patterns from the spec-review session are already recorded — only add if implementation surfaced new learning (e.g. an unexpected interaction with `createWorker`'s timeout wrapping).
- [ ] If the build deferred any items to `tasks/todo.md` during execution, ensure each entry has a clear trigger condition for re-pickup.

---

## Spec-coverage cross-check

Mapping every spec §1.1 goal to its plan task:

| Goal | Spec ref | Plan task | Verifiable assertion |
|---|---|---|---|
| **G1-A** — Derived DLQ subscription coverage | §1.1 | Task 2.3 + close-out | `dlqMonitorServicePure.test.ts` cases 1–4 + grep on `dlqMonitorService.ts` |
| **G1-B** — Every JOB_CONFIG queue has `deadLetter:` | §1.1 | Tasks 2.1, 2.2, 2.5 | `jobConfigInvariant.test.ts` |
| **G2** — Log buffer populated by every correlationId emission | §1.1 | Tasks 1.1, 1.2 | `loggerBufferAdapterPure.test.ts` + `logger.integration.test.ts` |
| **G3** — Async ingest worker drains | §1.1 | Tasks 2.2, 2.4 | grep on `server/index.ts` + V3 manual smoke |
| **G4-A** — Workflow engine workers via `createWorker` | §1.1 | Tasks 3.2–3.5 + close-out | grep returning 3–4 `createWorker` matches, 0 raw `boss.work` matches |
| **G4-B** — IEE workers verified `createWorker`-routed | §1.1 | Task 3.6 + close-out | same grep convention applied to IEE files |
| **G5** — 6 previously DLQ-less queues now have `deadLetter:` | §1.1 | Task 2.1 | Subsumed by G1-B's invariant test |
| **G7** — Webhook 5xx paths emit `recordIncident` | §1.1 | Tasks 4.1, 4.2 + close-out | grep-A 5 on `res.status(500)` shows `recordIncident` |
| **G11** — Skill-analyzer terminal failures emit `recordIncident` | §1.1 | Tasks 5.1, 5.2 + close-out | integration test + grep on `server/index.ts` |
| **§3.4 loop-hazard invariant** — `forceSync: true` on DLQ-emitted incidents | §3.4 | Task 2.3 + 2.5 | `dlqMonitorServiceForceSyncInvariant.test.ts` |

All §1.1 success criteria are covered. All §1.3 non-goals are explicitly out of scope and routed to spec §10 deferred items.

---

**End of plan.**
