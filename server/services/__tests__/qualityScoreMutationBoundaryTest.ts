/**
 * qualityScoreMutationBoundaryTest.ts — architectural guard for the S1/S4 invariant
 *
 * The qualityScore mutation invariant (§4.4) states: only
 * `memoryEntryQualityService.ts` may mutate `workspace_memory_entries.qualityScore`
 * after an entry is written. This test walks the TypeScript sources and fails
 * CI if any other file contains a write to qualityScore / quality_score.
 *
 * Allowed writers:
 *   - server/services/memoryEntryQualityService.ts (applyDecay, adjustFromUtility)
 *   - server/services/memoryEntryQualityServicePure.ts (pure module — never writes)
 *   - The workspace memory service's initial write path (scored at insertion time, not a
 *     post-write mutation — captured as an allowlist entry).
 *
 * Spec: docs/memory-and-briefings-spec.md §4.4 (S1/S4 invariant)
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/qualityScoreMutationBoundaryTest.ts
 */

import { promises as fs } from 'fs';
import * as path from 'path';

const ROOT = path.resolve(process.cwd(), 'server');

// Files allowed to write qualityScore. Paths are relative to repo root.
const ALLOWED_WRITER_PATHS = new Set<string>([
  'server/services/memoryEntryQualityService.ts',
  // memoryEntryQualityServicePure.ts is pure — it never writes, but it references
  // the field name in docstrings / types, which the naive regex catches.
  'server/services/memoryEntryQualityServicePure.ts',
  // workspaceMemoryService.ts writes qualityScore ONLY at insert time (initial
  // write). The invariant is about *post-write* mutation; an INSERT that sets
  // the field for the first time is the write, not a mutation.
  'server/services/workspaceMemoryService.ts',
  // Tests intentionally reference the field name.
  'server/services/__tests__/qualityScoreMutationBoundaryTest.ts',
  'server/services/__tests__/memoryEntryQualityServicePure.test.ts',
  'server/services/__tests__/memoryBlockUpsertPure.test.ts',
  // Migration SQL + Drizzle schemas declare the column.
  'server/db/schema/workspaceMemories.ts',
  // Migration 0150 declares the quality_score_updater column, backfill, and trigger.
  'migrations/0150_pr_review_hardening.sql',
]);

// Mutation patterns we look for. The first catches the Drizzle `.set({...})`
// form; the second catches direct SQL updates.
const MUTATION_PATTERNS: RegExp[] = [
  /\.set\s*\(\s*\{\s*[^}]*qualityScore\s*:/m,
  /UPDATE\s+workspace_memory_entries\s+SET[^;]*quality_score\s*=/im,
];

interface Violation {
  file: string;
  pattern: string;
  matchedLine: string;
}

async function collectTsFiles(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      await collectTsFiles(full, acc);
    } else if (entry.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx'))) {
      acc.push(full);
    }
  }
  return acc;
}

function relFromRepoRoot(abs: string): string {
  return path.relative(path.resolve(ROOT, '..'), abs).replace(/\\/g, '/');
}

async function main(): Promise<void> {
  const files = await collectTsFiles(ROOT);
  const violations: Violation[] = [];

  for (const file of files) {
    const rel = relFromRepoRoot(file);
    if (ALLOWED_WRITER_PATHS.has(rel)) continue;

    const contents = await fs.readFile(file, 'utf-8');
    for (const pattern of MUTATION_PATTERNS) {
      const match = contents.match(pattern);
      if (match) {
        const idx = match.index ?? 0;
        // Reconstruct the matched line for the report
        const lineStart = contents.lastIndexOf('\n', idx) + 1;
        const lineEnd = contents.indexOf('\n', idx);
        const line = contents.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
        violations.push({
          file: rel,
          pattern: pattern.source,
          matchedLine: line.trim(),
        });
      }
    }
  }

  if (violations.length > 0) {
    console.log('');
    console.log(
      'qualityScoreMutationBoundaryTest — FAIL: unauthorised qualityScore writers detected',
    );
    console.log('');
    for (const v of violations) {
      console.log(`  ${v.file}`);
      console.log(`    pattern: ${v.pattern}`);
      console.log(`    line:    ${v.matchedLine}`);
      console.log('');
    }
    console.log(
      'The §4.4 invariant restricts qualityScore mutation to memoryEntryQualityService.ts.',
    );
    console.log(
      'If this is a legitimate new writer, document the reason and add the file to',
    );
    console.log(
      'ALLOWED_WRITER_PATHS in qualityScoreMutationBoundaryTest.ts (with reviewer sign-off).',
    );
    process.exit(1);
  }

  console.log('');
  console.log('qualityScoreMutationBoundaryTest — PASS: only allowed writers found');
  console.log(`  scanned ${files.length} files`);
  console.log('');
}

main().catch((err) => {
  console.error('qualityScoreMutationBoundaryTest FAILED:', err);
  process.exit(1);
});
