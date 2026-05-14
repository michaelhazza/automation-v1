/**
 * frontend-design-allowlist-pure.mjs
 *
 * Pure-logic helpers for the frontend-design-budget gate (P8).
 *
 * Public API:
 *   isInAllowlist({ file, allowlist }) → boolean
 *   scanImports({ content, components }) → string[]
 *
 * No filesystem I/O in this module — callers supply file paths and content.
 * Used by verify-frontend-design-budget.sh via Node inline scripts
 * and by the Vitest harness at scripts/__tests__/frontend-design-allowlist-pure.test.ts.
 *
 * Monitored components (enterprise/admin dashboard components):
 *   MetricCard, RunActivityChart, SuccessRateChart, SparkLine,
 *   PnlKpiCard, PnlSparkline, PnlTrendChart,
 *   SparklineChart, SpendTrendChart
 *
 * Files importing any of these must appear in docs/frontend-design-allowlist.json.
 * No per-line suppression — the allow-list is the suppression surface.
 */

/**
 * @typedef {{ path: string, components: string[], reason: string }} AllowlistEntry
 * @typedef {{ _doc?: string, files: AllowlistEntry[] }} AllowlistJson
 */

/**
 * Returns true when the given file path appears in the allow-list.
 *
 * @param {{ file: string, allowlist: AllowlistJson }} opts
 * @returns {boolean}
 */
export function isInAllowlist({ file, allowlist }) {
  if (!allowlist || !Array.isArray(allowlist.files)) return false;
  return allowlist.files.some(entry => entry.path === file);
}

/**
 * Scans file content for import statements referencing any of the given component names.
 * Returns the list of component names found imported in the file.
 *
 * Matches both default and named import patterns:
 *   import MetricCard from '...'
 *   import { MetricCard } from '...'
 *   import MetricCard, { Foo } from '...'
 *
 * @param {{ content: string, components: string[] }} opts
 * @returns {string[]}  Component names found in the file's imports
 */
export function scanImports({ content, components }) {
  const found = [];
  for (const component of components) {
    // Match: import <component> from, import { ...<component>... } from, import <component>, { from
    const pattern = new RegExp(
      `\\bimport\\b[^;]*\\b${escapeRegex(component)}\\b[^;]*from\\s+['"]`,
      's'
    );
    if (pattern.test(content)) {
      found.push(component);
    }
  }
  return found;
}

/**
 * Escape a string for use in a RegExp.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
