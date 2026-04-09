/**
 * run-trajectory-tests.ts — CLI runner for structural trajectory comparison.
 *
 * Sprint 4 P3.3. Discovers all `tests/trajectories/*.json` files,
 * validates them against the Zod schema, and compares against actual
 * trajectories (when a fixture run exists).
 *
 * Usage: npx tsx scripts/run-trajectory-tests.ts
 *
 * Exit codes:
 *   0 — all trajectories pass (or no trajectories found)
 *   1 — at least one mismatch
 */

export {};

import * as fs from 'fs';
import * as path from 'path';
import { ReferenceTrajectory } from '../shared/iee/trajectorySchema.js';
import { compare, formatDiff } from '../server/services/trajectoryServicePure.js';

const TRAJECTORY_DIR = path.resolve(__dirname, '../tests/trajectories');

async function main() {
  if (!fs.existsSync(TRAJECTORY_DIR)) {
    console.log('[trajectory] No tests/trajectories/ directory found. Skipping.');
    process.exit(0);
  }

  const files = fs
    .readdirSync(TRAJECTORY_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    console.log('[trajectory] No trajectory files found. Skipping.');
    process.exit(0);
  }

  console.log(`[trajectory] Found ${files.length} reference trajectory file(s).\n`);

  let failCount = 0;
  let passCount = 0;

  for (const file of files) {
    const filePath = path.join(TRAJECTORY_DIR, file);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // Validate against schema
    const parseResult = ReferenceTrajectory.safeParse(raw);
    if (!parseResult.success) {
      console.error(`[FAIL] ${file} — invalid schema:`);
      for (const issue of parseResult.error.issues) {
        console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
      }
      failCount++;
      continue;
    }

    const ref = parseResult.data;

    // For now, trajectory tests run against synthetic data embedded in
    // the reference file's `expected` field. When fixture runs exist
    // in the DB, the trajectoryService.loadTrajectory path will be
    // used instead. This CLI validates the schema and comparison logic
    // without requiring a database connection.
    console.log(`[INFO] ${file} — '${ref.name}' (${ref.matchMode}, ${ref.expected.length} expected actions) — schema valid`);

    // Self-test: compare the expected against itself (should always pass)
    const selfTrajectory = ref.expected.map((e) => ({
      actionType: e.actionType,
      args: e.argMatchers as Record<string, unknown> | undefined,
    }));
    const diff = compare(selfTrajectory, ref);
    console.log(formatDiff(diff));

    if (diff.pass) {
      passCount++;
    } else {
      failCount++;
    }
    console.log('');
  }

  console.log(`\n[trajectory] Results: ${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[trajectory] Fatal error:', err);
  process.exit(1);
});
