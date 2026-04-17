// ---------------------------------------------------------------------------
// mergeTypes.ts — client-side merge warning types + approval-gate utilities.
// These mirror the server-side types in skillAnalyzerServicePure.ts but are
// duplicated here to avoid importing server code into the client bundle.
//
// The server is authoritative for approval decisions; this module provides
// optimistic UI preview via evaluateApprovalState — the server re-checks
// on every approve / execute.
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
  | 'WARNINGS_TRUNCATED'
  | 'CLASSIFIER_FALLBACK'
  | 'NAME_MISMATCH'
  | 'SKILL_GRAPH_COLLISION';

export type MergeWarningSeverity = 'warning' | 'critical';

export interface MergeWarning {
  code: MergeWarningCode;
  severity: MergeWarningSeverity;
  message: string;
  detail?: string;
}

export type WarningTier =
  | 'informational'
  | 'standard'
  | 'decision_required'
  | 'critical';

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
};

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
  resolvedAt: string;
  resolvedBy: string;
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

const RESOLUTIONS_FOR_CODE: Record<MergeWarningCode, WarningResolutionKind[]> = {
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
};

export function parseDemotedFields(detail: string | undefined): string[] {
  if (!detail) return [];
  const trimmed = detail.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed?.demotedFields)) {
        return parsed.demotedFields.filter((f: unknown) => typeof f === 'string') as string[];
      }
    } catch {
      // fall through
    }
  }
  return trimmed.split(/\s*,\s*/).filter(Boolean);
}

function isResolvedBy(
  code: MergeWarningCode,
  field: string | undefined,
  resolutions: WarningResolution[],
): boolean {
  const allowed = RESOLUTIONS_FOR_CODE[code] ?? [];
  return resolutions.some(r =>
    r.warningCode === code
    && (allowed.length === 0 || allowed.includes(r.resolution))
    && (field === undefined || r.details?.field === field));
}

/** Canonical client-side preview of approval state. Mirrors the server
 *  implementation in skillAnalyzerServicePure.ts. */
export function evaluateApprovalState(
  warnings: MergeWarning[] | null | undefined,
  resolutions: WarningResolution[] | null | undefined,
  tierMap: Record<string, WarningTier> = DEFAULT_WARNING_TIER_MAP,
): ApprovalState {
  const reasons: ApprovalBlockingReason[] = [];
  const required: RequiredResolution[] = [];
  const safeWarnings = warnings ?? [];
  const safeResolutions = resolutions ?? [];

  for (const w of safeWarnings) {
    const tier = (tierMap[w.code] ?? DEFAULT_WARNING_TIER_MAP[w.code]) ?? 'informational';
    if (tier === 'informational') continue;

    if (w.code === 'REQUIRED_FIELD_DEMOTED') {
      const fields = parseDemotedFields(w.detail);
      for (const field of fields) {
        if (!isResolvedBy('REQUIRED_FIELD_DEMOTED', field, safeResolutions)) {
          reasons.push({
            warningCode: w.code,
            tier,
            message: `Field "${field}" — choose Accept removal or Restore required.`,
            field,
          });
          required.push({
            warningCode: w.code,
            allowedResolutions: RESOLUTIONS_FOR_CODE.REQUIRED_FIELD_DEMOTED,
            field,
          });
        }
      }
      continue;
    }

    if (!isResolvedBy(w.code, undefined, safeResolutions)) {
      reasons.push({ warningCode: w.code, tier, message: w.message });
      required.push({
        warningCode: w.code,
        allowedResolutions: RESOLUTIONS_FOR_CODE[w.code] ?? ['acknowledge_warning'],
      });
    }
  }

  return { blocked: reasons.length > 0, reasons, requiredResolutions: required };
}

/**
 * Compute a confidence score (0–1) from a warnings array.
 * Deductions are taken per unique warning code. Floor 0.2; critical cap 0.5.
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
    CLASSIFIER_FALLBACK:      0.4,
    NAME_MISMATCH:            0.2,
    SKILL_GRAPH_COLLISION:    0.2,
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
    case 'CLASSIFIER_FALLBACK':      return 'Classifier fallback — low confidence';
    case 'NAME_MISMATCH':            return 'Name mismatch';
    case 'SKILL_GRAPH_COLLISION':    return 'Skill graph collision';
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
    case 'CLASSIFIER_FALLBACK':      return 'bg-red-100 text-red-800';
    case 'NAME_MISMATCH':            return 'bg-red-100 text-red-800';
    case 'SKILL_GRAPH_COLLISION':    return 'bg-orange-100 text-orange-800';
  }
}
