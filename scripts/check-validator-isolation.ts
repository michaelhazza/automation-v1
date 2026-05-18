/**
 * check-validator-isolation.ts
 *
 * CI lint rule for deterministic validator isolation.
 * Walks server/lib/scorecardValidators/*.ts (excluding test, registry, types,
 * and entityResolverRegistry files), reads each file's source, and for
 * validators exported with kind: 'deterministic', rejects any forbidden imports.
 *
 * Forbidden imports: fs, process.env, net, http, https, db, drizzle, pg
 *
 * Exits non-zero on violation.
 * Run: tsx scripts/check-validator-isolation.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSource, isValidatorFile, type Violation } from './check-validator-isolationPure.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VALIDATORS_DIR = path.join(__dirname, '..', 'server', 'lib', 'scorecardValidators');

function checkFile(filePath: string): Violation[] {
  const source = readFileSync(filePath, 'utf-8');
  return checkSource(source);
}

function main(): void {
  let files: string[];
  try {
    files = readdirSync(VALIDATORS_DIR);
  } catch {
    console.error(`[check-validator-isolation] Directory not found: ${VALIDATORS_DIR}`);
    process.exit(1);
  }

  const validatorFiles = files.filter(isValidatorFile);
  const allViolations: Array<Violation & { file: string }> = [];

  for (const file of validatorFiles) {
    const filePath = path.join(VALIDATORS_DIR, file);
    const violations = checkFile(filePath);
    for (const v of violations) {
      allViolations.push({ ...v, file: filePath });
    }
  }

  if (allViolations.length === 0) {
    console.log(`[check-validator-isolation] OK — checked ${validatorFiles.length} validator file(s), no violations.`);
    process.exit(0);
  }

  console.error(`[check-validator-isolation] FAIL — ${allViolations.length} violation(s) found:\n`);
  for (const v of allViolations) {
    console.error(`  ${path.relative(process.cwd(), v.file)}:${v.lineNumber}`);
    console.error(`    Line: ${v.line}`);
    console.error(`    Matched: ${v.pattern}`);
    console.error('');
  }
  process.exit(1);
}

main();
