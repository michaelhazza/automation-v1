/**
 * routingUncertaintyPure.test.ts — Pure unit test (no DB).
 */

import { describe, it, expect, vi } from 'vitest';
import { module } from '../routingUncertainty.js';

describe('routingUncertainty query module — structural contracts', () => {
  it('has the correct category', () => {
    expect(module.category).toBe('optimiser.agent.routing_uncertainty');
  });

  it('is readReplicaSafe', () => {
    expect(module.readReplicaSafe).toBe(true);
  });

  it('has the correct authoritativeTimestampColumn', () => {
    expect(module.authoritativeTimestampColumn).toBe('fast_path_decisions.decided_at');
  });
});

describe('routingUncertainty query module — run() with mocked tx', () => {
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

  it('filters by 7-day window on fast_path_decisions.decided_at', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    await module.run(fakeTx as any, 'sub-1');

    const mainQuery = JSON.stringify(fakeTx.execute.mock.calls[1][0]);
    expect(mainQuery).toMatch(/decided_at/i);
    expect(mainQuery).toMatch(/7 days/i);
  });

  it('uses COALESCE on uncertain_decisions and total_decisions', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    await module.run(fakeTx as any, 'sub-1');

    const mainQuery = JSON.stringify(fakeTx.execute.mock.calls[1][0]);
    expect(mainQuery).toMatch(/COALESCE/i);
  });

  it('groups by assigned_agent_id (deterministic GROUP BY key)', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    await module.run(fakeTx as any, 'sub-1');

    const mainQuery = JSON.stringify(fakeTx.execute.mock.calls[1][0]);
    expect(mainQuery).toMatch(/GROUP BY/i);
    expect(mainQuery).toMatch(/assigned_agent_id/i);
  });

  it('maps rows and computes uncertainty rate correctly', async () => {
    const mockRow = {
      agent_id: 'agent-xyz',
      uncertain_decisions: '3',
      total_decisions: '10',
      max_decided_at: '2025-01-01T00:00:00Z',
    };

    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([mockRow]),
    };

    const result = await module.run(fakeTx as any, 'sub-1');

    expect(result).toHaveLength(1);
    expect(result[0].metricKey).toBe('agent-xyz');
    expect(result[0].evidence.agentId).toBe('agent-xyz');
    expect(result[0].evidence.uncertainDecisions).toBe(3);
    expect(result[0].evidence.totalDecisions).toBe(10);
    expect(result[0].evidence.uncertaintyRate).toBe(0.3); // 3/10
    expect(result[0].evidence.median_version).toBe(0);
  });

  it('metricValue equals uncertaintyRate', async () => {
    const mockRow = {
      agent_id: 'agent-abc',
      uncertain_decisions: '5',
      total_decisions: '8',
      max_decided_at: null,
    };

    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([mockRow]),
    };

    const result = await module.run(fakeTx as any, 'sub-1');
    expect(result[0].metricValue).toBe(0.625);
  });
});
