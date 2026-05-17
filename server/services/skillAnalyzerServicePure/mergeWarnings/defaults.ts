import type { MergeWarningCode, MergeWarningSeverity, WarningTier } from './types.js';

/** Default tier map used when config snapshot is absent (e.g., legacy jobs).
 *  Mirrors the DB default in migration 0155. */
export const DEFAULT_WARNING_TIER_MAP: Record<MergeWarningCode, WarningTier> = {
  REQUIRED_FIELD_DEMOTED:   'decision_required',
  NAME_MISMATCH:            'decision_required',
  SKILL_GRAPH_COLLISION:    'decision_required',
  INVOCATION_LOST:          'decision_required',
  HITL_LOST:                'decision_required',
  CLASSIFIER_FALLBACK:      'decision_required',
  SCOPE_EXPANSION_CRITICAL: 'critical',
  SCOPE_EXPANSION:          'standard',
  CAPABILITY_OVERLAP:       'standard',
  TABLE_ROWS_DROPPED:       'informational',
  OUTPUT_FORMAT_LOST:       'informational',
  WARNINGS_TRUNCATED:       'informational',
  SOURCE_FORK:              'decision_required',
  NEAR_REPLACEMENT:         'standard',
  CONTENT_OVERLAP:          'standard',
  CROSS_REFERENCES_DISTINCT:  'informational',
  CONSOLIDATION_APPLIED:      'informational',
  CONSOLIDATION_DECLINED:     'informational',
  CONSOLIDATION_FAILED:       'informational',
};

/** Severity priority used when sorting warnings before MAX-count truncation.
 *  Higher number = higher priority; survives when warnings are capped. */
export const WARNING_SEVERITY_PRIORITY: Record<MergeWarningSeverity, number> = {
  critical: 2,
  warning: 1,
};

/** Tier priority used as secondary sort. Higher = kept during truncation. */
export const WARNING_TIER_PRIORITY: Record<WarningTier, number> = {
  critical: 4,
  decision_required: 3,
  standard: 2,
  informational: 1,
};
