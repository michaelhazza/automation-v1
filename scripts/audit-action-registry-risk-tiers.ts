/**
 * audit-action-registry-risk-tiers.ts
 *
 * One-shot CSV-vs-runtime risk-tier drift detector.
 *
 * Loads dist/server/config/actionRegistry.js and parses
 * tasks/builds/synthetos-foundation-refactor/risk-tier-assignments.csv, then
 * cross-checks every CSV row against ACTION_REGISTRY[slug].riskTier.
 *
 * Reports:
 *   - CSV-only slugs (slug in CSV but not in ACTION_REGISTRY)
 *   - Registry-only slugs (slug in ACTION_REGISTRY but not in CSV) — allowed, flagged only
 *   - Mismatched riskTier slugs (slug present in both but riskTier differs)
 *
 * Exit codes:
 *   0 — every CSV-listed slug matches its registered riskTier (registry-only slugs are reported but do not fail)
 *   1 — one or more CSV-only or mismatched slugs found
 *
 * Requires: npm run build:server (loads from dist/).
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const REGISTRY_PATH = resolve(__dirname, '../dist/server/config/actionRegistry.js');
const CSV_PATH = resolve(
  __dirname,
  '../tasks/builds/synthetos-foundation-refactor/risk-tier-assignments.csv',
);

// ---------------------------------------------------------------------------
// Prerequisite checks
// ---------------------------------------------------------------------------

if (!existsSync(REGISTRY_PATH)) {
  process.stderr.write(
    'run `npm run build:server` first\n' +
      `(expected: ${REGISTRY_PATH})\n`,
  );
  process.exit(1);
}

if (!existsSync(CSV_PATH)) {
  process.stderr.write(
    `CSV not found: ${CSV_PATH}\n` +
      'Expected tasks/builds/synthetos-foundation-refactor/risk-tier-assignments.csv\n',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load runtime registry
// ---------------------------------------------------------------------------

let ACTION_REGISTRY: Record<string, Record<string, unknown>>;
try {
  const mod = (await import(pathToFileURL(REGISTRY_PATH).href)) as {
    ACTION_REGISTRY: Record<string, Record<string, unknown>>;
  };
  ACTION_REGISTRY = mod.ACTION_REGISTRY;
} catch (err) {
  process.stderr.write(`Failed to import compiled registry: ${String(err)}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Parse CSV (header-driven — column indices resolved by name, not hardcoded)
// ---------------------------------------------------------------------------

const csvText = readFileSync(CSV_PATH, 'utf8');
const [headerLine, ...dataLines] = csvText.trim().split('\n');
const headers = headerLine.split(',');

const slugColIdx = headers.indexOf('actionType');
const tierColIdx = headers.indexOf('assignedRiskTier');

if (slugColIdx === -1) {
  process.stderr.write('CSV is missing required header column: actionType\n');
  process.exit(1);
}
if (tierColIdx === -1) {
  process.stderr.write('CSV is missing required header column: assignedRiskTier\n');
  process.exit(1);
}

interface CsvRow {
  slug: string;
  assignedRiskTier: number;
}

const csvRows: CsvRow[] = [];

for (const line of dataLines) {
  const trimmed = line.trim();
  if (trimmed === '') continue;
  const cols = trimmed.split(',');
  const slug = cols[slugColIdx]?.trim();
  const tierRaw = cols[tierColIdx]?.trim();
  if (!slug || tierRaw === undefined) continue;
  const assignedRiskTier = Number(tierRaw);
  csvRows.push({ slug, assignedRiskTier });
}

// ---------------------------------------------------------------------------
// Cross-check
// ---------------------------------------------------------------------------

const registrySlugs = new Set(Object.keys(ACTION_REGISTRY));
const csvSlugs = new Set(csvRows.map(r => r.slug));

const csvOnlySlugs: string[] = [];
const registryOnlySlugs: string[] = [];
const mismatches: Array<{ slug: string; expected: number; actual: number }> = [];

// Check every CSV row against the registry
for (const { slug, assignedRiskTier } of csvRows) {
  if (!registrySlugs.has(slug)) {
    csvOnlySlugs.push(slug);
    continue;
  }
  const def = ACTION_REGISTRY[slug];
  const actualTier = Number(def['riskTier']);
  if (actualTier !== assignedRiskTier) {
    mismatches.push({ slug, expected: assignedRiskTier, actual: actualTier });
  }
}

// Flag registry slugs absent from CSV (allowed — CSV may pre-date some entries)
for (const slug of registrySlugs) {
  if (!csvSlugs.has(slug)) {
    registryOnlySlugs.push(slug);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const hasFatalIssues = csvOnlySlugs.length > 0 || mismatches.length > 0;

if (registryOnlySlugs.length > 0) {
  process.stderr.write(
    `[audit-risk-tiers] INFO — ${registryOnlySlugs.length} registry-only slug(s) not in CSV (allowed — CSV may pre-date them):\n` +
      registryOnlySlugs.map(s => `  - ${s}`).join('\n') +
      '\n\n',
  );
}

if (csvOnlySlugs.length > 0) {
  process.stderr.write(
    `[audit-risk-tiers] FAIL — ${csvOnlySlugs.length} CSV-only slug(s) missing from ACTION_REGISTRY:\n` +
      csvOnlySlugs.map(s => `  - ${s}`).join('\n') +
      '\n\n',
  );
}

if (mismatches.length > 0) {
  process.stderr.write(
    `[audit-risk-tiers] FAIL — ${mismatches.length} riskTier mismatch(es):\n` +
      mismatches
        .map(m => `  - ${m.slug}: expected riskTier ${m.expected}, got ${m.actual}`)
        .join('\n') +
      '\n\n',
  );
}

if (!hasFatalIssues) {
  const csvCount = csvRows.length;
  const registryOnlyNote =
    registryOnlySlugs.length > 0
      ? ` (${registryOnlySlugs.length} registry-only slug(s) not in CSV — see stderr)`
      : '';
  console.log(
    `[audit-risk-tiers] PASS — all ${csvCount} CSV-listed slug(s) match ACTION_REGISTRY riskTier${registryOnlyNote}.`,
  );
  process.exit(0);
}

process.exit(1);
