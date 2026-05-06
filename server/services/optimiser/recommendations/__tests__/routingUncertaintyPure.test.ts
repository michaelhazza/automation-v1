/**
 * routingUncertaintyPure.test.ts — Pure evaluator unit test (no DB, no I/O).
 */

import { describe, it, expect } from 'vitest';
import { evaluate } from '../routingUncertainty.js';
import type { EvaluatorContext } from '../types.js';

const baseCtx: EvaluatorContext = {
  subaccountId: 'sub-1',
  organisationId: 'org-1',
  medianVersion: 0,
  priorRecsByDedupe: new Map(),
};

function makeRow(agentId: string, uncertaintyRate: number, total = 20) {
  const uncertain = Math.round(uncertaintyRate * total);
  return {
    subaccountId: 'sub-1',
    metricKey: agentId,
    metricValue: uncertaintyRate,
    computedAt: new Date('2025-01-01'),
    evidence: {
      agentId,
      uncertainDecisions: uncertain,
      totalDecisions: total,
      uncertaintyRate,
      median_version: 0 as const,
    },
  };
}

describe('routingUncertainty evaluator — input validation', () => {
  it('throws data_invalid when rows is not an array', () => {
    expect(() => evaluate(null as any, baseCtx)).toThrow();
    try {
      evaluate(null as any, baseCtx);
    } catch (e: any) {
      expect(e.errorType).toBe('data_invalid');
    }
  });

  it('throws data_invalid when evidence is missing uncertaintyRate', () => {
    const badRow = {
      subaccountId: 'sub-1',
      metricKey: 'agent-1',
      metricValue: 0.5,
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

describe('routingUncertainty evaluator — severity thresholds', () => {
  it('returns empty array when uncertaintyRate <= 0.4', () => {
    const result = evaluate([makeRow('agent-1', 0.4)], baseCtx);
    expect(result).toHaveLength(0);
  });

  it('emits warn when uncertaintyRate > 0.4', () => {
    const result = evaluate([makeRow('agent-1', 0.41)], baseCtx);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('warn');
  });

  it('emits warn when uncertaintyRate is 0.9', () => {
    const result = evaluate([makeRow('agent-1', 0.9)], baseCtx);
    expect(result[0].severity).toBe('warn');
  });

  it('does not emit at exactly 0.4 (not > threshold)', () => {
    const result = evaluate([makeRow('agent-1', 0.4)], baseCtx);
    expect(result).toHaveLength(0);
  });

  it('emits at exactly 0.401', () => {
    const result = evaluate([makeRow('agent-1', 0.401)], baseCtx);
    expect(result[0].severity).toBe('warn');
  });
});

describe('routingUncertainty evaluator — dedupe key and priority tuple', () => {
  it('dedupeKey equals metricKey (agentId)', () => {
    const result = evaluate([makeRow('agent-abc', 0.5)], baseCtx);
    expect(result[0].dedupeKey).toBe('agent-abc');
  });

  it('priority tuple is [2, category, dedupeKey] for warn', () => {
    const result = evaluate([makeRow('agent-def', 0.6)], baseCtx);
    expect(result[0].priorityTuple).toEqual([2, 'optimiser.agent.routing_uncertainty', 'agent-def']);
  });

  it('priority tuple is deterministic regardless of input permutation', () => {
    const rows = [
      makeRow('agent-b', 0.6),
      makeRow('agent-a', 0.8),
    ];
    const r1 = evaluate(rows, baseCtx);
    const r2 = evaluate([...rows].reverse(), baseCtx);

    const s1 = [...r1].sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));
    const s2 = [...r2].sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));
    expect(s1.map((r) => r.priorityTuple)).toEqual(s2.map((r) => r.priorityTuple));
  });
});

describe('routingUncertainty evaluator — action hint', () => {
  it('generates correct routing action hint', () => {
    const result = evaluate([makeRow('agent-xyz', 0.6)], baseCtx);
    expect(result[0].actionHint).toBe('configuration-assistant://agent/agent-xyz?focus=routing');
  });
});
