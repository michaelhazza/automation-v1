import { useEffect, useMemo, useRef, useState } from 'react';
import { diffWordsWithSpace } from 'diff';
import api from '../../lib/api';
import type { AnalysisResult, ProposedMergedContent } from './SkillAnalyzerWizard';

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
    return diffWordsWithSpace(baseline, value).map((part) => ({
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
        const { data } = await api.patch<AnalysisResult>(
          `/api/system/skill-analyser/jobs/${jobId}/results/${result.id}/merge`,
          patch,
        );
        setPatchError(null);
        onResultUpdated(data);
      } catch (err) {
        const e = err as { response?: { data?: { error?: string; message?: string } }; message?: string };
        const msg = e?.response?.data?.error ?? e?.response?.data?.message ?? e?.message ?? 'Failed to save merge edit.';
        console.error('[SkillAnalyzer] Failed to PATCH merge:', err);
        setPatchError(msg);
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
    setIsResetting(true);
    setPatchError(null);
    try {
      const { data } = await api.post<AnalysisResult>(
        `/api/system/skill-analyser/jobs/${jobId}/results/${result.id}/merge/reset`,
      );
      onResultUpdated(data);
    } catch (err) {
      const e = err as { response?: { data?: { error?: string; message?: string } }; message?: string };
      const msg = e?.response?.data?.error ?? e?.response?.data?.message ?? e?.message ?? 'Reset failed.';
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
  const reasoning = result.classificationReasoning;

  return (
    <div className="mt-3 p-3 bg-white border border-slate-200 rounded-lg">
      {reasoning && (
        <p className="text-xs text-slate-600 italic mb-2">{reasoning}</p>
      )}
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-slate-600">
          Recommended changes
          {result.userEditedMerge && (
            <span className="ml-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5">
              edited
            </span>
          )}
        </p>
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
