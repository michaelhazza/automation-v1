/**
 * scripts/apply-skill-visibility.ts
 *
 * Bulk-apply the skill visibility classification from
 * scripts/lib/skillClassification.ts to every .md file in server/skills/.
 *
 * Walks the skills directory, parses each file's frontmatter, computes the
 * desired visibility from the classification, and rewrites the file if the
 * current value is out of sync. Idempotent — a second run is a no-op.
 *
 * Usage:
 *   npx tsx scripts/apply-skill-visibility.ts            # apply changes
 *   npx tsx scripts/apply-skill-visibility.ts --dry-run  # report only
 *
 * This script is the companion to scripts/verify-skill-visibility.sh —
 * apply-* writes the changes, verify-* fails CI if they drift back.
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { classifySkill, type DesiredVisibility } from './lib/skillClassification.js';

const SKILLS_DIR = resolve(process.cwd(), 'server/skills');
const DRY_RUN = process.argv.includes('--dry-run');

interface FrontmatterState {
  raw: string;
  frontmatter: string;
  body: string;
  eol: '\r\n' | '\n';
  currentVisibility: string | null;
}

/**
 * Parse a skill .md file into its frontmatter, body, and current visibility.
 * Returns null if the file has no parseable frontmatter (malformed files are
 * skipped with a warning — the verify gate catches those separately).
 */
function parseFile(raw: string): FrontmatterState | null {
  const eol: '\r\n' | '\n' = raw.includes('\r\n') ? '\r\n' : '\n';
  const normalised = raw.replace(/\r\n/g, '\n');

  const match = normalised.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = match[1];
  const body = match[2];

  const visibilityMatch = frontmatter.match(/^visibility:\s*(\S+)\s*$/m);
  const currentVisibility = visibilityMatch ? visibilityMatch[1] : null;

  return { raw, frontmatter, body, eol, currentVisibility };
}

/**
 * Produce the updated file content with the desired visibility set in
 * frontmatter. If a `visibility:` line already exists it's replaced; otherwise
 * a new line is appended at the end of the frontmatter block. Also strips any
 * legacy `isVisible:` lines so they can't override the new value.
 */
function rewriteWithVisibility(
  state: FrontmatterState,
  desired: DesiredVisibility,
): string {
  const { raw, eol } = state;

  let updated = raw;

  // 1. Strip any legacy isVisible line — it would take precedence in some
  //    loaders and silently override our new visibility value.
  if (/^isVisible:/m.test(updated)) {
    updated = updated.replace(/^isVisible:.*\r?\n?/m, '');
  }

  // 2. Replace existing visibility line, or inject a new one before the
  //    closing --- fence. Use \r?\n to work on both LF and CRLF files.
  if (/^visibility:/m.test(updated)) {
    updated = updated.replace(/^visibility:.*$/m, `visibility: ${desired}`);
  } else {
    updated = updated.replace(
      /^(---\r?\n[\s\S]*?)(^---)/m,
      `$1visibility: ${desired}${eol}$2`,
    );
  }

  return updated;
}

async function main(): Promise<void> {
  console.log(`\n▸ Applying skill visibility classification`);
  console.log(`  Skills dir: ${SKILLS_DIR}`);
  console.log(`  Mode:       ${DRY_RUN ? 'DRY RUN (no files written)' : 'APPLY'}`);
  console.log();

  let files: string[];
  try {
    files = await readdir(SKILLS_DIR);
  } catch (err) {
    console.error(`✗ skills directory not found: ${SKILLS_DIR}`);
    process.exit(1);
  }

  const mdFiles = files.filter((f) => f.endsWith('.md')).sort();

  if (mdFiles.length === 0) {
    console.log('No .md files found. Nothing to do.');
    return;
  }

  const summary = {
    total: mdFiles.length,
    alreadyCorrect: 0,
    updated: 0,
    malformed: 0,
    details: [] as { slug: string; from: string; to: DesiredVisibility }[],
  };

  for (const file of mdFiles) {
    const slug = file.slice(0, -3);
    const filePath = join(SKILLS_DIR, file);
    const raw = await readFile(filePath, 'utf-8');

    const state = parseFile(raw);
    if (!state) {
      console.log(`  [malformed] ${slug} — no frontmatter`);
      summary.malformed += 1;
      continue;
    }

    const { desired, reason } = classifySkill(slug);

    if (state.currentVisibility === desired) {
      summary.alreadyCorrect += 1;
      continue;
    }

    const updated = rewriteWithVisibility(state, desired);

    const from = state.currentVisibility ?? '(unset)';
    console.log(`  [change]    ${slug.padEnd(34)} ${from.padEnd(8)} → ${desired.padEnd(6)}  (${reason})`);

    summary.details.push({ slug, from, to: desired });
    summary.updated += 1;

    if (!DRY_RUN) {
      await writeFile(filePath, updated, 'utf-8');
    }
  }

  console.log();
  console.log('Summary:');
  console.log(`  total:          ${summary.total}`);
  console.log(`  already correct: ${summary.alreadyCorrect}`);
  console.log(`  updated:        ${summary.updated}${DRY_RUN ? ' (dry run — not written)' : ''}`);
  if (summary.malformed > 0) {
    console.log(`  malformed:      ${summary.malformed}`);
  }

  if (DRY_RUN && summary.updated > 0) {
    console.log('\nRun without --dry-run to apply.');
    process.exitCode = 1;
  }

  if (summary.malformed > 0) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error('\n✗ apply-skill-visibility failed:', err);
  process.exit(1);
});
