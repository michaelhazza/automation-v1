/**
 * Backfill system_skills DB rows from server/skills/*.md.
 *
 * Phase 0 of skill-analyzer-v2 migrates system skills from file-based to
 * DB-backed (see docs/skill-analyzer-v2-spec.md §10 Phase 0). This module
 * is the bridge: it parses every .md file via the pure parser, validates
 * handler_key = slug resolves to SKILL_HANDLERS, and upserts each skill
 * into the system_skills table by slug.
 *
 * Idempotent — safe to re-run. Files that fail to parse, or that reference
 * a handler not registered in SKILL_HANDLERS, are skipped with a warning
 * rather than aborting the whole run. The startup validator
 * (validateSystemSkillHandlers) still enforces handler presence on active
 * rows, so unsafe rows can never reach runtime.
 *
 * The exported `runSystemSkillsBackfill` is called by `scripts/seed.ts`
 * (Phase 2) so a single `npm run seed` produces a complete DB. The CLI
 * entrypoint below preserves the standalone `npm run skills:backfill`
 * workflow for re-syncing skills without touching agents/templates.
 */

import 'dotenv/config';
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { db, client } from '../server/db/index.js';
import { systemSkills } from '../server/db/schema/systemSkills.js';
import { eq } from 'drizzle-orm';
import { parseSkillFile, type ParsedSystemSkillSeed } from '../server/services/systemSkillServicePure.js';
import { SKILL_HANDLERS } from '../server/services/skillExecutor.js';

const __filename = fileURLToPath(import.meta.url);
const SKILLS_DIR = join(dirname(__filename), '..', 'server', 'skills');

export interface SystemSkillsBackfillResult {
  total: number;
  inserted: number;
  updated: number;
  parseErrors: string[];
  missingHandlers: string[];
}

export interface SystemSkillsBackfillOpts {
  /** Optional logger; defaults to console.log. */
  log?: (msg: string) => void;
  /** Optional warn channel; defaults to console.warn. */
  warn?: (msg: string) => void;
}

/**
 * Run the system_skills backfill against the configured DB. Returns counts
 * for the caller to format. Does NOT close the underlying pg client — that
 * is the responsibility of the entrypoint (CLI or seed). Throws on a
 * non-recoverable error (e.g. unreadable skills directory).
 */
export async function runSystemSkillsBackfill(
  opts: SystemSkillsBackfillOpts = {},
): Promise<SystemSkillsBackfillResult> {
  const log = opts.log ?? ((msg: string) => console.log(msg));
  const warn = opts.warn ?? ((msg: string) => console.warn(msg));

  log(`[backfill] reading skills from ${SKILLS_DIR}`);

  const files = await readdir(SKILLS_DIR);

  // Skip non-skill markdown files (README.md, NOTES.md, etc.). Skill files
  // have a slug-like filename — lowercase letters, digits, and underscores only.
  const mdFiles = files
    .filter((f) => f.endsWith('.md'))
    .filter((f) => /^[a-z0-9_]+\.md$/.test(f))
    .sort();
  log(`[backfill] found ${mdFiles.length} .md files`);

  // ---------------------------------------------------------------------------
  // Parse and validate every file BEFORE writing any rows. Files that fail
  // either gate are skipped with a warning, not fatal.
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

  // Parse failures and missing handlers are both skip-with-warning rather
  // than fail-fast. Skill development is incremental: a .md file may land
  // before its handler, or use a non-canonical frontmatter shape, and the
  // previous fail-fast behaviour blocked all 167 inserts on a single bad
  // file. The startup validator (validateSystemSkillHandlers) still enforces
  // handler presence on active system_skills rows, so unsafe rows can never
  // reach runtime — this only relaxes the seed-time gate.
  if (parseErrors.length > 0) {
    warn(`[backfill] WARNING: ${parseErrors.length} skill file(s) skipped — could not parse:`);
    for (const slug of parseErrors) warn(`  - ${slug}.md`);
    warn('');
  }

  if (missingHandlers.length > 0) {
    warn(`[backfill] WARNING: ${missingHandlers.length} skill file(s) skipped — no handler in SKILL_HANDLERS:`);
    for (const slug of missingHandlers) warn(`  - ${slug}`);
    warn('Add handlers in server/services/skillExecutor.ts SKILL_HANDLERS to seed these.');
    warn('');
  }

  const skipped = parseErrors.length + missingHandlers.length;
  log(`[backfill] validated ${parsed.length} skills (${skipped} skipped), writing to DB...`);

  // ---------------------------------------------------------------------------
  // Upsert every parsed row by slug. Idempotent — re-runs leave the DB
  // unchanged if every row already matches.
  // ---------------------------------------------------------------------------
  let inserted = 0;
  let updated = 0;
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
      inserted++;
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
    updated++;
  }

  return {
    total: inserted + updated,
    inserted,
    updated,
    parseErrors,
    missingHandlers,
  };
}

// ---------------------------------------------------------------------------
// CLI entrypoint — invoked by `npm run skills:backfill`. Closes the pg
// client at the end; the seed-driven path leaves the connection open
// because seed.ts owns the lifecycle.
// ---------------------------------------------------------------------------

const isDirectInvocation = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

async function main(): Promise<void> {
  const result = await runSystemSkillsBackfill();
  console.log('[backfill] done:');
  console.log(`  inserted: ${result.inserted}`);
  console.log(`  updated:  ${result.updated}`);
  console.log(`  total:    ${result.total}`);
}

if (isDirectInvocation) {
  main()
    .then(async () => {
      await client.end();
    })
    .catch(async (err) => {
      console.error('[backfill] fatal:', err);
      try {
        await client.end();
      } catch {
        // swallow — already failing
      }
      process.exit(1);
    });
}
