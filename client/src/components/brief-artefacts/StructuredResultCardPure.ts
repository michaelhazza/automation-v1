// Phase 5 / W2b — Pure data-transform helpers for StructuredResultCard.

import type { BriefStructuredResult } from '../../../../shared/types/briefResultContract.js';

export interface DerivedColumn {
  key: string;
  label: string;
}

/**
 * Derives the column list for a structured-result table.
 * Uses artefact.columns when present; falls back to the keys of the first row.
 */
export function deriveColumns(artefact: Pick<BriefStructuredResult, 'columns' | 'rows'>): DerivedColumn[] {
  if (artefact.columns && artefact.columns.length > 0) return artefact.columns;
  if (artefact.rows.length > 0) {
    return Object.keys(artefact.rows[0]).map((k) => ({ key: k, label: k }));
  }
  return [];
}

/**
 * Returns a human-readable truncation notice, or null when the result is complete.
 */
export function deriveTruncationNotice(
  artefact: Pick<BriefStructuredResult, 'truncated' | 'rows' | 'rowCount'>,
): string | null {
  if (!artefact.truncated) return null;
  return `Showing ${artefact.rows.length} of ${artefact.rowCount} results`;
}
