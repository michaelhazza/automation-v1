/**
 * repeatPhrasePure.test.ts — Pure evaluator unit test (no DB, no I/O).
 */

import { describe, it, expect } from 'vitest';
import { evaluate } from '../repeatPhrase.js';
import type { EvaluatorContext } from '../types.js';

const baseCtx: EvaluatorContext = {
  subaccountId: 'sub-1',
  organisationId: 'org-1',
  medianVersion: 0,
  priorRecsByDedupe: new Map(),
};

function makeRow(phrase: string, count: number, ids: string[] = ['ri-1']) {
  return {
    subaccountId: 'sub-1',
    metricKey: phrase,
    metricValue: count,
    computedAt: new Date('2025-01-01'),
    evidence: {
      phrase,
      count,
      sampleEscalationIds: ids,
      median_version: 0 as const,
    },
  };
}

describe('repeatPhrase evaluator — input validation', () => {
  it('throws data_invalid when rows is not an array', () => {
    expect(() => evaluate(null as any, baseCtx)).toThrow();
    try {
      evaluate(null as any, baseCtx);
    } catch (e: any) {
      expect(e.errorType).toBe('data_invalid');
    }
  });

  it('throws data_invalid when evidence is missing count', () => {
    const badRow = {
      subaccountId: 'sub-1',
      metricKey: 'hello',
      metricValue: 5,
      computedAt: new Date(),
      evidence: { phrase: 'hello' } as any,
    };
    expect(() => evaluate([badRow], baseCtx)).toThrow();
    try {
      evaluate([badRow], baseCtx);
    } catch (e: any) {
      expect(e.errorType).toBe('data_invalid');
    }
  });
});

describe('repeatPhrase evaluator — severity thresholds', () => {
  it('returns empty array when count < 3', () => {
    const result = evaluate([makeRow('billing', 2)], baseCtx);
    expect(result).toHaveLength(0);
  });

  it('emits info when count >= 3', () => {
    const result = evaluate([makeRow('billing', 3)], baseCtx);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('info');
  });

  it('emits info when count is 10', () => {
    const result = evaluate([makeRow('billing', 10)], baseCtx);
    expect(result[0].severity).toBe('info');
  });

  it('does not emit for count exactly 2 (below threshold)', () => {
    const result = evaluate([makeRow('billing', 2)], baseCtx);
    expect(result).toHaveLength(0);
  });

  it('does not emit for count exactly 1', () => {
    const result = evaluate([makeRow('billing', 1)], baseCtx);
    expect(result).toHaveLength(0);
  });
});

describe('repeatPhrase evaluator — dedupe key and priority tuple', () => {
  it('dedupeKey equals metricKey (phrase)', () => {
    const result = evaluate([makeRow('billing', 5)], baseCtx);
    expect(result[0].dedupeKey).toBe('billing');
  });

  it('priority tuple is [1, category, dedupeKey] for info', () => {
    const result = evaluate([makeRow('billing', 5)], baseCtx);
    expect(result[0].priorityTuple).toEqual([1, 'optimiser.escalation.repeat_phrase', 'billing']);
  });

  it('priority tuple is deterministic regardless of input permutation', () => {
    const rows = [
      makeRow('payment', 5),
      makeRow('billing', 10),
    ];
    const r1 = evaluate(rows, baseCtx);
    const r2 = evaluate([...rows].reverse(), baseCtx);

    const s1 = [...r1].sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));
    const s2 = [...r2].sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));
    expect(s1.map((r) => r.priorityTuple)).toEqual(s2.map((r) => r.priorityTuple));
  });
});

describe('repeatPhrase evaluator — action hint', () => {
  it('generates correct phrase action hint pointing to subaccountId', () => {
    const result = evaluate([makeRow('billing', 5)], baseCtx);
    expect(result[0].actionHint).toBe('configuration-assistant://subaccount/sub-1?focus=escalation_phrases');
  });
});
