/**
 * inactiveWorkflowPure.test.ts — Pure evaluator unit test (no DB, no I/O).
 */

import { describe, it, expect } from 'vitest';
import { evaluate } from '../inactiveWorkflow.js';
import type { EvaluatorContext } from '../types.js';

const baseCtx: EvaluatorContext = {
  subaccountId: 'sub-1',
  organisationId: 'org-1',
  medianVersion: 0,
  priorRecsByDedupe: new Map(),
};

function makeRow(saId: string, daysSinceLastRun: number, lastRunAt: string | null = null) {
  return {
    subaccountId: 'sub-1',
    metricKey: saId,
    metricValue: daysSinceLastRun,
    computedAt: new Date('2025-01-01'),
    evidence: {
      subaccountAgentId: saId,
      agentId: `agent-${saId}`,
      agentName: `Agent ${saId}`,
      lastRunAt,
      daysSinceLastRun,
      median_version: 0 as const,
    },
  };
}

describe('inactiveWorkflow evaluator — input validation', () => {
  it('throws data_invalid when rows is not an array', () => {
    expect(() => evaluate(null as any, baseCtx)).toThrow();
    try {
      evaluate(null as any, baseCtx);
    } catch (e: any) {
      expect(e.errorType).toBe('data_invalid');
    }
  });

  it('throws data_invalid when evidence is missing required fields', () => {
    const badRow = {
      subaccountId: 'sub-1',
      metricKey: 'sa-1',
      metricValue: 5,
      computedAt: new Date(),
      evidence: { agentId: 'agent-1' } as any,
    };
    expect(() => evaluate([badRow], baseCtx)).toThrow();
    try {
      evaluate([badRow], baseCtx);
    } catch (e: any) {
      expect(e.errorType).toBe('data_invalid');
    }
  });
});

describe('inactiveWorkflow evaluator — severity thresholds', () => {
  it('returns empty array when daysSinceLastRun is 0', () => {
    const result = evaluate([makeRow('sa-1', 0)], baseCtx);
    expect(result).toHaveLength(0);
  });

  it('emits info when daysSinceLastRun is 1 (positive but < 14)', () => {
    const result = evaluate([makeRow('sa-1', 1, '2024-12-31T00:00:00Z')], baseCtx);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('info');
  });

  it('emits info when daysSinceLastRun is 7', () => {
    const result = evaluate([makeRow('sa-1', 7)], baseCtx);
    expect(result[0].severity).toBe('info');
  });

  it('emits warn when daysSinceLastRun > 14', () => {
    const result = evaluate([makeRow('sa-1', 15)], baseCtx);
    expect(result[0].severity).toBe('warn');
  });

  it('emits warn when daysSinceLastRun is 999 (never ran sentinel)', () => {
    const result = evaluate([makeRow('sa-1', 999, null)], baseCtx);
    expect(result[0].severity).toBe('warn');
  });

  it('emits warn when daysSinceLastRun is exactly 15', () => {
    const result = evaluate([makeRow('sa-1', 15)], baseCtx);
    expect(result[0].severity).toBe('warn');
  });

  it('emits info when daysSinceLastRun is exactly 14 (boundary)', () => {
    const result = evaluate([makeRow('sa-1', 14)], baseCtx);
    // 14 is not > 14 → info
    expect(result[0].severity).toBe('info');
  });
});

describe('inactiveWorkflow evaluator — dedupe key and priority tuple', () => {
  it('dedupeKey equals metricKey (subaccountAgentId)', () => {
    const result = evaluate([makeRow('sa-abc', 5)], baseCtx);
    expect(result[0].dedupeKey).toBe('sa-abc');
  });

  it('priority tuple is [1, category, dedupeKey] for info', () => {
    const result = evaluate([makeRow('sa-def', 5)], baseCtx);
    expect(result[0].priorityTuple).toEqual([1, 'optimiser.inactive.workflow', 'sa-def']);
  });

  it('priority tuple is [2, category, dedupeKey] for warn', () => {
    const result = evaluate([makeRow('sa-def', 20)], baseCtx);
    expect(result[0].priorityTuple).toEqual([2, 'optimiser.inactive.workflow', 'sa-def']);
  });

  it('priority tuple is deterministic regardless of input permutation', () => {
    const rows = [
      makeRow('sa-b', 5),
      makeRow('sa-a', 20),
    ];
    const r1 = evaluate(rows, baseCtx);
    const r2 = evaluate([...rows].reverse(), baseCtx);

    const s1 = [...r1].sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));
    const s2 = [...r2].sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));
    expect(s1.map((r) => r.priorityTuple)).toEqual(s2.map((r) => r.priorityTuple));
  });
});

describe('inactiveWorkflow evaluator — action hint', () => {
  it('generates correct inactive workflow action hint', () => {
    const result = evaluate([makeRow('sa-xyz', 5)], baseCtx);
    expect(result[0].actionHint).toBe('configuration-assistant://workflow/sa-xyz?focus=schedule');
  });
});
