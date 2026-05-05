/**
 * memoryCitationPure.test.ts — Pure evaluator unit test (no DB, no I/O).
 */

import { describe, it, expect } from 'vitest';
import { evaluate } from '../memoryCitation.js';
import type { EvaluatorContext } from '../types.js';

const baseCtx: EvaluatorContext = {
  subaccountId: 'sub-1',
  organisationId: 'org-1',
  medianVersion: 0,
  priorRecsByDedupe: new Map(),
};

function makeRow(agentId: string, avgCitationScore: number, totalCitations = 20) {
  return {
    subaccountId: 'sub-1',
    metricKey: agentId,
    metricValue: avgCitationScore,
    computedAt: new Date('2025-01-01'),
    evidence: {
      agentId,
      avgCitationScore,
      totalCitations,
      median_version: 0 as const,
    },
  };
}

describe('memoryCitation evaluator — input validation', () => {
  it('throws data_invalid when rows is not an array', () => {
    expect(() => evaluate(null as any, baseCtx)).toThrow();
    try {
      evaluate(null as any, baseCtx);
    } catch (e: any) {
      expect(e.errorType).toBe('data_invalid');
    }
  });

  it('throws data_invalid when evidence is missing avgCitationScore', () => {
    const badRow = {
      subaccountId: 'sub-1',
      metricKey: 'agent-1',
      metricValue: 0.3,
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

describe('memoryCitation evaluator — severity thresholds', () => {
  it('returns empty array when avgCitationScore >= 0.5', () => {
    const result = evaluate([makeRow('agent-1', 0.5)], baseCtx);
    expect(result).toHaveLength(0);
  });

  it('emits info when avgCitationScore < 0.5', () => {
    const result = evaluate([makeRow('agent-1', 0.49)], baseCtx);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('info');
  });

  it('emits warn when avgCitationScore < 0.2', () => {
    const result = evaluate([makeRow('agent-1', 0.19)], baseCtx);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('warn');
  });

  it('emits info at exactly 0.49 (below 0.5, above 0.2)', () => {
    const result = evaluate([makeRow('agent-1', 0.49)], baseCtx);
    expect(result[0].severity).toBe('info');
  });

  it('emits warn at exactly 0.19 (below 0.2)', () => {
    const result = evaluate([makeRow('agent-1', 0.19)], baseCtx);
    expect(result[0].severity).toBe('warn');
  });

  it('emits warn at exactly 0.0', () => {
    const result = evaluate([makeRow('agent-1', 0.0)], baseCtx);
    expect(result[0].severity).toBe('warn');
  });

  it('does not emit at exactly 0.2 (not below threshold)', () => {
    // 0.2 is not < 0.2 → falls through to info check (0.2 < 0.5 → info)
    const result = evaluate([makeRow('agent-1', 0.2)], baseCtx);
    expect(result[0].severity).toBe('info');
  });
});

describe('memoryCitation evaluator — dedupe key and priority tuple', () => {
  it('dedupeKey equals metricKey (agentId)', () => {
    const result = evaluate([makeRow('agent-abc', 0.3)], baseCtx);
    expect(result[0].dedupeKey).toBe('agent-abc');
  });

  it('priority tuple is [1, category, dedupeKey] for info', () => {
    const result = evaluate([makeRow('agent-def', 0.4)], baseCtx);
    expect(result[0].priorityTuple).toEqual([1, 'optimiser.memory.low_citation_waste', 'agent-def']);
  });

  it('priority tuple is [2, category, dedupeKey] for warn', () => {
    const result = evaluate([makeRow('agent-def', 0.1)], baseCtx);
    expect(result[0].priorityTuple).toEqual([2, 'optimiser.memory.low_citation_waste', 'agent-def']);
  });

  it('priority tuple is deterministic regardless of input permutation', () => {
    const rows = [
      makeRow('agent-b', 0.4),
      makeRow('agent-a', 0.1),
    ];
    const r1 = evaluate(rows, baseCtx);
    const r2 = evaluate([...rows].reverse(), baseCtx);

    const s1 = [...r1].sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));
    const s2 = [...r2].sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));
    expect(s1.map((r) => r.priorityTuple)).toEqual(s2.map((r) => r.priorityTuple));
  });
});

describe('memoryCitation evaluator — action hint', () => {
  it('generates correct memory citation action hint', () => {
    const result = evaluate([makeRow('agent-xyz', 0.3)], baseCtx);
    expect(result[0].actionHint).toBe('configuration-assistant://agent/agent-xyz?focus=memory');
  });
});
