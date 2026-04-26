// guard-ignore-file: pure-helper-convention reason="Inline pure drift test — reads schema files via fs, no imports from parent service directory"
/**
 * canonicalRegistryDriftPure.test.ts — C3 drift guard.
 *
 * Asserts that every `canonical_*` table declared in the schema via
 * `pgTable('canonical_*', ...)` is registered in
 * `canonicalDictionaryRegistry.ts` (the CANONICAL_DICTIONARY_REGISTRY array).
 *
 * Two-set comparison: schemaTables ⊆ dictionaryTables.
 * The registry is allowed to carry deprecated table names (e.g.
 * `canonical_workflow_definitions` after its rename to
 * `canonical_flow_definitions`) — those are advisory history entries and do
 * not fail this gate.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/canonicalRegistryDriftPure.test.ts
 *
 * NOTE — C3 follow-up (Phase-5A coupling):
 *   canonicalQueryRegistry.ts entries use semantic action keys
 *   (e.g. `contacts.inactive_over_days`), not canonical table names directly.
 *   There is currently no `canonicalTable` metadata field on registry entries,
 *   so the third set (queryPlannerTables ⊆ dictionaryTables) cannot be built.
 *   See tasks/todo.md § "C3 follow-up: add canonicalTable metadata to
 *   canonicalQueryRegistry; upgrade C3 drift test to three-set comparison".
 */
export {};

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '../../..');

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// ── Build schemaTables ────────────────────────────────────────────────────────
// Scan every *.ts file in server/db/schema and extract the first string
// argument of each pgTable(...) call that starts with "canonical_".

function buildSchemaTables(): Set<string> {
  const schemaDir = join(ROOT, 'server/db/schema');
  const files = readdirSync(schemaDir).filter(f => f.endsWith('.ts'));
  const tables = new Set<string>();

  const re = /pgTable\(\s*['"]([^'"]+)['"]/g;

  for (const file of files) {
    const content = readFileSync(join(schemaDir, file), 'utf-8');
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(content)) !== null) {
      const name = m[1]!;
      if (name.startsWith('canonical_')) {
        tables.add(name);
      }
    }
  }
  return tables;
}

// ── Build dictionaryTables ────────────────────────────────────────────────────
// Scan canonicalDictionaryRegistry.ts for tableName: '...' entries.

function buildDictionaryTables(): Set<string> {
  const registryFile = join(
    ROOT,
    'server/services/canonicalDictionary/canonicalDictionaryRegistry.ts',
  );
  const content = readFileSync(registryFile, 'utf-8');
  const tables = new Set<string>();

  const re = /tableName:\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1]!;
    if (name.startsWith('canonical_')) {
      tables.add(name);
    }
  }
  return tables;
}

// ── Build sets ────────────────────────────────────────────────────────────────

const schemaTables = buildSchemaTables();
const dictionaryTables = buildDictionaryTables();

// ── Tests ─────────────────────────────────────────────────────────────────────

test('schemaTables is non-empty (sanity: schema files are readable)', () => {
  assert(schemaTables.size > 0, 'No canonical_* tables found in server/db/schema — check the schema directory path');
});

test('dictionaryTables is non-empty (sanity: registry file is readable)', () => {
  assert(dictionaryTables.size > 0, 'No canonical_* entries found in canonicalDictionaryRegistry.ts — check the registry file path');
});

test('every canonical_* schema table is registered in CANONICAL_DICTIONARY_REGISTRY', () => {
  const missing: string[] = [];
  for (const table of schemaTables) {
    if (!dictionaryTables.has(table)) {
      missing.push(table);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} canonical_* table(s) declared in schema but missing from CANONICAL_DICTIONARY_REGISTRY:\n` +
      missing.map(t => `  - ${t}`).join('\n') + '\n' +
      'Add a CanonicalTableEntry for each missing table in ' +
      'server/services/canonicalDictionary/canonicalDictionaryRegistry.ts',
    );
  }
});

test('CANONICAL_DICTIONARY_REGISTRY contains no duplicate canonical_* tableName entries', () => {
  const registryFile = join(
    ROOT,
    'server/services/canonicalDictionary/canonicalDictionaryRegistry.ts',
  );
  const content = readFileSync(registryFile, 'utf-8');
  const seen = new Map<string, number>();
  const re = /tableName:\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1]!;
    if (!name.startsWith('canonical_')) continue;
    seen.set(name, (seen.get(name) ?? 0) + 1);
  }
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);
  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate tableName entries in CANONICAL_DICTIONARY_REGISTRY: ${duplicates.join(', ')}\n` +
      'Each canonical table should appear exactly once in the registry.',
    );
  }
});

// ── Result ────────────────────────────────────────────────────────────────────

console.log('');
console.log(`canonicalRegistryDriftPure: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
