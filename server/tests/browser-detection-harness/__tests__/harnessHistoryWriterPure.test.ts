import { describe, it, expect } from 'vitest';
import { toRow } from '../harnessHistoryWriterPure.js';
import type { HarnessRunResult } from '../harnessHistoryWriterPure.js';

// ---------------------------------------------------------------------------
// Pure-logic tests for harnessHistoryWriterPure.toRow
//
// Covers:
//   - correct field mapping from HarnessRunResult to DB row shape
//   - nullable numeric fields are converted to string (Drizzle numeric type)
//   - null score / baseline fields pass through as null
//   - missing required fields trigger the validation error
//   - all 5 outcome enum values map correctly
// ---------------------------------------------------------------------------

function baseResult(overrides: Partial<HarnessRunResult> = {}): HarnessRunResult {
  return {
    siteSlug:          'browserscan',
    mode:              'blocking',
    score:             0.85,
    baselineScore:     0.80,
    baselineTolerance: 0.05,
    outcome:           'pass',
    browserVersion:    'chromium/124.0.6367.207',
    playwrightVersion: '1.44.0',
    templateDigest:    'sha256:abc123',
    ...overrides,
  };
}

describe('toRow — field mapping', () => {
  it('maps all fields from HarnessRunResult to DB row shape', () => {
    const row = toRow(baseResult());

    expect(row.siteSlug).toBe('browserscan');
    expect(row.mode).toBe('blocking');
    expect(row.outcome).toBe('pass');
    expect(row.browserVersion).toBe('chromium/124.0.6367.207');
    expect(row.playwrightVersion).toBe('1.44.0');
    expect(row.templateDigest).toBe('sha256:abc123');
  });

  it('converts numeric score to string for Drizzle numeric column', () => {
    const row = toRow(baseResult({ score: 0.75 }));
    expect(row.score).toBe('0.75');
  });

  it('converts baselineScore and baselineTolerance to strings', () => {
    const row = toRow(baseResult({ baselineScore: 0.80, baselineTolerance: 0.05 }));
    expect(row.baselineScore).toBe('0.8');
    expect(row.baselineTolerance).toBe('0.05');
  });

  it('passes null score through as null', () => {
    const row = toRow(baseResult({ score: null }));
    expect(row.score).toBeNull();
  });

  it('passes null baselineScore and baselineTolerance through as null', () => {
    const row = toRow(baseResult({ baselineScore: null, baselineTolerance: null }));
    expect(row.baselineScore).toBeNull();
    expect(row.baselineTolerance).toBeNull();
  });

  it('row has no id or runAt (DB defaults fill these)', () => {
    const row = toRow(baseResult());
    expect(row.id).toBeUndefined();
    expect(row.runAt).toBeUndefined();
  });
});

describe('toRow — outcome enum (all 5 values)', () => {
  const outcomes = [
    'pass',
    'fail',
    'baseline_established',
    'site_unavailable',
    'parse_error',
  ] as const;

  for (const outcome of outcomes) {
    it(`maps outcome '${outcome}' correctly`, () => {
      const row = toRow(baseResult({ outcome }));
      expect(row.outcome).toBe(outcome);
    });
  }
});

describe('toRow — mode enum (all 4 values)', () => {
  const modes = ['blocking', 'nightly', 'advisory', 'disabled'] as const;

  for (const mode of modes) {
    it(`maps mode '${mode}' correctly`, () => {
      const row = toRow(baseResult({ mode }));
      expect(row.mode).toBe(mode);
    });
  }
});

describe('toRow — validation', () => {
  it('throws when siteSlug is empty string', () => {
    expect(() => toRow(baseResult({ siteSlug: '' }))).toThrow(
      'harnessHistoryWriterPure: invalid result shape:',
    );
    expect(() => toRow(baseResult({ siteSlug: '' }))).toThrow('siteSlug');
  });

  it('throws when outcome is missing (undefined cast)', () => {
    const bad = baseResult();
    // Simulate a missing field by bypassing TypeScript
    (bad as unknown as Record<string, unknown>).outcome = undefined;
    expect(() => toRow(bad)).toThrow('harnessHistoryWriterPure: invalid result shape:');
    expect(() => toRow(bad)).toThrow('outcome');
  });

  it('throws when browserVersion is missing', () => {
    const bad = baseResult();
    (bad as unknown as Record<string, unknown>).browserVersion = undefined;
    expect(() => toRow(bad)).toThrow('browserVersion');
  });

  it('throws when playwrightVersion is missing', () => {
    const bad = baseResult();
    (bad as unknown as Record<string, unknown>).playwrightVersion = undefined;
    expect(() => toRow(bad)).toThrow('playwrightVersion');
  });

  it('throws when templateDigest is missing', () => {
    const bad = baseResult();
    (bad as unknown as Record<string, unknown>).templateDigest = undefined;
    expect(() => toRow(bad)).toThrow('templateDigest');
  });

  it('throws when multiple required fields are missing', () => {
    const bad = baseResult();
    (bad as unknown as Record<string, unknown>).siteSlug = undefined;
    (bad as unknown as Record<string, unknown>).outcome = undefined;
    expect(() => toRow(bad)).toThrow('harnessHistoryWriterPure: invalid result shape:');
  });
});

describe('toRow — baseline_established outcome with null scores', () => {
  it('accepts null baselineScore and baselineTolerance for baseline_established', () => {
    const row = toRow(baseResult({
      outcome:           'baseline_established',
      baselineScore:     null,
      baselineTolerance: null,
    }));
    expect(row.outcome).toBe('baseline_established');
    expect(row.baselineScore).toBeNull();
    expect(row.baselineTolerance).toBeNull();
  });

  it('accepts non-null score for baseline_established', () => {
    const row = toRow(baseResult({
      outcome: 'baseline_established',
      score:   0.90,
    }));
    expect(row.score).toBe('0.9');
  });
});
