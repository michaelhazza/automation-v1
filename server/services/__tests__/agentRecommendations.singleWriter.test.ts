// guard-ignore-file: pure-helper-convention reason="Static-analysis test — no DB imports; uses fs.promises"
/**
 * agentRecommendations.singleWriter.test.ts
 *
 * Static-analysis-style test that scans server/**\/*.ts for direct writes
 * to the agent_recommendations table and asserts that only
 * server/services/agentRecommendationsService.ts contains them.
 *
 * Enforces the single-writer invariant from spec §6.2 AC-16a:
 *   "agentRecommendationsService.upsertRecommendation is the ONLY function
 *    that issues INSERT/UPDATE against agent_recommendations."
 *
 * Implementation: Node fs.promises.readdir walk + regex over file contents.
 * No DB imports.
 *
 * Runnable via:
 *   npx vitest run server/services/__tests__/agentRecommendations.singleWriter.test.ts
 */

import { describe, expect, test } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '../../');

// Patterns that constitute a direct write to agent_recommendations.
// These are SQL-level patterns (not ORM patterns) since the service uses
// raw SQL via db.execute(sql`INSERT INTO agent_recommendations ...`).
const WRITE_PATTERNS = [
  /INSERT\s+INTO\s+agent_recommendations/i,
  /UPDATE\s+agent_recommendations/i,
  // Also check for Drizzle-style patterns just in case
  /db\.insert\s*\(\s*agentRecommendations\s*\)/,
  /db\.update\s*\(\s*agentRecommendations\s*\)/,
  /tx\.insert\s*\(\s*agentRecommendations\s*\)/,
  /tx\.update\s*\(\s*agentRecommendations\s*\)/,
];

// The one allowed file (relative to SERVER_ROOT)
const ALLOWED_WRITER = 'services/agentRecommendationsService.ts';

async function walkTs(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules and dist
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      const sub = await walkTs(full);
      files.push(...sub);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('agentRecommendations single-writer invariant', () => {
  test('only agentRecommendationsService.ts writes to agent_recommendations', async () => {
    const allFiles = await walkTs(SERVER_ROOT);
    const violatingFiles: string[] = [];

    for (const filePath of allFiles) {
      const relPath = path.relative(SERVER_ROOT, filePath).replace(/\\/g, '/');

      // Skip the allowed writer
      if (relPath === ALLOWED_WRITER) continue;

      // Skip this test file itself
      if (relPath.includes('agentRecommendations.singleWriter')) continue;

      const contents = await fs.readFile(filePath, 'utf-8');
      const hasWrite = WRITE_PATTERNS.some((pattern) => pattern.test(contents));
      if (hasWrite) {
        violatingFiles.push(relPath);
      }
    }

    if (violatingFiles.length > 0) {
      throw new Error(
        `Single-writer invariant violated. The following files write directly to agent_recommendations:\n` +
          violatingFiles.map((f) => `  - ${f}`).join('\n') +
          '\n\nAll writes must go through server/services/agentRecommendationsService.ts via output.recommend.',
      );
    }

    expect(violatingFiles).toHaveLength(0);
  });

  test('agentRecommendationsService.ts contains write patterns (sanity check)', async () => {
    const servicePath = path.join(SERVER_ROOT, ALLOWED_WRITER);
    const contents = await fs.readFile(servicePath, 'utf-8');
    const hasWrite = WRITE_PATTERNS.some((pattern) => pattern.test(contents));
    expect(hasWrite).toBe(true);
  });
});
