/**
 * workspaceHealthServicePure.ts — Brain Tree OS adoption P4 pure runner.
 *
 * Walks every detector in `ALL_DETECTORS`, concatenates findings,
 * deduplicates by `(detector, resourceId)` (defensive — detectors should
 * never overlap, but the cross-detector dedup is cheap insurance), and
 * computes the diff against the previously-recorded finding set so the
 * impure wrapper knows which rows to upsert and which to mark resolved.
 *
 * NOTHING in this file imports from `db/`, `drizzle-orm`, or any service
 * that touches the database. The verify-pure-helper-convention.sh static
 * gate enforces this.
 *
 * Spec: docs/brain-tree-os-adoption-spec.md §P4
 */

import type { DetectorContext, WorkspaceHealthFinding } from './detectorTypes';
import { ALL_DETECTORS } from './detectors/index.js';

export interface ExistingFindingRow {
  detector: string;
  resourceId: string;
}

export interface AuditDiff {
  /** Findings to upsert into the table — created or updated. */
  toUpsert: WorkspaceHealthFinding[];
  /** Existing findings that did not appear in the new sweep — to be marked resolved. */
  toResolve: ExistingFindingRow[];
  /** Counts for the per-org summary. */
  counts: { critical: number; warning: number; info: number; total: number };
}

/**
 * Run all detectors against the context, deduplicate, and return the
 * concatenated findings. Pure — same input always returns the same output.
 */
export function runDetectors(ctx: DetectorContext): WorkspaceHealthFinding[] {
  const seen = new Set<string>();
  const out: WorkspaceHealthFinding[] = [];
  for (const detector of ALL_DETECTORS) {
    const findings = detector(ctx);
    for (const f of findings) {
      const key = `${f.detector}:${f.resourceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
  }
  return out;
}

/**
 * Compute the diff between the new sweep and the existing finding set.
 * Returns the rows to upsert and the rows to resolve so the impure wrapper
 * can apply both in a single transaction.
 */
export function diffFindings(
  newFindings: WorkspaceHealthFinding[],
  existing: ExistingFindingRow[],
): AuditDiff {
  const newKeys = new Set(newFindings.map((f) => `${f.detector}:${f.resourceId}`));
  const toResolve = existing.filter((e) => !newKeys.has(`${e.detector}:${e.resourceId}`));

  let critical = 0;
  let warning = 0;
  let info = 0;
  for (const f of newFindings) {
    if (f.severity === 'critical') critical++;
    else if (f.severity === 'warning') warning++;
    else info++;
  }

  return {
    toUpsert: newFindings,
    toResolve,
    counts: { critical, warning, info, total: newFindings.length },
  };
}
