/**
 * skillSlowPure.test.ts — Pure evaluator unit test (no DB, no I/O).
 *
 * Covers:
 *  1. ratio >= 4 → 1 output with severity 'warn'
 *  2. ratio < 4  → 0 outputs (below threshold)
 *  3. medianVersion is propagated from evidence to output evidence
 *  4. dedupeKey equals row.metricKey (the skill_slug)
 *  5. Throws on non-array input
 *  6. Throws on missing ratioVsPeerP95 field
 */

import { describe, it, expect } from 'vitest';
import { evaluateSkillSlow } from '../skillSlow.js';
import type { EvaluatorContext } from '../types.js';

const baseCtx: EvaluatorContext = {
  subaccountId: 'sub-1',
  organisationId: 'org-1',
  medianVersion: 3,
  priorRecsByDedupe: new Map(),
};

function makeRow(
  skillSlug: string,
  ratioVsPeerP95: number,
  overrides: Partial<{
    thisP95Ms: number;
    peerP95Ms: number;
    peerP50Ms: number;
    nTenants: number;
    medianVersion: number;
  }> = {},
) {
  const thisP95Ms = overrides.thisP95Ms ?? 800;
  const peerP95Ms = overrides.peerP95Ms ?? 200;

  return {
    subaccountId: 'sub-1',
    metricKey: skillSlug,
    metricValue: thisP95Ms,
    computedAt: new Date('2025-01-01'),
    evidence: {
      skillSlug,
      thisP95Ms,
      peerP95Ms,
      peerP50Ms: overrides.peerP50Ms ?? 100,
      nTenants: overrides.nTenants ?? 50,
      medianVersion: overrides.medianVersion ?? 3,
      ratioVsPeerP95,
    },
  };
}

// ---------------------------------------------------------------------------
// Threshold behaviour
// ---------------------------------------------------------------------------

describe('evaluateSkillSlow — threshold (ratio >= 4 → warn)', () => {
  it('emits 1 output with severity warn when ratio is 4.5 (above threshold)', () => {
    const result = evaluateSkillSlow([makeRow('send-email', 4.5)], baseCtx);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('warn');
  });

  it('emits 1 output when ratio is exactly 4.0 (at threshold)', () => {
    const result = evaluateSkillSlow([makeRow('lookup', 4.0)], baseCtx);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('warn');
  });

  it('emits 0 outputs when ratio is 3.9 (below threshold)', () => {
    const result = evaluateSkillSlow([makeRow('fast-skill', 3.9)], baseCtx);
    expect(result).toHaveLength(0);
  });

  it('emits 0 outputs when ratio is 0 (well below threshold)', () => {
    const result = evaluateSkillSlow([makeRow('fast-skill', 0)], baseCtx);
    expect(result).toHaveLength(0);
  });

  it('emits 0 outputs for empty input array', () => {
    const result = evaluateSkillSlow([], baseCtx);
    expect(result).toHaveLength(0);
  });

  it('emits multiple outputs for multiple slow skills', () => {
    const rows = [makeRow('skill-a', 5.0), makeRow('skill-b', 10.2), makeRow('skill-c', 1.5)];
    const result = evaluateSkillSlow(rows, baseCtx);
    expect(result).toHaveLength(2);
    const keys = result.map((r) => r.dedupeKey).sort();
    expect(keys).toEqual(['skill-a', 'skill-b']);
  });
});

// ---------------------------------------------------------------------------
// medianVersion propagation
// ---------------------------------------------------------------------------

describe('evaluateSkillSlow — medianVersion propagation', () => {
  it('propagates medianVersion from evidence to output evidence', () => {
    const row = makeRow('send-email', 4.5, { medianVersion: 7 });
    const result = evaluateSkillSlow([row], baseCtx);

    expect(result).toHaveLength(1);
    expect(result[0].evidence['medianVersion']).toBe(7);
  });

  it('propagates medianVersion = 0 correctly', () => {
    const row = makeRow('send-email', 4.5, { medianVersion: 0 });
    const result = evaluateSkillSlow([row], baseCtx);
    expect(result[0].evidence['medianVersion']).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// dedupeKey and priorityTuple
// ---------------------------------------------------------------------------

describe('evaluateSkillSlow — dedupeKey and priorityTuple', () => {
  it('dedupeKey equals row.metricKey (the skill_slug)', () => {
    const result = evaluateSkillSlow([makeRow('my-special-skill', 5.0)], baseCtx);
    expect(result[0].dedupeKey).toBe('my-special-skill');
  });

  it('priorityTuple is [2, "optimiser.skill.slow", dedupeKey]', () => {
    const result = evaluateSkillSlow([makeRow('send-email', 4.5)], baseCtx);
    expect(result[0].priorityTuple).toEqual([2, 'optimiser.skill.slow', 'send-email']);
  });

  it('priorityTuple rank is always 2 (warn-only category)', () => {
    const result = evaluateSkillSlow([makeRow('skill-x', 100.0)], baseCtx);
    expect(result[0].priorityTuple[0]).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Evidence shape
// ---------------------------------------------------------------------------

describe('evaluateSkillSlow — evidence shape', () => {
  it('includes all required evidence fields in output', () => {
    const row = makeRow('send-email', 4.5, {
      thisP95Ms: 900,
      peerP95Ms: 200,
      peerP50Ms: 150,
      nTenants: 30,
      medianVersion: 5,
    });
    const result = evaluateSkillSlow([row], baseCtx);
    const ev = result[0].evidence;

    expect(ev['skillSlug']).toBe('send-email');
    expect(ev['thisP95Ms']).toBe(900);
    expect(ev['peerP95Ms']).toBe(200);
    expect(ev['peerP50Ms']).toBe(150);
    expect(ev['nTenants']).toBe(30);
    expect(ev['medianVersion']).toBe(5);
    expect(ev['ratioVsPeerP95']).toBe(4.5);
  });

  it('actionHint is null (no specific action hint for skill latency)', () => {
    const result = evaluateSkillSlow([makeRow('send-email', 5.0)], baseCtx);
    expect(result[0].actionHint).toBeNull();
  });

  it('category is optimiser.skill.slow', () => {
    const result = evaluateSkillSlow([makeRow('send-email', 5.0)], baseCtx);
    expect(result[0].category).toBe('optimiser.skill.slow');
  });
});

// ---------------------------------------------------------------------------
// Input validation (invariant 33 / error contracts)
// ---------------------------------------------------------------------------

describe('evaluateSkillSlow — input validation', () => {
  it('throws on non-array input (null)', () => {
    expect(() => evaluateSkillSlow(null as any, baseCtx)).toThrow(/data_invalid/i);
  });

  it('throws on non-array input (object)', () => {
    expect(() => evaluateSkillSlow({} as any, baseCtx)).toThrow(/data_invalid/i);
  });

  it('throws on non-array input (string)', () => {
    expect(() => evaluateSkillSlow('rows' as any, baseCtx)).toThrow(/data_invalid/i);
  });

  it('throws when ratioVsPeerP95 is missing from evidence', () => {
    const badRow = {
      subaccountId: 'sub-1',
      metricKey: 'skill-x',
      metricValue: 800,
      computedAt: new Date(),
      evidence: {
        skillSlug: 'skill-x',
        thisP95Ms: 800,
        peerP95Ms: 200,
        peerP50Ms: 100,
        nTenants: 10,
        medianVersion: 1,
        // ratioVsPeerP95 intentionally omitted
      } as any,
    };
    expect(() => evaluateSkillSlow([badRow], baseCtx)).toThrow(/data_invalid/i);
  });

  it('throws when thisP95Ms is missing from evidence', () => {
    const badRow = {
      subaccountId: 'sub-1',
      metricKey: 'skill-y',
      metricValue: 800,
      computedAt: new Date(),
      evidence: {
        skillSlug: 'skill-y',
        peerP95Ms: 200,
        peerP50Ms: 100,
        nTenants: 10,
        medianVersion: 1,
        ratioVsPeerP95: 4.0,
        // thisP95Ms intentionally omitted
      } as any,
    };
    expect(() => evaluateSkillSlow([badRow], baseCtx)).toThrow(/data_invalid/i);
  });
});
