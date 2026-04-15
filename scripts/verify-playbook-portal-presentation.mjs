#!/usr/bin/env node
/**
 * verify-playbook-portal-presentation.mjs
 *
 * Introduced by docs/onboarding-playbooks-spec.md Final gates section.
 *
 * Fails if any playbook declares `portalPresentation.headlineStepId` that
 * doesn't exist in its `steps[]` array. A missing step id causes a silent
 * runtime failure when the portal card tries to render the headline.
 *
 * Does not import or execute the playbook files — it uses regex/text analysis
 * so it can run without a live DB or full runtime environment.
 *
 * Exit codes:
 *   0 — all playbooks ok (or no playbooks found)
 *   1 — one or more violations found
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

const ROOT_DIR = resolve(import.meta.dirname, '..');
const PLAYBOOKS_DIR = join(ROOT_DIR, 'server', 'playbooks');

let violations = 0;
let filesScanned = 0;

/** Extract the value after a key in a TS object literal (single-line). */
function extractStringValue(content, key) {
  const re = new RegExp(`${key}:\\s*['"\`]([^'"\`]+)['"\`]`);
  const m = content.match(re);
  return m ? m[1] : null;
}

/** Extract all step ids from the steps array. */
function extractStepIds(content) {
  const ids = [];
  const re = /\bid:\s*['"`]([a-z_][a-z0-9_]*)['"`]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    ids.push(m[1]);
  }
  return ids;
}

let files;
try {
  files = readdirSync(PLAYBOOKS_DIR).filter((f) => f.endsWith('.playbook.ts'));
} catch {
  console.log('[GUARD] verify-playbook-portal-presentation: no playbooks dir found — skipping');
  process.exit(0);
}

if (files.length === 0) {
  console.log('[GUARD] verify-playbook-portal-presentation: no playbook files found — skipping');
  process.exit(0);
}

for (const file of files.sort()) {
  const filePath = join(PLAYBOOKS_DIR, file);
  const content = readFileSync(filePath, 'utf8');
  filesScanned++;

  // Only check files that declare portalPresentation
  if (!content.includes('portalPresentation')) continue;

  const headlineStepId = extractStringValue(content, 'headlineStepId');
  if (!headlineStepId) continue; // undefined is allowed (§9.4)

  const stepIds = extractStepIds(content);

  if (!stepIds.includes(headlineStepId)) {
    console.error(
      `❌ ${file}: portalPresentation.headlineStepId '${headlineStepId}' does not match any step id`,
    );
    console.error(`   Found step ids: [${stepIds.join(', ')}]`);
    console.error(`   → Correct headlineStepId or add a step with id '${headlineStepId}'.`);
    console.error('');
    violations++;
  }
}

console.log(`\nSummary: ${filesScanned} files scanned, ${violations} violations found`);

if (violations > 0) {
  process.exit(1);
}
process.exit(0);
