/**
 * universal-skill-sync-pure.mjs
 *
 * Pure-logic helpers for P7 verify-universal-skill-sync.sh.
 * Compares UNIVERSAL_SKILL_NAMES against ACTION_REGISTRY entries with isUniversal: true.
 *
 * Exported functions are imported by:
 *   - scripts/verify-universal-skill-sync.sh (via node --input-type=module)
 *   - scripts/__tests__/universal-skill-sync-pure.test.ts (Vitest)
 *
 * No TS parsing: the two source files follow stable literal-array and object-literal
 * patterns that are safely extracted with targeted regex without an AST.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Extract the UNIVERSAL_SKILL_NAMES string array from universalSkills.ts.
 * Pattern: export const UNIVERSAL_SKILL_NAMES: readonly string[] = [ ... ];
 *
 * @param {string} repoRoot  absolute path to repo root
 * @returns {string[]}
 */
export function loadUniversalSkillNames(repoRoot) {
  const filePath = join(repoRoot, 'server', 'config', 'universalSkills.ts');
  const text = readFileSync(filePath, 'utf8');
  return parseUniversalSkillNames(text);
}

/**
 * Pure parser: extract skill names from the file text.
 * Exported for direct testing without filesystem access.
 *
 * @param {string} text  content of universalSkills.ts
 * @returns {string[]}
 */
export function parseUniversalSkillNames(text) {
  // Match: UNIVERSAL_SKILL_NAMES ... = [ ... ] (multiline)
  const arrayMatch = text.match(
    /UNIVERSAL_SKILL_NAMES[^=]*=\s*\[([\s\S]*?)\]/
  );
  if (!arrayMatch) return [];

  const inner = arrayMatch[1];
  // Extract each quoted string literal
  const names = [];
  const re = /['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(inner)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/**
 * Walk the actionRegistry directory and collect entries where isUniversal: true.
 * Reads all .ts files under server/config/actionRegistry/ (excluding types.ts, index.ts,
 * factories.ts, and __tests__/) since those don't contain registry entries with isUniversal.
 *
 * Strategy: regex scan for `isUniversal: true` and look back at the nearest preceding
 * action key (property name at depth-0 of the export object, e.g. `ask_clarifying_question:`).
 * This is robust enough for the current registry shape.
 *
 * @param {string} repoRoot  absolute path to repo root
 * @returns {{ name: string, isUniversal: boolean }[]}
 */
export function loadActionRegistrySnapshot(repoRoot) {
  const registryDir = join(repoRoot, 'server', 'config', 'actionRegistry');
  // Files that contain action entries with isUniversal
  const entryFiles = [
    join(registryDir, 'core.ts'),
    join(registryDir, 'intelligence.ts'),
    join(registryDir, 'methodology.ts'),
    join(registryDir, 'agents.ts'),
    join(registryDir, 'clientpulse.ts'),
    join(registryDir, 'commerce.ts'),
    join(registryDir, 'configuration.ts'),
    join(registryDir, 'support.ts'),
    join(registryDir, 'calendar.ts'),
    join(registryDir, 'slack.ts'),
  ];

  const universal = [];
  for (const filePath of entryFiles) {
    let text;
    try {
      text = readFileSync(filePath, 'utf8');
    } catch {
      continue; // file may not exist for all deployments
    }
    const entries = parseRegistryFileForUniversal(text);
    universal.push(...entries);
  }
  return universal;
}

/**
 * Pure parser: extract entries with isUniversal: true from a registry file's text.
 * Exported for testing.
 *
 * Strategy: find all occurrences of `isUniversal: true`, then scan backwards to
 * find the nearest top-level action key (line matching /^\s{2}(\w+):\s*[{(]/ or
 * a defineXxx({ slug: 'name', call pattern).
 *
 * @param {string} text  content of a registry entry file
 * @returns {{ name: string, isUniversal: boolean }[]}
 */
export function parseRegistryFileForUniversal(text) {
  const lines = text.split('\n');
  const results = [];

  for (let i = 0; i < lines.length; i++) {
    if (!/isUniversal:\s*true/.test(lines[i])) continue;

    // Scan backwards for the action name
    const name = findActionNameBefore(lines, i);
    if (name) {
      results.push({ name, isUniversal: true });
    }
  }

  return results;
}

/**
 * Scan lines[0..before] backwards to find the nearest action name.
 * Handles two patterns:
 *   (A) Top-level object key:  `  ask_clarifying_question: {`
 *   (B) defineXxx({ slug: 'search_agent_history',`
 *
 * @param {string[]} lines
 * @param {number} before  index of the isUniversal line
 * @returns {string | null}
 */
function findActionNameBefore(lines, before) {
  for (let j = before - 1; j >= 0; j--) {
    const line = lines[j];

    // Pattern B: slug: 'name'
    const slugMatch = line.match(/\bslug:\s*['"](\w+)['"]/);
    if (slugMatch) return slugMatch[1];

    // Pattern A: top-level key at 2-space indent (property of the exports object)
    const keyMatch = line.match(/^ {2}(\w+):\s*[{(]/);
    if (keyMatch) return keyMatch[1];

    // Stop at export boundary
    if (/^export\s+const\s+/.test(line)) break;
  }
  return null;
}

/**
 * Compute bidirectional set diff between UNIVERSAL_SKILL_NAMES and registry universals.
 *
 * @param {{ names: string[], registry: { name: string, isUniversal: boolean }[] }} params
 * @returns {{ onlyInNames: string[], onlyInRegistry: string[] }}
 */
export function diffUniversalSkills({ names, registry }) {
  const namesSet = new Set(names);
  const registrySet = new Set(registry.filter(r => r.isUniversal).map(r => r.name));

  const onlyInNames = [...namesSet].filter(n => !registrySet.has(n));
  const onlyInRegistry = [...registrySet].filter(n => !namesSet.has(n));

  return { onlyInNames, onlyInRegistry };
}
