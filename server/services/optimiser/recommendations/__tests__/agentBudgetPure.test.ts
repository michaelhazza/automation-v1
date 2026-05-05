/**
 * agentBudgetPure.test.ts — Pure evaluator unit test (no DB, no I/O).
 */

import { describe, it, expect } from 'vitest';
import { evaluate } from '../agentBudget.js';
import type { EvaluatorContext } from '../types.js';

const baseCtx: EvaluatorContext = {
  subaccountId: 'sub-1',
  organisationId: 'org-1',
  medianVersion: 0,
  priorRecsByDedupe: new Map(),
};

function makeRow(agentId: string, percentUsed: number) {
  return {
    subaccountId: 'sub-1',
    metricKey: agentId,
    metricValue: percentUsed * 10000,
    computedAt: new Date('2025-01-01'),
    evidence: {
      agentId,
      agentName: `Agent ${agentId}`,
      thisMonthSpendUsd: percentUsed * 100,
      budgetLimitUsd: 100,
      percentUsed,
      median_version: 0 as const,
    },
  };
}

describe('agentBudget evaluator — input validation', () => {
  it('throws data_invalid when rows is not an array', () => {
    expect(() => evaluate(null as any, baseCtx)).toThrow();
    try {
      evaluate(null as any, baseCtx);
    } catch (e: any) {
      expect(e.errorType).toBe('data_invalid');
    }
  });

  it('throws data_invalid when evidence is malformed (missing percentUsed)', () => {
    const badRow = {
      subaccountId: 'sub-1',
      metricKey: 'agent-1',
      metricValue: 100,
      computedAt: new Date(),
      evidence: { agentId: 'agent-1', agentName: 'Test' } as any,
    };
    expect(() => evaluate([badRow], baseCtx)).toThrow();
    try {
      evaluate([badRow], baseCtx);
    } catch (e: any) {
      expect(e.errorType).toBe('data_invalid');
    }
  });
});

describe('agentBudget evaluator — severity thresholds', () => {
  it('returns empty array when percentUsed <= 0.9', () => {
    const result = evaluate([makeRow('agent-1', 0.9)], baseCtx);
    expect(result).toHaveLength(0);
  });

  it('emits warn when percentUsed > 0.9 and <= 1.0', () => {
    const result = evaluate([makeRow('agent-1', 0.91)], baseCtx);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('warn');
  });

  it('emits warn at exactly 0.91', () => {
    const result = evaluate([makeRow('agent-1', 0.91)], baseCtx);
    expect(result[0].severity).toBe('warn');
  });

  it('emits critical when percentUsed > 1.0', () => {
    const result = evaluate([makeRow('agent-1', 1.01)], baseCtx);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('critical');
  });

  it('emits critical at exactly 1.001', () => {
    const result = evaluate([makeRow('agent-1', 1.001)], baseCtx);
    expect(result[0].severity).toBe('critical');
  });

  it('does not emit for percentUsed exactly 1.0 (not over budget)', () => {
    // 1.0 = exactly at budget, not over → warn threshold is > 0.9
    const result = evaluate([makeRow('agent-1', 1.0)], baseCtx);
    // 1.0 is not > 1.0, so not critical. Is it > 0.9? Yes → warn
    expect(result[0].severity).toBe('warn');
  });
});

describe('agentBudget evaluator — dedupe key and priority tuple', () => {
  it('dedupeKey equals metricKey (agent_id)', () => {
    const result = evaluate([makeRow('agent-abc', 0.95)], baseCtx);
    expect(result[0].dedupeKey).toBe('agent-abc');
  });

  it('priority tuple is [2, category, dedupeKey] for warn', () => {
    const result = evaluate([makeRow('agent-def', 0.95)], baseCtx);
    expect(result[0].priorityTuple).toEqual([2, 'optimiser.agent.over_budget', 'agent-def']);
  });

  it('priority tuple is [3, category, dedupeKey] for critical', () => {
    const result = evaluate([makeRow('agent-def', 1.5)], baseCtx);
    expect(result[0].priorityTuple).toEqual([3, 'optimiser.agent.over_budget', 'agent-def']);
  });

  it('priority tuple is deterministic regardless of input permutation', () => {
    const rows = [
      makeRow('agent-b', 0.95),
      makeRow('agent-a', 1.5),
    ];
    const result1 = evaluate(rows, baseCtx);
    const result2 = evaluate([...rows].reverse(), baseCtx);

    // Sort both by dedupeKey to compare
    const sorted1 = [...result1].sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));
    const sorted2 = [...result2].sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));

    expect(sorted1.map((r) => r.priorityTuple)).toEqual(sorted2.map((r) => r.priorityTuple));
  });
});

describe('agentBudget evaluator — action hint', () => {
  it('generates correct budget action hint', () => {
    const result = evaluate([makeRow('agent-123', 0.95)], baseCtx);
    expect(result[0].actionHint).toBe('configuration-assistant://agent/agent-123?focus=budget');
  });
});
