/**
 * ruleCapturePolicyPure.test.ts
 *
 * Run via:
 *   npx tsx server/services/__tests__/ruleCapturePolicyPure.test.ts
 */

import {
  shouldAutoPauseRulePure,
  AUTO_PAUSE_CONFIDENCE_THRESHOLD,
} from '../ruleCapturePolicyPure.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

// ══════════════════════════════════════════════════════════════════════════════

test('no origin + no confidence → active (not paused)', () => {
  assert(!shouldAutoPauseRulePure({}), 'expected not paused');
});

test('originatingArtefactId present → paused', () => {
  assert(shouldAutoPauseRulePure({ originatingArtefactId: 'art-1' }), 'expected paused');
});

test('empty-string originatingArtefactId → not paused (treated as absent)', () => {
  assert(!shouldAutoPauseRulePure({ originatingArtefactId: '' }), 'expected not paused');
});

test('null originatingArtefactId → not paused', () => {
  assert(!shouldAutoPauseRulePure({ originatingArtefactId: null }), 'expected not paused');
});

test('confidence below threshold → paused', () => {
  assert(shouldAutoPauseRulePure({ confidence: 0.5 }), 'expected paused');
  assert(shouldAutoPauseRulePure({ confidence: 0.79 }), 'expected paused');
});

test('confidence exactly at threshold → NOT paused (threshold is exclusive lower bound)', () => {
  assert(
    !shouldAutoPauseRulePure({ confidence: AUTO_PAUSE_CONFIDENCE_THRESHOLD }),
    'expected not paused at 0.8',
  );
});

test('confidence above threshold → not paused', () => {
  assert(!shouldAutoPauseRulePure({ confidence: 0.9 }), 'expected not paused');
  assert(!shouldAutoPauseRulePure({ confidence: 1.0 }), 'expected not paused');
});

test('confidence null → no signal, not paused', () => {
  assert(!shouldAutoPauseRulePure({ confidence: null }), 'expected not paused');
});

test('originatingArtefactId takes precedence when confidence is high', () => {
  assert(
    shouldAutoPauseRulePure({ originatingArtefactId: 'art-1', confidence: 0.99 }),
    'origin pauses even with high confidence',
  );
});

test('both signals fire together → paused (logical OR)', () => {
  assert(
    shouldAutoPauseRulePure({ originatingArtefactId: 'art-1', confidence: 0.3 }),
    'both trigger pause',
  );
});

// ══════════════════════════════════════════════════════════════════════════════

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
