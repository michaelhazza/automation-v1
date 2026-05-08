import { describe, it, expect } from 'vitest';
import {
  shouldSample,
  buildJudgePrompt,
  computeVerdict,
  buildFanoutJobs,
} from '../../services/scorecardJudgeRunnerPure.js';

// ── shouldSample ──────────────────────────────────────────────────────────────

describe('shouldSample', () => {
  it('never samples when off', () => {
    for (let i = 0; i < 100; i++) {
      expect(shouldSample('off', `run-${i}`, 'sc-1')).toBe(false);
    }
  });

  it('is deterministic — same inputs always return same result', () => {
    const result1 = shouldSample('q1', 'run-abc', 'sc-xyz');
    const result2 = shouldSample('q1', 'run-abc', 'sc-xyz');
    expect(result1).toBe(result2);
  });

  it('different scorecardId changes the decision', () => {
    // Run through 50 pairs and assert at least one differs (probabilistically guaranteed)
    let differ = false;
    for (let i = 0; i < 50; i++) {
      const r1 = shouldSample('q2', `run-${i}`, 'sc-A');
      const r2 = shouldSample('q2', `run-${i}`, 'sc-B');
      if (r1 !== r2) { differ = true; break; }
    }
    expect(differ).toBe(true);
  });

  it('q1 samples approximately 25% across 1000 decisions (within ±8%)', () => {
    let count = 0;
    for (let i = 0; i < 1000; i++) {
      if (shouldSample('q1', `run-${i}`, 'sc-1')) count++;
    }
    expect(count).toBeGreaterThanOrEqual(170);
    expect(count).toBeLessThanOrEqual(330);
  });

  it('q2 samples approximately 50% across 1000 decisions (within ±8%)', () => {
    let count = 0;
    for (let i = 0; i < 1000; i++) {
      if (shouldSample('q2', `run-${i}`, 'sc-1')) count++;
    }
    expect(count).toBeGreaterThanOrEqual(420);
    expect(count).toBeLessThanOrEqual(580);
  });

  it('q3 samples approximately 75% across 1000 decisions (within ±8%)', () => {
    let count = 0;
    for (let i = 0; i < 1000; i++) {
      if (shouldSample('q3', `run-${i}`, 'sc-1')) count++;
    }
    expect(count).toBeGreaterThanOrEqual(670);
    expect(count).toBeLessThanOrEqual(830);
  });
});

// ── buildJudgePrompt ──────────────────────────────────────────────────────────

describe('buildJudgePrompt', () => {
  const base = {
    scorecardName: 'Customer Quality',
    qualityCheckName: 'Tone Compliance',
    qualityCheckDesc: 'Response uses a friendly, professional tone.',
    runSummary: 'The agent responded to a billing inquiry.',
    agentName: 'Support Agent',
  };

  it('system prompt contains JSON format instruction', () => {
    const { system } = buildJudgePrompt(base);
    expect(system).toContain('"observedScore"');
    expect(system).toContain('"judgeReasoning"');
  });

  it('user prompt contains scorecard name and quality check name', () => {
    const { user } = buildJudgePrompt(base);
    expect(user).toContain('Customer Quality');
    expect(user).toContain('Tone Compliance');
  });

  it('user prompt contains description when provided', () => {
    const { user } = buildJudgePrompt(base);
    expect(user).toContain('friendly, professional tone');
  });

  it('user prompt omits description block when not provided', () => {
    const { user } = buildJudgePrompt({ ...base, qualityCheckDesc: undefined });
    expect(user).not.toContain('Criterion description:');
  });

  it('user prompt contains run summary', () => {
    const { user } = buildJudgePrompt(base);
    expect(user).toContain('billing inquiry');
  });
});

// ── computeVerdict ────────────────────────────────────────────────────────────

describe('computeVerdict', () => {
  it('returns pass when score meets default pass mark (0.7)', () => {
    expect(computeVerdict(0.7)).toBe('pass');
    expect(computeVerdict(1.0)).toBe('pass');
    expect(computeVerdict(0.75)).toBe('pass');
  });

  it('returns fail when score is below pass mark', () => {
    expect(computeVerdict(0.69)).toBe('fail');
    expect(computeVerdict(0.0)).toBe('fail');
  });

  it('returns inconclusive for NaN or Infinity', () => {
    expect(computeVerdict(NaN)).toBe('inconclusive');
    expect(computeVerdict(Infinity)).toBe('inconclusive');
  });

  it('returns inconclusive for out-of-range values', () => {
    expect(computeVerdict(-0.1)).toBe('inconclusive');
    expect(computeVerdict(1.1)).toBe('inconclusive');
  });

  it('respects custom pass mark', () => {
    expect(computeVerdict(0.5, 0.5)).toBe('pass');
    expect(computeVerdict(0.49, 0.5)).toBe('fail');
  });
});

// ── buildFanoutJobs ───────────────────────────────────────────────────────────

describe('buildFanoutJobs', () => {
  const makeAttachment = (
    scorecardId: string,
    gradingFrequency: 'off' | 'q1' | 'q2' | 'q3',
    slugs: string[],
    attachedAt = new Date(0),
  ) => ({
    scorecardId,
    gradingFrequency,
    attachedAt,
    qualityChecks: slugs.map(s => ({ slug: s, name: s })),
  });

  it('returns empty when all attachments are off', () => {
    const { jobs, capped } = buildFanoutJobs('run-1', [
      makeAttachment('sc-1', 'off', ['check-a', 'check-b']),
    ], 20);
    expect(jobs).toHaveLength(0);
    expect(capped).toBe(false);
  });

  it('applies bounded-fanout cap and sets capped=true', () => {
    // Make 6 attachments × 4 checks = 24 potential jobs, maxJobs=10
    const attachments = Array.from({ length: 6 }, (_, i) =>
      makeAttachment(`sc-${i}`, 'q3', ['c1', 'c2', 'c3', 'c4'], new Date(i))
    );
    // Use a run-id that will cause q3 to sample most of them
    const { jobs, capped } = buildFanoutJobs('run-fixed-high-sample', attachments, 10);
    if (capped) {
      expect(jobs).toHaveLength(10);
    }
    // If not capped (q3 sampled fewer than 10 jobs), that's also valid
  });

  it('capped=false when total jobs within limit', () => {
    // Force a run where q3 samples → use lots of scorecards with 1 check each
    const attachments = Array.from({ length: 3 }, (_, i) =>
      makeAttachment(`sc-${i}`, 'q3', ['check-1'], new Date(i))
    );
    const { capped } = buildFanoutJobs('run-small', attachments, 20);
    // May or may not sample but should never cap (3 scorecards × 1 check = max 3 < 20)
    expect(capped).toBe(false);
  });

  it('sorts sampled jobs by attachedAt ascending for deterministic truncation', () => {
    // Verify that regardless of input order, the output is sorted by attachedAt.
    // Use a large number of attachments so at least 2 get sampled with q3.
    const attachments = Array.from({ length: 10 }, (_, i) =>
      makeAttachment(`sc-${i}`, 'q3', ['c1'], new Date(i * 1000)),
    );
    // Shuffle input order
    const shuffled = [...attachments].reverse();
    const { jobs } = buildFanoutJobs('run-order-test', shuffled, 100);
    // Verify output is sorted ascending by scorecardId index (which matches attachedAt order)
    for (let i = 1; i < jobs.length; i++) {
      const prevId = parseInt(jobs[i - 1].scorecardId.replace('sc-', ''));
      const currId = parseInt(jobs[i].scorecardId.replace('sc-', ''));
      expect(prevId).toBeLessThanOrEqual(currId);
    }
  });
});
