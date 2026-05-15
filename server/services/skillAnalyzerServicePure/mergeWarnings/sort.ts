import type { MergeWarning, MergeWarningCode, MergeWarningSeverity, WarningTier } from './types.js';
import { WARNING_SEVERITY_PRIORITY, WARNING_TIER_PRIORITY, DEFAULT_WARNING_TIER_MAP } from './defaults.js';

/** Sort warnings in-place by severity and tier priority so the highest-value
 *  ones survive MAX_MERGE_WARNINGS truncation. Exported for tests. */
export function sortWarningsBySeverity(
  warnings: MergeWarning[],
  tierMap: Record<string, WarningTier> = DEFAULT_WARNING_TIER_MAP,
): MergeWarning[] {
  return warnings.slice().sort((a, b) => {
    const sev = WARNING_SEVERITY_PRIORITY[b.severity] - WARNING_SEVERITY_PRIORITY[a.severity];
    if (sev !== 0) return sev;
    const aTier = tierMap[a.code] ?? DEFAULT_WARNING_TIER_MAP[a.code as MergeWarningCode] ?? 'informational';
    const bTier = tierMap[b.code] ?? DEFAULT_WARNING_TIER_MAP[b.code as MergeWarningCode] ?? 'informational';
    return WARNING_TIER_PRIORITY[bTier] - WARNING_TIER_PRIORITY[aTier];
  });
}
