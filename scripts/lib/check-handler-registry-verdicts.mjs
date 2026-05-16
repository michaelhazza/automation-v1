// ---------------------------------------------------------------------------
// check-handler-registry-verdicts.mjs
//
// Companion script for `verify-handler-registry-fixture.sh`. Extracted from
// an inline heredoc to fix Windows-path expansion (W4AA-DEBT-19) and to make
// the bash parent's stderr capture of VERDICT_WARNINGS unambiguous
// (W4AA-DEBT-18).
//
// Reads server/config/jobConfig.ts, walks each entry's idempotencyContract,
// and emits two stderr markers when applicable:
//   VERDICT_ERRORS:<msg1>|<msg2>|...   (one line; exit 1)
//   VERDICT_WARNINGS:<msg1>|<msg2>|... (one line; exit 0 unless errors too)
//
// Usage:
//   node scripts/lib/check-handler-registry-verdicts.mjs <path-to-jobConfig.ts>
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const configFile = process.argv[2];
if (!configFile) {
  process.stderr.write('[GUARD] check-handler-registry-verdicts: missing jobConfig.ts path argument\n');
  process.exit(2);
}

const src = readFileSync(configFile, 'utf8');

const startIdx = src.indexOf('export const JOB_CONFIG = {');
const endIdx = src.indexOf('} as const;', startIdx);
if (startIdx === -1 || endIdx === -1) {
  process.stderr.write('[GUARD] Cannot locate JOB_CONFIG in jobConfig.ts\n');
  process.exit(1);
}

const block = src.slice(startIdx, endIdx);
const todayEpoch = Math.floor(Date.now() / 86400000);

const errors = [];
const warnings = [];

// Build a map of jobName -> idempotencyContract text using a line-by-line
// state machine. Matches the layout convention enforced elsewhere in
// jobConfig.ts (two-space indent, single-quoted key, opening brace on the
// same line).
const entries = {};
const lines = block.split('\n');
let currentEntry = null;

for (const line of lines) {
  const entryMatch = line.match(/^ {2}'([a-z:._][a-zA-Z0-9:._-]*)': \{/);
  if (entryMatch) {
    currentEntry = entryMatch[1];
    entries[currentEntry] = { raw: '' };
    continue;
  }
  if (currentEntry && line.includes('idempotencyContract:')) {
    entries[currentEntry].contractStart = true;
  }
  if (currentEntry && entries[currentEntry].contractStart !== undefined) {
    entries[currentEntry].raw += line + '\n';
  }
  if (currentEntry && line.match(/^ {2}\},/) && entries[currentEntry].contractStart !== undefined) {
    currentEntry = null;
  }
}

for (const [name, info] of Object.entries(entries)) {
  const raw = info.raw || '';
  const verdictMatch = raw.match(/verdict:\s*'([a-z_]+)'/);
  if (!verdictMatch) continue;

  const verdict = verdictMatch[1];

  if (verdict === 'handler_tested') {
    const tablesMatch = raw.match(/comparesTables:\s*\[([^\]]*)\]/s);
    if (!tablesMatch || tablesMatch[1].trim() === '') {
      errors.push(`${name}: handler_tested missing non-empty comparesTables`);
    }
  } else if (verdict === 'external_consumer') {
    if (!raw.includes('consumer:')) errors.push(`${name}: external_consumer missing consumer`);
    if (!raw.includes('idempotencyOwner:')) errors.push(`${name}: external_consumer missing idempotencyOwner`);
  } else if (verdict === 'send_only') {
    if (!raw.includes('tracking:')) errors.push(`${name}: send_only missing tracking`);
    if (!raw.includes('addedAt:')) errors.push(`${name}: send_only missing addedAt`);
    const lifecycleMatch = raw.match(/lifecycleState:\s*'([a-z]+)'/);
    if (!lifecycleMatch) {
      errors.push(`${name}: send_only missing lifecycleState`);
    } else {
      const state = lifecycleMatch[1];
      if (state === 'transitional') {
        const reviewByMatch = raw.match(/reviewBy:\s*'([0-9]{4}-[0-9]{2}-[0-9]{2})'/);
        if (!reviewByMatch) {
          errors.push(`${name}: send_only transitional missing reviewBy`);
        } else {
          const reviewByEpoch = Math.floor(new Date(reviewByMatch[1]).getTime() / 86400000);
          if (reviewByEpoch < todayEpoch) {
            errors.push(`${name}: send_only transitional past reviewBy (${reviewByMatch[1]}) — must reclassify`);
          }
        }
      } else if (state === 'permanent') {
        if (!raw.includes('consumer:')) errors.push(`${name}: send_only permanent missing consumer`);
      } else if (state === 'experimental') {
        const addedAtMatch = raw.match(/addedAt:\s*'([0-9]{4}-[0-9]{2}-[0-9]{2})'/);
        if (addedAtMatch) {
          const addedEpoch = Math.floor(new Date(addedAtMatch[1]).getTime() / 86400000);
          const ageDays = todayEpoch - addedEpoch;
          if (ageDays > 90) {
            warnings.push(`${name}: send_only experimental for ${ageDays} days (>90d) — consider reclassifying`);
          }
        }
      }
    }
  } else if (verdict === 'exempt') {
    if (!raw.includes('reason:')) errors.push(`${name}: exempt missing reason`);
    if (!raw.includes('owner:')) errors.push(`${name}: exempt missing owner`);
    if (!raw.includes('reviewBy:')) errors.push(`${name}: exempt missing reviewBy`);
  }
}

if (errors.length > 0) {
  process.stderr.write('VERDICT_ERRORS:' + errors.join('|') + '\n');
}
if (warnings.length > 0) {
  process.stderr.write('VERDICT_WARNINGS:' + warnings.join('|') + '\n');
}
process.exit(errors.length > 0 ? 1 : 0);
