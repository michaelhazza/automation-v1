// client/src/lib/__tests__/colorHash.test.ts
//
// Pure-function tests for hashToColor.
// Run with: npx tsx client/src/lib/__tests__/colorHash.test.ts

import assert from 'assert/strict';
import { hashToColor, DEFAULT_WORKSPACE_PALETTE } from '../colorHash.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${(err as Error).message}`);
    failed++;
  }
}

// ── Determinism ────────────────────────────────────────────────────────────────

test('same input produces same output on repeated calls', () => {
  const result1 = hashToColor('Acme Corp');
  const result2 = hashToColor('Acme Corp');
  const result3 = hashToColor('Acme Corp');
  assert.equal(result1, result2, 'second call differs from first');
  assert.equal(result2, result3, 'third call differs from second');
});

test('different inputs may produce different outputs', () => {
  // This tests that the function is actually hashing (not just returning palette[0] always)
  const results = new Set<string>();
  for (const s of ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']) {
    results.add(hashToColor(s));
  }
  // With 6 inputs and a 6-entry palette it is extremely unlikely all map to the same colour.
  // Accept the test as long as at least 2 distinct colours appear.
  assert.ok(results.size >= 2, `all inputs hashed to the same colour: ${[...results]}`);
});

// ── Palette wrap-around ────────────────────────────────────────────────────────

test('result is always a member of the palette', () => {
  const inputs = ['hello', 'world', 'foo', 'bar', '12345', 'UPPER', 'miXeD cAsE', 'unicode‽'];
  for (const input of inputs) {
    const color = hashToColor(input);
    assert.ok(
      DEFAULT_WORKSPACE_PALETTE.includes(color),
      `"${input}" → "${color}" is not in the default palette`,
    );
  }
});

test('result with custom palette is always a member of that palette', () => {
  const custom = ['red', 'green', 'blue'] as const;
  const inputs = Array.from({ length: 30 }, (_, i) => `workspace-${i}`);
  for (const input of inputs) {
    const color = hashToColor(input, custom);
    assert.ok(
      custom.includes(color as 'red' | 'green' | 'blue'),
      `"${input}" → "${color}" not in custom palette`,
    );
  }
});

test('hash that exceeds palette length wraps to a valid index', () => {
  // Drive the hash past the palette boundary by using a 1-entry palette.
  // Any non-zero hash % 1 === 0, so this must always return the single entry.
  const singleEntry = ['only'] as const;
  assert.equal(hashToColor('anything', singleEntry), 'only');
  assert.equal(hashToColor('also anything', singleEntry), 'only');
});

// ── Empty string ───────────────────────────────────────────────────────────────

test('empty string returns palette[0] without throwing', () => {
  assert.doesNotThrow(() => hashToColor(''));
  assert.equal(hashToColor(''), DEFAULT_WORKSPACE_PALETTE[0]);
});

test('empty string with custom palette returns custom palette[0]', () => {
  const custom = ['purple', 'orange'] as const;
  assert.equal(hashToColor('', custom), 'purple');
});

// ── Custom palette override ────────────────────────────────────────────────────

test('custom palette is used instead of default', () => {
  const custom = ['#ff0000', '#00ff00', '#0000ff'] as const;
  const color = hashToColor('test-workspace', custom);
  assert.ok(
    custom.includes(color as '#ff0000' | '#00ff00' | '#0000ff'),
    `Expected a custom palette colour, got "${color}"`,
  );
  // Must NOT be a default palette entry (unless it coincidentally appears — but our custom
  // palette uses hex codes so no overlap is possible)
  assert.ok(
    !DEFAULT_WORKSPACE_PALETTE.includes(color),
    `"${color}" unexpectedly appears in default palette`,
  );
});

test('different custom palettes produce results scoped to each palette', () => {
  const paletteA = ['a1', 'a2', 'a3'] as const;
  const paletteB = ['b1', 'b2', 'b3'] as const;
  const colorA = hashToColor('shared-input', paletteA);
  const colorB = hashToColor('shared-input', paletteB);
  // Both must be in their respective palettes
  assert.ok((paletteA as ReadonlyArray<string>).includes(colorA));
  assert.ok((paletteB as ReadonlyArray<string>).includes(colorB));
  // And they can't be the same value since the palettes have no overlap
  assert.notEqual(colorA, colorB);
});

// ── Summary ────────────────────────────────────────────────────────────────────

console.log('');
console.log(`colorHash: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
