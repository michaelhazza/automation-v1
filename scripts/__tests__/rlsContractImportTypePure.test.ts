/**
 * rlsContractImportTypePure.test.ts
 *
 * Verifies the `import type` filter added to verify-rls-contract-compliance.sh
 * (RLS-CONTRACT-IMPORT). The gate must flag runtime `import { db }` lines
 * but must NOT flag `import type { ... }` lines.
 *
 * Run via: npx tsx scripts/__tests__/rlsContractImportTypePure.test.ts
 */

// Pure regex that mirrors the gate filter:
//   grep -vE ":[0-9]+:[[:space:]]*import[[:space:]]+type[[:space:]]"
// Applied to grep -rn output lines of the form: "path/file.ts:42:content"
const IMPORT_TYPE_FILTER = /:\d+:\s*import\s+type\s/;

/** Returns true if the line should be EXCLUDED (it's an import type line). */
function isImportTypeLine(greppedLine: string): boolean {
  return IMPORT_TYPE_FILTER.test(greppedLine);
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
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

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

console.log('\nRLS contract compliance — import type filter tests\n');

test('runtime import { db } is NOT excluded (gate should flag it)', () => {
  const line = "server/routes/example.ts:42:import { db } from '../db/index.js';";
  assert(!isImportTypeLine(line), `Expected runtime import to NOT be filtered, but it was`);
});

test('import type { ... } IS excluded (gate must not flag it)', () => {
  const line = "server/services/example.ts:7:import type { OrgScopedTx } from '../db/index.js';";
  assert(isImportTypeLine(line), `Expected import type to be filtered, but it was not`);
});

test('import type * as ... IS excluded', () => {
  const line = "server/lib/example.ts:3:import type * as Db from '../db/index.js';";
  assert(isImportTypeLine(line), `Expected import type * to be filtered`);
});

test('import type with leading spaces IS excluded', () => {
  const line = "server/services/example.ts:10:  import type { Tx } from '../db/index.js';";
  assert(isImportTypeLine(line), `Expected indented import type to be filtered`);
});

test('import { type ... } runtime import is NOT excluded', () => {
  // Inline type-only import uses `import { type Foo, bar }` — the top-level
  // keyword is still `import`, not `import type`. Gate should still flag this.
  const line = "server/routes/example.ts:5:import { type Tx, db } from '../db/index.js';";
  assert(!isImportTypeLine(line), `Expected inline-type import to NOT be filtered (still has runtime binding)`);
});

test('empty line is NOT excluded', () => {
  const line = '';
  assert(!isImportTypeLine(line), `Expected empty line to not be filtered`);
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
