import { useEffect, useRef, useState } from 'react';
import api from '../../lib/api';
import type { AnalysisResult, ProposedMergedContent } from './types';
import {
  computeMergeConfidence,
} from './mergeTypes';
import { definitionToString, tryParseJson, type FieldKey } from './mergeReview/format';
import { FieldRow } from './mergeReview/FieldRow';
import { WarningResolutionBlock } from './mergeReview/WarningResolutionBlock';

// MergeReviewBlock — orchestrator (Phase 5 of skill-analyzer-v2).
// Sub-pieces live in ./mergeReview/. Spec §7.1 — partial overlap cards.

interface CandidateLike {
  name: string;
  description: string;
  definition: object | null;
  instructions: string | null;
}

interface Props {
  result: AnalysisResult;
  candidate: CandidateLike;
  jobId: string;
  onResultUpdated: (next: AnalysisResult) => void;
}

export default function MergeReviewBlock({ result, candidate, jobId, onResultUpdated }: Props) {
  const merge = result.proposedMergedContent ?? null;

  // Local state mirrors the merge so edits feel instant; PATCHes are
  // debounced. The local state is replaced from props whenever the
  // result row updates externally (e.g. after a Reset).
  const [localMerge, setLocalMerge] = useState<ProposedMergedContent | null>(merge);
  const [definitionError, setDefinitionError] = useState<string | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [showRationale, setShowRationale] = useState(false);

  const confidence = computeMergeConfidence(result.mergeWarnings);
  const confidenceLabel = confidence >= 0.8 ? 'High confidence'
    : confidence >= 0.5 ? 'Review carefully'
    : 'Low confidence';
  const confidenceClass = confidence >= 0.8
    ? 'text-emerald-700 bg-emerald-50'
    : confidence >= 0.5
    ? 'text-amber-700 bg-amber-50'
    : 'text-red-700 bg-red-50';

  // Reset local state when external merge changes (e.g. Reset endpoint).
  // Compare by JSON identity so edits don't get clobbered on every parent
  // re-render.
  const externalMergeKey = JSON.stringify(merge);
  useEffect(() => {
    setLocalMerge(merge);
    setDefinitionError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalMergeKey]);

  // Pending PATCH state — track which fields have been edited locally and
  // need to flush. Debounce the flush by 300ms.
  const pendingPatchRef = useRef<Partial<ProposedMergedContent>>({});
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function schedulePatch() {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(async () => {
      const patch = pendingPatchRef.current;
      pendingPatchRef.current = {};
      if (Object.keys(patch).length === 0) return;
      try {
        const body = result.mergeUpdatedAt
          ? { ...patch, mergeUpdatedAt: result.mergeUpdatedAt }
          : patch;
        const { data } = await api.patch<AnalysisResult & { resolutionsCleared?: boolean }>(
          `/api/system/skill-analyser/jobs/${jobId}/results/${result.id}/merge`,
          body,
        );
        setPatchError(null);
        if (data.resolutionsCleared) {
          setPatchError('Your previous review decisions were cleared because the merge changed. Re-review required before approval.');
        }
        onResultUpdated(data);
      } catch (err) {
        const e = err as { response?: { status?: number; data?: { error?: unknown } }; message?: string };
        if (e?.response?.status === 409) {
          setPatchError('This merge was edited in another session. Reload the page to see the latest version.');
        } else {
          const errBody = e?.response?.data?.error;
          const msg = (typeof errBody === 'string' ? errBody : (errBody as { message?: string } | null)?.message) ?? e?.message ?? 'Failed to save merge edit.';
          console.error('[SkillAnalyzer] Failed to PATCH merge:', err);
          setPatchError(msg);
        }
      }
    }, 300);
  }

  function updateField<K extends FieldKey>(field: K, value: string) {
    if (!localMerge) return;
    if (field === 'definition') {
      const parsed = tryParseJson(value);
      // Always update the local string view so the user can see what they
      // typed, but only schedule a PATCH when the JSON is valid.
      setLocalMerge({ ...localMerge, definition: parsed.ok ? parsed.value : localMerge.definition });
      if (parsed.ok) {
        setDefinitionError(null);
        pendingPatchRef.current = { ...pendingPatchRef.current, definition: parsed.value };
        schedulePatch();
      } else {
        setDefinitionError(parsed.error);
      }
      return;
    }
    if (field === 'instructions') {
      const next = value.length === 0 ? null : value;
      setLocalMerge({ ...localMerge, instructions: next });
      pendingPatchRef.current = { ...pendingPatchRef.current, instructions: next };
      schedulePatch();
      return;
    }
    setLocalMerge({ ...localMerge, [field]: value });
    pendingPatchRef.current = { ...pendingPatchRef.current, [field]: value };
    schedulePatch();
  }

  // For the JSON definition column we keep a separate stringified state so
  // the textarea preserves whatever the user is typing (even mid-edit
  // before it parses cleanly).
  const [definitionString, setDefinitionString] = useState<string>(definitionToString(merge?.definition));
  useEffect(() => {
    setDefinitionString(definitionToString(merge?.definition));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalMergeKey]);

  function onDefinitionChange(value: string) {
    setDefinitionString(value);
    updateField('definition', value);
  }

  async function handleReset() {
    // Cancel any pending debounced PATCH before resetting. Without this, a
    // merge-field edit made inside the 300ms window still fires after the
    // reset completes and clobbers the restored AI suggestion, flipping
    // userEditedMerge back on. The timer ref and the pending patch buffer
    // both need to be cleared.
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    pendingPatchRef.current = {};
    setIsResetting(true);
    setPatchError(null);
    try {
      const { data } = await api.post<AnalysisResult & { resolutionsCleared?: boolean }>(
        `/api/system/skill-analyser/jobs/${jobId}/results/${result.id}/merge/reset`,
      );
      if (data.resolutionsCleared) {
        setPatchError('Your previous review decisions were cleared because the merge was reset. Re-review required before approval.');
      }
      onResultUpdated(data);
    } catch (err) {
      const e = err as { response?: { data?: { error?: unknown } }; message?: string };
      const errBody = e?.response?.data?.error;
      const msg = (typeof errBody === 'string' ? errBody : (errBody as { message?: string } | null)?.message) ?? e?.message ?? 'Reset failed.';
      console.error('[SkillAnalyzer] Failed to reset merge:', err);
      setPatchError(msg);
    } finally {
      setIsResetting(false);
    }
  }

  // Fallback path: no merge proposal → render the spec's notice instead.
  if (!localMerge) {
    return (
      <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
        <p className="font-medium mb-1">Proposal unavailable</p>
        <p>Re-run the analysis after the classifier is back online.</p>
      </div>
    );
  }

  // No matched library content → can't render the Current column. This is
  // the same fallback path with a slightly different message.
  if (!result.matchedSkillContent) {
    return (
      <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
        <p className="font-medium mb-1">Library skill no longer exists</p>
        <p>Re-run the analysis to refresh the matched skill reference.</p>
      </div>
    );
  }

  const matched = result.matchedSkillContent;

  return (
    <div className="mt-3 p-3 bg-white border border-slate-200 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-slate-600">
            Recommended changes
            {result.userEditedMerge && (
              <span className="ml-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5">
                edited
              </span>
            )}
          </p>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${confidenceClass}`}>
            {confidenceLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={handleReset}
          disabled={!result.userEditedMerge || isResetting}
          className="text-[11px] text-indigo-600 hover:text-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isResetting ? 'Resetting…' : 'Reset to AI suggestion'}
        </button>
      </div>

      {patchError && <p className="mb-2 text-xs text-red-600">{patchError}</p>}

      {/* Warning banner + resolution UI — v2 Fixes 1/2/6/7 */}
      {result.mergeWarnings && result.mergeWarnings.length > 0 && (
        <WarningResolutionBlock
          jobId={jobId}
          result={result}
          onResultUpdated={onResultUpdated}
        />
      )}

      {/* Merge rationale collapsible — Bug 6 */}
      {result.mergeRationale && (
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setShowRationale(v => !v)}
            className="text-[11px] text-slate-500 hover:text-slate-700 flex items-center gap-1"
          >
            <span>{showRationale ? '▾' : '▸'}</span> Merge rationale
          </button>
          {showRationale && (
            <p className="mt-1 text-xs text-slate-600 leading-relaxed pl-3 border-l border-slate-200">
              {result.mergeRationale}
            </p>
          )}
        </div>
      )}

      {/* Diff legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-emerald-100 border border-emerald-300 inline-block" />
          Added from incoming
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-red-50 border border-red-300 inline-block" />
          Removed from current
        </span>
        <span className="italic">Rewritten passages appear fully highlighted — review content carefully</span>
      </div>

      <FieldRow
        field="name"
        current={matched.name}
        incoming={candidate.name}
        recommended={localMerge.name}
        onRecommendedChange={(v) => updateField('name', v)}
      />
      <FieldRow
        field="description"
        current={matched.description}
        incoming={candidate.description}
        recommended={localMerge.description}
        onRecommendedChange={(v) => updateField('description', v)}
      />
      <FieldRow
        field="definition"
        current={definitionToString(matched.definition)}
        incoming={definitionToString(candidate.definition)}
        recommended={definitionString}
        onRecommendedChange={onDefinitionChange}
        definitionError={definitionError}
      />
      <FieldRow
        field="instructions"
        current={matched.instructions ?? ''}
        incoming={candidate.instructions ?? ''}
        recommended={localMerge.instructions ?? ''}
        onRecommendedChange={(v) => updateField('instructions', v)}
      />
    </div>
  );
}
