// guard-ignore-file: pure-helper-convention reason="Inline pure simulation — constants inlined to avoid drizzle-orm transitive import; no sibling import needed"
/**
 * memoryBlockVersionServicePure.test.ts — canonical registry + diff utility
 *
 * Spec: docs/memory-and-briefings-spec.md §S24
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/memoryBlockVersionServicePure.test.ts
 */

import { expect, test } from 'vitest';

export {}; // module scope

// The impure memoryBlockVersionService imports drizzle-orm, which the pure
// tsx runner can't resolve. Inline the canonical registry here — keep in
// sync with memoryBlockVersionService.ts::PROTECTED_BLOCK_CANONICAL_PATHS.

const PROTECTED_BLOCK_CANONICAL_PATHS: Record<string, string> = {
  'config-agent-guidelines': 'docs/agents/config-agent-guidelines.md',
};

function getCanonicalPath(blockName: string): string | null {
  return PROTECTED_BLOCK_CANONICAL_PATHS[blockName] ?? null;
}

function assertEqual<T>(a: T, b: T, label: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

console.log('');
console.log('memoryBlockVersionServicePure — canonical registry + diff (§S24)');
console.log('');

// ---------------------------------------------------------------------------
// Canonical registry
// ---------------------------------------------------------------------------

console.log('getCanonicalPath:');

test('config-agent-guidelines resolves to docs path', () => {
  const p = getCanonicalPath('config-agent-guidelines');
  expect(p !== null, 'resolved').toBe(true);
  expect(p!.endsWith('.md'), 'is a markdown file').toBe(true);
  expect(p!.includes('agents'), 'under docs/agents/').toBe(true);
});

test('non-protected block returns null', () => {
  expect(getCanonicalPath('some-other-block'), 'null').toBe(null);
});

test('empty name returns null', () => {
  expect(getCanonicalPath(''), 'null').toBe(null);
});

// ---------------------------------------------------------------------------
// Diff utility (internal to memoryBlockVersionService). We reimplement here
// to exercise the same expectations the service relies on.
// ---------------------------------------------------------------------------

function simpleUnifiedDiff(a: string, b: string): string {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const out: string[] = [];
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    const la = aLines[i] ?? '';
    const lb = bLines[i] ?? '';
    if (la === lb) {
      out.push(`  ${la}`);
    } else {
      if (la) out.push(`- ${la}`);
      if (lb) out.push(`+ ${lb}`);
    }
  }
  return out.join('\n');
}

console.log('simpleUnifiedDiff:');

test('identical inputs → no change markers', () => {
  const result = simpleUnifiedDiff('foo\nbar', 'foo\nbar');
  expect(!result.includes('- '), 'no removals').toBe(true);
  expect(!result.includes('+ '), 'no additions').toBe(true);
});

test('single line diff shows -/+', () => {
  const result = simpleUnifiedDiff('foo\nbar', 'foo\nbaz');
  expect(result.includes('- bar'), 'has removal').toBe(true);
  expect(result.includes('+ baz'), 'has addition').toBe(true);
});

test('addition at end', () => {
  const result = simpleUnifiedDiff('foo', 'foo\nbar');
  expect(result.includes('+ bar'), 'added line').toBe(true);
});

test('removal at end', () => {
  const result = simpleUnifiedDiff('foo\nbar', 'foo');
  expect(result.includes('- bar'), 'removed line').toBe(true);
});

test('empty → content', () => {
  const result = simpleUnifiedDiff('', 'new line');
  expect(result.includes('+ new line'), 'added').toBe(true);
});

console.log('');
console.log('');
