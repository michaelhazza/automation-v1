/**
 * promotePolicyPure.test.ts — Pure function tests for the shadow-to-live promotion flow.
 *
 * Covers:
 *   - Version-increment math (incrementPolicyVersion)
 *   - Drift-detection logic (current version vs stored version)
 *   - Mode-flip state machine (resolvePromotionTransition)
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/promotePolicyPure.test.ts
 *
 * Spec: tasks/builds/agentic-commerce/spec.md §12 (Shadow-to-live promotion)
 * Plan: tasks/builds/agentic-commerce/plan.md § Chunk 15
 * Invariants: 29
 */

import { expect, test, describe } from 'vitest';
import {
  incrementPolicyVersion,
  resolvePromotionTransition,
} from '../spendingBudgetServicePure.js';

// ---------------------------------------------------------------------------
// incrementPolicyVersion
// ---------------------------------------------------------------------------

describe('incrementPolicyVersion', () => {
  test('increments version by exactly 1', () => {
    expect(incrementPolicyVersion(1)).toBe(2);
    expect(incrementPolicyVersion(5)).toBe(6);
    expect(incrementPolicyVersion(100)).toBe(101);
  });

  test('handles version starting at 1 (initial policy)', () => {
    expect(incrementPolicyVersion(1)).toBe(2);
  });

  test('handles large version numbers without overflow', () => {
    expect(incrementPolicyVersion(999999)).toBe(1000000);
  });
});

// ---------------------------------------------------------------------------
// drift-detection logic — version comparison
//
// The promoteToLive service reads the requestedVersion from action metadata
// and compares against the current policy version. This pure helper models
// whether drift has occurred.
// ---------------------------------------------------------------------------

function hasDrift(requestedVersion: number | null, currentVersion: number): boolean {
  if (requestedVersion === null) return false; // no version stored — no drift check possible
  return requestedVersion !== currentVersion;
}

describe('drift detection', () => {
  test('no drift when versions match', () => {
    expect(hasDrift(1, 1)).toBe(false);
    expect(hasDrift(5, 5)).toBe(false);
  });

  test('drift detected when policy updated after promotion was requested', () => {
    expect(hasDrift(1, 2)).toBe(true);
    expect(hasDrift(3, 4)).toBe(true);
  });

  test('no drift check when requestedVersion is null (missing metadata)', () => {
    expect(hasDrift(null, 1)).toBe(false);
    expect(hasDrift(null, 99)).toBe(false);
  });

  test('drift detected even when version jumps multiple steps', () => {
    expect(hasDrift(1, 5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolvePromotionTransition — mode-flip state machine
// ---------------------------------------------------------------------------

describe('resolvePromotionTransition', () => {
  test('shadow → live transition is valid', () => {
    const result = resolvePromotionTransition('shadow');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.newMode).toBe('live');
    }
  });

  test('live → live transition is invalid (already_live)', () => {
    const result = resolvePromotionTransition('live');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('already_live');
    }
  });

  test('shadow promotion yields exactly live (no intermediate states)', () => {
    const result = resolvePromotionTransition('shadow');
    if (result.valid) {
      expect(result.newMode).toBe('live');
      // Verify no unexpected mode values.
      expect(['live'].includes(result.newMode)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Atomicity invariant: version increment follows mode flip
//
// The promoteToLive service performs both updates atomically in one UPDATE.
// These tests verify the pure-math invariants hold:
//   - After promotion, mode must be 'live'
//   - After promotion, version must be exactly currentVersion + 1
// ---------------------------------------------------------------------------

describe('promotion atomicity invariants', () => {
  test('mode flip and version increment are consistent', () => {
    const currentVersion = 3;
    const currentMode = 'shadow';

    const transitionResult = resolvePromotionTransition(currentMode);
    expect(transitionResult.valid).toBe(true);

    const newVersion = incrementPolicyVersion(currentVersion);
    expect(newVersion).toBe(currentVersion + 1);

    if (transitionResult.valid) {
      expect(transitionResult.newMode).toBe('live');
    }
  });

  test('already-live policy rejects promotion before version increment', () => {
    const currentMode = 'live';
    const transitionResult = resolvePromotionTransition(currentMode);
    // If transition is invalid, version increment should not happen.
    expect(transitionResult.valid).toBe(false);
  });
});
