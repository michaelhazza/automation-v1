import { describe, it, expect } from 'vitest';
import {
  estimateSandboxCostCents,
  isWallClockCeilingTripped,
  isCostCeilingTripped,
  classifyCeilingTransition,
} from '../sandboxCeilingMonitorPure.js';

describe('estimateSandboxCostCents', () => {
  it('returns 0 for 0 elapsed ms', () => {
    expect(estimateSandboxCostCents(0, 0.01)).toBe(0);
  });

  it('computes correct estimate for 1 second at 0.01 cents/s', () => {
    // 1000ms / 1000 * 0.01 = 0.01
    expect(estimateSandboxCostCents(1_000, 0.01)).toBeCloseTo(0.01);
  });

  it('computes correct estimate for 60 seconds at 0.00042 cents/s', () => {
    // 60000ms / 1000 * 0.00042 = 0.0252
    expect(estimateSandboxCostCents(60_000, 0.00042)).toBeCloseTo(0.0252);
  });

  it('scales linearly with elapsed time', () => {
    const rate = 0.5;
    const t1 = estimateSandboxCostCents(1_000, rate);
    const t2 = estimateSandboxCostCents(2_000, rate);
    expect(t2).toBeCloseTo(t1 * 2);
  });

  it('returns 0 for negative elapsedMs', () => {
    expect(estimateSandboxCostCents(-100, 0.01)).toBe(0);
  });

  it('returns 0 for negative maxCostCentsPerSecond', () => {
    expect(estimateSandboxCostCents(1_000, -0.01)).toBe(0);
  });

  it('returns 0 for both zero', () => {
    expect(estimateSandboxCostCents(0, 0)).toBe(0);
  });

  it('handles very small rates (e2b cpu-small class)', () => {
    // 30 minutes at cpu-small worst-case
    const thirtyMinMs = 30 * 60 * 1000;
    const rate = 0.00042;
    const result = estimateSandboxCostCents(thirtyMinMs, rate);
    // 1800 * 0.00042 = 0.756
    expect(result).toBeCloseTo(0.756, 3);
  });

  it('handles large elapsed time (120 minutes)', () => {
    const twoHoursMs = 120 * 60 * 1000;
    const result = estimateSandboxCostCents(twoHoursMs, 0.01);
    // 7200 * 0.01 = 72
    expect(result).toBeCloseTo(72);
  });
});

describe('isWallClockCeilingTripped', () => {
  it('returns false when elapsed is below ceiling', () => {
    expect(isWallClockCeilingTripped(59_000, 60_000)).toBe(false);
  });

  it('returns true when elapsed equals ceiling', () => {
    expect(isWallClockCeilingTripped(60_000, 60_000)).toBe(true);
  });

  it('returns true when elapsed exceeds ceiling', () => {
    expect(isWallClockCeilingTripped(61_000, 60_000)).toBe(true);
  });

  it('returns false for zero elapsed with non-zero ceiling', () => {
    expect(isWallClockCeilingTripped(0, 5_000)).toBe(false);
  });

  it('returns true for any elapsed when ceiling is 0', () => {
    expect(isWallClockCeilingTripped(1, 0)).toBe(true);
  });
});

describe('isCostCeilingTripped', () => {
  it('returns false when estimated cost is below ceiling', () => {
    expect(isCostCeilingTripped(0.009, 0.01)).toBe(false);
  });

  it('returns true when estimated cost equals ceiling', () => {
    expect(isCostCeilingTripped(0.01, 0.01)).toBe(true);
  });

  it('returns true when estimated cost exceeds ceiling', () => {
    expect(isCostCeilingTripped(0.015, 0.01)).toBe(true);
  });

  it('returns false for zero cost with positive ceiling', () => {
    expect(isCostCeilingTripped(0, 100)).toBe(false);
  });

  it('returns true for any positive cost when ceiling is 0', () => {
    expect(isCostCeilingTripped(0.001, 0)).toBe(true);
  });
});

// Regression guard for Phase 3 chatgpt-pr-review R2-F1 — the DB CHECK
// constraint `sandbox_executions_running_harvesting_needs_provider_id` rejects
// transitions to `running` or `harvesting` without a non-null provider_sandbox_id.
// classifyCeilingTransition is the single point of truth that callers consult
// before issuing a transition write; this suite encodes the legal matrix.
describe('classifyCeilingTransition', () => {
  it('running + non-null provider id + timed_out → harvesting (timed_out)', () => {
    expect(classifyCeilingTransition('running', 'prov-abc', 'timed_out')).toEqual({
      kind: 'harvesting',
      reason: 'timed_out',
    });
  });

  it('running + non-null provider id + cost_ceiling_hit → harvesting (cost_ceiling_hit)', () => {
    expect(
      classifyCeilingTransition('running', 'prov-xyz', 'cost_ceiling_hit'),
    ).toEqual({
      kind: 'harvesting',
      reason: 'cost_ceiling_hit',
    });
  });

  it('pending + null provider id + timed_out → start_failed (provider_unavailable)', () => {
    expect(classifyCeilingTransition('pending', null, 'timed_out')).toEqual({
      kind: 'start_failed',
      terminalStatus: 'provider_unavailable',
      errorReason: 'sandbox_provider_unavailable',
    });
  });

  it('pending + null provider id + cost_ceiling_hit → start_failed (provider_unavailable)', () => {
    expect(classifyCeilingTransition('pending', null, 'cost_ceiling_hit')).toEqual({
      kind: 'start_failed',
      terminalStatus: 'provider_unavailable',
      errorReason: 'sandbox_provider_unavailable',
    });
  });

  it('harvesting + any provider id → noop (already in flight)', () => {
    expect(classifyCeilingTransition('harvesting', 'prov-abc', 'timed_out'))
      .toEqual({ kind: 'noop', rationale: 'already_harvesting' });
    expect(classifyCeilingTransition('harvesting', null, 'cost_ceiling_hit'))
      .toEqual({ kind: 'noop', rationale: 'already_harvesting' });
  });

  it('running + null provider id → noop (anomalous; CHECK would block harvesting)', () => {
    // This shape should never reach the DB (paired CHECK rejects it on write),
    // but if it ever does, the classifier MUST refuse to flip to harvesting —
    // routing to start_failed would be wrong (the row claimed running already).
    expect(classifyCeilingTransition('running', null, 'timed_out')).toEqual({
      kind: 'noop',
      rationale: 'unexpected_state',
    });
  });

  it('pending + non-null provider id → noop (anomalous; CHECK would block pending)', () => {
    // The paired `provider_sandbox_id_not_pending` CHECK rejects this shape on
    // write. Defensive: classifier returns noop rather than guessing intent.
    expect(classifyCeilingTransition('pending', 'prov-abc', 'cost_ceiling_hit'))
      .toEqual({ kind: 'noop', rationale: 'unexpected_state' });
  });

  it('terminal states return noop (defensive — caller should have short-circuited)', () => {
    for (const status of [
      'completed',
      'timed_out',
      'cost_ceiling_hit',
      'crashed',
      'output_validation_failed',
      'harvest_failed',
      'artefact_upload_failed',
      'provider_unavailable',
    ]) {
      expect(classifyCeilingTransition(status, 'prov-abc', 'timed_out').kind).toBe('noop');
      expect(classifyCeilingTransition(status, null, 'cost_ceiling_hit').kind).toBe('noop');
    }
  });
});
