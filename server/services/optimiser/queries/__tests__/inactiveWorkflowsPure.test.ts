/**
 * inactiveWorkflowsPure.test.ts — Pure unit test (no DB).
 */

import { describe, it, expect, vi } from 'vitest';
import { module } from '../inactiveWorkflows.js';

describe('inactiveWorkflows query module — structural contracts', () => {
  it('has the correct category', () => {
    expect(module.category).toBe('optimiser.inactive.workflow');
  });

  it('is readReplicaSafe', () => {
    expect(module.readReplicaSafe).toBe(true);
  });

  it('has the correct authoritativeTimestampColumn', () => {
    expect(module.authoritativeTimestampColumn).toBe('agent_runs.started_at');
  });
});

describe('inactiveWorkflows query module — run() with mocked tx', () => {
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

  it('includes LIMIT 100 for row-fetch pattern', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    await module.run(fakeTx as any, 'sub-1');

    const mainQuery = JSON.stringify(fakeTx.execute.mock.calls[1][0]);
    expect(mainQuery).toMatch(/LIMIT 100/i);
  });

  it('uses COALESCE on days_since_last_run with sentinel 999', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    await module.run(fakeTx as any, 'sub-1');

    const mainQuery = JSON.stringify(fakeTx.execute.mock.calls[1][0]);
    expect(mainQuery).toMatch(/COALESCE/i);
    expect(mainQuery).toMatch(/999/);
  });

  it('filters 7-day window on agent_runs.started_at', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    await module.run(fakeTx as any, 'sub-1');

    const mainQuery = JSON.stringify(fakeTx.execute.mock.calls[1][0]);
    expect(mainQuery).toMatch(/started_at/i);
    expect(mainQuery).toMatch(/7 days/i);
  });

  it('groups by subaccount_agent_id and agent fields (deterministic keys)', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    await module.run(fakeTx as any, 'sub-1');

    const mainQuery = JSON.stringify(fakeTx.execute.mock.calls[1][0]);
    expect(mainQuery).toMatch(/GROUP BY/i);
    expect(mainQuery).toMatch(/sa\.id/i);
    expect(mainQuery).toMatch(/a\.id/i);
  });

  it('maps rows correctly including daysSinceLastRun', async () => {
    const mockRow = {
      subaccount_agent_id: 'sa-id-1',
      agent_id: 'ag-id-1',
      agent_name: 'Marketing Agent',
      last_run_at: '2025-01-01T00:00:00Z',
      days_since_last_run: '5.5',
    };

    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([mockRow]),
    };

    const result = await module.run(fakeTx as any, 'sub-1');

    expect(result).toHaveLength(1);
    expect(result[0].metricKey).toBe('sa-id-1');
    expect(result[0].evidence.subaccountAgentId).toBe('sa-id-1');
    expect(result[0].evidence.agentId).toBe('ag-id-1');
    expect(result[0].evidence.agentName).toBe('Marketing Agent');
    expect(result[0].evidence.daysSinceLastRun).toBe(6); // Math.round(5.5)
    expect(result[0].evidence.median_version).toBe(0);
  });

  it('sets lastRunAt to null when row has no last_run_at', async () => {
    const mockRow = {
      subaccount_agent_id: 'sa-id-2',
      agent_id: 'ag-id-2',
      agent_name: 'Never Ran',
      last_run_at: null,
      days_since_last_run: '999',
    };

    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([mockRow]),
    };

    const result = await module.run(fakeTx as any, 'sub-1');

    expect(result[0].evidence.lastRunAt).toBeNull();
    expect(result[0].metricValue).toBe(999);
  });
});
