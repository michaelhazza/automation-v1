// ---------------------------------------------------------------------------
// mergeTypes.ts — client-side merge warning types + utilities
// These mirror the server-side types in skillAnalyzerServicePure.ts but are
// duplicated here to avoid importing server code into the client bundle.
// ---------------------------------------------------------------------------

export type MergeWarningCode =
  | 'REQUIRED_FIELD_DEMOTED'
  | 'CAPABILITY_OVERLAP'
  | 'SCOPE_EXPANSION'
  | 'SCOPE_EXPANSION_CRITICAL'
  | 'TABLE_ROWS_DROPPED'
  | 'INVOCATION_LOST'
  | 'HITL_LOST'
  | 'OUTPUT_FORMAT_LOST'
  | 'WARNINGS_TRUNCATED';

export type MergeWarningSeverity = 'warning' | 'critical';

export interface MergeWarning {
  code: MergeWarningCode;
  severity: MergeWarningSeverity;
  message: string;
  detail?: string;
}

/** Merge warning codes that block approval until resolved.
 *  SCOPE_EXPANSION_CRITICAL is intentionally excluded: scope creep is a correctness
 *  issue that the reviewer can fix by editing the merge, but it is not a safety gate.
 *  REQUIRED_FIELD_DEMOTED, INVOCATION_LOST, and HITL_LOST represent safety-critical
 *  regressions (broken API contracts, lost routing signals, removed human review gates)
 *  that must be fixed before approving. */
export const BLOCKING_WARNING_CODES = new Set<MergeWarningCode>([
  'REQUIRED_FIELD_DEMOTED',
  'INVOCATION_LOST',
  'HITL_LOST',
]);

/**
 * Compute a confidence score (0–1) from a warnings array.
 * Deductions are taken per unique warning code.
 * Floor: 0.2 (even a heavily-warned merge is reviewable).
 * Critical cap: 0.5 (any critical warning forces amber or red).
 */
export function computeMergeConfidence(warnings: MergeWarning[] | null | undefined): number {
  if (!warnings || warnings.length === 0) return 1.0;
  const deductions: Partial<Record<MergeWarningCode, number>> = {
    REQUIRED_FIELD_DEMOTED:   0.3,
    CAPABILITY_OVERLAP:       0.2,
    SCOPE_EXPANSION:          0.1,
    SCOPE_EXPANSION_CRITICAL: 0.2,
    INVOCATION_LOST:          0.3,
    HITL_LOST:                0.3,
    OUTPUT_FORMAT_LOST:       0.1,
    TABLE_ROWS_DROPPED:       0.1,
  };
  const seen = new Set<MergeWarningCode>();
  let score = 1.0;
  for (const w of warnings) {
    if (!seen.has(w.code)) {
      seen.add(w.code);
      score -= deductions[w.code] ?? 0;
    }
  }
  const hasCritical = warnings.some(w => w.severity === 'critical');
  const floored = Math.max(0.2, score);
  return hasCritical ? Math.min(floored, 0.5) : floored;
}

/** Human-readable label for a warning code badge. */
export function warningLabel(code: MergeWarningCode): string {
  switch (code) {
    case 'REQUIRED_FIELD_DEMOTED':   return 'Required field removed';
    case 'CAPABILITY_OVERLAP':       return 'Capability overlap';
    case 'SCOPE_EXPANSION':          return 'Scope expansion';
    case 'SCOPE_EXPANSION_CRITICAL': return 'Scope expansion — critical';
    case 'TABLE_ROWS_DROPPED':       return 'Table rows dropped';
    case 'INVOCATION_LOST':          return 'Invocation block lost';
    case 'HITL_LOST':                return 'Review gate lost';
    case 'OUTPUT_FORMAT_LOST':       return 'Output format lost';
    case 'WARNINGS_TRUNCATED':       return 'Warnings truncated';
  }
}

/** Tailwind class string for the warning badge background and text. */
export function warningBadgeClass(code: MergeWarningCode): string {
  switch (code) {
    case 'REQUIRED_FIELD_DEMOTED':   return 'bg-red-100 text-red-800';
    case 'CAPABILITY_OVERLAP':       return 'bg-orange-100 text-orange-800';
    case 'SCOPE_EXPANSION':          return 'bg-amber-100 text-amber-800';
    case 'SCOPE_EXPANSION_CRITICAL': return 'bg-red-100 text-red-800';
    case 'TABLE_ROWS_DROPPED':       return 'bg-amber-100 text-amber-800';
    case 'INVOCATION_LOST':          return 'bg-red-100 text-red-800';
    case 'HITL_LOST':                return 'bg-red-100 text-red-800';
    case 'OUTPUT_FORMAT_LOST':       return 'bg-amber-100 text-amber-800';
    case 'WARNINGS_TRUNCATED':       return 'bg-slate-100 text-slate-600';
  }
}
