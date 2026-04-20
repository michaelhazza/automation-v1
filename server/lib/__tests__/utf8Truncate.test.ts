/**
 * utf8Truncate.test.ts — verifies truncateUtf8Safe() never produces invalid
 * UTF-8 residue at the cut point. Covers ASCII, 2/3/4-byte sequences, and
 * the boundary case where maxBytes lands exactly on a code-point boundary.
 *
 * Runnable via:
 *   npx tsx server/lib/__tests__/utf8Truncate.test.ts
 */

import { truncateUtf8Safe } from '../utf8Truncate.js';

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

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Does the string round-trip cleanly via encode/decode? A malformed
 *  multi-byte residue would decode to U+FFFD. */
function isValidUtf8(s: string): boolean {
  return !s.includes('\uFFFD');
}

test('empty input → empty output', () => {
  assert(truncateUtf8Safe('', 2048) === '', 'empty in empty out');
});

test('maxBytes 0 → empty string', () => {
  assert(truncateUtf8Safe('hello', 0) === '', 'zero budget');
});

test('input smaller than maxBytes → unchanged', () => {
  const s = 'hello world';
  assert(truncateUtf8Safe(s, 2048) === s, 'no-op when small');
});

test('plain ASCII truncation', () => {
  const s = 'a'.repeat(3000);
  const out = truncateUtf8Safe(s, 2048);
  assert(byteLen(out) <= 2048, `byte length ${byteLen(out)} should be ≤ 2048`);
  assert(out.length === 2048, 'ASCII: 1 byte per char');
  assert(isValidUtf8(out), 'no U+FFFD');
});

test('multi-byte sequence: 2-byte (é)', () => {
  // 'é' is 0xC3 0xA9. Force truncation mid-sequence.
  const s = 'aaa' + 'é'.repeat(1000);
  const maxBytes = 6;  // 'aaa' + 1 complete 'é' = 5 bytes; 6 would land mid-é
  const out = truncateUtf8Safe(s, maxBytes);
  assert(byteLen(out) <= maxBytes, `byte length ${byteLen(out)} ≤ ${maxBytes}`);
  assert(isValidUtf8(out), 'no U+FFFD');
  // Should have the 3 a's + 1 complete é
  assert(out === 'aaaé', `got "${out}"`);
});

test('multi-byte sequence: 3-byte (€)', () => {
  // '€' is 0xE2 0x82 0xAC.
  const s = 'x' + '€'.repeat(100);
  const maxBytes = 5;  // 'x' (1) + 1 full '€' (3) = 4; 5 would land 1 byte into the next
  const out = truncateUtf8Safe(s, maxBytes);
  assert(byteLen(out) <= maxBytes, `byte length ${byteLen(out)} ≤ ${maxBytes}`);
  assert(isValidUtf8(out), 'no U+FFFD');
  assert(out === 'x€', `got "${out}"`);
});

test('multi-byte sequence: 4-byte emoji (😀 U+1F600)', () => {
  // '😀' is 0xF0 0x9F 0x98 0x80 (4 bytes).
  const s = '😀'.repeat(10);
  const maxBytes = 6;  // 1 emoji = 4 bytes; budget 6 only fits 1 emoji
  const out = truncateUtf8Safe(s, maxBytes);
  assert(byteLen(out) <= maxBytes, `byte length ${byteLen(out)} ≤ ${maxBytes}`);
  assert(isValidUtf8(out), 'no U+FFFD');
  assert(out === '😀', `got "${out}"`);
});

test('mixed script (English + CJK)', () => {
  // CJK chars are 3 bytes each in UTF-8.
  const s = 'Hello, 世界! '.repeat(200);
  const out = truncateUtf8Safe(s, 100);
  assert(byteLen(out) <= 100, `byte length ${byteLen(out)} ≤ 100`);
  assert(isValidUtf8(out), 'no U+FFFD');
});

test('truncation on exact boundary (no backtracking needed)', () => {
  // 'abc' + 'é' = 3 + 2 = 5 bytes. Truncate to 5 — should be unchanged.
  const s = 'abcé';
  const out = truncateUtf8Safe(s, 5);
  assert(out === 'abcé', `got "${out}"`);
});

test('2 KB realistic JSON-ish payload stays valid', () => {
  const raw = '{"x":"' + 'éこんにちは😀'.repeat(500) + '"}';
  const out = truncateUtf8Safe(raw, 2048);
  assert(byteLen(out) <= 2048, 'byte budget respected');
  assert(isValidUtf8(out), 'no replacement characters in output');
});

// ── Summary ──────────────────────────────────────────────────────────────

console.log('');
console.log(`[utf8Truncate] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
