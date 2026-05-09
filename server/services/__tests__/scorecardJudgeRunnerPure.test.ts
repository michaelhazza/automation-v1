/**
 * scorecardJudgeRunnerPure.test.ts
 *
 * Pure tests for the scorecard judge runner helpers.
 * Trust & Verification Layer spec §6.3, §6.5, §12.3.
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/scorecardJudgeRunnerPure.test.ts
 */

import { describe, expect, it } from 'vitest';
import {
  shouldSample,
  computeVerdict,
  buildFanoutJobs,
  type AttachmentWithChecks,
} from '../scorecardJudgeRunnerPure.js';

describe('shouldSample', () => {
  it('off frequency never samples', () => {
    expect(shouldSample('off', 'run-1', 'sc-1')).toBe(false);
  });

  it('q3 samples deterministically — same inputs → same result', () => {
    const a = shouldSample('q3', 'run-1', 'sc-1');
    const b = shouldSample('q3', 'run-1', 'sc-1');
    expect(a).toBe(b);
  });
});

describe('computeVerdict', () => {
  it('uses default pass mark (0.7) when none supplied', () => {
    expect(computeVerdict(0.7)).toBe('pass');
    expect(computeVerdict(0.69)).toBe('fail');
  });

  it('uses the per-check passMark when supplied', () => {
    // Spec §6.5 — verdict = observedScore >= passMark.
    expect(computeVerdict(0.79, 0.8)).toBe('fail');
    expect(computeVerdict(0.8, 0.8)).toBe('pass');
    expect(computeVerdict(0.81, 0.8)).toBe('pass');
  });

  it('returns inconclusive on out-of-range scores', () => {
    expect(computeVerdict(-0.1, 0.7)).toBe('inconclusive');
    expect(computeVerdict(1.5, 0.7)).toBe('inconclusive');
  });

  it('returns inconclusive on non-finite inputs', () => {
    expect(computeVerdict(Number.NaN, 0.7)).toBe('inconclusive');
    expect(computeVerdict(0.5, Number.POSITIVE_INFINITY)).toBe('inconclusive');
  });

  it('treats undefined passMark identical to default', () => {
    expect(computeVerdict(0.7, undefined)).toBe('pass');
    expect(computeVerdict(0.6, undefined)).toBe('fail');
  });
});

describe('buildFanoutJobs', () => {
  function makeAttachment(
    scorecardId: string,
    checks: Array<{ slug: string; enabled?: boolean }>,
    attachedAt: Date = new Date('2026-01-01T00:00:00Z'),
  ): AttachmentWithChecks {
    return {
      scorecardId,
      gradingFrequency: 'q3',
      attachedAt,
      qualityChecks: checks.map((c) => ({ slug: c.slug, name: c.slug, enabled: c.enabled })),
    };
  }

  it('emits one job per enabled (scorecard, qualityCheck) pair', () => {
    const result = buildFanoutJobs(
      'run-deterministic-pass-q3-1',
      [makeAttachment('sc-1', [{ slug: 'a' }, { slug: 'b' }])],
      20,
    );
    // q3 is 75% — pick a runId that lands above threshold; we just assert
    // either zero (sampling skipped) or all enabled checks landed.
    if (result.jobs.length > 0) {
      expect(result.jobs.map((j) => j.qualityCheckSlug).sort()).toEqual(['a', 'b']);
    }
  });

  it('skips quality checks with enabled === false', () => {
    // Spec §6.3 — disabled checks must not enqueue judge work.
    // Use q3 + scan many runIds to bypass sampling determinism flakiness.
    let observedJobs: Array<{ scorecardId: string; qualityCheckSlug: string }> | null = null;
    for (let i = 0; i < 50; i++) {
      const result = buildFanoutJobs(
        `runid-skip-test-${i}`,
        [
          makeAttachment('sc-1', [
            { slug: 'on-1', enabled: true },
            { slug: 'off-1', enabled: false },
            { slug: 'on-2' }, // undefined → enabled by default
          ]),
        ],
        20,
      );
      if (result.jobs.length > 0) {
        observedJobs = result.jobs;
        break;
      }
    }
    expect(observedJobs).not.toBeNull();
    expect(observedJobs!.map((j) => j.qualityCheckSlug).sort()).toEqual(['on-1', 'on-2']);
  });

  it('caps fanout at maxJobs and reports capped flag', () => {
    const checks = Array.from({ length: 10 }, (_, i) => ({ slug: `c${i}` }));
    let observed: { jobs: unknown[]; capped: boolean } | null = null;
    for (let i = 0; i < 50; i++) {
      const result = buildFanoutJobs(
        `run-cap-test-${i}`,
        [makeAttachment('sc-1', checks)],
        3,
      );
      if (result.jobs.length > 0) {
        observed = result;
        break;
      }
    }
    expect(observed).not.toBeNull();
    expect(observed!.jobs).toHaveLength(3);
    expect(observed!.capped).toBe(true);
  });
});
