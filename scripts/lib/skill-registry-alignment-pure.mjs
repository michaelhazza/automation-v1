/**
 * skill-registry-alignment-pure.mjs
 *
 * Pure-logic helpers for PP-SK1 verify-skill-registry-alignment.sh.
 * Compares ACTION_REGISTRY snapshot keys against .md files under server/skills/.
 *
 * Naming rule (W4AA-DEBT-2): action type X.Y → file X_Y.md (dots → underscores).
 * Excluded from analysis: server/skills/README.md, server/skills/__tests__/**.
 *
 * Exported functions are imported by:
 *   - scripts/verify-skill-registry-alignment.sh (via node --input-type=module)
 *   - scripts/__tests__/skill-registry-alignment-pure.test.ts (Vitest)
 *
 * No TS parsing required — the snapshot is JSON and the skills dir is a simple
 * directory tree with .md files.
 */

import { readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

/**
 * Convert a registry action-type key to the expected .md filename.
 * Rule: dots replaced with underscores, then append .md.
 * Example: 'send.email' → 'send_email.md'
 *
 * @param {string} key  registry entry key (e.g. 'web.search' or 'ask_clarifying_question')
 * @returns {string}    expected filename (e.g. 'web_search.md')
 */
export function keyToFilename(key) {
  return key.replace(/\./g, '_') + '.md';
}

/**
 * Convert a .md filename back to the dot-form action-type key for lookup.
 * Rule: remove .md suffix, underscores may be dots OR remain underscores.
 * Returns both dot-form and underscore-form so the caller can check either.
 *
 * @param {string} filename  e.g. 'web_search.md'
 * @returns {{ dotForm: string, underscoreForm: string }}
 */
export function filenameToCandidateKeys(filename) {
  const stem = basename(filename, '.md');
  return {
    dotForm: stem.replace(/_/g, '.'),
    underscoreForm: stem,
  };
}

/**
 * Recursively walk a directory and return all .md filenames (basename only),
 * excluding README.md and anything inside a __tests__ directory.
 *
 * @param {string} dir  absolute path to walk
 * @returns {string[]}  array of filenames (not full paths)
 */
export function walkSkillsMd(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name === '__tests__') continue;
      results.push(...walkSkillsMd(join(dir, e.name)));
    } else if (e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md') {
      results.push(e.name);
    }
  }
  return results;
}

/**
 * Compute the set of mismatches between registry keys and skill .md files.
 *
 * @param {{ entries: Record<string, unknown> }} snapshot  parsed action-registry snapshot
 * @param {string[]} actualFiles  filenames from walkSkillsMd (or a fixture array)
 * @returns {{ type: 'REGISTRY' | 'SKILL_FILE', key: string, message: string }[]}
 */
export function computeMismatches(snapshot, actualFiles) {
  const registryKeys = Object.keys(snapshot.entries);

  // Registry keys → expected filenames
  const expectedFromRegistry = new Map(
    registryKeys.map(k => [keyToFilename(k), k])
  );

  const actualFilesSet = new Set(actualFiles);
  const mismatches = [];

  // Registry keys with no corresponding .md file
  for (const [expectedFile, key] of expectedFromRegistry) {
    if (!actualFilesSet.has(expectedFile)) {
      mismatches.push({
        type: 'REGISTRY',
        key,
        message: `registry entry has no .md file (expected server/skills/${expectedFile})`,
      });
    }
  }

  // .md files with no corresponding registry entry
  for (const file of actualFilesSet) {
    const { dotForm, underscoreForm } = filenameToCandidateKeys(file);
    if (!snapshot.entries[dotForm] && !snapshot.entries[underscoreForm]) {
      mismatches.push({
        type: 'SKILL_FILE',
        key: file,
        message: `.md file has no registry entry (tried: ${dotForm}, ${underscoreForm})`,
      });
    }
  }

  return mismatches;
}
