/**
 * Backfill system_skills DB rows from server/skills/*.md.
 *
 * Phase 0 of skill-analyzer-v2 migrates system skills from file-based to
 * DB-backed (see docs/skill-analyzer-v2-spec.md §10 Phase 0). This script
 * is the one-shot bridge: it parses every .md file via the pure parser,
 * validates handler_key = slug resolves to SKILL_HANDLERS, and upserts
 * each skill into the system_skills table by slug.
 *
 * Idempotent — safe to re-run. Fails fast on any unregistered handler or
 * malformed .md file, printing the offender and exiting non-zero without
 * writing any rows.
 *
 * Usage:
 *   npm run skills:backfill
 *   (or: tsx scripts/backfill-system-skills.ts)
 */

import 'dotenv/config';
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db, client } from '../server/db/index.js';
import { systemSkills } from '../server/db/schema/systemSkills.js';
import { eq } from 'drizzle-orm';
import { parseSkillFile, type ParsedSystemSkillSeed } from '../server/services/systemSkillServicePure.js';
import { SKILL_HANDLERS } from '../server/services/skillExecutor.js';

const __filename = fileURLToPath(import.meta.url);
const SKILLS_DIR = join(dirname(__filename), '..', 'server', 'skills');

interface BackfillResult {
  slug: string;
  action: 'inserted' | 'updated' | 'unchanged';
}

async function main(): Promise<void> {
  console.log('[backfill] reading skills from', SKILLS_DIR);

  let files: string[];
  try {
    files = await readdir(SKILLS_DIR);
  } catch (err) {
    console.error('[backfill] skills directory not readable:', err);
    process.exit(1);
  }

  // Skip non-skill markdown files (README.md, NOTES.md, etc.). Skill files
  // have a slug-like filename — lowercase letters, digits, and underscores only.
  const mdFiles = files
    .filter((f) => f.endsWith('.md'))
    .filter((f) => /^[a-z0-9_]+\.md$/.test(f))
    .sort();
  console.log(`[backfill] found ${mdFiles.length} .md files`);

  // ---------------------------------------------------------------------------
  // Parse and validate every file BEFORE writing any rows. Fail fast so a
  // half-backfilled DB never ships.
  // ---------------------------------------------------------------------------
  const parsed: ParsedSystemSkillSeed[] = [];
  const parseErrors: string[] = [];
  const missingHandlers: string[] = [];
  const registeredKeys = new Set(Object.keys(SKILL_HANDLERS));

  for (const file of mdFiles) {
    const slug = file.slice(0, -3);
    const raw = await readFile(join(SKILLS_DIR, file), 'utf-8');
    const seed = parseSkillFile(slug, raw);
    if (!seed) {
      parseErrors.push(slug);
      continue;
    }
    if (!registeredKeys.has(seed.slug)) {
      missingHandlers.push(seed.slug);
      continue;
    }
    parsed.push(seed);
  }

  if (parseErrors.length > 0) {
    console.error('[backfill] FAILED: could not parse these skill files:');
    for (const slug of parseErrors) console.error(`  - ${slug}.md`);
    await client.end();
    process.exit(1);
  }

  if (missingHandlers.length > 0) {
    console.error('[backfill] FAILED: these skill slugs have no handler in SKILL_HANDLERS:');
    for (const slug of missingHandlers) console.error(`  - ${slug}`);
    console.error('');
    console.error('Register handlers in server/services/skillExecutor.ts SKILL_HANDLERS before re-running the backfill.');
    await client.end();
    process.exit(1);
  }

  console.log(`[backfill] validated ${parsed.length} skills, writing to DB...`);

  // ---------------------------------------------------------------------------
  // Upsert every parsed row by slug. Idempotent — re-runs leave the DB
  // unchanged if every row already matches.
  // ---------------------------------------------------------------------------
  const results: BackfillResult[] = [];
  for (const seed of parsed) {
    const existing = await db
      .select()
      .from(systemSkills)
      .where(eq(systemSkills.slug, seed.slug))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(systemSkills).values({
        slug: seed.slug,
        handlerKey: seed.slug,
        name: seed.name,
        description: seed.description,
        definition: seed.definition as unknown as object,
        instructions: seed.instructions,
        visibility: seed.visibility,
        isActive: seed.isActive,
      });
      results.push({ slug: seed.slug, action: 'inserted' });
      continue;
    }

    // Row exists — update in place to keep DB in sync with the seed file.
    // This is the idempotent path: a re-run against unchanged .md files
    // still performs the UPDATE but the end state is identical. We do NOT
    // detect "unchanged" to avoid a field-by-field equality check that
    // could drift silently on definition (jsonb) or instructions (long text).
    await db
      .update(systemSkills)
      .set({
        handlerKey: seed.slug,
        name: seed.name,
        description: seed.description,
        definition: seed.definition as unknown as object,
        instructions: seed.instructions,
        visibility: seed.visibility,
        isActive: seed.isActive,
        updatedAt: new Date(),
      })
      .where(eq(systemSkills.slug, seed.slug));
    results.push({ slug: seed.slug, action: 'updated' });
  }

  console.log('[backfill] done:');
  const inserted = results.filter((r) => r.action === 'inserted').length;
  const updated = results.filter((r) => r.action === 'updated').length;
  console.log(`  inserted: ${inserted}`);
  console.log(`  updated:  ${updated}`);
  console.log(`  total:    ${results.length}`);

  await client.end();
}

main().catch(async (err) => {
  console.error('[backfill] fatal:', err);
  try {
    await client.end();
  } catch {
    // swallow — already failing
  }
  process.exit(1);
});
