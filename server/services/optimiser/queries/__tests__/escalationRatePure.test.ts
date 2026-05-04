/**
 * escalationRatePure.test.ts — Pure unit test (no DB).
 */

import { describe, it, expect, vi } from 'vitest';
import { module } from '../escalationRate.js';

describe('escalationRate query module — structural contracts', () => {
  it('has the correct category', () => {
    expect(module.category).toBe('optimiser.playbook.escalation_rate');
  });

  it('is readReplicaSafe', () => {
    expect(module.readReplicaSafe).toBe(true);
  });

  it('has the correct authoritativeTimestampColumn', () => {
    expect(module.authoritativeTimestampColumn).toBe('flow_runs.created_at');
  });
});

describe('escalationRate query module — run() with mocked tx', () => {
  it('sets statement_timeout before the main query', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    await module.run(fakeTx as any, 'sub-1');

    expect(fakeTx.execute).toHaveBeenCalledTimes(2);
    const firstCall = JSON.stringify(fakeTx.execute.mock.calls[0][0]);
    expect(firstCall).toMatch(/statement_timeout/i);
    expect(firstCall).toMatch(/10000/);
  });

  it('filters by subaccount_id', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    await module.run(fakeTx as any, 'sub-1');

    const mainQuery = JSON.stringify(fakeTx.execute.mock.calls[1][0]);
    expect(mainQuery).toMatch(/subaccount_id/i);
  });

  it('filters by 7-day window on flow_runs.created_at', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    await module.run(fakeTx as any, 'sub-1');

    const mainQuery = JSON.stringify(fakeTx.execute.mock.calls[1][0]);
    expect(mainQuery).toMatch(/created_at/i);
    expect(mainQuery).toMatch(/7 days/i);
  });

  it('groups by workflow_name (deterministic GROUP BY key)', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    await module.run(fakeTx as any, 'sub-1');

    const mainQuery = JSON.stringify(fakeTx.execute.mock.calls[1][0]);
    expect(mainQuery).toMatch(/GROUP BY/i);
    expect(mainQuery).toMatch(/workflow_name/i);
  });

  it('computes escalation rate correctly', async () => {
    const mockRow = {
      workflow_name: 'onboard-workflow',
      total_count: '10',
      escalation_count: '4',
      max_created_at: '2025-01-01T00:00:00Z',
    };

    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([mockRow]),
    };

    const result = await module.run(fakeTx as any, 'sub-1');

    expect(result).toHaveLength(1);
    expect(result[0].metricKey).toBe('onboard-workflow');
    expect(result[0].evidence.escalationCount).toBe(4);
    expect(result[0].evidence.totalCount).toBe(10);
    expect(result[0].evidence.escalationRate).toBe(0.4);
    expect(result[0].evidence.median_version).toBe(0);
  });

  it('metricValue equals escalationRate (rounded to 4dp)', async () => {
    const mockRow = {
      workflow_name: 'wf-1',
      total_count: '3',
      escalation_count: '1',
      max_created_at: '2025-01-01T00:00:00Z',
    };

    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([mockRow]),
    };

    const result = await module.run(fakeTx as any, 'sub-1');
    // 1/3 = 0.3333...
    expect(result[0].metricValue).toBe(0.3333);
  });
});
