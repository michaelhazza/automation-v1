// client/src/lib/__tests__/colorHash.test.ts
//
// Pure-function tests for hashToColor.
// Run via vitest (CI) or `npx vitest run client/src/lib/__tests__/colorHash.test.ts` locally.

import { test, expect } from 'vitest';
import { hashToColor, DEFAULT_WORKSPACE_PALETTE } from '../colorHash.js';

// ── Determinism ────────────────────────────────────────────────────────────────

test('same input produces same output on repeated calls', () => {
  const result1 = hashToColor('Acme Corp');
  const result2 = hashToColor('Acme Corp');
  const result3 = hashToColor('Acme Corp');
  expect(result1).toBe(result2);
  expect(result2).toBe(result3);
});

test('different inputs may produce different outputs', () => {
  // This tests that the function is actually hashing (not just returning palette[0] always)
  const results = new Set<string>();
  for (const s of ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']) {
    results.add(hashToColor(s));
  }
  // With 6 inputs and a 6-entry palette it is extremely unlikely all map to the same colour.
  // Accept the test as long as at least 2 distinct colours appear.
  expect(results.size).toBeGreaterThanOrEqual(2);
});

// ── Palette wrap-around ────────────────────────────────────────────────────────

test('result is always a member of the palette', () => {
  const inputs = ['hello', 'world', 'foo', 'bar', '12345', 'UPPER', 'miXeD cAsE', 'unicode‽'];
  for (const input of inputs) {
    const color = hashToColor(input);
    expect(DEFAULT_WORKSPACE_PALETTE).toContain(color);
  }
});

test('result with custom palette is always a member of that palette', () => {
  const custom = ['red', 'green', 'blue'] as const;
  const inputs = Array.from({ length: 30 }, (_, i) => `workspace-${i}`);
  for (const input of inputs) {
    const color = hashToColor(input, custom);
    expect(custom as ReadonlyArray<string>).toContain(color);
  }
});

test('hash that exceeds palette length wraps to a valid index', () => {
  // Drive the hash past the palette boundary by using a 1-entry palette.
  // Any non-zero hash % 1 === 0, so this must always return the single entry.
  const singleEntry = ['only'] as const;
  expect(hashToColor('anything', singleEntry)).toBe('only');
  expect(hashToColor('also anything', singleEntry)).toBe('only');
});

// ── Empty string ───────────────────────────────────────────────────────────────

test('empty string returns palette[0] without throwing', () => {
  expect(() => hashToColor('')).not.toThrow();
  expect(hashToColor('')).toBe(DEFAULT_WORKSPACE_PALETTE[0]);
});

test('empty string with custom palette returns custom palette[0]', () => {
  const custom = ['purple', 'orange'] as const;
  expect(hashToColor('', custom)).toBe('purple');
});

// ── Custom palette override ────────────────────────────────────────────────────

test('custom palette is used instead of default', () => {
  const custom = ['#ff0000', '#00ff00', '#0000ff'] as const;
  const color = hashToColor('test-workspace', custom);
  expect(custom as ReadonlyArray<string>).toContain(color);
  // Must NOT be a default palette entry (unless it coincidentally appears — but our custom
  // palette uses hex codes so no overlap is possible)
  expect(DEFAULT_WORKSPACE_PALETTE).not.toContain(color);
});

test('different custom palettes produce results scoped to each palette', () => {
  const paletteA = ['a1', 'a2', 'a3'] as const;
  const paletteB = ['b1', 'b2', 'b3'] as const;
  const colorA = hashToColor('shared-input', paletteA);
  const colorB = hashToColor('shared-input', paletteB);
  // Both must be in their respective palettes
  expect(paletteA as ReadonlyArray<string>).toContain(colorA);
  expect(paletteB as ReadonlyArray<string>).toContain(colorB);
  // And they can't be the same value since the palettes have no overlap
  expect(colorA).not.toBe(colorB);
});
