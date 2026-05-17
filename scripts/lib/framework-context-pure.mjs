/**
 * framework-context-pure.mjs
 *
 * Pure-logic helpers for P13 verify-framework-context-block.sh.
 * Parses the §2 AutomationOS context block table in codebase-audit-framework.md,
 * extracts declared versions, and cross-references them against package.json.
 *
 * Comparison strategy: EXACT STRING MATCH after trimming whitespace.
 * The declared value in the markdown table must match the package.json entry verbatim
 * (including the `^` or `~` prefix). If a declared value wraps prose (e.g. "Vitest
 * (`vitest run` via ...)"), the gate extracts the package version embedded with
 * a `` `^X.Y.Z` `` pattern and compares that substring.
 *
 * This means: a PR that bumps typescript in package.json from `^5.3.3` to `^5.4.0`
 * MUST also update the §2 table row. If it doesn't, the gate emits a violation.
 *
 * Exported functions are imported by:
 *   - scripts/verify-framework-context-block.sh (via node --input-type=module)
 *   - scripts/__tests__/framework-context-pure.test.ts (Vitest)
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Map from human-readable fact name (as it appears in the §2 table "Item" column)
 * to the package.json key that is the source of truth for that fact.
 *
 * Only facts that have a package.json source of truth are included here.
 * Rows like "Repo", "Module system", "Layer model" have no package.json source
 * and are not cross-checked by this gate.
 */
export const PACKAGE_JSON_FACT_MAP = {
  'TypeScript': 'typescript',
  'Server runtime': 'express',       // extract Express version from prose
  'Client runtime': ['react', 'vite'], // extract React + Vite versions from prose
  'Styling': 'tailwindcss',
  'ORM': 'drizzle-orm',
  'Queue': 'pg-boss',
  'Realtime': 'socket.io',
  'Validation': 'zod',
  'Browser automation': 'playwright', // or @playwright/test
  'Agent SDK': '@modelcontextprotocol/sdk',
  'Observability': 'langfuse',
  'Test framework': 'vitest',
};

/**
 * Parse the §2 context block table from the markdown content.
 * Finds rows of shape: `| <Item> | <Value> |` inside the §2 section.
 *
 * @param {string} md  full content of docs/codebase-audit-framework.md
 * @returns {{ fact: string, declaredValue: string }[]}
 */
export function parseFrameworkContextBlock(md) {
  // Find the §2 section
  const section2Match = md.match(/##\s+2\.\s+AutomationOS context block([\s\S]*?)(?=\n##\s+3\.)/);
  if (!section2Match) return [];

  const sectionText = section2Match[1];
  const results = [];

  // Extract table rows: | Item | Value |
  // Table rows look like: | Fact name | Value text |
  // Skip the header row (| Item | Value |) and separator row (|---|---|)
  const rowRe = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm;
  let m;
  while ((m = rowRe.exec(sectionText)) !== null) {
    const fact = m[1].trim();
    const value = m[2].trim();
    // Skip header and separator rows
    if (fact === 'Item' || /^[-:]+$/.test(fact)) continue;
    results.push({ fact, declaredValue: value });
  }

  return results;
}

/**
 * Extract the version string for a given package from package.json.
 * Searches dependencies, devDependencies, and optionalDependencies in that order.
 *
 * @param {object} pkg  parsed package.json content
 * @param {string} packageName  npm package name
 * @returns {string | null}  version string (e.g. "^5.3.3") or null
 */
export function extractPackageVersion(pkg, packageName) {
  const sources = [
    pkg.dependencies,
    pkg.devDependencies,
    pkg.optionalDependencies,
  ];
  for (const source of sources) {
    if (source && source[packageName]) {
      return source[packageName];
    }
  }
  return null;
}

/**
 * Extract all relevant package versions from package.json.
 * Returns a map of fact names (matching PACKAGE_JSON_FACT_MAP keys) → package version string.
 *
 * @param {object} pkg  parsed package.json content
 * @returns {Record<string, string>}  fact name → version from package.json (or null if not found)
 */
export function extractPackageJsonVersions(pkg) {
  const result = {};
  for (const [fact, pkgName] of Object.entries(PACKAGE_JSON_FACT_MAP)) {
    if (Array.isArray(pkgName)) {
      // For compound facts (e.g. Client runtime has React + Vite)
      // store a map of packageName → version; the comparator uses these
      const subVersions = {};
      for (const p of pkgName) {
        subVersions[p] = extractPackageVersion(pkg, p);
      }
      result[fact] = subVersions;
    } else {
      result[fact] = extractPackageVersion(pkg, pkgName);
    }
  }
  return result;
}

/**
 * Extract a backtick-quoted version string (like `^5.3.3`) from a prose value cell.
 * The §2 table embeds version numbers inside backticks within prose.
 *
 * Examples:
 *   "Node + Express `^4.18.2`, dev via ..."  → ["^4.18.2"]
 *   "React `^18.2.0` + Vite `^5.4.21` ..."  → ["^18.2.0", "^5.4.21"]
 *   "**pg-boss `^9.0.3` is canonical** ..."  → ["^9.0.3"]
 *   "`^5.3.3`"                               → ["^5.3.3"]
 *
 * @param {string} value  raw markdown prose from a table cell
 * @returns {string[]}  array of extracted version strings
 */
export function extractVersionsFromProse(value) {
  const re = /`([~^]?\d+\.\d+[.\d]*)`/g;
  const found = [];
  let m;
  while ((m = re.exec(value)) !== null) {
    found.push(m[1]);
  }
  return found;
}

/**
 * Compare a declared value (prose from the markdown table cell) against the
 * actual versions from package.json.
 *
 * Strategy:
 * - Extract backtick-quoted version strings from the declared prose.
 * - For each version string found, look up its match in pkgVersions by
 *   matching the package that owns that version number.
 * - Return 'match' if every extracted version appears somewhere in pkgVersions.
 * - Return 'drift' if any version is missing or doesn't match.
 *
 * For compound facts (e.g. Client runtime: React + Vite), pkgVersions is an
 * object of { packageName: version }; we check each version extracted appears
 * in one of those values.
 *
 * @param {string} declaredValue  prose string from the §2 table cell
 * @param {string | object | null} pkgVersions  version from package.json (or null, or object for compound facts)
 * @returns {'match' | 'drift' | 'no-source'}
 */
export function compareVersions(declaredValue, pkgVersions) {
  if (pkgVersions === null || pkgVersions === undefined) {
    return 'no-source';
  }

  const extracted = extractVersionsFromProse(declaredValue);
  if (extracted.length === 0) {
    // No version embedded in the prose — the row has no version to check
    return 'match';
  }

  // Gather the actual version strings from package.json
  let actualVersions;
  if (typeof pkgVersions === 'object' && !Array.isArray(pkgVersions)) {
    // Compound fact: object of { packageName: version }
    actualVersions = Object.values(pkgVersions).filter(Boolean);
  } else {
    actualVersions = [pkgVersions].filter(Boolean);
  }

  // Every extracted version must appear in one of the actualVersions
  for (const v of extracted) {
    if (!actualVersions.includes(v)) {
      return 'drift';
    }
  }
  return 'match';
}

/**
 * Run the full framework-context comparison: parse the markdown, extract package.json
 * versions, and return violations (drift rows).
 *
 * @param {string} md   content of docs/codebase-audit-framework.md
 * @param {object} pkg  parsed package.json
 * @returns {{ fact: string, declaredValue: string, actualVersion: string | null, result: 'match' | 'drift' | 'no-source' }[]}
 */
export function compareFrameworkContext(md, pkg) {
  const tableRows = parseFrameworkContextBlock(md);
  const pkgVersions = extractPackageJsonVersions(pkg);

  return tableRows
    .filter(({ fact }) => fact in PACKAGE_JSON_FACT_MAP)
    .map(({ fact, declaredValue }) => {
      const actual = pkgVersions[fact] ?? null;
      const result = compareVersions(declaredValue, actual);
      const actualStr = actual
        ? (typeof actual === 'object' ? JSON.stringify(actual) : actual)
        : null;
      return { fact, declaredValue, actualVersion: actualStr, result };
    });
}

/**
 * Load and run the full gate against the live files.
 *
 * @param {string} repoRoot  absolute path to repo root
 * @returns {{ fact: string, declaredValue: string, actualVersion: string | null, result: 'match' | 'drift' | 'no-source' }[]}
 */
export function runFrameworkContextGate(repoRoot) {
  const md = readFileSync(
    join(repoRoot, 'docs', 'codebase-audit-framework.md'),
    'utf8'
  );
  const pkg = JSON.parse(
    readFileSync(join(repoRoot, 'package.json'), 'utf8')
  );
  return compareFrameworkContext(md, pkg);
}
