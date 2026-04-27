/**
 * scripts/verify-skill-visibility.ts
 *
 * CI gate — fails the build if any skill file in server/skills/ has a
 * visibility value that drifts from the classification in
 * scripts/lib/skillClassification.ts.
 *
 * Enforces four invariants:
 *   1. Every .md file has parseable frontmatter
 *   2. Every .md file has an explicit `visibility:` frontmatter line
 *      (no defaults — drift is caught at PR time, not runtime)
 *   3. The declared visibility matches classifySkill()
 *   4. No legacy `isVisible:` lines remain (they would override visibility)
 *
 * Exit codes:
 *   0   — all skills pass
 *   1   — at least one violation
 *   2   — malformed file / unreadable directory
 *
 * Usage:
 *   npx tsx scripts/verify-skill-visibility.ts
 *
 * Invoke from bash/CI:
 *   npx tsx scripts/verify-skill-visibility.ts || exit 1
 */

import { readdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { classifySkill } from './lib/skillClassification.js';

const SKILLS_DIR = resolve(process.cwd(), 'server/skills');

interface Violation {
  slug: string;
  kind: 'no-frontmatter' | 'no-visibility' | 'drift' | 'legacy-isVisible';
  message: string;
}

async function main(): Promise<void> {
  let files: string[];
  try {
    files = await readdir(SKILLS_DIR);
  } catch {
    console.error(`✗ skills directory not found: ${SKILLS_DIR}`);
    process.exit(2);
  }

  const mdFiles = files.filter((f) => f.endsWith('.md')).sort();
  const violations: Violation[] = [];

  for (const file of mdFiles) {
    const slug = file.slice(0, -3);
    const filePath = join(SKILLS_DIR, file);
    const raw = (await readFile(filePath, 'utf-8')).replace(/\r\n/g, '\n');

    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
    if (!fmMatch) {
      violations.push({
        slug,
        kind: 'no-frontmatter',
        message: `${slug}: no YAML frontmatter block`,
      });
      continue;
    }

    const frontmatter = fmMatch[1];

    // Check for legacy isVisible key
    if (/^isVisible:/m.test(frontmatter)) {
      violations.push({
        slug,
        kind: 'legacy-isVisible',
        message: `${slug}: legacy 'isVisible:' key present — remove it, use 'visibility:' instead`,
      });
    }

    // Check for explicit visibility line
    const visMatch = frontmatter.match(/^visibility:\s*(\S+)\s*$/m);
    if (!visMatch) {
      violations.push({
        slug,
        kind: 'no-visibility',
        message: `${slug}: missing 'visibility:' frontmatter key (add 'visibility: none' or 'visibility: basic')`,
      });
      continue;
    }

    const actual = visMatch[1];
    const { desired, reason } = classifySkill(slug);

    if (actual !== desired) {
      violations.push({
        slug,
        kind: 'drift',
        message: `${slug}: visibility is '${actual}', expected '${desired}' (${reason}). Run 'npx tsx scripts/apply-skill-visibility.ts' to fix.`,
      });
    }
  }

  if (violations.length === 0) {
    console.log(`✓ verify-skill-visibility: ${mdFiles.length} skills pass`);
    return;
  }

  console.error(`✗ verify-skill-visibility: ${violations.length} violation(s) across ${mdFiles.length} skills`);
  console.error();
  for (const v of violations) {
    console.error(`  [${v.kind}] ${v.message}`);
  }
  console.error();
  console.error('Fix: run `npx tsx scripts/apply-skill-visibility.ts` to apply the classification.');
  console.error('     Review the classification itself in scripts/lib/skillClassification.ts');

  process.exit(1);
}

main().catch((err) => {
  console.error('✗ verify-skill-visibility crashed:', err);
  process.exit(2);
});
