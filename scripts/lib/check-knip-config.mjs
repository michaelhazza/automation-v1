/**
 * check-knip-config.mjs
 *
 * Checks that knip.json's entry list intersects each required dynamic-entry surface.
 * Called by verify-knip-config.sh via: KNIP_CONFIG_FILE=<path> node check-knip-config.mjs
 *
 * Exits 0 if all surfaces are covered, 1 otherwise (violation count written to stdout).
 */

import { readFileSync } from 'node:fs';

const configPath = process.env.KNIP_CONFIG_FILE;
if (!configPath) {
  process.stderr.write('KNIP_CONFIG_FILE env var not set\n');
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const entries = config.entry ?? [];

/**
 * Returns true if an entry glob covers the given sample path.
 * Only handles single-segment * globs (not **).
 * @param {string} entry
 * @param {string} sample
 */
function covers(entry, sample) {
  if (entry === sample) return true;
  // Escape all regex special chars except *, then replace * with [^/]*
  const re = entry
    .replace(/[-[\]{}()+?.,\\^$|#\s]/g, '\\$&')
    .replace(/\*/g, '[^/]*');
  return new RegExp('^' + re + '$').test(sample);
}

const required = [
  { label: 'server entry (server/index.ts)',                 sample: 'server/index.ts' },
  { label: 'client entry (client/src/main.tsx)',             sample: 'client/src/main.tsx' },
  { label: 'worker entry (worker/src/index.ts)',             sample: 'worker/src/index.ts' },
  { label: 'hooks (.claude/hooks/*.js)',                     sample: '.claude/hooks/config-protection.js' },
  { label: 'server/config registries (server/config/*.ts)',  sample: 'server/config/modelRegistry.ts' },
  { label: 'fixture files (scripts/__fixtures__/*)',         sample: 'scripts/__fixtures__/example.ts' },
];

let violations = 0;
for (const { label, sample } of required) {
  const matched = entries.some((e) => covers(e, sample));
  if (!matched) {
    process.stderr.write('❌ knip.json entry list does not cover: ' + label + '\n');
    violations++;
  }
}

process.stdout.write(String(violations) + '\n');
