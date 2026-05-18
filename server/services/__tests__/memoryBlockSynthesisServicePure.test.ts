/**
 * memoryBlockSynthesisServicePure.test.ts — scoring + tier + passive-age + promotion
 *
 * Spec: docs/memory-and-briefings-spec.md §5.7 (S11), §6 Phase 4, §9.3, §9.4, §14.7
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/memoryBlockSynthesisServicePure.test.ts
 */

import { expect, test } from 'vitest';
import {
  scoreCluster,
  decideTier,
  passiveAgeDecision,
  SYNTHESIS_MIN_CLUSTER_SIZE,
  PASSIVE_AGE_CYCLES,
  HIGH_CONFIDENCE_THRESHOLD,
  MEDIUM_CONFIDENCE_THRESHOLD,
} from '../memoryBlockSynthesisServicePure.js';
import { evaluatePromotion } from '../memoryBlockSynthesisService.js';
import { MEMORY_CONSOLIDATION_CONFIG_HISTORY } from '../../config/memoryConsolidationConfig.js';

function assertEqual<T>(a: T, b: T, label: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

console.log('');
console.log('memoryBlockSynthesisServicePure — synthesis decisions (§5.7 S11)');
console.log('');

// ---------------------------------------------------------------------------
// scoreCluster
// ---------------------------------------------------------------------------

console.log('scoreCluster:');

test('below min size → 0', () => {
  const c = scoreCluster({
    size: SYNTHESIS_MIN_CLUSTER_SIZE - 1,
    avgQuality: 1,
    avgCitedCount: 5,
    coherence: 1,
  });
  expect(c, 'zero').toBe(0);
});

test('perfect cluster → ~1.0', () => {
  const c = scoreCluster({
    size: SYNTHESIS_MIN_CLUSTER_SIZE,
    avgQuality: 1,
    avgCitedCount: 10,
    coherence: 1,
  });
  expect(c >= HIGH_CONFIDENCE_THRESHOLD, `score ${c} should cross high threshold`).toBe(true);
});

test('weak cluster → low tier', () => {
  const c = scoreCluster({
    size: SYNTHESIS_MIN_CLUSTER_SIZE,
    avgQuality: 0.4,
    avgCitedCount: 0,
    coherence: 0.3,
  });
  expect(c < MEDIUM_CONFIDENCE_THRESHOLD, `weak → ${c} should be below medium`).toBe(true);
});

// ---------------------------------------------------------------------------
// decideTier
// ---------------------------------------------------------------------------

console.log('decideTier:');

test('>= high → high', () => {
  expect(decideTier(HIGH_CONFIDENCE_THRESHOLD), 'at boundary').toBe('high');
  expect(decideTier(0.95), 'above').toBe('high');
});

test('medium band', () => {
  expect(decideTier(MEDIUM_CONFIDENCE_THRESHOLD), 'at lower boundary').toBe('medium');
  expect(decideTier(0.7), 'mid-band').toBe('medium');
});

test('below medium → low', () => {
  expect(decideTier(MEDIUM_CONFIDENCE_THRESHOLD - 0.01), 'below medium').toBe('low');
  expect(decideTier(0), 'floor').toBe('low');
});

// ---------------------------------------------------------------------------
// passiveAgeDecision
// ---------------------------------------------------------------------------

console.log('passiveAgeDecision:');

test('draft survived cycles → activate', () => {
  const d = passiveAgeDecision({ cycles: PASSIVE_AGE_CYCLES, status: 'draft' });
  expect(d.shouldActivate, 'activate').toBe(true);
});

test('draft under cycle count → stay', () => {
  const d = passiveAgeDecision({ cycles: PASSIVE_AGE_CYCLES - 1, status: 'draft' });
  expect(d.shouldActivate, 'not yet').toBe(false);
});

test('active block → no-op', () => {
  const d = passiveAgeDecision({ cycles: 10, status: 'active' });
  expect(d.shouldActivate, 'already active').toBe(false);
});

test('rejected block → no-op', () => {
  const d = passiveAgeDecision({ cycles: 10, status: 'rejected' });
  expect(d.shouldActivate, 'rejected does not activate').toBe(false);
});

test('pending_review block → no passive age', () => {
  const d = passiveAgeDecision({ cycles: 10, status: 'pending_review' });
  expect(d.shouldActivate, 'pending_review stays').toBe(false);
});

// ---------------------------------------------------------------------------
// evaluatePromotion (§6 Phase 4, §9.3, §9.4, §14.7)
// ---------------------------------------------------------------------------

const v1Config = MEMORY_CONSOLIDATION_CONFIG_HISTORY[0];

test('working with high signals → auto promotion to episodic', () => {
  // totalScore = 10*0.5 + 5*0.3 + 0.8*0.2 = 6.66 > threshold 3.0
  const verdict = evaluatePromotion(
    'working',
    { reinforcementCount: 10, crossSessionRecurrence: 5, recency: 0.8 },
    v1Config,
  );
  expect(verdict.shouldPromote).toBe(true);
  if (verdict.shouldPromote) {
    expect(verdict.nextTier).toBe('episodic');
    expect(verdict.mode).toBe('auto');
  }
});

test('episodic with mid signals → auto promotion to semantic', () => {
  // totalScore = 12*0.5 + 8*0.3 + 0.5*0.2 = 8.5, >= 8.0 but < 15.0 → semantic
  const verdict = evaluatePromotion(
    'episodic',
    { reinforcementCount: 12, crossSessionRecurrence: 8, recency: 0.5 },
    v1Config,
  );
  expect(verdict.shouldPromote).toBe(true);
  if (verdict.shouldPromote) {
    expect(verdict.nextTier).toBe('semantic');
    expect(verdict.mode).toBe('auto');
  }
});

test('episodic with high signals → operator-approved promotion to procedural', () => {
  // totalScore = 26*0.5 + 8*0.3 + 0.5*0.2 = 15.5 >= 15.0 → procedural (checked first)
  const verdict = evaluatePromotion(
    'episodic',
    { reinforcementCount: 26, crossSessionRecurrence: 8, recency: 0.5 },
    v1Config,
  );
  expect(verdict.shouldPromote).toBe(true);
  if (verdict.shouldPromote) {
    expect(verdict.nextTier).toBe('procedural');
    expect(verdict.mode).toBe('operator-approved');
  }
});

test('semantic with high signals → operator-approved promotion to procedural', () => {
  // totalScore = 26*0.5 + 8*0.3 + 0.5*0.2 = 15.5 >= 15.0
  const verdict = evaluatePromotion(
    'semantic',
    { reinforcementCount: 26, crossSessionRecurrence: 8, recency: 0.5 },
    v1Config,
  );
  expect(verdict.shouldPromote).toBe(true);
  if (verdict.shouldPromote) {
    expect(verdict.nextTier).toBe('procedural');
    expect(verdict.mode).toBe('operator-approved');
  }
});

test('procedural → already_top_tier', () => {
  const verdict = evaluatePromotion(
    'procedural',
    { reinforcementCount: 100, crossSessionRecurrence: 100, recency: 1.0 },
    v1Config,
  );
  expect(verdict.shouldPromote).toBe(false);
  if (!verdict.shouldPromote) {
    expect(verdict.reason).toBe('already_top_tier');
  }
});

test('working with low signals → below_threshold', () => {
  // totalScore = 1*0.5 + 1*0.3 + 0.0*0.2 = 0.8 < 3.0
  const verdict = evaluatePromotion(
    'working',
    { reinforcementCount: 1, crossSessionRecurrence: 1, recency: 0.0 },
    v1Config,
  );
  expect(verdict.shouldPromote).toBe(false);
  if (!verdict.shouldPromote) {
    expect(verdict.reason).toBe('below_threshold');
  }
});

test('episodic with low signals → below_threshold', () => {
  // totalScore = 5*0.5 + 5*0.3 + 0.5*0.2 = 4.1 < 8.0
  const verdict = evaluatePromotion(
    'episodic',
    { reinforcementCount: 5, crossSessionRecurrence: 5, recency: 0.5 },
    v1Config,
  );
  expect(verdict.shouldPromote).toBe(false);
  if (!verdict.shouldPromote) {
    expect(verdict.reason).toBe('below_threshold');
  }
});

test('configVersion passes through in verdict', () => {
  // totalScore = 10*0.5 + 5*0.3 + 0.8*0.2 = 6.66 > 3.0
  const verdict = evaluatePromotion(
    'working',
    { reinforcementCount: 10, crossSessionRecurrence: 5, recency: 0.8 },
    v1Config,
  );
  expect(verdict.shouldPromote).toBe(true);
  if (verdict.shouldPromote) {
    expect(verdict.configVersion).toBe(1);
  }
});

console.log('');
console.log('');
