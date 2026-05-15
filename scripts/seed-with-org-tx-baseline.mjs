// One-shot helper to seed scripts/.gate-baselines/with-org-tx-or-scoped-db.txt
// with the full set of current violations across server/services|jobs|lib|adapters.
// Closes pre-v1 lockdown P15. Run manually, not from CI.
//
// Usage: node scripts/seed-with-org-tx-baseline.mjs > scripts/.gate-baselines/with-org-tx-or-scoped-db.txt

import { analyseWithOrgTxScope } from './lib/with-org-tx-analyser.mjs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const dirs = ['server/services', 'server/jobs', 'server/lib', 'server/adapters'];
const files = [];

function walk(relDir) {
  const abs = join(repoRoot, relDir);
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const child = relDir + '/' + e.name;
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      walk(child);
    } else if (
      e.isFile() &&
      e.name.endsWith('.ts') &&
      !e.name.endsWith('.test.ts') &&
      !e.name.endsWith('.integration.test.ts')
    ) {
      files.push(child);
    }
  }
}
for (const d of dirs) walk(d);

process.stderr.write(`scanning ${files.length} files\n`);
const violations = analyseWithOrgTxScope(repoRoot, files);
process.stderr.write(`violations: ${violations.length}\n`);

const today = new Date();
const expires = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

process.stdout.write(
  '# Gate baseline file - with-org-tx-or-scoped-db\n' +
  '#\n' +
  '# Pre-existing violations seeded from full scan of server/services, server/jobs,\n' +
  '# server/lib, server/adapters. Each entry is a CURRENT call-site that lacks\n' +
  '# withOrgTx/getOrgScopedDb scope (single-level analyser walk).\n' +
  '# Closes pre-v1 lockdown P15 (baseline extension deferred from initial seed).\n' +
  '#\n',
);

for (const v of violations) {
  process.stdout.write(`# expires: ${expires}\n`);
  const file = v.file.replace(/\\/g, '/');
  process.stdout.write(`${file}:${v.line}:${v.message}\n`);
}
