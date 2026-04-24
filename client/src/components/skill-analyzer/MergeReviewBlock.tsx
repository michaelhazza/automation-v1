import { useEffect, useMemo, useRef, useState } from 'react';
import { diffWordsWithSpace } from 'diff';
import api from '../../lib/api';
import type { AnalysisResult, ProposedMergedContent } from './SkillAnalyzerWizard';
import {
  computeMergeConfidence,
  warningLabel,
  warningBadgeClass,
  evaluateApprovalState,
  parseDemotedFields,
  parseDemotedFieldStatuses,
  DEFAULT_WARNING_TIER_MAP,
  type MergeWarning,
  type MergeWarningCode,
  type WarningResolution,
  type WarningResolutionKind,
} from './mergeTypes';

// ---------------------------------------------------------------------------
// MergeReviewBlock — Phase 5 of skill-analyzer-v2
// ---------------------------------------------------------------------------
// Three-column merge view (Current / Incoming / Recommended) for
// PARTIAL_OVERLAP and IMPROVEMENT cards. Spec §7.1 — partial overlap cards.
//
// - Current column: read-only, shows result.matchedSkillContent (the live
//   library row attached by the GET /jobs/:id response in Phase 1)
// - Incoming column: read-only, shows the candidate's parsed content
// - Recommended column: editable, shows result.proposedMergedContent with
//   inline word-level diff highlighting against Current
//
// The Recommended column is what executeApproved writes back when the user
// approves. Edits flow through the PATCH /merge endpoint (debounced 300ms).
// The "Reset to AI suggestion" button rolls back to originalProposedMerge.
//
// Below ~1100px the three columns collapse to a tab strip
// [Current | Incoming | Recommended] with Recommended active by default.
// ---------------------------------------------------------------------------

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

type FieldKey = 'name' | 'description' | 'definition' | 'instructions';
const SHORT_FIELDS: FieldKey[] = ['name', 'description'];
const LONG_FIELDS: FieldKey[] = ['definition', 'instructions'];

function definitionToString(def: object | null | undefined): string {
  if (def === null || def === undefined) return '';
  try {
    return JSON.stringify(def, null, 2);
  } catch {
    return '';
  }
}

function tryParseJson(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'definition must be a JSON object' };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'invalid JSON' };
  }
}

/** Render a string with inline diff highlighting against a baseline.
 *  Words present in the baseline but missing from the value are shown as
 *  red strikethrough; words new in the value are shown as green
 *  insertions; unchanged words are plain. */
function InlineDiff({ baseline, value }: { baseline: string; value: string }) {
  const tokens = useMemo(() => {
    if (baseline === value) {
      return [{ kind: 'unchanged' as const, value }];
    }
    // Explicit empty-string handling so an empty side renders as a pure
    // addition or removal rather than tripping the "no shared tokens"
    // fallback below with a misleading strikethrough of "". See ChatGPT
    // PR review Round 1 Finding 5.
    if (!baseline) {
      return [{ kind: 'added' as const, value }];
    }
    if (!value) {
      return [{ kind: 'removed' as const, value: baseline }];
    }
    const parts = diffWordsWithSpace(baseline, value);
    // When the two strings share no unchanged tokens the word diff produces a
    // garbled concatenation (e.g. "Draft Ad Copyad-creative"). Fall back to a
    // simple two-token display: old value struck-through, new value highlighted.
    const hasUnchanged = parts.some((p) => !p.added && !p.removed);
    if (!hasUnchanged) {
      return [
        { kind: 'removed' as const, value: baseline },
        { kind: 'added' as const, value: value },
      ];
    }
    return parts.map((part) => ({
      kind: part.added ? ('added' as const) : part.removed ? ('removed' as const) : ('unchanged' as const),
      value: part.value,
    }));
  }, [baseline, value]);

  return (
    <span className="whitespace-pre-wrap">
      {tokens.map((t, i) => {
        if (t.kind === 'added') {
          return (
            <span key={i} className="bg-emerald-100 text-emerald-900 rounded-sm px-0.5">
              {t.value}
            </span>
          );
        }
        if (t.kind === 'removed') {
          return (
            <span key={i} className="bg-red-50 text-red-700 line-through rounded-sm px-0.5">
              {t.value}
            </span>
          );
        }
        return <span key={i}>{t.value}</span>;
      })}
    </span>
  );
}

interface ColumnProps {
  field: FieldKey;
  current: string;
  incoming: string;
  recommended: string;
  onRecommendedChange: (next: string) => void;
  definitionError?: string | null;
}

function FieldRow({ field, current, incoming, recommended, onRecommendedChange, definitionError }: ColumnProps) {
  const [activeTab, setActiveTab] = useState<'current' | 'incoming' | 'recommended'>('recommended');
  const isShort = SHORT_FIELDS.includes(field);

  // The Recommended column is editable. For short fields it's a single-line
  // input, for long fields it's a textarea. The diff highlight is rendered
  // OVER the baseline (Current) in a read-only preview row above the input.

  function renderReadOnly(value: string) {
    if (isShort) {
      return <div className="text-sm text-slate-700 break-words">{value || <span className="italic text-slate-300">empty</span>}</div>;
    }
    return (
      <pre className="text-xs text-slate-700 whitespace-pre-wrap break-words font-mono">
        {value || <span className="italic text-slate-300">empty</span>}
      </pre>
    );
  }

  function renderRecommended() {
    if (isShort) {
      return (
        <input
          type="text"
          value={recommended}
          onChange={(e) => onRecommendedChange(e.target.value)}
          className="w-full text-sm border border-emerald-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-400"
        />
      );
    }
    return (
      <textarea
        value={recommended}
        onChange={(e) => onRecommendedChange(e.target.value)}
        className="w-full text-xs border border-emerald-300 rounded px-2 py-1 font-mono bg-white focus:outline-none focus:ring-1 focus:ring-emerald-400 min-h-[120px]"
        rows={Math.min(20, Math.max(4, recommended.split('\n').length + 1))}
      />
    );
  }

  // The diff overlay is read-only — it's the visual the reviewer reads.
  function renderRecommendedDiff() {
    return (
      <div className="text-xs text-slate-700 whitespace-pre-wrap break-words font-mono mb-2 p-2 bg-emerald-50/30 border border-emerald-100 rounded">
        <InlineDiff baseline={current} value={recommended} />
      </div>
    );
  }

  return (
    <div className="border-t border-slate-100 pt-3 mt-3 first:border-t-0 first:pt-0 first:mt-0">
      <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-2 font-medium">{field}</div>

      {/* Wide layout: three columns side-by-side */}
      <div className="hidden xl:grid xl:grid-cols-3 xl:gap-3">
        <div>
          <div className="text-[10px] text-slate-500 mb-1">Current (library)</div>
          {renderReadOnly(current)}
        </div>
        <div>
          <div className="text-[10px] text-slate-500 mb-1">Incoming</div>
          {renderReadOnly(incoming)}
        </div>
        <div>
          <div className="text-[10px] text-emerald-700 mb-1 font-semibold">★ Recommended (editable)</div>
          {renderRecommendedDiff()}
          {renderRecommended()}
          {definitionError && field === 'definition' && (
            <p className="mt-1 text-[10px] text-red-600">{definitionError}</p>
          )}
        </div>
      </div>

      {/* Narrow layout: tab strip with Recommended active by default */}
      <div className="xl:hidden">
        <div className="flex gap-1 mb-2 text-[11px]">
          <button
            type="button"
            onClick={() => setActiveTab('current')}
            className={`px-2 py-1 rounded ${activeTab === 'current' ? 'bg-slate-200 text-slate-800' : 'bg-white text-slate-500 border border-slate-200'}`}
          >
            Current
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('incoming')}
            className={`px-2 py-1 rounded ${activeTab === 'incoming' ? 'bg-slate-200 text-slate-800' : 'bg-white text-slate-500 border border-slate-200'}`}
          >
            Incoming
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('recommended')}
            className={`px-2 py-1 rounded ${activeTab === 'recommended' ? 'bg-emerald-100 text-emerald-800 font-semibold' : 'bg-white text-slate-500 border border-slate-200'}`}
          >
            ★ Recommended
          </button>
        </div>
        {activeTab === 'current' && renderReadOnly(current)}
        {activeTab === 'incoming' && renderReadOnly(incoming)}
        {activeTab === 'recommended' && (
          <>
            {renderRecommendedDiff()}
            {renderRecommended()}
            {definitionError && field === 'definition' && (
              <p className="mt-1 text-[10px] text-red-600">{definitionError}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
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

// ---------------------------------------------------------------------------
// WarningResolutionBlock — v2 Fixes 1, 2, 6, 7
// ---------------------------------------------------------------------------
// Renders each merge warning with an appropriate resolution control. Calls
// the PATCH /resolve-warning endpoint with an If-Unmodified-Since header;
// the server is authoritative and will reject writes if the row has moved.
// ---------------------------------------------------------------------------

type ParsedNameMismatch = {
  topLevel?: string;
  schemaName?: string | null;
  distinctNames?: string[];
  candidates?: string[];
};

function parseNameMismatchDetail(detail: string | undefined): ParsedNameMismatch {
  if (!detail) return {};
  try {
    return JSON.parse(detail) as ParsedNameMismatch;
  } catch {
    return {};
  }
}

function WarningResolutionBlock({
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
  }, [warnings]);

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
    // eslint-disable-next-line no-console
    console.warn(
      '[MergeReviewBlock] Informational warning codes not classified into '
        + 'FORMATTING_WARNING_CODES — will render in the primary list. '
        + 'Review the partition and update FORMATTING_WARNING_CODES if '
        + 'any of these should be secondary: '
        + unclassifiedInformational.join(', '),
    );
  }
}

function WarningItem({
  warning,
  isLocked,
  isResolved,
  onResolve,
  criticalPhrase,
}: {
  warning: MergeWarning;
  isLocked: boolean;
  isResolved: (code: MergeWarningCode, field?: string) => WarningResolutionKind | null;
  onResolve: (
    code: MergeWarningCode,
    resolution: WarningResolutionKind,
    details?: { field?: string; disambiguationNote?: string; collidingSkillId?: string },
  ) => Promise<void>;
  criticalPhrase: string;
}) {
  const disabled = isLocked;
  const label = warningLabel(warning.code);
  const badge = warningBadgeClass(warning.code);

  const header = (
    <div className="flex items-start gap-2 mb-1">
      <span className={`mt-[1px] px-1.5 py-0.5 rounded text-[10px] font-medium ${badge}`}>
        {label}
      </span>
      <span className="text-slate-800 flex-1">{warning.message}</span>
    </div>
  );

  if (warning.code === 'REQUIRED_FIELD_DEMOTED') {
    const fields = parseDemotedFields(warning.detail);
    // v6 Fix 3: per-field status gives the reviewer the context to know
    // whether a field was deleted entirely, made optional (still in schema),
    // or possibly replaced by a similarly-named property.
    const statuses = parseDemotedFieldStatuses(warning.detail);
    return (
      <div className="mb-2">
        {header}
        <ul className="ml-4 space-y-1">
          {fields.map((field) => {
            const current = isResolved('REQUIRED_FIELD_DEMOTED', field);
            const fieldStatus = statuses[field];
            let statusLabel: string | null = null;
            let acceptText = 'Accept removal';
            if (fieldStatus?.status === 'made_optional') {
              statusLabel = 'made optional — still in schema';
              acceptText = 'Accept optional';
            } else if (fieldStatus?.status === 'replaced_by') {
              statusLabel = `possibly replaced by ${fieldStatus.replacement}`;
            } else if (fieldStatus?.status === 'removed_entirely') {
              statusLabel = 'removed from schema';
            }
            return (
              <li key={field} className="flex flex-wrap items-center gap-2 text-[11px]">
                <code className="text-slate-600">{field}</code>
                {statusLabel && (
                  <span className="text-slate-500 italic">{statusLabel}</span>
                )}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onResolve('REQUIRED_FIELD_DEMOTED', 'accept_removal', { field })}
                  className={`px-2 py-0.5 rounded border ${current === 'accept_removal' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-700 border-slate-300 hover:border-slate-500'} disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  {acceptText}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onResolve('REQUIRED_FIELD_DEMOTED', 'restore_required', { field })}
                  className={`px-2 py-0.5 rounded border ${current === 'restore_required' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-700 border-indigo-300 hover:border-indigo-500'} disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  Restore required
                </button>
                {current && <span className="text-emerald-700">✓</span>}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (warning.code === 'NAME_MISMATCH') {
    const parsed = parseNameMismatchDetail(warning.detail);
    const current = isResolved('NAME_MISMATCH');
    return (
      <div className="mb-2">
        {header}
        <div className="ml-4 mt-1 text-[11px] text-slate-600">
          <p>Library name: <code className="text-slate-800">{parsed.schemaName ?? '(none)'}</code></p>
          <p>Incoming name: <code className="text-slate-800">{parsed.topLevel || '(none)'}</code></p>
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onResolve('NAME_MISMATCH', 'use_library_name')}
              className={`px-2 py-0.5 rounded border ${current === 'use_library_name' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-700 border-indigo-300 hover:border-indigo-500'} disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              Use library name throughout
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onResolve('NAME_MISMATCH', 'use_incoming_name')}
              className={`px-2 py-0.5 rounded border ${current === 'use_incoming_name' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-700 border-indigo-300 hover:border-indigo-500'} disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              Use incoming name throughout
            </button>
            {current && <span className="text-emerald-700 self-center">✓</span>}
          </div>
        </div>
      </div>
    );
  }

  if (warning.code === 'SKILL_GRAPH_COLLISION') {
    const current = isResolved('SKILL_GRAPH_COLLISION');
    return (
      <div className="mb-2">
        {header}
        <div className="ml-4 mt-1 flex gap-2 text-[11px]">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onResolve('SKILL_GRAPH_COLLISION', 'scope_down')}
            className={`px-2 py-0.5 rounded border ${current === 'scope_down' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-700 border-indigo-300 hover:border-indigo-500'} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Scope down this merge
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onResolve('SKILL_GRAPH_COLLISION', 'flag_other')}
            className={`px-2 py-0.5 rounded border ${current === 'flag_other' ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-amber-700 border-amber-300 hover:border-amber-500'} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Flag other skill
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const note = window.prompt('Disambiguation note (required):');
              if (note && note.trim().length > 0) {
                onResolve('SKILL_GRAPH_COLLISION', 'accept_overlap', { disambiguationNote: note.trim() });
              }
            }}
            className={`px-2 py-0.5 rounded border ${current === 'accept_overlap' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-700 border-slate-300 hover:border-slate-500'} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Accept overlap
          </button>
          {current && <span className="text-emerald-700 self-center">✓</span>}
        </div>
      </div>
    );
  }

  if (warning.code === 'CLASSIFIER_FALLBACK') {
    const current = isResolved('CLASSIFIER_FALLBACK');
    return (
      <div className="mb-2">
        {header}
        <div className="ml-4 mt-1 text-[11px]">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              disabled={disabled}
              checked={current === 'acknowledge_low_confidence'}
              onChange={(e) => {
                if (e.target.checked) onResolve('CLASSIFIER_FALLBACK', 'acknowledge_low_confidence');
              }}
            />
            <span>I have reviewed the rule-based merge and accept the low-confidence state.</span>
          </label>
        </div>
      </div>
    );
  }

  if (warning.code === 'SCOPE_EXPANSION_CRITICAL') {
    // Critical-tier: require typing the configurable confirmation phrase.
    const current = isResolved('SCOPE_EXPANSION_CRITICAL');
    return (
      <div className="mb-2">
        {header}
        <div className="ml-4 mt-1 text-[11px]">
          <p className="text-slate-600 mb-1">
            To approve with critical scope expansion, either edit the merge below the threshold OR type the confirmation phrase exactly.
          </p>
          <CriticalPhraseInput
            current={current}
            disabled={disabled}
            expectedPhrase={criticalPhrase}
            onConfirm={() => onResolve('SCOPE_EXPANSION_CRITICAL', 'confirm_critical_phrase')}
          />
        </div>
      </div>
    );
  }

  if (warning.code === 'INVOCATION_LOST'
    || warning.code === 'HITL_LOST'
    || warning.code === 'SCOPE_EXPANSION'
    || warning.code === 'CAPABILITY_OVERLAP') {
    const current = isResolved(warning.code);
    return (
      <div className="mb-2">
        {header}
        <div className="ml-4 mt-1">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onResolve(warning.code, 'acknowledge_warning')}
            className={`px-2 py-0.5 rounded border text-[11px] ${current === 'acknowledge_warning' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-700 border-slate-300 hover:border-slate-500'} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Acknowledge
          </button>
          {current && <span className="ml-2 text-emerald-700 text-[11px]">✓</span>}
        </div>
      </div>
    );
  }

  // Informational tier: no resolution control; just show the detail.
  return (
    <div className="mb-2">
      {header}
      {warning.detail && <div className="ml-4 text-slate-500 text-[10px]">{warning.detail}</div>}
    </div>
  );
}

function CriticalPhraseInput({
  current,
  disabled,
  expectedPhrase,
  onConfirm,
}: {
  current: WarningResolutionKind | null;
  disabled: boolean;
  expectedPhrase: string;
  onConfirm: () => void;
}) {
  const [phrase, setPhrase] = useState('');

  if (current === 'confirm_critical_phrase') {
    return <span className="text-emerald-700">Confirmation recorded ✓</span>;
  }

  const matches = phrase.trim() === expectedPhrase.trim();

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={phrase}
        disabled={disabled}
        onChange={(e) => setPhrase(e.target.value)}
        placeholder={`Type: ${expectedPhrase}`}
        className="flex-1 border border-slate-300 rounded px-2 py-0.5 text-[11px]"
      />
      <button
        type="button"
        disabled={disabled || !matches}
        onClick={onConfirm}
        className="px-2 py-0.5 rounded bg-red-600 text-white text-[11px] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Confirm critical
      </button>
    </div>
  );
}


