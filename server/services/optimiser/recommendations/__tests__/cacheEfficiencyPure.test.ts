/**
 * cacheEfficiencyPure.test.ts — Pure evaluator unit test (no DB, no I/O).
 */

import { describe, it, expect } from 'vitest';
import { evaluate } from '../cacheEfficiency.js';
import type { EvaluatorContext } from '../types.js';

const baseCtx: EvaluatorContext = {
  subaccountId: 'sub-1',
  organisationId: 'org-1',
  medianVersion: 0,
  priorRecsByDedupe: new Map(),
};

function makeRow(agentId: string, cacheHitRate: number, total = 100) {
  const hits = Math.round(cacheHitRate * total);
  return {
    subaccountId: 'sub-1',
    metricKey: agentId,
    metricValue: cacheHitRate,
    computedAt: new Date('2025-01-01'),
    evidence: {
      agentId,
      cacheHits: hits,
      totalRequests: total,
      cacheHitRate,
      median_version: 0 as const,
    },
  };
}

describe('cacheEfficiency evaluator — input validation', () => {
  it('throws data_invalid when rows is not an array', () => {
    expect(() => evaluate(null as any, baseCtx)).toThrow();
    try {
      evaluate(null as any, baseCtx);
    } catch (e: any) {
      expect(e.errorType).toBe('data_invalid');
    }
  });

  it('throws data_invalid when evidence is missing cacheHitRate', () => {
    const badRow = {
      subaccountId: 'sub-1',
      metricKey: 'agent-1',
      metricValue: 0.2,
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

describe('cacheEfficiency evaluator — severity thresholds', () => {
  it('returns empty array when cacheHitRate >= 0.3', () => {
    const result = evaluate([makeRow('agent-1', 0.3)], baseCtx);
    expect(result).toHaveLength(0);
  });

  it('emits info when cacheHitRate < 0.3 and >= 0.1', () => {
    const result = evaluate([makeRow('agent-1', 0.29)], baseCtx);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('info');
  });

  it('emits warn when cacheHitRate < 0.1', () => {
    const result = evaluate([makeRow('agent-1', 0.09)], baseCtx);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('warn');
  });

  it('emits info at exactly 0.29', () => {
    const result = evaluate([makeRow('agent-1', 0.29)], baseCtx);
    expect(result[0].severity).toBe('info');
  });

  it('emits warn at exactly 0.09', () => {
    const result = evaluate([makeRow('agent-1', 0.09)], baseCtx);
    expect(result[0].severity).toBe('warn');
  });

  it('emits warn at cacheHitRate = 0.0', () => {
    const result = evaluate([makeRow('agent-1', 0.0)], baseCtx);
    expect(result[0].severity).toBe('warn');
  });

  it('does not emit at exactly 0.1 (not below warn threshold)', () => {
    // 0.1 is not < 0.1, falls through to info check (0.1 < 0.3 → info)
    const result = evaluate([makeRow('agent-1', 0.1)], baseCtx);
    expect(result[0].severity).toBe('info');
  });
});

describe('cacheEfficiency evaluator — dedupe key and priority tuple', () => {
  it('dedupeKey equals metricKey (agentId)', () => {
    const result = evaluate([makeRow('agent-abc', 0.2)], baseCtx);
    expect(result[0].dedupeKey).toBe('agent-abc');
  });

  it('priority tuple is [1, category, dedupeKey] for info', () => {
    const result = evaluate([makeRow('agent-def', 0.2)], baseCtx);
    expect(result[0].priorityTuple).toEqual([1, 'optimiser.llm.cache_poor_reuse', 'agent-def']);
  });

  it('priority tuple is [2, category, dedupeKey] for warn', () => {
    const result = evaluate([makeRow('agent-def', 0.05)], baseCtx);
    expect(result[0].priorityTuple).toEqual([2, 'optimiser.llm.cache_poor_reuse', 'agent-def']);
  });

  it('priority tuple is deterministic regardless of input permutation', () => {
    const rows = [
      makeRow('agent-b', 0.2),
      makeRow('agent-a', 0.05),
    ];
    const r1 = evaluate(rows, baseCtx);
    const r2 = evaluate([...rows].reverse(), baseCtx);

    const s1 = [...r1].sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));
    const s2 = [...r2].sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));
    expect(s1.map((r) => r.priorityTuple)).toEqual(s2.map((r) => r.priorityTuple));
  });
});

describe('cacheEfficiency evaluator — action hint', () => {
  it('generates correct cache action hint', () => {
    const result = evaluate([makeRow('agent-xyz', 0.2)], baseCtx);
    expect(result[0].actionHint).toBe('configuration-assistant://agent/agent-xyz?focus=llm_cache');
  });
});
