/**
 * types-used-pure.mjs
 *
 * Pure-logic helpers for P14 verify-types-used.sh.
 * Walks shared/types/*.ts to find exported types, interfaces, and consts;
 * checks whether each is referenced by server/, client/, or worker/ code
 * (or appears as part of a discriminated union in other shared/types/ files).
 *
 * Suppression: a per-export `guard-ignore: types-used reason="..."` annotation
 * on or directly above the export line suppresses that export.
 *
 * Exported functions are imported by:
 *   - scripts/verify-types-used.sh (via node --input-type=module)
 *   - scripts/__tests__/types-used-pure.test.ts (Vitest)
 *
 * Explicitly excludes migrations/ per spec §13 Q4.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Strip re-export-only lines (which should NOT count as "usage" of a type)
 * from a TypeScript source. Re-exports are export declarations that name
 * a SOURCE module via `from '...'` — they propagate a type from another file
 * without consuming it locally. Barrel files (e.g. `shared/types/index.ts`)
 * are full of these and would otherwise mask genuinely-unused types.
 *
 * Handles:
 *   export { Foo } from '...';
 *   export { Foo, Bar } from '...';
 *   export type { Foo } from '...';
 *   export { Foo as Bar } from '...';
 *   export type { Foo as Bar } from '...';
 *   export * from '...';
 *   export * as Ns from '...';
 *   multi-line variants of the named-list form.
 *
 * Direct exports (export const, export type X = ..., export interface, etc.)
 * are NOT stripped — those are real declarations the type appears in
 * locally and should count if matched.
 *
 * @param {string} text
 * @returns {string}  text with re-export blocks removed
 */
export function stripReExports(text) {
  return text
    // export { ... } from '...';   (single- or multi-line; allow inner whitespace and commas)
    .replace(/export\s+(?:type\s+)?\{[\s\S]*?\}\s+from\s+['"][^'"]+['"]\s*;?/g, '')
    // export * from '...';  /  export * as Ns from '...';
    .replace(/export\s+\*(?:\s+as\s+[A-Za-z_$][A-Za-z0-9_$]*)?\s+from\s+['"][^'"]+['"]\s*;?/g, '');
}

/**
 * Collect all exported type/interface/const names from a single .ts file.
 * Also checks for per-export guard-ignore suppression.
 *
 * Patterns handled:
 *   export type Foo = ...
 *   export interface Foo { ... }
 *   export const Foo = ...
 *   export enum Foo { ... }
 *
 * Skipped (re-exports — not original definitions):
 *   export { Foo }
 *   export type { Foo }
 *   export * from ...
 *
 * @param {string} filePath   absolute path to the .ts file
 * @param {string} repoRoot   absolute path to repo root (for relative path in output)
 * @returns {{ file: string, name: string, line: number, suppressed: boolean }[]}
 */
export function collectExportsFromFile(filePath, repoRoot) {
  const text = readFileSync(filePath, 'utf8');
  const lines = text.split('\n');
  const results = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip re-exports: `export { Foo }` / `export type { Foo }` / `export * from`
    if (/^export\s+(type\s+)?\{/.test(line) || /^export\s+\*/.test(line)) {
      continue;
    }

    // Match named exports: export type, export interface, export const, export enum
    const match = line.match(/^export\s+(?:type\s+|interface\s+|const\s+|enum\s+)(\w+)/);
    if (!match) continue;

    const name = match[1];
    const lineNumber = i + 1;
    const suppressed = isExportSuppressed(lines, i);
    const relFile = relative(repoRoot, filePath).replace(/\\/g, '/');

    results.push({ file: relFile, name, line: lineNumber, suppressed });
  }

  return results;
}

/**
 * Check whether the export at lineIndex has a guard-ignore: types-used annotation.
 * Checks the export line itself and the line immediately above it.
 *
 * @param {string[]} lines
 * @param {number} lineIndex  0-based
 * @returns {boolean}
 */
export function isExportSuppressed(lines, lineIndex) {
  const suppressionRe = /guard-ignore(?:-next-line)?:\s*types-used/;

  // Same-line annotation
  if (suppressionRe.test(lines[lineIndex])) return true;

  // Previous-line annotation
  if (lineIndex > 0 && suppressionRe.test(lines[lineIndex - 1])) return true;

  return false;
}

/**
 * Collect all exported types from all .ts files under shared/types/.
 *
 * @param {string} repoRoot  absolute path to repo root
 * @returns {{ file: string, name: string, line: number, suppressed: boolean }[]}
 */
export function collectExportedTypes(repoRoot) {
  const typesDir = join(repoRoot, 'shared', 'types');
  let files;
  try {
    files = readdirSync(typesDir).filter(f => f.endsWith('.ts'));
  } catch {
    return [];
  }

  const all = [];
  for (const f of files) {
    const filePath = join(typesDir, f);
    const exports = collectExportsFromFile(filePath, repoRoot);
    all.push(...exports);
  }
  return all;
}

/**
 * Scan server/, client/, and worker/ source code for references to a given type name.
 * Also checks other shared/types/ files (for discriminated union references),
 * but explicitly EXCLUDES the declaring file itself.
 *
 * A reference in the declaring file (e.g. the type used in its own union) counts as
 * self-referential and NOT a reference for gate purposes. The gate cares whether
 * EXTERNAL code uses the type.
 *
 * Strategy: use ripgrep (rg) if available; fall back to recursive Node scan.
 *
 * @param {string} repoRoot      absolute path to repo root
 * @param {string} name          type/interface/const name to search for
 * @param {string} declaringFile relative path of the file that declares the export (to exclude)
 * @returns {boolean}  true if referenced externally
 */
export function scanReferences(repoRoot, name, declaringFile) {
  // Word-boundary pattern
  const pattern = `\\b${name}\\b`;

  // Scan production code dirs (server, client, worker)
  // and other shared/types/ files — but NOT the declaring file itself.
  const scanDirs = [
    join(repoRoot, 'server'),
    join(repoRoot, 'client'),
    join(repoRoot, 'worker'),
    join(repoRoot, 'shared'),
  ];

  const declaringAbsolute = join(repoRoot, declaringFile);

  // Use rg if available, with -l (files-with-matches) so we can re-verify each
  // candidate file by stripping its re-export lines before testing for the
  // type name. A raw `--quiet` match would false-positive on barrel files like
  // `shared/types/index.ts` that re-export the type without consuming it.
  // spawnSync avoids shell quoting issues on Windows.
  const rgResult = spawnSync(
    'rg',
    [
      '-l',
      '--glob', '*.ts',
      '--glob', '*.tsx',
      '--glob', `!${declaringFile}`,
      '-e', pattern,
      ...scanDirs,
    ],
    { stdio: 'pipe', encoding: 'utf8' }
  );
  if (rgResult.error === undefined) {
    // rg ran: status 0 = found, 1 = not found, 2+ = error
    if (rgResult.status === 1) return false;
    if (rgResult.status === 0) {
      const candidateFiles = rgResult.stdout.split('\n').filter(Boolean);
      const re = new RegExp(`\\b${name}\\b`);
      for (const file of candidateFiles) {
        try {
          const text = readFileSync(file, 'utf8');
          if (re.test(stripReExports(text))) return true;
        } catch { /* skip unreadable */ }
      }
      return false;
    }
    // status 2+ = rg error — fall through to Node scan
  }
  // rg not available — fall through to Node scan

  return scanReferencesNode(repoRoot, name, declaringAbsolute, scanDirs);
}

/**
 * Pure Node.js fallback reference scanner.
 * Recursively reads .ts and .tsx files under scanDirs,
 * skipping the declaring file, and checks for word-boundary occurrence.
 *
 * @param {string} repoRoot
 * @param {string} name
 * @param {string} declaringAbsolute  absolute path of the declaring file (excluded)
 * @param {string[]} scanDirPaths  absolute dir paths to scan
 * @returns {boolean}
 */
export function scanReferencesNode(repoRoot, name, declaringAbsolute, scanDirPaths) {
  const re = new RegExp(`\\b${name}\\b`);

  for (const dirPath of scanDirPaths) {
    if (searchDirForPattern(dirPath, re, declaringAbsolute)) return true;
  }
  return false;
}

/**
 * Recursive search of a directory for a regex pattern in .ts/.tsx files.
 * Skips the declaring file.
 *
 * @param {string} dirPath
 * @param {RegExp} re
 * @param {string} excludeFile  absolute path to exclude
 * @returns {boolean}
 */
function searchDirForPattern(dirPath, re, excludeFile) {
  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      if (searchDirForPattern(fullPath, re, excludeFile)) return true;
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      if (fullPath === excludeFile) continue;
      try {
        const text = readFileSync(fullPath, 'utf8');
        // Strip barrel re-exports first — they propagate the type without consuming it.
        if (re.test(stripReExports(text))) return true;
      } catch {
        // skip unreadable files
      }
    }
  }
  return false;
}

/**
 * Run the full P14 check: collect exports, scan references, return unreferenced ones.
 * Suppressed exports are excluded from the result.
 *
 * @param {string} repoRoot  absolute path to repo root
 * @returns {{ file: string, name: string, line: number }[]}  unreferenced + unsuppressed exports
 */
export function findUnreferencedExports(repoRoot) {
  const exports = collectExportedTypes(repoRoot);
  const unreferenced = [];

  for (const exp of exports) {
    if (exp.suppressed) continue;
    if (!scanReferences(repoRoot, exp.name, exp.file)) {
      unreferenced.push({ file: exp.file, name: exp.name, line: exp.line });
    }
  }

  return unreferenced;
}
