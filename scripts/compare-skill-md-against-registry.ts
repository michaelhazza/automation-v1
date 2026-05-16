/**
 * compare-skill-md-against-registry.ts
 *
 * Compares ACTION_REGISTRY snapshot keys against on-disk .md files in
 * server/skills/, producing a structured JSON report.
 *
 * Normalization rule:
 *   - Disk file `foo_bar.md`       → disk key `foo_bar`
 *   - Disk file `ns/foo_bar.md`    → disk key `ns.foo_bar`
 *   - Snapshot key `ns.foo_bar`    → compared as-is
 *   - Snapshot key `ns.sub.action` → single first-dot replacement: `ns_sub.action`
 *     (only single-level namespace unification needed for calendar/slack)
 *
 * Match condition: snapshot key == normalized disk key.
 *
 * CLI flags:
 *   --methodology-path <dir>   Exclude disk files rooted at this path
 *                              (default: docs/methodologies)
 *   --output <file>            Write JSON report to this path
 *                              (default: tasks/builds/wave-4-audit-absorber/skill-unmatched-report.json)
 *
 * Exit codes:
 *   0 — report written (unmatched lists may be non-empty; this is informational)
 *   1 — snapshot file missing or unreadable
 *
 * Usage:
 *   npx tsx scripts/compare-skill-md-against-registry.ts
 *   npx tsx scripts/compare-skill-md-against-registry.ts --methodology-path docs/methodologies --output out.json
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { resolve, relative, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SNAPSHOT_PATH = resolve(ROOT, 'scripts/snapshots/action-registry.snapshot.json');
const SKILLS_DIR = resolve(ROOT, 'server/skills');

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(flag: string, fallback: string): string {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return fallback;
}

const methodologyPath = getArg('--methodology-path', 'docs/methodologies');
const outputPath = getArg('--output', 'tasks/builds/wave-4-audit-absorber/skill-unmatched-report.json');
const METHODOLOGY_ABS = resolve(ROOT, methodologyPath);
const OUTPUT_ABS = resolve(ROOT, outputPath);

// ---------------------------------------------------------------------------
// Prerequisite: snapshot must exist
// ---------------------------------------------------------------------------

if (!existsSync(SNAPSHOT_PATH)) {
  process.stderr.write(
    `Snapshot missing: ${SNAPSHOT_PATH}\n` +
    'Run: npm run build:server && npx tsx scripts/snapshot-action-registry.ts\n',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load snapshot
// ---------------------------------------------------------------------------

interface Snapshot {
  entries: Record<string, unknown>;
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot;
const registryKeys = Object.keys(snapshot.entries);

// ---------------------------------------------------------------------------
// Walk server/skills/ recursively, collect .md files (exclude README.md)
// ---------------------------------------------------------------------------

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walkDir(full));
    } else if (extname(entry) === '.md' && entry !== 'README.md') {
      results.push(full);
    }
  }
  return results;
}

const allDiskFiles = walkDir(SKILLS_DIR);

// Separate methodology-excluded files from skill files
const methodologyExcluded: string[] = [];
const skillFiles: string[] = [];

for (const f of allDiskFiles) {
  if (f.startsWith(METHODOLOGY_ABS + '/') || f.startsWith(METHODOLOGY_ABS + '\\')) {
    methodologyExcluded.push(relative(ROOT, f));
  } else {
    skillFiles.push(f);
  }
}

// ---------------------------------------------------------------------------
// Normalize disk file → disk key
//
// Rule:
//   server/skills/foo_bar.md          → foo_bar
//   server/skills/support/foo_bar.md  → support.foo_bar
//   server/skills/a/b/foo_bar.md      → a.b.foo_bar
//
// Hyphens are converted to underscores (handles any pre-rename stragglers).
// ---------------------------------------------------------------------------

function diskFileToKey(absPath: string): string {
  const rel = relative(SKILLS_DIR, absPath);                  // e.g. "support/foo_bar.md"
  const noExt = rel.replace(/\.md$/, '');                     // "support/foo_bar"
  const normalized = noExt.replace(/[\\/]/g, '.').replace(/-/g, '_');
  return normalized;
}

// Build disk-key → relative-path map
const diskKeyToFile = new Map<string, string>();
for (const f of skillFiles) {
  const key = diskFileToKey(f);
  diskKeyToFile.set(key, relative(ROOT, f));
}

// ---------------------------------------------------------------------------
// Normalize snapshot key for matching
//
// The snapshot uses dot-qualified keys for namespaced actions:
//   calendar.create_event → match against disk key calendar_create_event
//   slack.post_dm         → match against disk key slack_post_dm
//   support.classify_ticket → match against disk key support.classify_ticket
//
// Rule: replace the FIRST dot with underscore ONLY for single-level namespaces
// (i.e. exactly one dot and both sides are identifier segments, no sub-namespace).
// support.classify_ticket has exactly one dot → match as support.classify_ticket
// (disk key is already support.classify_ticket, so no transformation needed).
//
// For calendar/slack: snapshot key = "calendar.create_event",
//   disk key = "calendar_create_event". These differ. We build TWO lookup sets:
//     1. exact match (snapshot key == disk key)
//     2. dot-to-underscore match (first dot replaced: "calendar_create_event")
// and consider matched if either is found.
// ---------------------------------------------------------------------------

function snapshotKeyToDiskKey(snapshotKey: string): string {
  // Replace only the first dot with underscore for single-level namespace alignment
  // (calendar.create_event → calendar_create_event)
  return snapshotKey.replace('.', '_');
}

// ---------------------------------------------------------------------------
// Build match sets
// ---------------------------------------------------------------------------

const matchedRegistryKeys = new Set<string>();
const matchedDiskKeys = new Set<string>();

for (const rk of registryKeys) {
  // Try exact match first
  if (diskKeyToFile.has(rk)) {
    matchedRegistryKeys.add(rk);
    matchedDiskKeys.add(rk);
    continue;
  }
  // Try dot→underscore transformation
  const transformed = snapshotKeyToDiskKey(rk);
  if (diskKeyToFile.has(transformed)) {
    matchedRegistryKeys.add(rk);
    matchedDiskKeys.add(transformed);
  }
}

const unmatchedRegistryEntries = registryKeys.filter(k => !matchedRegistryKeys.has(k));
const unmatchedMdFiles = Array.from(diskKeyToFile.keys()).filter(k => !matchedDiskKeys.has(k));

// ---------------------------------------------------------------------------
// Build report
// ---------------------------------------------------------------------------

interface Report {
  unmatched_md_files: string[];
  unmatched_registry_entries: string[];
  methodology_excluded: string[];
  total_md_files: number;
  total_registry_entries: number;
}

const report: Report = {
  unmatched_md_files: unmatchedMdFiles.map(k => diskKeyToFile.get(k)!).sort(),
  unmatched_registry_entries: unmatchedRegistryEntries.sort(),
  methodology_excluded: methodologyExcluded.sort(),
  total_md_files: skillFiles.length,
  total_registry_entries: registryKeys.length,
};

writeFileSync(OUTPUT_ABS, JSON.stringify(report, null, 2) + '\n', 'utf8');

process.stdout.write(
  `Skill MD vs registry comparison complete.\n` +
  `  Total .md files:         ${report.total_md_files}\n` +
  `  Total registry entries:  ${report.total_registry_entries}\n` +
  `  Unmatched .md files:     ${report.unmatched_md_files.length}\n` +
  `  Unmatched registry keys: ${report.unmatched_registry_entries.length}\n` +
  `  Methodology excluded:    ${report.methodology_excluded.length}\n` +
  `  Report written to:       ${outputPath}\n`,
);
