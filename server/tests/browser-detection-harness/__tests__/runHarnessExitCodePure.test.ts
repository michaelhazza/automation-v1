import { describe, it, expect } from 'vitest';
import { runHarnessExitCodePure } from '../runHarness.js';
import type { HarnessRunResult } from '../harnessHistoryWriterPure.js';

// ---------------------------------------------------------------------------
// Pure-logic tests for runHarnessExitCodePure (spec §8.1 truth table).
//
// The contract: exit code is 1 iff ALL of:
//   (i)   gatingEnabled === true
//   (ii)  mode === 'blocking'
//   (iii) ≥1 result with mode==='blocking' and outcome in {'fail','parse_error'}
// In every other case exit code is 0.
// ---------------------------------------------------------------------------

function r(overrides: Partial<HarnessRunResult>): HarnessRunResult {
  return {
    siteSlug:          'fixture',
    mode:              'blocking',
    score:             null,
    baselineScore:     null,
    baselineTolerance: null,
    outcome:           'pass',
    browserVersion:    'chromium/test',
    playwrightVersion: '1.44.0',
    templateDigest:    'sha256:test',
    ...overrides,
  };
}

describe('runHarnessExitCodePure', () => {
  it('Given gating disabled / When any failure / Then exit 0', () => {
    const results = [r({ siteSlug: 'a', mode: 'blocking', outcome: 'fail' })];
    expect(runHarnessExitCodePure(results, 'blocking', false)).toBe(0);
  });

  it('Given gating enabled + mode=full / When blocking-site fail / Then exit 0', () => {
    const results = [r({ siteSlug: 'a', mode: 'blocking', outcome: 'fail' })];
    expect(runHarnessExitCodePure(results, 'full', true)).toBe(0);
  });

  it('Given gating enabled + mode=blocking / When advisory site fails / Then exit 0', () => {
    const results = [r({ siteSlug: 'a', mode: 'advisory', outcome: 'fail' })];
    expect(runHarnessExitCodePure(results, 'blocking', true)).toBe(0);
  });

  it('Given gating enabled + mode=blocking / When nightly site fails / Then exit 0', () => {
    const results = [r({ siteSlug: 'a', mode: 'nightly', outcome: 'fail' })];
    expect(runHarnessExitCodePure(results, 'blocking', true)).toBe(0);
  });

  it('Given gating enabled + mode=blocking / When blocking site outcome=fail / Then exit 1', () => {
    const results = [r({ siteSlug: 'a', mode: 'blocking', outcome: 'fail' })];
    expect(runHarnessExitCodePure(results, 'blocking', true)).toBe(1);
  });

  it('Given gating enabled + mode=blocking / When blocking site outcome=parse_error / Then exit 1', () => {
    const results = [r({ siteSlug: 'a', mode: 'blocking', outcome: 'parse_error' })];
    expect(runHarnessExitCodePure(results, 'blocking', true)).toBe(1);
  });

  it('Given gating enabled + mode=blocking / When ALL blocking sites outcome=site_unavailable / Then exit 0', () => {
    const results = [
      r({ siteSlug: 'a', mode: 'blocking', outcome: 'site_unavailable' }),
      r({ siteSlug: 'b', mode: 'blocking', outcome: 'site_unavailable' }),
    ];
    expect(runHarnessExitCodePure(results, 'blocking', true)).toBe(0);
  });

  it('Given gating enabled + mode=blocking / When blocking site outcome=pass / Then exit 0', () => {
    const results = [r({ siteSlug: 'a', mode: 'blocking', outcome: 'pass' })];
    expect(runHarnessExitCodePure(results, 'blocking', true)).toBe(0);
  });

  it('Given gating enabled + mode=blocking / When blocking site outcome=baseline_established / Then exit 0', () => {
    const results = [r({ siteSlug: 'a', mode: 'blocking', outcome: 'baseline_established' })];
    expect(runHarnessExitCodePure(results, 'blocking', true)).toBe(0);
  });

  it('Given gating enabled + mode=blocking / When mixed blocking pass + advisory fail / Then exit 0', () => {
    const results = [
      r({ siteSlug: 'a', mode: 'blocking', outcome: 'pass' }),
      r({ siteSlug: 'b', mode: 'advisory', outcome: 'fail' }),
      r({ siteSlug: 'c', mode: 'advisory', outcome: 'parse_error' }),
    ];
    expect(runHarnessExitCodePure(results, 'blocking', true)).toBe(0);
  });

  it('Given gating enabled + mode=blocking / When mixed blocking pass + one blocking fail / Then exit 1', () => {
    const results = [
      r({ siteSlug: 'a', mode: 'blocking', outcome: 'pass' }),
      r({ siteSlug: 'b', mode: 'blocking', outcome: 'fail' }),
      r({ siteSlug: 'c', mode: 'advisory', outcome: 'pass' }),
    ];
    expect(runHarnessExitCodePure(results, 'blocking', true)).toBe(1);
  });

  it('Given empty result set / Then exit 0 regardless of gating', () => {
    expect(runHarnessExitCodePure([], 'blocking', true)).toBe(0);
    expect(runHarnessExitCodePure([], 'full', true)).toBe(0);
    expect(runHarnessExitCodePure([], 'blocking', false)).toBe(0);
  });
});
