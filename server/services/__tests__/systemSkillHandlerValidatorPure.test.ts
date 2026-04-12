/**
 * systemSkillHandlerValidatorPure.test.ts — Phase 0 of skill-analyzer-v2.
 *
 * Pure unit tests for the diff helper inside the startup validator. The
 * DB-touching portion of validateSystemSkillHandlers is thin (a single
 * SELECT); the diff logic is the pure kernel that this test exercises.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/systemSkillHandlerValidatorPure.test.ts
 */

import {
  findMissingHandlers,
  SystemSkillHandlerError,
} from '../systemSkillHandlerValidatorPure.js';

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

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertArrEq(actual: string[], expected: string[], label: string) {
  if (actual.length !== expected.length || actual.some((v, i) => v !== expected[i])) {
    throw new Error(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// findMissingHandlers
// ---------------------------------------------------------------------------

test('findMissingHandlers: empty active list returns empty', () => {
  assertArrEq(findMissingHandlers([], ['a', 'b']), [], 'empty active');
});

test('findMissingHandlers: every active key registered → empty', () => {
  assertArrEq(
    findMissingHandlers(['web_search', 'fetch_url'], ['web_search', 'fetch_url', 'extra']),
    [],
    'all registered',
  );
});

test('findMissingHandlers: returns active keys not in registered set', () => {
  assertArrEq(
    findMissingHandlers(['a', 'missing_one', 'b', 'missing_two'], ['a', 'b']),
    ['missing_one', 'missing_two'],
    'two missing',
  );
});

test('findMissingHandlers: preserves active order in result for stable error messages', () => {
  assertArrEq(
    findMissingHandlers(['z', 'a', 'm'], []),
    ['z', 'a', 'm'],
    'order preserved',
  );
});

test('findMissingHandlers: empty registered → every active key is missing', () => {
  assertArrEq(
    findMissingHandlers(['x', 'y', 'z'], []),
    ['x', 'y', 'z'],
    'all missing',
  );
});

test('findMissingHandlers: duplicate active keys both reported', () => {
  // Duplicates would only happen via a UNIQUE-constraint failure, but the
  // pure helper should still handle the case deterministically.
  assertArrEq(
    findMissingHandlers(['x', 'x', 'y'], ['y']),
    ['x', 'x'],
    'duplicates reported',
  );
});

// ---------------------------------------------------------------------------
// SystemSkillHandlerError
// ---------------------------------------------------------------------------

test('SystemSkillHandlerError: message includes every missing handler key', () => {
  const err = new SystemSkillHandlerError(['foo', 'bar', 'baz']);
  if (!err.message.includes('foo')) throw new Error('missing foo in message');
  if (!err.message.includes('bar')) throw new Error('missing bar in message');
  if (!err.message.includes('baz')) throw new Error('missing baz in message');
});

test('SystemSkillHandlerError: stores missingHandlers as a public field', () => {
  const err = new SystemSkillHandlerError(['foo']);
  assertEq(err.missingHandlers.length, 1, 'length');
  assertEq(err.missingHandlers[0], 'foo', 'first key');
});

test('SystemSkillHandlerError: name is set for instanceof checks', () => {
  const err = new SystemSkillHandlerError(['x']);
  assertEq(err.name, 'SystemSkillHandlerError', 'name');
});

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

console.log('');
console.log(`systemSkillHandlerValidatorPure: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
