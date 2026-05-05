/**
 * memoryCitationPure.test.ts — Pure unit test (no DB).
 */

import { describe, it, expect, vi } from 'vitest';
import { module } from '../memoryCitation.js';

describe('memoryCitation query module — structural contracts', () => {
  it('has the correct category', () => {
    expect(module.category).toBe('optimiser.memory.low_citation_waste');
  });

  it('is readReplicaSafe', () => {
    expect(module.readReplicaSafe).toBe(true);
  });

  it('has the correct authoritativeTimestampColumn', () => {
    expect(module.authoritativeTimestampColumn).toBe('agent_runs.started_at');
  });
});

describe('memoryCitation query module — run() with mocked tx', () => {
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

  it('filters by 7-day window on agent_runs.started_at', async () => {
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

  it('uses COALESCE on avg_citation_score', async () => {
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

  it('maps rows correctly and rounds avgCitationScore to 4dp', async () => {
    const mockRow = {
      agent_id: 'agent-123',
      avg_citation_score: '0.333333',
      total_citations: '15',
      max_started_at: '2025-01-01T00:00:00Z',
    };

    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([mockRow]),
    };

    const result = await module.run(fakeTx as any, 'sub-1');

    expect(result).toHaveLength(1);
    expect(result[0].metricKey).toBe('agent-123');
    expect(result[0].evidence.agentId).toBe('agent-123');
    expect(result[0].evidence.avgCitationScore).toBe(0.3333);
    expect(result[0].evidence.totalCitations).toBe(15);
    expect(result[0].evidence.median_version).toBe(0);
  });

  it('metricValue equals avgCitationScore', async () => {
    const mockRow = {
      agent_id: 'agent-123',
      avg_citation_score: '0.25',
      total_citations: '10',
      max_started_at: null,
    };

    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([mockRow]),
    };

    const result = await module.run(fakeTx as any, 'sub-1');
    expect(result[0].metricValue).toBe(0.25);
  });
});
