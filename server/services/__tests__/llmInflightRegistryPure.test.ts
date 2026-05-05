import { expect, test } from 'vitest';
import {
  applyAdd,
  applyIncomingEvent,
  applyRemove,
  buildActiveCountPayload,
  buildDeadlineAt,
  buildEntry,
  buildEventId,
  buildRuntimeKey,
  buildSnapshot,
  compareForSnapshot,
  selectEvictionVictim,
  selectStaleEntries,
  terminalStatusExpectsLedgerRow,
  type RegistrySlot,
} from '../llmInflightRegistryPure.js';
import type { BuildEntryInput } from '../llmInflightRegistryPure.js';
import type { InFlightEntry } from '../../../shared/types/systemPnl.js';

// ---------------------------------------------------------------------------
// Pure-logic pins for the LLM in-flight registry (spec §10).
//
// The registry's add/remove/incoming-event/sweep paths all ship through this
// file. These tests guarantee:
//
//   - runtimeKey / eventId derivation are deterministic and crash-restart safe
//   - state-machine transitions reject reordered/duplicate events
//   - monotonic stateVersion guard closes the same-startedAt reorder hole
//   - snapshot cap + stable sort keep repeated fetches visually identical
//   - LRU overflow eviction picks the oldest active entry
//   - terminal-status → ledger-row expectation matches the spec table
//   - gauge payload sums correctly by callSite + provider
// ---------------------------------------------------------------------------

// ── Fixtures ──────────────────────────────────────────────────────────────

function entryInput(overrides: Partial<BuildEntryInput> = {}): BuildEntryInput {
  return {
    idempotencyKey:   'org:run:agent:task:provider:model:msghash',
    attempt:          1,
    attemptSequence:  1,
    fallbackIndex:    0,
    startedAt:        '2026-04-20T10:00:00.000Z',
    queuedAt:         '2026-04-20T10:00:00.000Z',
    label:            'anthropic/claude-sonnet-4-6',
    provider:         'anthropic',
    model:            'claude-sonnet-4-6',
    sourceType:       'agent_run',
    sourceId:         null,
    featureTag:       'agent-execution-loop',
    organisationId:   '11111111-1111-1111-1111-111111111111',
    subaccountId:     '22222222-2222-2222-2222-222222222222',
    runId:            '33333333-3333-3333-3333-333333333333',
    executionId:      null,
    ieeRunId:         null,
    callSite:         'app',
    timeoutMs:        600_000,
    deadlineBufferMs: 30_000,
    ...overrides,
  };
}

function activeSlot(entry: InFlightEntry): RegistrySlot {
  return { entry, state: 'active', stateVersion: 1 };
}

// ── runtimeKey ────────────────────────────────────────────────────────────

test('buildRuntimeKey composes idempotencyKey:attempt:startedAt', () => {
  const key = buildRuntimeKey({
    idempotencyKey: 'org:run:agent:task:anthropic:sonnet:deadbeef',
    attempt: 3,
    startedAt: '2026-04-20T10:00:00.000Z',
  });
  expect(key).toBe('org:run:agent:task:anthropic:sonnet:deadbeef:3:2026-04-20T10:00:00.000Z');
});

test('runtimeKey crash-restart safety — same (idempotencyKey, attempt) with different startedAt produces different keys', () => {
  const a = buildRuntimeKey({ idempotencyKey: 'k', attempt: 1, startedAt: '2026-04-20T10:00:00.000Z' });
  const b = buildRuntimeKey({ idempotencyKey: 'k', attempt: 1, startedAt: '2026-04-20T10:00:00.500Z' });
  expect(a).not.toBe(b);
});

test('buildEventId — `${runtimeKey}:${type}` shape', () => {
  const rk = 'key:1:2026-04-20T10:00:00.000Z';
  expect(buildEventId(rk, 'added')).toBe(`${rk}:added`);
  expect(buildEventId(rk, 'removed')).toBe(`${rk}:removed`);
});

// ── Queueing delay (deferred-items brief §3) ──────────────────────────────

test('buildEntry — queuedAt and dispatchDelayMs carried through', () => {
  const entry = buildEntry(entryInput({
    queuedAt:  '2026-04-20T10:00:00.000Z',
    startedAt: '2026-04-20T10:00:02.500Z',
  }));
  expect(entry.queuedAt).toBe('2026-04-20T10:00:00.000Z');
  expect(entry.startedAt).toBe('2026-04-20T10:00:02.500Z');
  expect(entry.dispatchDelayMs, 'delay = startedAt - queuedAt in ms').toBe(2500);
});

test('buildEntry — dispatchDelayMs of 0 when queuedAt === startedAt', () => {
  const entry = buildEntry(entryInput({
    queuedAt:  '2026-04-20T10:00:00.000Z',
    startedAt: '2026-04-20T10:00:00.000Z',
  }));
  expect(entry.dispatchDelayMs).toBe(0);
});

test('buildEntry — dispatchDelayMs clamped to 0 on negative (clock drift)', () => {
  // startedAt < queuedAt shouldn't normally happen but must never produce a
  // negative delay — the UI would render a nonsensical "-2s" badge.
  const entry = buildEntry(entryInput({
    queuedAt:  '2026-04-20T10:00:05.000Z',
    startedAt: '2026-04-20T10:00:00.000Z',
  }));
  expect(entry.dispatchDelayMs).toBe(0);
});

// ── Provider fallback visibility (deferred-items brief §4) ────────────────

test('buildEntry — attemptSequence and fallbackIndex carried through', () => {
  const entry = buildEntry(entryInput({
    attempt:         2,
    attemptSequence: 5,
    fallbackIndex:   1,
  }));
  expect(entry.attempt, 'per-provider retry counter').toBe(2);
  expect(entry.attemptSequence, 'monotonic across the whole routeCall').toBe(5);
  expect(entry.fallbackIndex, '0 for primary, 1+ for each fallback').toBe(1);
});

test('buildEntry — attemptSequence and attempt can diverge when fallback happens', () => {
  // After provider A attempts 1+2 fail, provider B's first attempt starts
  // the per-provider `attempt` counter back at 1 but continues the logical
  // `attemptSequence` at 3.
  const entry = buildEntry(entryInput({
    provider:        'openai',
    attempt:         1,
    attemptSequence: 3,
    fallbackIndex:   1,
  }));
  expect(entry.attempt).toBe(1);
  expect(entry.attemptSequence).toBe(3);
  expect(entry.fallbackIndex).toBe(1);
});

// ── Deadline ──────────────────────────────────────────────────────────────

test('buildDeadlineAt = startedAt + timeoutMs + deadlineBufferMs across variable timeoutMs', () => {
  const cases = [
    { timeoutMs: 600_000, expected: '2026-04-20T10:10:30.000Z' },
    { timeoutMs: 180_000, expected: '2026-04-20T10:03:30.000Z' },
    { timeoutMs: 30_000,  expected: '2026-04-20T10:01:00.000Z' },
  ];
  for (const { timeoutMs, expected } of cases) {
    const got = buildDeadlineAt({
      startedAt: '2026-04-20T10:00:00.000Z',
      timeoutMs,
      deadlineBufferMs: 30_000,
    });
    expect(got, `timeoutMs=${timeoutMs}`).toBe(expected);
  }
});

// ── State machine — add ───────────────────────────────────────────────────

test('applyAdd — first call produces kind=added with stateVersion=1', () => {
  const entry = buildEntry(entryInput());
  const out = applyAdd({ entry, existing: undefined });
  expect(out.kind).toBe('added');
  if (out.kind !== 'added') return;
  expect(out.slot.state).toBe('active');
  expect(out.slot.stateVersion).toBe(1);
  expect(out.envelope.type).toBe('added');
  expect(out.envelope.eventId).toBe(`${entry.runtimeKey}:added`);
  expect(out.envelope.entityId).toBe(entry.runtimeKey);
});

test('applyAdd — second call on same runtimeKey is no-op (add_noop_already_exists)', () => {
  const entry = buildEntry(entryInput());
  const existing = activeSlot(entry);
  const out = applyAdd({ entry, existing });
  expect(out.kind).toBe('noop_already_exists');
  if (out.kind !== 'noop_already_exists') return;
  expect(out.reason).toBe('add_noop_already_exists');
});

// ── State machine — remove ────────────────────────────────────────────────

test('applyRemove — first call transitions active → removed, stateVersion 1 → 2', () => {
  const entry = buildEntry(entryInput());
  const existing = activeSlot(entry);
  const out = applyRemove({
    runtimeKey:        entry.runtimeKey,
    terminalStatus:    'success',
    completedAt:       '2026-04-20T10:00:10.500Z',
    ledgerRowId:       'llm-req-id-1',
    ledgerCommittedAt: '2026-04-20T10:00:10.501Z',
    sweepReason:       null,
    evictionContext:   null,
    existing,
  });
  expect(out.kind).toBe('removed');
  if (out.kind !== 'removed') return;
  expect(out.slot.state).toBe('removed');
  expect(out.slot.stateVersion).toBe(2);
  expect(out.envelope.payload.stateVersion).toBe(2);
  expect(out.envelope.payload.terminalStatus).toBe('success');
  expect(out.envelope.payload.durationMs).toBe(10_500);
  expect(out.envelope.payload.ledgerRowId).toBe('llm-req-id-1');
  expect(out.envelope.payload.ledgerCommittedAt).toBe('2026-04-20T10:00:10.501Z');
  expect(out.envelope.payload.sweepReason).toBe(null);
  expect(out.envelope.payload.evictionContext).toBe(null);
});

test('applyRemove — remove-while-already-removed is no-op (remove_noop_already_removed)', () => {
  const entry = buildEntry(entryInput());
  const removed: RegistrySlot = { entry, state: 'removed', stateVersion: 2 };
  const out = applyRemove({
    runtimeKey:        entry.runtimeKey,
    terminalStatus:    'success',
    completedAt:       '2026-04-20T10:00:10.500Z',
    ledgerRowId:       null,
    ledgerCommittedAt: null,
    sweepReason:       null,
    evictionContext:   null,
    existing:          removed,
  });
  expect(out.kind).toBe('noop_already_removed');
});

test('applyRemove — remove-missing-key is no-op (remove_noop_missing_key)', () => {
  const entry = buildEntry(entryInput());
  const out = applyRemove({
    runtimeKey:        entry.runtimeKey,
    terminalStatus:    'success',
    completedAt:       '2026-04-20T10:00:10.500Z',
    ledgerRowId:       null,
    ledgerCommittedAt: null,
    sweepReason:       null,
    evictionContext:   null,
    existing:          undefined,
  });
  expect(out.kind).toBe('noop_missing_key');
});

test('applyRemove — sweepReason populated iff terminalStatus==="swept_stale"', () => {
  const entry = buildEntry(entryInput());
  const existing = activeSlot(entry);
  const out = applyRemove({
    runtimeKey:        entry.runtimeKey,
    terminalStatus:    'swept_stale',
    completedAt:       '2026-04-20T10:12:00.000Z',
    ledgerRowId:       null,
    ledgerCommittedAt: null,
    sweepReason:       'deadline_exceeded',
    evictionContext:   null,
    existing,
  });
  expect(out.kind).toBe('removed');
  if (out.kind !== 'removed') return;
  expect(out.envelope.payload.terminalStatus).toBe('swept_stale');
  expect(out.envelope.payload.sweepReason).toBe('deadline_exceeded');
});

test('applyRemove — evictionContext populated iff terminalStatus==="evicted_overflow"', () => {
  const entry = buildEntry(entryInput());
  const existing = activeSlot(entry);
  const out = applyRemove({
    runtimeKey:        entry.runtimeKey,
    terminalStatus:    'evicted_overflow',
    completedAt:       '2026-04-20T10:00:01.000Z',
    ledgerRowId:       null,
    ledgerCommittedAt: null,
    sweepReason:       null,
    evictionContext:   { activeCount: 5_000, capacity: 5_000 },
    existing,
  });
  expect(out.kind).toBe('removed');
  if (out.kind !== 'removed') return;
  expect(out.envelope.payload.evictionContext).toEqual({ activeCount: 5_000, capacity: 5_000 });
});

// ── Incoming Redis event — stale/monotonic guard ──────────────────────────

test('applyIncomingEvent — incoming.startedAt < existing.startedAt is stale_ignored', () => {
  const older = buildEntry(entryInput({ startedAt: '2026-04-20T10:00:00.000Z' }));
  const newer = buildEntry(entryInput({ startedAt: '2026-04-20T10:00:05.000Z' }));
  const out = applyIncomingEvent({
    kind:         'added',
    runtimeKey:   older.runtimeKey,
    startedAt:    older.startedAt,
    stateVersion: 1,
    entry:        older,
    existing:     activeSlot(newer),
  });
  expect(out.kind).toBe('stale_ignored');
});

test('applyIncomingEvent — same startedAt, incoming.stateVersion < existing.stateVersion is stale_ignored (v1 add after v2 remove)', () => {
  const entry = buildEntry(entryInput());
  const removed: RegistrySlot = { entry, state: 'removed', stateVersion: 2 };
  const out = applyIncomingEvent({
    kind:         'added',
    runtimeKey:   entry.runtimeKey,
    startedAt:    entry.startedAt,
    stateVersion: 1,
    entry,
    existing:     removed,
  });
  expect(out.kind).toBe('stale_ignored');
});

test('applyIncomingEvent — same startedAt, higher stateVersion on remove applies over an active slot', () => {
  const entry = buildEntry(entryInput());
  const existing: RegistrySlot = activeSlot(entry);
  const out = applyIncomingEvent({
    kind:         'removed',
    runtimeKey:   entry.runtimeKey,
    startedAt:    entry.startedAt,
    stateVersion: 2,
    removal: {
      runtimeKey:        entry.runtimeKey,
      idempotencyKey:    entry.idempotencyKey,
      attempt:           entry.attempt,
      stateVersion:      2,
      terminalStatus:    'success',
      sweepReason:       null,
      evictionContext:   null,
      completedAt:       '2026-04-20T10:00:10.000Z',
      durationMs:        10_000,
      ledgerRowId:       'rid',
      ledgerCommittedAt: '2026-04-20T10:00:10.001Z',
    },
    existing,
  });
  expect(out.kind).toBe('apply_remove');
  if (out.kind !== 'apply_remove') return;
  expect(out.slot.state).toBe('removed');
  expect(out.slot.stateVersion).toBe(2);
});

test('applyIncomingEvent — duplicate active add (same runtimeKey, both active, v1=v1) is stale_ignored', () => {
  const entry = buildEntry(entryInput());
  const existing: RegistrySlot = activeSlot(entry);
  const out = applyIncomingEvent({
    kind:         'added',
    runtimeKey:   entry.runtimeKey,
    startedAt:    entry.startedAt,
    stateVersion: 1,
    entry,
    existing,
  });
  expect(out.kind).toBe('stale_ignored');
});

// ── Terminal-status → ledger-row mapping ──────────────────────────────────

test('terminalStatusExpectsLedgerRow — every dispatched-attempt status expects a row', () => {
  for (const status of [
    'success',
    'error',
    'timeout',
    'aborted_by_caller',
    'client_disconnected',
    'parse_failure',
    'provider_unavailable',
    'provider_not_configured',
    'partial',
  ] as const) {
    expect(terminalStatusExpectsLedgerRow(status), status).toBe(true);
  }
});

test('terminalStatusExpectsLedgerRow — swept_stale + evicted_overflow do NOT expect a row', () => {
  expect(terminalStatusExpectsLedgerRow('swept_stale')).toBe(false);
  expect(terminalStatusExpectsLedgerRow('evicted_overflow')).toBe(false);
});

// ── Snapshot — cap + stable sort ──────────────────────────────────────────

test('compareForSnapshot — startedAt DESC, runtimeKey DESC tiebreak', () => {
  const a = buildEntry(entryInput({ idempotencyKey: 'aaa', startedAt: '2026-04-20T10:00:01.000Z' }));
  const b = buildEntry(entryInput({ idempotencyKey: 'bbb', startedAt: '2026-04-20T10:00:00.000Z' }));
  // b is older → a sorts first (DESC)
  expect(compareForSnapshot(a, b)).toBe(-1);

  // same startedAt, rk 'bbb' > 'aaa' → b sorts first
  const c = buildEntry(entryInput({ idempotencyKey: 'aaa', startedAt: '2026-04-20T10:00:00.000Z' }));
  const d = buildEntry(entryInput({ idempotencyKey: 'bbb', startedAt: '2026-04-20T10:00:00.000Z' }));
  expect(compareForSnapshot(d, c)).toBe(-1);
  expect(compareForSnapshot(c, d)).toBe(1);
  expect(compareForSnapshot(c, c)).toBe(0);
});

test('buildSnapshot — caps at limit, reports capped=true when count > limit', () => {
  const slots: RegistrySlot[] = [];
  for (let i = 0; i < 12; i++) {
    const startedAt = new Date(Date.UTC(2026, 3, 20, 10, 0, i)).toISOString();
    slots.push(activeSlot(buildEntry(entryInput({ idempotencyKey: `k${i}`, startedAt }))));
  }
  const out = buildSnapshot({
    slots,
    limit:       5,
    hardCap:     500,
    generatedAt: '2026-04-20T10:00:12.000Z',
  });
  expect(out.capped).toBe(true);
  expect(out.entries.length).toBe(5);
  // Newest-first: i=11, 10, 9, 8, 7
  expect(out.entries[0].idempotencyKey).toBe('k11');
  expect(out.entries[4].idempotencyKey).toBe('k7');
});

test('buildSnapshot — limit clamped to [1, hardCap] silently', () => {
  const slots: RegistrySlot[] = [];
  for (let i = 0; i < 3; i++) {
    const startedAt = new Date(Date.UTC(2026, 3, 20, 10, 0, i)).toISOString();
    slots.push(activeSlot(buildEntry(entryInput({ idempotencyKey: `k${i}`, startedAt }))));
  }
  // limit above hardCap clamped down
  const above = buildSnapshot({ slots, limit: 10_000, hardCap: 500, generatedAt: 'now' });
  expect(above.entries.length).toBe(3);
  expect(above.capped).toBe(false);

  // limit 0 clamped up to 1
  const zero = buildSnapshot({ slots, limit: 0, hardCap: 500, generatedAt: 'now' });
  expect(zero.entries.length).toBe(1);
  expect(zero.capped).toBe(true);
});

test('buildSnapshot — excludes removed slots', () => {
  const e1 = buildEntry(entryInput({ idempotencyKey: 'k1', startedAt: '2026-04-20T10:00:01.000Z' }));
  const e2 = buildEntry(entryInput({ idempotencyKey: 'k2', startedAt: '2026-04-20T10:00:02.000Z' }));
  const slots: RegistrySlot[] = [
    activeSlot(e1),
    { entry: e2, state: 'removed', stateVersion: 2 },
  ];
  const out = buildSnapshot({ slots, limit: 500, hardCap: 500, generatedAt: 'now' });
  expect(out.entries.length).toBe(1);
  expect(out.entries[0].runtimeKey).toBe(e1.runtimeKey);
});

test('buildSnapshot — stable ordering: identical-startedAt rows come back in the same order across repeated calls', () => {
  const startedAt = '2026-04-20T10:00:00.000Z';
  const slots: RegistrySlot[] = [];
  for (const k of ['a', 'c', 'b', 'e', 'd']) {
    slots.push(activeSlot(buildEntry(entryInput({ idempotencyKey: `k-${k}`, startedAt }))));
  }
  const a = buildSnapshot({ slots, limit: 500, hardCap: 500, generatedAt: 'now' });
  const b = buildSnapshot({ slots, limit: 500, hardCap: 500, generatedAt: 'now' });
  // runtimeKey DESC → k-e, k-d, k-c, k-b, k-a
  expect(a.entries.map(e => e.idempotencyKey)).toEqual(b.entries.map(e => e.idempotencyKey));
  expect(a.entries.map(e => e.idempotencyKey)).toEqual(['k-e', 'k-d', 'k-c', 'k-b', 'k-a']);
});

// ── LRU overflow selection ────────────────────────────────────────────────

test('selectEvictionVictim — picks the slot with the smallest startedAt', () => {
  const oldest  = buildEntry(entryInput({ idempotencyKey: 'oldest', startedAt: '2026-04-20T09:59:55.000Z' }));
  const middle  = buildEntry(entryInput({ idempotencyKey: 'middle', startedAt: '2026-04-20T10:00:00.000Z' }));
  const newest  = buildEntry(entryInput({ idempotencyKey: 'newest', startedAt: '2026-04-20T10:00:05.000Z' }));
  const slots: RegistrySlot[] = [
    activeSlot(middle),
    activeSlot(newest),
    activeSlot(oldest),
  ];
  const victim = selectEvictionVictim(slots);
  expect(victim?.entry.runtimeKey).toBe(oldest.runtimeKey);
});

test('add() boundary — noop_already_exists must short-circuit BEFORE overflow eviction (pr-review blocking #1)', () => {
  // Simulate the impure wrapper's ordering: map at capacity + incoming
  // runtimeKey already present → noop path must win, selectEvictionVictim
  // must NOT be what drives the response.
  const existingEntry = buildEntry(entryInput({ idempotencyKey: 'already-there' }));
  const existing: RegistrySlot = activeSlot(existingEntry);

  // applyAdd with the same runtimeKey + an existing slot → noop.
  const addOutcome = applyAdd({ entry: existingEntry, existing });
  expect(addOutcome.kind).toBe('noop_already_exists');

  // Independently, at capacity with N-1 other active slots + this one,
  // selectEvictionVictim would happily return the oldest — that's the
  // bug: the impure caller must not invoke it on the noop path. We pin
  // the pure-layer contract by confirming applyAdd's response is the
  // signal that prevents eviction from firing.
  const slots: RegistrySlot[] = [existing];
  for (let i = 0; i < 3; i++) {
    const startedAt = new Date(Date.UTC(2026, 3, 20, 9, 0, i)).toISOString();  // all older
    slots.push(activeSlot(buildEntry(entryInput({ idempotencyKey: `other${i}`, startedAt }))));
  }
  // If the impure caller were to run eviction selection anyway, it would
  // return one of the `other*` entries — demonstrating that the map
  // change would be destructive. The fix is to gate eviction on the
  // outcome tag, which this test documents.
  const victim = selectEvictionVictim(slots);
  expect(victim).not.toBe(null);
  expect(victim?.entry.runtimeKey).not.toBe(existingEntry.runtimeKey);
});

test('selectEvictionVictim — skips removed slots', () => {
  const e1 = buildEntry(entryInput({ idempotencyKey: 'k1', startedAt: '2026-04-20T09:59:55.000Z' }));
  const e2 = buildEntry(entryInput({ idempotencyKey: 'k2', startedAt: '2026-04-20T10:00:05.000Z' }));
  const slots: RegistrySlot[] = [
    { entry: e1, state: 'removed', stateVersion: 2 },
    activeSlot(e2),
  ];
  const victim = selectEvictionVictim(slots);
  expect(victim?.entry.runtimeKey).toBe(e2.runtimeKey);
});

// ── Active-count gauge payload ────────────────────────────────────────────

test('buildActiveCountPayload — activeCount equals sum of byCallSite and sum of byProvider', () => {
  const slots: RegistrySlot[] = [
    activeSlot(buildEntry(entryInput({ idempotencyKey: 'k1', provider: 'anthropic', callSite: 'app' }))),
    activeSlot(buildEntry(entryInput({ idempotencyKey: 'k2', provider: 'anthropic', callSite: 'worker' }))),
    activeSlot(buildEntry(entryInput({ idempotencyKey: 'k3', provider: 'openai',    callSite: 'worker' }))),
    // removed — excluded
    { entry: buildEntry(entryInput({ idempotencyKey: 'kr' })), state: 'removed', stateVersion: 2 },
  ];
  const payload = buildActiveCountPayload(slots);
  expect(payload.activeCount).toBe(3);
  expect(payload.byCallSite.app + payload.byCallSite.worker).toBe(3);
  expect(payload.byCallSite).toEqual({ app: 1, worker: 2 });
  const providerSum = Object.values(payload.byProvider).reduce((a, b) => a + b, 0);
  expect(providerSum).toBe(3);
  expect(payload.byProvider).toEqual({ anthropic: 2, openai: 1 });
});

// ── Sweep selection ───────────────────────────────────────────────────────

test('selectStaleEntries — returns only active slots past deadlineAt', () => {
  const past   = buildEntry(entryInput({ idempotencyKey: 'past',   startedAt: '2026-04-20T09:00:00.000Z' }));
  const future = buildEntry(entryInput({ idempotencyKey: 'future', startedAt: '2026-04-20T10:00:00.000Z' }));
  const slots: RegistrySlot[] = [
    activeSlot(past),
    activeSlot(future),
    // active but past deadline, ignored because 'removed'
    { entry: buildEntry(entryInput({ idempotencyKey: 'removed', startedAt: '2026-04-20T08:00:00.000Z' })),
      state: 'removed', stateVersion: 2 },
  ];
  const nowMs = Date.parse('2026-04-20T09:30:00.000Z');   // > past.deadlineAt (09:10:30), < future.deadlineAt (10:10:30)
  const stale = selectStaleEntries({ slots, nowMs });
  expect(stale.length).toBe(1);
  expect(stale[0].entry.runtimeKey).toBe(past.runtimeKey);
});
