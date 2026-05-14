/**
 * cacheEfficiencyPure.test.ts — Pure unit test (no DB).
 */

import { describe, it, expect, vi } from 'vitest';
import { module } from '../cacheEfficiency.js';

describe('cacheEfficiency query module — structural contracts', () => {
  it('has the correct category', () => {
    expect(module.category).toBe('optimiser.llm.cache_poor_reuse');
  });

  it('is readReplicaSafe', () => {
    expect(module.readReplicaSafe).toBe(true);
  });

  it('has the correct authoritativeTimestampColumn', () => {
    expect(module.authoritativeTimestampColumn).toBe('llm_requests.created_at');
  });
});

describe('cacheEfficiency query module — run() with mocked tx', () => {
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

  it('filters by 7-day window on llm_requests.created_at', async () => {
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

  it('uses COALESCE on cache_hits and total_requests', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    await module.run(fakeTx as any, 'sub-1');

    const mainQuery = JSON.stringify(fakeTx.execute.mock.calls[1][0]);
    expect(mainQuery).toMatch(/COALESCE/i);
  });

  it('groups by agent_id (deterministic GROUP BY key)', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    await module.run(fakeTx as any, 'sub-1');

    const mainQuery = JSON.stringify(fakeTx.execute.mock.calls[1][0]);
    expect(mainQuery).toMatch(/GROUP BY/i);
    expect(mainQuery).toMatch(/agent_id/i);
  });

  it('computes cache hit rate correctly', async () => {
    const mockRow = {
      agent_id: 'agent-abc',
      cache_hits: '7',
      total_requests: '10',
      max_created_at: '2025-01-01T00:00:00Z',
    };

    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([mockRow]),
    };

    const result = await module.run(fakeTx as any, 'sub-1');

    expect(result).toHaveLength(1);
    expect(result[0].metricKey).toBe('agent-abc');
    expect(result[0].evidence.agentId).toBe('agent-abc');
    expect(result[0].evidence.cacheHits).toBe(7);
    expect(result[0].evidence.totalRequests).toBe(10);
    expect(result[0].evidence.cacheHitRate).toBe(0.7);
    expect(result[0].evidence.median_version).toBe(0);
  });

  it('metricValue equals cacheHitRate', async () => {
    const mockRow = {
      agent_id: 'agent-abc',
      cache_hits: '2',
      total_requests: '10',
      max_created_at: null,
    };

    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([mockRow]),
    };

    const result = await module.run(fakeTx as any, 'sub-1');
    expect(result[0].metricValue).toBe(0.2);
  });

  it('returns empty array when no rows match', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    const result = await module.run(fakeTx as any, 'sub-1');
    expect(result).toEqual([]);
  });
});
