/**
 * playbookEscalationPure.test.ts — Pure evaluator unit test (no DB, no I/O).
 */

import { describe, it, expect } from 'vitest';
import { evaluate } from '../playbookEscalation.js';
import type { EvaluatorContext } from '../types.js';

const baseCtx: EvaluatorContext = {
  subaccountId: 'sub-1',
  organisationId: 'org-1',
  medianVersion: 0,
  priorRecsByDedupe: new Map(),
};

function makeRow(workflowId: string, escalationRate: number) {
  const escalationCount = Math.round(escalationRate * 10);
  return {
    subaccountId: 'sub-1',
    metricKey: workflowId,
    metricValue: escalationRate,
    computedAt: new Date('2025-01-01'),
    evidence: {
      workflowId,
      escalationCount,
      totalCount: 10,
      escalationRate,
      median_version: 0 as const,
    },
  };
}

describe('playbookEscalation evaluator — input validation', () => {
  it('throws data_invalid when rows is not an array', () => {
    expect(() => evaluate(null as any, baseCtx)).toThrow();
    try {
      evaluate(null as any, baseCtx);
    } catch (e: any) {
      expect(e.errorType).toBe('data_invalid');
    }
  });

  it('throws data_invalid when evidence is missing escalationRate', () => {
    const badRow = {
      subaccountId: 'sub-1',
      metricKey: 'wf-1',
      metricValue: 0.5,
      computedAt: new Date(),
      evidence: { workflowId: 'wf-1' } as any,
    };
    expect(() => evaluate([badRow], baseCtx)).toThrow();
    try {
      evaluate([badRow], baseCtx);
    } catch (e: any) {
      expect(e.errorType).toBe('data_invalid');
    }
  });
});

describe('playbookEscalation evaluator — severity thresholds', () => {
  it('returns empty array when escalationRate <= 0.3', () => {
    const result = evaluate([makeRow('wf-1', 0.3)], baseCtx);
    expect(result).toHaveLength(0);
  });

  it('emits warn when escalationRate > 0.3', () => {
    const result = evaluate([makeRow('wf-1', 0.31)], baseCtx);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('warn');
  });

  it('emits critical when escalationRate > 0.6', () => {
    const result = evaluate([makeRow('wf-1', 0.61)], baseCtx);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('critical');
  });

  it('emits warn at exactly 0.31', () => {
    const result = evaluate([makeRow('wf-1', 0.31)], baseCtx);
    expect(result[0].severity).toBe('warn');
  });

  it('emits warn at exactly 0.6 (not yet critical)', () => {
    const result = evaluate([makeRow('wf-1', 0.6)], baseCtx);
    expect(result[0].severity).toBe('warn');
  });

  it('emits critical at exactly 0.601', () => {
    const result = evaluate([makeRow('wf-1', 0.601)], baseCtx);
    expect(result[0].severity).toBe('critical');
  });
});

describe('playbookEscalation evaluator — dedupe key and priority tuple', () => {
  it('dedupeKey equals metricKey (workflowId)', () => {
    const result = evaluate([makeRow('wf-abc', 0.5)], baseCtx);
    expect(result[0].dedupeKey).toBe('wf-abc');
  });

  it('priority tuple is [2, category, dedupeKey] for warn', () => {
    const result = evaluate([makeRow('wf-def', 0.4)], baseCtx);
    expect(result[0].priorityTuple).toEqual([2, 'optimiser.playbook.escalation_rate', 'wf-def']);
  });

  it('priority tuple is [3, category, dedupeKey] for critical', () => {
    const result = evaluate([makeRow('wf-def', 0.8)], baseCtx);
    expect(result[0].priorityTuple).toEqual([3, 'optimiser.playbook.escalation_rate', 'wf-def']);
  });

  it('priority tuple is deterministic regardless of input permutation', () => {
    const rows = [
      makeRow('wf-b', 0.5),
      makeRow('wf-a', 0.8),
    ];
    const r1 = evaluate(rows, baseCtx);
    const r2 = evaluate([...rows].reverse(), baseCtx);

    const s1 = [...r1].sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));
    const s2 = [...r2].sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));
    expect(s1.map((r) => r.priorityTuple)).toEqual(s2.map((r) => r.priorityTuple));
  });
});

describe('playbookEscalation evaluator — action hint', () => {
  it('generates correct escalation action hint', () => {
    const result = evaluate([makeRow('wf-xyz', 0.5)], baseCtx);
    expect(result[0].actionHint).toBe('configuration-assistant://workflow/wf-xyz?focus=escalation');
  });
});
