/**
 * diff-action-registry.ts
 *
 * One-shot diff CLI. Loads the compiled ACTION_REGISTRY from
 * dist/server/config/actionRegistry.js, serialises it the same way
 * snapshot-action-registry.ts does, then compares it deeply against the
 * committed snapshot at scripts/snapshots/action-registry.snapshot.json.
 *
 * Reports every mismatch as { slug, field, expected, actual } on stderr.
 *
 * Usage:
 *   npm run build:server   # compile first (after any change to the registry)
 *   npx tsx scripts/diff-action-registry.ts
 *
 * Exit codes:
 *   0 — byte-equivalent match
 *   1 — mismatch found (details on stderr)
 *   2 — snapshot file missing (run snapshot-action-registry.ts first)
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { serialiseRegistry, type SerialisedRegistry, type SerialisedEntry } from './registrySerialiserPure.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = resolve(__dirname, '../dist/server/config/actionRegistry.js');
const SNAPSHOT_PATH = resolve(__dirname, 'snapshots/action-registry.snapshot.json');

// ---------------------------------------------------------------------------
// Prerequisite checks
// ---------------------------------------------------------------------------

if (!existsSync(SNAPSHOT_PATH)) {
  process.stderr.write(
    'run snapshot-action-registry.ts to capture baseline\n' +
    `(expected: ${SNAPSHOT_PATH})\n`,
  );
  process.exit(2);
}

if (!existsSync(REGISTRY_PATH)) {
  process.stderr.write(
    'run `npm run build:server` first\n' +
    `(expected: ${REGISTRY_PATH})\n`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load snapshot
// ---------------------------------------------------------------------------

let snapshot: SerialisedRegistry;
try {
  snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as SerialisedRegistry;
} catch (err) {
  process.stderr.write(`Failed to parse snapshot file: ${String(err)}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load runtime registry
// ---------------------------------------------------------------------------

let ACTION_REGISTRY: Record<string, Record<string, unknown>>;
try {
  const mod = await import(pathToFileURL(REGISTRY_PATH).href) as {
    ACTION_REGISTRY: Record<string, Record<string, unknown>>;
  };
  ACTION_REGISTRY = mod.ACTION_REGISTRY;
} catch (err) {
  process.stderr.write(`Failed to import compiled registry: ${String(err)}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Serialise current registry (capturedAt is irrelevant for diff)
// ---------------------------------------------------------------------------

const current = serialiseRegistry(ACTION_REGISTRY, new Date().toISOString());

// ---------------------------------------------------------------------------
// Deep diff
// ---------------------------------------------------------------------------

interface Mismatch {
  slug: string;
  field: string;
  expected: unknown;
  actual: unknown;
}

const mismatches: Mismatch[] = [];

const snapshotSlugs = new Set(Object.keys(snapshot.entries));
const currentSlugs = new Set(Object.keys(current.entries));

// Added slugs (present in current, missing from snapshot)
for (const slug of currentSlugs) {
  if (!snapshotSlugs.has(slug)) {
    mismatches.push({ slug, field: '(entry)', expected: '(missing)', actual: '(added)' });
  }
}

// Removed slugs (present in snapshot, missing from current)
for (const slug of snapshotSlugs) {
  if (!currentSlugs.has(slug)) {
    mismatches.push({ slug, field: '(entry)', expected: '(present)', actual: '(removed)' });
  }
}

// Per-entry deep diff for slugs present in both
for (const slug of snapshotSlugs) {
  if (!currentSlugs.has(slug)) continue;

  const expected = snapshot.entries[slug];
  const actual = current.entries[slug];

  collectDiffs(slug, '', expected, actual, mismatches);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (mismatches.length === 0) {
  const entryCount = Object.keys(current.entries).length;
  console.log(`ACTION_REGISTRY diff: PASS — ${entryCount} entries match snapshot.`);
  process.exit(0);
} else {
  process.stderr.write(
    `ACTION_REGISTRY diff: FAIL — ${mismatches.length} mismatch(es) found:\n\n`,
  );
  for (const m of mismatches) {
    process.stderr.write(
      `  slug: ${m.slug}\n` +
      `  field: ${m.field}\n` +
      `  expected: ${JSON.stringify(m.expected)}\n` +
      `  actual:   ${JSON.stringify(m.actual)}\n\n`,
    );
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Recursive deep-diff helper
// ---------------------------------------------------------------------------

function collectDiffs(
  slug: string,
  path: string,
  expected: unknown,
  actual: unknown,
  acc: Mismatch[],
): void {
  if (deepEqual(expected, actual)) return;

  if (
    expected !== null &&
    actual !== null &&
    typeof expected === 'object' &&
    typeof actual === 'object' &&
    !Array.isArray(expected) &&
    !Array.isArray(actual)
  ) {
    const expObj = expected as Record<string, unknown>;
    const actObj = actual as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(expObj), ...Object.keys(actObj)]);
    for (const key of Array.from(allKeys).sort()) {
      const childPath = path ? `${path}.${key}` : key;
      collectDiffs(slug, childPath, expObj[key], actObj[key], acc);
    }
    return;
  }

  // Leaf difference or type mismatch
  acc.push({ slug, field: path || '(root)', expected, actual });
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, (b as unknown[])[i]));
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj).sort();
  const bKeys = Object.keys(bObj).sort();
  if (aKeys.length !== bKeys.length) return false;
  if (!aKeys.every((k, i) => k === bKeys[i])) return false;
  return aKeys.every(k => deepEqual(aObj[k], bObj[k]));
}

// Exported for snapshot typing reference
export type { SerialisedEntry };
