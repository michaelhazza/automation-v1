/**
 * snapshot-action-registry.ts
 *
 * One-shot baseline generator. Loads the compiled ACTION_REGISTRY from
 * dist/server/config/actionRegistry.js, serialises every entry
 * deterministically (Zod schemas serialised via _def walk), and writes the
 * result to scripts/snapshots/action-registry.snapshot.json.
 *
 * Usage:
 *   npm run build:server   # compile first
 *   npx tsx scripts/snapshot-action-registry.ts
 *
 * Run once before any refactoring begins (Chunk 1). Do not re-run unless an
 * intentional behaviour change is being captured — if you do re-run,
 * scripts/diff-action-registry.ts must also exit 0 after the re-run.
 *
 * Exit codes:
 *   0 — snapshot written successfully
 *   1 — dist/ missing or import failed
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { serialiseRegistry } from './registrySerialiserPure.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = resolve(__dirname, '../dist/server/config/actionRegistry.js');
const SNAPSHOT_DIR = resolve(__dirname, 'snapshots');
const SNAPSHOT_PATH = resolve(SNAPSHOT_DIR, 'action-registry.snapshot.json');

if (!existsSync(REGISTRY_PATH)) {
  process.stderr.write(
    'run `npm run build:server` first\n' +
    `(expected: ${REGISTRY_PATH})\n`,
  );
  process.exit(1);
}

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

if (!existsSync(SNAPSHOT_DIR)) {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

const capturedAt = new Date().toISOString();
const snapshot = serialiseRegistry(ACTION_REGISTRY, capturedAt);

writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

console.log(
  `Snapshot written to ${SNAPSHOT_PATH}\n` +
  `  entries: ${Object.keys(snapshot.entries).length}\n` +
  `  capturedAt: ${capturedAt}`,
);
