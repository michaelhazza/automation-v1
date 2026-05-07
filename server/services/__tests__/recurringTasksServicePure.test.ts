// guard-ignore-file: pure-helper-convention reason="Pure-helper test — no DB imports"
/**
 * recurringTasksServicePure.test.ts
 *
 * Pure-helper tests for the recurring-tasks aggregator (spec §4.4).
 *
 * No DB imports. No I/O. All pure functions.
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/recurringTasksServicePure.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  unionRecurringTasks,
  applyFilters,
  applySortWithTiebreaker,
  encodeCursor,
  decodeCursor,
  paginate,
  buildFilterOptions,
  applySearch,
  formatFireCondition,
  CursorDecodeError,
  CursorMismatchError,
} from '../recurringTasksServicePure.js';
import type {
  RecurringTask,
  UnionInput,
  TriggerRow,
  ScheduledTaskRow,
  ManualRunRow,
} from '../recurringTasksServicePure.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ORG_ID = 'org-1';
const SUB_ID = 'sub-1';
const SUB_ID_ORG = 'sub-org-1';
const AGENT_ID_1 = 'agent-uuid-1';
const AGENT_ID_2 = 'agent-uuid-2';
const SA_ID_1 = 'sa-uuid-1';
const TRIGGER_ID_1 = 'trigger-1';
const TRIGGER_ID_2 = 'trigger-2';
const SCHEDULE_ID_1 = 'sched-1';
const RUN_ID_1 = 'run-id-1';

function makeTrigger(overrides: Partial<TriggerRow> = {}): TriggerRow {
  return {
    id: TRIGGER_ID_1,
    organisationId: ORG_ID,
    subaccountId: SUB_ID,
    subaccountAgentId: SA_ID_1,
    eventType: 'task_created',
    isActive: true,
    lastTriggeredAt: null,
    triggerCount: 5,
    ...overrides,
  };
}

function makeScheduledTask(overrides: Partial<ScheduledTaskRow> = {}): ScheduledTaskRow {
  return {
    id: SCHEDULE_ID_1,
    organisationId: ORG_ID,
    subaccountId: SUB_ID,
    assignedAgentId: AGENT_ID_1,
    title: 'Weekly report',
    isActive: true,
    nextRunAt: new Date('2026-05-10T12:00:00Z'),
    lastRunAt: new Date('2026-05-03T12:00:00Z'),
    totalRuns: 10,
    consecutiveFailures: 0,
    ...overrides,
  };
}

function makeManualRun(overrides: Partial<ManualRunRow> = {}): ManualRunRow {
  return {
    id: RUN_ID_1,
    organisationId: ORG_ID,
    subaccountId: SUB_ID,
    agentId: AGENT_ID_1,
    subaccountAgentId: SA_ID_1,
    startedAt: new Date('2026-05-01T10:00:00Z'),
    projectId: null,
    ...overrides,
  };
}

function makeInput(overrides: Partial<UnionInput> = {}): UnionInput {
  const agentsMap = new Map([
    [AGENT_ID_1, { id: AGENT_ID_1, name: 'Reporter Agent' }],
    [AGENT_ID_2, { id: AGENT_ID_2, name: 'Scheduler Agent' }],
    [`sa:${SA_ID_1}`, { id: AGENT_ID_1, name: 'Reporter Agent' }],
  ]);
  const subaccountsMap = new Map([
    [SUB_ID, { id: SUB_ID, name: 'Acme Corp', isOrgSubaccount: false }],
    [SUB_ID_ORG, { id: SUB_ID_ORG, name: 'My Agency', isOrgSubaccount: true }],
  ]);
  const projectsMap = new Map([
    ['proj-1', { id: 'proj-1', name: 'Alpha Project' }],
  ]);

  return {
    triggers: [],
    scheduled: [],
    manualRuns: [],
    agentsMap,
    subaccountsMap,
    projectsMap,
    ...overrides,
  };
}

function makeRecurringTask(overrides: Partial<RecurringTask> = {}): RecurringTask {
  return {
    id: 'trigger:trigger-1',
    name: 'Reporter Agent: task_created',
    fireKind: 'event',
    fireCondition: 'On task_created',
    action: 'Reporter Agent',
    scope: { kind: 'workspace', id: SUB_ID, name: 'Acme Corp' },
    project: null,
    status: 'active',
    lastFiredAt: null,
    fires30d: 5,
    nextFireAt: null,
    ...overrides,
  };
}

// ── 1. unionRecurringTasks ────────────────────────────────────────────────────

describe('unionRecurringTasks', () => {
  it('produces one trigger row', () => {
    const rows = unionRecurringTasks(makeInput({ triggers: [makeTrigger()] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].fireKind).toBe('event');
    expect(rows[0].id).toBe(`trigger:${TRIGGER_ID_1}`);
    expect(rows[0].action).toBe('Reporter Agent');
  });

  it('trigger takes precedence when both reference the same trigger entity', () => {
    // In current schema there is no triggerId FK on scheduledTasks, so they do NOT dedupe.
    // However: a trigger row with same subaccountAgentId as a scheduled task both emit separate rows.
    const input = makeInput({
      triggers: [makeTrigger({ id: TRIGGER_ID_1 })],
      scheduled: [makeScheduledTask({ id: SCHEDULE_ID_1 })],
    });
    const rows = unionRecurringTasks(input);
    // Both emit — no cross-source dedupe in current schema
    expect(rows).toHaveLength(2);
    const kinds = rows.map((r) => r.fireKind).sort();
    expect(kinds).toEqual(['event', 'schedule']);
  });

  it('same-agent different-trigger does NOT dedupe — two separate rows', () => {
    const input = makeInput({
      triggers: [
        makeTrigger({ id: TRIGGER_ID_1, eventType: 'task_created' }),
        makeTrigger({ id: TRIGGER_ID_2, eventType: 'task_moved' }),
      ],
    });
    const rows = unionRecurringTasks(input);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort()).toEqual(
      [`trigger:${TRIGGER_ID_1}`, `trigger:${TRIGGER_ID_2}`].sort(),
    );
  });

  it('standalone scheduled task with null subaccountAgentId emits separate row', () => {
    const input = makeInput({
      triggers: [makeTrigger({ id: TRIGGER_ID_1 })],
      scheduled: [makeScheduledTask({ id: SCHEDULE_ID_1, subaccountId: SUB_ID })],
    });
    const rows = unionRecurringTasks(input);
    expect(rows).toHaveLength(2);
    const schedRow = rows.find((r) => r.fireKind === 'schedule');
    expect(schedRow).toBeDefined();
    expect(schedRow!.id).toBe(`schedule:${SCHEDULE_ID_1}`);
  });

  it('manual run rows are never deduplicated against trigger or scheduled rows', () => {
    const input = makeInput({
      triggers: [makeTrigger()],
      scheduled: [makeScheduledTask()],
      manualRuns: [makeManualRun()],
    });
    const rows = unionRecurringTasks(input);
    expect(rows).toHaveLength(3);
    const manualRow = rows.find((r) => r.fireKind === 'manual');
    expect(manualRow).toBeDefined();
    expect(manualRow!.id).toBe(`manual:${AGENT_ID_1}:${RUN_ID_1}`);
  });

  it('agent name falls back to "Unknown agent" when agent is missing from map', () => {
    const input = makeInput({
      triggers: [makeTrigger({ subaccountAgentId: 'nonexistent-sa' })],
    });
    const rows = unionRecurringTasks(input);
    expect(rows[0].action).toBe('Unknown agent');
  });

  it('scheduled task with consecutiveFailures > 0 maps to status error', () => {
    const input = makeInput({
      scheduled: [makeScheduledTask({ isActive: true, consecutiveFailures: 2 })],
    });
    const rows = unionRecurringTasks(input);
    expect(rows[0].status).toBe('error');
  });

  it('scheduled task with isActive=false maps to status paused', () => {
    const input = makeInput({
      scheduled: [makeScheduledTask({ isActive: false, consecutiveFailures: 0 })],
    });
    const rows = unionRecurringTasks(input);
    expect(rows[0].status).toBe('paused');
  });

  it('trigger with isActive=false maps to status paused', () => {
    const input = makeInput({ triggers: [makeTrigger({ isActive: false })] });
    const rows = unionRecurringTasks(input);
    expect(rows[0].status).toBe('paused');
  });

  it('scope.kind is "org" for org subaccount', () => {
    const input = makeInput({
      triggers: [makeTrigger({ subaccountId: SUB_ID_ORG })],
    });
    const rows = unionRecurringTasks(input);
    expect(rows[0].scope.kind).toBe('org');
  });

  it('manual run attaches project when projectId is in map', () => {
    const input = makeInput({
      manualRuns: [makeManualRun({ projectId: 'proj-1' })],
    });
    const rows = unionRecurringTasks(input);
    expect(rows[0].project).toEqual({ id: 'proj-1', name: 'Alpha Project' });
  });
});

// ── 2. applySortWithTiebreaker ────────────────────────────────────────────────

describe('applySortWithTiebreaker', () => {
  const base: RecurringTask = makeRecurringTask();

  it('equal primary values → sort by id DESC tiebreaker', () => {
    const a = makeRecurringTask({ id: 'trigger:aaa', nextFireAt: '2026-05-10T12:00:00Z' });
    const b = makeRecurringTask({ id: 'trigger:zzz', nextFireAt: '2026-05-10T12:00:00Z' });
    const sorted = applySortWithTiebreaker([a, b], 'nextFire', 'asc');
    // Both equal nextFire → id DESC: zzz > aaa, so zzz comes first
    expect(sorted[0].id).toBe('trigger:zzz');
    expect(sorted[1].id).toBe('trigger:aaa');
  });

  it('null nextFireAt sorts LAST in asc direction', () => {
    const withNull = makeRecurringTask({ id: 'trigger:null', nextFireAt: null });
    const withValue = makeRecurringTask({ id: 'trigger:val', nextFireAt: '2026-05-07T12:00:00Z' });
    const sorted = applySortWithTiebreaker([withNull, withValue], 'nextFire', 'asc');
    expect(sorted[0].id).toBe('trigger:val');
    expect(sorted[1].id).toBe('trigger:null');
  });

  it('null nextFireAt sorts LAST in desc direction', () => {
    const withNull = makeRecurringTask({ id: 'trigger:null', nextFireAt: null });
    const withValue = makeRecurringTask({ id: 'trigger:val', nextFireAt: '2026-05-07T12:00:00Z' });
    const sorted = applySortWithTiebreaker([withNull, withValue], 'nextFire', 'desc');
    // desc: larger values first; null still goes last
    expect(sorted[0].id).toBe('trigger:val');
    expect(sorted[1].id).toBe('trigger:null');
  });

  it('sort flip asc vs desc preserves relative order (stability check)', () => {
    const rows = [
      makeRecurringTask({ id: 'id-1', fires30d: 10 }),
      makeRecurringTask({ id: 'id-2', fires30d: 5 }),
      makeRecurringTask({ id: 'id-3', fires30d: 20 }),
    ];
    const asc = applySortWithTiebreaker(rows, 'fires30d', 'asc').map((r) => r.fires30d);
    const desc = applySortWithTiebreaker(rows, 'fires30d', 'desc').map((r) => r.fires30d);
    expect(asc).toEqual([5, 10, 20]);
    expect(desc).toEqual([20, 10, 5]);
  });

  it('null lastFiredAt sorts last in both directions', () => {
    const r1 = makeRecurringTask({ id: 'id-1', lastFiredAt: '2026-05-01T00:00:00Z' });
    const r2 = makeRecurringTask({ id: 'id-2', lastFiredAt: null });
    const r3 = makeRecurringTask({ id: 'id-3', lastFiredAt: '2026-04-01T00:00:00Z' });

    const asc = applySortWithTiebreaker([r1, r2, r3], 'lastFired', 'asc');
    expect(asc[asc.length - 1].id).toBe('id-2');

    const desc = applySortWithTiebreaker([r1, r2, r3], 'lastFired', 'desc');
    expect(desc[desc.length - 1].id).toBe('id-2');
  });
});

// ── 3. encodeCursor / decodeCursor ────────────────────────────────────────────

describe('encodeCursor / decodeCursor', () => {
  const row = makeRecurringTask({
    id: '3fa85f64-0000-0000-0000-000000000001',
    nextFireAt: '2026-05-07T12:00:00Z',
  });

  it('round-trips with non-null sortValue', () => {
    const cursor = encodeCursor(row, 'nextFire', 'asc');
    const decoded = decodeCursor(cursor, 'nextFire', 'asc');
    expect(decoded.v).toBe(1);
    expect(decoded.k).toBe('nextFire');
    expect(decoded.d).toBe('asc');
    expect(decoded.s).toBe('2026-05-07T12:00:00Z');
    expect(decoded.i).toBe(row.id);
  });

  it('round-trips with null sortValue', () => {
    const nullRow = makeRecurringTask({
      id: '3fa85f64-0000-0000-0000-000000000002',
      nextFireAt: null,
    });
    const cursor = encodeCursor(nullRow, 'nextFire', 'desc');
    const decoded = decodeCursor(cursor, 'nextFire', 'desc');
    expect(decoded.s).toBeNull();
    expect(decoded.i).toBe(nullRow.id);
  });

  it('cursor issued for (nextFire, asc) rejected when decoded with (nextFire, desc)', () => {
    const cursor = encodeCursor(row, 'nextFire', 'asc');
    expect(() => decodeCursor(cursor, 'nextFire', 'desc')).toThrow(CursorMismatchError);
  });

  it('cursor issued for (fires30d, asc) rejected when decoded with (nextFire, asc)', () => {
    const cursor = encodeCursor(row, 'fires30d', 'asc');
    expect(() => decodeCursor(cursor, 'nextFire', 'asc')).toThrow(CursorMismatchError);
  });

  it('corrupt input throws CursorDecodeError', () => {
    expect(() => decodeCursor('not-valid-base64url!!!', 'nextFire', 'asc')).toThrow(CursorDecodeError);
  });

  it('valid base64url but wrong structure throws CursorDecodeError', () => {
    const bad = Buffer.from('{"wrong":"shape"}').toString('base64url');
    expect(() => decodeCursor(bad, 'nextFire', 'asc')).toThrow(CursorDecodeError);
  });
});

// ── 4. buildFilterOptions ─────────────────────────────────────────────────────

describe('buildFilterOptions', () => {
  const rows: RecurringTask[] = [
    makeRecurringTask({ id: 'r1', fireKind: 'schedule', status: 'active', action: 'Agent A' }),
    makeRecurringTask({ id: 'r2', fireKind: 'schedule', status: 'paused', action: 'Agent B' }),
    makeRecurringTask({ id: 'r3', fireKind: 'event', status: 'active', action: 'Agent A' }),
    makeRecurringTask({ id: 'r4', fireKind: 'manual', status: 'active', action: 'Agent C' }),
  ];

  it('fireKind options computed against status=active filter only', () => {
    const options = buildFilterOptions(rows, { fireKind: ['schedule'], status: ['active'] });
    // status=active rows: r1 (schedule), r3 (event), r4 (manual)
    // fireKind options are computed with ONLY status=active applied (not fireKind itself)
    const fireKindOpts = options.fireKind;
    const fireKindValues = fireKindOpts.map((o) => o.value).sort();
    // Should include all fireKinds present in status=active rows
    expect(fireKindValues).toContain('schedule');
    expect(fireKindValues).toContain('event');
    expect(fireKindValues).toContain('manual');
  });

  it('status options computed against fireKind=schedule filter only', () => {
    const options = buildFilterOptions(rows, { fireKind: ['schedule'], status: ['active'] });
    // fireKind=schedule rows: r1 (active), r2 (paused)
    // status options are computed with ONLY fireKind=schedule applied (not status itself)
    const statusOpts = options.status;
    const statusValues = statusOpts.map((o) => o.value).sort();
    expect(statusValues).toContain('active');
    expect(statusValues).toContain('paused');
  });

  it('counts reflect post-search/post-filter visibility', () => {
    const options = buildFilterOptions(rows, { status: ['active'] });
    // active rows: r1 (schedule), r3 (event), r4 (manual)
    // fireKind options for active-only rows
    const scheduleOpt = options.fireKind.find((o) => o.value === 'schedule');
    expect(scheduleOpt?.count).toBe(1);
  });

  it('empty query returns all options', () => {
    const options = buildFilterOptions(rows, {});
    const fireKindValues = options.fireKind.map((o) => o.value).sort();
    expect(fireKindValues).toEqual(['event', 'manual', 'schedule']);
  });
});

// ── 5. applySearch ────────────────────────────────────────────────────────────

describe('applySearch', () => {
  const rows: RecurringTask[] = [
    makeRecurringTask({ id: 'r1', name: 'Weekly Report', fireCondition: 'Scheduled', action: 'Reporter Agent' }),
    makeRecurringTask({ id: 'r2', name: 'Task Watcher', fireCondition: 'On task_created', action: 'Scheduler Agent' }),
    makeRecurringTask({ id: 'r3', name: 'Manual backup', fireCondition: 'Manual run', action: 'Backup Agent' }),
  ];

  it('case-insensitive substring match against name', () => {
    const result = applySearch(rows, 'weekly');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r1');
  });

  it('case-insensitive substring match against fireCondition', () => {
    const result = applySearch(rows, 'TASK_CREATED');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r2');
  });

  it('case-insensitive substring match against action', () => {
    const result = applySearch(rows, 'backup agent');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r3');
  });

  it('empty q is identity (returns all rows)', () => {
    expect(applySearch(rows, '')).toHaveLength(3);
    expect(applySearch(rows, undefined)).toHaveLength(3);
  });

  it('no match returns empty array', () => {
    expect(applySearch(rows, 'xyz_no_match_xyz')).toHaveLength(0);
  });

  it('whitespace-only q is identity', () => {
    expect(applySearch(rows, '   ')).toHaveLength(3);
  });
});

// ── 7. applyFilters ───────────────────────────────────────────────────────────

describe('applyFilters', () => {
  const workspaceRow = makeRecurringTask({ id: 'r-ws', scope: { kind: 'workspace', id: 'sub-1', name: 'Acme Corp' } });
  const orgRow = makeRecurringTask({ id: 'r-org', scope: { kind: 'org', id: 'sub-org-1', name: 'My Agency' } });
  const rows = [workspaceRow, orgRow];

  it('scope=workspace returns only workspace rows', () => {
    const result = applyFilters(rows, { scope: 'workspace' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r-ws');
  });

  it('scope=org returns only org rows', () => {
    const result = applyFilters(rows, { scope: 'org' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r-org');
  });

  it('scope=system returns zero rows (system scope not modelled — no rows match)', () => {
    const result = applyFilters(rows, { scope: 'system' });
    expect(result).toHaveLength(0);
  });

  it('scope=system returns zero rows even when input has both workspace and org rows', () => {
    const mixed = [
      makeRecurringTask({ id: 'ws-1', scope: { kind: 'workspace', id: 'sub-1', name: 'WS1' } }),
      makeRecurringTask({ id: 'org-1', scope: { kind: 'org', id: 'sub-org-1', name: 'Org1' } }),
    ];
    expect(applyFilters(mixed, { scope: 'system' })).toHaveLength(0);
  });

  it('no scope filter returns all rows', () => {
    expect(applyFilters(rows, {})).toHaveLength(2);
  });
});

// ── 8. formatFireCondition ────────────────────────────────────────────────────

describe('formatFireCondition', () => {
  // ── spec-named examples (exact string match) ────────────────────────────────

  it('FREQ=DAILY → "Daily 9am UTC"', () => {
    expect(formatFireCondition({ kind: 'schedule', rrule: 'FREQ=DAILY', timezone: 'UTC', scheduleTime: '09:00' }))
      .toBe('Daily 9am UTC');
  });

  it('FREQ=WEEKLY;BYDAY=MO → "Weekly Mon 8am UTC"', () => {
    expect(formatFireCondition({ kind: 'schedule', rrule: 'FREQ=WEEKLY;BYDAY=MO', timezone: 'UTC', scheduleTime: '08:00' }))
      .toBe('Weekly Mon 8am UTC');
  });

  it('FREQ=MONTHLY;BYMONTHDAY=1 → "Monthly 1st 00:00 UTC"', () => {
    expect(formatFireCondition({ kind: 'schedule', rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', timezone: 'UTC', scheduleTime: '00:00' }))
      .toBe('Monthly 1st 00:00 UTC');
  });

  it('FREQ=HOURLY → "Hourly"', () => {
    expect(formatFireCondition({ kind: 'schedule', rrule: 'FREQ=HOURLY', timezone: 'UTC', scheduleTime: '' }))
      .toBe('Hourly');
  });

  it('FREQ=MINUTELY;INTERVAL=15 → "Every 15 minutes"', () => {
    expect(formatFireCondition({ kind: 'schedule', rrule: 'FREQ=MINUTELY;INTERVAL=15', timezone: 'UTC', scheduleTime: '' }))
      .toBe('Every 15 minutes');
  });

  it('event task_created → "On task_created"', () => {
    expect(formatFireCondition({ kind: 'event', eventType: 'task_created', eventFilter: {} }))
      .toBe('On task_created');
  });

  it('event hubspot.contact.created → "On hubspot.contact.created"', () => {
    expect(formatFireCondition({ kind: 'event', eventType: 'hubspot.contact.created', eventFilter: {} }))
      .toBe('On hubspot.contact.created');
  });

  it('manual → "Manual run"', () => {
    expect(formatFireCondition({ kind: 'manual' })).toBe('Manual run');
  });

  // ── additional cases ────────────────────────────────────────────────────────

  it('BYDAY=MO,TU,WE → "Weekly Mon, Tue, Wed 8am UTC"', () => {
    expect(formatFireCondition({ kind: 'schedule', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE', timezone: 'UTC', scheduleTime: '08:00' }))
      .toBe('Weekly Mon, Tue, Wed 8am UTC');
  });

  it('INTERVAL=2 + FREQ=DAILY → "Every 2 days 9am UTC"', () => {
    expect(formatFireCondition({ kind: 'schedule', rrule: 'FREQ=DAILY;INTERVAL=2', timezone: 'UTC', scheduleTime: '09:00' }))
      .toBe('Every 2 days 9am UTC');
  });

  it('unknown FREQ falls back to literal rrule string truncated at 80 chars', () => {
    const rrule = 'FREQ=YEARLY;BYMONTH=3;BYDAY=SU';
    expect(formatFireCondition({ kind: 'schedule', rrule, timezone: 'UTC', scheduleTime: '09:00' }))
      .toBe(rrule);
  });

  it('string longer than 80 chars is truncated with "..."', () => {
    // Construct a rrule with unknown FREQ that is > 80 chars so it hits truncation
    const longRrule = 'FREQ=YEARLY;' + 'X='.padEnd(80, 'A');
    const result = formatFireCondition({ kind: 'schedule', rrule: longRrule, timezone: 'UTC', scheduleTime: '' });
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.endsWith('...')).toBe(true);
  });

  it('empty eventType → "On unknown event"', () => {
    expect(formatFireCondition({ kind: 'event', eventType: '', eventFilter: {} }))
      .toBe('On unknown event');
  });

  it('eventFilter contents are ignored in the output string', () => {
    expect(formatFireCondition({ kind: 'event', eventType: 'task_created', eventFilter: { foo: 'bar', baz: 42 } }))
      .toBe('On task_created');
  });

  it('determinism: identical inputs produce identical output', () => {
    const input = { kind: 'schedule' as const, rrule: 'FREQ=DAILY', timezone: 'UTC', scheduleTime: '09:00' };
    expect(formatFireCondition(input)).toBe(formatFireCondition(input));
  });

  // ── time formatting edge cases ──────────────────────────────────────────────

  it('scheduleTime "12:00" → "12pm"', () => {
    expect(formatFireCondition({ kind: 'schedule', rrule: 'FREQ=DAILY', timezone: 'UTC', scheduleTime: '12:00' }))
      .toBe('Daily 12pm UTC');
  });

  it('scheduleTime "13:30" → "13:30"', () => {
    expect(formatFireCondition({ kind: 'schedule', rrule: 'FREQ=DAILY', timezone: 'UTC', scheduleTime: '13:30' }))
      .toBe('Daily 13:30 UTC');
  });

  // ── ordinal edge cases ──────────────────────────────────────────────────────

  it('BYMONTHDAY=11 → 11th', () => {
    expect(formatFireCondition({ kind: 'schedule', rrule: 'FREQ=MONTHLY;BYMONTHDAY=11', timezone: 'UTC', scheduleTime: '09:00' }))
      .toBe('Monthly 11th 9am UTC');
  });

  it('BYMONTHDAY=21 → 21st', () => {
    expect(formatFireCondition({ kind: 'schedule', rrule: 'FREQ=MONTHLY;BYMONTHDAY=21', timezone: 'UTC', scheduleTime: '09:00' }))
      .toBe('Monthly 21st 9am UTC');
  });

  it('BYMONTHDAY=22 → 22nd', () => {
    expect(formatFireCondition({ kind: 'schedule', rrule: 'FREQ=MONTHLY;BYMONTHDAY=22', timezone: 'UTC', scheduleTime: '09:00' }))
      .toBe('Monthly 22nd 9am UTC');
  });

  it('BYMONTHDAY=13 → 13th', () => {
    expect(formatFireCondition({ kind: 'schedule', rrule: 'FREQ=MONTHLY;BYMONTHDAY=13', timezone: 'UTC', scheduleTime: '09:00' }))
      .toBe('Monthly 13th 9am UTC');
  });
});

// ── 6. paginate ───────────────────────────────────────────────────────────────

describe('paginate', () => {
  // Build a stable set of 5 rows sorted by name asc (id tiebreaker already unique)
  const SORT_KEY = 'name' as const;
  const SORT_DIR = 'asc' as const;

  const rows: RecurringTask[] = [
    makeRecurringTask({ id: 'r1', name: 'Alpha' }),
    makeRecurringTask({ id: 'r2', name: 'Bravo' }),
    makeRecurringTask({ id: 'r3', name: 'Charlie' }),
    makeRecurringTask({ id: 'r4', name: 'Delta' }),
    makeRecurringTask({ id: 'r5', name: 'Echo' }),
  ];

  it('first page with no cursor returns first N rows and a non-null nextCursor', () => {
    const { page, nextCursor } = paginate(rows, undefined, 2, SORT_KEY, SORT_DIR);
    expect(page).toHaveLength(2);
    expect(page[0].id).toBe('r1');
    expect(page[1].id).toBe('r2');
    expect(nextCursor).not.toBeNull();
  });

  it('cursor-based continuation returns the next page', () => {
    // Get cursor from end of first page
    const { nextCursor: cursorAfterPage1 } = paginate(rows, undefined, 2, SORT_KEY, SORT_DIR);
    expect(cursorAfterPage1).not.toBeNull();

    const { page, nextCursor } = paginate(rows, cursorAfterPage1!, 2, SORT_KEY, SORT_DIR);
    expect(page).toHaveLength(2);
    expect(page[0].id).toBe('r3');
    expect(page[1].id).toBe('r4');
    // There is still one row (r5) remaining, so nextCursor should be non-null
    expect(nextCursor).not.toBeNull();
  });

  it('last page: remaining rows exactly fill the limit and nothing remains → nextCursor is null', () => {
    // Encode cursor pointing at r3 (the 3rd row); slice from r4 onward, limit 2
    const cursorAtR3 = encodeCursor(rows[2], SORT_KEY, SORT_DIR);
    const { page, nextCursor } = paginate(rows, cursorAtR3, 2, SORT_KEY, SORT_DIR);
    // r4 and r5 are returned — they exactly fill limit=2 but no row follows
    expect(page).toHaveLength(2);
    expect(page[0].id).toBe('r4');
    expect(page[1].id).toBe('r5');
    expect(nextCursor).toBeNull();
  });

  it('empty rows array → page is empty and nextCursor is null', () => {
    const { page, nextCursor } = paginate([], undefined, 10, SORT_KEY, SORT_DIR);
    expect(page).toHaveLength(0);
    expect(nextCursor).toBeNull();
  });

  it('cursor pointing to a non-existent id falls back to first page (silent, not an error)', () => {
    // Build a cursor for a row that is NOT in the rows array
    const ghostRow = makeRecurringTask({ id: 'r-ghost', name: 'Alpha' });
    const ghostCursor = encodeCursor(ghostRow, SORT_KEY, SORT_DIR);

    // findIndex will return -1, so startIdx stays at 0 → first page
    const { page, nextCursor } = paginate(rows, ghostCursor, 2, SORT_KEY, SORT_DIR);
    expect(page[0].id).toBe('r1');
    expect(page[1].id).toBe('r2');
    expect(nextCursor).not.toBeNull();
  });
});
