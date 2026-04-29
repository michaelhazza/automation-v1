/**
 * scopeResolutionPure.test.ts — pure-unit tests for shouldSearchEntityHint.
 *
 * Spec §6.5, §12.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/scopeResolutionPure.test.ts
 */
import { strict as assert } from 'node:assert';
import { shouldSearchEntityHint } from '../scopeResolutionPure.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(err);
  }
}

test('empty string returns false', () => {
  assert.equal(shouldSearchEntityHint(''), false);
});

test('whitespace-only returns false', () => {
  assert.equal(shouldSearchEntityHint('   '), false);
});

test('single character returns false', () => {
  assert.equal(shouldSearchEntityHint('a'), false);
});

test('single character padded with whitespace returns false', () => {
  assert.equal(shouldSearchEntityHint(' a '), false);
});

test('two characters returns true', () => {
  assert.equal(shouldSearchEntityHint('ab'), true);
});

test('longer hint returns true', () => {
  assert.equal(shouldSearchEntityHint('Acme'), true);
});

test('two characters with surrounding whitespace returns true', () => {
  assert.equal(shouldSearchEntityHint('  ab  '), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
