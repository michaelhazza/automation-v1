/**
 * agentBudgetPure.test.ts — Pure unit test (no DB).
 *
 * Tests the agentBudget query module's SQL construction patterns
 * and output mapping.
 */

import { describe, it, expect, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { module } from '../agentBudget.js';

// ── SQL template string capture ───────────────────────────────────────────────

function captureSql(chunks: TemplateStringsArray, ...values: unknown[]): string {
  return chunks.raw.join('?');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('agentBudget query module — structural contracts', () => {
  it('has the correct category', () => {
    expect(module.category).toBe('optimiser.agent.over_budget');
  });

  it('is readReplicaSafe', () => {
    expect(module.readReplicaSafe).toBe(true);
  });

  it('has the correct authoritativeTimestampColumn', () => {
    expect(module.authoritativeTimestampColumn).toBe('cost_aggregates.updated_at');
  });
});

describe('agentBudget query module — run() with mocked tx', () => {
  it('sets statement_timeout before the main query', async () => {
    const executeCalls: string[] = [];
    const fakeTx = {
      execute: vi.fn().mockImplementation((query: any) => {
        // Capture the SQL template text
        const queryStr = String(query);
        executeCalls.push(queryStr);
        // First call (SET LOCAL) returns undefined, second returns empty array
        if (executeCalls.length === 1) return Promise.resolve(undefined);
        return Promise.resolve([]);
      }),
    };

    await module.run(fakeTx as any, 'subaccount-123');

    expect(fakeTx.execute).toHaveBeenCalledTimes(2);
    // First call should include statement_timeout
    const firstCall = JSON.stringify(fakeTx.execute.mock.calls[0][0]);
    expect(firstCall).toMatch(/statement_timeout/i);
    expect(firstCall).toMatch(/10000/);
  });

  it('filters by subaccountId via subaccount_id parameter', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    await module.run(fakeTx as any, 'test-subaccount-id');

    const mainQuery = JSON.stringify(fakeTx.execute.mock.calls[1][0]);
    expect(mainQuery).toMatch(/subaccount_id/i);
  });

  it('filters cost_aggregates by 7-day window', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    await module.run(fakeTx as any, 'sub-1');

    const mainQuery = JSON.stringify(fakeTx.execute.mock.calls[1][0]);
    expect(mainQuery).toMatch(/7 days/i);
  });

  it('uses COALESCE on total_cost_cents to handle nullable', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    await module.run(fakeTx as any, 'sub-1');

    const mainQuery = JSON.stringify(fakeTx.execute.mock.calls[1][0]);
    expect(mainQuery).toMatch(/COALESCE/i);
  });

  it('groups by agent id and name', async () => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
    };

    await module.run(fakeTx as any, 'sub-1');

    const mainQuery = JSON.stringify(fakeTx.execute.mock.calls[1][0]);
    expect(mainQuery).toMatch(/GROUP BY/i);
    expect(mainQuery).toMatch(/a\.id/i);
    expect(mainQuery).toMatch(/a\.name/i);
  });

  it('maps rows correctly — computes percentUsed', async () => {
    const mockRow = {
      agent_id: 'agent-abc',
      agent_name: 'Test Agent',
      total_cost_cents: '10000', // $100
      max_cost_per_run_cents: '10000', // $100 limit → 100% used
      updated_at: '2025-01-01T00:00:00Z',
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
    expect(result[0].evidence.percentUsed).toBe(1);
    expect(result[0].evidence.median_version).toBe(0);
  });

  it('excludes rows with no budget limit (max_cost_per_run_cents is null)', async () => {
    const mockRow = {
      agent_id: 'agent-abc',
      agent_name: 'Test Agent',
      total_cost_cents: '10000',
      max_cost_per_run_cents: null,
      updated_at: '2025-01-01T00:00:00Z',
    };

    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([mockRow]),
    };

    const result = await module.run(fakeTx as any, 'sub-1');
    expect(result).toHaveLength(0);
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
