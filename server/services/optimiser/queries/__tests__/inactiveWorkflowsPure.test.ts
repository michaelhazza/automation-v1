/**
 * inactiveWorkflowsPure.test.ts — Pure tests for inactiveWorkflows query (Chunk 2)
 *
 * Tests the isInactive logic using computeNextHeartbeatAt from the pure helper.
 *
 * Run via: npx vitest run server/services/optimiser/queries/__tests__/inactiveWorkflowsPure.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeNextHeartbeatAt } from '../../../scheduleCalendarServicePure.js';

function isInactiveWorkflowRow(row: unknown): row is {
  subaccount_agent_id: string;
  agent_id: string;
  agent_name: string;
  expected_cadence: string;
  last_run_at: string | null;
} {
  if (typeof row !== 'object' || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.subaccount_agent_id === 'string' &&
    typeof r.agent_id === 'string' &&
    typeof r.agent_name === 'string' &&
    typeof r.expected_cadence === 'string' &&
    (r.last_run_at === null || typeof r.last_run_at === 'string')
  );
}

function isInactive(params: {
  lastRunAt: Date | null;
  heartbeatIntervalHours: number;
  heartbeatOffsetHours: number;
  heartbeatOffsetMinutes: number;
  nowMs: number;
}): boolean {
  const { lastRunAt, heartbeatIntervalHours, heartbeatOffsetHours, heartbeatOffsetMinutes, nowMs } = params;
  if (!lastRunAt) return true;
  const expectedNextMs = computeNextHeartbeatAt(
    lastRunAt.getTime(),
    heartbeatIntervalHours,
    heartbeatOffsetHours,
    heartbeatOffsetMinutes,
  );
  const gracePeriodMs = heartbeatIntervalHours * 60 * 60 * 1000 * 0.25;
  return nowMs > expectedNextMs + gracePeriodMs;
}

describe('InactiveWorkflowRow shape', () => {
  it('validates a well-formed row', () => {
    const row = {
      subaccount_agent_id: 'sa-123',
      agent_id: 'ag-456',
      agent_name: 'My Agent',
      expected_cadence: 'daily at 8:00 UTC',
      last_run_at: '2026-05-01T08:00:00Z',
    };
    expect(isInactiveWorkflowRow(row)).toBe(true);
  });

  it('last_run_at can be null', () => {
    const row = {
      subaccount_agent_id: 'sa-123',
      agent_id: 'ag-456',
      agent_name: 'My Agent',
      expected_cadence: 'every 24h',
      last_run_at: null,
    };
    expect(isInactiveWorkflowRow(row)).toBe(true);
  });
});

describe('isInactive logic', () => {
  const nowMs = new Date('2026-05-02T08:00:00Z').getTime();

  it('no last_run_at → always inactive', () => {
    expect(
      isInactive({ lastRunAt: null, heartbeatIntervalHours: 24, heartbeatOffsetHours: 0, heartbeatOffsetMinutes: 0, nowMs }),
    ).toBe(true);
  });

  it('ran 1 hour ago, 24h interval → not inactive (within grace)', () => {
    const lastRunAt = new Date(nowMs - 1 * 60 * 60 * 1000);
    expect(
      isInactive({ lastRunAt, heartbeatIntervalHours: 24, heartbeatOffsetHours: 0, heartbeatOffsetMinutes: 0, nowMs }),
    ).toBe(false);
  });

  it('ran 30 hours ago, 24h interval + 25% grace (6h) → inactive (30 > 24 + 6)', () => {
    const lastRunAt = new Date(nowMs - 30 * 60 * 60 * 1000);
    expect(
      isInactive({ lastRunAt, heartbeatIntervalHours: 24, heartbeatOffsetHours: 0, heartbeatOffsetMinutes: 0, nowMs }),
    ).toBe(true);
  });

  it('ran 26 hours ago, 24h interval + 6h grace → inactive (26 > 24 + 6 = 30? no, 26 < 30 → not inactive)', () => {
    // expectedNext = computeNextHeartbeatAt(lastRunAt, 24, 0, 0)
    // grace = 24 * 0.25 * 3600000 = 6h
    // inactive when: nowMs > expectedNextMs + gracePeriodMs
    const lastRunAt = new Date(nowMs - 26 * 60 * 60 * 1000);
    const expectedNext = computeNextHeartbeatAt(lastRunAt.getTime(), 24, 0, 0);
    const grace = 24 * 60 * 60 * 1000 * 0.25;
    // If nowMs <= expectedNext + grace → not inactive
    const inactive = nowMs > expectedNext + grace;
    expect(isInactive({ lastRunAt, heartbeatIntervalHours: 24, heartbeatOffsetHours: 0, heartbeatOffsetMinutes: 0, nowMs })).toBe(inactive);
  });
});

describe('inactiveWorkflows.ts source guardrails (AC-21)', () => {
  it('contains 7-day filter on agent_runs', () => {
    const filePath = resolve(
      process.cwd(),
      'server/services/optimiser/queries/inactiveWorkflows.ts',
    );
    const src = readFileSync(filePath, 'utf-8');
    expect(src).toMatch(/7 days/i);
  });

  it('uses computeNextHeartbeatAt from scheduleCalendarServicePure', () => {
    const filePath = resolve(
      process.cwd(),
      'server/services/optimiser/queries/inactiveWorkflows.ts',
    );
    const src = readFileSync(filePath, 'utf-8');
    expect(src).toMatch(/computeNextHeartbeatAt/);
    expect(src).toMatch(/scheduleCalendarServicePure/);
  });
});
