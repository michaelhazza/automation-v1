/**
 * loc-cap-pure.mjs
 *
 * Pure-logic helper for the LoC-cap gate (P3).
 *
 * Public API:
 *   applyCaps({ files, caps, exclusions }) → { soft: string[], hard: string[] }
 *
 *   files      — Map<relPath, lineCount>  (numbers, not file content)
 *   caps       — LayerCap[]  (see typedef below)
 *   exclusions — string[]    (relative paths that are excluded from caps)
 *
 * isExcluded({ relPath, exclusions }) → boolean
 *
 * matchLayer({ relPath, caps }) → LayerCap | null
 *
 * No filesystem I/O in this module — callers supply file data.
 * Used by verify-loc-cap.sh via Node --input-type=module inline scripts
 * and by the Vitest harness at scripts/__tests__/loc-cap-pure.test.ts.
 *
 * LoC caps (from docs/codebase-audit-framework.md § Area 10):
 *   server/services/*.ts   soft=1500  hard=2500
 *   server/routes/*.ts     soft=800   hard=1500
 *   client/src/pages/*.tsx soft=600   hard=1200
 *   client/src/components/*.tsx soft=400 hard=800
 *   shared/... /*.ts        soft=500   hard=1000
 */

/**
 * @typedef {{ glob: string, pattern: RegExp, soft: number, hard: number }} LayerCap
 */

/** Canonical per-layer caps matching docs/codebase-audit-framework.md § Area 10. */
export const LAYER_CAPS = [
  { glob: 'server/services/*.ts',        pattern: /^server\/services\/[^/]+\.ts$/, soft: 1500, hard: 2500 },
  { glob: 'server/routes/*.ts',          pattern: /^server\/routes\/[^/]+\.ts$/,   soft: 800,  hard: 1500 },
  { glob: 'client/src/pages/*.tsx',      pattern: /^client\/src\/pages\/[^/]+\.tsx$/, soft: 600, hard: 1200 },
  { glob: 'client/src/components/*.tsx', pattern: /^client\/src\/components\/[^/]+\.tsx$/, soft: 400, hard: 800 },
  { glob: 'shared/**/*.ts',              pattern: /^shared\/.+\.ts$/,               soft: 500,  hard: 1000 },
];

/**
 * Returns true when relPath should be excluded from LoC-cap checks.
 *
 * Exclusion rules (from spec §P3):
 *   - server/db/schema/*.ts
 *   - server/config/rlsProtectedTables.ts
 *   - filename ends with .generated.ts
 *   - file is in the exclusions allow-list (caller-supplied)
 *   - migrations/*.sql
 *   - tasks/** or docs/**
 *
 * Note: generated-file detection by AUTO-GENERATED header requires file
 * content, which callers supply separately (isGeneratedContent helper).
 *
 * @param {{ relPath: string, exclusions: string[] }} opts
 * @returns {boolean}
 */
export function isExcluded({ relPath, exclusions }) {
  if (relPath.match(/^server\/db\/schema\//)) return true;
  if (relPath === 'server/config/rlsProtectedTables.ts') return true;
  if (relPath.endsWith('.generated.ts')) return true;
  if (relPath.match(/^migrations\//)) return true;
  if (relPath.match(/^tasks\//)) return true;
  if (relPath.match(/^docs\//)) return true;
  if (exclusions.includes(relPath)) return true;
  return false;
}

/**
 * Returns true when the file starts with the AUTO-GENERATED header marker.
 *
 * @param {string} firstLine  The first line of the file (trim before passing).
 * @returns {boolean}
 */
export function isGeneratedContent(firstLine) {
  return firstLine.trimStart().startsWith('// AUTO-GENERATED');
}

/**
 * Returns the matching LayerCap for a given relative path, or null if none apply.
 *
 * @param {{ relPath: string, caps: LayerCap[] }} opts
 * @returns {LayerCap | null}
 */
export function matchLayer({ relPath, caps }) {
  for (const cap of caps) {
    if (cap.pattern.test(relPath)) return cap;
  }
  return null;
}

/**
 * Apply LoC caps to a set of files.
 *
 * @param {{
 *   files: Map<string, number>,
 *   caps?: LayerCap[],
 *   exclusions?: string[],
 * }} opts
 *   files      — Map<relPath, lineCount>
 *   caps       — defaults to LAYER_CAPS
 *   exclusions — additional paths to exclude beyond the built-in rules
 * @returns {{ soft: string[], hard: string[] }}
 *   soft — relPaths where lineCount > soft cap but <= hard cap
 *   hard — relPaths where lineCount > hard cap
 */
export function applyCaps({ files, caps = LAYER_CAPS, exclusions = [] }) {
  const soft = [];
  const hard = [];

  for (const [relPath, lineCount] of files) {
    if (isExcluded({ relPath, exclusions })) continue;
    const layer = matchLayer({ relPath, caps });
    if (!layer) continue;

    if (lineCount > layer.hard) {
      hard.push(relPath);
    } else if (lineCount > layer.soft) {
      soft.push(relPath);
    }
  }

  return { soft, hard };
}
