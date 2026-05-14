/**
 * skillAnalyzerServicePureDiffRows.test.ts — Phase 5 of skill-analyzer-v2.
 *
 * Pure unit tests for deriveDiffRows. Covers: empty input, identical
 * strings, simple insertion, simple deletion, mixed insertion+deletion,
 * multi-line strings, idempotency.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/skillAnalyzerServicePureDiffRows.test.ts
 */

import { expect, test } from 'vitest';
import { deriveDiffRows, type DiffToken } from '../skillAnalyzerServicePure.js';

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function reconstruct(tokens: DiffToken[], side: 'current' | 'recommended'): string {
  // Reconstruct one side from the diff tokens to verify the diff is valid.
  return tokens
    .filter((t) => {
      if (t.kind === 'unchanged') return true;
      if (side === 'current') return t.kind === 'removed';
      return t.kind === 'added';
    })
    .map((t) => t.value)
    .join('');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('empty inputs return empty array', () => {
  const result = deriveDiffRows('', '');
  assertEq(result.length, 0, 'length');
});

test('identical non-empty strings return one unchanged token', () => {
  const result = deriveDiffRows('hello world', 'hello world');
  assertEq(result.length, 1, 'length');
  assertEq(result[0].kind, 'unchanged', 'kind');
  assertEq(result[0].value, 'hello world', 'value');
});

test('pure insertion', () => {
  const result = deriveDiffRows('hello world', 'hello brave new world');
  // Should reconstruct both sides correctly.
  assertEq(reconstruct(result, 'current'), 'hello world', 'current reconstruction');
  assertEq(reconstruct(result, 'recommended'), 'hello brave new world', 'recommended reconstruction');
  // At least one added token expected.
  if (!result.some((t) => t.kind === 'added')) throw new Error('expected at least one added token');
});

test('pure deletion', () => {
  const result = deriveDiffRows('hello brave new world', 'hello world');
  assertEq(reconstruct(result, 'current'), 'hello brave new world', 'current reconstruction');
  assertEq(reconstruct(result, 'recommended'), 'hello world', 'recommended reconstruction');
  if (!result.some((t) => t.kind === 'removed')) throw new Error('expected at least one removed token');
});

test('mixed insertion + deletion', () => {
  const result = deriveDiffRows('the quick brown fox', 'the slow red fox');
  assertEq(reconstruct(result, 'current'), 'the quick brown fox', 'current reconstruction');
  assertEq(reconstruct(result, 'recommended'), 'the slow red fox', 'recommended reconstruction');
});

test('multi-line strings', () => {
  const current = 'line one\nline two\nline three';
  const recommended = 'line one\nline two-modified\nline three';
  const result = deriveDiffRows(current, recommended);
  assertEq(reconstruct(result, 'current'), current, 'current reconstruction');
  assertEq(reconstruct(result, 'recommended'), recommended, 'recommended reconstruction');
});

test('completely different strings', () => {
  const result = deriveDiffRows('foo', 'bar');
  assertEq(reconstruct(result, 'current'), 'foo', 'current reconstruction');
  assertEq(reconstruct(result, 'recommended'), 'bar', 'recommended reconstruction');
});

test('current empty → all added', () => {
  const result = deriveDiffRows('', 'new content');
  assertEq(reconstruct(result, 'recommended'), 'new content', 'recommended reconstruction');
  // No unchanged or removed tokens
  if (result.some((t) => t.kind === 'unchanged' || t.kind === 'removed')) {
    throw new Error('expected only added tokens');
  }
});

test('recommended empty → all removed', () => {
  const result = deriveDiffRows('old content', '');
  assertEq(reconstruct(result, 'current'), 'old content', 'current reconstruction');
  if (result.some((t) => t.kind === 'unchanged' || t.kind === 'added')) {
    throw new Error('expected only removed tokens');
  }
});

test('idempotency: same inputs produce equivalent output', () => {
  const a = deriveDiffRows('the quick brown fox', 'the slow red fox');
  const b = deriveDiffRows('the quick brown fox', 'the slow red fox');
  assertEq(a.length, b.length, 'length match');
  for (let i = 0; i < a.length; i++) {
    assertEq(a[i].kind, b[i].kind, `kind[${i}]`);
    assertEq(a[i].value, b[i].value, `value[${i}]`);
  }
});

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

console.log('');
