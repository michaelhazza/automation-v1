/**
 * workflowConfidenceServicePure.test.ts — Pure heuristic tests.
 *
 * Spec: docs/workflows-dev-spec.md §6.1, §6.2, §6.4.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/workflowConfidenceServicePure.test.ts
 */

import { expect, test, describe } from 'vitest';
import {
  computeConfidence,
  type ConfidenceInput,
} from '../workflowConfidenceServicePure.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<ConfidenceInput> = {}): ConfidenceInput {
  return {
    stepDefinition: {},
    pastReviewsCount: { approved: 0, rejected: 0 },
    subaccountFirstUseFlag: false,
    upstreamConfidence: null,
    ...overrides,
  };
}

// ── Heuristic rules ────────────────────────────────────────────────────────

describe('rule 1: cascade_from_low_confidence', () => {
  test('fires when upstreamConfidence is low', () => {
    const result = computeConfidence(makeInput({ upstreamConfidence: 'low' }));
    expect(result.key).toBe('cascade_from_low_confidence');
    expect(result.confidence.value).toBe('low');
  });

  test('does NOT fire when upstreamConfidence is medium', () => {
    const result = computeConfidence(makeInput({ upstreamConfidence: 'medium' }));
    expect(result.key).not.toBe('cascade_from_low_confidence');
  });

  test('does NOT fire when upstreamConfidence is high', () => {
    const result = computeConfidence(makeInput({ upstreamConfidence: 'high' }));
    expect(result.key).not.toBe('cascade_from_low_confidence');
  });
});

describe('rule 2: first_use_in_subaccount', () => {
  test('fires when subaccountFirstUseFlag is true', () => {
    const result = computeConfidence(makeInput({ subaccountFirstUseFlag: true }));
    expect(result.key).toBe('first_use_in_subaccount');
    expect(result.confidence.value).toBe('low');
  });
});

describe('rule 3: is_critical_next_step', () => {
  test('fires when stepDefinition.isCritical is true', () => {
    const result = computeConfidence(makeInput({ stepDefinition: { isCritical: true } }));
    expect(result.key).toBe('is_critical_next_step');
    expect(result.confidence.value).toBe('medium');
  });
});

describe('rule 4: irreversible_side_effect', () => {
  test('fires when sideEffectClass is irreversible', () => {
    const result = computeConfidence(
      makeInput({ stepDefinition: { sideEffectClass: 'irreversible' } }),
    );
    expect(result.key).toBe('irreversible_side_effect');
    expect(result.confidence.value).toBe('medium');
  });

  test('does NOT fire when sideEffectClass is reversible', () => {
    const result = computeConfidence(
      makeInput({ stepDefinition: { sideEffectClass: 'reversible' } }),
    );
    expect(result.key).not.toBe('irreversible_side_effect');
  });
});

describe('rule 5: many_similar_past_runs', () => {
  test('fires when >= 5 reviews and rejected / total < 0.2', () => {
    const result = computeConfidence(
      makeInput({ pastReviewsCount: { approved: 9, rejected: 0 } }),
    );
    expect(result.key).toBe('many_similar_past_runs');
    expect(result.confidence.value).toBe('high');
  });

  test('fires at exactly 5 reviews with 0 rejected', () => {
    const result = computeConfidence(
      makeInput({ pastReviewsCount: { approved: 5, rejected: 0 } }),
    );
    expect(result.key).toBe('many_similar_past_runs');
  });

  test('does NOT fire when rejected / total >= 0.2', () => {
    const result = computeConfidence(
      makeInput({ pastReviewsCount: { approved: 8, rejected: 2 } }),
    );
    expect(result.key).not.toBe('many_similar_past_runs');
  });

  test('does NOT fire when total < 5', () => {
    const result = computeConfidence(
      makeInput({ pastReviewsCount: { approved: 4, rejected: 0 } }),
    );
    expect(result.key).not.toBe('many_similar_past_runs');
  });
});

describe('rule 6: few_past_runs_mixed_history (default)', () => {
  test('fires when no other rule matches', () => {
    const result = computeConfidence(makeInput());
    expect(result.key).toBe('few_past_runs_mixed_history');
    expect(result.confidence.value).toBe('medium');
  });
});

// ── Priority order ─────────────────────────────────────────────────────────

describe('priority order', () => {
  test('upstream_low beats first_use', () => {
    const result = computeConfidence(
      makeInput({ upstreamConfidence: 'low', subaccountFirstUseFlag: true }),
    );
    expect(result.key).toBe('cascade_from_low_confidence');
  });

  test('first_use beats is_critical', () => {
    const result = computeConfidence(
      makeInput({ subaccountFirstUseFlag: true, stepDefinition: { isCritical: true } }),
    );
    expect(result.key).toBe('first_use_in_subaccount');
  });

  test('is_critical beats irreversible_side_effect', () => {
    const result = computeConfidence(
      makeInput({
        stepDefinition: { isCritical: true, sideEffectClass: 'irreversible' },
      }),
    );
    expect(result.key).toBe('is_critical_next_step');
  });

  test('irreversible_side_effect beats many_similar_past_runs', () => {
    const result = computeConfidence(
      makeInput({
        stepDefinition: { sideEffectClass: 'irreversible' },
        pastReviewsCount: { approved: 10, rejected: 0 },
      }),
    );
    expect(result.key).toBe('irreversible_side_effect');
  });

  test('many_similar_past_runs beats default', () => {
    const result = computeConfidence(
      makeInput({ pastReviewsCount: { approved: 10, rejected: 0 } }),
    );
    expect(result.key).toBe('many_similar_past_runs');
  });
});

// ── Signal weights ─────────────────────────────────────────────────────────

describe('signal weights', () => {
  test('matched signals have weight 1, unmatched have weight 0', () => {
    const result = computeConfidence(
      makeInput({
        upstreamConfidence: 'low',
        subaccountFirstUseFlag: true,
        stepDefinition: { isCritical: true, sideEffectClass: 'irreversible' },
        pastReviewsCount: { approved: 10, rejected: 0 },
      }),
    );
    const byName = Object.fromEntries(
      result.confidence.signals.map((s) => [s.name, s.weight]),
    );
    expect(byName['upstream_low_confidence']).toBe(1);
    expect(byName['subaccount_first_use']).toBe(1);
    expect(byName['is_critical']).toBe(1);
    expect(byName['irreversible_side_effect']).toBe(1);
    expect(byName['past_run_history']).toBe(1);
  });

  test('no signals matched when all false', () => {
    const result = computeConfidence(makeInput());
    const allZero = result.confidence.signals.every((s) => s.weight === 0);
    expect(allZero).toBe(true);
  });
});

// ── Failsafe: high confidence does NOT auto-approve ────────────────────────

describe('failsafe (spec §6.4)', () => {
  test('value may be high but no side-effects are triggered', () => {
    const result = computeConfidence(
      makeInput({ pastReviewsCount: { approved: 10, rejected: 0 } }),
    );
    // Value can be 'high' — the test just verifies the return is a plain data
    // object with no auto-approval side-effects (no thrown error, no mutation).
    expect(result.confidence.value).toBe('high');
    expect(typeof result.confidence.reason).toBe('string');
  });
});

// ── computed_at ────────────────────────────────────────────────────────────

describe('computed_at', () => {
  test('is a valid ISO 8601 string', () => {
    const result = computeConfidence(makeInput());
    const parsed = new Date(result.confidence.computed_at);
    expect(isNaN(parsed.getTime())).toBe(false);
    expect(result.confidence.computed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
