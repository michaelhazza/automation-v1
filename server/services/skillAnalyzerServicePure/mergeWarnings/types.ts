/** Shape of the proposedMerge object the LLM is asked to return when
 *  classification is PARTIAL_OVERLAP or IMPROVEMENT. Matches the
 *  proposed_merged_content jsonb column on skill_analyzer_results. */
export interface ProposedMerge {
  name: string;
  description: string;
  // Anthropic tool definition object — never a string.
  definition: object;
  instructions: string | null;
  mergeRationale?: string;   // optional — omitted before storage, surfaced in UI
}

export type MergeWarningCode =
  | 'REQUIRED_FIELD_DEMOTED'
  | 'CAPABILITY_OVERLAP'
  | 'SCOPE_EXPANSION'
  | 'SCOPE_EXPANSION_CRITICAL'
  | 'TABLE_ROWS_DROPPED'
  | 'INVOCATION_LOST'
  | 'HITL_LOST'
  | 'OUTPUT_FORMAT_LOST'
  | 'WARNINGS_TRUNCATED'
  // v2 fix-cycle additions
  | 'CLASSIFIER_FALLBACK'
  | 'NAME_MISMATCH'
  | 'SKILL_GRAPH_COLLISION'
  | 'SOURCE_FORK'
  | 'NEAR_REPLACEMENT'
  | 'CONTENT_OVERLAP'
  // v6 fix-cycle additions
  | 'CROSS_REFERENCES_DISTINCT'
  // consolidation-pass additions
  | 'CONSOLIDATION_APPLIED'
  | 'CONSOLIDATION_DECLINED'
  | 'CONSOLIDATION_FAILED';

export type MergeWarningSeverity = 'warning' | 'critical';

export interface MergeWarning {
  code: MergeWarningCode;
  severity: MergeWarningSeverity;
  message: string;
  detail?: string;
}

/** Warning tier — read from skill_analyzer_config.warning_tier_map.
 *  Controls how the Approve button gates on each warning. See plan §4. */
export type WarningTier =
  | 'informational'         // display only
  | 'standard'              // single-click acknowledgment
  | 'decision_required'     // structured resolution needed
  | 'critical';             // edit merge OR type confirmation phrase
