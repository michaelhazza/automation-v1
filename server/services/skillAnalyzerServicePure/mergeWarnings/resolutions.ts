import type { MergeWarningCode, WarningTier } from './types.js';

/** Reviewer resolution recorded against a warning. Append-only JSONB array
 *  on skill_analyzer_results.warning_resolutions, deduped by composite key
 *  (warningCode, details.field ?? null). Wiped on merge edit. */
export type WarningResolutionKind =
  | 'accept_removal'
  | 'restore_required'
  | 'use_library_name'
  | 'use_incoming_name'
  | 'scope_down'
  | 'flag_other'
  | 'accept_overlap'
  | 'acknowledge_low_confidence'
  | 'acknowledge_warning'
  | 'confirm_critical_phrase';

export interface WarningResolution {
  warningCode: MergeWarningCode;
  resolution: WarningResolutionKind;
  resolvedAt: string;    // ISO timestamp
  resolvedBy: string;    // userId
  details?: { field?: string; disambiguationNote?: string; collidingSkillId?: string };
}

export interface ApprovalBlockingReason {
  warningCode: MergeWarningCode;
  tier: WarningTier;
  message: string;
  field?: string;
}

export interface RequiredResolution {
  warningCode: MergeWarningCode;
  allowedResolutions: WarningResolutionKind[];
  field?: string;
}

export interface ApprovalState {
  blocked: boolean;
  reasons: ApprovalBlockingReason[];
  requiredResolutions: RequiredResolution[];
}

/** Allowed resolution kinds per warning code. */
export const RESOLUTIONS_FOR_CODE: Record<MergeWarningCode, WarningResolutionKind[]> = {
  REQUIRED_FIELD_DEMOTED:   ['accept_removal', 'restore_required'],
  NAME_MISMATCH:            ['use_library_name', 'use_incoming_name'],
  SKILL_GRAPH_COLLISION:    ['scope_down', 'flag_other', 'accept_overlap'],
  INVOCATION_LOST:          ['acknowledge_warning'],
  HITL_LOST:                ['acknowledge_warning'],
  CLASSIFIER_FALLBACK:      ['acknowledge_low_confidence'],
  SCOPE_EXPANSION_CRITICAL: ['confirm_critical_phrase'],
  SCOPE_EXPANSION:          ['acknowledge_warning'],
  CAPABILITY_OVERLAP:       ['acknowledge_warning'],
  TABLE_ROWS_DROPPED:       [],
  OUTPUT_FORMAT_LOST:       [],
  WARNINGS_TRUNCATED:       [],
  SOURCE_FORK:              ['acknowledge_warning'],
  NEAR_REPLACEMENT:         ['acknowledge_warning'],
  CONTENT_OVERLAP:          ['acknowledge_warning'],
  CROSS_REFERENCES_DISTINCT:  [],
  CONSOLIDATION_APPLIED:      [],
  CONSOLIDATION_DECLINED:     [],
  CONSOLIDATION_FAILED:       [],
};
