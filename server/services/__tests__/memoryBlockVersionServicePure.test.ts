/**
 * memoryBlockVersionServicePure.test.ts — canonical registry + diff utility
 *
 * Spec: docs/memory-and-briefings-spec.md §S24
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/memoryBlockVersionServicePure.test.ts
 */

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

function assertEqual<T>(a: T, b: T, label: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

function assertTrue(cond: boolean, label: string) {
  if (!cond) throw new Error(`${label} — expected true`);
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
  assertTrue(p !== null, 'resolved');
  assertTrue(p!.endsWith('.md'), 'is a markdown file');
  assertTrue(p!.includes('agents'), 'under docs/agents/');
});

test('non-protected block returns null', () => {
  assertEqual(getCanonicalPath('some-other-block'), null, 'null');
});

test('empty name returns null', () => {
  assertEqual(getCanonicalPath(''), null, 'null');
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
  assertTrue(!result.includes('- '), 'no removals');
  assertTrue(!result.includes('+ '), 'no additions');
});

test('single line diff shows -/+', () => {
  const result = simpleUnifiedDiff('foo\nbar', 'foo\nbaz');
  assertTrue(result.includes('- bar'), 'has removal');
  assertTrue(result.includes('+ baz'), 'has addition');
});

test('addition at end', () => {
  const result = simpleUnifiedDiff('foo', 'foo\nbar');
  assertTrue(result.includes('+ bar'), 'added line');
});

test('removal at end', () => {
  const result = simpleUnifiedDiff('foo\nbar', 'foo');
  assertTrue(result.includes('- bar'), 'removed line');
});

test('empty → content', () => {
  const result = simpleUnifiedDiff('', 'new line');
  assertTrue(result.includes('+ new line'), 'added');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
