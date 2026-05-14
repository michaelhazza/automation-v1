import { useEffect, useState } from 'react';
import api from '../../../lib/api';
import type { AnalysisResult } from '../types';
import {
  evaluateApprovalState,
  DEFAULT_WARNING_TIER_MAP,
  type MergeWarning,
  type MergeWarningCode,
  type WarningResolution,
  type WarningResolutionKind,
} from '../mergeTypes';
import { WarningItem } from './WarningItem';

/** Warning codes rendered in the secondary "Formatting & notes" section
 *  (v6 Fix 2). Kept adjacent to the partition logic so the two can't drift. */
const FORMATTING_WARNING_CODES = new Set<MergeWarningCode>([
  'NAME_MISMATCH',
  'CROSS_REFERENCES_DISTINCT',
]);

// Dev-time guard: the partition is implicit — anything NOT in
// FORMATTING_WARNING_CODES renders in the primary list. A new warning code
// added in mergeTypes.ts will silently land in the primary group if this
// file isn't updated. Catch that at module load in non-production builds
// by walking DEFAULT_WARNING_TIER_MAP (exhaustive `Record<MergeWarningCode,
// …>`, so adding a code without adding a tier is already a compile error).
// Informational-tier codes are the ones that most naturally belong in the
// Formatting & notes group — warn if a new informational code was added
// without being classified here. See ChatGPT PR review Round 1 Finding 6.
if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
  const unclassifiedInformational = (Object.entries(DEFAULT_WARNING_TIER_MAP) as Array<
    [MergeWarningCode, string]
  >)
    .filter(([code, tier]) => tier === 'informational' && !FORMATTING_WARNING_CODES.has(code))
    .map(([code]) => code);
  if (unclassifiedInformational.length > 0) {

    console.warn(
      '[MergeReviewBlock] Informational warning codes not classified into '
        + 'FORMATTING_WARNING_CODES — will render in the primary list. '
        + 'Review the partition and update FORMATTING_WARNING_CODES if '
        + 'any of these should be secondary: '
        + unclassifiedInformational.join(', '),
    );
  }
}

export function WarningResolutionBlock({
  jobId,
  result,
  onResultUpdated,
}: {
  jobId: string;
  result: AnalysisResult;
  onResultUpdated: (next: AnalysisResult) => void;
}) {
  const warnings = (result.mergeWarnings ?? []) as MergeWarning[];
  const resolutions = (result.warningResolutions ?? []) as WarningResolution[];
  const approvalState = evaluateApprovalState(warnings, resolutions);
  const isLocked = !!result.approvedAt;
  // Concurrency token. Prefer mergeUpdatedAt (set after any merge edit);
  // fall back to the row's createdAt for never-edited rows. The server
  // requires an exact match (within ~2s skew) against the same derivation,
  // so inventing a "now" timestamp would fail by design.
  const mergeUpdatedAt =
    result.mergeUpdatedAt ?? result.createdAt ?? new Date().toISOString();
  const isFallback = !!result.classifierFallbackApplied
    || warnings.some(w => w.code === 'CLASSIFIER_FALLBACK');

  // Fetch the confirmation phrase once per merge block — shared across all
  // CriticalPhraseInput instances to avoid N parallel config requests.
  const [criticalPhrase, setCriticalPhrase] = useState<string>('I accept this critical warning');
  useEffect(() => {
    let cancelled = false;
    const hasCritical = warnings.some(w => w.code === 'SCOPE_EXPANSION_CRITICAL');
    if (!hasCritical) return;
    api
      .get<{ criticalWarningConfirmationPhrase: string }>('/api/system/skill-analyser/config')
      .then(({ data }) => {
        if (!cancelled && typeof data?.criticalWarningConfirmationPhrase === 'string') {
          setCriticalPhrase(data.criticalWarningConfirmationPhrase);
        }
      })
      .catch(() => { /* keep default */ });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.mergeWarnings]);

  async function resolveWarning(
    warningCode: MergeWarningCode,
    resolution: WarningResolutionKind,
    details?: { field?: string; disambiguationNote?: string; collidingSkillId?: string },
  ) {
    try {
      await api.patch(
        `/api/system/skill-analyser/jobs/${jobId}/results/${result.id}/resolve-warning`,
        { warningCode, resolution, details },
        { headers: { 'If-Unmodified-Since': mergeUpdatedAt } },
      );
      // Refetch the row to pick up the new resolution list.
      const { data } = await api.get<{ results: AnalysisResult[] }>(
        `/api/system/skill-analyser/jobs/${jobId}`,
      );
      const next = data.results.find(r => r.id === result.id);
      if (next) onResultUpdated(next);
    } catch (err) {
      const e = err as { response?: { data?: { error?: unknown } }; message?: string };
      const body = e?.response?.data?.error;
      const msg = (typeof body === 'string' ? body : (body as { message?: string } | null)?.message) ?? e?.message ?? 'Failed to record resolution.';
      alert(msg);
    }
  }

  function isResolved(code: MergeWarningCode, field?: string): WarningResolutionKind | null {
    for (const r of resolutions) {
      if (r.warningCode !== code) continue;
      if (field && r.details?.field !== field) continue;
      return r.resolution;
    }
    return null;
  }

  return (
    <div
      className={`mb-3 p-3 rounded border text-xs ${
        approvalState.blocked ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
      }`}
    >
      {isFallback && (
        <div className="mb-2 p-2 bg-red-100 border border-red-200 rounded text-red-900 font-medium">
          LOW CONFIDENCE — Classifier unavailable. Rule-based merge applied. Review all sections carefully.
        </div>
      )}
      {isLocked && (
        <div className="mb-2 p-2 bg-slate-100 border border-slate-300 rounded text-slate-700 text-[11px]">
          Result is approved — unapprove to edit merge or change resolutions.
        </div>
      )}
      {result.wasApprovedBefore && !isLocked && (
        <div className="mb-2 p-2 bg-indigo-50 border border-indigo-200 rounded text-indigo-800 text-[11px]">
          ⚠️ Modified after a previous approval — re-review required before approving again.
        </div>
      )}
      <p className="font-semibold text-slate-800 mb-2">
        Merge warnings {approvalState.blocked && <span className="text-red-700">· Action required before approval</span>}
      </p>
      {/* v6 Fix 2: split warnings into a primary data-integrity group and a
          secondary "formatting & notes" group (name mismatch, cross-reference
          hints). Keeps the critical list short and de-noises the primary area. */}
      {warnings.filter(w => !FORMATTING_WARNING_CODES.has(w.code)).map((w, i) => (
        <WarningItem
          key={`${w.code}-${i}`}
          warning={w}
          isLocked={isLocked}
          isResolved={isResolved}
          onResolve={resolveWarning}
          criticalPhrase={criticalPhrase}
        />
      ))}
      {warnings.some(w => FORMATTING_WARNING_CODES.has(w.code)) && (
        <div className="mt-3 pt-2 border-t border-slate-300/60">
          <p className="font-medium text-slate-600 mb-2 text-[11px] uppercase tracking-wide">
            Formatting & notes
          </p>
          {warnings.filter(w => FORMATTING_WARNING_CODES.has(w.code)).map((w, i) => (
            <WarningItem
              key={`fmt-${w.code}-${i}`}
              warning={w}
              isLocked={isLocked}
              isResolved={isResolved}
              onResolve={resolveWarning}
              criticalPhrase={criticalPhrase}
            />
          ))}
        </div>
      )}
    </div>
  );
}
