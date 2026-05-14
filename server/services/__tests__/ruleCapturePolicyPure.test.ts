/**
 * ruleCapturePolicyPure.test.ts
 *
 * Run via:
 *   npx tsx server/services/__tests__/ruleCapturePolicyPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  shouldAutoPauseRulePure,
  AUTO_PAUSE_CONFIDENCE_THRESHOLD,
} from '../ruleCapturePolicyPure.js';

// ══════════════════════════════════════════════════════════════════════════════

test('no origin + no confidence → active (not paused)', () => {
  expect(!shouldAutoPauseRulePure({}), 'expected not paused').toBeTruthy();
});

test('originatingArtefactId present → paused', () => {
  expect(shouldAutoPauseRulePure({ originatingArtefactId: 'art-1' }), 'expected paused').toBeTruthy();
});

test('empty-string originatingArtefactId → not paused (treated as absent)', () => {
  expect(!shouldAutoPauseRulePure({ originatingArtefactId: '' }), 'expected not paused').toBeTruthy();
});

test('null originatingArtefactId → not paused', () => {
  expect(!shouldAutoPauseRulePure({ originatingArtefactId: null }), 'expected not paused').toBeTruthy();
});

test('confidence below threshold → paused', () => {
  expect(shouldAutoPauseRulePure({ confidence: 0.5 }), 'expected paused').toBeTruthy();
  expect(shouldAutoPauseRulePure({ confidence: 0.79 }), 'expected paused').toBeTruthy();
});

test('confidence exactly at threshold → NOT paused (threshold is exclusive lower bound)', () => {
  expect(!shouldAutoPauseRulePure({ confidence: AUTO_PAUSE_CONFIDENCE_THRESHOLD }), 'expected not paused at 0.8').toBeTruthy();
});

test('confidence above threshold → not paused', () => {
  expect(!shouldAutoPauseRulePure({ confidence: 0.9 }), 'expected not paused').toBeTruthy();
  expect(!shouldAutoPauseRulePure({ confidence: 1.0 }), 'expected not paused').toBeTruthy();
});

test('confidence null → no signal, not paused', () => {
  expect(!shouldAutoPauseRulePure({ confidence: null }), 'expected not paused').toBeTruthy();
});

test('originatingArtefactId takes precedence when confidence is high', () => {
  expect(shouldAutoPauseRulePure({ originatingArtefactId: 'art-1', confidence: 0.99 }), 'origin pauses even with high confidence').toBeTruthy();
});

test('both signals fire together → paused (logical OR)', () => {
  expect(shouldAutoPauseRulePure({ originatingArtefactId: 'art-1', confidence: 0.3 }), 'both trigger pause').toBeTruthy();
});

// ══════════════════════════════════════════════════════════════════════════════

console.log('');
