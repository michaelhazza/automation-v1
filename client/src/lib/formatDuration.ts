/**
 * formatDuration.ts — Brain Tree OS adoption P3.
 *
 * Shared duration formatter. Hoisted from RunTraceViewerPage so multiple
 * consumers (session log card list, run trace viewer) use the same format.
 *
 * Spec: docs/brain-tree-os-adoption-spec.md §P3
 */

export function formatDuration(ms: number | null): string {
  if (ms == null) return '--';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}
